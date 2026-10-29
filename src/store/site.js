import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiRequest } from '../lib/api'
import { isShowcaseMode, showcaseSlides } from '../lib/showcase'

export const useSiteStore = defineStore('site', () => {
  const slides = ref(isShowcaseMode ? showcaseSlides : [])
  const error = ref('')

  const loadSlides = async () => {
    if (isShowcaseMode) return

    try {
      slides.value = await apiRequest('/api/slides')
      error.value = ''
    } catch (requestError) {
      error.value = requestError instanceof Error ? requestError.message : '無法載入首頁輪播。'
      throw requestError
    }
  }

  const saveSlides = async (nextSlides) => {
    if (isShowcaseMode) throw new Error('GitHub Pages 展示版不支援編輯輪播。')
    if (!Array.isArray(nextSlides) || nextSlides.length === 0) {
      throw new Error('至少需要一張有效的輪播圖片。')
    }
    await apiRequest('/api/admin/slides', {
      method: 'PUT',
      body: JSON.stringify({ slides: nextSlides }),
    })
    slides.value = nextSlides
  }

  const uploadImage = async (file) => {
    if (isShowcaseMode) throw new Error('GitHub Pages 展示版不支援上傳圖片。')

    const body = new FormData()
    body.append('image', file)
    const result = await apiRequest('/api/admin/uploads', { method: 'POST', body })
    return result.url
  }

  return { slides, error, loadSlides, saveSlides, uploadImage }
})
