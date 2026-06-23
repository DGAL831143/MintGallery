<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Check,
  CircleAlert,
  Database,
  FolderSearch,
  HardDrive,
  LoaderCircle,
  Plus,
  UserRoundCog,
  X,
} from 'lucide-vue-next'
import { adminApi } from '../api'
import { formatBytes } from '../format'
import type { ImportCandidate, ImportScanResult, StorageSummary, User } from '../types'

defineProps<{ currentUserId: string }>()
const emit = defineEmits<{ close: []; imported: [] }>()
const users = ref<User[]>([])
const stats = ref<StorageSummary | null>(null)
const loading = ref(true)
const username = ref('')
const temporaryPassword = ref('')
const creating = ref(false)
const error = ref('')
const importPath = ref('')
const importVisibility = ref<'SHARED' | 'PRIVATE'>('SHARED')
const scanResult = ref<ImportScanResult | null>(null)
const selectedImportIds = ref(new Set<string>())
const includeDuplicateImports = ref(false)
const scanning = ref(false)
const importing = ref(false)
const importError = ref('')
const importMessage = ref('')

const importCandidates = computed(() => scanResult.value?.candidates ?? [])
const selectedImportCount = computed(() => selectedImportIds.value.size)
const duplicateSelected = computed(
  () => importCandidates.value.some((candidate) => candidate.duplicate && selectedImportIds.value.has(candidate.id)),
)

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

function candidateTypeLabel(candidate: ImportCandidate): string {
  if (candidate.type === 'LIVE_PHOTO') return '实况'
  if (candidate.type === 'VIDEO') return '视频'
  return '照片'
}

function candidateFileSummary(candidate: ImportCandidate): string {
  if (candidate.type === 'LIVE_PHOTO') {
    return candidate.files.map((file) => file.name).join(' + ')
  }
  return candidate.files[0]?.relativePath ?? candidate.originalName
}

function setImportSelection(mode: 'NEW' | 'ALL' | 'NONE') {
  if (mode === 'NONE') {
    selectedImportIds.value = new Set()
    return
  }
  selectedImportIds.value = new Set(
    importCandidates.value
      .filter((candidate) => mode === 'ALL' || !candidate.duplicate)
      .map((candidate) => candidate.id),
  )
}

function toggleImportCandidate(candidateId: string) {
  const next = new Set(selectedImportIds.value)
  if (next.has(candidateId)) next.delete(candidateId)
  else next.add(candidateId)
  selectedImportIds.value = next
}

async function scanFolder() {
  const path = importPath.value.trim()
  if (!path) return
  scanning.value = true
  importError.value = ''
  importMessage.value = ''
  try {
    scanResult.value = await adminApi.scanImportFolder(path)
    setImportSelection('NEW')
    includeDuplicateImports.value = false
  } catch (reason) {
    scanResult.value = null
    importError.value = reason instanceof Error ? reason.message : '文件夹扫描失败'
  } finally {
    scanning.value = false
  }
}

