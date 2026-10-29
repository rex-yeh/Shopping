<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { apiRequest } from '../lib/api'
import { useAuthStore } from '../store/auth'
import { useSiteStore } from '../store/site'

const auth = useAuthStore()
const site = useSiteStore()
const router = useRouter()
const activeTab = ref('overview')
const menuOpen = ref(false)
const notice = ref('')
const errorMessage = ref('')
const overview = ref(null)
const products = ref([])
const sales = ref(null)
const editingProductId = ref('')
const productDraft = ref({ name: '', description: '', price: '', image: '', stock: 0, isActive: true })
const slideDrafts = ref([])
const roleNameDraft = ref('')
const selectedRoleId = ref('')
const selectedPermissions = ref([])
const newRole = ref({ label: '', level: '' })
const newPermission = ref({ id: '', label: '', groupId: '' })
const permissionNameDrafts = ref({})
const newSlide = ref({ title: '', description: '', image: '' })

const navigation = [
  { id: 'overview', label: '營運總覽', permission: 'dashboard:view', icon: '⌂' },
  { id: 'products', label: '商品管理', permission: 'products:manage', icon: '◇' },
  { id: 'sales', label: '銷售追蹤', permission: 'sales:view', icon: '↗' },
  { id: 'slides', label: '首頁輪播', permission: 'content:edit', icon: '▧' },
  { id: 'members', label: '成員管理', permission: 'users:manage', icon: '♧' },
  { id: 'roles', label: '角色與權限', permission: 'roles:manage', icon: '⌘' },
]
const visibleNavigation = computed(() => navigation.filter((item) => auth.hasPermission(item.permission)))
const activePageLabel = computed(
  () => navigation.find((item) => item.id === activeTab.value)?.label || '營運總覽',
)
const selectedRole = computed(() => auth.getRole(selectedRoleId.value))
const roleLevelGuide = computed(() =>
  [...auth.roles]
    .sort((left, right) => right.level - left.level)
    .map((role) => `${role.label} ${role.level}`)
    .join(' · '),
)
const permissionRows = computed(() =>
  (auth.user?.permissions || []).map((id) => ({
    key: id,
    label: auth.user?.permissionLabels?.[id] || id,
  })),
)
const canDeleteSelectedRole = computed(
  () => selectedRole.value && selectedRole.value.memberCount === 0,
)

watch(
  selectedRole,
  (role) => {
    roleNameDraft.value = role?.label || ''
    selectedPermissions.value = role ? [...role.permissions] : []
  },
  { immediate: true },
)

watch(
  () => auth.permissionItems,
  (permissions) => {
    permissionNameDrafts.value = Object.fromEntries(
      permissions.map((permission) => [permission.id, permission.label]),
    )
  },
  { immediate: true, deep: true },
)

const showError = (error, fallback) => {
  errorMessage.value = error instanceof Error ? error.message : fallback
  notice.value = ''
}

const loadAdminData = async () => {
  const tasks = []
  if (auth.hasPermission('dashboard:view')) {
    tasks.push(
      apiRequest('/api/admin/overview').then((data) => {
        overview.value = data
      }),
    )
  }
  if (auth.hasPermission('content:edit')) {
    tasks.push(
      site.loadSlides().then(() => {
        slideDrafts.value = site.slides.map((slide) => ({ ...slide }))
      }),
    )
  }
  if (auth.hasPermission('products:manage')) {
    tasks.push(
      apiRequest('/api/admin/products').then((data) => {
        products.value = data
      }),
    )
  }
  if (auth.hasPermission('sales:view')) {
    tasks.push(
      apiRequest('/api/admin/sales').then((data) => {
        sales.value = data
      }),
    )
  }
  if (auth.hasPermission('roles:manage')) {
    tasks.push(
      auth.loadRoles().then((roles) => {
        if (!roles.some((role) => role.id === selectedRoleId.value)) {
          selectedRoleId.value = roles[0]?.id || ''
        }
      }),
    )
  }
  if (auth.hasPermission('users:manage')) tasks.push(auth.loadMembers())
  await Promise.all(tasks)
}

onMounted(async () => {
  try {
    await auth.initialize()
    await loadAdminData()
  } catch (error) {
    showError(error, '載入後台資料失敗。')
  }
})

