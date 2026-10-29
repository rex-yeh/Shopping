import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../store/auth'
import HomeView from '../views/HomeView.vue'
import LoginView from '../views/LoginView.vue'
import AdminView from '../views/AdminView.vue'
import ShopView from '../views/ShopView.vue'
import CartView from '../views/CartView.vue'
import MemberAccountView from '../views/MemberAccountView.vue'

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
  },
  {
    path: '/shop',
    name: 'shop',
    component: ShopView,
  },
  {
    path: '/cart',
    name: 'cart',
    component: CartView,
  },
  {
    path: '/account',
    name: 'account',
    component: MemberAccountView,
  },
  {
    path: '/login',
    redirect: '/account',
  },
  {
    path: '/admin/login',
    name: 'admin-login',
    component: LoginView,
    meta: { adminLogin: true },
  },
  {
    path: '/admin',
    name: 'admin',
    component: AdminView,
    meta: { requiresAuth: true, permissions: ['admin:access'] },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  return guardRoute(to)
})

const guardRoute = async (to) => {
  const auth = useAuthStore()
  await auth.initialize()

  if (to.meta.adminLogin) {
    if (auth.hasPermission('admin:access')) return '/admin'
    return true
  }

  if (!to.meta.requiresAuth) {
    return true
  }

  if (!auth.user) {
    return '/admin/login'
  }

  if (to.meta.permissions?.some((permission) => !auth.hasPermission(permission))) {
    return auth.hasPermission('admin:access') ? '/' : '/admin/login'
  }

  return true
}

export default router
