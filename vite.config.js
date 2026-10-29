import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isShowcase = env.VITE_SHOWCASE_MODE === 'true'

  return {
    base: isShowcase ? '/Shopping/' : '/',
    plugins: [vue()],
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': 'http://127.0.0.1:3000',
        '/uploads': 'http://127.0.0.1:3000',
      },
    },
  }
})
