import type { DatabaseSync } from 'node:sqlite'
import exifr from 'exifr'
import type { AppConfig } from './config.js'
import { resolveStoragePath } from './storage.js'

const DATE_TAGS = ['DateTimeOriginal', 'CreateDate', 'DateCreated', 'ModifyDate']
const EARLIEST_REASONABLE_DATE = Date.UTC(1900, 0, 1)

export async function extractShootingTime(filePath: string): Promise<number | null> {
  try {
    const metadata = await exifr.parse(filePath, DATE_TAGS)
    for (const tag of DATE_TAGS) {
      const value = metadata?.[tag]
      const timestamp = value instanceof Date ? value.getTime() : Number.NaN
      if (
        Number.isFinite(timestamp) &&
        timestamp >= EARLIEST_REASONABLE_DATE &&
        timestamp <= Date.now() + 24 * 60 * 60 * 1000
      ) {
        return timestamp
      }
    }
  } catch {
    // Unsupported or incomplete metadata falls back to upload time.
  }
  return null
}

export async function backfillShootingTimes(
  database: DatabaseSync,
  config: AppConfig,
): Promise<{ scanned: number; updated: number }> {
  const rows = database.prepare(`
    SELECT a.id, f.relative_path
    FROM assets a
    JOIN asset_files f ON f.asset_id = a.id AND f.kind = 'ORIGINAL_IMAGE'
    WHERE a.shooting_time IS NULL
    ORDER BY a.uploaded_at DESC
  `).all() as Array<{ id: string; relative_path: string }>
  let updated = 0

  for (const row of rows) {
    const shootingTime = await extractShootingTime(resolveStoragePath(config, row.relative_path))
    if (shootingTime !== null) {
      database.prepare('UPDATE assets SET shooting_time = ? WHERE id = ? AND shooting_time IS NULL')
        .run(shootingTime, row.id)
      updated += 1
    }
  }

  return { scanned: rows.length, updated }
}
