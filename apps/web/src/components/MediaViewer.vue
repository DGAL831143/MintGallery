<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Crop,
  Download,
  Eye,
  EyeOff,
  Film,
  FlipHorizontal2,
  FlipVertical2,
  Info,
  LoaderCircle,
  LockKeyhole,
  Play,
  RotateCcw,
  RotateCw,
  Save,
  Star,
  Tags,
  Trash2,
  Undo2,
  UsersRound,
  X,
} from 'lucide-vue-next'
import { galleryApi } from '../api'
import { formatBytes, formatDate } from '../format'
import type { Asset, ImageEditOperations, User } from '../types'

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
const tagEditing = ref(false)
const tagInput = ref('')
const editOpen = ref(false)
const editSaving = ref(false)
const editError = ref('')
const editCrop = ref<ImageEditOperations['crop']>({ x: 0, y: 0, width: 1, height: 1 })
const editRotate = ref<ImageEditOperations['rotate']>(0)
const editFlipX = ref(false)
const editFlipY = ref(false)

const isPrivacyHidden = computed(() => Boolean(asset.value?.privacyMasked && !privacyRevealed.value))
const canManage = computed(() => Boolean(
  asset.value && (props.currentUser.role === 'ADMIN' || asset.value.ownerId === props.currentUser.id),
))
const canFavorite = computed(() => Boolean(asset.value && !asset.value.deletedAt))
const canEdit = computed(() => Boolean(
  asset.value &&
  canManage.value &&
  !asset.value.deletedAt &&
  asset.value.status === 'READY' &&
  asset.value.type !== 'VIDEO' &&
  asset.value.previewUrl,
))
const typeLabel = computed(() => {
  if (asset.value?.type === 'VIDEO') return '视频'
  if (asset.value?.type === 'LIVE_PHOTO') return '实况照片'
  return '照片'
})
const visibilityLabel = computed(() => asset.value?.visibility === 'SHARED' ? '家庭共享' : '仅自己可见')
const privacyLabel = computed(() => asset.value?.privacyMasked ? '防窥遮挡' : '普通显示')
const favoriteLabel = computed(() => asset.value?.favorite ? '已收藏' : '未收藏')
const displayTitle = computed(() => {
  if (!asset.value) return ''
  return asset.value.tags.length > 0 ? asset.value.tags.join(' · ') : '未设置标签'
})

const editTransform = computed(() =>
  `rotate(${editRotate.value}deg) scale(${editFlipX.value ? -1 : 1}, ${editFlipY.value ? -1 : 1})`)
const editCropStyle = computed(() => ({
  left: `${editCrop.value.x * 100}%`,
  top: `${editCrop.value.y * 100}%`,
  width: `${editCrop.value.width * 100}%`,
  height: `${editCrop.value.height * 100}%`,
}))

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

async function updateAsset(changes: {
  visibility?: 'SHARED' | 'PRIVATE'
  privacyMasked?: boolean
  favorite?: boolean
  tags?: string[]
  deleted?: boolean
}): Promise<boolean> {
  const favoriteOnly = Object.prototype.hasOwnProperty.call(changes, 'favorite') &&
    Object.keys(changes).every((key) => key === 'favorite')
  if (!asset.value || (!canManage.value && !favoriteOnly)) return false
  saving.value = true
  actionError.value = ''
  try {
    const result = await galleryApi.updateAsset(asset.value.id, changes)
    if (changes.privacyMasked === true) privacyRevealed.value = false
    emit('updated', result.asset)
    return true
  } catch (reason) {
    actionError.value = reason instanceof Error ? reason.message : '照片状态修改失败'
    return false
  } finally {
    saving.value = false
  }
}

function startTagEdit() {
  tagInput.value = asset.value?.tags.join('\n') ?? ''
  tagEditing.value = true
  actionError.value = ''
}

function cancelTagEdit() {
  tagInput.value = asset.value?.tags.join('\n') ?? ''
  tagEditing.value = false
}

