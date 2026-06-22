<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Check,
  CircleAlert,
  CloudUpload,
  FileImage,
  Film,
  Images,
  LoaderCircle,
  X,
} from 'lucide-vue-next'
import { uploadLivePhoto } from '../api'
import { formatBytes } from '../format'
import { uploadResumableAsset } from '../resumableUpload'
import type { Asset, UploadItem } from '../types'

type UploadMode = 'STANDARD' | 'LIVE_PHOTO'
type LiveStatus = 'IDLE' | 'UPLOADING' | 'DONE' | 'FAILED'

const props = defineProps<{ ownerId: string }>()
const emit = defineEmits<{ uploaded: [asset: Asset] }>()
const standardInput = ref<HTMLInputElement | null>(null)
const liveInput = ref<HTMLInputElement | null>(null)
const items = ref<UploadItem[]>([])
const visibility = ref<'SHARED' | 'PRIVATE'>('SHARED')
const mode = ref<UploadMode>('STANDARD')
const open = ref(false)
const running = ref(false)
const liveFiles = ref<File[]>([])
const liveProgress = ref(0)
const liveStatus = ref<LiveStatus>('IDLE')
const liveError = ref('')
const confirmedPair = ref(false)

const completed = computed(() => items.value.filter((item) => item.status === 'DONE').length)
const livePhotoFile = computed(() => liveFiles.value.find(isLiveStill) ?? null)
const liveVideoFile = computed(() => liveFiles.value.find(isLiveVideo) ?? null)
const livePairError = computed(() => {
  if (!liveFiles.value.length) return ''
  if (liveFiles.value.length !== 2) return '请选择且只选择两个文件'
  if (!livePhotoFile.value || !liveVideoFile.value) return '需要一张 HEIC/HEIF/JPEG 图片和一个 MOV 视频'
  if (baseName(livePhotoFile.value.name) !== baseName(liveVideoFile.value.name)) {
    return '两个文件的主文件名需要相同，例如 IMG_1234.HEIC + IMG_1234.MOV'
  }
  return ''
})
const liveReady = computed(
  () => Boolean(livePhotoFile.value && liveVideoFile.value && !livePairError.value && confirmedPair.value),
)

function isLiveStill(file: File): boolean {
  return ['image/jpeg', 'image/heic', 'image/heif'].includes(file.type.toLowerCase()) ||
    /\.(heic|heif|jpe?g)$/i.test(file.name)
}

function isLiveVideo(file: File): boolean {
  return file.type.toLowerCase() === 'video/quicktime' || /\.mov$/i.test(file.name)
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').normalize('NFC').toLocaleLowerCase()
}

function chooseStandardFiles() {
  standardInput.value?.click()
}

function chooseLiveFiles() {
  liveInput.value?.click()
}

async function selectedStandard(event: Event) {
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
  await runQueue()
}

function selectedLive(event: Event) {
  const target = event.target as HTMLInputElement
  liveFiles.value = Array.from(target.files ?? [])
  target.value = ''
  liveProgress.value = 0
  liveStatus.value = 'IDLE'
  liveError.value = ''
  confirmedPair.value = false
}

