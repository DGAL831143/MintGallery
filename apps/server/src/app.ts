import { randomUUID } from 'node:crypto'
import { existsSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import staticFiles from '@fastify/static'
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import {
  SESSION_COOKIE,
  SESSION_DURATION_MS,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  publicUser,
  verifyPassword,
  type SessionUser,
} from './auth.js'
import { ingestLivePhotoAsset, ingestSingleAsset } from './asset-ingest.js'
import { loadConfig, type AppConfig } from './config.js'
import { openDatabase } from './db.js'
import { createResumableUploads } from './resumable.js'
import {
  backfillLivePhotoDerivatives,
} from './live-photo.js'
import { backfillShootingTimes, extractShootingTime } from './metadata.js'
import { importExternalFolderCandidates, scanExternalFolder } from './folder-import.js'
import {
  createEditedImageDerivatives,
  createReadStream,
  discardTemporaryUpload,
  ensureStorageDirectories,
  fileSize,
  receiveUpload,
  resolveStoragePath,
  storageStats,
  toRelativeStoragePath,
  type ImageEditOperations,
  type SavedUpload,
} from './storage.js'

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: SessionUser | null
  }
}

interface CreateAppOptions {
  config?: Partial<AppConfig>
  logger?: boolean
}

interface UserRow {
  id: string
  username: string
  password_hash: string
  role: string
  status: string
  must_change_password: number
  created_at: number
}

interface AssetRow {
  id: string
  owner_id: string
  owner_name: string
  type: 'IMAGE' | 'VIDEO' | 'LIVE_PHOTO'
  visibility: 'SHARED' | 'PRIVATE'
  privacy_masked: number
  favorite: number
  tags: string
  status: 'PROCESSING' | 'READY' | 'FAILED'
  original_name: string
  mime_type: string
  size_bytes: number
  width: number | null
  height: number | null
  duration_ms: number | null
  shooting_time: number | null
  uploaded_at: number
  deleted_at: number | null
  deleted_by: string | null
  sort_time?: number
  processing_error: string | null
  original_file_id: string
  live_original_file_id: string | null
  live_video_file_id: string | null
  thumbnail_file_id: string | null
  preview_file_id: string | null
  active_edit_id: string | null
  active_edit_created_at: number | null
  active_edit_width: number | null
  active_edit_height: number | null
}

interface MediaRow {
  id: string
  kind: string
  relative_path: string
  mime_type: string
  size_bytes: number
  asset_id: string
  owner_id: string
  visibility: 'SHARED' | 'PRIVATE'
  deleted_at: number | null
  original_name: string
}

type GalleryFilter = 'ALL' | 'FAVORITES' | 'DELETED'
type MediaTypeFilter = 'ALL' | AssetRow['type']
type SmartFilter =
  | 'ALL'
  | 'RECENT_IMPORTS'
  | 'UNTAGGED'
  | 'PRIVACY_MASKED'
  | 'TODAY_IN_HISTORY'
  | 'THIS_MONTH_HISTORY'

interface FeaturedCollectionDefinition {
  id: 'TODAY_IN_HISTORY' | 'THIS_MONTH_HISTORY'
  title: string
  subtitle: string
  filter: GalleryFilter
  mediaType: MediaTypeFilter
  smartFilter: SmartFilter
}

const featuredCollectionDefinitions: FeaturedCollectionDefinition[] = [
  {
    id: 'TODAY_IN_HISTORY',
    title: '今日往年',
    subtitle: '往年同一天拍摄',
    filter: 'ALL',
    mediaType: 'ALL',
    smartFilter: 'TODAY_IN_HISTORY',
  },
  {
    id: 'THIS_MONTH_HISTORY',
    title: '回忆',
    subtitle: '往年同月拍摄',
    filter: 'ALL',
    mediaType: 'ALL',
    smartFilter: 'THIS_MONTH_HISTORY',
  },
]

function cleanUsername(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function validUsername(username: string): boolean {
  return /^[\p{L}\p{N}_-]{2,32}$/u.test(username)
}

function validPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128
}

function cleanOriginalName(filename: string): string {
  return path.basename(filename).replace(/[\u0000-\u001f]/g, '').slice(0, 255) || '未命名文件'
}

function fileBaseName(filename: string): string {
  return path.parse(filename).name.normalize('NFC').toLocaleLowerCase()
}

function cleanFolderName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const name = value.trim().normalize('NFC')
  return name.length <= 40 && !/[\u0000-\u001f]/.test(name) ? name : ''
}

function validVisibility(value: unknown): value is 'SHARED' | 'PRIVATE' {
  return value === 'SHARED' || value === 'PRIVATE'
}

function validGalleryFilter(value: unknown): value is GalleryFilter {
  return value === 'ALL' || value === 'FAVORITES' || value === 'DELETED'
}

function validMediaTypeFilter(value: unknown): value is MediaTypeFilter {
  return value === 'ALL' || value === 'IMAGE' || value === 'VIDEO' || value === 'LIVE_PHOTO'
}

function validSmartFilter(value: unknown): value is SmartFilter {
  return value === 'ALL' ||
    value === 'RECENT_IMPORTS' ||
    value === 'UNTAGGED' ||
    value === 'PRIVACY_MASKED' ||
    value === 'TODAY_IN_HISTORY' ||
    value === 'THIS_MONTH_HISTORY'
}

function sortExpressionFor(filter: GalleryFilter, smartFilter: SmartFilter): string {
  if (filter === 'DELETED') return 'a.deleted_at'
  if (smartFilter === 'RECENT_IMPORTS') return 'a.uploaded_at'
  return 'COALESCE(a.shooting_time, a.uploaded_at)'
}

function addSmartFilterCondition(
  smartFilter: SmartFilter,
  conditions: string[],
  parameters: Array<string | number>,
  now = Date.now(),
): void {
  if (smartFilter === 'UNTAGGED') {
    conditions.push("a.tags = '[]'")
  }
  if (smartFilter === 'PRIVACY_MASKED') {
    conditions.push('a.privacy_masked = 1')
  }
  if (smartFilter === 'TODAY_IN_HISTORY') {
    conditions.push('a.shooting_time IS NOT NULL')
    conditions.push(`
      strftime('%m-%d', a.shooting_time / 1000, 'unixepoch', 'localtime') =
      strftime('%m-%d', ? / 1000, 'unixepoch', 'localtime')
    `)
    conditions.push(`
      strftime('%Y', a.shooting_time / 1000, 'unixepoch', 'localtime') <
      strftime('%Y', ? / 1000, 'unixepoch', 'localtime')
    `)
    parameters.push(now, now)
  }
  if (smartFilter === 'THIS_MONTH_HISTORY') {
    conditions.push('a.shooting_time IS NOT NULL')
    conditions.push(`
      strftime('%m', a.shooting_time / 1000, 'unixepoch', 'localtime') =
      strftime('%m', ? / 1000, 'unixepoch', 'localtime')
    `)
    conditions.push(`
      strftime('%Y', a.shooting_time / 1000, 'unixepoch', 'localtime') <
      strftime('%Y', ? / 1000, 'unixepoch', 'localtime')
    `)
    parameters.push(now, now)
  }
}

