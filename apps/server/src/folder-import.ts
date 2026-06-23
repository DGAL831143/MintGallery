import { createHash } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { fileTypeFromFile } from 'file-type'
import type { AppConfig } from './config.js'
import {
  combinedLivePhotoHash,
  ingestLivePhotoAsset,
  ingestSingleAsset,
  type AssetVisibility,
} from './asset-ingest.js'
import {
  discardTemporaryUpload,
  receiveLocalFile,
  type SavedUpload,
} from './storage.js'

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.mp4', '.mov'])
const STILL_MIME_TYPES = new Set(['image/jpeg', 'image/heic', 'image/heif'])
const LIVE_VIDEO_MIME_TYPE = 'video/quicktime'

interface DuplicateAsset {
  id: string
  originalName: string
  type: 'IMAGE' | 'VIDEO' | 'LIVE_PHOTO'
}

export interface ImportCandidateFile {
  role: 'PHOTO' | 'VIDEO' | 'MEDIA'
  path: string
  relativePath: string
  name: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

export interface ImportCandidate {
  id: string
  type: 'IMAGE' | 'VIDEO' | 'LIVE_PHOTO'
  originalName: string
  mimeType: string
  sizeBytes: number
  sha256: string
  duplicate: boolean
  duplicateAssets: DuplicateAsset[]
  files: ImportCandidateFile[]
  warnings: string[]
}

export interface ImportSkippedFile {
  path: string
  relativePath: string
  reason: string
}

export interface ImportScanResult {
  rootPath: string
  candidates: ImportCandidate[]
  skipped: ImportSkippedFile[]
  summary: {
    scannedFiles: number
    candidates: number
    newCandidates: number
    duplicates: number
    livePhotoCandidates: number
    skipped: number
    truncated: boolean
  }
}

export interface ImportResult {
  imported: Array<{
    candidateId: string
    assetId: string
    type: 'IMAGE' | 'VIDEO' | 'LIVE_PHOTO'
    originalName: string
  }>
  skipped: Array<{
    candidateId: string
    originalName: string
    reason: string
  }>
  summary: {
    requested: number
    imported: number
    skipped: number
  }
}

interface RawFile {
  path: string
  relativePath: string
  name: string
  extension: string
  sizeBytes: number
}

interface DetectedFile extends RawFile {
  mimeType: string
  assetType: 'IMAGE' | 'VIDEO'
  sha256: string
}

function cleanImportPath(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isSameOrInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function validateImportRoot(directoryPath: unknown, config: AppConfig): string {
  const input = cleanImportPath(directoryPath)
  if (!input || !path.isAbsolute(input)) {
    throw new Error('请输入本机电脑上的绝对文件夹路径')
  }

  const rootPath = path.resolve(input)
  const stats = statSync(rootPath, { throwIfNoEntry: false })
  if (!stats?.isDirectory()) {
    throw new Error('扫描路径不存在或不是文件夹')
  }

  const dataRoot = path.resolve(config.dataDirectory)
  if (isSameOrInside(dataRoot, rootPath) || isSameOrInside(rootPath, dataRoot)) {
    throw new Error('不能扫描 MintGallery 正在使用的数据目录，请选择外部导入文件夹')
  }

  return rootPath
}

function fileBaseName(filename: string): string {
  return path.parse(filename).name.normalize('NFC').toLocaleLowerCase()
}

function candidateId(parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

function allowedAssetType(mimeType: string): 'IMAGE' | 'VIDEO' | null {
  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp' ||
    mimeType === 'image/heic' || mimeType === 'image/heif') return 'IMAGE'
  if (mimeType === 'video/mp4' || mimeType === LIVE_VIDEO_MIME_TYPE) return 'VIDEO'
  return null
}

async function listSupportedFiles(
  rootPath: string,
  maxFiles: number,
): Promise<{ files: RawFile[]; skipped: ImportSkippedFile[]; truncated: boolean }> {
  const directories = [rootPath]
  const files: RawFile[] = []
  const skipped: ImportSkippedFile[] = []
  let truncated = false

  while (directories.length > 0) {
    const current = directories.shift()!
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error) {
      skipped.push({
        path: current,
        relativePath: path.relative(rootPath, current),
        reason: error instanceof Error ? error.message : '文件夹无法读取',
      })
      continue
    }

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name)
      const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join('/')
      if (entry.isDirectory()) {
        directories.push(absolutePath)
        continue
      }
      if (!entry.isFile()) {
        skipped.push({ path: absolutePath, relativePath, reason: '跳过非常规文件' })
        continue
      }

      const extension = path.extname(entry.name).toLowerCase()
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        skipped.push({ path: absolutePath, relativePath, reason: '不在导入格式范围内' })
        continue
      }

