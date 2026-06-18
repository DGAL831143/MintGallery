<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { ChevronLeft, ChevronRight, Download, Film, Info, X } from 'lucide-vue-next'
import { formatBytes, formatDate } from '../format'
import type { Asset } from '../types'

const props = defineProps<{ assets: Asset[]; index: number }>()
const emit = defineEmits<{ close: []; change: [index: number] }>()
const asset = computed(() => props.assets[props.index])

function previous() {
  if (props.index > 0) emit('change', props.index - 1)
}

function next() {
  if (props.index < props.assets.length - 1) emit('change', props.index + 1)
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
  if (event.key === 'ArrowLeft') previous()
  if (event.key === 'ArrowRight') next()
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
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
      <button class="icon-button viewer-action" type="button" title="关闭" @click="emit('close')">
        <X :size="22" />
      </button>
    </header>

    <button class="viewer-nav viewer-prev" :disabled="index === 0" title="上一项" @click="previous">
      <ChevronLeft :size="28" />
    </button>

    <div class="viewer-stage">
      <img
        v-if="asset.type === 'IMAGE' && asset.previewUrl"
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
      <span>{{ asset.type === 'VIDEO' ? '视频' : '照片' }}</span>
      <span>{{ formatBytes(asset.sizeBytes) }}</span>
      <span>{{ asset.visibility === 'SHARED' ? '家庭共享' : '仅自己可见' }}</span>
      <span class="single-copy">仅 1 个副本</span>
    </footer>
  </div>
</template>
