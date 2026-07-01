import type { Asset, TimelineMonth } from './types'

export interface TimelineEntry {
  asset: Asset
  index: number
}

export interface TimelineGroup {
  month: string
  label: string
  entries: TimelineEntry[]
}

export interface TimelineYearGroup {
  year: string
  months: TimelineMonth[]
}

export interface TimelineScrubberPoint {
  month: string
  label: string
  position: number
}

export interface TimelineScrubberYear {
  year: string
  position: number
  month: string | null
}

export interface TimelineScrubber {
  points: TimelineScrubberPoint[]
  years: TimelineScrubberYear[]
}

export function assetDate(asset: Asset): Date {
  return new Date(asset.shootingTime ?? asset.uploadedAt)
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function formatMonth(month: string): string {
  const [year, value] = month.split('-')
  return `${year}年${Number(value)}月`
}

export function groupTimelineMonths(months: TimelineMonth[]): TimelineYearGroup[] {
  const groups = new Map<string, TimelineMonth[]>()
  for (const item of months) {
    const year = item.month.slice(0, 4)
    if (!/^\d{4}$/.test(year)) continue
    const entries = groups.get(year) ?? []
    entries.push(item)
    groups.set(year, entries)
  }
  return Array.from(groups, ([year, entries]) => ({ year, months: entries }))
}

export function timelineMonthLabel(month: string): string {
  const value = Number(month.slice(5, 7))
  return Number.isFinite(value) && value >= 1 && value <= 12 ? `${value}月` : month
}

function monthIndex(month: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return null
  const year = Number(match[1])
  const value = Number(match[2])
  if (!Number.isInteger(year) || !Number.isInteger(value) || value < 1 || value > 12) return null
  return year * 12 + value - 1
}

function positionForMonth(index: number, minIndex: number, maxIndex: number): number {
  const span = Math.max(maxIndex - minIndex, 1)
  return ((maxIndex - index) / span) * 100
}

export function buildTimelineScrubber(months: TimelineMonth[]): TimelineScrubber {
  const entries = months
    .map((item) => ({ month: item.month, index: monthIndex(item.month) }))
    .filter((item): item is { month: string; index: number } => item.index !== null)
    .sort((a, b) => b.index - a.index)

  if (!entries.length) return { points: [], years: [] }

  const maxIndex = entries[0]!.index
  const minIndex = entries[entries.length - 1]!.index
  const maxYear = Math.floor(maxIndex / 12)
  const minYear = Math.floor(minIndex / 12)
  const latestMonthByYear = new Map<string, string>()
  for (const entry of entries) {
    const year = entry.month.slice(0, 4)
    if (!latestMonthByYear.has(year)) latestMonthByYear.set(year, entry.month)
  }

  return {
    points: entries.map((entry) => ({
      month: entry.month,
      label: formatMonth(entry.month),
      position: positionForMonth(entry.index, minIndex, maxIndex),
    })),
    years: Array.from({ length: maxYear - minYear + 1 }, (_, offset) => maxYear - offset).map((year) => {
      const yearTopIndex = Math.min(maxIndex, year * 12 + 11)
      return {
        year: String(year),
        month: latestMonthByYear.get(String(year)) ?? null,
        position: positionForMonth(Math.max(yearTopIndex, minIndex), minIndex, maxIndex),
      }
    }),
  }
}

export function groupTimelineAssets(assets: Asset[]): TimelineGroup[] {
  const groups = new Map<string, TimelineEntry[]>()
  assets.forEach((asset, index) => {
    const key = monthKey(assetDate(asset))
    const entries = groups.get(key) ?? []
    entries.push({ asset, index })
    groups.set(key, entries)
  })
  return [...groups].map(([month, entries]) => ({ month, label: formatMonth(month), entries }))
}
