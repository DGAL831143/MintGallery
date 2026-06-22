import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function openDatabase(databasePath: string): DatabaseSync {
  mkdirSync(path.dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('IMAGE', 'VIDEO', 'LIVE_PHOTO')),
      visibility TEXT NOT NULL CHECK (visibility IN ('SHARED', 'PRIVATE')),
      status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'READY', 'FAILED')),
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      duration_ms INTEGER,
      shooting_time INTEGER,
      uploaded_at INTEGER NOT NULL,
      processing_error TEXT
    );

    CREATE TABLE IF NOT EXISTS asset_files (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN (
        'ORIGINAL_IMAGE', 'ORIGINAL_VIDEO', 'THUMBNAIL', 'PREVIEW', 'LIVE_PREVIEW', 'POSTER'
      )),
      relative_path TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE,
      created_at INTEGER NOT NULL,
      UNIQUE(owner_id, name)
    );

    CREATE TABLE IF NOT EXISTS folder_assets (
      folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      PRIMARY KEY(folder_id, asset_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_assets_feed ON assets(uploaded_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets(owner_id, uploaded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_timeline
      ON assets(COALESCE(shooting_time, uploaded_at) DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_files_asset ON asset_files(asset_id);
    CREATE INDEX IF NOT EXISTS idx_folders_owner ON folders(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_folder_assets_asset ON folder_assets(asset_id);
  `)

  const assetFilesSchema = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'asset_files'")
    .get() as { sql: string } | undefined
  if (assetFilesSchema && !assetFilesSchema.sql.includes('LIVE_PREVIEW')) {
    try {
      database.exec(`
        BEGIN;
        DROP INDEX IF EXISTS idx_asset_files_asset;
        ALTER TABLE asset_files RENAME TO asset_files_legacy;
        CREATE TABLE asset_files (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN (
            'ORIGINAL_IMAGE', 'ORIGINAL_VIDEO', 'THUMBNAIL', 'PREVIEW', 'LIVE_PREVIEW', 'POSTER'
          )),
          relative_path TEXT NOT NULL UNIQUE,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL
        );
        INSERT INTO asset_files (id, asset_id, kind, relative_path, mime_type, size_bytes)
          SELECT id, asset_id, kind, relative_path, mime_type, size_bytes FROM asset_files_legacy;
        DROP TABLE asset_files_legacy;
        CREATE INDEX idx_asset_files_asset ON asset_files(asset_id);
        COMMIT;
      `)
    } catch (error) {
      try {
        database.exec('ROLLBACK')
      } catch {
        // Preserve the original migration error if SQLite already rolled back.
      }
      throw error
    }
  }

  return database
}
