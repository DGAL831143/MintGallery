import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset } from '../types'
import MediaViewer from './MediaViewer.vue'

const updateAssetMock = vi.hoisted(() => vi.fn())

vi.mock('../api', () => ({
  galleryApi: {
    updateAsset: updateAssetMock,
  },
}))

const livePhoto: Asset = {
  id: 'live-photo-1',
  ownerId: 'user-1',
  ownerName: 'family',
  type: 'LIVE_PHOTO',
  visibility: 'SHARED',
  privacyMasked: false,
  tags: ['键盘', '测试'],
  status: 'READY',
  originalName: 'IMG_5863.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
  width: 3024,
  height: 4032,
  durationMs: 1500,
  shootingTime: null,
  uploadedAt: '2026-06-18T10:38:00.000Z',
  processingError: null,
  originalUrl: '/api/assets/live-photo-1/original',
  liveOriginalUrl: '/api/assets/live-photo-1/live-original',
  liveVideoUrl: '/api/assets/live-photo-1/live-video',
  thumbnailUrl: '/api/assets/live-photo-1/thumbnail',
  previewUrl: '/api/assets/live-photo-1/preview',
  backupStatus: 'NOT_CONFIGURED',
}

describe('MediaViewer', () => {
  beforeEach(() => {
    updateAssetMock.mockReset()
  })

  it('does not render the fallback alongside a playable Live Photo', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const wrapper = mount(MediaViewer, {
      props: { assets: [livePhoto], index: 0, currentUser: { id: 'user-1', username: 'family', role: 'MEMBER', status: 'ACTIVE', mustChangePassword: false } },
    })

    expect(wrapper.find('.live-photo-player').exists()).toBe(true)
    expect(wrapper.find('.viewer-fallback').exists()).toBe(false)

    wrapper.unmount()
    pause.mockRestore()
  })

  it('does not request the Live Photo video until playback is requested', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const wrapper = mount(MediaViewer, {
      props: { assets: [livePhoto], index: 0, currentUser: { id: 'user-1', username: 'family', role: 'MEMBER', status: 'ACTIVE', mustChangePassword: false } },
    })

    expect(wrapper.find('video').attributes('src')).toBeUndefined()
    await wrapper.find('.live-play-button').trigger('click')
    await flushPromises()
    expect(wrapper.find('video').attributes('src')).toBe(livePhoto.liveVideoUrl)

    wrapper.unmount()
    play.mockRestore()
    pause.mockRestore()
  })

  it('requires an explicit reveal before showing a masked photo', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const masked = { ...livePhoto, privacyMasked: true }
    const wrapper = mount(MediaViewer, {
      props: { assets: [masked], index: 0, currentUser: { id: 'user-1', username: 'family', role: 'MEMBER', status: 'ACTIVE', mustChangePassword: false } },
    })

    expect(wrapper.find('.viewer-privacy-cover').exists()).toBe(true)
    expect(wrapper.find('.live-photo-player').exists()).toBe(false)
    await wrapper.find('.privacy-reveal-button').trigger('click')
    expect(wrapper.find('.viewer-privacy-cover').exists()).toBe(false)
    expect(wrapper.find('.live-photo-player').exists()).toBe(true)

    wrapper.unmount()
    pause.mockRestore()
  })

  it('uses tags instead of the upload filename as the visible label', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const wrapper = mount(MediaViewer, {
      props: { assets: [livePhoto], index: 0, currentUser: { id: 'user-1', username: 'family', role: 'MEMBER', status: 'ACTIVE', mustChangePassword: false } },
    })

    expect(wrapper.text()).toContain('键盘')
    expect(wrapper.text()).toContain('测试')
    expect(wrapper.text()).not.toContain('IMG_5863.jpg')

    wrapper.unmount()
    pause.mockRestore()
  })

  it('lets the owner update asset tags from the info panel', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    updateAssetMock.mockResolvedValue({ asset: { ...livePhoto, tags: ['旅行', '生日'] } })
    const wrapper = mount(MediaViewer, {
      props: { assets: [livePhoto], index: 0, currentUser: { id: 'user-1', username: 'family', role: 'MEMBER', status: 'ACTIVE', mustChangePassword: false } },
    })

    await wrapper.find('[title="照片信息"]').trigger('click')
    const tagButton = wrapper.findAll('button').find((button) => button.text().includes('设置标签'))
    expect(tagButton).toBeTruthy()
    await tagButton!.trigger('click')
    await wrapper.find('textarea').setValue('旅行，生日\n旅行')
    await wrapper.find('form.viewer-tag-editor').trigger('submit')
    await flushPromises()

    expect(updateAssetMock).toHaveBeenCalledWith('live-photo-1', { tags: ['旅行', '生日'] })

    wrapper.unmount()
    pause.mockRestore()
  })
})
