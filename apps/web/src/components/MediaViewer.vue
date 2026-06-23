<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Film,
  Info,
  LoaderCircle,
  LockKeyhole,
  Play,
  RotateCcw,
  UsersRound,
  X,
} from 'lucide-vue-next'
import { galleryApi } from '../api'
import { formatBytes, formatDate } from '../format'
import type { Asset, User } from '../types'

const props = defineProps<{ assets: Asset[]; index: number; currentUser: User }>()
const emit = defineEmits<{ close: []; change: [index: number]; updated: [asset: Asset] }>()
const asset = computed(() => props.assets[props.index])
const liveVideo = ref<HTMLVideoElement | null>(null)
const livePlaying = ref(false)
const liveRequested = ref(false)
const liveLoading = ref(false)
const liveError = ref('')
const infoOpen = ref(false)
const privacyRevealed = ref(false)
const saving = ref(false)
const actionError = ref('')

const isPrivacyHidden = computed(() => Boolean(asset.value?.privacyMasked && !privacyRevealed.value))
const canManage = computed(() => Boolean(
  asset.value && (props.currentUser.role === 'ADMIN' || asset.value.ownerId === props.currentUser.id),
))
const typeLabel = computed(() => {
  if (asset.value?.type === 'VIDEO') return '视频'
  if (asset.value?.type === 'LIVE_PHOTO') return '实况照片'
  return '照片'
})
const visibilityLabel = computed(() => asset.value?.visibility === 'SHARED' ? '家庭共享' : '仅自己可见')
const privacyLabel = computed(() => asset.value?.privacyMasked ? '防窥遮挡' : '普通显示')

async function playLive() {
  if (isPrivacyHidden.value) return
  if (asset.value?.type !== 'LIVE_PHOTO' || !asset.value.liveVideoUrl) return
  liveError.value = ''
  liveLoading.value = true
  if (!liveRequested.value) {
    liveRequested.value = true
    await nextTick()
  }
  if (!liveVideo.value) return
  try {
    liveVideo.value.currentTime = 0
    await liveVideo.value.play()
    livePlaying.value = true
    liveLoading.value = false
  } catch {
    livePlaying.value = false
    liveLoading.value = false
    liveError.value = '动态部分暂时无法播放'
  }
}

function stopLive() {
  if (liveVideo.value) {
    liveVideo.value.pause()
    liveVideo.value.currentTime = 0
  }
  livePlaying.value = false
}

function resetLive() {
  stopLive()
  liveRequested.value = false
  liveLoading.value = false
  liveError.value = ''
}

function liveFailed() {
  livePlaying.value = false
  liveLoading.value = false
  liveError.value = '动态部分加载失败，静态照片仍可查看'
}

function toggleLive() {
  if (livePlaying.value) stopLive()
  else void playLive()
}

function revealPrivacy() {
  privacyRevealed.value = true
}

async function updateAsset(changes: { visibility?: 'SHARED' | 'PRIVATE'; privacyMasked?: boolean }) {
  if (!asset.value || !canManage.value) return
  saving.value = true
  actionError.value = ''
  try {
    const result = await galleryApi.updateAsset(asset.value.id, changes)
    if (changes.privacyMasked === true) privacyRevealed.value = false
    emit('updated', result.asset)
  } catch (reason) {
    actionError.value = reason instanceof Error ? reason.message : '照片状态修改失败'
  } finally {
    saving.value = false
  }
}

function previous() {
  stopLive()
  if (props.index > 0) emit('change', props.index - 1)
}

function next() {
  stopLive()
  if (props.index < props.assets.length - 1) emit('change', props.index + 1)
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
  if (event.key === 'ArrowLeft') previous()
  if (event.key === 'ArrowRight') next()
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  resetLive()
  window.removeEventListener('keydown', onKey)
})
watch(() => asset.value?.id, () => {
  resetLive()
  privacyRevealed.value = false
  actionError.value = ''
})
</script>

