<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { LoaderCircle } from 'lucide-vue-next'
import { ApiError, authApi } from './api'
import type { User } from './types'
import AuthView from './components/AuthView.vue'
import GalleryView from './components/GalleryView.vue'
import PagesPreviewView from './components/PagesPreviewView.vue'
import PasswordChangeView from './components/PasswordChangeView.vue'

const pagesPreview = import.meta.env.VITE_PAGES_PREVIEW === 'true'
const loading = ref(true)
const needsSetup = ref(false)
const user = ref<User | null>(null)

async function initialize() {
  loading.value = true
  try {
    const status = await authApi.bootstrapStatus()
    needsSetup.value = status.needsSetup
    if (!status.needsSetup) {
      try {
        user.value = (await authApi.me()).user
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 401) throw reason
      }
    }
  } finally {
    loading.value = false
  }
}

function authenticated(nextUser: User) {
  user.value = nextUser
  needsSetup.value = false
}

async function passwordChanged() {
  user.value = (await authApi.me()).user
}

function signedOut() {
  user.value = null
}

onMounted(() => {
  if (!pagesPreview) void initialize()
})
</script>

<template>
  <PagesPreviewView v-if="pagesPreview" />
  <div v-else-if="loading" class="boot-screen"><LoaderCircle class="spin" :size="30" /><span>正在打开相册</span></div>
  <AuthView v-else-if="!user" :setup-mode="needsSetup" @authenticated="authenticated" />
  <PasswordChangeView v-else-if="user.mustChangePassword" @completed="passwordChanged" />
  <GalleryView v-else :user="user" @signed-out="signedOut" />
</template>
