<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Check,
  CircleAlert,
  Film,
  Folder,
  FolderInput,
  FolderMinus,
  FolderPlus,
  Images,
  Leaf,
  ListChecks,
  LoaderCircle,
  LogOut,
  Settings,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from 'lucide-vue-next'
import { authApi, folderApi, galleryApi } from '../api'
import type { Asset, Folder as GalleryFolder, User } from '../types'
import AdminPanel from './AdminPanel.vue'
import FolderDialog from './FolderDialog.vue'
import MediaViewer from './MediaViewer.vue'
import UploadPanel from './UploadPanel.vue'

const props = defineProps<{ user: User }>()
const emit = defineEmits<{ signedOut: [] }>()
const scope = ref<'SHARED' | 'PRIVATE'>('SHARED')
const assets = ref<Asset[]>([])
const folders = ref<GalleryFolder[]>([])
const activeFolderId = ref<string | null>(null)
const cursor = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')
const viewerIndex = ref<number | null>(null)
const adminOpen = ref(false)
const selectionMode = ref(false)
const selectedIds = ref(new Set<string>())
const folderDialogOpen = ref(false)
const folderBusy = ref(false)
const folderError = ref('')

const activeFolder = computed(() => folders.value.find((folder) => folder.id === activeFolderId.value) ?? null)
const selectedCount = computed(() => selectedIds.value.size)
const scopeTitle = computed(() => activeFolder.value?.name ?? (scope.value === 'SHARED' ? '家庭共享' : '仅自己可见'))

