import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    expect(thumbnail.headers.etag).toBeTruthy()

    const cachedThumbnail = await app.inject({
      method: 'GET',
      url: asset.thumbnailUrl,
      headers: { cookie, 'if-none-match': thumbnail.headers.etag },
    })
    expect(cachedThumbnail.statusCode).toBe(304)
  })

  it('orders photos by shooting time and filters timeline months', async () => {
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/bootstrap',
      payload: { username: 'owner', password: 'strong-password' },
    })
    const cookie = bootstrap.headers['set-cookie']?.split(';')[0]

    const uploadDatedPhoto = async (filename: string, date: string) => {
      const boundary = `----mintgallery-timeline-${filename}`
      const image = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#52b788' },
      })
        .jpeg()
        .withExif({ IFD2: { DateTimeOriginal: date } })
        .toBuffer()
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
        image,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ])
      return app.inject({
        method: 'POST',
        url: '/api/assets?visibility=PRIVATE',
        headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      })
    }

    const older = await uploadDatedPhoto('winter.jpg', '2024:01:10 08:30:00')
    const newer = await uploadDatedPhoto('summer.jpg', '2024:06:20 18:45:00')
    expect(older.statusCode).toBe(201)
    expect(newer.statusCode).toBe(201)
    expect(newer.json().asset.shootingTime).toContain('2024-06-20')

    const gallery = await app.inject({
      method: 'GET',
      url: '/api/assets?scope=PRIVATE',
      headers: { cookie },
    })
    expect(gallery.json().assets.map((asset: { originalName: string }) => asset.originalName)).toEqual([
      'summer.jpg',
      'winter.jpg',
    ])

    const months = await app.inject({
      method: 'GET',
      url: '/api/timeline/months?scope=PRIVATE',
      headers: { cookie },
    })
    expect(months.json().months).toEqual([
      { month: '2024-06', count: 1 },
      { month: '2024-01', count: 1 },
    ])

    const january = await app.inject({
      method: 'GET',
      url: '/api/assets?scope=PRIVATE&month=2024-01',
      headers: { cookie },
    })
    expect(january.json().assets.map((asset: { originalName: string }) => asset.originalName)).toEqual([
      'winter.jpg',
    ])
  })

  it('organizes visible assets in personal folders without deleting media', async () => {
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/bootstrap',
      payload: { username: 'owner', password: 'strong-password' },
    })
    const cookie = bootstrap.headers['set-cookie']?.split(';')[0]
    const boundary = '----mintgallery-folder-boundary'
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 45, g: 106, b: 79 } },
    }).png().toBuffer()
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="folder.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      image,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const upload = await app.inject({
      method: 'POST',
      url: '/api/assets?visibility=PRIVATE',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    })
    const assetId = upload.json().asset.id as string

    const created = await app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie },
      payload: { name: '旅行' },
    })
    expect(created.statusCode).toBe(201)
    const folderId = created.json().folder.id as string
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie },
      payload: { name: '旅行' },
    })
    expect(duplicate.statusCode).toBe(409)

    const added = await app.inject({
      method: 'POST',
      url: `/api/folders/${folderId}/assets`,
      headers: { cookie },
      payload: { assetIds: [assetId] },
    })
    expect(added.json()).toEqual({ ok: true, changed: 1 })
    const folders = await app.inject({ method: 'GET', url: '/api/folders', headers: { cookie } })
    expect(folders.json().folders[0]).toMatchObject({ name: '旅行', itemCount: 1 })
    const filtered = await app.inject({
      method: 'GET',
      url: `/api/assets?scope=PRIVATE&folderId=${folderId}`,
      headers: { cookie },
    })
    expect(filtered.json().assets.map((asset: { id: string }) => asset.id)).toEqual([assetId])

    const createMember = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { username: 'family', temporaryPassword: 'temporary-password' },
    })
    expect(createMember.statusCode).toBe(201)
    const memberLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'family', password: 'temporary-password' },
    })
    const memberCookie = memberLogin.headers['set-cookie']?.split(';')[0]
    const memberFolder = await app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie: memberCookie },
      payload: { name: '自己的文件夹' },
    })
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/folders/${memberFolder.json().folder.id}/assets`,
      headers: { cookie: memberCookie },
      payload: { assetIds: [assetId] },
    })
    expect(forbidden.statusCode).toBe(403)

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/folders/${folderId}/assets`,
      headers: { cookie },
      payload: { assetIds: [assetId] },
    })
    expect(removed.json()).toEqual({ ok: true, changed: 1 })
    await app.inject({
      method: 'POST',
      url: `/api/folders/${folderId}/assets`,
      headers: { cookie },
      payload: { assetIds: [assetId] },
    })
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/folders/${folderId}`,
      headers: { cookie },
    })
    expect(deleted.json()).toEqual({ ok: true })
    const gallery = await app.inject({
      method: 'GET',
      url: '/api/assets?scope=PRIVATE',
      headers: { cookie },
    })
    expect(gallery.json().assets.map((asset: { id: string }) => asset.id)).toContain(assetId)
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
    expect(upload.json().asset.liveOriginalUrl).toMatch(/^\/api\/media\//)
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

  it('scans an external folder, imports selected files, and detects duplicates', async () => {
    const sourceDirectory = mkdtempSync(path.join(tmpdir(), 'mintgallery-import-source-'))
    try {
      const bootstrap = await app.inject({
        method: 'POST',
        url: '/api/bootstrap',
        payload: { username: 'owner', password: 'strong-password' },
      })
      const cookie = bootstrap.headers['set-cookie']?.split(';')[0]
      const single = await sharp({
        create: { width: 10, height: 10, channels: 3, background: '#52b788' },
      }).png().toBuffer()
      const liveStill = await sharp({
        create: { width: 12, height: 8, channels: 3, background: '#2d6a4f' },
      }).jpeg().toBuffer()
      const liveVideo = Buffer.concat([
        Buffer.from([0, 0, 0, 20]),
        Buffer.from('ftyp'),
        Buffer.from('qt  '),
        Buffer.from([0, 0, 0, 0]),
        Buffer.from('qt  '),
      ])
      const singlePath = path.join(sourceDirectory, 'single.png')
      const liveStillPath = path.join(sourceDirectory, 'IMG_3001.JPG')
      const liveVideoPath = path.join(sourceDirectory, 'IMG_3001.MOV')
      writeFileSync(singlePath, single)
      writeFileSync(liveStillPath, liveStill)
      writeFileSync(liveVideoPath, liveVideo)

      const scan = await app.inject({
        method: 'POST',
        url: '/api/imports/folder/scan',
        headers: { cookie },
        payload: { path: sourceDirectory },
      })
      expect(scan.statusCode).toBe(200)
      expect(scan.json().summary).toMatchObject({
        candidates: 2,
        newCandidates: 2,
        duplicates: 0,
        livePhotoCandidates: 1,
      })
      const candidates = scan.json().candidates as Array<{
        id: string
        type: string
        originalName: string
        duplicate: boolean
      }>
      expect(candidates.map((candidate) => candidate.type).sort()).toEqual(['IMAGE', 'LIVE_PHOTO'])

      const imported = await app.inject({
        method: 'POST',
        url: '/api/imports/folder/import',
        headers: { cookie },
        payload: {
          path: sourceDirectory,
          visibility: 'PRIVATE',
          candidateIds: candidates.map((candidate) => candidate.id),
          includeDuplicates: false,
        },
      })
      expect(imported.statusCode).toBe(200)
      expect(imported.json().summary).toEqual({ requested: 2, imported: 2, skipped: 0 })
      expect(existsSync(singlePath)).toBe(true)
      expect(existsSync(liveStillPath)).toBe(true)
      expect(existsSync(liveVideoPath)).toBe(true)

      const gallery = await app.inject({
        method: 'GET',
        url: '/api/assets?scope=PRIVATE',
        headers: { cookie },
      })
      expect(gallery.json().assets.map((asset: { type: string }) => asset.type).sort()).toEqual([
        'IMAGE',
        'LIVE_PHOTO',
      ])

      const duplicateScan = await app.inject({
        method: 'POST',
        url: '/api/imports/folder/scan',
        headers: { cookie },
        payload: { path: sourceDirectory },
      })
      expect(duplicateScan.json().summary.duplicates).toBe(2)

      const duplicateImport = await app.inject({
        method: 'POST',
        url: '/api/imports/folder/import',
        headers: { cookie },
        payload: {
          path: sourceDirectory,
          visibility: 'PRIVATE',
          candidateIds: (duplicateScan.json().candidates as Array<{ id: string }>).map((candidate) => candidate.id),
          includeDuplicates: false,
        },
      })
      expect(duplicateImport.json().summary).toEqual({ requested: 2, imported: 0, skipped: 2 })
    } finally {
      rmSync(sourceDirectory, { recursive: true, force: true })
    }
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
