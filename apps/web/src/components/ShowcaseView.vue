<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Images,
  Leaf,
  LoaderCircle,
  Pencil,
  RefreshCcw,
  Save,
  Sparkles,
  Star,
  X,
} from 'lucide-vue-next'
import { galleryApi, showcaseApi } from '../api'
import type { Asset, User } from '../types'
import MediaViewer from './MediaViewer.vue'

const props = defineProps<{ user: User }>()
const emit = defineEmits<{ close: [] }>()

const assets = ref<Asset[]>([])
const configuredAssetIds = ref<string[]>([])
const defaulted = ref(true)
const loading = ref(true)
const error = ref('')
const pickerOpen = ref(false)
const pickerLoading = ref(false)
const pickerSaving = ref(false)
const pickerError = ref('')
const candidateAssets = ref<Asset[]>([])
const selectedIds = ref(new Set<string>())
const viewerIndex = ref<number | null>(null)

const canEdit = computed(() => props.user.role === 'ADMIN')

function mediaSource(asset: Asset): string | null {
  return asset.previewUrl ?? asset.thumbnailUrl ?? null
}

function assetTitle(asset: Asset): string {
  return asset.tags.length > 0 ? asset.tags.join(' · ') : asset.ownerName
}

function isShowcaseCandidate(asset: Asset): boolean {
  return asset.visibility === 'SHARED' &&
    asset.status === 'READY' &&
    !asset.deletedAt &&
    !asset.privacyMasked &&
    asset.type !== 'VIDEO' &&
    Boolean(mediaSource(asset))
}

function mergeById(groups: Asset[][]): Asset[] {
  const byId = new Map<string, Asset>()
  for (const group of groups) {
    for (const asset of group) {
      if (isShowcaseCandidate(asset) && !byId.has(asset.id)) byId.set(asset.id, asset)
    }
  }
  return [...byId.values()]
}

const showcaseAssets = computed(() => assets.value.filter(isShowcaseCandidate))
const primaryAsset = computed(() => showcaseAssets.value[0] ?? null)
const selectedCount = computed(() => selectedIds.value.size)
const showcaseColumns = computed(() => [
  { id: 'left', className: 'showcase-column-left', items: showcaseAssets.value.filter((_, index) => index % 3 === 0) },
  { id: 'center', className: 'showcase-column-center', items: showcaseAssets.value.filter((_, index) => index % 3 === 1) },
  { id: 'right', className: 'showcase-column-right', items: showcaseAssets.value.filter((_, index) => index % 3 === 2) },
])

async function loadShowcase() {
  loading.value = true
  error.value = ''
  try {
    const result = await showcaseApi.get()
    assets.value = result.assets
    configuredAssetIds.value = result.configuredAssetIds
    defaulted.value = result.defaulted
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '展示页加载失败'
  } finally {
    loading.value = false
  }
}

async function loadCandidates() {
  pickerLoading.value = true
  pickerError.value = ''
  try {
    const [favorites, images, livePhotos] = await Promise.all([
      galleryApi.list('SHARED', null, null, null, null, 'FAVORITES', 'ALL', 'ALL', 60),
      galleryApi.list('SHARED', null, null, null, null, 'ALL', 'IMAGE', 'ALL', 60),
      galleryApi.list('SHARED', null, null, null, null, 'ALL', 'LIVE_PHOTO', 'ALL', 60),
    ])
    candidateAssets.value = mergeById([favorites.assets, images.assets, livePhotos.assets, assets.value])
  } catch (reason) {
    pickerError.value = reason instanceof Error ? reason.message : '候选图片加载失败'
  } finally {
    pickerLoading.value = false
  }
}

function openPicker() {
  if (!canEdit.value) return
  selectedIds.value = new Set(
    configuredAssetIds.value.length > 0
      ? configuredAssetIds.value
      : showcaseAssets.value.map((asset) => asset.id),
  )
  pickerError.value = ''
  pickerOpen.value = true
  void loadCandidates()
}

function closePicker() {
  if (pickerSaving.value) return
  pickerOpen.value = false
}

function toggleCandidate(assetId: string) {
  const next = new Set(selectedIds.value)
  if (next.has(assetId)) {
    next.delete(assetId)
    pickerError.value = ''
  } else if (next.size >= 13) {
    pickerError.value = '展示页最多选择 13 张图片'
  } else {
    next.add(assetId)
    pickerError.value = ''
  }
  selectedIds.value = next
}

