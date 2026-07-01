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
