<script setup lang="ts">
import { computed, onMounted, ref, watch, type Component } from 'vue'
import {
  CalendarDays,
  CircleAlert,
  Clock3,
  Eye,
  EyeOff,
  Film,
  Folder,
  FolderInput,
  FolderMinus,
  FolderPlus,
  Grid3X3,
  Image,
  Images,
  Leaf,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RotateCcw,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Star,
  Tags,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-vue-next'
import { authApi, collectionApi, folderApi, galleryApi, timelineApi } from '../api'
import { buildTimelineScrubber, formatMonth, groupTimelineAssets } from '../timeline'
import type {
  Asset,
  FeaturedCollection,
  Folder as GalleryFolder,
  GalleryFilter,
  GridDensity,
  MediaTypeFilter,
  SmartFilter,
  TimelineMonth,
  User,
} from '../types'
import AdminPanel from './AdminPanel.vue'
import FolderDialog from './FolderDialog.vue'
import MediaTile from './MediaTile.vue'
import MediaViewer from './MediaViewer.vue'
import ShowcaseView from './ShowcaseView.vue'
import UploadPanel from './UploadPanel.vue'

const props = defineProps<{ user: User }>()
const emit = defineEmits<{ signedOut: [] }>()
type ViewMode = 'FEATURED' | 'TIMELINE' | 'GRID'
const scope = ref<'SHARED' | 'PRIVATE'>('SHARED')
const viewMode = ref<ViewMode>('FEATURED')
const galleryFilter = ref<GalleryFilter>('ALL')
const mediaTypeFilter = ref<MediaTypeFilter>('ALL')
const smartFilter = ref<SmartFilter>('ALL')
const gridDensity = ref<GridDensity>('STANDARD')
const assets = ref<Asset[]>([])
const featuredCollections = ref<FeaturedCollection[]>([])
const folders = ref<GalleryFolder[]>([])
const months = ref<TimelineMonth[]>([])
const activeFolderId = ref<string | null>(null)
const activeMonth = ref<string | null>(null)
const cursor = ref<string | null>(null)
const searchQuery = ref('')
const loading = ref(true)
const collectionsLoading = ref(true)
const loadingMore = ref(false)
const error = ref('')
const collectionsError = ref('')
const viewerIndex = ref<number | null>(null)
const adminOpen = ref(false)
const showcaseOpen = ref(false)
const selectionMode = ref(false)
const selectedIds = ref(new Set<string>())
const folderDialogOpen = ref(false)
const folderBusy = ref(false)
const folderError = ref('')
const assetUpdateBusy = ref(false)
const bulkTagOpen = ref(false)
const bulkTagInput = ref('')
let assetLoadRequest = 0
let collectionLoadRequest = 0

const collectionIcons: Record<FeaturedCollection['id'], Component> = {
  TODAY_IN_HISTORY: CalendarDays,
  THIS_MONTH_HISTORY: Images,
}

type FeaturedWallItem = {
  id: string
  collectionId: FeaturedCollection['id']
  title: string
  thumbnailUrl: string
  privacyMasked: boolean
}

const activeFolder = computed(() => folders.value.find((folder) => folder.id === activeFolderId.value) ?? null)
const selectedCount = computed(() => selectedIds.value.size)
const timelineGroups = computed(() => groupTimelineAssets(assets.value))
const timelineScrubber = computed(() => buildTimelineScrubber(months.value))
const activeTimelineMonth = computed(() =>
  activeMonth.value
  ?? timelineGroups.value[0]?.month
  ?? timelineScrubber.value.points[0]?.month
  ?? null,
)
const featuredCollectionMap = computed(() => new Map(featuredCollections.value.map((collection) => [collection.id, collection])))
const featuredWallItems = computed<FeaturedWallItem[]>(() => {
  const seen = new Set<string>()
  const items: FeaturedWallItem[] = []
  for (const collection of featuredCollections.value) {
    for (const cover of collection.covers) {
      if (!cover.thumbnailUrl || seen.has(cover.id)) continue
      seen.add(cover.id)
      items.push({
        id: `${collection.id}-${cover.id}`,
        collectionId: collection.id,
        title: collection.title,
        thumbnailUrl: cover.thumbnailUrl,
        privacyMasked: cover.privacyMasked,
      })
    }
  }
  return items.slice(0, 18)
})
const featuredWallLeftItems = computed(() => featuredWallItems.value.filter((_, index) => index % 2 === 0))
const featuredWallRightItems = computed(() => featuredWallItems.value.filter((_, index) => index % 2 === 1))
const scopeTitle = computed(() => activeFolder.value?.name ?? (scope.value === 'SHARED' ? '家庭共享' : '仅自己可见'))
const galleryTitle = computed(() => {
  if (viewMode.value === 'FEATURED') return '精选'
  if (galleryFilter.value === 'FAVORITES') return '收藏'
  if (galleryFilter.value === 'DELETED') return '最近删除'
  if (smartFilter.value === 'RECENT_IMPORTS') return '最近导入'
  if (smartFilter.value === 'UNTAGGED') return '待整理'
  if (smartFilter.value === 'PRIVACY_MASKED') return '防窥照片'
  if (mediaTypeFilter.value === 'IMAGE') return '照片'
  if (mediaTypeFilter.value === 'VIDEO') return '视频'
  if (mediaTypeFilter.value === 'LIVE_PHOTO') return '实况照片'
  return activeMonth.value ? formatMonth(activeMonth.value) : scopeTitle.value
})
const galleryEyebrow = computed(() => {
  if (galleryFilter.value === 'FAVORITES') return 'FAVORITES'
  if (galleryFilter.value === 'DELETED') return 'RECENTLY DELETED'
  if (viewMode.value === 'FEATURED') return 'FEATURED'
  if (viewMode.value === 'TIMELINE') return 'TIMELINE'
  if (activeFolder.value) return 'PERSONAL FOLDER'
  return 'ALL PHOTOS'
})
const searchActive = computed(() => searchQuery.value.trim().length > 0)
const browsingDeleted = computed(() => galleryFilter.value === 'DELETED')
const quickFilterActive = computed(() => mediaTypeFilter.value !== 'ALL' || smartFilter.value !== 'ALL')
const gridDensityClass = computed(() => `media-grid-${gridDensity.value.toLowerCase().replace('_', '-')}`)
const emptyTitle = computed(() => {
  if (searchActive.value) return '没有匹配的照片'
  if (galleryFilter.value === 'FAVORITES') return '还没有收藏照片'
  if (galleryFilter.value === 'DELETED') return '最近删除为空'
  if (smartFilter.value === 'RECENT_IMPORTS') return '还没有最近导入'
  if (smartFilter.value === 'UNTAGGED') return '没有待整理照片'
  if (smartFilter.value === 'PRIVACY_MASKED') return '没有防窥照片'
  if (mediaTypeFilter.value === 'VIDEO') return '没有视频'
  if (mediaTypeFilter.value === 'LIVE_PHOTO') return '没有实况照片'
  if (mediaTypeFilter.value === 'IMAGE') return '没有照片'
  if (activeMonth.value) return '这个月没有照片'
  if (activeFolder.value) return '这个文件夹还是空的'
  return scope.value === 'SHARED' ? '家庭相册还是空的' : '这里留给自己的照片'
})
const emptyMessage = computed(() => {
  if (searchActive.value) return '换个标签、上传者或媒体类型再试。'
  if (galleryFilter.value === 'FAVORITES') return '在全部照片或查看器中点亮星标后，会出现在这里。'
  if (galleryFilter.value === 'DELETED') return '被删除的照片会先进入这里，原文件仍保留在电脑中。'
  if (smartFilter.value === 'RECENT_IMPORTS') return '上传或外部导入后会按导入时间出现在这里。'
  if (smartFilter.value === 'UNTAGGED') return '这里会显示还没有标签的项目，适合集中整理。'
  if (smartFilter.value === 'PRIVACY_MASKED') return '设置为防窥后会在这里集中查看。'
  if (mediaTypeFilter.value !== 'ALL') return '切换媒体类型或相册范围后再查看。'
  if (activeFolder.value) return '进入选择模式，将照片加入这个文件夹。'
  return '使用右上角的上传按钮添加第一批照片或视频。'
})

async function load(reset = true) {
  const requestId = ++assetLoadRequest
  if (reset) {
    loading.value = true
    assets.value = []
    cursor.value = null
  } else {
    loadingMore.value = true
  }
  error.value = ''
  try {
    const result = await galleryApi.list(
      scope.value,
      reset ? null : cursor.value,
      activeFolderId.value,
      activeMonth.value,
      searchQuery.value,
      galleryFilter.value,
      mediaTypeFilter.value,
      smartFilter.value,
    )
    if (requestId !== assetLoadRequest) return
    assets.value = reset ? result.assets : [...assets.value, ...result.assets]
    cursor.value = result.nextCursor
  } catch (reason) {
    if (requestId !== assetLoadRequest) return
    error.value = reason instanceof Error ? reason.message : '相册加载失败'
  } finally {
    if (requestId !== assetLoadRequest) return
    loading.value = false
    loadingMore.value = false
  }
}

async function loadCollections() {
  const requestId = ++collectionLoadRequest
  collectionsLoading.value = true
  collectionsError.value = ''
  try {
    const result = await collectionApi.list(scope.value)
    if (requestId !== collectionLoadRequest) return
    featuredCollections.value = result.collections
  } catch (reason) {
    if (requestId !== collectionLoadRequest) return
    collectionsError.value = reason instanceof Error ? reason.message : '精选集加载失败'
  } finally {
    if (requestId !== collectionLoadRequest) return
    collectionsLoading.value = false
  }
}

async function loadFolders() {
  try {
    folders.value = (await folderApi.list()).folders
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '文件夹加载失败'
  }
}

async function loadMonths() {
  if (galleryFilter.value === 'DELETED') {
    months.value = []
    return
  }
  try {
    months.value = (await timelineApi.months(
      scope.value,
      activeFolderId.value,
      searchQuery.value,
      galleryFilter.value,
    )).months
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '时间轴加载失败'
  }
}

function receiveAsset(asset: Asset) {
  if (galleryFilter.value === 'ALL' && !activeFolderId.value && asset.visibility === scope.value) {
    void Promise.all([load(true), loadMonths(), loadCollections()])
  }
}

function receiveImportedAssets() {
  void Promise.all([load(true), loadMonths(), loadFolders(), loadCollections()])
}

function mergeAssets(updatedAssets: Asset[]) {
  const byId = new Map(updatedAssets.map((asset) => [asset.id, asset]))
  assets.value = assets.value.map((asset) => byId.get(asset.id) ?? asset)
}

function assetRatio(asset: Asset): string {
  if (!asset.width || !asset.height) return '4 / 3'
  const ratio = asset.width / asset.height
  if (ratio < 0.82) return '3 / 4'
  if (ratio > 1.8) return '16 / 9'
  return ratio > 1.08 ? '4 / 3' : '1 / 1'
}

function leaveSelection() {
  selectionMode.value = false
  selectedIds.value = new Set()
  bulkTagOpen.value = false
}

function toggleSelectionMode() {
  if (selectionMode.value) leaveSelection()
  else selectionMode.value = true
}

function toggleAsset(assetId: string) {
  const next = new Set(selectedIds.value)
  if (next.has(assetId)) next.delete(assetId)
  else next.add(assetId)
  selectedIds.value = next
}

function openAsset(assetId: string, index: number) {
  if (selectionMode.value) toggleAsset(assetId)
  else viewerIndex.value = index
}

function chooseFolder(folderId: string | null) {
  galleryFilter.value = 'ALL'
  viewMode.value = 'GRID'
  activeMonth.value = null
  resetBrowsingFilters()
  const changed = activeFolderId.value !== folderId
  if (changed) activeFolderId.value = folderId
  viewerIndex.value = null
  leaveSelection()
  if (!changed) void Promise.all([load(true), loadMonths()])
}

function resetBrowsingFilters() {
  mediaTypeFilter.value = 'ALL'
  smartFilter.value = 'ALL'
}

function chooseView(next: ViewMode) {
  galleryFilter.value = 'ALL'
  viewMode.value = next
  if (next === 'FEATURED') {
    activeFolderId.value = null
    activeMonth.value = null
    resetBrowsingFilters()
    void loadCollections()
  } else if (next === 'GRID') {
    activeMonth.value = null
  } else {
    resetBrowsingFilters()
  }
  viewerIndex.value = null
  leaveSelection()
}

function chooseMonth(month: string | null) {
  galleryFilter.value = 'ALL'
  resetBrowsingFilters()
  viewMode.value = 'TIMELINE'
  activeMonth.value = month
}

function chooseTimelineYear(year: string) {
  const firstMonth = timelineScrubber.value.years.find((item) => item.year === year)?.month
  if (firstMonth) chooseMonth(firstMonth)
}

function chooseLibraryFilter(filter: GalleryFilter) {
  galleryFilter.value = filter
  resetBrowsingFilters()
  if (filter !== 'ALL') {
    activeFolderId.value = null
    activeMonth.value = null
    viewMode.value = 'GRID'
  }
  viewerIndex.value = null
  leaveSelection()
  void Promise.all([load(true), loadMonths()])
}

function applyMediaTypeFilter(filter: MediaTypeFilter) {
  galleryFilter.value = 'ALL'
  mediaTypeFilter.value = filter
  viewMode.value = 'GRID'
  activeMonth.value = null
  viewerIndex.value = null
  leaveSelection()
}

function applySmartFilter(filter: SmartFilter) {
  galleryFilter.value = 'ALL'
  smartFilter.value = filter
  viewMode.value = 'GRID'
  activeMonth.value = null
  viewerIndex.value = null
  leaveSelection()
}

function openFeaturedCollection(collection: FeaturedCollection) {
  galleryFilter.value = collection.filter
  mediaTypeFilter.value = collection.mediaType
  smartFilter.value = collection.smartFilter
  activeFolderId.value = null
  activeMonth.value = null
  viewMode.value = 'GRID'
  viewerIndex.value = null
  leaveSelection()
  void Promise.all([load(true), loadMonths()])
}

function openFeaturedWallItem(item: FeaturedWallItem) {
  const collection = featuredCollectionMap.value.get(item.collectionId)
  if (collection) openFeaturedCollection(collection)
}

function openFolderDialog() {
  folderError.value = ''
  folderDialogOpen.value = true
}

async function createFolder(name: string) {
  folderBusy.value = true
  folderError.value = ''
  try {
    const folder = (await folderApi.create(name)).folder
    if (selectedIds.value.size > 0) {
      await folderApi.addAssets(folder.id, [...selectedIds.value])
      leaveSelection()
    } else {
      activeFolderId.value = folder.id
    }
    await loadFolders()
    folderDialogOpen.value = false
  } catch (reason) {
    folderError.value = reason instanceof Error ? reason.message : '文件夹创建失败'
  } finally {
    folderBusy.value = false
  }
}

async function addSelection(folderId: string) {
  if (selectedIds.value.size === 0) return
  folderBusy.value = true
  folderError.value = ''
  try {
    await folderApi.addAssets(folderId, [...selectedIds.value])
    await loadFolders()
    folderDialogOpen.value = false
    leaveSelection()
    if (activeFolderId.value === folderId) await load(true)
  } catch (reason) {
    folderError.value = reason instanceof Error ? reason.message : '照片整理失败'
  } finally {
    folderBusy.value = false
  }
}

async function removeSelection() {
  if (!activeFolderId.value || selectedIds.value.size === 0) return
  folderBusy.value = true
  try {
    await folderApi.removeAssets(activeFolderId.value, [...selectedIds.value])
    leaveSelection()
    await Promise.all([loadFolders(), load(true), loadMonths()])
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '移出文件夹失败'
  } finally {
    folderBusy.value = false
  }
}

async function updateSelection(changes: {
  visibility?: 'SHARED' | 'PRIVATE'
  privacyMasked?: boolean
  favorite?: boolean
  tags?: string[]
  deleted?: boolean
}) {
  if (selectedIds.value.size === 0) return false
  assetUpdateBusy.value = true
  try {
    const result = await galleryApi.updateAssets([...selectedIds.value], changes)
    const movedOutOfScope = Boolean(changes.visibility && changes.visibility !== scope.value)
    const needsReload = movedOutOfScope ||
      Object.prototype.hasOwnProperty.call(changes, 'deleted') ||
      (galleryFilter.value === 'FAVORITES' && changes.favorite === false)
    leaveSelection()
    if (needsReload) {
      await Promise.all([load(true), loadMonths(), loadFolders(), loadCollections()])
    } else {
      mergeAssets(result.assets)
      await Promise.all([loadMonths(), loadCollections()])
    }
    return true
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '照片状态修改失败'
    return false
  } finally {
    assetUpdateBusy.value = false
  }
}

function updateSelectedPrivacy(privacyMasked: boolean) {
  void updateSelection({ privacyMasked })
}

function updateSelectedVisibility(visibility: 'SHARED' | 'PRIVATE') {
  void updateSelection({ visibility })
}

function updateSelectedFavorite(favorite: boolean) {
  void updateSelection({ favorite })
}

function cleanTagInput(value: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const rawTag of value.split(/[,，\n]/)) {
    const tag = rawTag
      .trim()
      .normalize('NFC')
      .replace(/[\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 24)
    const key = tag.toLocaleLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= 10) break
  }
  return tags
}

