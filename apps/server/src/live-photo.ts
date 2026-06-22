import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { DatabaseSync } from 'node:sqlite'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import type { AppConfig } from './config.js'
import { resolveStoragePath, toRelativeStoragePath } from './storage.js'

export interface LivePhotoDerivative {
  path: string
  sizeBytes: number
}

export async function createLivePhotoDerivative(
  originalPath: string,
  assetId: string,
  config: AppConfig,
): Promise<LivePhotoDerivative> {
  const directory = path.join(config.derivativesDirectory, assetId)
  mkdirSync(directory, { recursive: true })
  const outputPath = path.join(directory, 'live.mp4')
  const temporaryPath = path.join(directory, `live-${randomUUID()}.tmp.mp4`)
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', originalPath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
    '-maxrate', '3M', '-bufsize', '6M', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
    temporaryPath,
  ]

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg.path, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`))
      })
    })
    rmSync(outputPath, { force: true })
    renameSync(temporaryPath, outputPath)
    return { path: outputPath, sizeBytes: statSync(outputPath).size }
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

export async function backfillLivePhotoDerivatives(
  database: DatabaseSync,
  config: AppConfig,
  onError: (assetId: string, error: unknown) => void,
): Promise<number> {
  const rows = database.prepare(`
    SELECT a.id, f.relative_path
    FROM assets a
    JOIN asset_files f ON f.asset_id = a.id AND f.kind = 'ORIGINAL_VIDEO'
    WHERE a.type = 'LIVE_PHOTO'
      AND NOT EXISTS (
        SELECT 1 FROM asset_files preview
        WHERE preview.asset_id = a.id AND preview.kind = 'LIVE_PREVIEW'
      )
  `).all() as Array<{ id: string; relative_path: string }>
  let completed = 0

  for (const row of rows) {
    try {
      const derivative = await createLivePhotoDerivative(
        resolveStoragePath(config, row.relative_path),
        row.id,
        config,
      )
      database.prepare(`
        INSERT INTO asset_files (id, asset_id, kind, relative_path, mime_type, size_bytes)
        VALUES (?, ?, 'LIVE_PREVIEW', ?, 'video/mp4', ?)
      `).run(
        randomUUID(),
        row.id,
        toRelativeStoragePath(config, derivative.path),
        derivative.sizeBytes,
      )
      completed += 1
    } catch (error) {
      onError(row.id, error)
    }
  }

  return completed
}
