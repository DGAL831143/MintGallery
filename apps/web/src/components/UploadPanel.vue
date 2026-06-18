<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, CircleAlert, CloudUpload, FileImage, LoaderCircle, X } from 'lucide-vue-next'
import { uploadAsset } from '../api'
import { formatBytes } from '../format'
import type { Asset, UploadItem } from '../types'

const emit = defineEmits<{ uploaded: [asset: Asset] }>()
const input = ref<HTMLInputElement | null>(null)
const items = ref<UploadItem[]>([])
const visibility = ref<'SHARED' | 'PRIVATE'>('SHARED')
const open = ref(false)
const running = ref(false)
const completed = computed(() => items.value.filter((item) => item.status === 'DONE').length)

function chooseFiles() {
  input.value?.click()
}

async function selected(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files ?? [])
  target.value = ''
  if (!files.length) return

  items.value = files.map((file) => ({
    id: crypto.randomUUID(),
    file,
    progress: 0,
    status: 'WAITING',
    error: null,
  }))
  open.value = true
  await runQueue()
}

async function runQueue() {
  if (running.value) return
  running.value = true
  for (const item of items.value) {
    if (item.status !== 'WAITING' && item.status !== 'FAILED') continue
    item.status = 'UPLOADING'
    item.error = null
    try {
      const asset = await uploadAsset(item.file, visibility.value, (progress) => {
        item.progress = progress
      })
      item.progress = 100
      item.status = 'DONE'
      emit('uploaded', asset)
    } catch (reason) {
      item.status = 'FAILED'
      item.error = reason instanceof Error ? reason.message : '上传失败'
    }
  }
  running.value = false
}

function retry(item: UploadItem) {
  item.status = 'WAITING'
  item.progress = 0
  void runQueue()
}
</script>

<template>
  <input
    ref="input"
    class="visually-hidden"
    type="file"
    multiple
    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,.heic,.heif,.mov"
    @change="selected"
  />
  <button class="button button-primary upload-trigger" type="button" @click="chooseFiles">
    <CloudUpload :size="18" />
    <span>上传</span>
  </button>

  <div v-if="open" class="upload-drawer" role="dialog" aria-label="上传队列">
    <header class="upload-drawer-header">
      <div>
        <strong>上传队列</strong>
        <span>{{ completed }}/{{ items.length }} 已完成</span>
      </div>
      <button class="icon-button" type="button" title="收起上传队列" @click="open = false">
        <X :size="20" />
      </button>
    </header>

    <div class="segmented compact" aria-label="上传可见范围">
      <button :class="{ active: visibility === 'SHARED' }" :disabled="running" @click="visibility = 'SHARED'">家庭共享</button>
      <button :class="{ active: visibility === 'PRIVATE' }" :disabled="running" @click="visibility = 'PRIVATE'">仅自己</button>
    </div>

    <div class="upload-list">
      <article v-for="item in items" :key="item.id" class="upload-row">
        <div class="upload-file-icon"><FileImage :size="19" /></div>
        <div class="upload-file-copy">
          <strong>{{ item.file.name }}</strong>
          <span>{{ formatBytes(item.file.size) }}</span>
          <div class="progress-track"><span :style="{ width: `${item.progress}%` }"></span></div>
          <small v-if="item.error">{{ item.error }}</small>
        </div>
        <LoaderCircle v-if="item.status === 'UPLOADING'" class="spin status-uploading" :size="19" />
        <Check v-else-if="item.status === 'DONE'" class="status-done" :size="19" />
        <button v-else-if="item.status === 'FAILED'" class="retry-button" title="重试" @click="retry(item)">
          <CircleAlert :size="19" />
        </button>
      </article>
    </div>
  </div>
</template>
