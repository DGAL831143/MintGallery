<script setup lang="ts">
import { ref } from 'vue'
import { KeyRound, LoaderCircle } from 'lucide-vue-next'
import { authApi } from '../api'

const emit = defineEmits<{ completed: [] }>()
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const saving = ref(false)

async function submit() {
  error.value = ''
  if (newPassword.value.length < 8) {
    error.value = '新密码至少需要 8 个字符'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致'
    return
  }

  saving.value = true
  try {
    await authApi.changePassword(currentPassword.value, newPassword.value)
    emit('completed')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '密码修改失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="centered-page">
    <form class="password-panel" @submit.prevent="submit">
      <div class="round-icon"><KeyRound :size="26" /></div>
      <span class="eyebrow">账号安全</span>
      <h1>设置自己的密码</h1>
      <p>管理员给你的是临时密码，修改后才能进入相册。</p>

      <label class="field">
        <span>当前临时密码</span>
        <input v-model="currentPassword" type="password" autocomplete="current-password" />
      </label>
      <label class="field">
        <span>新密码</span>
        <input v-model="newPassword" type="password" autocomplete="new-password" />
      </label>
      <label class="field">
        <span>再次输入新密码</span>
        <input v-model="confirmPassword" type="password" autocomplete="new-password" />
      </label>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="button button-primary" type="submit" :disabled="saving">
        <LoaderCircle v-if="saving" class="spin" :size="18" />
        保存新密码
      </button>
    </form>
  </main>
</template>
