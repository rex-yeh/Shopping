<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiRequest } from '../lib/api'
import { useAuthStore } from '../store/auth'
import { useCartStore } from '../store/cart'
import { isShowcaseMode } from '../lib/showcase'

const auth = useAuthStore()
const cart = useCartStore()
const route = useRoute()
const router = useRouter()
const mode = ref('login')
const username = ref('')
const name = ref('')
const password = ref('')
const errorMessage = ref('')
const notice = ref('')
const submitting = ref(false)
const orders = ref([])
const money = (cents) =>
  new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
const statusLabel = { pending: '待付款', paid: '已付款', cancelled: '已取消' }

const redirectAfterLogin = () => {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/shop'
  return redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/shop'
}

const loadOrders = async () => {
  if (!auth.user) return
  orders.value = await apiRequest('/api/orders')
}

onMounted(() => {
  if (auth.user) {
    cart.load().catch((error) => {
      errorMessage.value = error instanceof Error ? error.message : '無法載入購物車。'
    })
    loadOrders().catch((error) => {
      errorMessage.value = error instanceof Error ? error.message : '無法載入訂單。'
    })
  }
})

const authenticate = async () => {
  submitting.value = true
  errorMessage.value = ''
  notice.value = ''
  try {
    if (mode.value === 'register') {
      await auth.register({ username: username.value, name: name.value, password: password.value })
      notice.value = '會員註冊成功，已自動登入。'
    } else {
      await auth.login(username.value, password.value)
      notice.value = '登入成功。'
    }
    await cart.load()
    await loadOrders()
    await router.push(redirectAfterLogin())
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '會員登入失敗。'
  } finally {
    submitting.value = false
  }
}

const completePayment = async (order) => {
  try {
    await apiRequest(`/api/orders/${encodeURIComponent(order.id)}/mock-pay`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    await loadOrders()
    notice.value = '模擬付款完成。'
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '付款失敗。'
  }
}

const cancelOrder = async (order) => {
  try {
    await apiRequest(`/api/orders/${encodeURIComponent(order.id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    await loadOrders()
    notice.value = '訂單已取消，預留庫存已釋出。'
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '取消訂單失敗。'
  }
}
</script>

<template>
  <main class="store-page">
    <header class="store-header">
      <router-link to="/" class="brand-lockup">
        <span class="brand-mark">日</span><span class="brand-name">好日生活 <small>GOODDAY STUDIO</small></span>
      </router-link>
      <nav class="store-nav" aria-label="會員導覽">
        <router-link to="/shop">選物商城</router-link>
        <router-link to="/cart">購物車</router-link>
      </nav>
    </header>

    <section class="account-main">
      <section v-if="!auth.user && isShowcaseMode" class="auth-card member-auth-card">
        <div class="auth-header">
          <span class="eyebrow">GOODDAY MEMBERS</span>
          <h1>會員中心</h1>
          <p class="auth-description">這是 GitHub Pages 前端展示版，會員登入及訂單功能尚未啟用。</p>
        </div>
        <router-link to="/shop" class="store-primary-button">前往選物商城 <span>→</span></router-link>
      </section>

      <section v-else-if="!auth.user" class="auth-card member-auth-card">
        <div class="auth-header">
          <span class="eyebrow">GOODDAY MEMBERS</span>
          <h1>{{ mode === 'login' ? '會員登入' : '建立會員帳號' }}</h1>
          <p class="auth-description">登入後即可結帳、查看訂單，享受好日選物。</p>
        </div>
        <div class="account-mode-tabs">
          <button :class="{ active: mode === 'login' }" @click="mode = 'login'; errorMessage = ''">登入</button>
          <button :class="{ active: mode === 'register' }" @click="mode = 'register'; errorMessage = ''">註冊會員</button>
        </div>
        <form class="login-form" @submit.prevent="authenticate">
          <label v-if="mode === 'register'" class="form-field"><span>姓名</span><input v-model.trim="name" required maxlength="60" autocomplete="name" /></label>
          <label class="form-field"><span>帳號</span><input v-model.trim="username" required minlength="3" maxlength="30" autocomplete="username" /></label>
          <label class="form-field">
            <span>密碼 {{ mode === 'register' ? '（至少 10 個字元）' : '' }}</span>
            <input v-model="password" type="password" required :minlength="mode === 'register' ? 10 : 1" maxlength="200" :autocomplete="mode === 'register' ? 'new-password' : 'current-password'" />
          </label>
          <p v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</p>
          <button class="primary-btn login-btn" type="submit" :disabled="submitting">
            {{ submitting ? '處理中…' : mode === 'login' ? '登入會員' : '註冊並登入' }}
          </button>
        </form>
        <p class="account-security-note">會員帳號與密碼會安全儲存在伺服器，不會保存在瀏覽器。</p>
      </section>

      <section v-else class="member-dashboard">
        <div class="shop-section-heading">
          <div><span class="section-kicker">GOODDAY MEMBERS</span><h1>嗨，{{ auth.user.name }}</h1></div>
          <button class="store-secondary-button" @click="auth.logout(); router.push('/shop')">登出</button>
        </div>
        <p v-if="notice" class="notice-banner" role="status">{{ notice }}</p>
        <p v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</p>
        <section class="member-orders">
          <div class="card-heading"><div><span class="section-kicker">ORDER HISTORY</span><h2>我的訂單</h2></div><router-link to="/shop" class="text-link">繼續購物 →</router-link></div>
          <p v-if="!orders.length" class="shop-empty-state">目前還沒有訂單。</p>
          <article v-for="order in orders" :key="order.id" class="member-order-card">
            <div class="member-order-heading">
              <div><strong>{{ order.id }}</strong><small>{{ new Date(order.createdAt).toLocaleString('zh-TW') }}</small></div>
              <span class="order-status" :class="`status-${order.status}`">{{ statusLabel[order.status] }}</span>
            </div>
            <div v-for="item in order.items" :key="item.name" class="member-order-item">
              <span>{{ item.name }} × {{ item.quantity }}</span><strong>{{ money(item.unitPriceCents * item.quantity) }}</strong>
            </div>
            <div class="member-order-footer">
              <span>訂單金額 <strong>{{ money(order.totalCents) }}</strong></span>
              <div v-if="order.status === 'pending'" class="member-order-actions">
                <button class="store-secondary-button" @click="cancelOrder(order)">取消訂單</button>
                <button class="store-primary-button" @click="completePayment(order)">模擬完成付款</button>
              </div>
            </div>
          </article>
        </section>
      </section>
    </section>
  </main>
</template>
