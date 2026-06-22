import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FolderDialog from './FolderDialog.vue'

describe('FolderDialog', () => {
  it('adds selected items to a folder and can create a new folder', async () => {
    const wrapper = mount(FolderDialog, {
      props: {
        folders: [{ id: 'folder-1', name: '旅行', itemCount: 3, createdAt: '2026-06-22T00:00:00.000Z' }],
        selectedCount: 2,
        busy: false,
        error: '',
      },
    })

    await wrapper.find('.folder-target-row').trigger('click')
    expect(wrapper.emitted('add')).toEqual([['folder-1']])

    await wrapper.find('input').setValue('家人')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('create')).toEqual([['家人']])
  })
})
