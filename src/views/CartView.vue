<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiRequest } from '../lib/api'
import { useAuthStore } from '../store/auth'
import { useCartStore } from '../store/cart'
import { isShowcaseMode } from '../lib/showcase'

const auth = useAuthStore()
const cart = useCartStore()
const recipientName = ref(auth.user?.name || '')
const recipientPhone = ref('')
const shippingAddress = ref('')
const pendingOrder = ref(null)
const notice = ref('')
const errorMessage = ref('')
const submitting = ref(false)
const money = (cents) =>
  new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
const canCheckout = computed(() => Boolean(auth.user))

onMounted(() => {
  cart.load().catch((error) => {
    errorMessage.value = error instanceof Error ? error.message : '無法載入購物車。'
  })
})

const setQuantity = async (item, quantity) => {
  try {
    if (quantity < 1) {
      await cart.remove(item.productId)
    } else {
      await cart.setQuantity(item.productId, quantity)
    }
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '更新商品數量失敗。'
  }
}

const checkout = async () => {
  if (!canCheckout.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    pendingOrder.value = await apiRequest('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        recipientName: recipientName.value,
        recipientPhone: recipientPhone.value,
        shippingAddress: shippingAddress.value,
      }),
    })
    await cart.load()
    notice.value = '訂單已建立，請完成測試付款。'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '建立訂單失敗。'
  } finally {
    submitting.value = false
  }
}

const completePayment = async () => {
  if (!pendingOrder.value) return
  submitting.value = true
  try {
    await apiRequest(`/api/orders/${encodeURIComponent(pendingOrder.value.orderId)}/mock-pay`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    pendingOrder.value = null
    notice.value = '測試付款完成，訂單已成立。可至會員中心查詢訂單。'
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '付款失敗。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="store-page">
    <header class="store-header">
      <router-link to="/" class="brand-lockup">
        <span class="brand-mark">日</span><span class="brand-name">好日生活 <small>GOODDAY STUDIO</small></span>
      </router-link>
      <nav class="store-nav" aria-label="商店導覽">
        <router-link to="/shop">繼續購物</router-link>
        <router-link to="/account">會員中心</router-link>
      </nav>
    </header>

    <section class="cart-main">
      <div class="shop-section-heading">
        <div><span class="section-kicker">YOUR SHOPPING BAG</span><h1>購物車</h1></div>
        <router-link to="/shop" class="text-link">繼續購物 <span>↗</span></router-link>
      </div>
      <div v-if="notice" class="notice-banner" role="status">{{ notice }}</div>
      <div v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</div>

      <section v-if="pendingOrder" class="payment-test-panel">
        <span class="section-kicker">TEST PAYMENT</span>
        <h2>訂單已建立</h2>
        <p>訂單編號：{{ pendingOrder.orderId }}</p>
        <p>金額：<strong>{{ money(pendingOrder.totalCents) }}</strong></p>
        <p class="payment-test-warning">目前為模擬測試金流，不會實際扣款。</p>
        <button class="store-primary-button" :disabled="submitting" @click="completePayment">
          {{ submitting ? '處理中…' : '模擬完成付款' }}
        </button>
      </section>

      <p v-else-if="cart.loading" class="shop-empty-state">正在載入購物車…</p>
      <section v-else-if="!cart.items.length" class="cart-empty">
        <span class="cart-empty-mark">日</span>
        <h2>購物車還沒有商品</h2>
        <p>去逛逛日常選物，找到喜歡的好物吧。</p>
        <router-link to="/shop" class="store-primary-button">前往選物商城 <span>→</span></router-link>
      </section>
      <div v-else class="cart-layout">
        <section class="cart-items" aria-label="購物車商品">
          <article v-for="item in cart.items" :key="item.productId" class="cart-item">
            <img :src="item.image" :alt="item.name" />
            <div class="cart-item-detail">
              <h2>{{ item.name }}</h2>
              <p>{{ money(item.priceCents) }}</p>
              <small>庫存 {{ item.stock }} 件</small>
            </div>
            <div class="cart-quantity">
              <button :aria-label="`減少${item.name}數量`" @click="setQuantity(item, item.quantity - 1)">−</button>
              <span>{{ item.quantity }}</span>
              <button :disabled="item.quantity >= item.stock" :aria-label="`增加${item.name}數量`" @click="setQuantity(item, item.quantity + 1)">＋</button>
            </div>
            <strong class="cart-item-total">{{ money(item.priceCents * item.quantity) }}</strong>
            <button class="cart-remove" :aria-label="`移除${item.name}`" @click="setQuantity(item, 0)">移除</button>
          </article>
        </section>

        <aside class="cart-summary">
          <span class="section-kicker">ORDER SUMMARY</span>
          <h2>訂單摘要</h2>
          <div class="cart-summary-row"><span>商品小計</span><strong>{{ money(cart.totalCents) }}</strong></div>
          <div class="cart-summary-row"><span>運費</span><strong>免運</strong></div>
          <div class="cart-summary-total"><span>總計</span><strong>{{ money(cart.totalCents) }}</strong></div>
          <template v-if="canCheckout">
            <form class="checkout-form" @submit.prevent="checkout">
              <label class="form-field"><span>收件人</span><input v-model.trim="recipientName" required maxlength="60" autocomplete="name" /></label>
              <label class="form-field"><span>聯絡電話</span><input v-model.trim="recipientPhone" required maxlength="24" autocomplete="tel" /></label>
              <label class="form-field"><span>配送地址</span><textarea v-model.trim="shippingAddress" required minlength="5" maxlength="300" rows="2" autocomplete="street-address" /></label>
              <button class="store-primary-button" type="submit" :disabled="submitting">
                {{ submitting ? '建立訂單中…' : '建立訂單並前往測試付款' }} <span>→</span>
              </button>
            </form>
          </template>
          <div v-else class="checkout-login-prompt">
            <p v-if="isShowcaseMode">這是前端展示版，購物車僅供瀏覽；登入、下單與付款功能未啟用。</p>
            <template v-else>
              <p>結帳前請先登入或註冊會員，購物車商品會保留。</p>
              <router-link :to="{ path: '/account', query: { redirect: '/cart' } }" class="store-primary-button">會員登入 / 註冊 <span>→</span></router-link>
            </template>
          </div>
          <p v-if="!isShowcaseMode" class="payment-test-warning">測試金流不會實際收款。正式金流尚未設定。</p>
        </aside>
      </div>
    </section>
  </main>
</template>
