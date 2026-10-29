<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useCartStore } from '../store/cart'
import { useSiteStore } from '../store/site'
import { isShowcaseMode } from '../lib/showcase'

const site = useSiteStore()
const cart = useCartStore()
const currentIndex = ref(0)
const activeSlide = computed(() => site.slides[currentIndex.value] || site.slides[0])
let carouselTimer

const showSlide = (index) => {
  if (!site.slides.length) return
  currentIndex.value = (index + site.slides.length) % site.slides.length
}

onMounted(() => {
  if (!isShowcaseMode) {
    cart.load().catch((error) => {
      console.error('無法載入購物車。', error)
    })
  }
  site.loadSlides().catch((error) => {
    console.error('無法載入首頁輪播。', error)
  })
  carouselTimer = window.setInterval(() => showSlide(currentIndex.value + 1), 6000)
})

onUnmounted(() => window.clearInterval(carouselTimer))
</script>

<template>
  <main class="site-page">
    <header class="site-header">
      <router-link to="/" class="brand-lockup" aria-label="好日生活首頁">
        <span class="brand-mark">日</span>
        <span class="brand-name">好日生活 <small>GOODDAY STUDIO</small></span>
      </router-link>

      <nav class="site-nav" aria-label="主要導覽">
        <router-link to="/shop">選物商城</router-link>
        <router-link :to="{ path: '/', hash: '#story' }">品牌故事</router-link>
        <router-link :to="{ path: '/', hash: '#collection' }">生活提案</router-link>
      </nav>

      <div class="store-header-actions">
        <router-link to="/account" class="header-link">會員登入</router-link>
        <router-link to="/cart" class="header-link cart-header-link">購物車 <span>{{ cart.itemCount }}</span></router-link>
      </div>
    </header>

    <section v-if="activeSlide" class="brand-hero" aria-roledescription="carousel" aria-label="品牌精選">
      <img
        :key="activeSlide.id"
        class="hero-image"
        :src="activeSlide.image"
        :alt="activeSlide.title.replace('\n', '')"
      />
      <div class="hero-shade" />
      <div class="hero-copy">
        <span class="hero-eyebrow"><i /> {{ activeSlide.eyebrow }}</span>
        <h1>{{ activeSlide.title }}</h1>
        <p>{{ activeSlide.description }}</p>
        <router-link to="/shop" class="hero-cta">{{ activeSlide.action }} <span>↗</span></router-link>
      </div>

      <div class="carousel-controls">
        <button class="carousel-arrow" aria-label="上一張" @click="showSlide(currentIndex - 1)">←</button>
        <button
          v-for="(slide, index) in site.slides"
          :key="slide.id"
          class="carousel-dot"
          :class="{ active: currentIndex === index }"
          :aria-label="`顯示第 ${index + 1} 張`"
          :aria-current="currentIndex === index ? 'true' : undefined"
          @click="showSlide(index)"
        />
        <span class="carousel-count">{{ String(currentIndex + 1).padStart(2, '0') }} / {{ String(site.slides.length).padStart(2, '0') }}</span>
        <button class="carousel-arrow" aria-label="下一張" @click="showSlide(currentIndex + 1)">→</button>
      </div>
      <span class="hero-side-note">TAKE IT SLOW · LIVE IT WELL</span>
    </section>
    <section v-else class="brand-hero" aria-label="品牌精選">
      <div class="hero-copy">
        <p>{{ site.error || '正在載入首頁內容…' }}</p>
      </div>
    </section>

    <section id="story" class="intro-section">
      <div class="intro-kicker">A LITTLE MORE GOOD IN EVERY DAY</div>
      <div class="intro-copy">
        <h2>日子不必很滿，<br />有喜歡的就好。</h2>
        <div>
          <p>好日生活相信，日常裡的小小選擇，會慢慢拼成理想的生活。</p>
          <p>我們走進城市與山海，尋找值得分享的風景、物件與好味道。</p>
          <router-link :to="{ path: '/', hash: '#collection' }" class="text-link">認識好日生活 <span>↗</span></router-link>
        </div>
      </div>
      <div class="intro-image">
        <img
          src="https://images.unsplash.com/photo-1449247709967-d4461a6a6103?auto=format&fit=crop&w=1400&q=85"
          alt="陽光灑進溫暖的生活空間"
          loading="lazy"
        />
        <span>讓生活回到喜歡的節奏。</span>
      </div>
    </section>

    <section id="collection" class="collection-section">
      <div class="collection-heading">
        <div>
          <span class="section-kicker">CURATED FOR YOUR DAYS</span>
          <h2>日常裡的好提案</h2>
        </div>
        <router-link to="/shop" class="text-link">前往選物商城 <span>↗</span></router-link>
      </div>

      <div class="collection-grid row g-3">
        <router-link :to="{ path: '/', hash: '#journal' }" class="collection-card collection-card-large col-12 col-sm-6 col-lg-5">
          <img
            src="https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=1200&q=85"
            alt="精選居家生活物件"
            loading="lazy"
          />
          <span class="collection-index">01 / HOME</span>
          <div><h3>把喜歡帶回家</h3><span>居家選物 ↗</span></div>
        </router-link>
        <router-link :to="{ path: '/', hash: '#journal' }" class="collection-card col-6 col-lg-3">
          <img
            src="https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&w=1000&q=85"
            alt="午後咖啡時光"
            loading="lazy"
          />
          <span class="collection-index">02 / TASTE</span>
          <div><h3>日常好好吃</h3><span>風味地圖 ↗</span></div>
        </router-link>
        <router-link id="journal" :to="{ path: '/', hash: '#story' }" class="collection-card col-6 col-lg-4">
          <img
            src="https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1000&q=85"
            alt="山間湖畔的旅行風景"
            loading="lazy"
          />
          <span class="collection-index">03 / TRAVEL</span>
          <div><h3>去喜歡的地方</h3><span>週末散步 ↗</span></div>
        </router-link>
      </div>
    </section>

    <footer class="site-footer">
      <router-link to="/" class="brand-lockup">
        <span class="brand-mark">日</span>
        <span class="brand-name">好日生活 <small>GOODDAY STUDIO</small></span>
      </router-link>
      <span>讓每一天，都有一點喜歡的事。</span>
      <span>© 2026 GOODDAY STUDIO</span>
    </footer>
  </main>
</template>