      const stats = await stat(absolutePath)
      files.push({
        path: absolutePath,
        relativePath,
        name: entry.name,
        extension,
        sizeBytes: stats.size,
      })
      if (files.length >= maxFiles) {
        truncated = true
        return { files, skipped, truncated }
      }
    }
  }

  return { files, skipped, truncated }
}

async function detectFiles(files: RawFile[], skipped: ImportSkippedFile[]): Promise<DetectedFile[]> {
  const detectedFiles: DetectedFile[] = []

  for (const file of files) {
    try {
      const detected = await fileTypeFromFile(file.path)
      const assetType = detected ? allowedAssetType(detected.mime) : null
      if (!detected || !assetType) {
        skipped.push({ path: file.path, relativePath: file.relativePath, reason: '真实文件格式不支持' })
        continue
      }
      detectedFiles.push({
        ...file,
        mimeType: detected.mime,
        assetType,
        sha256: await hashFile(file.path),
      })
    } catch (error) {
      skipped.push({
        path: file.path,
        relativePath: file.relativePath,
        reason: error instanceof Error ? error.message : '文件检测失败',
      })
    }
  }

  return detectedFiles
}

function duplicateAssets(database: DatabaseSync, hashes: string[]): DuplicateAsset[] {
  const uniqueHashes = [...new Set(hashes)]
  if (uniqueHashes.length === 0) return []
  const placeholders = uniqueHashes.map(() => '?').join(', ')
  const rows = database.prepare(`
    SELECT id, original_name, type FROM assets WHERE sha256 IN (${placeholders}) LIMIT 5
  `).all(...uniqueHashes) as Array<{
    id: string
    original_name: string
    type: 'IMAGE' | 'VIDEO' | 'LIVE_PHOTO'
  }>
  return rows.map((row) => ({ id: row.id, originalName: row.original_name, type: row.type }))
}

function toCandidateFile(file: DetectedFile, role: ImportCandidateFile['role']): ImportCandidateFile {
  return {
    role,
    path: file.path,
    relativePath: file.relativePath,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
  }
}

function singleCandidate(database: DatabaseSync, file: DetectedFile): ImportCandidate {
  const duplicates = duplicateAssets(database, [file.sha256])
  return {
    id: candidateId(['single', file.path, file.sha256]),
    type: file.assetType,
    originalName: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    duplicate: duplicates.length > 0,
    duplicateAssets: duplicates,
    files: [toCandidateFile(file, 'MEDIA')],
    warnings: [],
  }
}

function livePhotoCandidate(
  database: DatabaseSync,
  photo: DetectedFile,
  video: DetectedFile,
): ImportCandidate {
  const sha256 = combinedLivePhotoHash(photo.sha256, video.sha256)
  const duplicates = duplicateAssets(database, [sha256, photo.sha256, video.sha256])
  return {
    id: candidateId(['live', photo.path, video.path, sha256]),
    type: 'LIVE_PHOTO',
    originalName: photo.name,
    mimeType: photo.mimeType,
    sizeBytes: photo.sizeBytes + video.sizeBytes,
    sha256,
    duplicate: duplicates.length > 0,
    duplicateAssets: duplicates,
    files: [toCandidateFile(photo, 'PHOTO'), toCandidateFile(video, 'VIDEO')],
    warnings: ['按同一文件夹内相同主文件名识别为实况照片候选'],
  }
}

function buildCandidates(
  database: DatabaseSync,
  rootPath: string,
  files: DetectedFile[],
  skipped: ImportSkippedFile[],
): ImportCandidate[] {
  const groups = new Map<string, DetectedFile[]>()
  for (const file of files) {
    const folder = path.dirname(file.relativePath).normalize()
    const key = `${folder}/${fileBaseName(file.name)}`
    const group = groups.get(key) ?? []
    group.push(file)
    groups.set(key, group)
  }

  const candidates: ImportCandidate[] = []
  for (const group of groups.values()) {
    const stills = group.filter((file) => STILL_MIME_TYPES.has(file.mimeType))
    const liveVideos = group.filter((file) => file.mimeType === LIVE_VIDEO_MIME_TYPE)
    const paired = stills.length === 1 && liveVideos.length === 1

    if (paired) {
      candidates.push(livePhotoCandidate(database, stills[0]!, liveVideos[0]!))
      const pairedPaths = new Set([stills[0]!.path, liveVideos[0]!.path])
      for (const file of group.filter((item) => !pairedPaths.has(item.path))) {
        candidates.push(singleCandidate(database, file))
      }
      continue
    }

    if (stills.length > 0 && liveVideos.length > 0) {
      skipped.push({
        path: path.dirname(group[0]!.path),
        relativePath: path.relative(rootPath, path.dirname(group[0]!.path)).split(path.sep).join('/'),
        reason: '同名图片或 MOV 不唯一，已改按普通文件候选处理',
      })
    }

    for (const file of group) candidates.push(singleCandidate(database, file))
  }

  return candidates.sort((left, right) => left.files[0]!.relativePath.localeCompare(right.files[0]!.relativePath))
}

