import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PagesPreviewView from './PagesPreviewView.vue'

describe('PagesPreviewView', () => {
  it('opens and closes the static sample viewer without an API', async () => {
    const wrapper = mount(PagesPreviewView)

    expect(wrapper.find('.pages-notice').text()).toContain('不包含真实照片')
    expect(wrapper.find('.viewer').exists()).toBe(false)

    await wrapper.get('[aria-label="查看示例照片"]').trigger('click')
    expect(wrapper.find('.viewer').exists()).toBe(true)

    await wrapper.get('[aria-label="关闭"]').trigger('click')
    expect(wrapper.find('.viewer').exists()).toBe(false)
  })
})
