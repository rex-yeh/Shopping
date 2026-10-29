import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { apiRequest } from '../lib/api'
import { isShowcaseMode, showcaseProducts } from '../lib/showcase'

export const useCartStore = defineStore('cart', () => {
  const items = ref([])
  const loading = ref(false)
  const itemCount = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0))
  const totalCents = computed(() =>
    items.value.reduce((sum, item) => sum + item.priceCents * item.quantity, 0),
  )

  const applyItems = (response) => {
    items.value = response.items
  }

  const load = async () => {
    if (isShowcaseMode) return

    loading.value = true
    try {
      applyItems(await apiRequest('/api/cart'))
    } finally {
      loading.value = false
    }
  }

  const add = async (productId, quantity = 1) => {
    if (isShowcaseMode) {
      const product = showcaseProducts.find((item) => item.id === productId)
      if (!product || !Number.isInteger(quantity) || quantity < 1) {
        throw new Error('商品或數量格式不正確。')
      }
      const existing = items.value.find((item) => item.productId === productId)
      if ((existing?.quantity || 0) + quantity > product.stock) {
        throw new Error(`庫存不足，目前最多可購買 ${product.stock} 件。`)
      }
      if (existing) existing.quantity += quantity
      else items.value.push({ ...product, productId, quantity })
      return
    }

    applyItems(
      await apiRequest('/api/cart/items', {
        method: 'POST',
        body: JSON.stringify({ productId, quantity }),
      }),
    )
  }

  const setQuantity = async (productId, quantity) => {
    if (isShowcaseMode) {
      const item = items.value.find((entry) => entry.productId === productId)
      if (!item || !Number.isInteger(quantity) || quantity < 1 || quantity > item.stock) {
        throw new Error('商品數量不正確。')
      }
      item.quantity = quantity
      return
    }

    applyItems(
      await apiRequest(`/api/cart/items/${encodeURIComponent(productId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity }),
      }),
    )
  }

  const remove = async (productId) => {
    if (isShowcaseMode) {
      items.value = items.value.filter((item) => item.productId !== productId)
      return
    }

    applyItems(
      await apiRequest(`/api/cart/items/${encodeURIComponent(productId)}`, { method: 'DELETE' }),
    )
  }

  const clear = () => {
    items.value = []
  }

  return { items, loading, itemCount, totalCents, load, add, setQuantity, remove, clear }
})