function openBulkTagDialog() {
  if (selectedIds.value.size === 0) return
  bulkTagInput.value = ''
  bulkTagOpen.value = true
}

async function saveBulkTags() {
  const ok = await updateSelection({ tags: cleanTagInput(bulkTagInput.value) })
  if (ok) bulkTagOpen.value = false
}

function moveSelectionToTrash() {
  if (selectedIds.value.size === 0) return
  if (!window.confirm(`将 ${selectedIds.value.size} 个项目移入最近删除？原文件会保留，可稍后恢复。`)) return
  void updateSelection({ deleted: true })
}

function restoreSelection() {
  void updateSelection({ deleted: false })
}

function handleViewerUpdated(updatedAsset: Asset) {
  const shouldRemove =
    (galleryFilter.value !== 'DELETED' && updatedAsset.deletedAt) ||
    (galleryFilter.value === 'DELETED' && !updatedAsset.deletedAt) ||
    (galleryFilter.value === 'FAVORITES' && !updatedAsset.favorite) ||
    (galleryFilter.value !== 'DELETED' && updatedAsset.visibility !== scope.value)
  if (shouldRemove) {
    viewerIndex.value = null
    assets.value = assets.value.filter((asset) => asset.id !== updatedAsset.id)
    void Promise.all([loadMonths(), loadFolders(), loadCollections()])
    return
  }
  mergeAssets([updatedAsset])
  void Promise.all([loadMonths(), loadCollections()])
}