const saveSlides = async () => {
  try {
    await site.saveSlides(slideDrafts.value.map((slide) => ({ ...slide })))
    notice.value = '首頁輪播已儲存，前台已同步更新。'
    errorMessage.value = ''
  } catch (error) {
    showError(error, '儲存輪播時發生錯誤。')
  }
}

const addSlide = async () => {
  slideDrafts.value.push({
    id: `slide-${crypto.randomUUID()}`,
    eyebrow: '好日生活・最新提案',
    title: newSlide.value.title.trim(),
    description: newSlide.value.description.trim(),
    image: newSlide.value.image.trim(),
    action: '探索生活提案',
  })
  await saveSlides()
  if (!errorMessage.value) newSlide.value = { title: '', description: '', image: '' }
}

const removeSlide = async (index) => {
  if (slideDrafts.value.length === 1) {
    errorMessage.value = '至少保留一張輪播圖片。'
    notice.value = ''
    return
  }
  slideDrafts.value.splice(index, 1)
  await saveSlides()
}

const moveSlide = async (index, direction) => {
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= slideDrafts.value.length) return
  const [slide] = slideDrafts.value.splice(index, 1)
  slideDrafts.value.splice(targetIndex, 0, slide)
  await saveSlides()
}

const replaceImage = async (index, event) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    errorMessage.value = '僅支援 JPG、PNG、WebP 與 GIF 圖片。'
    notice.value = ''
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    errorMessage.value = '圖片大小需小於 5 MB。'
    notice.value = ''
    return
  }
  try {
    slideDrafts.value[index].image = await site.uploadImage(file)
    await saveSlides()
  } catch (error) {
    showError(error, '圖片上傳失敗。')
  }
}

const saveRole = async () => {
  try {
    await auth.updateRole(selectedRoleId.value, {
      label: roleNameDraft.value.trim(),
      permissions: selectedPermissions.value,
    })
    notice.value = '角色設定已儲存。'
    errorMessage.value = ''
  } catch (error) {
    showError(error, '儲存角色設定時發生錯誤。')
  }
}

const createRole = async () => {
  try {
    const role = await auth.createRole({
      label: newRole.value.label.trim(),
      level: Number(newRole.value.level),
      permissions: [],
    })
    selectedRoleId.value = role.id
    newRole.value = { label: '', level: '' }
    notice.value = '新角色已建立，可直接勾選權限。'
    errorMessage.value = ''
  } catch (error) {
    showError(error, '建立角色時發生錯誤。')
  }
}

const removeRole = async () => {
  try {
    await auth.deleteRole(selectedRoleId.value)
    selectedRoleId.value = auth.roles[0]?.id || ''
    notice.value = '角色已刪除。'
    errorMessage.value = ''
  } catch (error) {
    showError(error, '刪除角色時發生錯誤。')
  }
}

const updateAccountRole = async (account, event) => {
  const previousRole = account.roleId
  try {
    await auth.updateAccountRole(account.id, event.target.value)
    notice.value = `${account.name} 的角色已更新。`
    errorMessage.value = ''
  } catch (error) {
    event.target.value = previousRole
    showError(error, '更新成員角色時發生錯誤。')
  }
}

const previewMember = async (account) => {
  try {
    await auth.previewMember(account.id)
    activeTab.value = 'overview'
    await loadAdminData()
    notice.value = `目前以「${account.name}」的權限視角預覽，資料僅供檢視。`
    errorMessage.value = ''
  } catch (error) {
    showError(error, '切換成員視角失敗。')
  }
}

const exitPreview = async () => {
  try {
    await auth.exitPreview()
    activeTab.value = 'overview'
    await loadAdminData()
    notice.value = '已返回登入者視角。'
    errorMessage.value = ''
  } catch (error) {
    showError(error, '結束成員視角失敗。')
  }
}

const addPermission = async () => {
  try {
    await auth.addPermission(newPermission.value)
    newPermission.value = { id: '', label: '', groupId: '' }
    notice.value = '新權限已加入，可指派給角色。'
    errorMessage.value = ''
  } catch (error) {
    showError(error, '新增權限時發生錯誤。')
  }
}

const savePermissionName = async (permissionId) => {
  try {
    await auth.updatePermission(permissionId, permissionNameDrafts.value[permissionId] || '')
    notice.value = '權限名稱已更新。'
    errorMessage.value = ''
  } catch (error) {
    showError(error, '更新權限名稱時發生錯誤。')
  }
}

