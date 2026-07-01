<script setup lang="ts">
import { Check, CircleAlert, Crop, EyeOff, Film, Sparkles, Star, Trash2 } from 'lucide-vue-next'
import type { Asset } from '../types'

defineProps<{
  asset: Asset
  selected: boolean
  selecting: boolean
  ratio: string
}>()

defineEmits<{ activate: [] }>()
</script>

<template>
  <button
    class="media-tile"
    :class="{ selecting, selected, 'privacy-masked': asset.privacyMasked, favorite: asset.favorite }"
    :style="{ aspectRatio: ratio }"
    :aria-label="selecting ? `选择 ${asset.originalName}` : `查看 ${asset.originalName}`"
    :aria-pressed="selecting ? selected : undefined"
    @click="$emit('activate')"
  >
    <img v-if="asset.thumbnailUrl" :src="asset.thumbnailUrl" :alt="asset.originalName" loading="lazy" />
    <div v-else class="tile-placeholder">
      <Film v-if="asset.type === 'VIDEO'" :size="31" />
      <CircleAlert v-else :size="28" />
    </div>
    <span v-if="selecting" class="selection-mark"><Check v-if="selected" :size="17" /></span>
    <span v-if="asset.favorite" class="favorite-badge"><Star :size="14" fill="currentColor" />收藏</span>
    <span v-if="asset.deletedAt" class="deleted-badge"><Trash2 :size="14" />最近删除</span>
    <span v-if="asset.privacyMasked" class="privacy-badge"><EyeOff :size="14" />防窥</span>
    <span v-if="asset.edited" class="edited-badge"><Crop :size="14" />已编辑</span>
    <span v-if="asset.type === 'VIDEO'" class="media-badge"><Film :size="14" />视频</span>
    <span v-else-if="asset.type === 'LIVE_PHOTO'" class="media-badge live-badge"><Sparkles :size="14" />LIVE</span>
    <span v-if="asset.status === 'FAILED'" class="media-error">预览失败</span>
    <span class="media-owner">{{ asset.ownerName }}</span>
  </button>
</template>
