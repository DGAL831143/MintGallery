import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'

describe('MintGallery API', () => {
  let app: FastifyInstance
  let directory: string

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'mintgallery-test-'))
    app = await createApp({ config: { dataDirectory: directory }, logger: false })
  })

  afterEach(async () => {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('initializes the first administrator and protects private APIs', async () => {
    const initial = await app.inject({ method: 'GET', url: '/api/bootstrap/status' })
    expect(initial.json()).toEqual({ needsSetup: true })

    const unauthorized = await app.inject({ method: 'GET', url: '/api/assets' })
    expect(unauthorized.statusCode).toBe(401)

    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/bootstrap',
      payload: { username: 'owner', password: 'strong-password' },
    })
    expect(bootstrap.statusCode).toBe(201)
    const cookie = bootstrap.headers['set-cookie']?.split(';')[0]
    expect(cookie).toContain('mintgallery_session=')

    const currentUser = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    })
    expect(currentUser.statusCode).toBe(200)
    expect(currentUser.json().user.role).toBe('ADMIN')

    const createMember = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { username: 'family', temporaryPassword: 'temporary-password' },
    })
    expect(createMember.statusCode).toBe(201)

    const users = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } })
    expect(users.json().users).toHaveLength(2)

    const gallery = await app.inject({ method: 'GET', url: '/api/assets', headers: { cookie } })
    expect(gallery.json()).toEqual({ assets: [], nextCursor: null })
  })

  it('stores an uploaded image, creates derivatives, and protects media', async () => {
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/bootstrap',
      payload: { username: 'owner', password: 'strong-password' },
    })
    const cookie = bootstrap.headers['set-cookie']?.split(';')[0]
    const boundary = '----mintgallery-test-boundary'
    const image = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 82, g: 183, b: 136 },
      },
    })
      .png()
      .toBuffer()
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="memory.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      image,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    const upload = await app.inject({
      method: 'POST',
      url: '/api/assets?visibility=PRIVATE',
      headers: {
        cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    })
    expect(upload.statusCode).toBe(201)
    expect(upload.json().asset).toMatchObject({
      originalName: 'memory.png',
      type: 'IMAGE',
      visibility: 'PRIVATE',
      status: 'READY',
    })

    const privateGallery = await app.inject({
      method: 'GET',
      url: '/api/assets?scope=PRIVATE',
      headers: { cookie },
    })
    const asset = privateGallery.json().assets[0]
    expect(asset.thumbnailUrl).toMatch(/^\/api\/media\//)

    const protectedMedia = await app.inject({ method: 'GET', url: asset.thumbnailUrl })
    expect(protectedMedia.statusCode).toBe(401)

    const thumbnail = await app.inject({
      method: 'GET',
      url: asset.thumbnailUrl,
      headers: { cookie },
    })
    expect(thumbnail.statusCode).toBe(200)
    expect(thumbnail.headers['content-type']).toContain('image/webp')
    expect(thumbnail.rawPayload.length).toBeGreaterThan(0)
  })

  it('rejects weak bootstrap credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bootstrap',
      payload: { username: 'x', password: 'short' },
    })
    expect(response.statusCode).toBe(400)
  })
})
