import { describe, expect, it } from 'vitest'
import { formatBytes } from './format'

describe('formatBytes', () => {
  it('formats storage sizes for the interface', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
  })
})
