import { createHash, randomUUID } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import { fileTypeFromFile } from 'file-type'
import sharp from 'sharp'
import type { AppConfig } from './config.js'

const ALLOWED_TYPES = new Map([
  ['image/jpeg', { extension: '.jpg', assetType: 'IMAGE' as const }],
  ['image/png', { extension: '.png', assetType: 'IMAGE' as const }],
  ['image/webp', { extension: '.webp', assetType: 'IMAGE' as const }],
  ['image/heic', { extension: '.heic', assetType: 'IMAGE' as const }],
  ['image/heif', { extension: '.heif', assetType: 'IMAGE' as const }],
  ['video/mp4', { extension: '.mp4', assetType: 'VIDEO' as const }],
  ['video/quicktime', { extension: '.mov', assetType: 'VIDEO' as const }],
])

export interface SavedUpload {
  temporaryPath: string
  sizeBytes: number
  sha256: string
  mimeType: string
  extension: string
  assetType: 'IMAGE' | 'VIDEO'
}

export interface ImageDerivatives {
  width: number | null
  height: number | null
  thumbnailPath: string
  previewPath: string
}

export function ensureStorageDirectories(config: AppConfig): void {
  for (const directory of [
    config.dataDirectory,
    config.originalsDirectory,
    config.derivativesDirectory,
    config.temporaryDirectory,
    config.databaseDirectory,
  ]) {
    mkdirSync(directory, { recursive: true })
  }
}

export async function receiveUpload(
  stream: Readable,
  config: AppConfig,
): Promise<SavedUpload> {
  const temporaryPath = path.join(config.temporaryDirectory, `${randomUUID()}.upload`)
  const hash = createHash('sha256')
  let sizeBytes = 0

  stream.on('data', (chunk: Buffer) => {
    hash.update(chunk)
    sizeBytes += chunk.length
  })

  try {
    await pipeline(stream, createWriteStream(temporaryPath, { flags: 'wx' }))
    const detected = await fileTypeFromFile(temporaryPath)
    const allowed = detected ? ALLOWED_TYPES.get(detected.mime) : undefined

    if (!detected || !allowed) {
      throw new Error('不支持的文件格式')
    }

    return {
      temporaryPath,
      sizeBytes,
      sha256: hash.digest('hex'),
      mimeType: detected.mime,
      extension: allowed.extension,
      assetType: allowed.assetType,
    }
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

export function moveOriginal(
  upload: SavedUpload,
  ownerId: string,
  assetId: string,
  config: AppConfig,
): string {
  const now = new Date()
  const directory = path.join(
    config.originalsDirectory,
    ownerId,
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    assetId,
  )
  mkdirSync(directory, { recursive: true })
  const destination = path.join(directory, `original${upload.extension}`)
  renameSync(upload.temporaryPath, destination)
  return destination
}

export function discardTemporaryUpload(upload: SavedUpload): void {
  rmSync(upload.temporaryPath, { force: true })
}

export async function createImageDerivatives(
  originalPath: string,
  assetId: string,
  config: AppConfig,
): Promise<ImageDerivatives> {
  const directory = path.join(config.derivativesDirectory, assetId)
  mkdirSync(directory, { recursive: true })
  const thumbnailPath = path.join(directory, 'thumbnail.webp')
  const previewPath = path.join(directory, 'preview.webp')
  const image = sharp(originalPath, { failOn: 'warning' }).rotate()
  const metadata = await image.metadata()

  await Promise.all([
    image
      .clone()
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(thumbnailPath),
    image
      .clone()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84 })
      .toFile(previewPath),
  ])

  return {
    width: metadata.autoOrient?.width ?? metadata.width ?? null,
    height: metadata.autoOrient?.height ?? metadata.height ?? null,
    thumbnailPath,
    previewPath,
  }
}

export function toRelativeStoragePath(config: AppConfig, absolutePath: string): string {
  return path.relative(config.dataDirectory, absolutePath).split(path.sep).join('/')
}

export function resolveStoragePath(config: AppConfig, relativePath: string): string {
  const root = path.resolve(config.dataDirectory)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('非法媒体路径')
  }
  return resolved
}

export function fileSize(filePath: string): number {
  return statSync(filePath).size
}

export function storageStats(config: AppConfig): {
  totalBytes: number
  freeBytes: number
  usedBytes: number
} {
  const stats = statfsSync(config.dataDirectory)
  const totalBytes = stats.blocks * stats.bsize
  const freeBytes = stats.bavail * stats.bsize
  return { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes }
}

export { createReadStream }