function cleanSearchQuery(value: unknown): string {
  return typeof value === 'string' ? value.trim().normalize('NFC').slice(0, 80) : ''
}

function cleanTag(value: unknown): string {
  if (typeof value !== 'string') return ''
  const tag = value
    .trim()
    .normalize('NFC')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 24)
  return tag.length > 0 ? tag : ''
}

function cleanTags(value: unknown): string[] {
  const rawTags = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，\n]/)
      : []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const rawTag of rawTags) {
    const tag = cleanTag(rawTag)
    const key = tag.toLocaleLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= 10) break
  }
  return tags
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return cleanTags(parsed)
  } catch {
    return []
  }
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`
}

function addSearchCondition(
  conditions: string[],
  parameters: Array<string | number>,
  rawQuery: unknown,
): void {
  const query = cleanSearchQuery(rawQuery)
  if (!query) return

  const pattern = likePattern(query)
  const normalized = query.toLocaleLowerCase()
  const typeMatches: Array<AssetRow['type']> = []
  if (['image', 'photo', '照片', '图片'].some((term) => normalized.includes(term))) {
    typeMatches.push('IMAGE')
  }
  if (['video', '视频'].some((term) => normalized.includes(term))) {
    typeMatches.push('VIDEO')
  }
  if (['live', '实况', 'live photo'].some((term) => normalized.includes(term))) {
    typeMatches.push('LIVE_PHOTO')
  }

  const parts = [
    "a.tags LIKE ? ESCAPE '\\'",
    "a.original_name LIKE ? ESCAPE '\\'",
    "u.username LIKE ? ESCAPE '\\'",
  ]
  parameters.push(pattern, pattern, pattern)
  if (typeMatches.length > 0) {
    parts.push(`a.type IN (${typeMatches.map(() => '?').join(', ')})`)
    parameters.push(...typeMatches)
  }
  conditions.push(`(${parts.join(' OR ')})`)
}

function cleanAssetIds(value: unknown, max = 100): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, max)
}

function recordBody(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeEditOperations(value: unknown): ImageEditOperations | null {
  const body = recordBody(value) ?? {}
  const rawCrop = recordBody(body.crop) ?? {}
  const crop = {
    x: numberOrDefault(rawCrop.x, 0),
    y: numberOrDefault(rawCrop.y, 0),
    width: numberOrDefault(rawCrop.width, 1),
    height: numberOrDefault(rawCrop.height, 1),
  }
  if (
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > 1.000001 ||
    crop.y + crop.height > 1.000001
  ) {
    return null
  }

  const rotate = numberOrDefault(body.rotate, 0)
  if (rotate !== 0 && rotate !== 90 && rotate !== 180 && rotate !== 270) return null

  return {
    crop,
    rotate: rotate as ImageEditOperations['rotate'],
    flipX: typeof body.flipX === 'boolean' ? body.flipX : false,
    flipY: typeof body.flipY === 'boolean' ? body.flipY : false,
  }
}

function canReadAsset(user: SessionUser, row: AssetRow): boolean {
  if (row.deleted_at !== null && user.role !== 'ADMIN' && row.owner_id !== user.id) return false
  return user.role === 'ADMIN' || row.visibility === 'SHARED' || row.owner_id === user.id
}

function canManageAsset(user: SessionUser, row: AssetRow): boolean {
  return user.role === 'ADMIN' || row.owner_id === user.id
}

function onlyFavoriteChange(body: Record<string, unknown> | undefined): boolean {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'favorite')) return false
  return Object.keys(body).every((key) => key === 'assetIds' || key === 'favorite')
}

const assetFileColumns = `
  (SELECT id FROM asset_files
    WHERE asset_id = a.id
      AND kind = CASE WHEN a.type = 'VIDEO' THEN 'ORIGINAL_VIDEO' ELSE 'ORIGINAL_IMAGE' END
    LIMIT 1) AS original_file_id,
  (SELECT id FROM asset_files
    WHERE asset_id = a.id AND kind = 'ORIGINAL_VIDEO' AND a.type = 'LIVE_PHOTO'
    LIMIT 1) AS live_original_file_id,
  COALESCE(
    (SELECT id FROM asset_files
      WHERE asset_id = a.id AND kind = 'LIVE_PREVIEW' AND a.type = 'LIVE_PHOTO' LIMIT 1),
    (SELECT id FROM asset_files
      WHERE asset_id = a.id AND kind = 'ORIGINAL_VIDEO' AND a.type = 'LIVE_PHOTO' LIMIT 1)
  ) AS live_video_file_id,
  COALESCE(
    (SELECT thumbnail_file_id FROM asset_edits
      WHERE asset_id = a.id AND active = 1 ORDER BY created_at DESC LIMIT 1),
    (SELECT id FROM asset_files
      WHERE asset_id = a.id AND kind = 'THUMBNAIL' LIMIT 1)
  ) AS thumbnail_file_id,
  COALESCE(
    (SELECT preview_file_id FROM asset_edits
      WHERE asset_id = a.id AND active = 1 ORDER BY created_at DESC LIMIT 1),
    (SELECT id FROM asset_files
      WHERE asset_id = a.id AND kind = 'PREVIEW' LIMIT 1)
  ) AS preview_file_id,
  (SELECT id FROM asset_edits
    WHERE asset_id = a.id AND active = 1 ORDER BY created_at DESC LIMIT 1) AS active_edit_id,
  (SELECT created_at FROM asset_edits
    WHERE asset_id = a.id AND active = 1 ORDER BY created_at DESC LIMIT 1) AS active_edit_created_at,
  (SELECT width FROM asset_edits
    WHERE asset_id = a.id AND active = 1 ORDER BY created_at DESC LIMIT 1) AS active_edit_width,
  (SELECT height FROM asset_edits
    WHERE asset_id = a.id AND active = 1 ORDER BY created_at DESC LIMIT 1) AS active_edit_height
