<template>
  <div v-if="isShowcaseMode" class="showcase-banner">
    前端展示版｜購物車僅供瀏覽，會員、管理後台及付款功能未啟用
  </div>
  <router-view />
</template>

<script setup>
import { isShowcaseMode } from './lib/showcase'
</script>
