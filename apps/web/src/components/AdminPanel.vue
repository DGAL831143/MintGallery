<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Database, HardDrive, LoaderCircle, Plus, UserRoundCog, X } from 'lucide-vue-next'
import { adminApi } from '../api'
import { formatBytes } from '../format'
import type { StorageSummary, User } from '../types'

defineProps<{ currentUserId: string }>()
const emit = defineEmits<{ close: [] }>()
const users = ref<User[]>([])
const stats = ref<StorageSummary | null>(null)
const loading = ref(true)
const username = ref('')
const temporaryPassword = ref('')
const creating = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [usersResult, statsResult] = await Promise.all([adminApi.users(), adminApi.stats()])
    users.value = usersResult.users
    stats.value = statsResult
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '管理信息加载失败'
  } finally {
    loading.value = false
  }
}

async function createUser() {
  error.value = ''
  creating.value = true
  try {
    await adminApi.createUser(username.value.trim(), temporaryPassword.value)
    username.value = ''
    temporaryPassword.value = ''
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '创建账号失败'
  } finally {
    creating.value = false
  }
}

async function toggleUser(user: User) {
  const status = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  try {
    await adminApi.setUserStatus(user.id, status)
    user.status = status
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '账号状态修改失败'
  }
}

onMounted(load)
</script>

<template>
  <div class="modal-backdrop" role="presentation" @click.self="emit('close')">
    <section class="admin-panel" role="dialog" aria-modal="true" aria-label="相册管理">
      <header class="panel-header">
        <div>
          <span class="eyebrow">ADMIN</span>
          <h2>相册管理</h2>
        </div>
        <button class="icon-button" title="关闭管理面板" @click="emit('close')"><X :size="21" /></button>
      </header>

      <div v-if="loading" class="panel-loading"><LoaderCircle class="spin" :size="25" />正在读取状态</div>
      <template v-else>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>

        <section v-if="stats" class="stats-band">
          <div class="stat-item">
            <HardDrive :size="21" />
            <span>硬盘可用</span>
            <strong>{{ formatBytes(stats.disk.freeBytes) }}</strong>
            <small>共 {{ formatBytes(stats.disk.totalBytes) }}</small>
          </div>
          <div class="stat-item">
            <Database :size="21" />
            <span>相册原件</span>
            <strong>{{ formatBytes(stats.assets.originalBytes) }}</strong>
            <small>{{ stats.assets.count }} 个项目</small>
          </div>
        </section>

        <section class="admin-section">
          <div class="section-title">
            <UserRoundCog :size="20" />
            <div><h3>家庭成员</h3><p>新成员首次登录后需要修改临时密码。</p></div>
          </div>

          <form class="member-form" @submit.prevent="createUser">
            <label class="field"><span>账号</span><input v-model="username" required minlength="2" /></label>
            <label class="field"><span>临时密码</span><input v-model="temporaryPassword" type="password" required minlength="8" /></label>
            <button class="button button-primary" type="submit" :disabled="creating">
              <LoaderCircle v-if="creating" class="spin" :size="18" /><Plus v-else :size="18" />添加成员
            </button>
          </form>

          <div class="member-list">
            <div v-for="user in users" :key="user.id" class="member-row">
              <div class="member-avatar">{{ user.username.slice(0, 1).toUpperCase() }}</div>
              <div class="member-copy">
                <strong>{{ user.username }}</strong>
                <span>{{ user.role === 'ADMIN' ? '管理员' : '家庭成员' }}<template v-if="user.mustChangePassword"> · 待修改密码</template></span>
              </div>
              <button
                v-if="user.id !== currentUserId"
                class="text-button"
                :class="{ danger: user.status === 'ACTIVE' }"
                @click="toggleUser(user)"
              >
                {{ user.status === 'ACTIVE' ? '停用' : '启用' }}
              </button>
              <span v-else class="self-label">当前账号</span>
            </div>
          </div>
        </section>
      </template>
    </section>
  </div>
</template>