async function runFolderImport() {
  if (!scanResult.value || selectedImportIds.value.size === 0) return
  importing.value = true
  importError.value = ''
  importMessage.value = ''
  try {
    const result = await adminApi.importFolder(
      scanResult.value.rootPath,
      importVisibility.value,
      [...selectedImportIds.value],
      includeDuplicateImports.value,
    )
    importMessage.value = `已导入 ${result.summary.imported} 项，跳过 ${result.summary.skipped} 项`
    selectedImportIds.value = new Set()
    await Promise.all([load(), scanFolder()])
    emit('imported')
  } catch (reason) {
    importError.value = reason instanceof Error ? reason.message : '文件夹导入失败'
  } finally {
    importing.value = false
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

        <section class="admin-section import-section">
          <div class="section-title">
            <FolderSearch :size="20" />
            <div><h3>外部文件夹导入</h3><p>扫描电脑上的文件夹，确认重复项后复制到相册数据目录。</p></div>
          </div>

          <form class="import-form" @submit.prevent="scanFolder">
            <label class="field import-path-field">
              <span>文件夹路径</span>
              <input v-model="importPath" placeholder="F:\MintGallery\incoming-test" />
            </label>
            <div class="segmented compact import-visibility" aria-label="导入可见范围">
              <button type="button" :class="{ active: importVisibility === 'SHARED' }" :disabled="scanning || importing" @click="importVisibility = 'SHARED'">家庭共享</button>
              <button type="button" :class="{ active: importVisibility === 'PRIVATE' }" :disabled="scanning || importing" @click="importVisibility = 'PRIVATE'">仅自己</button>
            </div>
            <button class="button button-secondary" type="submit" :disabled="scanning || importing || !importPath.trim()">
              <LoaderCircle v-if="scanning" class="spin" :size="18" /><FolderSearch v-else :size="18" />扫描
            </button>
          </form>

          <p v-if="importError" class="form-error" role="alert"><CircleAlert :size="17" />{{ importError }}</p>
          <p v-if="importMessage" class="form-success"><Check :size="17" />{{ importMessage }}</p>

          <div v-if="scanResult" class="import-results">
            <div class="import-summary">
              <span>{{ scanResult.summary.candidates }} 个候选</span>
              <span>{{ scanResult.summary.newCandidates }} 个新项目</span>
              <span>{{ scanResult.summary.duplicates }} 个重复</span>
              <span>{{ scanResult.summary.livePhotoCandidates }} 个实况候选</span>
              <span v-if="scanResult.summary.skipped">{{ scanResult.summary.skipped }} 个已跳过</span>
            </div>
            <p v-if="scanResult.summary.truncated" class="inline-warning">本次扫描达到数量上限，建议分批导入。</p>

            <div class="import-actions">
              <button class="text-button" type="button" @click="setImportSelection('NEW')">只选新项目</button>
              <button class="text-button" type="button" @click="setImportSelection('ALL')">全选</button>
              <button class="text-button" type="button" @click="setImportSelection('NONE')">清空</button>
              <label class="import-duplicate-toggle">
                <input v-model="includeDuplicateImports" type="checkbox" :disabled="!duplicateSelected || importing" />
                <span>允许导入已选重复项</span>
              </label>
            </div>

            <div class="import-list">
              <label v-for="candidate in importCandidates" :key="candidate.id" class="import-row" :class="{ duplicate: candidate.duplicate }">
                <input
                  type="checkbox"
                  :checked="selectedImportIds.has(candidate.id)"
                  :disabled="importing"
                  @change="toggleImportCandidate(candidate.id)"
                />
                <div class="import-row-main">
                  <strong>{{ candidate.originalName }}</strong>
                  <span>{{ candidateFileSummary(candidate) }}</span>
                  <small v-if="candidate.duplicate">可能重复：{{ candidate.duplicateAssets.map((asset) => asset.originalName).join('、') }}</small>
                  <small v-else-if="candidate.warnings.length">{{ candidate.warnings[0] }}</small>
                </div>
                <div class="import-row-meta">
                  <span>{{ candidateTypeLabel(candidate) }}</span>
                  <small>{{ formatBytes(candidate.sizeBytes) }}</small>
                </div>
              </label>
            </div>

            <details v-if="scanResult.skipped.length" class="import-skipped">
              <summary>查看跳过的文件</summary>
              <div v-for="file in scanResult.skipped.slice(0, 20)" :key="`${file.relativePath}-${file.reason}`">
                <span>{{ file.relativePath || file.path }}</span>
                <small>{{ file.reason }}</small>
              </div>
            </details>

            <button
              class="button button-primary import-submit"
              type="button"
              :disabled="importing || selectedImportCount === 0 || (duplicateSelected && !includeDuplicateImports)"
              @click="runFolderImport"
            >
              <LoaderCircle v-if="importing" class="spin" :size="18" /><Check v-else :size="18" />导入 {{ selectedImportCount }} 项
            </button>
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
