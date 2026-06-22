<script setup lang="ts">
import { ref } from 'vue'
import { FolderInput, FolderPlus, Images, X } from 'lucide-vue-next'
import type { Folder } from '../types'

defineProps<{
  folders: Folder[]
  selectedCount: number
  busy: boolean
  error: string
}>()
const emit = defineEmits<{
  close: []
  create: [name: string]
  add: [folderId: string]
}>()
const name = ref('')

function createFolder() {
  const value = name.value.trim()
  if (value) emit('create', value)
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="folder-dialog" role="dialog" aria-modal="true" aria-label="整理到文件夹">
      <header class="panel-header">
        <div>
          <span class="eyebrow">FOLDERS</span>
          <h2>{{ selectedCount > 0 ? `整理 ${selectedCount} 个项目` : '新建文件夹' }}</h2>
        </div>
        <button class="icon-button" type="button" title="关闭" :disabled="busy" @click="emit('close')">
          <X :size="21" />
        </button>
      </header>

      <div class="folder-dialog-body">
        <div v-if="selectedCount > 0" class="folder-targets">
          <button
            v-for="folder in folders"
            :key="folder.id"
            class="folder-target-row"
            type="button"
            :disabled="busy"
            @click="emit('add', folder.id)"
          >
            <FolderInput :size="20" />
            <span><strong>{{ folder.name }}</strong><small>{{ folder.itemCount }} 个项目</small></span>
            <span>加入</span>
          </button>
          <div v-if="folders.length === 0" class="folder-dialog-empty">
            <Images :size="27" /><span>还没有文件夹，请先在下方创建。</span>
          </div>
        </div>

        <form class="folder-create-form" @submit.prevent="createFolder">
          <label class="field">
            <span>文件夹名称</span>
            <input v-model="name" maxlength="40" autocomplete="off" placeholder="例如：旅行、家人、毕业照" />
          </label>
          <button class="button button-primary" type="submit" :disabled="busy || !name.trim()">
            <FolderPlus :size="18" />创建{{ selectedCount > 0 ? '并加入' : '' }}
          </button>
        </form>
        <p v-if="error" class="form-error">{{ error }}</p>
      </div>
    </section>
  </div>
</template>