function orderedSelectedIds(): string[] {
  const ordered = [...candidateAssets.value, ...assets.value].map((asset) => asset.id)
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ordered) {
    if (selectedIds.value.has(id) && !seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  for (const id of selectedIds.value) {
    if (!seen.has(id)) result.push(id)
  }
  return result
}

async function saveSelection(assetIds = orderedSelectedIds()) {
  pickerSaving.value = true
  pickerError.value = ''
  try {
    const result = await showcaseApi.update(assetIds)
    assets.value = result.assets
    configuredAssetIds.value = result.configuredAssetIds
    defaulted.value = result.defaulted
    pickerOpen.value = false
  } catch (reason) {
    pickerError.value = reason instanceof Error ? reason.message : '展示页保存失败'
  } finally {
    pickerSaving.value = false
  }
}

function openAsset(asset: Asset) {
  const index = showcaseAssets.value.findIndex((item) => item.id === asset.id)
  if (index >= 0) viewerIndex.value = index
}

function handleViewerUpdated(updatedAsset: Asset) {
  if (!isShowcaseCandidate(updatedAsset)) {
    assets.value = assets.value.filter((asset) => asset.id !== updatedAsset.id)
    viewerIndex.value = null
    return
  }
  assets.value = assets.value.map((asset) => asset.id === updatedAsset.id ? updatedAsset : asset)
}

onMounted(() => {
  void loadShowcase()
})
</script>

<template>
  <div class="showcase-shell">
    <header class="showcase-topbar">
      <button class="icon-button" type="button" title="返回相册" @click="emit('close')">
        <ArrowLeft :size="21" />
      </button>
      <div class="showcase-brand">
        <div class="brand-mark"><Leaf :size="21" /></div>
        <strong>MintGallery</strong>
      </div>
      <button v-if="canEdit" class="button button-secondary showcase-edit-button" type="button" @click="openPicker">
        <Pencil :size="18" />编辑展示
      </button>
    </header>

    <main class="showcase-main">
      <section v-if="loading" class="gallery-state">
        <LoaderCircle class="spin" :size="30" /><span>正在打开展示页</span>
      </section>
      <section v-else-if="error" class="gallery-state error-state">
        <CircleAlert :size="30" /><strong>展示页暂时打不开</strong><span>{{ error }}</span>
        <button class="button button-secondary" type="button" @click="loadShowcase"><RefreshCcw :size="18" />重新加载</button>
      </section>
      <section v-else-if="showcaseAssets.length === 0" class="gallery-state empty-state">
        <div class="empty-visual"><Images :size="44" /><Leaf :size="24" /></div>
        <strong>还没有展示图片</strong>
        <span>收藏家庭共享照片后会自动出现在这里。</span>
        <button v-if="canEdit" class="button button-primary" type="button" @click="openPicker"><Pencil :size="18" />选择图片</button>
      </section>
      <template v-else>
        <section class="showcase-hero">
          <div class="showcase-hero-copy">
            <span class="eyebrow">SHOWCASE</span>
            <h1>MintGallery</h1>
            <p>{{ defaulted ? '来自收藏的家庭影像' : '共用展示集' }}</p>
          </div>
          <button v-if="primaryAsset" class="showcase-hero-photo" type="button" @click="openAsset(primaryAsset)">
            <img :src="mediaSource(primaryAsset) ?? ''" :alt="assetTitle(primaryAsset)" />
          </button>
        </section>

        <section class="showcase-wall" aria-label="展示图片墙">
          <div
            v-for="column in showcaseColumns"
            :key="column.id"
            class="showcase-column"
            :class="column.className"
          >
            <button
              v-for="asset in column.items"
              :key="asset.id"
              class="showcase-photo"
              type="button"
              @click="openAsset(asset)"
            >
              <img :src="mediaSource(asset) ?? ''" :alt="assetTitle(asset)" loading="lazy" />
              <span v-if="asset.favorite" class="showcase-photo-badge"><Star :size="14" fill="currentColor" /></span>
              <span v-if="asset.type === 'LIVE_PHOTO'" class="showcase-live-badge"><Sparkles :size="14" />LIVE</span>
            </button>
          </div>
        </section>
      </template>
    </main>

    <div v-if="pickerOpen" class="modal-backdrop showcase-picker-backdrop" role="dialog" aria-modal="true" aria-label="编辑展示图片">
      <section class="showcase-picker">
        <header class="panel-header">
          <div>
            <span class="eyebrow">SHOWCASE</span>
            <h2>编辑展示图片</h2>
          </div>
          <button class="icon-button" type="button" title="关闭" :disabled="pickerSaving" @click="closePicker"><X :size="20" /></button>
        </header>

        <div class="showcase-picker-body">
          <div class="showcase-picker-summary">
            <strong>{{ selectedCount }} / 13</strong>
            <span>共用同一套展示图片</span>
          </div>
          <p v-if="pickerError" class="form-error">{{ pickerError }}</p>
          <div v-if="pickerLoading" class="gallery-state showcase-picker-loading">
            <LoaderCircle class="spin" :size="28" /><span>正在读取候选图片</span>
          </div>
          <div v-else-if="candidateAssets.length === 0" class="gallery-state showcase-picker-loading">
            <Images :size="32" /><span>没有可用于展示的家庭共享图片</span>
          </div>
          <div v-else class="showcase-picker-grid">
            <button
              v-for="asset in candidateAssets"
              :key="asset.id"
              class="showcase-picker-item"
              :class="{ selected: selectedIds.has(asset.id) }"
              type="button"
              @click="toggleCandidate(asset.id)"
            >
              <img :src="mediaSource(asset) ?? ''" :alt="assetTitle(asset)" loading="lazy" />
              <span class="showcase-picker-check"><Check :size="17" /></span>
            </button>
          </div>
        </div>

        <footer class="showcase-picker-actions">
          <button class="button button-secondary" type="button" :disabled="pickerSaving" @click="saveSelection([])">
            <Star :size="18" />使用收藏默认
          </button>
          <button class="button button-primary" type="button" :disabled="pickerSaving" @click="saveSelection()">
            <LoaderCircle v-if="pickerSaving" class="spin" :size="18" />
            <Save v-else :size="18" />
            保存展示
          </button>
        </footer>
      </section>
    </div>

    <MediaViewer
      v-if="viewerIndex !== null"
      :assets="showcaseAssets"
      :index="viewerIndex"
      :current-user="user"
      @close="viewerIndex = null"
      @change="viewerIndex = $event"
      @updated="handleViewerUpdated"
    />
  </div>
</template>