export async function scanExternalFolder(options: {
  database: DatabaseSync
  config: AppConfig
  directoryPath: unknown
  maxFiles?: number
}): Promise<ImportScanResult> {
  const rootPath = validateImportRoot(options.directoryPath, options.config)
  const { files, skipped, truncated } = await listSupportedFiles(rootPath, options.maxFiles ?? 2000)
  const detectedFiles = await detectFiles(files, skipped)
  const candidates = buildCandidates(options.database, rootPath, detectedFiles, skipped)
  const duplicates = candidates.filter((candidate) => candidate.duplicate).length

  return {
    rootPath,
    candidates,
    skipped,
    summary: {
      scannedFiles: files.length,
      candidates: candidates.length,
      newCandidates: candidates.length - duplicates,
      duplicates,
      livePhotoCandidates: candidates.filter((candidate) => candidate.type === 'LIVE_PHOTO').length,
      skipped: skipped.length,
      truncated,
    },
  }
}

function isImportStill(upload: SavedUpload): boolean {
  return STILL_MIME_TYPES.has(upload.mimeType)
}

function isImportLiveVideo(upload: SavedUpload): boolean {
  return upload.mimeType === LIVE_VIDEO_MIME_TYPE
}

export async function importExternalFolderCandidates(options: {
  database: DatabaseSync
  config: AppConfig
  userId: string
  visibility: AssetVisibility
  directoryPath: unknown
  candidateIds: unknown
  includeDuplicates?: boolean
  onLivePreviewError?: (assetId: string, error: unknown) => void
}): Promise<ImportResult> {
  if (!Array.isArray(options.candidateIds)) {
    throw new Error('请选择需要导入的文件')
  }
  const selectedIds = [...new Set(options.candidateIds.filter((value): value is string => typeof value === 'string'))]
  if (selectedIds.length === 0 || selectedIds.length > 200) {
    throw new Error('每次请选择 1 到 200 个导入项')
  }

  const scan = await scanExternalFolder({
    database: options.database,
    config: options.config,
    directoryPath: options.directoryPath,
  })
  const byId = new Map(scan.candidates.map((candidate) => [candidate.id, candidate]))
  const imported: ImportResult['imported'] = []
  const skipped: ImportResult['skipped'] = []

  for (const candidateId of selectedIds) {
    const candidate = byId.get(candidateId)
    if (!candidate) {
      skipped.push({ candidateId, originalName: '', reason: '候选项已变化，请重新扫描' })
      continue
    }
    if (candidate.duplicate && !options.includeDuplicates) {
      skipped.push({ candidateId, originalName: candidate.originalName, reason: '已跳过重复项' })
      continue
    }

    if (candidate.type === 'LIVE_PHOTO') {
      let photoUpload: SavedUpload | null = null
      let videoUpload: SavedUpload | null = null
      try {
        const photo = candidate.files.find((file) => file.role === 'PHOTO')!
        const video = candidate.files.find((file) => file.role === 'VIDEO')!
        photoUpload = await receiveLocalFile(photo.path, options.config)
        videoUpload = await receiveLocalFile(video.path, options.config)
        if (!isImportStill(photoUpload) || !isImportLiveVideo(videoUpload)) {
          throw new Error('实况照片候选的真实格式已变化')
        }
        const assetId = await ingestLivePhotoAsset({
          database: options.database,
          config: options.config,
          userId: options.userId,
          visibility: options.visibility,
          photoOriginalName: candidate.originalName,
          videoOriginalName: video.name,
          photoUpload,
          videoUpload,
          onLivePreviewError: options.onLivePreviewError,
        })
        imported.push({ candidateId, assetId, type: candidate.type, originalName: candidate.originalName })
      } catch (error) {
        if (photoUpload) discardTemporaryUpload(photoUpload)
        if (videoUpload) discardTemporaryUpload(videoUpload)
        skipped.push({
          candidateId,
          originalName: candidate.originalName,
          reason: error instanceof Error ? error.message : '实况照片导入失败',
        })
      }
      continue
    }

    let upload: SavedUpload | null = null
    try {
      const file = candidate.files[0]!
      upload = await receiveLocalFile(file.path, options.config)
      const assetId = await ingestSingleAsset({
        database: options.database,
        config: options.config,
        userId: options.userId,
        visibility: options.visibility,
        originalName: candidate.originalName,
        upload,
      })
      imported.push({ candidateId, assetId, type: candidate.type, originalName: candidate.originalName })
    } catch (error) {
      if (upload) discardTemporaryUpload(upload)
      skipped.push({
        candidateId,
        originalName: candidate.originalName,
        reason: error instanceof Error ? error.message : '文件导入失败',
      })
    }
  }

  return {
    imported,
    skipped,
    summary: {
      requested: selectedIds.length,
      imported: imported.length,
      skipped: skipped.length,
    },
  }
}