async function deleteActiveFolder() {
  if (!activeFolder.value) return
  if (!window.confirm(`删除文件夹“${activeFolder.value.name}”？照片原件不会被删除。`)) return
  try {
    await folderApi.remove(activeFolder.value.id)
    activeFolderId.value = null
    await loadFolders()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '文件夹删除失败'
  }
}

async function signOut() {
  await authApi.logout().catch(() => undefined)
  emit('signedOut')
}

watch([scope, activeFolderId, galleryFilter, mediaTypeFilter, smartFilter], () => {
  leaveSelection()
  void Promise.all([loadMonths(), loadCollections()])
  if (activeMonth.value) activeMonth.value = null
  else void load(true)
})
watch(activeMonth, () => {
  leaveSelection()
  void load(true)
})
watch(searchQuery, () => {
  leaveSelection()
  if (viewMode.value === 'FEATURED' && searchQuery.value.trim()) viewMode.value = 'GRID'
  void Promise.all([load(true), loadMonths()])
})
onMounted(() => {
  void Promise.all([load(true), loadFolders(), loadMonths(), loadCollections()])
})
</script>

<template>
  <ShowcaseView v-if="showcaseOpen" :user="user" @close="showcaseOpen = false" />
  <div v-else class="app-shell">
    <header class="topbar">
      <button class="brand-lockup brand-button" type="button" aria-label="打开展示页" @click="showcaseOpen = true">
        <div class="brand-mark"><Leaf :size="21" /></div>
        <strong>MintGallery</strong>
      </button>

      <div class="topbar-actions">
        <UploadPanel :owner-id="user.id" @uploaded="receiveAsset" />
        <button class="icon-button" :class="{ active: selectionMode }" :title="selectionMode ? '结束选择' : '选择照片'" @click="toggleSelectionMode">
          <X v-if="selectionMode" :size="20" />
          <ListChecks v-else :size="20" />
        </button>
        <button v-if="user.role === 'ADMIN'" class="icon-button" title="相册管理" @click="adminOpen = true">
          <Settings :size="20" />
        </button>
        <div class="user-menu"><UserRound :size="17" /><span>{{ user.username }}</span></div>
        <button class="icon-button" title="退出登录" @click="signOut"><LogOut :size="19" /></button>
      </div>
    </header>

    <aside class="copy-warning">
      <ShieldAlert :size="19" />
      <span><strong>当前仅 1 个副本。</strong>在配置第二块硬盘或云备份前，请保留手机中的原件。</span>
    </aside>

    <main class="gallery-main">
      <div class="gallery-layout">
        <aside class="library-sidebar" aria-label="相册导航">
          <section class="sidebar-section">
            <span class="sidebar-label">图库</span>
            <button :class="{ active: galleryFilter === 'ALL' && viewMode === 'FEATURED' }" @click="chooseView('FEATURED')">
              <Sparkles :size="18" /><span>精选</span>
            </button>
            <button data-view-mode="timeline" :class="{ active: galleryFilter === 'ALL' && viewMode === 'TIMELINE' }" @click="chooseView('TIMELINE')">
              <CalendarDays :size="18" /><span>时间轴</span>
            </button>
            <button data-gallery-filter="favorites" :class="{ active: galleryFilter === 'FAVORITES' }" @click="chooseLibraryFilter('FAVORITES')">
              <Star :size="18" /><span>收藏</span>
            </button>
            <button data-gallery-filter="deleted" :class="{ active: galleryFilter === 'DELETED' }" @click="chooseLibraryFilter('DELETED')">
              <Trash2 :size="18" /><span>最近删除</span>
            </button>
          </section>

          <section class="sidebar-section">
            <div class="sidebar-section-heading">
              <span class="sidebar-label">文件夹</span>
              <button class="sidebar-add" title="新建文件夹" @click="openFolderDialog"><FolderPlus :size="17" /></button>
            </div>
            <button data-gallery-entry="all-photos" :class="{ active: galleryFilter === 'ALL' && !activeFolderId && viewMode === 'GRID' && !quickFilterActive }" @click="chooseFolder(null)">
              <Images :size="18" /><span>全部照片</span>
            </button>
            <button v-for="folder in folders" :key="folder.id" :class="{ active: activeFolderId === folder.id }" @click="chooseFolder(folder.id)">
              <Folder :size="18" /><span>{{ folder.name }}</span><small>{{ folder.itemCount }}</small>
            </button>
          </section>

          <section v-if="galleryFilter !== 'DELETED' && viewMode === 'TIMELINE' && months.length" class="sidebar-section sidebar-months">
            <span class="sidebar-label">时间</span>
            <button :class="{ active: !activeMonth }" @click="chooseMonth(null)"><span>全部时间</span></button>
            <button v-for="item in months" :key="item.month" :class="{ active: activeMonth === item.month }" @click="chooseMonth(item.month)">
              <span>{{ formatMonth(item.month) }}</span><small>{{ item.count }}</small>
            </button>
          </section>
        </aside>

        <section class="gallery-content">
          <nav class="folder-tabs mobile-folder-tabs" aria-label="照片文件夹">
            <button data-gallery-entry="all-photos" :class="{ active: galleryFilter === 'ALL' && !activeFolderId && viewMode === 'GRID' && !quickFilterActive }" type="button" @click="chooseFolder(null)">
              <Images :size="17" /><span>全部照片</span>
            </button>
            <button data-gallery-filter="favorites" :class="{ active: galleryFilter === 'FAVORITES' }" type="button" @click="chooseLibraryFilter('FAVORITES')">
              <Star :size="17" /><span>收藏</span>
            </button>
            <button data-gallery-filter="deleted" :class="{ active: galleryFilter === 'DELETED' }" type="button" @click="chooseLibraryFilter('DELETED')">
              <Trash2 :size="17" /><span>最近删除</span>
            </button>
            <button v-for="folder in folders" :key="folder.id" :class="{ active: activeFolderId === folder.id }" type="button" @click="chooseFolder(folder.id)">
              <Folder :size="17" /><span>{{ folder.name }}</span><small>{{ folder.itemCount }}</small>
            </button>
            <button class="folder-create-button" type="button" title="新建文件夹" @click="openFolderDialog">
              <FolderPlus :size="18" /><span>新建</span>
            </button>
          </nav>

          <div class="mobile-view-controls">
            <div class="segmented compact" aria-label="浏览方式">
              <button :class="{ active: galleryFilter === 'ALL' && viewMode === 'FEATURED' }" @click="chooseView('FEATURED')"><Sparkles :size="16" />精选</button>
              <button data-view-mode="timeline" :class="{ active: galleryFilter === 'ALL' && viewMode === 'TIMELINE' }" @click="chooseView('TIMELINE')"><CalendarDays :size="16" />时间轴</button>
            </div>
            <label v-if="galleryFilter !== 'DELETED' && viewMode === 'TIMELINE'" class="month-select">
              <CalendarDays :size="17" />
              <select :value="activeMonth ?? ''" aria-label="选择月份" @change="chooseMonth(($event.target as HTMLSelectElement).value || null)">
                <option value="">全部时间</option>
                <option v-for="item in months" :key="item.month" :value="item.month">{{ formatMonth(item.month) }}（{{ item.count }}）</option>
              </select>
            </label>
          </div>

          <div class="gallery-heading">
            <div class="gallery-title-row">
              <div>
                <span class="eyebrow">{{ galleryEyebrow }}</span>
                <h1>{{ galleryTitle }}</h1>
              </div>
              <button v-if="activeFolder && galleryFilter === 'ALL'" class="icon-button" type="button" title="删除文件夹" @click="deleteActiveFolder"><Trash2 :size="19" /></button>
            </div>
            <form class="gallery-search" role="search" @submit.prevent="load(true)">
              <Search :size="17" />
              <input v-model="searchQuery" type="search" placeholder="搜索标签、上传者、照片/视频/实况" aria-label="搜索照片" />
              <button v-if="searchActive" type="button" title="清除搜索" @click="searchQuery = ''"><X :size="16" /></button>
            </form>
            <div v-if="galleryFilter !== 'DELETED'" class="segmented scope-switch" aria-label="相册范围">
              <button :class="{ active: scope === 'SHARED' }" @click="scope = 'SHARED'">家庭共享</button>
              <button :class="{ active: scope === 'PRIVATE' }" @click="scope = 'PRIVATE'">仅自己</button>
            </div>
          </div>

          <div v-if="galleryFilter !== 'DELETED' && viewMode !== 'FEATURED'" class="browse-controls" :class="{ active: quickFilterActive }">
            <div class="filter-cluster" aria-label="媒体类型">
              <button data-media-filter="all" :class="{ active: mediaTypeFilter === 'ALL' }" type="button" @click="applyMediaTypeFilter('ALL')">
                <Images :size="16" /><span>全部</span>
              </button>
              <button data-media-filter="image" :class="{ active: mediaTypeFilter === 'IMAGE' }" type="button" @click="applyMediaTypeFilter('IMAGE')">
                <Image :size="16" /><span>照片</span>
              </button>
              <button data-media-filter="video" :class="{ active: mediaTypeFilter === 'VIDEO' }" type="button" @click="applyMediaTypeFilter('VIDEO')">
                <Film :size="16" /><span>视频</span>
              </button>
              <button data-media-filter="live" :class="{ active: mediaTypeFilter === 'LIVE_PHOTO' }" type="button" @click="applyMediaTypeFilter('LIVE_PHOTO')">
                <Sparkles :size="16" /><span>实况</span>
              </button>
            </div>

            <div class="filter-cluster" aria-label="整理状态">
              <button data-smart-filter="all" :class="{ active: smartFilter === 'ALL' }" type="button" @click="applySmartFilter('ALL')">
                <Grid3X3 :size="16" /><span>全部</span>
              </button>
              <button data-smart-filter="recent" :class="{ active: smartFilter === 'RECENT_IMPORTS' }" type="button" @click="applySmartFilter('RECENT_IMPORTS')">
                <Clock3 :size="16" /><span>最近导入</span>
              </button>
              <button data-smart-filter="untagged" :class="{ active: smartFilter === 'UNTAGGED' }" type="button" @click="applySmartFilter('UNTAGGED')">
                <Tags :size="16" /><span>待整理</span>
              </button>
              <button data-smart-filter="masked" :class="{ active: smartFilter === 'PRIVACY_MASKED' }" type="button" @click="applySmartFilter('PRIVACY_MASKED')">
                <EyeOff :size="16" /><span>防窥</span>
              </button>
            </div>

            <div v-if="viewMode === 'GRID'" class="filter-cluster density-cluster" aria-label="列表密度">
              <button data-density="comfortable" :class="{ active: gridDensity === 'COMFORTABLE' }" type="button" @click="gridDensity = 'COMFORTABLE'">大图</button>
              <button data-density="standard" :class="{ active: gridDensity === 'STANDARD' }" type="button" @click="gridDensity = 'STANDARD'">标准</button>
              <button data-density="compact" :class="{ active: gridDensity === 'COMPACT' }" type="button" @click="gridDensity = 'COMPACT'">紧凑</button>
            </div>
          </div>

          <section v-if="viewMode === 'FEATURED'" class="featured-view" aria-label="精选集">
            <div v-if="collectionsLoading" class="gallery-state"><LoaderCircle class="spin" :size="28" /><span>正在整理精选</span></div>
            <div v-else-if="collectionsError" class="gallery-state error-state">
              <CircleAlert :size="28" /><strong>精选暂时打不开</strong><span>{{ collectionsError }}</span>
              <button class="button button-secondary" @click="loadCollections">重新加载</button>
            </div>
            <div v-else>
              <div v-if="featuredWallItems.length" class="featured-memory-stage">
                <div class="featured-wall-column featured-wall-column-left">
                  <button
                    v-for="item in featuredWallLeftItems"
                    :key="item.id"
                    class="featured-wall-photo"
                    :class="{ masked: item.privacyMasked }"
                    :data-featured-wall-photo="item.collectionId"
                    :aria-label="`打开${item.title}`"
                    type="button"
                    @click="openFeaturedWallItem(item)"
                  >
                    <img :src="item.thumbnailUrl" alt="" loading="lazy" />
                  </button>
                </div>

                <div class="featured-memory-panel">
                  <button
                    v-for="collection in featuredCollections"
                    :key="collection.id"
                    class="featured-memory-entry"
                    :class="{ empty: collection.count === 0 }"
                    :data-featured-collection="collection.id"
                    type="button"
                    @click="openFeaturedCollection(collection)"
                  >
                    <span class="featured-memory-icon"><component :is="collectionIcons[collection.id]" :size="20" /></span>
                    <span class="featured-memory-text">
                      <strong>{{ collection.title }}</strong>
                      <small>{{ collection.subtitle }}</small>
                    </span>
                    <em>{{ collection.count }}</em>
                  </button>
                </div>

                <div class="featured-wall-column featured-wall-column-right">
                  <button
                    v-for="item in featuredWallRightItems"
                    :key="item.id"
                    class="featured-wall-photo"
                    :class="{ masked: item.privacyMasked }"
                    :data-featured-wall-photo="item.collectionId"
                    :aria-label="`打开${item.title}`"
                    type="button"
                    @click="openFeaturedWallItem(item)"
                  >
                    <img :src="item.thumbnailUrl" alt="" loading="lazy" />
                  </button>
                </div>
              </div>

              <div v-else class="featured-grid">
                <button
                  v-for="collection in featuredCollections"
                  :key="collection.id"
                  class="featured-card"
                  :class="{ empty: collection.count === 0 }"
                  :data-featured-collection="collection.id"
                  type="button"
                  @click="openFeaturedCollection(collection)"
                >
                  <div class="featured-cover" :class="{ empty: collection.covers.length === 0 }">
                    <template v-if="collection.covers.length">
                      <div
                        v-for="cover in collection.covers"
                        :key="cover.id"
                        class="featured-cover-tile"
                        :class="{ masked: cover.privacyMasked }"
                      >
                        <img v-if="cover.thumbnailUrl" :src="cover.thumbnailUrl" alt="" loading="lazy" />
                        <div v-else class="featured-cover-fallback"><Images :size="22" /></div>
                      </div>
                    </template>
                    <div v-else class="featured-cover-fallback"><Images :size="28" /></div>
                  </div>
                  <div class="featured-card-meta">
                    <component :is="collectionIcons[collection.id]" :size="18" />
                    <div>
                      <strong>{{ collection.title }}</strong>
                      <span>{{ collection.subtitle }}</span>
                    </div>
                    <small>{{ collection.count }}</small>
                  </div>
                </button>
              </div>
            </div>
          </section>

          <template v-else>
            <div v-if="loading" class="gallery-state"><LoaderCircle class="spin" :size="28" /><span>正在整理照片</span></div>
            <div v-else-if="error" class="gallery-state error-state">
              <CircleAlert :size="28" /><strong>相册暂时打不开</strong><span>{{ error }}</span>
              <button class="button button-secondary" @click="load(true)">重新加载</button>
            </div>
            <div v-else-if="assets.length === 0" class="gallery-state empty-state">
              <div class="empty-visual"><Images :size="44" /><Leaf :size="24" /></div>
              <strong>{{ emptyTitle }}</strong>
              <span>{{ emptyMessage }}</span>
            </div>

            <div v-else-if="viewMode === 'TIMELINE'" class="timeline-layout">
              <div class="timeline-view">
                <section v-for="group in timelineGroups" :key="group.month" class="timeline-section">
                  <header><h2>{{ group.label }}</h2><span>{{ group.entries.length }} 项</span></header>
                  <div class="timeline-grid">
                    <MediaTile
                      v-for="entry in group.entries"
                      :key="entry.asset.id"
                      :asset="entry.asset"
                      :selected="selectedIds.has(entry.asset.id)"
                      :selecting="selectionMode"
                      ratio="1 / 1"
                      @activate="openAsset(entry.asset.id, entry.index)"
                    />
                  </div>
                </section>
              </div>
              <nav v-if="timelineScrubber.points.length" class="timeline-scrubber" aria-label="真实时间轴">
                <div class="timeline-scrubber-track" aria-hidden="true"></div>
                <button
                  v-for="yearItem in timelineScrubber.years"
                  :key="yearItem.year"
                  class="timeline-scrubber-year"
                  type="button"
                  :class="{ disabled: !yearItem.month }"
                  :style="{ top: `${yearItem.position}%` }"
                  :disabled="!yearItem.month"
                  @click="chooseTimelineYear(yearItem.year)"
                >
                  {{ yearItem.year }}
                </button>
                <button
                  v-for="point in timelineScrubber.points"
                  :key="point.month"
                  class="timeline-scrubber-point"
                  type="button"
                  :class="{ active: activeTimelineMonth === point.month }"
                  :style="{ top: `${point.position}%` }"
                  :aria-label="`跳转到${point.label}`"
                  @click="chooseMonth(point.month)"
                >
                  <span class="timeline-scrubber-tooltip">{{ point.label }}</span>
                </button>
              </nav>
            </div>

            <section v-else class="media-grid" :class="gridDensityClass" aria-label="全部照片">
              <MediaTile
                v-for="(asset, index) in assets"
                :key="asset.id"
                :asset="asset"
                :selected="selectedIds.has(asset.id)"
                :selecting="selectionMode"
                :ratio="assetRatio(asset)"
                @activate="openAsset(asset.id, index)"
              />
            </section>

            <div v-if="cursor" class="load-more-wrap">
              <button class="button button-secondary" :disabled="loadingMore" @click="load(false)">
                <LoaderCircle v-if="loadingMore" class="spin" :size="18" />加载更多
              </button>
            </div>
          </template>
        </section>
      </div>
    </main>

    <div v-if="selectionMode" class="selection-toolbar" role="toolbar" aria-label="照片整理">
      <strong>{{ selectedCount }} 个已选择</strong>
      <template v-if="browsingDeleted">
        <button class="button button-primary" type="button" :disabled="selectedCount === 0 || assetUpdateBusy" @click="restoreSelection"><RotateCcw :size="18" />恢复</button>
      </template>
      <template v-else>
        <button class="button button-primary" type="button" :disabled="selectedCount === 0" @click="openFolderDialog"><FolderInput :size="18" />加入文件夹</button>
        <button v-if="activeFolder" class="button button-secondary" type="button" :disabled="selectedCount === 0 || folderBusy" @click="removeSelection"><FolderMinus :size="18" />移出</button>
        <button class="button button-secondary" type="button" :disabled="selectedCount === 0 || assetUpdateBusy" @click="openBulkTagDialog"><Tags :size="18" />批量标签</button>
        <button class="button button-secondary" type="button" :disabled="selectedCount === 0 || assetUpdateBusy" @click="updateSelectedFavorite(true)"><Star :size="18" />收藏</button>
        <button class="button button-secondary" type="button" :disabled="selectedCount === 0 || assetUpdateBusy" @click="updateSelectedFavorite(false)"><Star :size="18" />取消收藏</button>
        <button class="button button-secondary" type="button" :disabled="selectedCount === 0 || assetUpdateBusy" @click="updateSelectedPrivacy(true)"><EyeOff :size="18" />设为防窥</button>
        <button class="button button-secondary" type="button" :disabled="selectedCount === 0 || assetUpdateBusy" @click="updateSelectedPrivacy(false)"><Eye :size="18" />取消防窥</button>
        <button class="button button-secondary" type="button" :disabled="selectedCount === 0 || assetUpdateBusy" @click="updateSelectedVisibility('PRIVATE')"><LockKeyhole :size="18" />仅自己</button>
        <button class="button button-secondary" type="button" :disabled="selectedCount === 0 || assetUpdateBusy" @click="updateSelectedVisibility('SHARED')"><UsersRound :size="18" />家庭共享</button>
        <button class="button button-secondary danger-action" type="button" :disabled="selectedCount === 0 || assetUpdateBusy" @click="moveSelectionToTrash"><Trash2 :size="18" />删除</button>
      </template>
      <button class="icon-button" type="button" title="取消选择" @click="leaveSelection"><X :size="20" /></button>
    </div>

    <div v-if="bulkTagOpen" class="modal-backdrop" role="dialog" aria-modal="true" aria-label="批量设置标签">
      <form class="bulk-tag-dialog" @submit.prevent="saveBulkTags">
        <header class="panel-header">
          <div>
            <span class="eyebrow">TAGS</span>
            <h2>批量标签</h2>
          </div>
          <button class="icon-button" type="button" title="关闭" @click="bulkTagOpen = false"><X :size="20" /></button>
        </header>
        <div class="bulk-tag-body">
          <p>将覆盖 {{ selectedCount }} 个已选项目的标签。用逗号、中文逗号或换行分隔，最多 10 个。</p>
          <textarea v-model="bulkTagInput" rows="5" placeholder="旅行&#10;家人&#10;生日" :disabled="assetUpdateBusy"></textarea>
          <div class="bulk-tag-actions">
            <button class="button button-primary" type="submit" :disabled="assetUpdateBusy">保存标签</button>
            <button class="button button-secondary" type="button" :disabled="assetUpdateBusy" @click="bulkTagOpen = false">取消</button>
          </div>
        </div>
      </form>
    </div>

    <FolderDialog
      v-if="folderDialogOpen"
      :folders="folders"
      :selected-count="selectedCount"
      :busy="folderBusy"
      :error="folderError"
      @close="folderDialogOpen = false"
      @create="createFolder"
      @add="addSelection"
    />
    <MediaViewer
      v-if="viewerIndex !== null"
      :assets="assets"
      :index="viewerIndex"
      :current-user="user"
      @close="viewerIndex = null"
      @change="viewerIndex = $event"
      @updated="handleViewerUpdated"
    />
    <AdminPanel v-if="adminOpen" :current-user-id="user.id" @close="adminOpen = false" @imported="receiveImportedAssets" />
  </div>
</template>
