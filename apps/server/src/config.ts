import { fileURLToPath } from 'node:url'
import path from 'node:path'

const defaultDataDirectory = fileURLToPath(new URL('../../../data', import.meta.url))

export interface AppConfig {
  host: string
  port: number
  dataDirectory: string
  originalsDirectory: string
  derivativesDirectory: string
  temporaryDirectory: string
  databaseDirectory: string
  databasePath: string
  webDistDirectory: string
  cookieSecure: boolean
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDirectory = path.resolve(
    overrides.dataDirectory ?? process.env.MINTGALLERY_DATA_DIR ?? defaultDataDirectory,
  )

  return {
    host: overrides.host ?? process.env.MINTGALLERY_HOST ?? '127.0.0.1',
    port: overrides.port ?? Number(process.env.MINTGALLERY_PORT ?? 3000),
    dataDirectory,
    originalsDirectory: overrides.originalsDirectory ?? path.join(dataDirectory, 'originals'),
    derivativesDirectory: overrides.derivativesDirectory ?? path.join(dataDirectory, 'derivatives'),
    temporaryDirectory: overrides.temporaryDirectory ?? path.join(dataDirectory, 'temporary'),
    databaseDirectory: overrides.databaseDirectory ?? path.join(dataDirectory, 'database'),
    databasePath: overrides.databasePath ?? path.join(dataDirectory, 'database', 'mintgallery.db'),
    webDistDirectory:
      overrides.webDistDirectory ?? fileURLToPath(new URL('../../web/dist', import.meta.url)),
    cookieSecure:
      overrides.cookieSecure ?? process.env.MINTGALLERY_COOKIE_SECURE?.toLowerCase() === 'true',
  }
}
