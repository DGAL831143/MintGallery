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

  it('renders featured collections and opens one as a filtered grid', async () => {
    const liveAsset = asset('live-asset', { type: 'LIVE_PHOTO' })
    collectionsMock.mockResolvedValue({
      collections: [
        collection('LIVE_PHOTOS', {
          title: '实况照片',
          mediaType: 'LIVE_PHOTO',
          covers: [liveAsset],
        }),
      ],
    })
    listMock.mockResolvedValue({ assets: [liveAsset], nextCursor: null })

    const wrapper = mountGallery()
    await flushPromises()

    const card = wrapper.find('[data-featured-collection="LIVE_PHOTOS"]')
    expect(card.exists()).toBe(true)

    await card.trigger('click')
    await flushPromises()

    expect(listMock.mock.calls.at(-1)?.[6]).toBe('LIVE_PHOTO')
    expect(listMock.mock.calls.at(-1)?.[7]).toBe('ALL')
    expect(wrapper.find('.featured-grid').exists()).toBe(false)
    expect(renderedIds(wrapper)).toEqual(['live-asset'])
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
})
