import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, FeaturedCollection, User } from '../types'
import GalleryView from './GalleryView.vue'

const listMock = vi.hoisted(() => vi.fn())
const collectionsMock = vi.hoisted(() => vi.fn())
const foldersMock = vi.hoisted(() => vi.fn())
const monthsMock = vi.hoisted(() => vi.fn())

vi.mock('../api', () => ({
  adminApi: {
    createUser: vi.fn(),
    importFolder: vi.fn(),
    scanImportFolder: vi.fn(),
    setUserStatus: vi.fn(),
    stats: vi.fn(),
    users: vi.fn(),
  },
  authApi: {
    logout: vi.fn(),
  },
  collectionApi: {
    list: collectionsMock,
  },
  folderApi: {
    addAssets: vi.fn(),
    create: vi.fn(),
    list: foldersMock,
    remove: vi.fn(),
    removeAssets: vi.fn(),
  },
  galleryApi: {
    list: listMock,
    updateAsset: vi.fn(),
    updateAssets: vi.fn(),
  },
  timelineApi: {
    months: monthsMock,
  },
  uploadAsset: vi.fn(),
  uploadLivePhoto: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

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

function collection(id: FeaturedCollection['id'], changes: Partial<FeaturedCollection> = {}): FeaturedCollection {
  return {
    id,
    title: id,
    subtitle: 'collection',
    count: 1,
    filter: 'ALL',
    mediaType: 'ALL',
    smartFilter: 'ALL',
    covers: [],
    ...changes,
  }
}

const user: User = {
  id: 'user-1',
  username: 'family',
  role: 'ADMIN',
  status: 'ACTIVE',
  mustChangePassword: false,
}

function mountGallery() {
  return mount(GalleryView, {
    props: { user },
    global: {
      stubs: {
        AdminPanel: true,
        FolderDialog: true,
        MediaTile: {
          props: ['asset'],
          template: '<div class="media-tile" :data-id="asset.id">{{ asset.id }}</div>',
        },
        MediaViewer: true,
        UploadPanel: true,
      },
    },
  })
}

function renderedIds(wrapper: VueWrapper) {
  return wrapper.findAll('.media-tile').map((tile) => tile.attributes('data-id'))
}

describe('GalleryView filters', () => {
  beforeEach(() => {
    listMock.mockReset()
    collectionsMock.mockReset()
    foldersMock.mockReset()
    monthsMock.mockReset()
    collectionsMock.mockResolvedValue({ collections: [] })
    foldersMock.mockResolvedValue({ folders: [] })
    monthsMock.mockResolvedValue({ months: [] })
  })

  it('renders memory featured collections as a rotating wall and opens one as a filtered grid', async () => {
    const memoryAsset = asset('memory-asset')
    collectionsMock.mockResolvedValue({
      collections: [
        collection('TODAY_IN_HISTORY', {
          title: '今日往年',
          smartFilter: 'TODAY_IN_HISTORY',
          covers: [memoryAsset],
        }),
      ],
    })
    listMock.mockResolvedValue({ assets: [memoryAsset], nextCursor: null })

    const wrapper = mountGallery()
    await flushPromises()

    expect(wrapper.find('.featured-memory-stage').exists()).toBe(true)
    expect(wrapper.find('[data-featured-wall-photo="TODAY_IN_HISTORY"]').exists()).toBe(true)

    const card = wrapper.find('[data-featured-collection="TODAY_IN_HISTORY"]')
    expect(card.exists()).toBe(true)

    await wrapper.find('[data-featured-wall-photo="TODAY_IN_HISTORY"]').trigger('click')
    await flushPromises()

    expect(listMock.mock.calls.at(-1)?.[6]).toBe('ALL')
    expect(listMock.mock.calls.at(-1)?.[7]).toBe('TODAY_IN_HISTORY')
    expect(wrapper.find('.featured-grid').exists()).toBe(false)
    expect(renderedIds(wrapper)).toEqual(['memory-asset'])
  })

  it.each([
    {
      button: 'favorites',
      expectedFilter: 'FAVORITES',
      filteredAsset: asset('favorite-asset', { favorite: true }),
    },
    {
      button: 'deleted',
      expectedFilter: 'DELETED',
      filteredAsset: asset('deleted-asset', { deletedAt: '2026-06-24T00:00:00.000Z' }),
    },
  ])('does not let stale all-photo responses overwrite $expectedFilter results', async ({
    button,
    expectedFilter,
    filteredAsset,
  }) => {
    const allRequest = deferred<{ assets: Asset[]; nextCursor: string | null }>()
    const allAsset = asset('all-asset')
    listMock.mockImplementation(
      (
        _scope: string,
        _cursor: string | null,
        _folderId: string | null,
        _month: string | null,
        _query: string,
        filter: string,
      ) => {
        if (filter === expectedFilter) {
          return Promise.resolve({ assets: [filteredAsset], nextCursor: null })
        }
        return allRequest.promise
      },
    )

    const wrapper = mountGallery()
    await wrapper.findAll(`[data-gallery-filter="${button}"]`)[0]!.trigger('click')
    await flushPromises()

    expect(listMock.mock.calls.some((call) => call[5] === expectedFilter)).toBe(true)
    expect(renderedIds(wrapper)).toEqual([filteredAsset.id])

    allRequest.resolve({ assets: [allAsset], nextCursor: null })
    await flushPromises()

    expect(renderedIds(wrapper)).toEqual([filteredAsset.id])
  })

  it('passes browsing quick filters to the gallery request and changes grid density', async () => {
    listMock.mockResolvedValue({ assets: [asset('visible-asset')], nextCursor: null })

    const wrapper = mountGallery()
    await flushPromises()

    await wrapper.findAll('[data-gallery-entry="all-photos"]')[0]!.trigger('click')
    await flushPromises()

    await wrapper.find('[data-media-filter="video"]').trigger('click')
    await flushPromises()

    expect(listMock.mock.calls.at(-1)?.[6]).toBe('VIDEO')
    expect(listMock.mock.calls.at(-1)?.[7]).toBe('ALL')

    await wrapper.find('[data-smart-filter="untagged"]').trigger('click')
    await flushPromises()

    expect(listMock.mock.calls.at(-1)?.[6]).toBe('VIDEO')
    expect(listMock.mock.calls.at(-1)?.[7]).toBe('UNTAGGED')

    await wrapper.find('[data-density="compact"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.media-grid').classes()).toContain('media-grid-compact')
    expect(renderedIds(wrapper)).toEqual(['visible-asset'])
  })

  it('renders a count-free real-time scrubber in the timeline view', async () => {
    monthsMock.mockResolvedValue({
      months: [
        { month: '2026-07', count: 4 },
        { month: '2026-06', count: 2 },
        { month: '2025-12', count: 1 },
      ],
    })
    listMock.mockResolvedValue({
      assets: [
        asset('july-photo', { shootingTime: '2026-07-10T08:00:00.000Z' }),
        asset('december-photo', { shootingTime: '2025-12-01T08:00:00.000Z' }),
      ],
      nextCursor: null,
    })

    const wrapper = mountGallery()
    await flushPromises()

    await wrapper.findAll('[data-view-mode="timeline"]')[0]!.trigger('click')
    await flushPromises()

    const scrubber = wrapper.find('.timeline-scrubber')
    expect(scrubber.exists()).toBe(true)
    expect(scrubber.text()).toContain('2026')
    expect(scrubber.text()).toContain('2025')
    expect(scrubber.text()).toContain('2026年7月')
    expect(scrubber.text()).toContain('2026年6月')
    expect(scrubber.text()).not.toContain('（4）')
    expect(scrubber.text()).not.toContain('（2）')
    expect(scrubber.findAll('.timeline-scrubber-point')[0]?.attributes('style')).toContain('top: 0%')

    await scrubber.find('.timeline-scrubber-point').trigger('click')
    await flushPromises()

    expect(listMock.mock.calls.at(-1)?.[3]).toBe('2026-07')
  })
})
