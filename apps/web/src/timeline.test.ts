import { describe, expect, it } from 'vitest'
import type { Asset } from './types'
import { formatMonth, groupTimelineAssets } from './timeline'

function asset(id: string, shootingTime: string | null, uploadedAt: string): Asset {
  return {
    id,
    ownerId: 'owner',
    ownerName: 'owner',
    type: 'IMAGE',
    visibility: 'PRIVATE',
    privacyMasked: false,
    favorite: false,
    tags: [],
    status: 'READY',
    originalName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 1,
    width: 100,
    height: 100,
    durationMs: null,
    shootingTime,
    uploadedAt,
    deletedAt: null,
    processingError: null,
    originalUrl: '',
    liveOriginalUrl: null,
    liveVideoUrl: null,
    thumbnailUrl: null,
    previewUrl: null,
    edited: false,
    editedAt: null,
    backupStatus: 'NOT_CONFIGURED',
  }
}

describe('timeline grouping', () => {
  it('uses shooting time and falls back to upload time', () => {
    const groups = groupTimelineAssets([
      asset('new', '2024-06-20T10:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      asset('fallback', null, '2024-01-10T10:00:00.000Z'),
    ])

    expect(groups.map((group) => group.month)).toEqual(['2024-06', '2024-01'])
    expect(groups[1]?.entries[0]).toMatchObject({ index: 1, asset: { id: 'fallback' } })
    expect(formatMonth('2024-06')).toBe('2024年6月')
  })
})