`

function sessionUser(database: DatabaseSync, token: string | undefined): SessionUser | null {
  if (!token) return null

  const row = database
    .prepare(`
      SELECT u.id, u.username, u.role, u.status, u.must_change_password
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'ACTIVE'
    `)
    .get(hashSessionToken(token), Date.now()) as UserRow | undefined

  return row ? publicUser(row) : null
}

function setSessionCookie(reply: FastifyReply, token: string, config: AppConfig): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: SESSION_DURATION_MS / 1000,
  })
}

function serializeAsset(row: AssetRow) {
  const mediaUrl = (id: string | null) => (id ? `/api/media/${id}` : null)
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    type: row.type,
    visibility: row.visibility,
    privacyMasked: row.privacy_masked === 1,
    favorite: row.favorite === 1,
    tags: parseTags(row.tags),
    status: row.status,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.active_edit_width ?? row.width,
    height: row.active_edit_height ?? row.height,
    durationMs: row.duration_ms,
    shootingTime: row.shooting_time === null ? null : new Date(row.shooting_time).toISOString(),
    uploadedAt: new Date(row.uploaded_at).toISOString(),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at).toISOString(),
    processingError: row.processing_error,
    originalUrl: mediaUrl(row.original_file_id),
    liveOriginalUrl: mediaUrl(row.live_original_file_id),
    liveVideoUrl: mediaUrl(row.live_video_file_id),
    thumbnailUrl: mediaUrl(row.thumbnail_file_id),
    previewUrl: mediaUrl(row.preview_file_id),
    edited: row.active_edit_id !== null,
    editedAt: row.active_edit_created_at === null ? null : new Date(row.active_edit_created_at).toISOString(),
    backupStatus: 'NOT_CONFIGURED' as const,
  }
}

function findAsset(database: DatabaseSync, assetId: string): AssetRow | undefined {
  return database
    .prepare(`
      SELECT a.*, COALESCE(a.shooting_time, a.uploaded_at) AS sort_time,
        u.username AS owner_name,
        ${assetFileColumns}
      FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.id = ?
    `)
    .get(assetId) as unknown as AssetRow | undefined
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig(options.config)
  ensureStorageDirectories(config)
  const database = openDatabase(config.databasePath)
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 2 * 1024 * 1024 * 1024,
  })

  await app.register(cookie)
  await app.register(multipart, {
    limits: {
      files: 2,
      fileSize: 2 * 1024 * 1024 * 1024,
      fields: 5,
    },
  })
  app.addContentTypeParser(
    'application/offset+octet-stream',
    (_request, _payload, done) => done(null),
  )

  const resumableUploads = createResumableUploads(database, config)

  app.decorateRequest('currentUser', null)

  const requireUser = async (request: FastifyRequest, reply: FastifyReply) => {
    request.currentUser = sessionUser(database, request.cookies[SESSION_COOKIE])
    if (!request.currentUser) {
      return reply.code(401).send({ message: '请先登录' })
    }
  }

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    await requireUser(request, reply)
    if (reply.sent) return
    if (request.currentUser?.role !== 'ADMIN') {
      return reply.code(403).send({ message: '仅管理员可以执行此操作' })
    }
  }

  app.get('/api/health', async () => ({ ok: true, version: '1.0.1' }))

  app.get('/api/bootstrap/status', async () => {
    const row = database.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    return { needsSetup: row.count === 0 }
  })

  app.post('/api/bootstrap', async (request, reply) => {
    const existing = database.prepare('SELECT COUNT(*) AS count FROM users').get() as {
      count: number
    }
    if (existing.count > 0) {
      return reply.code(409).send({ message: '初始化已经完成' })
    }

    const body = request.body as { username?: unknown; password?: unknown }
    const username = cleanUsername(body?.username)
    if (!validUsername(username)) {
      return reply.code(400).send({ message: '用户名需为 2 到 32 个汉字、字母、数字、下划线或短横线' })
    }
    if (!validPassword(body?.password)) {
      return reply.code(400).send({ message: '密码长度需为 8 到 128 个字符' })
    }

    const userId = randomUUID()
    const passwordHash = await hashPassword(body.password)
    database
      .prepare(`
        INSERT INTO users (
          id, username, password_hash, role, status, must_change_password, created_at
        ) VALUES (?, ?, ?, 'ADMIN', 'ACTIVE', 0, ?)
      `)
      .run(userId, username, passwordHash, Date.now())

    const token = createSessionToken()
    database
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(hashSessionToken(token), userId, Date.now() + SESSION_DURATION_MS, Date.now())
    setSessionCookie(reply, token, config)

    return reply.code(201).send({
      user: { id: userId, username, role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false },
    })
  })

  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as { username?: unknown; password?: unknown }
    const username = cleanUsername(body?.username)
    const password = body?.password
    const row = database
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as UserRow | undefined

    if (!row || row.status !== 'ACTIVE' || typeof password !== 'string') {
      return reply.code(401).send({ message: '账号或密码不正确' })
    }
    if (!(await verifyPassword(password, row.password_hash))) {
      return reply.code(401).send({ message: '账号或密码不正确' })
    }

    database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
    const token = createSessionToken()
    database
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(hashSessionToken(token), row.id, Date.now() + SESSION_DURATION_MS, Date.now())
    setSessionCookie(reply, token, config)
    return { user: publicUser(row) }
  })

  app.get('/api/auth/me', { preHandler: requireUser }, async (request) => ({
    user: request.currentUser,
  }))

  app.post('/api/auth/logout', { preHandler: requireUser }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashSessionToken(token))
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.code(204).send()
  })

  app.post('/api/auth/change-password', { preHandler: requireUser }, async (request, reply) => {
    const body = request.body as { currentPassword?: unknown; newPassword?: unknown }
    if (typeof body?.currentPassword !== 'string' || !validPassword(body?.newPassword)) {
      return reply.code(400).send({ message: '请提供当前密码，新密码至少需要 8 个字符' })
    }

    const row = database
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(request.currentUser!.id) as unknown as UserRow
    if (!(await verifyPassword(body.currentPassword, row.password_hash))) {
      return reply.code(400).send({ message: '当前密码不正确' })
    }

    database
      .prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(await hashPassword(body.newPassword), row.id)
    return { ok: true }
  })

  app.get('/api/users', { preHandler: requireAdmin }, async () => {
    const rows = database
      .prepare(`
        SELECT id, username, role, status, must_change_password, created_at
        FROM users ORDER BY created_at ASC
      `)
      .all() as unknown as UserRow[]

    return {
      users: rows.map((row) => ({
        ...publicUser(row),
        createdAt: new Date(row.created_at).toISOString(),
      })),
    }
  })

  app.post('/api/users', { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as { username?: unknown; temporaryPassword?: unknown }
    const username = cleanUsername(body?.username)
    if (!validUsername(username) || !validPassword(body?.temporaryPassword)) {
      return reply.code(400).send({ message: '请提供有效用户名和至少 8 个字符的临时密码' })
    }

    try {
      const id = randomUUID()
      database
        .prepare(`
          INSERT INTO users (
            id, username, password_hash, role, status, must_change_password, created_at
          ) VALUES (?, ?, ?, 'MEMBER', 'ACTIVE', 1, ?)
        `)
        .run(id, username, await hashPassword(body.temporaryPassword), Date.now())
      return reply.code(201).send({ id, username })
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        return reply.code(409).send({ message: '该用户名已经存在' })
      }
      throw error
    }
  })

  app.patch('/api/users/:id/status', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as { status?: unknown }
    if (body?.status !== 'ACTIVE' && body?.status !== 'DISABLED') {
      return reply.code(400).send({ message: '账号状态无效' })
    }
    if (id === request.currentUser!.id && body.status === 'DISABLED') {
      return reply.code(400).send({ message: '不能停用当前管理员账号' })
    }

    const result = database.prepare('UPDATE users SET status = ? WHERE id = ?').run(body.status, id)
    if (result.changes === 0) return reply.code(404).send({ message: '用户不存在' })
    if (body.status === 'DISABLED') {
      database.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
    }
    return { ok: true }
  })

  app.get('/api/admin/stats', { preHandler: requireAdmin }, async () => {
    const disk = storageStats(config)
    const assets = database
      .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM assets')
      .get() as { count: number; bytes: number }
    return { disk, assets: { count: assets.count, originalBytes: assets.bytes } }
  })

  app.post('/api/imports/folder/scan', { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as { path?: unknown } | undefined
    try {
      return await scanExternalFolder({
        database,
        config,
        directoryPath: body?.path,
      })
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : '文件夹扫描失败',
      })
    }
  })

  app.post('/api/imports/folder/import', { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as {
      path?: unknown
      visibility?: unknown
      candidateIds?: unknown
      includeDuplicates?: unknown
    } | undefined
    const visibility = body?.visibility ?? 'SHARED'
    if (visibility !== 'SHARED' && visibility !== 'PRIVATE') {
      return reply.code(400).send({ message: '可见范围无效' })
    }
    if (storageStats(config).freeBytes < 512 * 1024 * 1024) {
      return reply.code(507).send({ message: '磁盘剩余空间不足，已停止导入新文件' })
    }

    try {
      return await importExternalFolderCandidates({
        database,
        config,
        userId: request.currentUser!.id,
        visibility,
        directoryPath: body?.path,
        candidateIds: body?.candidateIds,
        includeDuplicates: body?.includeDuplicates === true,
        onLivePreviewError: (assetId, error) => {
          request.log.warn({ error, assetId }, 'Imported Live Photo web derivative failed')
        },
      })
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : '文件夹导入失败',
      })
    }
  })

  app.get('/api/folders', { preHandler: requireUser }, async (request) => {
    const rows = database.prepare(`
      SELECT f.id, f.name, f.created_at, COUNT(a.id) AS item_count
      FROM folders f
      LEFT JOIN folder_assets fa ON fa.folder_id = f.id
      LEFT JOIN assets a ON a.id = fa.asset_id AND a.deleted_at IS NULL
      WHERE f.owner_id = ?
      GROUP BY f.id
      ORDER BY f.name COLLATE NOCASE, f.created_at
    `).all(request.currentUser!.id) as Array<{
      id: string
      name: string
      created_at: number
      item_count: number
    }>
    return {
      folders: rows.map((row) => ({
        id: row.id,
        name: row.name,
        itemCount: row.item_count,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    }
  })

  app.post('/api/folders', { preHandler: requireUser }, async (request, reply) => {
    const body = request.body as { name?: unknown } | undefined
    const name = cleanFolderName(body?.name)
    if (!name) return reply.code(400).send({ message: '文件夹名称需为 1 到 40 个字符' })
    const id = randomUUID()
    const createdAt = Date.now()
    try {
      database.prepare('INSERT INTO folders (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)')
        .run(id, request.currentUser!.id, name, createdAt)
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ message: '已经存在同名文件夹' })
      }
      throw error
    }
    return reply.code(201).send({
      folder: { id, name, itemCount: 0, createdAt: new Date(createdAt).toISOString() },
    })
  })

  app.delete('/api/folders/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = database.prepare('DELETE FROM folders WHERE id = ? AND owner_id = ?')
      .run(id, request.currentUser!.id)
    if (result.changes === 0) return reply.code(404).send({ message: '文件夹不存在' })
    return { ok: true }
  })

  const updateFolderAssets = async (
    request: FastifyRequest,
    reply: FastifyReply,
    remove: boolean,
  ) => {
    const { id } = request.params as { id: string }
    const folder = database.prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ?')
      .get(id, request.currentUser!.id)
    if (!folder) return reply.code(404).send({ message: '文件夹不存在' })
    const body = request.body as { assetIds?: unknown } | undefined
    if (!Array.isArray(body?.assetIds)) {
      return reply.code(400).send({ message: '请选择需要整理的照片' })
    }
    const assetIds = [...new Set(body.assetIds.filter((value): value is string => typeof value === 'string'))]
    if (assetIds.length === 0 || assetIds.length > 100) {
      return reply.code(400).send({ message: '每次请选择 1 到 100 个项目' })
    }

    if (!remove) {
      const placeholders = assetIds.map(() => '?').join(', ')
      const visibility = "(visibility = 'SHARED' OR owner_id = ?)"
      const parameters = [request.currentUser!.id, ...assetIds]
      const allowed = database.prepare(`
        SELECT id FROM assets
        WHERE ${visibility} AND deleted_at IS NULL AND id IN (${placeholders})
      `).all(...parameters) as Array<{ id: string }>
      if (allowed.length !== assetIds.length) {
        return reply.code(403).send({ message: '部分照片不存在或当前账号无权访问' })
      }
    }

    database.exec('BEGIN')
    try {
      const statement = remove
        ? database.prepare('DELETE FROM folder_assets WHERE folder_id = ? AND asset_id = ?')
        : database.prepare(`
            INSERT OR IGNORE INTO folder_assets (folder_id, asset_id, added_at) VALUES (?, ?, ?)
          `)
      let changed = 0
      for (const assetId of assetIds) {
        const result = remove
          ? statement.run(id, assetId)
          : statement.run(id, assetId, Date.now())
        changed += Number(result.changes)
      }
      database.exec('COMMIT')
      return { ok: true, changed }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  app.post('/api/folders/:id/assets', { preHandler: requireUser }, async (request, reply) =>
    updateFolderAssets(request, reply, false))
  app.delete('/api/folders/:id/assets', { preHandler: requireUser }, async (request, reply) =>
    updateFolderAssets(request, reply, true))

  const resumableHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.hijack()
    await resumableUploads.server.handle(request.raw, reply.raw)
  }
  app.all('/api/uploads/resumable', resumableHandler)
  app.all('/api/uploads/resumable/:uploadId', resumableHandler)

  app.get(
    '/api/uploads/resumable/:uploadId/result',
    { preHandler: requireUser },
    async (request, reply) => {
      const { uploadId } = request.params as { uploadId: string }
      const assetId = await resumableUploads.result(uploadId, request.currentUser!.id)
      if (!assetId) return reply.code(404).send({ message: '上传结果不存在或尚未完成' })

      const asset = findAsset(database, assetId)
      if (!asset) return reply.code(404).send({ message: '照片记录不存在' })
      await resumableUploads.clean(uploadId)
      return { asset: serializeAsset(asset) }
    },
  )

  app.post('/api/assets', { preHandler: requireUser }, async (request, reply) => {
    const { visibility = 'SHARED' } = request.query as { visibility?: string }
    if (visibility !== 'SHARED' && visibility !== 'PRIVATE') {
      return reply.code(400).send({ message: '可见范围无效' })
    }
    if (storageStats(config).freeBytes < 512 * 1024 * 1024) {
      return reply.code(507).send({ message: '磁盘剩余空间不足，已停止接收新文件' })
    }

    const part = await request.file()
    if (!part) return reply.code(400).send({ message: '请选择一个文件' })

    const upload = await receiveUpload(part.file, config)
    if (part.file.truncated) {
      discardTemporaryUpload(upload)
      return reply.code(413).send({ message: '文件超过 2 GB 限制' })
    }

    const originalName = cleanOriginalName(part.filename)
    const assetId = await ingestSingleAsset({
      database,
      config,
      userId: request.currentUser!.id,
      visibility,
      originalName,
      upload,
    })
    const created = findAsset(database, assetId)!

    return reply.code(201).send({ asset: serializeAsset(created) })
  })

  app.post('/api/assets/live-photo', { preHandler: requireUser }, async (request, reply) => {
    const { visibility = 'SHARED' } = request.query as { visibility?: string }
    if (visibility !== 'SHARED' && visibility !== 'PRIVATE') {
      return reply.code(400).send({ message: '可见范围无效' })
    }
    if (storageStats(config).freeBytes < 512 * 1024 * 1024) {
      return reply.code(507).send({ message: '磁盘剩余空间不足，已停止接收新文件' })
    }

    const received: Array<{ upload: SavedUpload; originalName: string }> = []
    try {
      for await (const part of request.files()) {
        const upload = await receiveUpload(part.file, config)
        if (part.file.truncated) {
          discardTemporaryUpload(upload)
          const fileTooLargeError = new Error('文件超过 2 GB 限制') as Error & { statusCode: number }
          fileTooLargeError.statusCode = 413
          throw fileTooLargeError
        }
        received.push({ upload, originalName: cleanOriginalName(part.filename) })
      }
    } catch (error) {
      for (const item of received) discardTemporaryUpload(item.upload)
      throw error
    }

    const stillMimeTypes = new Set(['image/jpeg', 'image/heic', 'image/heif'])
    const photo = received.find((item) => stillMimeTypes.has(item.upload.mimeType))
    const video = received.find((item) => item.upload.mimeType === 'video/quicktime')
    const validPair = received.length === 2 && photo && video && photo !== video

    if (!validPair) {
      for (const item of received) discardTemporaryUpload(item.upload)
      return reply.code(400).send({
        message: '实况照片必须包含一张 HEIC/HEIF/JPEG 图片和一个 MOV 视频',
      })
    }
    if (fileBaseName(photo.originalName) !== fileBaseName(video.originalName)) {
      for (const item of received) discardTemporaryUpload(item.upload)
      return reply.code(400).send({
        message: '图片和 MOV 的主文件名需要相同，例如 IMG_1234.HEIC + IMG_1234.MOV',
      })
    }

    const assetId = await ingestLivePhotoAsset({
      database,
      config,
      userId: request.currentUser!.id,
      visibility,
      photoOriginalName: photo.originalName,
      videoOriginalName: video.originalName,
      photoUpload: photo.upload,
      videoUpload: video.upload,
      onLivePreviewError: (createdAssetId, error) => {
        request.log.warn({ error, assetId: createdAssetId }, 'Live Photo web derivative failed')
      },
    })

    const created = database
      .prepare(`
        SELECT a.*, u.username AS owner_name,
          ${assetFileColumns}
        FROM assets a JOIN users u ON u.id = a.owner_id WHERE a.id = ?
      `)
      .get(assetId) as unknown as AssetRow

    return reply.code(201).send({ asset: serializeAsset(created) })
  })

  app.post('/api/assets/:id/edit', { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = findAsset(database, id)
    if (!existing) return reply.code(404).send({ message: '照片不存在' })
    if (!canManageAsset(request.currentUser!, existing)) {
      return reply.code(403).send({ message: '只能编辑自己上传的照片' })
    }
    if (existing.deleted_at !== null) {
      return reply.code(409).send({ message: '回收站中的照片不能编辑' })
    }
    if (existing.status !== 'READY') {
      return reply.code(409).send({ message: '照片仍在处理或处理失败，暂时不能编辑' })
    }
    if (existing.type === 'VIDEO') {
      return reply.code(400).send({ message: '视频暂不支持网页编辑' })
    }

    const operations = normalizeEditOperations(request.body)
    if (!operations) {
      return reply.code(400).send({ message: '编辑参数无效' })
    }

    const original = database
      .prepare(`
        SELECT relative_path
        FROM asset_files
        WHERE asset_id = ? AND kind = 'ORIGINAL_IMAGE'
        LIMIT 1
      `)
      .get(id) as { relative_path: string } | undefined
    if (!original) return reply.code(404).send({ message: '原始图片文件不存在' })

    const originalPath = resolveStoragePath(config, original.relative_path)
    if (!existsSync(originalPath)) {
      return reply.code(404).send({ message: '磁盘原始图片不存在' })
    }

    const editId = randomUUID()
    const derivatives = await createEditedImageDerivatives(originalPath, id, editId, operations, config)
    const editDirectory = path.dirname(derivatives.thumbnailPath)
    const thumbnailFileId = randomUUID()
    const previewFileId = randomUUID()
    const now = Date.now()

    database.exec('BEGIN')
    try {
      database.prepare('UPDATE asset_edits SET active = 0 WHERE asset_id = ? AND active = 1').run(id)
      const insertFile = database.prepare(`
        INSERT INTO asset_files (id, asset_id, kind, relative_path, mime_type, size_bytes)
        VALUES (?, ?, ?, ?, 'image/webp', ?)
      `)
      insertFile.run(
        thumbnailFileId,
        id,
        'EDIT_THUMBNAIL',
        toRelativeStoragePath(config, derivatives.thumbnailPath),
        fileSize(derivatives.thumbnailPath),
      )
      insertFile.run(
        previewFileId,
        id,
        'EDIT_PREVIEW',
        toRelativeStoragePath(config, derivatives.previewPath),
        fileSize(derivatives.previewPath),
      )
      database.prepare(`
        INSERT INTO asset_edits (
          id, asset_id, created_by, operations_json, thumbnail_file_id, preview_file_id,
          width, height, active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        editId,
        id,
        request.currentUser!.id,
        JSON.stringify(operations),
        thumbnailFileId,
        previewFileId,
        derivatives.width,
        derivatives.height,
        now,
      )
      database.exec('COMMIT')
    } catch (error) {
      try {
        database.exec('ROLLBACK')
      } catch {
        // Preserve the original database error if SQLite already rolled back.
      }
      rmSync(editDirectory, { recursive: true, force: true })
      throw error
    }

    const updated = findAsset(database, id)!
    return { asset: serializeAsset(updated) }
  })

  app.post('/api/assets/:id/edit/reset', { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = findAsset(database, id)
    if (!existing) return reply.code(404).send({ message: '照片不存在' })
    if (!canManageAsset(request.currentUser!, existing)) {
      return reply.code(403).send({ message: '只能编辑自己上传的照片' })
    }

    database.prepare('UPDATE asset_edits SET active = 0 WHERE asset_id = ? AND active = 1').run(id)
    const updated = findAsset(database, id)!
    return { asset: serializeAsset(updated) }
  })

  app.patch('/api/assets/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as {
      visibility?: unknown
      privacyMasked?: unknown
      favorite?: unknown
      tags?: unknown
      deleted?: unknown
    } | undefined
    const existing = findAsset(database, id)
    if (!existing) return reply.code(404).send({ message: '照片不存在' })
    const favoriteOnly = onlyFavoriteChange(body as Record<string, unknown> | undefined)
    if (favoriteOnly && !canReadAsset(request.currentUser!, existing)) {
      return reply.code(403).send({ message: '无权查看此照片' })
    }
    if (!favoriteOnly && !canManageAsset(request.currentUser!, existing)) {
      return reply.code(403).send({ message: '只能修改自己上传的照片' })
    }

    const updates: string[] = []
    const parameters: Array<string | number | null> = []
    if (body && Object.prototype.hasOwnProperty.call(body, 'visibility')) {
      if (!validVisibility(body.visibility)) return reply.code(400).send({ message: '可见范围无效' })
      updates.push('visibility = ?')
      parameters.push(body.visibility)
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'privacyMasked')) {
      if (typeof body.privacyMasked !== 'boolean') {
        return reply.code(400).send({ message: '隐私遮挡状态无效' })
      }
      updates.push('privacy_masked = ?')
      parameters.push(body.privacyMasked ? 1 : 0)
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'favorite')) {
      if (typeof body.favorite !== 'boolean') {
        return reply.code(400).send({ message: '收藏状态无效' })
      }
      updates.push('favorite = ?')
      parameters.push(body.favorite ? 1 : 0)
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'tags')) {
      const tags = cleanTags(body.tags)
      updates.push('tags = ?')
      parameters.push(JSON.stringify(tags))
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'deleted')) {
      if (typeof body.deleted !== 'boolean') {
        return reply.code(400).send({ message: '回收站状态无效' })
      }
      updates.push('deleted_at = ?')
      updates.push('deleted_by = ?')
      if (body.deleted) {
        parameters.push(Date.now(), request.currentUser!.id)
      } else {
        parameters.push(null, null)
      }
    }
    if (updates.length === 0) return reply.code(400).send({ message: '没有需要修改的内容' })

    database.prepare(`UPDATE assets SET ${updates.join(', ')} WHERE id = ?`).run(...parameters, id)
    const updated = findAsset(database, id)!
    return { asset: serializeAsset(updated) }
  })

  app.patch('/api/assets', { preHandler: requireUser }, async (request, reply) => {
    const body = request.body as {
      assetIds?: unknown
      visibility?: unknown
      privacyMasked?: unknown
      favorite?: unknown
      tags?: unknown
      deleted?: unknown
    } | undefined
    const assetIds = cleanAssetIds(body?.assetIds)
    if (assetIds.length === 0) return reply.code(400).send({ message: '请选择需要修改的照片' })

    const updates: string[] = []
    const updateParameters: Array<string | number | null> = []
    if (body && Object.prototype.hasOwnProperty.call(body, 'visibility')) {
      if (!validVisibility(body.visibility)) return reply.code(400).send({ message: '可见范围无效' })
      updates.push('visibility = ?')
      updateParameters.push(body.visibility)
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'privacyMasked')) {
      if (typeof body.privacyMasked !== 'boolean') {
        return reply.code(400).send({ message: '隐私遮挡状态无效' })
      }
      updates.push('privacy_masked = ?')
      updateParameters.push(body.privacyMasked ? 1 : 0)
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'favorite')) {
      if (typeof body.favorite !== 'boolean') {
        return reply.code(400).send({ message: '收藏状态无效' })
      }
      updates.push('favorite = ?')
      updateParameters.push(body.favorite ? 1 : 0)
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'tags')) {
      const tags = cleanTags(body.tags)
      updates.push('tags = ?')
      updateParameters.push(JSON.stringify(tags))
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'deleted')) {
      if (typeof body.deleted !== 'boolean') {
        return reply.code(400).send({ message: '回收站状态无效' })
      }
      updates.push('deleted_at = ?')
      updates.push('deleted_by = ?')
      if (body.deleted) {
        updateParameters.push(Date.now(), request.currentUser!.id)
      } else {
        updateParameters.push(null, null)
      }
    }
    if (updates.length === 0) return reply.code(400).send({ message: '没有需要修改的内容' })

    const placeholders = assetIds.map(() => '?').join(', ')
    const favoriteOnly = onlyFavoriteChange(body as Record<string, unknown> | undefined)
    const permissionGuard = favoriteOnly
      ? request.currentUser!.role === 'ADMIN'
        ? ' AND deleted_at IS NULL'
        : " AND deleted_at IS NULL AND (visibility = 'SHARED' OR owner_id = ?)"
      : request.currentUser!.role === 'ADMIN'
        ? ''
        : ' AND owner_id = ?'
    const permissionParameters = request.currentUser!.role === 'ADMIN'
      ? assetIds
      : [...assetIds, request.currentUser!.id]
    const rows = database
      .prepare(`SELECT id FROM assets WHERE id IN (${placeholders})${permissionGuard}`)
      .all(...permissionParameters) as Array<{ id: string }>
    if (rows.length !== assetIds.length) {
      return reply.code(403).send({
        message: favoriteOnly ? '部分照片不存在或无权收藏' : '只能修改自己上传的照片',
      })
    }

    database.prepare(`UPDATE assets SET ${updates.join(', ')} WHERE id IN (${placeholders})`)
      .run(...updateParameters, ...assetIds)
    const updatedRows = database.prepare(`
      SELECT a.*, COALESCE(a.shooting_time, a.uploaded_at) AS sort_time,
        u.username AS owner_name,
        ${assetFileColumns}
      FROM assets a
      JOIN users u ON u.id = a.owner_id
      WHERE a.id IN (${placeholders})
      ORDER BY sort_time DESC, a.id DESC
    `).all(...assetIds) as unknown as AssetRow[]
    return { assets: updatedRows.map(serializeAsset) }
  })

  app.get('/api/collections', { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as { scope?: string }
    const scope = query.scope ?? 'SHARED'
    if (scope !== 'SHARED' && scope !== 'PRIVATE') {
      return reply.code(400).send({ message: '相册范围无效' })
    }

    const now = Date.now()
    const collections = featuredCollectionDefinitions.map((definition) => {
      const conditions = scope === 'SHARED'
        ? ["a.visibility = 'SHARED'", 'a.deleted_at IS NULL']
        : ["a.visibility = 'PRIVATE'", 'a.owner_id = ?', 'a.deleted_at IS NULL']
      const parameters: Array<string | number> = scope === 'PRIVATE' ? [request.currentUser!.id] : []

      if (definition.filter === 'FAVORITES') {
        conditions.push('a.favorite = 1')
      }
      if (definition.mediaType !== 'ALL') {
        conditions.push('a.type = ?')
        parameters.push(definition.mediaType)
      }
      addSmartFilterCondition(definition.smartFilter, conditions, parameters, now)

      const countRow = database.prepare(`
        SELECT COUNT(*) AS total
        FROM assets a
        WHERE ${conditions.join(' AND ')}
      `).get(...parameters) as { total: number }
      const sortExpression = sortExpressionFor(definition.filter, definition.smartFilter)
      const coverRows = database.prepare(`
        SELECT a.*, ${sortExpression} AS sort_time,
          u.username AS owner_name,
          ${assetFileColumns}
        FROM assets a
        JOIN users u ON u.id = a.owner_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY
          CASE WHEN a.privacy_masked = 1 THEN 1 ELSE 0 END,
          a.favorite DESC,
          sort_time DESC,
          a.id DESC
        LIMIT 4
      `).all(...parameters) as unknown as AssetRow[]

      return {
        id: definition.id,
        title: definition.title,
        subtitle: definition.subtitle,
        count: countRow.total,
        filter: definition.filter,
        mediaType: definition.mediaType,
        smartFilter: definition.smartFilter,
        covers: coverRows.map(serializeAsset),
      }
    })

    return { collections }
  })

  app.get('/api/assets', { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as {
      scope?: string
      cursor?: string
      limit?: string
      folderId?: string
      month?: string
      q?: string
      filter?: string
      mediaType?: string
      smartFilter?: string
    }
    const scope = query.scope ?? 'SHARED'
    if (scope !== 'SHARED' && scope !== 'PRIVATE') {
      return reply.code(400).send({ message: '相册范围无效' })
    }
    const filter = query.filter ?? 'ALL'
    if (!validGalleryFilter(filter)) {
      return reply.code(400).send({ message: '图库筛选无效' })
    }
    const mediaType = query.mediaType ?? 'ALL'
    if (!validMediaTypeFilter(mediaType)) {
      return reply.code(400).send({ message: '媒体类型筛选无效' })
    }
    const smartFilter = query.smartFilter ?? 'ALL'
    if (!validSmartFilter(smartFilter)) {
      return reply.code(400).send({ message: '整理筛选无效' })
    }
    if (query.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)) {
      return reply.code(400).send({ message: '月份格式无效' })
    }

    const requestedLimit = Number(query.limit ?? 30)
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 60) : 30
    let cursor: [number, string] | null = null
    if (query.cursor) {
      try {
        const value = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))
        if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'string') {
          cursor = [value[0], value[1]]
        }
      } catch {
        return reply.code(400).send({ message: '分页游标无效' })
      }
    }

    const sortExpression = sortExpressionFor(filter, smartFilter)
    const conditions = filter === 'DELETED'
      ? ['a.deleted_at IS NOT NULL']
      : scope === 'SHARED'
        ? ["a.visibility = 'SHARED'", 'a.deleted_at IS NULL']
        : ["a.visibility = 'PRIVATE'", 'a.owner_id = ?', 'a.deleted_at IS NULL']
    const parameters: Array<string | number> = filter !== 'DELETED' && scope === 'PRIVATE'
      ? [request.currentUser!.id]
      : []
    if (filter === 'DELETED' && request.currentUser!.role !== 'ADMIN') {
      conditions.push('a.owner_id = ?')
      parameters.push(request.currentUser!.id)
    }
    if (filter === 'FAVORITES') {
      conditions.push('a.favorite = 1')
    }
    if (mediaType !== 'ALL') {
      conditions.push('a.type = ?')
      parameters.push(mediaType)
    }
    addSmartFilterCondition(smartFilter, conditions, parameters)
    if (query.folderId && filter !== 'DELETED') {
      const folder = database.prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ?')
        .get(query.folderId, request.currentUser!.id)
      if (!folder) return reply.code(404).send({ message: '文件夹不存在' })
      conditions.push(`EXISTS (
        SELECT 1 FROM folder_assets fa WHERE fa.folder_id = ? AND fa.asset_id = a.id
      )`)
      parameters.push(query.folderId)
    }
    if (query.month && filter !== 'DELETED') {
      const [year, month] = query.month.split('-').map(Number)
      const start = new Date(year!, month! - 1, 1).getTime()
      const end = new Date(year!, month!, 1).getTime()
      conditions.push(`${sortExpression} >= ?`)
      conditions.push(`${sortExpression} < ?`)
      parameters.push(start, end)
    }
    addSearchCondition(conditions, parameters, query.q)
    if (cursor) {
      conditions.push(`(
        ${sortExpression} < ? OR
        (${sortExpression} = ? AND a.id < ?)
      )`)
      parameters.push(cursor[0], cursor[0], cursor[1])
    }
    parameters.push(limit + 1)

    const rows = database
      .prepare(`
        SELECT a.*, ${sortExpression} AS sort_time,
          u.username AS owner_name,
          ${assetFileColumns}
        FROM assets a
        JOIN users u ON u.id = a.owner_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY sort_time DESC, a.id DESC
        LIMIT ?
      `)
      .all(...parameters) as unknown as AssetRow[]

    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    const last = page.at(-1)
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify([last.sort_time, last.id])).toString('base64url')
      : null

    return { assets: page.map(serializeAsset), nextCursor }
  })

  app.get('/api/timeline/months', { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as { scope?: string; folderId?: string; q?: string; filter?: string }
    const scope = query.scope ?? 'SHARED'
    if (scope !== 'SHARED' && scope !== 'PRIVATE') {
      return reply.code(400).send({ message: '相册范围无效' })
    }
    const filter = query.filter ?? 'ALL'
    if (!validGalleryFilter(filter)) {
      return reply.code(400).send({ message: '图库筛选无效' })
    }
    const timeExpression = filter === 'DELETED' ? 'a.deleted_at' : 'COALESCE(a.shooting_time, a.uploaded_at)'
    const conditions = filter === 'DELETED'
      ? ['a.deleted_at IS NOT NULL']
      : scope === 'SHARED'
        ? ["a.visibility = 'SHARED'", 'a.deleted_at IS NULL']
        : ["a.visibility = 'PRIVATE'", 'a.owner_id = ?', 'a.deleted_at IS NULL']
    const parameters: Array<string | number> = filter !== 'DELETED' && scope === 'PRIVATE'
      ? [request.currentUser!.id]
      : []
    if (filter === 'DELETED' && request.currentUser!.role !== 'ADMIN') {
      conditions.push('a.owner_id = ?')
      parameters.push(request.currentUser!.id)
    }
    if (filter === 'FAVORITES') {
      conditions.push('a.favorite = 1')
    }
    if (query.folderId && filter !== 'DELETED') {
      const folder = database.prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ?')
        .get(query.folderId, request.currentUser!.id)
      if (!folder) return reply.code(404).send({ message: '文件夹不存在' })
      conditions.push(`EXISTS (
        SELECT 1 FROM folder_assets fa WHERE fa.folder_id = ? AND fa.asset_id = a.id
      )`)
      parameters.push(query.folderId)
    }
    addSearchCondition(conditions, parameters, query.q)

    const rows = database.prepare(`
      SELECT
        strftime(
          '%Y-%m', ${timeExpression} / 1000,
          'unixepoch', 'localtime'
        ) AS month,
        COUNT(*) AS count
      FROM assets a
      JOIN users u ON u.id = a.owner_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY month
      ORDER BY month DESC
    `).all(...parameters) as Array<{ month: string; count: number }>
    return { months: rows }
  })

  app.get('/api/media/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = database
      .prepare(`
        SELECT f.*, a.owner_id, a.visibility, a.deleted_at, a.original_name
        FROM asset_files f JOIN assets a ON a.id = f.asset_id
        WHERE f.id = ?
      `)
      .get(id) as MediaRow | undefined

    if (!row) return reply.code(404).send({ message: '文件不存在' })
    const canRead =
      request.currentUser!.role === 'ADMIN' ||
      (row.deleted_at === null && row.visibility === 'SHARED') ||
      row.owner_id === request.currentUser!.id
    if (!canRead) return reply.code(403).send({ message: '无权查看此文件' })

    const filePath = resolveStoragePath(config, row.relative_path)
    if (!existsSync(filePath)) return reply.code(404).send({ message: '磁盘文件不存在' })

    const size = statSync(filePath).size
    const range = request.headers.range
    const etag = `"${row.id}-${size}"`
    reply.header('Cache-Control', 'private, max-age=604800, immutable')
    reply.header('ETag', etag)
    reply.header('Accept-Ranges', 'bytes')
    reply.type(row.mime_type)

    if (!range && request.headers['if-none-match'] === etag) {
      return reply.code(304).send()
    }

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match) return reply.code(416).send()
      const suffixLength = !match[1] && match[2] ? Number(match[2]) : null
      const start = suffixLength === null
        ? Number(match[1] ?? 0)
        : Math.max(size - suffixLength, 0)
      const end = suffixLength === null && match[2]
        ? Math.min(Number(match[2]), size - 1)
        : size - 1
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
        return reply.code(416).header('Content-Range', `bytes */${size}`).send()
      }
      reply.code(206)
      reply.header('Content-Range', `bytes ${start}-${end}/${size}`)
      reply.header('Content-Length', end - start + 1)
      return reply.send(createReadStream(filePath, { start, end }))
    }

    reply.header('Content-Length', size)
    return reply.send(createReadStream(filePath))
  })

  if (existsSync(path.join(config.webDistDirectory, 'index.html'))) {
    await app.register(staticFiles, { root: config.webDistDirectory, prefix: '/' })
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ message: '接口不存在' })
      }
      return reply.sendFile('index.html')
    })
  }

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error)
    const typedError = error as Error & { statusCode?: number }
    const statusCode = typedError.statusCode && typedError.statusCode >= 400 ? typedError.statusCode : 500
    const message = statusCode >= 500 ? '服务器处理请求时出现错误' : typedError.message
    reply.code(statusCode).send({ message })
  })

  const backfillPromise = Promise.all([
    backfillLivePhotoDerivatives(database, config, (assetId, error) => {
      app.log.warn({ error, assetId }, 'Live Photo derivative backfill failed')
    }).then((count) => {
      if (count > 0) app.log.info({ count }, 'Live Photo derivatives backfilled')
    }),
    backfillShootingTimes(database, config).then((result) => {
      if (result.scanned > 0) app.log.info(result, 'Shooting times backfilled')
    }),
  ]).catch((error) => {
    app.log.error({ error }, 'Media maintenance backfill could not start')
  })

  app.addHook('onClose', async () => {
    await backfillPromise
    database.close()
  })

  return app
}
