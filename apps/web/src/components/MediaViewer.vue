<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Download, Film, Info, Play, X } from 'lucide-vue-next'
import { formatBytes, formatDate } from '../format'
import type { Asset } from '../types'

const props = defineProps<{ assets: Asset[]; index: number }>()
const emit = defineEmits<{ close: []; change: [index: number] }>()
const asset = computed(() => props.assets[props.index])
const liveVideo = ref<HTMLVideoElement | null>(null)
const livePlaying = ref(false)

async function playLive() {
  if (asset.value?.type !== 'LIVE_PHOTO' || !liveVideo.value) return
  livePlaying.value = true
  try {
    liveVideo.value.currentTime = 0
    await liveVideo.value.play()
  } catch {
    livePlaying.value = false
  }
}

function stopLive() {
  if (liveVideo.value) {
    liveVideo.value.pause()
    liveVideo.value.currentTime = 0
  }
  livePlaying.value = false
}

function toggleLive() {
  if (livePlaying.value) stopLive()
  else void playLive()
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
  stopLive()
  window.removeEventListener('keydown', onKey)
})
watch(() => asset.value?.id, stopLive)
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
        :href="asset.liveVideoUrl"
        target="_blank"
        title="打开实况视频原件"
      >
        <Film :size="20" />
      </a>
      <button class="icon-button viewer-action" type="button" title="关闭" @click="emit('close')">
        <X :size="22" />
      </button>
    </header>

    <button class="viewer-nav viewer-prev" :disabled="index === 0" title="上一项" @click="previous">
      <ChevronLeft :size="28" />
    </button>

    <div class="viewer-stage">
      <div
        v-if="asset.type === 'LIVE_PHOTO' && asset.previewUrl && asset.liveVideoUrl"
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
          :src="asset.liveVideoUrl"
          :class="{ active: livePlaying }"
          playsinline
          muted
          preload="metadata"
          @ended="stopLive"
        ></video>
        <span class="live-viewer-badge">LIVE</span>
        <button
          class="live-play-button"
          type="button"
          :title="livePlaying ? '停止实况' : '播放实况'"
          @mouseenter.stop
          @pointerdown.stop
          @pointerup.stop
          @click.stop="toggleLive"
        >
          <Play v-if="!livePlaying" :size="18" fill="currentColor" />
          <span>{{ livePlaying ? '正在播放' : '播放实况' }}</span>
        </button>
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
      <span class="single-copy">仅 1 个副本</span>
    </footer>
  </div>
</template>
