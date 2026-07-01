import { describe, expect, it } from 'vitest'
import type { Asset } from './types'
import {
  buildTimelineScrubber,
  formatMonth,
  groupTimelineAssets,
  groupTimelineMonths,
  timelineMonthLabel,
} from './timeline'

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

  it('groups months by year and keeps hover month labels count-free', () => {
    const groups = groupTimelineMonths([
      { month: '2026-07', count: 4 },
      { month: '2026-06', count: 2 },
      { month: '2025-12', count: 1 },
    ])

    expect(groups.map((group) => group.year)).toEqual(['2026', '2025'])
    expect(groups[0]?.months.map((month) => timelineMonthLabel(month.month))).toEqual(['7月', '6月'])
    expect(timelineMonthLabel('2025-12')).toBe('12月')
  })

  it('positions scrubber years and month dots by real calendar distance', () => {
    const scrubber = buildTimelineScrubber([
      { month: '2013-08', count: 1 },
      { month: '2010-08', count: 1 },
      { month: '2002-08', count: 1 },
    ])

    expect(scrubber.points.map((point) => point.month)).toEqual(['2013-08', '2010-08', '2002-08'])
    expect(scrubber.points[0]?.position).toBe(0)
    expect(scrubber.points[2]?.position).toBe(100)
    expect(scrubber.points[1]?.position).toBeGreaterThan(25)
    expect(scrubber.points[1]?.position).toBeLessThan(45)
    expect(scrubber.points[1]?.label).toBe('2010年8月')
    expect(scrubber.years.map((year) => year.year)).toEqual([
      '2013', '2012', '2011', '2010', '2009', '2008', '2007', '2006', '2005', '2004', '2003', '2002',
    ])
    expect(scrubber.years.find((year) => year.year === '2012')?.month).toBeNull()
  })
})
