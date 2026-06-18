import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { Asset } from '../types'
import MediaViewer from './MediaViewer.vue'

const livePhoto: Asset = {
  id: 'live-photo-1',
  ownerId: 'user-1',
  ownerName: 'family',
  type: 'LIVE_PHOTO',
  visibility: 'SHARED',
  status: 'READY',
  originalName: 'IMG_5863.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
  width: 3024,
  height: 4032,
  durationMs: 1500,
  uploadedAt: '2026-06-18T10:38:00.000Z',
  processingError: null,
  originalUrl: '/api/assets/live-photo-1/original',
  liveVideoUrl: '/api/assets/live-photo-1/live-video',
  thumbnailUrl: '/api/assets/live-photo-1/thumbnail',
  previewUrl: '/api/assets/live-photo-1/preview',
  backupStatus: 'NOT_CONFIGURED',
}

describe('MediaViewer', () => {
  it('does not render the fallback alongside a playable Live Photo', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const wrapper = mount(MediaViewer, {
      props: { assets: [livePhoto], index: 0 },
    })

    expect(wrapper.find('.live-photo-player').exists()).toBe(true)
    expect(wrapper.find('.viewer-fallback').exists()).toBe(false)

    wrapper.unmount()
    pause.mockRestore()
  })
})
