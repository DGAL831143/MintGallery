import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'
import { createLivePhotoDerivative } from './live-photo.js'

describe('Live Photo web derivatives', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('creates a fast-start H.264 MP4', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mintgallery-live-test-'))
    directories.push(directory)
    const config = loadConfig({ dataDirectory: directory })
    mkdirSync(config.derivativesDirectory, { recursive: true })
    const input = path.join(directory, 'sample.mov')
    const generated = spawnSync(ffmpeg.path, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=green:s=320x240:d=0.3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input,
    ])
    expect(generated.status, generated.stderr.toString()).toBe(0)

    const derivative = await createLivePhotoDerivative(input, 'asset-1', config)
    const bytes = readFileSync(derivative.path)
    const atom = (name: string) => bytes.indexOf(Buffer.from(name))
    expect(atom('avc1')).toBeGreaterThan(0)
    expect(atom('moov')).toBeGreaterThan(0)
    expect(atom('moov')).toBeLessThan(atom('mdat'))
    expect(derivative.sizeBytes).toBeGreaterThan(0)
  })
})
