<script setup>
import { onMounted, ref } from 'vue'
import { apiRequest } from '../lib/api'
import { useCartStore } from '../store/cart'
import { isShowcaseMode, showcaseProducts } from '../lib/showcase'

const cart = useCartStore()
const products = ref([])
const loading = ref(true)
const errorMessage = ref('')
const notice = ref('')
const money = (cents) =>
  new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(cents / 100)

onMounted(async () => {
  try {
    if (isShowcaseMode) {
      products.value = showcaseProducts
      await cart.load()
      return
    }
    ;[products.value] = await Promise.all([apiRequest('/api/products'), cart.load()])
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '目前無法載入商品。'
  } finally {
    loading.value = false
  }
})

const addToCart = async (product) => {
  try {
    await cart.add(product.id)
    notice.value = `「${product.name}」已加入購物車。`
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加入購物車失敗。'
    notice.value = ''
  }
}
</script>

<template>
  <main class="store-page">
    <header class="store-header">
      <router-link to="/" class="brand-lockup">
        <span class="brand-mark">日</span>
        <span class="brand-name">好日生活 <small>GOODDAY STUDIO</small></span>
      </router-link>
      <nav class="store-nav" aria-label="商店導覽">
        <router-link to="/shop" aria-current="page">全部商品</router-link>
        <router-link to="/">品牌首頁</router-link>
      </nav>
      <div class="store-header-actions">
        <router-link to="/account" class="header-link">會員登入</router-link>
        <router-link to="/cart" class="header-link cart-header-link">購物車 <span>{{ cart.itemCount }}</span></router-link>
      </div>
    </header>

    <section class="shop-hero">
      <span class="section-kicker">GOOD THINGS FOR EVERY DAY</span>
      <h1>把喜歡的日常，<br />帶回家。</h1>
      <p>精選陪伴日常的好物，讓每一天都有一點喜歡的事。</p>
    </section>

    <section class="shop-catalog" aria-label="商品列表">
      <div class="shop-section-heading">
        <div><span class="section-kicker">CURATED FOR YOUR DAYS</span><h2>日常選物</h2></div>
        <span>{{ products.length }} 件好物</span>
      </div>
      <div v-if="notice" class="notice-banner" role="status">{{ notice }}</div>
      <div v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</div>
      <p v-if="loading" class="shop-empty-state">正在載入商品…</p>
      <p v-else-if="!products.length" class="shop-empty-state">目前沒有上架商品，敬請期待。</p>
      <div v-else class="product-grid">
        <article v-for="product in products" :key="product.id" class="product-card">
          <router-link :to="`/shop#${product.id}`" class="product-image-link" :aria-label="product.name">
            <img :src="product.image" :alt="product.name" loading="lazy" />
            <span v-if="product.stock <= 3" class="product-stock-tag">
              {{ product.stock ? '即將售完' : '售完' }}
            </span>
          </router-link>
          <div class="product-card-copy">
            <div class="product-card-title"><h3>{{ product.name }}</h3><strong>{{ money(product.priceCents) }}</strong></div>
            <p>{{ product.description }}</p>
            <button type="button" class="store-primary-button" :disabled="product.stock < 1" @click="addToCart(product)">
              {{ product.stock ? '加入購物車' : '目前售完' }} <span>＋</span>
            </button>
          </div>
        </article>
      </div>
    </section>

    <footer class="store-footer">
      <router-link to="/" class="brand-lockup">
        <span class="brand-mark">日</span><span class="brand-name">好日生活 <small>GOODDAY STUDIO</small></span>
      </router-link>
      <span>{{ isShowcaseMode ? 'GitHub Pages 前端展示版：僅供瀏覽，交易功能未啟用。' : '測試商店：訂單付款使用模擬金流，不會實際扣款。' }}</span>
    </footer>
  </main>
</template>