async function runQueue() {
  if (running.value) return
  running.value = true
  for (const item of items.value) {
    if (item.status !== 'WAITING' && item.status !== 'FAILED') continue
    item.status = 'UPLOADING'
    item.error = null
    try {
      const asset = await uploadResumableAsset(item.file, visibility.value, props.ownerId, (progress) => {
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

async function submitLivePhoto() {
  if (!liveReady.value || !livePhotoFile.value || !liveVideoFile.value) return
  liveStatus.value = 'UPLOADING'
  liveError.value = ''
  try {
    const asset = await uploadLivePhoto(
      livePhotoFile.value,
      liveVideoFile.value,
      visibility.value,
      (progress) => { liveProgress.value = progress },
    )
    liveProgress.value = 100
    liveStatus.value = 'DONE'
    emit('uploaded', asset)
  } catch (reason) {
    liveStatus.value = 'FAILED'
    liveError.value = reason instanceof Error ? reason.message : '实况照片上传失败'
  }
}

function retry(item: UploadItem) {
  item.status = 'WAITING'
  item.progress = 0
  void runQueue()
}
</script>

<template>
  <input
    ref="standardInput"
    class="visually-hidden"
    type="file"
    multiple
    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,.heic,.heif,.mov"
    @change="selectedStandard"
  />
  <input
    ref="liveInput"
    class="visually-hidden"
    type="file"
    multiple
    accept="image/jpeg,image/heic,image/heif,video/quicktime,.jpg,.jpeg,.heic,.heif,.mov"
    @change="selectedLive"
  />

  <button class="button button-primary upload-trigger" type="button" @click="open = true">
    <CloudUpload :size="18" />
    <span>上传</span>
  </button>

  <Teleport to="body">
  <div v-if="open" class="upload-drawer" role="dialog" aria-label="上传媒体">
    <header class="upload-drawer-header">
      <div>
        <strong>{{ mode === 'STANDARD' ? '上传照片与视频' : '上传实况照片' }}</strong>
        <span v-if="mode === 'STANDARD' && items.length">{{ completed }}/{{ items.length }} 已完成</span>
        <span v-else-if="mode === 'LIVE_PHOTO' && liveStatus === 'DONE'">实况照片已保存</span>
        <span v-else>原始文件将保存在本机硬盘</span>
      </div>
      <button
        class="icon-button"
        type="button"
        title="收起上传面板"
        :disabled="running || liveStatus === 'UPLOADING'"
        @click="open = false"
      >
        <X :size="20" />
      </button>
    </header>

    <div class="segmented compact upload-mode-switch" aria-label="上传类型">
      <button :class="{ active: mode === 'STANDARD' }" :disabled="running" @click="mode = 'STANDARD'">
        普通照片/视频
      </button>
      <button :class="{ active: mode === 'LIVE_PHOTO' }" :disabled="running" @click="mode = 'LIVE_PHOTO'">
        实况照片
      </button>
    </div>

    <div class="segmented compact" aria-label="上传可见范围">
      <button :class="{ active: visibility === 'SHARED' }" :disabled="running || liveStatus === 'UPLOADING'" @click="visibility = 'SHARED'">家庭共享</button>
      <button :class="{ active: visibility === 'PRIVATE' }" :disabled="running || liveStatus === 'UPLOADING'" @click="visibility = 'PRIVATE'">仅自己</button>
    </div>

    <template v-if="mode === 'STANDARD'">
      <button class="button button-secondary choose-files-button" type="button" :disabled="running" @click="chooseStandardFiles">
        <Images :size="19" />选择照片或视频
      </button>

      <div v-if="items.length" class="upload-list">
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
    </template>

    <template v-else>
      <div class="live-format-note">
        <Film :size="20" />
        <span>选择同一次导出的 <strong>HEIC/JPEG + MOV</strong>，两个文件的主文件名需一致。</span>
      </div>

      <button class="button button-secondary choose-files-button" type="button" :disabled="liveStatus === 'UPLOADING'" @click="chooseLiveFiles">
        <Images :size="19" />选择一对文件
      </button>

      <div v-if="liveFiles.length" class="live-pair-list">
        <div v-for="file in liveFiles" :key="`${file.name}-${file.size}`" class="live-pair-row">
          <FileImage v-if="isLiveStill(file)" :size="19" />
          <Film v-else :size="19" />
          <span>{{ file.name }}</span>
          <small>{{ formatBytes(file.size) }}</small>
        </div>
      </div>

      <p v-if="livePairError" class="inline-error" role="alert">{{ livePairError }}</p>
      <label v-if="livePhotoFile && liveVideoFile && !livePairError" class="confirm-pair">
        <input v-model="confirmedPair" type="checkbox" :disabled="liveStatus === 'UPLOADING'" />
        <span>我确认这两个文件来自同一张实况照片</span>
      </label>

      <div v-if="liveFiles.length" class="live-upload-progress">
        <div class="progress-track"><span :style="{ width: `${liveProgress}%` }"></span></div>
        <span>{{ liveProgress }}%</span>
      </div>
      <p v-if="liveError" class="inline-error" role="alert">{{ liveError }}</p>
      <p v-if="liveStatus === 'DONE'" class="inline-success"><Check :size="17" />图片和 MOV 已成对保存</p>

      <button
        class="button button-primary live-submit"
        type="button"
        :disabled="!liveReady || liveStatus === 'UPLOADING' || liveStatus === 'DONE'"
        @click="submitLivePhoto"
      >
        <LoaderCircle v-if="liveStatus === 'UPLOADING'" class="spin" :size="18" />
        <CloudUpload v-else :size="18" />
        上传实况照片
      </button>
    </template>
  </div>
  </Teleport>
</template>
