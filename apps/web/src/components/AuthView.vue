<script setup lang="ts">
import { computed, ref } from 'vue'
import { Leaf, LoaderCircle, LockKeyhole, UserRound } from 'lucide-vue-next'
import { authApi } from '../api'
import type { User } from '../types'

const props = defineProps<{ setupMode: boolean }>()
const emit = defineEmits<{ authenticated: [user: User] }>()

const username = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)
const title = computed(() => (props.setupMode ? '创建管理员' : '欢迎回来'))

async function submit() {
  error.value = ''
  if (username.value.trim().length < 2 || password.value.length < 8) {
    error.value = '请输入有效账号，密码至少需要 8 个字符'
    return
  }

  submitting.value = true
  try {
    const result = props.setupMode
      ? await authApi.bootstrap(username.value.trim(), password.value)
      : await authApi.login(username.value.trim(), password.value)
    emit('authenticated', result.user)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '操作失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-brand" aria-label="MintGallery">
      <div class="brand-mark brand-mark-large"><Leaf :size="30" stroke-width="2" /></div>
      <div>
        <p class="auth-kicker">PRIVATE FAMILY GALLERY</p>
        <h1>MintGallery</h1>
        <p>把珍贵影像留在自己的硬盘里。</p>
      </div>
      <figure class="album-preview" aria-hidden="true">
        <img src="/login-album.webp" alt="" />
      </figure>
    </section>

    <section class="auth-form-wrap">
      <form class="auth-form" @submit.prevent="submit">
        <div class="auth-heading">
          <span class="eyebrow">{{ setupMode ? '首次使用' : '家庭相册' }}</span>
          <h2>{{ title }}</h2>
          <p>{{ setupMode ? '这个账号将负责管理家人和存储空间。' : '登录后继续浏览家人的共同回忆。' }}</p>
        </div>

        <label class="field">
          <span>账号</span>
          <span class="input-shell">
            <UserRound :size="19" />
            <input v-model="username" autocomplete="username" placeholder="输入账号" autofocus />
          </span>
        </label>

        <label class="field">
          <span>密码</span>
          <span class="input-shell">
            <LockKeyhole :size="19" />
            <input
              v-model="password"
              type="password"
              :autocomplete="setupMode ? 'new-password' : 'current-password'"
              placeholder="至少 8 个字符"
            />
          </span>
        </label>

        <p v-if="error" class="form-error" role="alert">{{ error }}</p>

        <button class="button button-primary auth-submit" type="submit" :disabled="submitting">
          <LoaderCircle v-if="submitting" class="spin" :size="19" />
          <span>{{ setupMode ? '创建并进入相册' : '登录' }}</span>
        </button>
      </form>
    </section>
  </main>
</template>
