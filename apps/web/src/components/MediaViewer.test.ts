import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset } from '../types'
import MediaViewer from './MediaViewer.vue'

const updateAssetMock = vi.hoisted(() => vi.fn())
const editAssetMock = vi.hoisted(() => vi.fn())
const resetAssetEditMock = vi.hoisted(() => vi.fn())

vi.mock('../api', () => ({
  galleryApi: {
    updateAsset: updateAssetMock,
    editAsset: editAssetMock,
    resetAssetEdit: resetAssetEditMock,
  },
}))

const livePhoto: Asset = {
  id: 'live-photo-1',
  ownerId: 'user-1',
  ownerName: 'family',
  type: 'LIVE_PHOTO',
  visibility: 'SHARED',
  privacyMasked: false,
  favorite: false,
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
  deletedAt: null,
  processingError: null,
  originalUrl: '/api/assets/live-photo-1/original',
  liveOriginalUrl: '/api/assets/live-photo-1/live-original',
  liveVideoUrl: '/api/assets/live-photo-1/live-video',
  thumbnailUrl: '/api/assets/live-photo-1/thumbnail',
  previewUrl: '/api/assets/live-photo-1/preview',
  edited: false,
  editedAt: null,
  backupStatus: 'NOT_CONFIGURED',
}

describe('MediaViewer', () => {
  beforeEach(() => {
    updateAssetMock.mockReset()
    editAssetMock.mockReset()
    resetAssetEditMock.mockReset()
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

  it('renders ordinary images through the fit-to-screen media frame', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const imageAsset: Asset = {
      ...livePhoto,
      id: 'image-1',
      type: 'IMAGE',
      liveOriginalUrl: null,
      liveVideoUrl: null,
      durationMs: null,
    }
    const wrapper = mount(MediaViewer, {
      props: { assets: [imageAsset], index: 0, currentUser: { id: 'user-1', username: 'family', role: 'MEMBER', status: 'ACTIVE', mustChangePassword: false } },
    })

    const media = wrapper.find('img.viewer-media')
    expect(media.exists()).toBe(true)
    expect(media.attributes('src')).toBe(imageAsset.previewUrl)

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

  it('lets a visible member favorite an asset from the toolbar', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    updateAssetMock.mockResolvedValue({ asset: { ...livePhoto, favorite: true } })
    const wrapper = mount(MediaViewer, {
      props: { assets: [livePhoto], index: 0, currentUser: { id: 'other-user', username: 'family', role: 'MEMBER', status: 'ACTIVE', mustChangePassword: false } },
    })

    const favoriteButton = wrapper.find('[title="收藏"]')
    expect(favoriteButton.exists()).toBe(true)
    await favoriteButton.trigger('click')
    await flushPromises()

    expect(updateAssetMock).toHaveBeenCalledWith('live-photo-1', { favorite: true })

    wrapper.unmount()
    pause.mockRestore()
  })

  it('lets the owner save a non-destructive image edit', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    editAssetMock.mockResolvedValue({
      asset: { ...livePhoto, edited: true, editedAt: '2026-07-01T00:00:00.000Z' },
    })
    const wrapper = mount(MediaViewer, {
      props: {
        assets: [livePhoto],
        index: 0,
        currentUser: { id: 'user-1', username: 'family', role: 'MEMBER', status: 'ACTIVE', mustChangePassword: false },
      },
    })

    await wrapper.find('[title="编辑照片"]').trigger('click')
    expect(wrapper.find('.image-editor-panel').exists()).toBe(true)
    await wrapper.find('[title="向右旋转"]').trigger('click')
    const widthSlider = wrapper.findAll('input[type="range"]').at(2)
    await widthSlider!.setValue('0.5')
    await wrapper.find('form.image-editor-panel').trigger('submit')
    await flushPromises()

    expect(editAssetMock).toHaveBeenCalledWith('live-photo-1', {
      crop: { x: 0, y: 0, width: 0.5, height: 1 },
      rotate: 90,
      flipX: false,
      flipY: false,
    })
    expect(wrapper.emitted('updated')?.[0]?.[0]).toMatchObject({ id: 'live-photo-1', edited: true })

    wrapper.unmount()
    pause.mockRestore()
  })

  it('lets the owner restore an edited asset from the info panel', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const edited = { ...livePhoto, edited: true, editedAt: '2026-07-01T00:00:00.000Z' }
    resetAssetEditMock.mockResolvedValue({ asset: { ...edited, edited: false, editedAt: null } })
    const wrapper = mount(MediaViewer, {
      props: {
        assets: [edited],
        index: 0,
        currentUser: { id: 'user-1', username: 'family', role: 'MEMBER', status: 'ACTIVE', mustChangePassword: false },
      },
    })

    await wrapper.find('[title="照片信息"]').trigger('click')
    const resetButton = wrapper.findAll('button').find((button) => button.text().includes('恢复原图'))
    expect(resetButton).toBeTruthy()
    await resetButton!.trigger('click')
    await flushPromises()

    expect(resetAssetEditMock).toHaveBeenCalledWith('live-photo-1')
    expect(wrapper.emitted('updated')?.[0]?.[0]).toMatchObject({ id: 'live-photo-1', edited: false })

    wrapper.unmount()
    pause.mockRestore()
  })
})
