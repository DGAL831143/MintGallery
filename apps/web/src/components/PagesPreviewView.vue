<script setup lang="ts">
import { ref } from 'vue'
import { ExternalLink, Github, Globe2, Leaf, X } from 'lucide-vue-next'

const previewOpen = ref(false)
const sampleImageUrl = `${import.meta.env.BASE_URL}login-album.webp`
</script>

<template>
  <div class="app-shell pages-preview">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark"><Leaf :size="21" /></div>
        <strong>MintGallery</strong>
      </div>

      <div class="topbar-actions">
        <div class="user-menu"><Globe2 :size="17" /><span>静态预览</span></div>
        <a
          class="icon-button"
          href="https://github.com/DGAL831143/MintGallery"
          target="_blank"
          rel="noreferrer"
          title="打开 GitHub 仓库"
          aria-label="打开 GitHub 仓库"
        >
          <Github :size="20" />
        </a>
      </div>
    </header>

    <aside class="pages-notice">
      <Globe2 :size="19" />
      <span><strong>GitHub Pages 静态预览</strong> 不包含真实照片、账号、上传功能或家庭数据库。</span>
    </aside>

    <main class="gallery-main">
      <div class="gallery-heading">
        <div>
          <span class="eyebrow">PUBLIC PREVIEW</span>
          <h1>示例相册</h1>
        </div>
      </div>

      <section class="media-grid" aria-label="示例图库">
        <button
          class="media-tile pages-sample-tile"
          type="button"
          aria-label="查看示例照片"
          @click="previewOpen = true"
        >
          <img :src="sampleImageUrl" alt="MintGallery 示例照片" />
          <span class="media-owner">MintGallery</span>
        </button>
      </section>
    </main>

    <div v-if="previewOpen" class="viewer" role="dialog" aria-modal="true" aria-label="MintGallery 示例照片">
      <header class="viewer-toolbar">
        <div class="viewer-title">
          <strong>MintGallery 示例照片</strong>
          <span>GitHub Pages 静态预览</span>
        </div>
        <a
          class="icon-button viewer-action"
          :href="sampleImageUrl"
          target="_blank"
          title="打开示例图片"
          aria-label="打开示例图片"
        >
          <ExternalLink :size="20" />
        </a>
        <button
          class="icon-button viewer-action"
          type="button"
          title="关闭"
          aria-label="关闭"
          @click="previewOpen = false"
        >
          <X :size="22" />
        </button>
      </header>

      <div class="viewer-stage"><img :src="sampleImageUrl" alt="MintGallery 示例照片" /></div>

      <footer class="viewer-meta pages-preview-meta">
        <Globe2 :size="17" />
        <span>GitHub Pages 静态预览</span>
        <span>不含真实照片</span>
      </footer>
    </div>
  </div>
</template>
