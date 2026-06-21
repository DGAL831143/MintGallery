import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('derives storage paths from an external data root', () => {
    const dataDirectory = path.join(path.parse(process.cwd()).root, 'mintgallery-test-data')
    const config = loadConfig({ dataDirectory, cookieSecure: true })

    expect(config.dataDirectory).toBe(path.resolve(dataDirectory))
    expect(config.originalsDirectory).toBe(path.join(config.dataDirectory, 'originals'))
    expect(config.derivativesDirectory).toBe(path.join(config.dataDirectory, 'derivatives'))
    expect(config.databasePath).toBe(path.join(config.dataDirectory, 'database', 'mintgallery.db'))
    expect(config.cookieSecure).toBe(true)
  })
})
