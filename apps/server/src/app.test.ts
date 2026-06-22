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

  it('resumes an authenticated tus upload from the stored offset', async () => {
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind a port')
    const baseUrl = `http://127.0.0.1:${address.port}`

    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'strong-password' }),
    })
    const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toContain('mintgallery_session=')

    const image = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: { r: 82, g: 183, b: 136 },
      },
    })
      .png()
      .toBuffer()
    const metadata = [
      ['filename', 'resumed.png'],
      ['filetype', 'image/png'],
      ['visibility', 'PRIVATE'],
    ]
      .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
      .join(',')

    const unauthorized = await fetch(`${baseUrl}/api/uploads/resumable`, {
      method: 'POST',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(image.length),
        'Upload-Metadata': metadata,
      },
    })
    expect(unauthorized.status).toBe(401)

    const created = await fetch(`${baseUrl}/api/uploads/resumable`, {
      method: 'POST',
      headers: {
        Cookie: cookie!,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(image.length),
        'Upload-Metadata': metadata,
      },
    })
    expect(created.status).toBe(201)
    const location = created.headers.get('location')
    expect(location).toMatch(/^\/api\/uploads\/resumable\/[a-f0-9]{32}$/)
    const uploadUrl = new URL(location!, baseUrl)

    const splitAt = Math.floor(image.length / 2)
    const firstChunk = await fetch(uploadUrl, {
      method: 'PATCH',
      headers: {
        Cookie: cookie!,
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
      },
      body: image.subarray(0, splitAt),
    })
    expect(firstChunk.status).toBe(204)
    expect(firstChunk.headers.get('upload-offset')).toBe(String(splitAt))

    const memberCreated = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'family', temporaryPassword: 'temporary-password' }),
    })
    expect(memberCreated.status).toBe(201)
    const memberLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'family', password: 'temporary-password' }),
    })
    const memberCookie = memberLogin.headers.get('set-cookie')?.split(';')[0]
    const forbiddenOffset = await fetch(uploadUrl, {
      method: 'HEAD',
      headers: { Cookie: memberCookie!, 'Tus-Resumable': '1.0.0' },
    })
    expect(forbiddenOffset.status).toBe(403)

    const offset = await fetch(uploadUrl, {
      method: 'HEAD',
      headers: { Cookie: cookie!, 'Tus-Resumable': '1.0.0' },
    })
    expect(offset.status).toBe(200)
    expect(offset.headers.get('upload-offset')).toBe(String(splitAt))

    const completed = await fetch(uploadUrl, {
      method: 'PATCH',
      headers: {
        Cookie: cookie!,
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': String(splitAt),
        'Content-Type': 'application/offset+octet-stream',
      },
      body: image.subarray(splitAt),
    })
    expect(completed.status).toBe(204)

    const uploadId = location!.split('/').at(-1)
    const result = await fetch(`${baseUrl}/api/uploads/resumable/${uploadId}/result`, {
      headers: { Cookie: cookie! },
    })
    expect(result.status).toBe(200)
    expect((await result.json()).asset).toMatchObject({
      originalName: 'resumed.png',
      type: 'IMAGE',
      visibility: 'PRIVATE',
      status: 'READY',
    })
  })

  it('stores and serves a confirmed JPEG and MOV pair as one Live Photo', async () => {
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/bootstrap',
      payload: { username: 'owner', password: 'strong-password' },
    })
    const cookie = bootstrap.headers['set-cookie']?.split(';')[0]
    const boundary = '----mintgallery-live-photo-boundary'
    const image = await sharp({
      create: {
        width: 12,
        height: 8,
        channels: 3,
        background: { r: 45, g: 106, b: 79 },
      },
    })
      .jpeg()
      .toBuffer()
    const video = Buffer.concat([
      Buffer.from([0, 0, 0, 20]),
      Buffer.from('ftyp'),
      Buffer.from('qt  '),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('qt  '),
    ])
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="IMG_2048.JPG"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      image,
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="IMG_2048.MOV"\r\nContent-Type: video/quicktime\r\n\r\n`,
      ),
      video,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    const upload = await app.inject({
      method: 'POST',
      url: '/api/assets/live-photo?visibility=SHARED',
      headers: {
        cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    })
    expect(upload.statusCode).toBe(201)
    expect(upload.json().asset).toMatchObject({
      type: 'LIVE_PHOTO',
      status: 'READY',
      originalName: 'IMG_2048.JPG',
    })
    expect(upload.json().asset.originalUrl).toMatch(/^\/api\/media\//)
    expect(upload.json().asset.liveVideoUrl).toMatch(/^\/api\/media\//)
    expect(upload.json().asset.liveVideoUrl).not.toBe(upload.json().asset.originalUrl)

    const unauthorizedVideo = await app.inject({
      method: 'GET',
      url: upload.json().asset.liveVideoUrl,
    })
    expect(unauthorizedVideo.statusCode).toBe(401)

    const videoRange = await app.inject({
      method: 'GET',
      url: upload.json().asset.liveVideoUrl,
      headers: { cookie, range: 'bytes=0-3' },
    })
    expect(videoRange.statusCode).toBe(206)
    expect(videoRange.headers['content-type']).toContain('video/quicktime')
    expect(videoRange.rawPayload).toHaveLength(4)

    const mismatchBoundary = '----mintgallery-mismatch-boundary'
    const mismatchPayload = Buffer.concat([
      Buffer.from(
        `--${mismatchBoundary}\r\nContent-Disposition: form-data; name="photo"; filename="IMG_2048.JPG"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      image,
      Buffer.from(
        `\r\n--${mismatchBoundary}\r\nContent-Disposition: form-data; name="video"; filename="IMG_9999.MOV"\r\nContent-Type: video/quicktime\r\n\r\n`,
      ),
      video,
      Buffer.from(`\r\n--${mismatchBoundary}--\r\n`),
    ])
    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/assets/live-photo',
      headers: {
        cookie,
        'content-type': `multipart/form-data; boundary=${mismatchBoundary}`,
      },
      payload: mismatchPayload,
    })
    expect(mismatch.statusCode).toBe(400)
    expect(mismatch.json().message).toContain('主文件名需要相同')

    const gallery = await app.inject({ method: 'GET', url: '/api/assets', headers: { cookie } })
    expect(gallery.json().assets).toHaveLength(1)
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
