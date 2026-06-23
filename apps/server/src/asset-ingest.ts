import { createHash, randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import type { AppConfig } from './config.js'
import { createLivePhotoDerivative } from './live-photo.js'
import { extractShootingTime } from './metadata.js'
import {
  createImageDerivatives,
  fileSize,
  moveOriginal,
  toRelativeStoragePath,
  type SavedUpload,
} from './storage.js'

export type AssetVisibility = 'SHARED' | 'PRIVATE'

interface IngestSingleAssetOptions {
  database: DatabaseSync
  config: AppConfig
  userId: string
  visibility: AssetVisibility
  originalName: string
  upload: SavedUpload
  assetId?: string
}

export async function ingestSingleAsset(options: IngestSingleAssetOptions): Promise<string> {
  const { database, config, userId, visibility, originalName, upload } = options
  const assetId = options.assetId ?? randomUUID()
  const existing = database.prepare('SELECT id FROM assets WHERE id = ?').get(assetId)
  if (existing) return assetId

  const originalPath = moveOriginal(upload, userId, assetId, config)
  const originalFileId = randomUUID()
  const originalKind = upload.assetType === 'IMAGE' ? 'ORIGINAL_IMAGE' : 'ORIGINAL_VIDEO'
  const uploadedAt = Date.now()
  const shootingTime = upload.assetType === 'IMAGE'
    ? await extractShootingTime(originalPath)
    : null

  database.exec('BEGIN')
  try {
    database
      .prepare(`
        INSERT INTO assets (
          id, owner_id, type, visibility, status, original_name, mime_type,
          size_bytes, sha256, shooting_time, uploaded_at
        ) VALUES (?, ?, ?, ?, 'PROCESSING', ?, ?, ?, ?, ?, ?)
      `)
      .run(
        assetId,
        userId,
        upload.assetType,
        visibility,
        originalName,
        upload.mimeType,
        upload.sizeBytes,
        upload.sha256,
        shootingTime,
        uploadedAt,
      )
    database
      .prepare(`
        INSERT INTO asset_files (id, asset_id, kind, relative_path, mime_type, size_bytes)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        originalFileId,
        assetId,
        originalKind,
        toRelativeStoragePath(config, originalPath),
        upload.mimeType,
        upload.sizeBytes,
      )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    rmSync(originalPath, { force: true })
    throw error
  }

  try {
    if (upload.assetType === 'IMAGE') {
      const derivatives = await createImageDerivatives(originalPath, assetId, config)
      const insertFile = database.prepare(`
        INSERT INTO asset_files (id, asset_id, kind, relative_path, mime_type, size_bytes)
        VALUES (?, ?, ?, ?, 'image/webp', ?)
      `)
      insertFile.run(
        randomUUID(),
        assetId,
        'THUMBNAIL',
        toRelativeStoragePath(config, derivatives.thumbnailPath),
        fileSize(derivatives.thumbnailPath),
      )
      insertFile.run(
        randomUUID(),
        assetId,
        'PREVIEW',
        toRelativeStoragePath(config, derivatives.previewPath),
        fileSize(derivatives.previewPath),
      )
      database
        .prepare("UPDATE assets SET status = 'READY', width = ?, height = ? WHERE id = ?")
        .run(derivatives.width, derivatives.height, assetId)
    } else {
      database.prepare("UPDATE assets SET status = 'READY' WHERE id = ?").run(assetId)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : '媒体处理失败'
    database
      .prepare("UPDATE assets SET status = 'FAILED', processing_error = ? WHERE id = ?")
      .run(message, assetId)
  }

  return assetId
}

interface IngestLivePhotoAssetOptions {
  database: DatabaseSync
  config: AppConfig
  userId: string
  visibility: AssetVisibility
  photoOriginalName: string
  videoOriginalName: string
  photoUpload: SavedUpload
  videoUpload: SavedUpload
  assetId?: string
  onLivePreviewError?: (assetId: string, error: unknown) => void
}

export function combinedLivePhotoHash(photoSha256: string, videoSha256: string): string {
  return createHash('sha256').update(photoSha256).update(videoSha256).digest('hex')
}

export async function ingestLivePhotoAsset(options: IngestLivePhotoAssetOptions): Promise<string> {
  const { database, config, userId, visibility, photoOriginalName, photoUpload, videoUpload } = options
  const assetId = options.assetId ?? randomUUID()
  const existing = database.prepare('SELECT id FROM assets WHERE id = ?').get(assetId)
  if (existing) return assetId

  const photoPath = moveOriginal(photoUpload, userId, assetId, config)
  const videoPath = moveOriginal(videoUpload, userId, assetId, config)
  const uploadedAt = Date.now()
  const shootingTime = await extractShootingTime(photoPath)
  const combinedHash = combinedLivePhotoHash(photoUpload.sha256, videoUpload.sha256)

  database.exec('BEGIN')
  try {
    database
      .prepare(`
        INSERT INTO assets (
          id, owner_id, type, visibility, status, original_name, mime_type,
          size_bytes, sha256, shooting_time, uploaded_at
        ) VALUES (?, ?, 'LIVE_PHOTO', ?, 'PROCESSING', ?, ?, ?, ?, ?, ?)
      `)
      .run(
        assetId,
        userId,
        visibility,
        photoOriginalName,
        photoUpload.mimeType,
        photoUpload.sizeBytes + videoUpload.sizeBytes,
        combinedHash,
        shootingTime,
        uploadedAt,
      )
    const insertFile = database.prepare(`
      INSERT INTO asset_files (id, asset_id, kind, relative_path, mime_type, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    insertFile.run(
      randomUUID(),
      assetId,
      'ORIGINAL_IMAGE',
      toRelativeStoragePath(config, photoPath),
      photoUpload.mimeType,
      photoUpload.sizeBytes,
    )
    insertFile.run(
      randomUUID(),
      assetId,
      'ORIGINAL_VIDEO',
      toRelativeStoragePath(config, videoPath),
      videoUpload.mimeType,
      videoUpload.sizeBytes,
    )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    rmSync(photoPath, { force: true })
    rmSync(videoPath, { force: true })
    throw error
  }

  try {
    const derivatives = await createImageDerivatives(photoPath, assetId, config)
    const insertFile = database.prepare(`
      INSERT INTO asset_files (id, asset_id, kind, relative_path, mime_type, size_bytes)
      VALUES (?, ?, ?, ?, 'image/webp', ?)
    `)
    insertFile.run(
      randomUUID(),
      assetId,
      'THUMBNAIL',
      toRelativeStoragePath(config, derivatives.thumbnailPath),
      fileSize(derivatives.thumbnailPath),
    )
    insertFile.run(
      randomUUID(),
      assetId,
      'PREVIEW',
      toRelativeStoragePath(config, derivatives.previewPath),
      fileSize(derivatives.previewPath),
    )
    database
      .prepare("UPDATE assets SET status = 'READY', width = ?, height = ? WHERE id = ?")
      .run(derivatives.width, derivatives.height, assetId)
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : '实况照片预览处理失败'
    database
      .prepare("UPDATE assets SET status = 'FAILED', processing_error = ? WHERE id = ?")
      .run(message, assetId)
  }

  try {
    const derivative = await createLivePhotoDerivative(videoPath, assetId, config)
    database.prepare(`
      INSERT INTO asset_files (id, asset_id, kind, relative_path, mime_type, size_bytes)
      VALUES (?, ?, 'LIVE_PREVIEW', ?, 'video/mp4', ?)
    `).run(
      randomUUID(),
      assetId,
      toRelativeStoragePath(config, derivative.path),
      derivative.sizeBytes,
    )
  } catch (error) {
    options.onLivePreviewError?.(assetId, error)
  }

  return assetId
}