async function saveTags() {
  const ok = await updateAsset({ tags: cleanTagInput(tagInput.value) })
  if (ok) tagEditing.value = false
}

function resetEditorControls() {
  editCrop.value = { x: 0, y: 0, width: 1, height: 1 }
  editRotate.value = 0
  editFlipX.value = false
  editFlipY.value = false
  editError.value = ''
}

function closeEditor() {
  editOpen.value = false
  editError.value = ''
}

function openEditor() {
  if (!canEdit.value || isPrivacyHidden.value) return
  stopLive()
  resetEditorControls()
  editOpen.value = true
}

function setCropValue(field: keyof ImageEditOperations['crop'], value: number) {
  if (!Number.isFinite(value)) return
  const nextCrop = { ...editCrop.value, [field]: value }
  nextCrop.width = Math.min(Math.max(nextCrop.width, 0.05), 1)
  nextCrop.height = Math.min(Math.max(nextCrop.height, 0.05), 1)
  nextCrop.x = Math.min(Math.max(nextCrop.x, 0), 1 - nextCrop.width)
  nextCrop.y = Math.min(Math.max(nextCrop.y, 0), 1 - nextCrop.height)
  if (nextCrop.x + nextCrop.width > 1) nextCrop.width = 1 - nextCrop.x
  if (nextCrop.y + nextCrop.height > 1) nextCrop.height = 1 - nextCrop.y
  editCrop.value = nextCrop
}

function updateCropField(field: keyof ImageEditOperations['crop'], event: Event) {
  const target = event.target as HTMLInputElement
  setCropValue(field, Number(target.value))
}

function rotateEditor(degrees: -90 | 90) {
  editRotate.value = ((editRotate.value + degrees + 360) % 360) as ImageEditOperations['rotate']
}

async function saveEdit() {
  if (!asset.value || !canEdit.value) return
  editSaving.value = true
  editError.value = ''
  try {
    const result = await galleryApi.editAsset(asset.value.id, {
      crop: editCrop.value,
      rotate: editRotate.value,
      flipX: editFlipX.value,
      flipY: editFlipY.value,
    })
    emit('updated', result.asset)
    closeEditor()
  } catch (reason) {
    editError.value = reason instanceof Error ? reason.message : '照片编辑保存失败'
  } finally {
    editSaving.value = false
  }
}

async function resetSavedEdit() {
  if (!asset.value || !asset.value.edited || !canManage.value) return
  saving.value = true
  actionError.value = ''
  try {
    const result = await galleryApi.resetAssetEdit(asset.value.id)
    emit('updated', result.asset)
  } catch (reason) {
    actionError.value = reason instanceof Error ? reason.message : '恢复原图失败'
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
  if (event.key === 'Escape') {
    if (editOpen.value) closeEditor()
    else emit('close')
  }
  if (editOpen.value) return
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
  tagInput.value = asset.value?.tags.join('\n') ?? ''
  tagEditing.value = false
  closeEditor()
  resetEditorControls()
})
</script>

