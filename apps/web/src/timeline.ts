import type { Asset } from './types'

export interface TimelineEntry {
  asset: Asset
  index: number
}

export interface TimelineGroup {
  month: string
  label: string
  entries: TimelineEntry[]
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
