import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { apiRequest } from '../lib/api'

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
    loading.value = true
    try {
      applyItems(await apiRequest('/api/cart'))
    } finally {
      loading.value = false
    }
  }

  const add = async (productId, quantity = 1) => {
    applyItems(
      await apiRequest('/api/cart/items', {
        method: 'POST',
        body: JSON.stringify({ productId, quantity }),
      }),
    )
  }

  const setQuantity = async (productId, quantity) => {
    applyItems(
      await apiRequest(`/api/cart/items/${encodeURIComponent(productId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity }),
      }),
    )
  }

  const remove = async (productId) => {
    applyItems(
      await apiRequest(`/api/cart/items/${encodeURIComponent(productId)}`, { method: 'DELETE' }),
    )
  }

  const clear = () => {
    items.value = []
  }

  return { items, loading, itemCount, totalCents, load, add, setQuantity, remove, clear }
})