async function load(reset = true) {
  if (reset) {
    loading.value = true
    assets.value = []
    cursor.value = null
  } else {
    loadingMore.value = true
  }
  error.value = ''
  try {
    const result = await galleryApi.list(scope.value, reset ? null : cursor.value, activeFolderId.value)
    assets.value = reset ? result.assets : [...assets.value, ...result.assets]
    cursor.value = result.nextCursor
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '相册加载失败'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadFolders() {
  try {
    folders.value = (await folderApi.list()).folders
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '文件夹加载失败'
  }
}

function receiveAsset(asset: Asset) {
  if (!activeFolderId.value && asset.visibility === scope.value) assets.value = [asset, ...assets.value]
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
  if (activeFolderId.value === folderId) return
  activeFolderId.value = folderId
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
    await Promise.all([loadFolders(), load(true)])
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '移出文件夹失败'
  } finally {
    folderBusy.value = false
  }
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

watch([scope, activeFolderId], () => {
  leaveSelection()
  void load(true)
})
onMounted(() => {
  void Promise.all([load(true), loadFolders()])
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark"><Leaf :size="21" /></div>
        <strong>MintGallery</strong>
      </div>

      <div class="topbar-actions">
        <UploadPanel :owner-id="user.id" @uploaded="receiveAsset" />
        <button
          class="icon-button"
          :class="{ active: selectionMode }"
          :title="selectionMode ? '结束选择' : '选择照片'"
          @click="toggleSelectionMode"
        >
          <X v-if="selectionMode" :size="20" />
          <ListChecks v-else :size="20" />
        </button>
        <button v-if="user.role === 'ADMIN'" class="icon-button" title="相册管理" @click="adminOpen = true">
          <Settings :size="20" />
        </button>
        <div class="user-menu">
          <UserRound :size="17" />
          <span>{{ user.username }}</span>
        </div>
        <button class="icon-button" title="退出登录" @click="signOut"><LogOut :size="19" /></button>
      </div>
    </header>

    <aside class="copy-warning">
      <ShieldAlert :size="19" />
      <span><strong>当前仅 1 个副本。</strong>在配置第二块硬盘或云备份前，请保留手机中的原件。</span>
    </aside>

    <main class="gallery-main">
      <nav class="folder-tabs" aria-label="照片文件夹">
        <button :class="{ active: !activeFolderId }" type="button" @click="chooseFolder(null)">
          <Images :size="17" /><span>全部照片</span>
        </button>
        <button
          v-for="folder in folders"
          :key="folder.id"
          :class="{ active: activeFolderId === folder.id }"
          type="button"
          @click="chooseFolder(folder.id)"
        >
          <Folder :size="17" /><span>{{ folder.name }}</span><small>{{ folder.itemCount }}</small>
        </button>
        <button class="folder-create-button" type="button" title="新建文件夹" @click="openFolderDialog">
          <FolderPlus :size="18" /><span>新建</span>
        </button>
      </nav>

      <div class="gallery-heading">
        <div class="gallery-title-row">
          <div>
            <span class="eyebrow">{{ activeFolder ? 'PERSONAL FOLDER' : 'YOUR MEMORIES' }}</span>
            <h1>{{ scopeTitle }}</h1>
          </div>
          <button v-if="activeFolder" class="icon-button" type="button" title="删除文件夹" @click="deleteActiveFolder">
            <Trash2 :size="19" />
          </button>
        </div>
        <div class="segmented" aria-label="相册范围">
          <button :class="{ active: scope === 'SHARED' }" @click="scope = 'SHARED'">家庭共享</button>
          <button :class="{ active: scope === 'PRIVATE' }" @click="scope = 'PRIVATE'">仅自己</button>
        </div>
      </div>

      <div v-if="loading" class="gallery-state"><LoaderCircle class="spin" :size="28" /><span>正在整理照片</span></div>
      <div v-else-if="error" class="gallery-state error-state">
        <CircleAlert :size="28" /><strong>相册暂时打不开</strong><span>{{ error }}</span>
        <button class="button button-secondary" @click="load(true)">重新加载</button>
      </div>
      <div v-else-if="assets.length === 0" class="gallery-state empty-state">
        <div class="empty-visual"><Images :size="44" /><Leaf :size="24" /></div>
        <strong>{{ activeFolder ? '这个文件夹还是空的' : scope === 'SHARED' ? '家庭相册还是空的' : '这里留给自己的照片' }}</strong>
        <span>{{ activeFolder ? '进入选择模式，将照片加入这个文件夹。' : '使用右上角的上传按钮添加第一批照片或视频。' }}</span>
      </div>

      <section v-else class="media-grid" aria-label="照片墙">
        <button
          v-for="(asset, index) in assets"
          :key="asset.id"
          class="media-tile"
          :class="{ selecting: selectionMode, selected: selectedIds.has(asset.id) }"
          :style="{ aspectRatio: assetRatio(asset) }"
          :aria-label="selectionMode ? `选择 ${asset.originalName}` : `查看 ${asset.originalName}`"
          :aria-pressed="selectionMode ? selectedIds.has(asset.id) : undefined"
          @click="openAsset(asset.id, index)"
        >
          <img v-if="asset.thumbnailUrl" :src="asset.thumbnailUrl" :alt="asset.originalName" loading="lazy" />
          <div v-else class="tile-placeholder">
            <Film v-if="asset.type === 'VIDEO'" :size="31" />
            <CircleAlert v-else :size="28" />
          </div>
          <span v-if="selectionMode" class="selection-mark"><Check v-if="selectedIds.has(asset.id)" :size="17" /></span>
          <span v-if="asset.type === 'VIDEO'" class="media-badge"><Film :size="14" />视频</span>
          <span v-else-if="asset.type === 'LIVE_PHOTO'" class="media-badge live-badge"><Sparkles :size="14" />LIVE</span>
          <span v-if="asset.status === 'FAILED'" class="media-error">预览失败</span>
          <span class="media-owner">{{ asset.ownerName }}</span>
        </button>
      </section>

      <div v-if="cursor" class="load-more-wrap">
        <button class="button button-secondary" :disabled="loadingMore" @click="load(false)">
          <LoaderCircle v-if="loadingMore" class="spin" :size="18" />加载更多
        </button>
      </div>
    </main>

    <div v-if="selectionMode" class="selection-toolbar" role="toolbar" aria-label="照片整理">
      <strong>{{ selectedCount }} 个已选择</strong>
      <button class="button button-primary" type="button" :disabled="selectedCount === 0" @click="openFolderDialog">
        <FolderInput :size="18" />加入文件夹
      </button>
      <button
        v-if="activeFolder"
        class="button button-secondary"
        type="button"
        :disabled="selectedCount === 0 || folderBusy"
        @click="removeSelection"
      >
        <FolderMinus :size="18" />移出
      </button>
      <button class="icon-button" type="button" title="取消选择" @click="leaveSelection"><X :size="20" /></button>
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
      @close="viewerIndex = null"
      @change="viewerIndex = $event"
    />
    <AdminPanel v-if="adminOpen" :current-user-id="user.id" @close="adminOpen = false" />
  </div>
</template>
