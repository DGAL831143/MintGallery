<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  CircleAlert,
  Film,
  Images,
  Leaf,
  LoaderCircle,
  LogOut,
  Settings,
  ShieldAlert,
  UserRound,
} from 'lucide-vue-next'
import { authApi, galleryApi } from '../api'
import type { Asset, User } from '../types'
import AdminPanel from './AdminPanel.vue'
import MediaViewer from './MediaViewer.vue'
import UploadPanel from './UploadPanel.vue'

const props = defineProps<{ user: User }>()
const emit = defineEmits<{ signedOut: [] }>()
const scope = ref<'SHARED' | 'PRIVATE'>('SHARED')
const assets = ref<Asset[]>([])
const cursor = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')
const viewerIndex = ref<number | null>(null)
const adminOpen = ref(false)

const scopeTitle = computed(() => (scope.value === 'SHARED' ? '家庭共享' : '仅自己可见'))

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
    const result = await galleryApi.list(scope.value, reset ? null : cursor.value)
    assets.value = reset ? result.assets : [...assets.value, ...result.assets]
    cursor.value = result.nextCursor
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '相册加载失败'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function receiveAsset(asset: Asset) {
  if (asset.visibility === scope.value) assets.value = [asset, ...assets.value]
}

function assetRatio(asset: Asset): string {
  if (!asset.width || !asset.height) return '4 / 3'
  const ratio = asset.width / asset.height
  if (ratio < 0.82) return '3 / 4'
  if (ratio > 1.8) return '16 / 9'
  return ratio > 1.08 ? '4 / 3' : '1 / 1'
}

async function signOut() {
  await authApi.logout().catch(() => undefined)
  emit('signedOut')
}

watch(scope, () => void load(true))
onMounted(() => void load(true))
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark"><Leaf :size="21" /></div>
        <strong>MintGallery</strong>
      </div>

      <div class="topbar-actions">
        <UploadPanel @uploaded="receiveAsset" />
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
      <div class="gallery-heading">
        <div>
          <span class="eyebrow">YOUR MEMORIES</span>
          <h1>{{ scopeTitle }}</h1>
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
        <strong>{{ scope === 'SHARED' ? '家庭相册还是空的' : '这里留给自己的照片' }}</strong>
        <span>使用右上角的上传按钮添加第一批照片或视频。</span>
      </div>

      <section v-else class="media-grid" aria-label="照片墙">
        <button
          v-for="(asset, index) in assets"
          :key="asset.id"
          class="media-tile"
          :style="{ aspectRatio: assetRatio(asset) }"
          :aria-label="`查看 ${asset.originalName}`"
          @click="viewerIndex = index"
        >
          <img v-if="asset.thumbnailUrl" :src="asset.thumbnailUrl" :alt="asset.originalName" loading="lazy" />
          <div v-else class="tile-placeholder">
            <Film v-if="asset.type === 'VIDEO'" :size="31" />
            <CircleAlert v-else :size="28" />
          </div>
          <span v-if="asset.type === 'VIDEO'" class="media-badge"><Film :size="14" />视频</span>
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