<template>
  <div v-if="asset" class="viewer" role="dialog" aria-modal="true" :aria-label="asset.originalName">
    <header class="viewer-toolbar">
      <div class="viewer-title">
        <strong>{{ asset.originalName }}</strong>
        <span>{{ asset.ownerName }} · {{ formatDate(asset.uploadedAt) }}</span>
      </div>
      <a class="icon-button viewer-action" :href="asset.originalUrl" target="_blank" title="打开原始文件">
        <Download :size="20" />
      </a>
      <a
        v-if="asset.type === 'LIVE_PHOTO' && asset.liveVideoUrl"
        class="icon-button viewer-action"
        :href="asset.liveOriginalUrl ?? asset.liveVideoUrl"
        target="_blank"
        title="打开实况视频原件"
      >
        <Film :size="20" />
      </a>
      <button class="icon-button viewer-action" type="button" :class="{ active: infoOpen }" title="照片信息" @click="infoOpen = !infoOpen">
        <Info :size="20" />
      </button>
      <button class="icon-button viewer-action" type="button" title="关闭" @click="emit('close')">
        <X :size="22" />
      </button>
    </header>

    <button class="viewer-nav viewer-prev" :disabled="index === 0" title="上一项" @click="previous">
      <ChevronLeft :size="28" />
    </button>

    <div class="viewer-stage" :class="{ 'viewer-stage-privacy': isPrivacyHidden }">
      <div v-if="isPrivacyHidden" class="viewer-privacy-cover">
        <img
          v-if="asset.previewUrl || asset.thumbnailUrl"
          :src="asset.previewUrl ?? asset.thumbnailUrl ?? ''"
          :alt="asset.originalName"
          draggable="false"
        />
        <div v-else class="viewer-privacy-placeholder">
          <EyeOff :size="46" />
        </div>
        <span class="privacy-mask-label"><EyeOff :size="16" />防窥照片</span>
        <button class="privacy-reveal-button" type="button" @click="revealPrivacy">
          <Eye :size="19" />查看原图
        </button>
      </div>
      <div
        v-else-if="asset.type === 'LIVE_PHOTO' && asset.previewUrl && asset.liveVideoUrl"
        class="live-photo-player"
        @mouseenter="playLive"
        @mouseleave="stopLive"
        @pointerdown.prevent="playLive"
        @pointerup="stopLive"
        @pointercancel="stopLive"
      >
        <img :src="asset.previewUrl" :alt="asset.originalName" draggable="false" />
        <video
          ref="liveVideo"
          :src="liveRequested ? asset.liveVideoUrl : undefined"
          :class="{ active: livePlaying }"
          playsinline
          muted
          preload="none"
          @waiting="liveLoading = true"
          @playing="liveLoading = false"
          @error="liveFailed"
          @ended="stopLive"
        ></video>
        <span class="live-viewer-badge">LIVE</span>
        <button
          class="live-play-button"
          type="button"
          :title="livePlaying ? '停止实况' : liveError ? '重试实况' : '播放实况'"
          @mouseenter.stop
          @pointerdown.stop
          @pointerup.stop
          @click.stop="toggleLive"
        >
          <LoaderCircle v-if="liveLoading" class="spin" :size="18" />
          <RotateCcw v-else-if="liveError" :size="18" />
          <Play v-else-if="!livePlaying" :size="18" fill="currentColor" />
          <span>{{ liveLoading ? '正在加载' : livePlaying ? '正在播放' : liveError ? '重新播放' : '播放实况' }}</span>
        </button>
        <span v-if="liveError" class="live-play-error">{{ liveError }}</span>
      </div>
      <img
        v-else-if="asset.type === 'IMAGE' && asset.previewUrl"
        :src="asset.previewUrl"
        :alt="asset.originalName"
        draggable="false"
      />
      <video v-else-if="asset.type === 'VIDEO'" :src="asset.originalUrl" controls playsinline preload="metadata"></video>
      <div v-else class="viewer-fallback">
        <Film :size="42" />
        <strong>暂时无法生成预览</strong>
        <span>原始文件已经保留，可以通过右上角打开。</span>
      </div>
    </div>

    <aside v-if="infoOpen" class="viewer-info-panel" aria-label="照片信息">
      <header>
        <div>
          <span>INFO</span>
          <strong>照片信息</strong>
        </div>
        <button class="icon-button viewer-action" type="button" title="关闭信息" @click="infoOpen = false"><X :size="19" /></button>
      </header>
      <dl>
        <div><dt>文件名</dt><dd>{{ asset.originalName }}</dd></div>
        <div><dt>类型</dt><dd>{{ typeLabel }}</dd></div>
        <div><dt>大小</dt><dd>{{ formatBytes(asset.sizeBytes) }}</dd></div>
        <div><dt>拍摄时间</dt><dd>{{ asset.shootingTime ? formatDate(asset.shootingTime) : '未读取' }}</dd></div>
        <div><dt>上传时间</dt><dd>{{ formatDate(asset.uploadedAt) }}</dd></div>
        <div><dt>上传者</dt><dd>{{ asset.ownerName }}</dd></div>
        <div><dt>可见范围</dt><dd>{{ visibilityLabel }}</dd></div>
        <div><dt>隐私遮挡</dt><dd>{{ privacyLabel }}</dd></div>
      </dl>
      <div v-if="canManage" class="viewer-info-actions">
        <button class="button button-secondary" type="button" :disabled="saving" @click="updateAsset({ privacyMasked: !asset.privacyMasked })">
          <EyeOff v-if="!asset.privacyMasked" :size="17" />
          <Eye v-else :size="17" />
          {{ asset.privacyMasked ? '取消防窥' : '设为防窥' }}
        </button>
        <button class="button button-secondary" type="button" :disabled="saving" @click="updateAsset({ visibility: asset.visibility === 'SHARED' ? 'PRIVATE' : 'SHARED' })">
          <LockKeyhole v-if="asset.visibility === 'SHARED'" :size="17" />
          <UsersRound v-else :size="17" />
          {{ asset.visibility === 'SHARED' ? '设为仅自己' : '设为家庭共享' }}
        </button>
      </div>
      <p v-else class="viewer-info-note">只有上传者或管理员可以修改照片状态。</p>
      <p v-if="actionError" class="viewer-info-error">{{ actionError }}</p>
    </aside>

    <button
      class="viewer-nav viewer-next"
      :disabled="index === assets.length - 1"
      title="下一项"
      @click="next"
    >
      <ChevronRight :size="28" />
    </button>

    <footer class="viewer-meta">
      <Info :size="17" />
      <span>{{ asset.type === 'VIDEO' ? '视频' : asset.type === 'LIVE_PHOTO' ? '实况照片' : '照片' }}</span>
      <span>{{ formatBytes(asset.sizeBytes) }}</span>
      <span>{{ asset.visibility === 'SHARED' ? '家庭共享' : '仅自己可见' }}</span>
      <span v-if="asset.privacyMasked" class="single-copy">防窥</span>
      <span class="single-copy">仅 1 个副本</span>
    </footer>
  </div>
</template>
