import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { extractShootingTime } from './metadata.js'

describe('photo metadata', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('extracts DateTimeOriginal from a JPEG', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mintgallery-metadata-'))
    directories.push(directory)
    const filePath = path.join(directory, 'dated.jpg')
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#52b788' },
    })
      .jpeg()
      .withExif({ IFD2: { DateTimeOriginal: '2024:01:10 08:30:00' } })
      .toFile(filePath)

    const timestamp = await extractShootingTime(filePath)
    expect(timestamp).not.toBeNull()
    const date = new Date(timestamp!)
    expect([
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
    ]).toEqual([2024, 1, 10, 8, 30])
  })
})
