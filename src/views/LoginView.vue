<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'

const router = useRouter()
const auth = useAuthStore()
const isDevelopment = import.meta.env.DEV
const username = ref('')
const password = ref('')
const errorMessage = ref('')
const submitting = ref(false)

const login = async () => {
  submitting.value = true
  errorMessage.value = ''
  try {
    await auth.login(username.value, password.value)
    if (!auth.hasPermission('admin:access')) {
      await auth.logout()
      errorMessage.value = '此會員帳號沒有後台權限，請從商店會員入口登入。'
      return
    }
    await router.push('/admin')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '登入失敗，請稍後再試。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="page auth-page">
    <section class="auth-card">
      <div class="auth-header">
        <span class="eyebrow">ADMIN ACCESS</span>
        <h1>管理員登入</h1>
        <p class="auth-description">使用帳號與密碼登入，系統會依帳號權限開啟可使用的功能。</p>
      </div>

      <form class="login-form" @submit.prevent="login">
        <label class="form-field">
          <span>帳號</span>
          <input v-model.trim="username" autocomplete="username" required maxlength="100" />
        </label>
        <label class="form-field">
          <span>密碼</span>
          <input v-model="password" type="password" autocomplete="current-password" required maxlength="200" />
        </label>
        <p v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</p>
        <button class="primary-btn login-btn" type="submit" :disabled="submitting">
          {{ submitting ? '登入中…' : '登入管理後台' }}
        </button>
      </form>
      <p v-if="isDevelopment" class="auth-description demo-login-hint">開發管理帳號：superadmin / 密碼：GooddayDemo2026!</p>
      <router-link class="account-switch-link" to="/account">我是購物會員，前往會員登入</router-link>
    </section>
  </main>
</template>