<template>
  <div v-if="asset" class="viewer" role="dialog" aria-modal="true" :aria-label="displayTitle">
    <header class="viewer-toolbar">
      <div class="viewer-title">
        <strong>{{ displayTitle }}</strong>
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
      <button
        v-if="canFavorite"
        class="icon-button viewer-action"
        type="button"
        :class="{ active: asset.favorite }"
        :title="asset.favorite ? '取消收藏' : '收藏'"
        :disabled="saving"
        @click="updateAsset({ favorite: !asset.favorite })"
      >
        <Star :size="20" :fill="asset.favorite ? 'currentColor' : 'none'" />
      </button>
      <button
        v-if="canEdit"
        class="icon-button viewer-action"
        type="button"
        :class="{ active: editOpen }"
        title="编辑照片"
        :disabled="saving || editSaving || isPrivacyHidden"
        @click="openEditor"
      >
        <Crop :size="20" />
      </button>
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
          :alt="displayTitle"
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
        <img :src="asset.previewUrl" :alt="displayTitle" draggable="false" />
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
        class="viewer-media"
        :src="asset.previewUrl"
        :alt="displayTitle"
        draggable="false"
      />
      <video
        v-else-if="asset.type === 'VIDEO'"
        class="viewer-media"
        :src="asset.originalUrl"
        controls
        playsinline
        preload="metadata"
      ></video>
      <div v-else class="viewer-fallback">
        <Film :size="42" />
        <strong>暂时无法生成预览</strong>
        <span>原始文件已经保留，可以通过右上角打开。</span>
      </div>
    </div>

    <div v-if="editOpen" class="image-editor-backdrop" role="dialog" aria-modal="true" aria-label="编辑照片">
      <form class="image-editor-panel" @submit.prevent="saveEdit">
        <header>
          <div>
            <span>EDIT</span>
            <strong>编辑照片</strong>
          </div>
          <button class="icon-button viewer-action" type="button" title="关闭编辑" :disabled="editSaving" @click="closeEditor">
            <X :size="19" />
          </button>
        </header>
        <div class="image-editor-stage">
          <div class="image-editor-canvas">
            <img
              :src="asset.previewUrl ?? asset.thumbnailUrl ?? ''"
              :alt="displayTitle"
              :style="{ transform: editTransform }"
              draggable="false"
            />
            <span class="image-editor-crop" :style="editCropStyle"></span>
          </div>
        </div>
        <div class="image-editor-tools" aria-label="编辑工具">
          <button class="icon-button viewer-action" type="button" title="向左旋转" :disabled="editSaving" @click="rotateEditor(-90)">
            <RotateCcw :size="19" />
          </button>
          <button class="icon-button viewer-action" type="button" title="向右旋转" :disabled="editSaving" @click="rotateEditor(90)">
            <RotateCw :size="19" />
          </button>
          <button
            class="icon-button viewer-action"
            type="button"
            :class="{ active: editFlipX }"
            title="水平翻转"
            :disabled="editSaving"
            @click="editFlipX = !editFlipX"
          >
            <FlipHorizontal2 :size="19" />
          </button>
          <button
            class="icon-button viewer-action"
            type="button"
            :class="{ active: editFlipY }"
            title="垂直翻转"
            :disabled="editSaving"
            @click="editFlipY = !editFlipY"
          >
            <FlipVertical2 :size="19" />
          </button>
          <button class="button button-secondary" type="button" :disabled="editSaving" @click="resetEditorControls">
            <Undo2 :size="17" />重置
          </button>
        </div>
        <div class="image-editor-sliders">
          <label>
            <span>左侧</span>
            <input type="range" min="0" max="0.95" step="0.01" :value="editCrop.x" :disabled="editSaving" @input="updateCropField('x', $event)" />
            <output>{{ Math.round(editCrop.x * 100) }}%</output>
          </label>
          <label>
            <span>顶部</span>
            <input type="range" min="0" max="0.95" step="0.01" :value="editCrop.y" :disabled="editSaving" @input="updateCropField('y', $event)" />
            <output>{{ Math.round(editCrop.y * 100) }}%</output>
          </label>
          <label>
            <span>宽度</span>
            <input type="range" min="0.05" max="1" step="0.01" :value="editCrop.width" :disabled="editSaving" @input="updateCropField('width', $event)" />
            <output>{{ Math.round(editCrop.width * 100) }}%</output>
          </label>
          <label>
            <span>高度</span>
            <input type="range" min="0.05" max="1" step="0.01" :value="editCrop.height" :disabled="editSaving" @input="updateCropField('height', $event)" />
            <output>{{ Math.round(editCrop.height * 100) }}%</output>
          </label>
        </div>
        <p v-if="editError" class="viewer-info-error">{{ editError }}</p>
        <footer>
          <button class="button button-secondary" type="button" :disabled="editSaving" @click="closeEditor">取消</button>
          <button class="button button-primary" type="submit" :disabled="editSaving">
            <LoaderCircle v-if="editSaving" class="spin" :size="17" />
            <Save v-else :size="17" />
            保存编辑
          </button>
        </footer>
      </form>
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
        <div class="viewer-info-tags-row">
          <dt>标签</dt>
          <dd>
            <div v-if="asset.tags.length > 0" class="viewer-tag-list">
              <span v-for="tag in asset.tags" :key="tag" class="viewer-tag-chip"><Tags :size="13" />{{ tag }}</span>
            </div>
            <span v-else class="viewer-tag-empty">未设置标签</span>
          </dd>
        </div>
        <div><dt>类型</dt><dd>{{ typeLabel }}</dd></div>
        <div><dt>大小</dt><dd>{{ formatBytes(asset.sizeBytes) }}</dd></div>
        <div><dt>编辑状态</dt><dd>{{ asset.edited ? '已编辑' : '原图' }}</dd></div>
        <div><dt>拍摄时间</dt><dd>{{ asset.shootingTime ? formatDate(asset.shootingTime) : '未读取' }}</dd></div>
        <div><dt>上传时间</dt><dd>{{ formatDate(asset.uploadedAt) }}</dd></div>
        <div><dt>上传者</dt><dd>{{ asset.ownerName }}</dd></div>
        <div><dt>可见范围</dt><dd>{{ visibilityLabel }}</dd></div>
        <div><dt>隐私遮挡</dt><dd>{{ privacyLabel }}</dd></div>
        <div><dt>收藏</dt><dd>{{ favoriteLabel }}</dd></div>
        <div v-if="asset.deletedAt"><dt>删除时间</dt><dd>{{ formatDate(asset.deletedAt) }}</dd></div>
      </dl>
      <form v-if="canManage && tagEditing" class="viewer-tag-editor" @submit.prevent="saveTags">
        <label for="asset-tags-input">编辑标签</label>
        <textarea
          id="asset-tags-input"
          v-model="tagInput"
          rows="3"
          placeholder="例如：旅行、家人、生日"
          :disabled="saving"
        ></textarea>
        <span>用逗号或换行分隔，最多 10 个标签。</span>
        <div>
          <button class="button button-primary" type="submit" :disabled="saving">保存标签</button>
          <button class="button button-secondary" type="button" :disabled="saving" @click="cancelTagEdit">取消</button>
        </div>
      </form>
      <div v-if="canFavorite" class="viewer-info-actions">
        <button class="button button-secondary" type="button" :disabled="saving" @click="updateAsset({ favorite: !asset.favorite })">
          <Star :size="17" :fill="asset.favorite ? 'currentColor' : 'none'" />
          {{ asset.favorite ? '取消收藏' : '收藏' }}
        </button>
      </div>
      <div v-if="canManage" class="viewer-info-actions">
        <button
          v-if="canEdit"
          class="button button-secondary"
          type="button"
          :disabled="saving || editSaving || isPrivacyHidden"
          @click="openEditor"
        >
          <Crop :size="17" />
          编辑照片
        </button>
        <button
          v-if="asset.edited"
          class="button button-secondary"
          type="button"
          :disabled="saving || editSaving"
          @click="resetSavedEdit"
        >
          <Undo2 :size="17" />
          恢复原图
        </button>
        <button class="button button-secondary" type="button" :disabled="saving" @click="startTagEdit">
          <Tags :size="17" />
          设置标签
        </button>
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
        <button
          class="button button-secondary"
          type="button"
          :disabled="saving"
          @click="updateAsset({ deleted: !asset.deletedAt })"
        >
          <RotateCcw v-if="asset.deletedAt" :size="17" />
          <Trash2 v-else :size="17" />
          {{ asset.deletedAt ? '恢复照片' : '移入最近删除' }}
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
      <span v-if="asset.favorite" class="single-copy">收藏</span>
      <span v-if="asset.deletedAt" class="single-copy">最近删除</span>
      <span v-if="asset.privacyMasked" class="single-copy">防窥</span>
      <span v-if="asset.edited" class="single-copy">已编辑</span>
      <span class="single-copy">仅 1 个副本</span>
    </footer>
  </div>
</template>
