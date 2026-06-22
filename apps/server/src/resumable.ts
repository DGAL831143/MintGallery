import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { FileStore } from '@tus/file-store'
import { Server } from '@tus/server'
import { SESSION_COOKIE, hashSessionToken, publicUser, type SessionUser } from './auth.js'
import { ingestSingleAsset, type AssetVisibility } from './asset-ingest.js'
import type { AppConfig } from './config.js'
import { inspectStoredUpload, storageStats } from './storage.js'

const MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024
const UPLOAD_ID_PATTERN = /^[a-f0-9]{32}$/

interface TusResult {
  assetId: string
  ownerId: string
}

function cleanOriginalName(filename: string | null | undefined): string {
  return path.basename(filename ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 255) || '未命名文件'
}

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    return part.slice(separator + 1).trim()
  }
  return undefined
}

function sessionUser(database: DatabaseSync, request: Request): SessionUser | null {
  const token = cookieValue(request.headers.get('cookie'), SESSION_COOKIE)
  if (!token) return null

  const row = database
    .prepare(`
      SELECT u.id, u.username, u.role, u.status, u.must_change_password
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'ACTIVE'
    `)
    .get(hashSessionToken(token), Date.now()) as Parameters<typeof publicUser>[0] | undefined

  return row ? publicUser(row) : null
}

function validUploadId(uploadId: string): boolean {
  return UPLOAD_ID_PATTERN.test(uploadId)
}

export function createResumableUploads(database: DatabaseSync, config: AppConfig) {
  const tusDirectory = path.join(config.temporaryDirectory, 'tus')
  const finalizingDirectory = path.join(config.temporaryDirectory, 'finalizing')
  const resultsDirectory = path.join(config.temporaryDirectory, 'tus-results')
  const store = new FileStore({
    directory: tusDirectory,
    expirationPeriodInMilliseconds: 7 * 24 * 60 * 60 * 1000,
  })

  const resultPath = (uploadId: string) => path.join(resultsDirectory, `${uploadId}.json`)

  const server = new Server({
    path: '/api/uploads/resumable',
    datastore: store,
    maxSize: MAX_UPLOAD_SIZE,
    relativeLocation: true,
    async onIncomingRequest(request, uploadId) {
      const user = sessionUser(database, request)
      if (!user) throw { status_code: 401, body: '请先登录' }

      if (request.method !== 'POST' && request.method !== 'OPTIONS' && validUploadId(uploadId)) {
        const upload = await store.getUpload(uploadId)
        if (upload.metadata?.ownerId !== user.id) {
          throw { status_code: 403, body: '无权访问该上传任务' }
        }
      }
    },
    async onUploadCreate(request, upload) {
      const user = sessionUser(database, request)
      if (!user) throw { status_code: 401, body: '请先登录' }

      const visibility = upload.metadata?.visibility
      if (visibility !== 'SHARED' && visibility !== 'PRIVATE') {
        throw { status_code: 400, body: '可见范围无效' }
      }
      const freeBytes = storageStats(config).freeBytes
      if (freeBytes < (upload.size ?? 0) + 512 * 1024 * 1024) {
        throw { status_code: 507, body: '磁盘剩余空间不足，已停止接收新文件' }
      }

      return {
        metadata: {
          ...upload.metadata,
          ownerId: user.id,
          assetId: randomUUID(),
          filename: cleanOriginalName(upload.metadata?.filename),
          visibility,
        },
      }
    },
    async onUploadFinish(_request, upload) {
      const ownerId = upload.metadata?.ownerId
      const assetId = upload.metadata?.assetId
      const visibility = upload.metadata?.visibility as AssetVisibility | undefined
      const filename = cleanOriginalName(upload.metadata?.filename)
      const storedPath = upload.storage?.path
      if (!ownerId || !assetId || !visibility || !storedPath || !validUploadId(upload.id)) {
        throw { status_code: 400, body: '上传元数据不完整' }
      }

      await mkdir(resultsDirectory, { recursive: true })
      try {
        const existing = JSON.parse(await readFile(resultPath(upload.id), 'utf8')) as TusResult
        if (existing.ownerId === ownerId && existing.assetId === assetId) return {}
      } catch {
        // No completed result exists yet.
      }

      const tusRoot = path.resolve(tusDirectory)
      const resolvedStoredPath = path.resolve(storedPath)
      if (!resolvedStoredPath.startsWith(`${tusRoot}${path.sep}`)) {
        throw { status_code: 400, body: '上传文件路径无效' }
      }

      await mkdir(finalizingDirectory, { recursive: true })
      const finalizingPath = path.join(finalizingDirectory, `${upload.id}.upload`)
      await copyFile(resolvedStoredPath, finalizingPath)
      try {
        const savedUpload = await inspectStoredUpload(finalizingPath)
        await ingestSingleAsset({
          database,
          config,
          userId: ownerId,
          visibility,
          originalName: filename,
          upload: savedUpload,
          assetId,
        })
        await writeFile(resultPath(upload.id), JSON.stringify({ assetId, ownerId } satisfies TusResult))
      } catch (error) {
        await rm(finalizingPath, { force: true })
        const message = error instanceof Error ? error.message : '上传处理失败'
        throw { status_code: message === '不支持的文件格式' ? 415 : 500, body: message }
      }

      return {}
    },
  })

  return {
    server,
    async result(uploadId: string, userId: string): Promise<string | null> {
      if (!validUploadId(uploadId)) return null
      try {
        const result = JSON.parse(await readFile(resultPath(uploadId), 'utf8')) as TusResult
        return result.ownerId === userId ? result.assetId : null
      } catch {
        return null
      }
    },
    async clean(uploadId: string): Promise<void> {
      if (!validUploadId(uploadId)) return
      try {
        await store.remove(uploadId)
      } catch {
        // The completed upload may already have been cleaned.
      }
    },
  }
}
