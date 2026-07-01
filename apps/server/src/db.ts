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
      privacy_masked INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
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
      deleted_at INTEGER,
      deleted_by TEXT REFERENCES users(id),
      processing_error TEXT
    );

    CREATE TABLE IF NOT EXISTS asset_files (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN (
        'ORIGINAL_IMAGE', 'ORIGINAL_VIDEO', 'THUMBNAIL', 'PREVIEW', 'LIVE_PREVIEW',
        'EDIT_THUMBNAIL', 'EDIT_PREVIEW', 'POSTER'
      )),
      relative_path TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_edits (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id),
      operations_json TEXT NOT NULL,
      thumbnail_file_id TEXT NOT NULL REFERENCES asset_files(id) ON DELETE CASCADE,
      preview_file_id TEXT NOT NULL REFERENCES asset_files(id) ON DELETE CASCADE,
      width INTEGER,
      height INTEGER,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at INTEGER NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_asset_edits_asset_active ON asset_edits(asset_id, active, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_folders_owner ON folders(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_folder_assets_asset ON folder_assets(asset_id);
  `)

  const requiredAssetFileKinds = ['LIVE_PREVIEW', 'EDIT_THUMBNAIL', 'EDIT_PREVIEW']
  const assetFilesSchema = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'asset_files'")
    .get() as { sql: string } | undefined
  if (assetFilesSchema && requiredAssetFileKinds.some((kind) => !assetFilesSchema.sql.includes(kind))) {
    try {
      database.exec(`
        BEGIN;
        DROP INDEX IF EXISTS idx_asset_files_asset;
        ALTER TABLE asset_files RENAME TO asset_files_legacy;
        CREATE TABLE asset_files (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN (
            'ORIGINAL_IMAGE', 'ORIGINAL_VIDEO', 'THUMBNAIL', 'PREVIEW', 'LIVE_PREVIEW',
            'EDIT_THUMBNAIL', 'EDIT_PREVIEW', 'POSTER'
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

  const assetColumns = database.prepare("PRAGMA table_info('assets')").all() as Array<{ name: string }>
  if (!assetColumns.some((column) => column.name === 'privacy_masked')) {
    database.exec(`
      ALTER TABLE assets ADD COLUMN privacy_masked INTEGER NOT NULL DEFAULT 0;
    `)
  }
  if (!assetColumns.some((column) => column.name === 'tags')) {
    database.exec(`
      ALTER TABLE assets ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
    `)
  }
  if (!assetColumns.some((column) => column.name === 'favorite')) {
    database.exec(`
      ALTER TABLE assets ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
    `)
  }
  if (!assetColumns.some((column) => column.name === 'deleted_at')) {
    database.exec(`
      ALTER TABLE assets ADD COLUMN deleted_at INTEGER;
    `)
  }
  if (!assetColumns.some((column) => column.name === 'deleted_by')) {
    database.exec(`
      ALTER TABLE assets ADD COLUMN deleted_by TEXT REFERENCES users(id);
    `)
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_assets_privacy_masked ON assets(privacy_masked);')
  database.exec('CREATE INDEX IF NOT EXISTS idx_assets_favorite ON assets(favorite);')
  database.exec('CREATE INDEX IF NOT EXISTS idx_assets_deleted_at ON assets(deleted_at);')

  return database
}