const removePermission = async (permissionId) => {
  try {
    await auth.deletePermission(permissionId)
    delete permissionNameDrafts.value[permissionId]
    notice.value = '權限已刪除，且已從所有角色移除。'
    errorMessage.value = ''
  } catch (error) {
    showError(error, '刪除權限時發生錯誤。')
  }
}

const resetProductDraft = () => {
  editingProductId.value = ''
  productDraft.value = { name: '', description: '', price: '', image: '', stock: 0, isActive: true }
}

const editProduct = (product) => {
  editingProductId.value = product.id
  productDraft.value = {
    name: product.name,
    description: product.description,
    price: (product.priceCents / 100).toFixed(2),
    image: product.image,
    stock: product.stock,
    isActive: Boolean(product.isActive),
  }
}

const saveProduct = async () => {
  try {
    const body = {
      name: productDraft.value.name.trim(),
      description: productDraft.value.description.trim(),
      priceCents: Math.round(Number(productDraft.value.price) * 100),
      image: productDraft.value.image.trim(),
      stock: Number(productDraft.value.stock),
      isActive: productDraft.value.isActive,
    }
    const product = editingProductId.value
      ? await apiRequest(`/api/admin/products/${encodeURIComponent(editingProductId.value)}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      : await apiRequest('/api/admin/products', {
          method: 'POST',
          body: JSON.stringify(body),
        })
    products.value = editingProductId.value
      ? products.value.map((item) => (item.id === product.id ? product : item))
      : [product, ...products.value]
    resetProductDraft()
    notice.value = '商品資料已儲存。'
    errorMessage.value = ''
  } catch (error) {
    showError(error, '儲存商品失敗。')
  }
}

const uploadProductImage = async (event) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    errorMessage.value = '僅支援 JPG、PNG、WebP 與 GIF 圖片。'
    notice.value = ''
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    errorMessage.value = '圖片大小需小於 5 MB。'
    notice.value = ''
    return
  }
  try {
    productDraft.value.image = await site.uploadImage(file)
    notice.value = '商品圖片已上傳，儲存商品後生效。'
    errorMessage.value = ''
  } catch (error) {
    showError(error, '商品圖片上傳失敗。')
  }
}

const archiveProduct = async (product) => {
  try {
    await apiRequest(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' })
    products.value = products.value.map((item) =>
      item.id === product.id ? { ...item, isActive: false } : item,
    )
    notice.value = `「${product.name}」已下架。`
    errorMessage.value = ''
  } catch (error) {
    showError(error, '商品下架失敗。')
  }
}

const refreshSales = async () => {
  try {
    sales.value = await apiRequest('/api/admin/sales')
    errorMessage.value = ''
  } catch (error) {
    showError(error, '載入銷售資料失敗。')
  }
}

const logout = async () => {
  try {
    await auth.logout()
    await router.push('/admin/login')
  } catch (error) {
    showError(error, '登出失敗，請稍後再試。')
  }
}
</script>

<template>
  <main class="admin-shell">
    <aside class="admin-sidebar" :class="{ 'menu-open': menuOpen }">
      <div class="admin-sidebar-header">
        <router-link to="/" class="admin-brand">
          <span class="brand-mark">日</span>
          <span>好日生活<small>STUDIO ADMIN</small></span>
        </router-link>
        <button
          class="mobile-menu-toggle"
          type="button"
          aria-controls="admin-navigation"
          :aria-expanded="menuOpen"
          :aria-label="menuOpen ? '收合後台選單' : '展開後台選單'"
          @click="menuOpen = !menuOpen"
        >
          <span /><span /><span />
        </button>
      </div>
      <div class="sidebar-label">工作空間</div>
      <nav id="admin-navigation" class="admin-nav" aria-label="後台導覽">
        <button
          v-for="item in visibleNavigation"
          :key="item.id"
          :class="{ active: activeTab === item.id }"
          @click="activeTab = item.id; menuOpen = false"
        >
          <span class="nav-icon">{{ item.icon }}</span>{{ item.label }}
          <span v-if="item.id === 'slides'" class="nav-badge">編輯</span>
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-help">
          <span class="help-icon">?</span>
          <strong>資料來源</strong>
          <small>API 與 SQLite 資料庫</small>
        </div>
        <router-link to="/" class="back-to-site">↗ 前往形象網站</router-link>
      </div>
    </aside>

    <section class="admin-main">
      <header class="admin-topbar">
        <div class="breadcrumb"><span>工作空間</span><b>/</b> {{ activePageLabel }}</div>
        <div class="admin-account">
          <div class="account-avatar">{{ auth.user?.name?.slice(0, 1) || 'A' }}</div>
          <div class="account-name">
            <strong>{{ auth.user?.name }}</strong>
            <small>{{ auth.roleMap[auth.effectiveRole]?.label }}帳號</small>
          </div>
          <span class="account-divider" />
          <span class="current-role">{{ auth.roleMap[auth.effectiveRole]?.label }}</span>
          <router-link to="/" class="frontend-shortcut">前往前台 <span>↗</span></router-link>
          <button class="logout-button" aria-label="登出" title="登出" @click="logout">↗</button>
        </div>
      </header>

      <div v-if="auth.viewingAs" class="preview-banner" role="status">
        <span>目前為唯讀成員視角：{{ auth.user?.name }}（{{ auth.user?.role }}）</span>
        <button class="btn btn-sm btn-outline-dark" @click="exitPreview">結束預覽</button>
      </div>
      <div v-if="notice" class="notice-banner" role="status">
        <span>✓</span> {{ notice }} <button aria-label="關閉訊息" @click="notice = ''">×</button>
      </div>
      <div v-if="errorMessage" class="error-banner" role="alert">
        <span>!</span> {{ errorMessage }} <button aria-label="關閉錯誤訊息" @click="errorMessage = ''">×</button>
      </div>

      <div v-if="activeTab === 'overview' && auth.hasPermission('dashboard:view')" class="admin-content">
        <section class="welcome-row">
          <div>
            <div class="page-kicker"><span class="status-pulse" /> 今日營運概況</div>
            <h1>早安，{{ auth.user?.name }} <span>☀</span></h1>
            <p>一起看看好日生活今天的品牌表現。</p>
          </div>
          <div class="date-chip">{{ new Date().toLocaleDateString('zh-TW') }}</div>
        </section>

        <section class="metric-grid row g-3" aria-label="營運指標">
          <article v-for="(metric, index) in overview?.summary || []" :key="metric.label" class="metric-card col-6 col-xl-3">
            <div class="metric-top">
              <span>{{ metric.label }}</span>
              <span class="metric-icon" :class="['peach', 'green', 'blue', 'yellow'][index % 4]">↗</span>
            </div>
            <strong>{{ metric.value }}</strong>
            <div class="metric-foot"><span class="metric-up">↑ {{ metric.trend }}</span><span>較上週</span></div>
          </article>
        </section>

        <section class="dashboard-panels row g-3">
          <article v-if="auth.hasPermission('reports:view')" class="dashboard-card traffic-card col-12 col-xl-8">
            <div class="card-heading">
              <div><span class="section-kicker">PERFORMANCE</span><h2>網站流量趨勢</h2></div>
              <span class="period-button">最近 7 天</span>
            </div>
            <p class="role-panel-caption">報表趨勢資料將由分析 API 提供。</p>
          </article>
          <article class="dashboard-card permission-card col-12 col-xl-4">
            <div class="card-heading"><div><span class="section-kicker">ACCESS CONTROL</span><h2>目前權限</h2></div></div>
            <p class="permission-caption">依照此帳號直接指派的權限顯示</p>
            <ul class="permission-list">
              <li v-for="permission in permissionRows" :key="permission.key">
                <span>{{ permission.label }}</span><span class="permission-state enabled"><i /> 可使用</span>
              </li>
            </ul>
          </article>
        </section>

        <section class="dashboard-card activity-card">
          <div class="card-heading"><div><span class="section-kicker">LATEST UPDATES</span><h2>最近更新</h2></div></div>
          <div class="activity-table">
            <div class="activity-row activity-head"><span>更新項目</span><span>負責成員</span><span>狀態</span><span>更新時間</span></div>
            <div v-for="item in overview?.recentActivity || []" :key="item.title" class="activity-row">
              <span class="activity-title">{{ item.title }}</span>
              <span class="member-cell">{{ item.member }}</span>
              <span>{{ item.status }}</span><span>{{ item.time }}</span>
            </div>
          </div>
        </section>
      </div>

      <div v-else-if="activeTab === 'slides' && auth.hasPermission('content:edit')" class="admin-content">
        <section class="welcome-row">
          <div>
            <div class="page-kicker"><span class="status-pulse" /> 前台內容管理</div>
            <h1>首頁輪播 <span class="heading-muted">/ {{ slideDrafts.length }} 張圖片</span></h1>
            <p>管理首頁主視覺圖片與文字，儲存後透過 API 同步至前台。</p>
          </div>
          <a class="outline-button" href="/" target="_blank" rel="noreferrer">預覽前台 ↗</a>
        </section>
        <section class="slide-editor-list">
          <article v-for="(slide, index) in slideDrafts" :key="slide.id" class="slide-editor-card">
            <div class="slide-preview">
              <img :src="slide.image" :alt="slide.title" />
              <span class="slide-number">0{{ index + 1 }}</span>
              <label class="upload-overlay">
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" @change="replaceImage(index, $event)" />
                <span>↑</span> 更換圖片
              </label>
            </div>
            <div class="slide-fields">
              <div class="slide-field-heading">
                <div><span class="section-kicker">SLIDE 0{{ index + 1 }}</span><h2>輪播內容</h2></div>
                <div class="slide-actions">
                  <button :disabled="index === 0" aria-label="向前移動" @click="moveSlide(index, -1)">↑</button>
                  <button :disabled="index === slideDrafts.length - 1" aria-label="向後移動" @click="moveSlide(index, 1)">↓</button>
                  <button class="delete-slide" aria-label="刪除輪播" @click="removeSlide(index)">移除</button>
                </div>
              </div>
              <label class="form-field"><span>眉標</span><input v-model="slide.eyebrow" maxlength="80" /></label>
              <label class="form-field"><span>主標題</span><input v-model="slide.title" maxlength="100" /></label>
              <label class="form-field"><span>簡介文字</span><textarea v-model="slide.description" rows="2" maxlength="300" /></label>
              <label class="form-field"><span>按鈕文字</span><input v-model="slide.action" maxlength="80" /></label>
              <label class="form-field"><span>圖片網址</span><input v-model="slide.image" type="url" /></label>
              <button class="save-slide-button" @click="saveSlides">儲存變更 <span>→</span></button>
            </div>
          </article>
        </section>
        <form class="add-slide-card" @submit.prevent="addSlide">
          <div class="add-slide-copy"><span class="add-icon">＋</span><div><h2>新增輪播圖片</h2><p>以 HTTPS 圖片網址新增主視覺。</p></div></div>
          <div class="add-slide-fields">
            <input v-model="newSlide.title" required maxlength="100" placeholder="主標題" aria-label="新輪播主標題" />
            <input v-model="newSlide.description" required maxlength="300" placeholder="簡介文字" aria-label="新輪播簡介文字" />
            <input v-model="newSlide.image" type="url" required placeholder="圖片網址 https://..." aria-label="新輪播圖片網址" />
            <button type="submit" class="save-slide-button">新增圖片 <span>＋</span></button>
          </div>
        </form>
        <p class="storage-note"><span>ⓘ</span> 圖片檔案由後端儲存；支援 JPG、PNG、WebP 與 GIF，大小限制 5 MB。</p>
      </div>

      <div v-else-if="activeTab === 'products' && auth.hasPermission('products:manage')" class="admin-content">
        <section class="welcome-row">
          <div>
            <div class="page-kicker"><span class="status-pulse" /> STORE CATALOG</div>
            <h1>商品管理</h1>
            <p>上架商品、維護價格與庫存；下架商品不會出現在前台。</p>
          </div>
          <button class="outline-button" @click="resetProductDraft">新增商品 ＋</button>
        </section>

        <section class="dashboard-card product-editor-card">
          <div class="card-heading">
            <div><span class="section-kicker">{{ editingProductId ? 'EDIT PRODUCT' : 'NEW PRODUCT' }}</span><h2>{{ editingProductId ? '編輯商品' : '新增商品' }}</h2></div>
            <button v-if="editingProductId" class="store-secondary-button" @click="resetProductDraft">取消編輯</button>
          </div>
          <form class="product-editor-form" @submit.prevent="saveProduct">
            <label class="form-field"><span>商品名稱</span><input v-model.trim="productDraft.name" required maxlength="100" /></label>
            <label class="form-field"><span>售價（新台幣）</span><input v-model="productDraft.price" required type="number" min="0" max="1000000" step="1" inputmode="decimal" /></label>
            <label class="form-field"><span>庫存數量</span><input v-model.number="productDraft.stock" required type="number" min="0" max="1000000" step="1" /></label>
            <label class="form-field product-description-field"><span>商品介紹</span><textarea v-model.trim="productDraft.description" maxlength="2000" rows="3" /></label>
            <label class="form-field product-image-field"><span>商品圖片 HTTPS 網址或已上傳圖片</span><input v-model.trim="productDraft.image" required type="text" placeholder="https://... 或 /uploads/..." /></label>
            <label class="product-upload-button">
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" @change="uploadProductImage" />
              上傳圖片（5 MB 內）
            </label>
            <label class="product-active-toggle"><input v-model="productDraft.isActive" type="checkbox" />立即上架</label>
            <button class="save-slide-button" type="submit">{{ editingProductId ? '儲存商品' : '建立並上架' }} <span>→</span></button>
          </form>
        </section>

        <section class="product-admin-grid">
          <article v-for="product in products" :key="product.id" class="dashboard-card product-admin-card" :class="{ 'product-archived': !product.isActive }">
            <img :src="product.image" :alt="product.name" />
            <div class="product-admin-copy">
              <div class="product-admin-heading"><h2>{{ product.name }}</h2><span :class="product.isActive ? 'order-status status-paid' : 'order-status status-cancelled'">{{ product.isActive ? '上架中' : '已下架' }}</span></div>
              <p>{{ product.description }}</p>
              <div class="product-admin-meta"><strong>NT$ {{ (product.priceCents / 100).toLocaleString('zh-TW') }}</strong><span>庫存 {{ product.stock }}</span></div>
              <div class="product-admin-actions">
                <button class="store-secondary-button" @click="editProduct(product)">編輯 / 上下架</button>
                <button v-if="product.isActive" class="catalog-delete-button" @click="archiveProduct(product)">下架</button>
              </div>
            </div>
          </article>
          <p v-if="!products.length" class="shop-empty-state">目前還沒有商品。</p>
        </section>
      </div>

      <div v-else-if="activeTab === 'sales' && auth.hasPermission('sales:view')" class="admin-content">
        <section class="welcome-row">
          <div>
            <div class="page-kicker"><span class="status-pulse" /> STORE ANALYTICS</div>
            <h1>銷售追蹤</h1>
            <p>銷售數字只統計已完成付款的訂單；測試金流付款不代表實際收款。</p>
          </div>
          <button class="outline-button" @click="refreshSales">重新整理 ↻</button>
        </section>
        <section class="metric-grid row g-3">
          <article class="metric-card col-12 col-md-4"><div class="metric-top"><span>已付款營收</span><span class="metric-icon peach">＄</span></div><strong>NT$ {{ ((sales?.revenueCents || 0) / 100).toLocaleString('zh-TW') }}</strong><div class="metric-foot">已完成付款訂單</div></article>
          <article class="metric-card col-12 col-md-4"><div class="metric-top"><span>已付款訂單</span><span class="metric-icon green">▤</span></div><strong>{{ sales?.orderCount || 0 }}</strong><div class="metric-foot">含模擬測試付款</div></article>
          <article class="metric-card col-12 col-md-4"><div class="metric-top"><span>售出件數</span><span class="metric-icon blue">◇</span></div><strong>{{ sales?.unitsSold || 0 }}</strong><div class="metric-foot">已付款商品總數</div></article>
        </section>
        <section class="dashboard-card sales-table-card">
          <div class="card-heading"><div><span class="section-kicker">BEST SELLERS</span><h2>熱銷商品</h2></div></div>
          <div v-if="sales?.bestSellers?.length" class="sales-table">
            <div class="sales-table-row sales-table-head"><span>商品</span><span>售出件數</span><span>營收</span></div>
            <div v-for="(item, index) in sales.bestSellers" :key="item.productId" class="sales-table-row">
              <span><b class="sales-rank">{{ index + 1 }}</b>{{ item.name }}</span><strong>{{ item.unitsSold }}</strong><strong>NT$ {{ (item.revenueCents / 100).toLocaleString('zh-TW') }}</strong>
            </div>
          </div>
          <p v-else class="shop-empty-state">尚無已付款銷售資料。測試訂單完成模擬付款後，銷量會顯示於此。</p>
        </section>
        <section class="dashboard-card sales-table-card">
          <div class="card-heading"><div><span class="section-kicker">RECENT ORDERS</span><h2>近期訂單</h2></div><span class="member-count">{{ sales?.recentOrders?.length || 0 }} 筆</span></div>
          <div v-if="sales?.recentOrders?.length" class="sales-table">
            <div class="sales-table-row sales-order-head"><span>訂單 / 會員</span><span>件數</span><span>金額</span><span>狀態</span></div>
            <div v-for="order in sales.recentOrders" :key="order.id" class="sales-table-row sales-order-row">
              <span><strong>{{ order.id }}</strong><small>{{ order.customerName }} · {{ new Date(order.createdAt).toLocaleString('zh-TW') }}</small></span>
              <span>{{ order.units }}</span>
              <strong>NT$ {{ (order.totalCents / 100).toLocaleString('zh-TW') }}</strong>
              <span class="order-status" :class="`status-${order.status}`">{{ { pending: '待付款', paid: '已付款', cancelled: '已取消' }[order.status] }}</span>
            </div>
          </div>
          <p v-else class="shop-empty-state">目前還沒有訂單。</p>
        </section>
      </div>

      <div v-else-if="activeTab === 'members' && auth.hasPermission('users:manage')" class="admin-content">
        <section class="welcome-row"><div><div class="page-kicker"><span class="status-pulse" /> 團隊協作</div><h1>成員管理</h1><p>僅能管理權限層級低於自己的成員。</p></div></section>
        <section class="dashboard-card members-card">
          <div class="card-heading"><div><span class="section-kicker">TEAM MEMBERS</span><h2>成員清單</h2></div><span class="member-count">{{ auth.accounts.length }} 位成員</span></div>
          <div class="member-list">
            <div v-for="account in auth.accounts" :key="account.id" class="member-list-row account-list-row">
              <i class="member-avatar avatar-coral">{{ account.name.slice(0, 1) }}</i>
              <div class="member-identity"><strong>{{ account.name }}</strong><small>@{{ account.username }} · {{ account.roleLabel }}</small></div>
              <label class="account-role-select">
                <span>角色</span>
                <select :value="account.roleId" :aria-label="`${account.name}的角色`" @change="updateAccountRole(account, $event)">
                  <option v-for="role in auth.assignableRoles" :key="role.id" :value="role.id">{{ role.label }}</option>
                </select>
              </label>
              <button class="member-eye-button" type="button" :aria-label="`以${account.name}視角預覽`" :title="`以${account.name}視角預覽`" @click="previewMember(account)">◉</button>
            </div>
            <p v-if="!auth.accounts.length" class="role-panel-caption">目前沒有可管理的下級成員。</p>
          </div>
        </section>
      </div>

      <div v-else-if="activeTab === 'roles' && auth.hasPermission('roles:manage')" class="admin-content role-management">
        <section class="welcome-row">
          <div><div class="page-kicker"><span class="status-pulse" /> ACCESS CONTROL</div><h1>角色與權限</h1><p>角色權限逐項直接勾選，不採用角色繼承；層級只限制管理範圍。</p></div>
        </section>
        <section class="role-workspace">
          <aside class="dashboard-card role-list-card">
            <div class="card-heading"><div><span class="section-kicker">ROLE LEVELS</span><h2>可管理角色</h2></div><span class="member-count">{{ auth.roles.length }} 個角色</span></div>
            <p class="role-panel-caption">
              數字越大層級越高；只能編輯層級低於自己的角色。你的層級：<strong>{{ auth.user?.level }}</strong>
            </p>
            <div class="role-tree-list">
              <button v-for="role in auth.roles" :key="role.id" class="role-tree-item" :class="{ selected: selectedRoleId === role.id }" @click="selectedRoleId = role.id">
                <span class="role-tree-branch">●</span>
                <span class="role-tree-name">{{ role.label }}</span>
                <span class="role-level-badge">層級 {{ role.level }}</span>
                <small>{{ role.permissions.length }} 權限</small>
              </button>
            </div>
            <form class="new-role-form" @submit.prevent="createRole">
              <span class="section-kicker">ADD ROLE</span>
              <input v-model.trim="newRole.label" required maxlength="40" placeholder="新角色名稱" aria-label="新角色名稱" />
              <p class="role-level-guide">
                新角色層級需為 <strong>1–{{ Math.max(0, (auth.user?.level || 1) - 1) }}</strong>，
                並依需求設定在對應角色之下。現有層級：{{ roleLevelGuide || '尚無其他角色' }}
              </p>
              <label class="form-field">
                <span>新角色層級（數字越大，管理權限範圍越高）</span>
                <input
                  v-model.number="newRole.level"
                  required
                  type="number"
                  min="1"
                  :max="(auth.user?.level || 1) - 1"
                  step="1"
                  inputmode="numeric"
                  placeholder="請參考上方現有層級，例如 70"
                  aria-label="新角色層級"
                />
              </label>
              <button type="submit" class="save-slide-button">新增角色 <span>＋</span></button>
            </form>
          </aside>
          <section v-if="selectedRole" class="dashboard-card role-editor-card">
            <div class="card-heading role-editor-heading">
              <div><span class="section-kicker">EDIT ROLE · LEVEL {{ selectedRole.level }}</span><h2>{{ selectedRole.label }}</h2></div>
              <button class="delete-role-button" :disabled="!canDeleteSelectedRole" title="需先移除此角色的所有成員" @click="removeRole">刪除角色</button>
            </div>
            <label class="form-field"><span>角色名稱</span><input v-model.trim="roleNameDraft" maxlength="40" /></label>
            <div class="role-parent-note"><span>⌘</span> 權限為此角色直接指派，不會由其他角色繼承。</div>
            <div class="role-permission-heading">
              <div><span class="section-kicker">DIRECT PERMISSIONS</span><h3>權限指派</h3></div>
              <button class="save-slide-button" @click="saveRole">儲存角色設定 <span>→</span></button>
            </div>
            <div class="permission-tree">
              <section v-for="group in auth.permissionTree" :key="group.id" class="permission-group">
                <h4><span>⌑</span>{{ group.label }}</h4>
                <label v-for="permission in group.children" :key="permission.id" class="permission-option">
                  <input v-model="selectedPermissions" type="checkbox" :value="permission.id" />
                  <span class="permission-checkmark" />
                  <span class="permission-option-copy"><strong>{{ permission.label }}</strong><small>{{ permission.id }}</small></span>
                  <span v-if="permission.isSystem" class="direct-badge">系統</span>
                </label>
              </section>
            </div>
          </section>
        </section>

        <section v-if="auth.hasPermission('permissions:manage')" class="dashboard-card permission-catalog-card">
          <div class="card-heading"><div><span class="section-kicker">PERMISSION CATALOG</span><h2>權限目錄</h2></div><span class="member-count">{{ auth.permissionItems.length }} 項權限</span></div>
          <p class="role-panel-caption">新增的權限可直接指派給您可管理的角色；系統權限不能刪除。</p>
          <div class="permission-catalog">
            <section v-for="group in auth.permissionTree" :key="group.id" class="catalog-group">
              <h3>{{ group.label }}</h3>
              <div v-for="permission in group.children" :key="permission.id" class="catalog-permission-row">
                <code>{{ permission.id }}</code>
                <input v-model="permissionNameDrafts[permission.id]" :aria-label="`${permission.label}權限名稱`" :placeholder="permission.label" />
                <button class="catalog-save-button" @click="savePermissionName(permission.id)">儲存名稱</button>
                <button class="catalog-delete-button" :disabled="permission.isSystem" @click="removePermission(permission.id)">刪除</button>
              </div>
            </section>
          </div>
          <form class="add-permission-form" @submit.prevent="addPermission">
            <input v-model.trim="newPermission.id" required maxlength="64" placeholder="權限代碼，例如 inventory:manage" aria-label="權限代碼" />
            <input v-model.trim="newPermission.label" required maxlength="60" placeholder="權限名稱" aria-label="權限名稱" />
            <select v-model="newPermission.groupId" required aria-label="權限分類">
              <option value="" disabled>選擇權限分類</option>
              <option v-for="group in auth.permissionTree" :key="group.id" :value="group.id">{{ group.label }}</option>
            </select>
            <button type="submit" class="save-slide-button">新增權限 <span>＋</span></button>
          </form>
        </section>
      </div>

      <div v-else class="admin-content">
        <section class="dashboard-card no-admin-permissions">
          <span class="section-kicker">NO AVAILABLE MODULES</span>
          <h1>目前沒有可使用的後台功能</h1>
          <p>此成員視角沒有可使用的後台權限；可結束預覽返回登入者。</p>
        </section>
      </div>
    </section>
  </main>
</template>
