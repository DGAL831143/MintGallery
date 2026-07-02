import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, User } from '../types'
import ShowcaseView from './ShowcaseView.vue'

const showcaseGetMock = vi.hoisted(() => vi.fn())
const showcaseUpdateMock = vi.hoisted(() => vi.fn())
const galleryListMock = vi.hoisted(() => vi.fn())

vi.mock('../api', () => ({
  galleryApi: {
    list: galleryListMock,
    updateAsset: vi.fn(),
  },
  showcaseApi: {
    get: showcaseGetMock,
    update: showcaseUpdateMock,
  },
}))

function asset(id: string, changes: Partial<Asset> = {}): Asset {
  return {
    id,
    ownerId: 'user-1',
    ownerName: 'family',
    type: 'IMAGE',
    visibility: 'SHARED',
    privacyMasked: false,
    favorite: false,
    tags: [],
    status: 'READY',
    originalName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    width: 100,
    height: 100,
    durationMs: null,
    shootingTime: null,
    uploadedAt: '2026-06-24T00:00:00.000Z',
    deletedAt: null,
    processingError: null,
    originalUrl: `/api/media/${id}`,
    liveOriginalUrl: null,
    liveVideoUrl: null,
    thumbnailUrl: `/api/media/${id}-thumb`,
    previewUrl: `/api/media/${id}-preview`,
    edited: false,
    editedAt: null,
    backupStatus: 'NOT_CONFIGURED',
    ...changes,
  }
}

const adminUser: User = {
  id: 'user-1',
  username: 'owner',
  role: 'ADMIN',
  status: 'ACTIVE',
  mustChangePassword: false,
}

function mountShowcase(user = adminUser) {
  return mount(ShowcaseView, {
    props: { user },
    global: {
      stubs: {
        MediaViewer: true,
      },
    },
  })
}

describe('ShowcaseView', () => {
  beforeEach(() => {
    showcaseGetMock.mockReset()
    showcaseUpdateMock.mockReset()
    galleryListMock.mockReset()
  })

  it('renders shared showcase assets returned by the API', async () => {
    showcaseGetMock.mockResolvedValue({
      assets: [asset('favorite-a', { favorite: true })],
      configuredAssetIds: [],
      defaulted: true,
    })

    const wrapper = mountShowcase()
    await flushPromises()

    expect(showcaseGetMock).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.showcase-memory-stage').exists()).toBe(true)
    expect(wrapper.find('.showcase-memory-panel h1').text()).toBe('MintGallery')
    expect(wrapper.findAll('.showcase-photo')).toHaveLength(8)
    expect(wrapper.text()).toContain('来自收藏的家庭影像')
  })

  it('lets an admin save the shared showcase selection', async () => {
    const selected = asset('favorite-a', { favorite: true })
    const candidate = asset('candidate-b')
    showcaseGetMock.mockResolvedValue({
      assets: [selected],
      configuredAssetIds: [],
      defaulted: true,
    })
    galleryListMock
      .mockResolvedValueOnce({ assets: [selected], nextCursor: null })
      .mockResolvedValueOnce({ assets: [candidate], nextCursor: null })
      .mockResolvedValueOnce({ assets: [], nextCursor: null })
    showcaseUpdateMock.mockResolvedValue({
      assets: [selected, candidate],
      configuredAssetIds: [selected.id, candidate.id],
      defaulted: false,
    })

    const wrapper = mountShowcase()
    await flushPromises()

    await wrapper.find('.showcase-edit-button').trigger('click')
    await flushPromises()

    expect(galleryListMock).toHaveBeenCalledTimes(3)
    expect(wrapper.findAll('.showcase-picker-item')).toHaveLength(2)

    await wrapper.findAll('.showcase-picker-item')[1]!.trigger('click')
    await wrapper.find('.showcase-picker-actions .button-primary').trigger('click')
    await flushPromises()

    expect(showcaseUpdateMock).toHaveBeenCalledWith([selected.id, candidate.id])
    expect(wrapper.find('.showcase-picker').exists()).toBe(false)
    expect(wrapper.text()).toContain('共用展示集')
  })
})
