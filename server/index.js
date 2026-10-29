import bcrypt from 'bcryptjs'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import session from 'express-session'
import helmet from 'helmet'
import multer from 'multer'
import { db, dataDirectory, getPublicUser, userById } from './db.js'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const uploadDirectory = path.join(dataDirectory, 'uploads')
mkdirSync(uploadDirectory, { recursive: true })

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('Production requires SESSION_SECRET.')
}

const app = express()
const port = Number(process.env.API_PORT || 3000)
const sessionSecret = process.env.SESSION_SECRET || 'development-only-change-this-session-secret'

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )
`)
db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())

const sessionExpiration = (sessionData) => {
  const explicitExpiration = sessionData.cookie?.expires
    ? new Date(sessionData.cookie.expires).getTime()
    : NaN
  if (Number.isFinite(explicitExpiration)) return explicitExpiration
  const maxAge = Number(sessionData.cookie?.maxAge)
  return Date.now() + (Number.isFinite(maxAge) ? maxAge : 24 * 60 * 60 * 1000)
}

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare('SELECT data, expires_at AS expiresAt FROM sessions WHERE sid = ?').get(sid)
      if (!row) {
        callback(null, null)
        return
      }
      if (row.expiresAt <= Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid)
        callback(null, null)
        return
      }
      callback(null, JSON.parse(row.data))
    } catch (error) {
      callback(error)
    }
  }

  set(sid, sessionData, callback = () => {}) {
    try {
      db.prepare(`
        INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at
      `).run(sid, JSON.stringify(sessionData), sessionExpiration(sessionData))
      callback(null)
    } catch (error) {
      callback(error)
    }
  }

  touch(sid, sessionData, callback = () => {}) {
    try {
      db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?')
        .run(sessionExpiration(sessionData), sid)
      callback(null)
    } catch (error) {
      callback(error)
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid)
      callback(null)
    } catch (error) {
      callback(error)
    }
  }
}

app.disable('x-powered-by')
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  }),
)
app.use(express.json({ limit: '1mb' }))
app.use(
  session({
    name: 'goodday.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new SQLiteSessionStore(),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
)

const appError = (status, message) => Object.assign(new Error(message), { status })

const sendError = (response, status, message) =>
  response.status(status).json({ error: message })

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: '登入嘗試次數過多，請稍後再試。' },
})

const signupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: '註冊次數過多，請稍後再試。' },
})

const imageExtensions = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
])

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, uploadDirectory),
    filename: (_request, file, callback) =>
      callback(null, `${randomUUID()}${imageExtensions.get(file.mimetype)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!imageExtensions.has(file.mimetype)) {
      callback(appError(400, '僅支援 JPG、PNG、WebP 與 GIF 圖片。'))
      return
    }
    callback(null, true)
  },
})

const loadSessionUsers = (request, _response, next) => {
  const actor = request.session.userId ? userById.get(request.session.userId) : null
  if (!actor) {
    request.actorUser = null
    request.currentUser = null
    if (request.session.viewAsUserId) delete request.session.viewAsUserId
    next()
    return
  }

  const viewedUser = request.session.viewAsUserId
    ? userById.get(request.session.viewAsUserId)
    : null
  request.actorUser = getPublicUser(actor)
  request.currentUser = getPublicUser(viewedUser || actor)
  request.isPreviewing = Boolean(viewedUser && viewedUser.id !== actor.id)
  next()
}

app.use(loadSessionUsers)

const requireCsrf = (request, _response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    next()
    return
  }
  const expected = request.session.csrfToken
  const received = request.get('x-csrf-token')
  if (
    !expected ||
    !received ||
    expected.length !== received.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  ) {
    next(appError(403, '請求驗證失敗，請重新整理頁面後再試。'))
    return
  }
  next()
}

app.use('/api', requireCsrf)
app.use('/uploads', express.static(uploadDirectory, { dotfiles: 'deny', maxAge: '1y', immutable: true }))

const requireAuthentication = (request, _response, next) => {
  if (!request.actorUser || !request.currentUser) {
    next(appError(401, '請先登入。'))
    return
  }
  next()
}

const requireActorPermission = (permissionId) => (request, _response, next) => {
  if (!request.actorUser?.permissions.includes(permissionId)) {
    next(appError(403, '目前帳號沒有執行此操作的權限。'))
    return
  }
  next()
}

const requireCurrentPermission = (permissionId) => (request, _response, next) => {
  if (!request.currentUser?.permissions.includes(permissionId)) {
    next(appError(403, '目前檢視的成員沒有此功能權限。'))
    return
  }
  next()
}

const requireNotPreviewing = (request, _response, next) => {
  if (request.isPreviewing) {
    next(appError(403, '成員視角僅供檢視，請先結束預覽再修改資料。'))
    return
  }
  next()
}

const requireAdminMutation = (permissionId) => [
  requireAuthentication,
  requireActorPermission(permissionId),
  requireNotPreviewing,
]

const requireMemberMutation = [requireAuthentication, requireNotPreviewing]

app.use(
  '/api/admin',
  requireAuthentication,
  requireCurrentPermission('admin:access'),
)

const csrfToken = (request, response) => {
  if (!request.session.csrfToken) {
    request.session.csrfToken = randomBytes(32).toString('hex')
  }
  response.json({ csrfToken: request.session.csrfToken })
}

const getRoleById = (id) =>
  db.prepare('SELECT id, label, level FROM roles WHERE id = ?').get(id)

const canManageRole = (actor, role) =>
  Boolean(role && role.level < actor.level && role.id !== actor.roleId)

const ensureRoleIsManageable = (actor, role) => {
  if (!role) throw appError(404, '找不到此角色。')
  if (!canManageRole(actor, role)) {
    throw appError(403, '只能管理層級低於自己的角色。')
  }
}

const ensureCanGrant = (actor, permissionIds) => {
  const actorPermissions = new Set(actor.permissions)
  const missingPermission = permissionIds.find((permissionId) => !actorPermissions.has(permissionId))
  if (missingPermission) {
    throw appError(403, '不能指派目前帳號本身沒有的權限。')
  }
}

const ensureSecurityManagerRemains = () => {
  const managers = db.prepare(`
    SELECT COUNT(DISTINCT users.id) AS count
    FROM users
    JOIN roles ON roles.id = users.role_id
    JOIN role_permissions AS role_management
      ON role_management.role_id = roles.id AND role_management.permission_id = 'roles:manage'
    JOIN role_permissions AS backend_access
      ON backend_access.role_id = roles.id AND backend_access.permission_id = 'admin:access'
    WHERE users.is_active = 1
  `).get().count
  if (!managers) {
    throw appError(409, '至少保留一個可登入後台並管理角色權限的帳號。')
  }
}

const mergeAnonymousCart = db.transaction((sessionId, userId) => {
  const anonymousKey = `session:${sessionId}`
  const memberKey = `user:${userId}`
  const anonymousItems = db.prepare(`
    SELECT cart_items.product_id AS productId, cart_items.quantity,
           products.stock, products.is_active AS isActive
    FROM cart_items JOIN products ON products.id = cart_items.product_id
    WHERE cart_items.owner_key = ?
  `).all(anonymousKey)
  const memberQuantity = db.prepare(`
    SELECT quantity FROM cart_items WHERE owner_key = ? AND product_id = ?
  `)
  const upsert = db.prepare(`
    INSERT INTO cart_items (owner_key, product_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(owner_key, product_id) DO UPDATE SET
      quantity = excluded.quantity,
      updated_at = CURRENT_TIMESTAMP
  `)

  for (const item of anonymousItems) {
    if (!item.isActive || item.stock < 1) continue
    const existing = memberQuantity.get(memberKey, item.productId)?.quantity || 0
    upsert.run(memberKey, item.productId, Math.min(existing + item.quantity, item.stock))
  }
  db.prepare('DELETE FROM cart_items WHERE owner_key = ?').run(anonymousKey)
})

const startUserSession = (request, account, response, next) => {
  const previousSessionId = request.sessionID
  request.session.regenerate((error) => {
    if (error) {
      next(error)
      return
    }
    request.session.userId = account.id
    request.session.csrfToken = randomBytes(32).toString('hex')
    try {
      mergeAnonymousCart(previousSessionId, account.id)
    } catch (mergeError) {
      next(mergeError)
      return
    }
    request.session.save((saveError) => {
      if (saveError) {
        next(saveError)
        return
      }
      const loggedInUser = getPublicUser(userById.get(account.id))
      response.json({
        user: loggedInUser,
        actorUser: loggedInUser,
        viewingAs: false,
        csrfToken: request.session.csrfToken,
      })
    })
  })
}

const cartOwnerKey = (request) =>
  request.actorUser ? `user:${request.currentUser.id}` : `session:${request.sessionID}`

const getCartItems = (ownerKey) =>
  db.prepare(`
    SELECT cart_items.product_id AS productId, products.name, products.description,
           products.price_cents AS priceCents, products.image, products.stock,
           cart_items.quantity
    FROM cart_items JOIN products ON products.id = cart_items.product_id
    WHERE cart_items.owner_key = ? AND products.is_active = 1
    ORDER BY cart_items.updated_at DESC
  `).all(ownerKey)

const expirePendingOrders = db.transaction(() => {
  const expiredOrders = db.prepare(`
    SELECT id FROM orders WHERE status = 'pending' AND datetime(expires_at) <= datetime('now')
  `).all()
  const items = db.prepare(`
    SELECT product_id AS productId, quantity FROM order_items WHERE order_id = ?
  `)
  const restoreStock = db.prepare(`
    UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `)
  const cancelOrder = db.prepare(`
    UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'
  `)
  for (const order of expiredOrders) {
    for (const item of items.all(order.id)) restoreStock.run(item.quantity, item.productId)
    cancelOrder.run(order.id)
  }
})

const productFields = `
  id, name, description, price_cents AS priceCents, image,
  stock, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
`

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))
app.get('/api/auth/csrf', csrfToken)

app.post('/api/auth/login', authRateLimit, (request, response, next) => {
  const { username, password } = request.body || {}
  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    username.length > 100 ||
    password.length > 200
  ) {
    sendError(response, 400, '請輸入有效的帳號與密碼。')
    return
  }

  const account = db.prepare(`
    SELECT id, password_hash AS passwordHash
    FROM users
    WHERE username = ? AND is_active = 1
  `).get(username.trim().toLowerCase())

  if (!account || !bcrypt.compareSync(password, account.passwordHash)) {
    sendError(response, 401, '帳號或密碼錯誤。')
    return
  }

  startUserSession(request, account, response, next)
})

app.post('/api/member/register', signupRateLimit, (request, response, next) => {
  const { username, name, password } = request.body || {}
  const cleanUsername = typeof username === 'string' ? username.trim().toLowerCase() : ''
  const cleanName = typeof name === 'string' ? name.trim() : ''
  if (!/^[a-z0-9._-]{3,30}$/.test(cleanUsername)) {
    sendError(response, 400, '帳號需為 3–30 個小寫英數字、點、底線或連字號。')
    return
  }
  if (!cleanName || cleanName.length > 60) {
    sendError(response, 400, '請輸入姓名（最多 60 個字）。')
    return
  }
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) {
    sendError(response, 400, '密碼至少 10 個字元。')
    return
  }
  const guestRole = db.prepare('SELECT id FROM roles WHERE id = ?').get('guest')
  if (!guestRole) {
    sendError(response, 503, '會員角色尚未設定，請聯絡管理員。')
    return
  }
  const id = `member-${randomUUID()}`
  try {
    db.prepare(`
      INSERT INTO users (id, username, name, password_hash, role_id)
      VALUES (?, ?, ?, ?, 'guest')
    `).run(id, cleanUsername, cleanName, bcrypt.hashSync(password, 12))
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      sendError(response, 409, '此帳號已被使用。')
      return
    }
    throw error
  }
  startUserSession(request, userById.get(id), response, next)
})

app.get('/api/auth/me', (request, response) => {
  response.json({
    user: request.currentUser,
    actorUser: request.actorUser,
    viewingAs: request.isPreviewing,
  })
})

app.post('/api/auth/logout', requireAuthentication, (request, response, next) => {
  request.session.destroy((error) => {
    if (error) {
      next(error)
      return
    }
    response.clearCookie('goodday.sid')
    response.json({ ok: true })
  })
})

app.get('/api/slides', (_request, response) => {
  response.json(
    db.prepare(`
      SELECT id, eyebrow, title, description, image, action
      FROM slides ORDER BY position
    `).all(),
  )
})

app.get('/api/products', (_request, response) => {
  response.json(
    db.prepare(`
      SELECT id, name, description, price_cents AS priceCents, image, stock
      FROM products WHERE is_active = 1 ORDER BY created_at, name
    `).all(),
  )
})

app.get('/api/cart', (request, response) => {
  response.json({ items: getCartItems(cartOwnerKey(request)) })
})

app.post('/api/cart/items', requireNotPreviewing, (request, response) => {
  const { productId, quantity = 1 } = request.body || {}
  if (typeof productId !== 'string' || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    sendError(response, 400, '商品或數量格式不正確。')
    return
  }
  const product = db.prepare(`
    SELECT stock FROM products WHERE id = ? AND is_active = 1
  `).get(productId)
  if (!product) {
    sendError(response, 404, '商品已下架或不存在。')
    return
  }
  const ownerKey = cartOwnerKey(request)
  const existingQuantity = db.prepare(`
    SELECT quantity FROM cart_items WHERE owner_key = ? AND product_id = ?
  `).get(ownerKey, productId)?.quantity || 0
  if (existingQuantity + quantity > product.stock) {
    sendError(response, 409, `庫存不足，目前最多可購買 ${product.stock} 件。`)
    return
  }
  if (existingQuantity + quantity === 0) {
    sendError(response, 409, '商品目前沒有庫存。')
    return
  }
  db.prepare(`
    INSERT INTO cart_items (owner_key, product_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(owner_key, product_id) DO UPDATE SET
      quantity = excluded.quantity,
      updated_at = CURRENT_TIMESTAMP
  `).run(ownerKey, productId, existingQuantity + quantity)
  request.session.cartTouched = true
  response.status(201).json({ items: getCartItems(ownerKey) })
})

app.patch('/api/cart/items/:productId', requireNotPreviewing, (request, response) => {
  const quantity = request.body?.quantity
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    sendError(response, 400, '數量需為 1–99 的整數。')
    return
  }
  const ownerKey = cartOwnerKey(request)
  const product = db.prepare(`
    SELECT stock FROM products WHERE id = ? AND is_active = 1
  `).get(request.params.productId)
  const cartItem = db.prepare(`
    SELECT 1 FROM cart_items WHERE owner_key = ? AND product_id = ?
  `).get(ownerKey, request.params.productId)
  if (!product || !cartItem) {
    sendError(response, 404, '找不到購物車商品。')
    return
  }
  if (quantity > product.stock) {
    sendError(response, 409, `庫存不足，目前最多可購買 ${product.stock} 件。`)
    return
  }
  db.prepare(`
    UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP
    WHERE owner_key = ? AND product_id = ?
  `).run(quantity, ownerKey, request.params.productId)
  request.session.cartTouched = true
  response.json({ items: getCartItems(ownerKey) })
})

app.delete('/api/cart/items/:productId', requireNotPreviewing, (request, response) => {
  db.prepare('DELETE FROM cart_items WHERE owner_key = ? AND product_id = ?')
    .run(cartOwnerKey(request), request.params.productId)
  request.session.cartTouched = true
  response.json({ items: getCartItems(cartOwnerKey(request)) })
})

app.post('/api/checkout', ...requireMemberMutation, (request, response) => {
  const recipientName = typeof request.body?.recipientName === 'string'
    ? request.body.recipientName.trim()
    : ''
  const recipientPhone = typeof request.body?.recipientPhone === 'string'
    ? request.body.recipientPhone.trim()
    : ''
  const shippingAddress = typeof request.body?.shippingAddress === 'string'
    ? request.body.shippingAddress.trim()
    : ''
  if (
    !recipientName ||
    recipientName.length > 60 ||
    !/^[0-9+()#* -]{8,24}$/.test(recipientPhone) ||
    shippingAddress.length < 5 ||
    shippingAddress.length > 300
  ) {
    sendError(response, 400, '請填寫有效的收件人、聯絡電話與配送地址。')
    return
  }

  expirePendingOrders()
  const ownerKey = `user:${request.currentUser.id}`
  const items = getCartItems(ownerKey)
  if (!items.length) {
    sendError(response, 409, '購物車目前沒有商品。')
    return
  }
  const unavailable = items.find((item) => item.quantity > item.stock)
  if (unavailable) {
    sendError(response, 409, `${unavailable.name} 庫存不足，請調整購買數量。`)
    return
  }

  const orderId = `order-${randomUUID()}`
  const totalCents = items.reduce((total, item) => total + item.priceCents * item.quantity, 0)
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString()
  try {
    const createOrder = db.transaction(() => {
      const reserveStock = db.prepare(`
        UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND is_active = 1 AND stock >= ?
      `)
      for (const item of items) {
        const result = reserveStock.run(item.quantity, item.productId, item.quantity)
        if (!result.changes) throw appError(409, `${item.name} 庫存已變動，請重新確認購物車。`)
      }
      db.prepare(`
        INSERT INTO orders (
          id, user_id, status, payment_provider, total_cents,
          recipient_name, recipient_phone, shipping_address, expires_at
        ) VALUES (?, ?, 'pending', 'mock', ?, ?, ?, ?, ?)
      `).run(
        orderId,
        request.currentUser.id,
        totalCents,
        recipientName,
        recipientPhone,
        shippingAddress,
        expiresAt,
      )
      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const item of items) {
        insertItem.run(orderId, item.productId, item.name, item.priceCents, item.quantity)
      }
      db.prepare('DELETE FROM cart_items WHERE owner_key = ?').run(ownerKey)
    })
    createOrder()
  } catch (error) {
    if (error.status) {
      sendError(response, error.status, error.message)
      return
    }
    throw error
  }
  response.status(201).json({
    orderId,
    paymentProvider: 'mock',
    paymentStatus: 'pending',
    totalCents,
    expiresAt,
    message: '測試金流：請按下「模擬完成付款」完成此筆訂單。',
  })
})

app.get('/api/orders', requireAuthentication, (request, response) => {
  expirePendingOrders()
  const orders = db.prepare(`
    SELECT id, status, payment_provider AS paymentProvider,
           total_cents AS totalCents, created_at AS createdAt, paid_at AS paidAt
    FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(request.currentUser.id)
  const loadItems = db.prepare(`
    SELECT product_name AS name, unit_price_cents AS unitPriceCents, quantity
    FROM order_items WHERE order_id = ?
  `)
  response.json(orders.map((order) => ({ ...order, items: loadItems.all(order.id) })))
})

app.post('/api/orders/:id/mock-pay', ...requireMemberMutation, (request, response) => {
  expirePendingOrders()
  const order = db.prepare(`
    SELECT id, status, total_cents AS totalCents, expires_at AS expiresAt
    FROM orders WHERE id = ? AND user_id = ? AND payment_provider = 'mock'
  `).get(request.params.id, request.currentUser.id)
  if (!order) {
    sendError(response, 404, '找不到此訂單。')
    return
  }
  if (order.status !== 'pending' || new Date(order.expiresAt).getTime() <= Date.now()) {
    sendError(response, 409, '此訂單已付款、取消或付款期限已過。')
    return
  }
  db.prepare(`
    UPDATE orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND status = 'pending'
  `).run(order.id, request.currentUser.id)
  response.json({ orderId: order.id, status: 'paid', totalCents: order.totalCents })
})

app.post('/api/orders/:id/cancel', ...requireMemberMutation, (request, response) => {
  expirePendingOrders()
  const order = db.prepare(`
    SELECT id, status FROM orders WHERE id = ? AND user_id = ?
  `).get(request.params.id, request.currentUser.id)
  if (!order) {
    sendError(response, 404, '找不到此訂單。')
    return
  }
  if (order.status !== 'pending') {
    sendError(response, 409, '只有待付款訂單可以取消。')
    return
  }
  const cancelOrder = db.transaction(() => {
    const items = db.prepare(`
      SELECT product_id AS productId, quantity FROM order_items WHERE order_id = ?
    `).all(order.id)
    for (const item of items) {
      db.prepare(`
        UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(item.quantity, item.productId)
    }
    db.prepare('UPDATE orders SET status = ? WHERE id = ? AND status = ?')
      .run('cancelled', order.id, 'pending')
  })
  cancelOrder()
  response.json({ orderId: order.id, status: 'cancelled' })
})

app.get('/api/admin/overview', requireAuthentication, requireCurrentPermission('dashboard:view'), (request, response) => {
  response.json({
    summary: [
      { label: '網站瀏覽', value: '24,680', trend: '+12.8%' },
      { label: '內容互動', value: '3,842', trend: '+8.4%' },
      { label: '會員總數', value: '8,421', trend: '+5.2%' },
      { label: '本月轉換率', value: '6.84%', trend: '+1.6%' },
    ],
    recentActivity: [
      { title: '秋日居家選物・新品上架', member: '林小安', status: '已發布', time: '今天 10:42', kind: 'home' },
      { title: '好日誌：巷弄裡的午後咖啡', member: '陳子晴', status: '編輯中', time: '今天 09:18', kind: 'journal' },
      { title: '週末散步地圖・台南篇', member: '王以樂', status: '已發布', time: '昨天 16:35', kind: 'travel' },
    ],
    permissions: db.prepare(`
      SELECT id, label FROM permissions ORDER BY group_label, label
    `).all(),
    viewer: request.currentUser,
  })
})

app.get(
  '/api/admin/roles',
  requireAuthentication,
  requireCurrentPermission('roles:manage'),
  (request, response) => {
    const roles = db.prepare(`
      SELECT id, label, level FROM roles
      WHERE level < ? AND id != ?
      ORDER BY level DESC, label
    `).all(request.currentUser.level, request.currentUser.roleId)
    const grants = db.prepare('SELECT permission_id FROM role_permissions WHERE role_id = ?')
    response.json(
      roles.map((role) => ({
        ...role,
        permissions: grants.all(role.id).map((grant) => grant.permission_id),
        memberCount: db.prepare('SELECT COUNT(*) AS count FROM users WHERE role_id = ?').get(role.id).count,
      })),
    )
  },
)

app.get(
  '/api/admin/permissions',
  requireAuthentication,
  requireCurrentPermission('roles:manage'),
  (_request, response) => {
    response.json(
      db.prepare(`
        SELECT id, label, group_id AS groupId, group_label AS groupLabel, is_system AS isSystem
        FROM permissions ORDER BY group_label, label
      `).all(),
    )
  },
)

app.post(
  '/api/admin/permissions',
  ...requireAdminMutation('permissions:manage'),
  (request, response) => {
    const { id, label, groupId, groupLabel } = request.body || {}
    if (
      typeof id !== 'string' ||
      !/^[a-z][a-z0-9:_-]{1,63}$/.test(id) ||
      typeof label !== 'string' ||
      !label.trim() ||
      typeof groupId !== 'string' ||
      typeof groupLabel !== 'string' ||
      !groupLabel.trim()
    ) {
      sendError(response, 400, '請提供有效的權限代碼、名稱與分類。')
      return
    }
    const group = db.prepare(`
      SELECT group_label AS groupLabel FROM permissions WHERE group_id = ? LIMIT 1
    `).get(groupId)
    if (!group || group.groupLabel !== groupLabel.trim()) {
      sendError(response, 400, '請選擇有效的權限分類。')
      return
    }
    try {
      db.prepare(`
        INSERT INTO permissions (id, label, group_id, group_label, is_system)
        VALUES (?, ?, ?, ?, 0)
      `).run(id, label.trim(), groupId, group.groupLabel)
      response.status(201).json({ id, label: label.trim(), groupId, groupLabel: group.groupLabel, isSystem: 0 })
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        sendError(response, 409, '此權限代碼已存在。')
        return
      }
      throw error
    }
  },
)

app.patch(
  '/api/admin/permissions/:id',
  ...requireAdminMutation('permissions:manage'),
  (request, response) => {
    const label = typeof request.body?.label === 'string' ? request.body.label.trim() : ''
    if (!label || label.length > 60) {
      sendError(response, 400, '請輸入有效的權限名稱。')
      return
    }
    const result = db.prepare('UPDATE permissions SET label = ? WHERE id = ?').run(label, request.params.id)
    if (!result.changes) {
      sendError(response, 404, '找不到此權限。')
      return
    }
    response.json({ id: request.params.id, label })
  },
)

app.delete(
  '/api/admin/permissions/:id',
  ...requireAdminMutation('permissions:manage'),
  (request, response) => {
    const permission = db.prepare('SELECT is_system AS isSystem FROM permissions WHERE id = ?').get(request.params.id)
    if (!permission) {
      sendError(response, 404, '找不到此權限。')
      return
    }
    if (permission.isSystem) {
      sendError(response, 403, '系統基本權限不能刪除。')
      return
    }
    const removePermission = db.transaction(() => {
      db.prepare('DELETE FROM role_permissions WHERE permission_id = ?').run(request.params.id)
      db.prepare('DELETE FROM permissions WHERE id = ?').run(request.params.id)
    })
    removePermission()
    response.json({ ok: true })
  },
)

app.post(
  '/api/admin/roles',
  ...requireAdminMutation('roles:manage'),
  (request, response) => {
    const { label, level, permissions: grants = [] } = request.body || {}
    const cleanLabel = typeof label === 'string' ? label.trim() : ''
    const numericLevel = Number(level)
    if (!cleanLabel || cleanLabel.length > 40 || !Number.isInteger(numericLevel) || numericLevel <= 0) {
      sendError(response, 400, '請提供有效的角色名稱與權限層級。')
      return
    }
    if (numericLevel >= request.actorUser.level) {
      sendError(response, 403, '新角色的權限層級必須低於目前帳號。')
      return
    }
    if (!Array.isArray(grants) || grants.some((permission) => typeof permission !== 'string')) {
      sendError(response, 400, '角色權限清單格式不正確。')
      return
    }
    ensureCanGrant(request.actorUser, grants)
    const validPermissionCount = db.prepare(`
      SELECT COUNT(*) AS count FROM permissions WHERE id IN (${grants.map(() => '?').join(',') || "''"})
    `).get(...grants).count
    if (validPermissionCount !== new Set(grants).size) {
      sendError(response, 400, '角色權限包含不存在的項目。')
      return
    }

    const id = `role-${randomUUID()}`
    try {
      const createRole = db.transaction(() => {
        db.prepare('INSERT INTO roles (id, label, level) VALUES (?, ?, ?)').run(id, cleanLabel, numericLevel)
        const grantPermission = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)')
        for (const permission of new Set(grants)) grantPermission.run(id, permission)
      })
      createRole()
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        sendError(response, 409, '角色名稱已存在。')
        return
      }
      throw error
    }
    response.status(201).json({ id, label: cleanLabel, level: numericLevel, permissions: [...new Set(grants)] })
  },
)

app.patch(
  '/api/admin/roles/:id',
  ...requireAdminMutation('roles:manage'),
  (request, response) => {
    const role = getRoleById(request.params.id)
    ensureRoleIsManageable(request.actorUser, role)
    const label = typeof request.body?.label === 'string' ? request.body.label.trim() : ''
    const grants = request.body?.permissions
    if (!label || label.length > 40 || !Array.isArray(grants) || grants.some((item) => typeof item !== 'string')) {
      sendError(response, 400, '角色名稱或權限清單格式不正確。')
      return
    }
    ensureCanGrant(request.actorUser, grants)
    const validPermissionCount = db.prepare(`
      SELECT COUNT(*) AS count FROM permissions WHERE id IN (${grants.map(() => '?').join(',') || "''"})
    `).get(...grants).count
    if (validPermissionCount !== new Set(grants).size) {
      sendError(response, 400, '角色權限包含不存在的項目。')
      return
    }
    try {
      const updateRole = db.transaction(() => {
        db.prepare('UPDATE roles SET label = ? WHERE id = ?').run(label, role.id)
        db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(role.id)
        const grantPermission = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)')
        for (const permission of new Set(grants)) grantPermission.run(role.id, permission)
        ensureSecurityManagerRemains()
      })
      updateRole()
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        sendError(response, 409, '角色名稱已存在。')
        return
      }
      throw error
    }
    response.json({ id: role.id, label, level: role.level, permissions: [...new Set(grants)] })
  },
)

app.delete(
  '/api/admin/roles/:id',
  ...requireAdminMutation('roles:manage'),
  (request, response) => {
    const role = getRoleById(request.params.id)
    ensureRoleIsManageable(request.actorUser, role)
    const memberCount = db.prepare('SELECT COUNT(*) AS count FROM users WHERE role_id = ?').get(role.id).count
    if (memberCount) {
      sendError(response, 409, '仍有成員使用此角色，請先調整成員角色。')
      return
    }
    db.prepare('DELETE FROM roles WHERE id = ?').run(role.id)
    response.json({ ok: true })
  },
)

app.get(
  '/api/admin/members',
  requireAuthentication,
  requireCurrentPermission('users:manage'),
  (request, response) => {
    const members = db.prepare(`
      SELECT users.id, users.username, users.name, users.role_id AS roleId,
             roles.label AS roleLabel, roles.level
      FROM users JOIN roles ON roles.id = users.role_id
      WHERE users.is_active = 1 AND roles.level < ? AND users.id != ?
      ORDER BY roles.level DESC, users.name
    `).all(request.currentUser.level, request.currentUser.id)
    const assignableRoles = db.prepare(`
      SELECT id, label, level FROM roles WHERE level < ? AND id != ?
      ORDER BY level DESC, label
    `).all(request.currentUser.level, request.currentUser.roleId)
    response.json({
      members,
      assignableRoles,
      viewer: request.currentUser,
      viewingAs: request.isPreviewing,
    })
  },
)

app.patch(
  '/api/admin/members/:id/role',
  ...requireAdminMutation('users:manage'),
  (request, response) => {
    const target = userById.get(request.params.id)
    const newRole = getRoleById(request.body?.roleId)
    if (!target || !newRole) {
      sendError(response, 404, '找不到成員或指定角色。')
      return
    }
    if (target.id === request.actorUser.id || target.level >= request.actorUser.level) {
      sendError(response, 403, '只能調整層級低於自己的其他成員。')
      return
    }
    if (newRole.level >= request.actorUser.level) {
      sendError(response, 403, '只能指派層級低於自己的角色。')
      return
    }
    db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(newRole.id, target.id)
    response.json({ id: target.id, roleId: newRole.id, roleLabel: newRole.label })
  },
)

app.post(
  '/api/admin/members/:id/preview',
  requireAuthentication,
  requireActorPermission('users:manage'),
  requireNotPreviewing,
  (request, response, next) => {
    const target = userById.get(request.params.id)
    if (!target || target.level >= request.actorUser.level || target.id === request.actorUser.id) {
      sendError(response, 403, '只能切換到層級低於自己的成員視角。')
      return
    }
    request.session.viewAsUserId = target.id
    request.session.save((error) => {
      if (error) {
        next(error)
        return
      }
      response.json({ user: getPublicUser(target), actorUser: request.actorUser, viewingAs: true })
    })
  },
)

app.post(
  '/api/auth/preview/exit',
  requireAuthentication,
  (request, response, next) => {
    request.session.viewAsUserId = null
    request.session.save((error) => {
      if (error) {
        next(error)
        return
      }
      response.json({ user: request.actorUser, actorUser: request.actorUser, viewingAs: false })
    })
  },
)

app.get('/api/admin/slides', requireAuthentication, requireCurrentPermission('content:edit'), (_request, response) => {
  response.json(
    db.prepare(`
      SELECT id, eyebrow, title, description, image, action
      FROM slides ORDER BY position
    `).all(),
  )
})

app.put(
  '/api/admin/slides',
  ...requireAdminMutation('content:edit'),
  (request, response) => {
    const slides = request.body?.slides
    if (
      !Array.isArray(slides) ||
      !slides.length ||
      slides.length > 20 ||
      slides.some(
        (slide) =>
          !slide ||
          typeof slide.id !== 'string' ||
          typeof slide.eyebrow !== 'string' ||
          typeof slide.title !== 'string' ||
          !slide.title.trim() ||
          typeof slide.description !== 'string' ||
          typeof slide.image !== 'string' ||
          !slide.image.trim() ||
          typeof slide.action !== 'string' ||
          slide.title.length > 100 ||
          slide.description.length > 300 ||
          slide.eyebrow.length > 80 ||
          slide.action.length > 80 ||
          slide.image.length > 2048
      )
    ) {
      sendError(response, 400, '輪播至少需要一筆有效內容，且最多 20 張。')
      return
    }
    if (new Set(slides.map((slide) => slide.id)).size !== slides.length) {
      sendError(response, 400, '輪播項目 ID 不可重複。')
      return
    }
    const isAllowedImage = (image) =>
      image.startsWith('/uploads/') ||
      (() => {
        try {
          return new URL(image).protocol === 'https:'
        } catch {
          return false
        }
      })()
    if (slides.some((slide) => !isAllowedImage(slide.image))) {
      sendError(response, 400, '圖片請使用 HTTPS 網址或已上傳的圖片。')
      return
    }

    const saveSlides = db.transaction(() => {
      db.prepare('DELETE FROM slides').run()
      const insertSlide = db.prepare(`
        INSERT INTO slides (id, position, eyebrow, title, description, image, action)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      slides.forEach((slide, position) =>
        insertSlide.run(
          slide.id,
          position,
          slide.eyebrow,
          slide.title.trim(),
          slide.description.trim(),
          slide.image,
          slide.action.trim(),
        ),
      )
    })
    saveSlides()
    response.json({ ok: true })
  },
)

app.post(
  '/api/admin/uploads',
  requireAuthentication,
  requireNotPreviewing,
  (request, _response, next) => {
    if (
      !request.actorUser.permissions.includes('content:edit') &&
      !request.actorUser.permissions.includes('products:manage')
    ) {
      next(appError(403, '需要首頁內容或商品管理權限才能上傳圖片。'))
      return
    }
    next()
  },
  imageUpload.single('image'),
  (request, response) => {
    if (!request.file) {
      sendError(response, 400, '請選擇圖片檔案。')
      return
    }
    response.status(201).json({ url: `/uploads/${request.file.filename}` })
  },
)

const normalizeProductInput = (body) => {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  const image = typeof body?.image === 'string' ? body.image.trim() : ''
  const priceCents = body?.priceCents
  const stock = body?.stock
  const isActive = body?.isActive === undefined ? true : body.isActive
  const safeImage =
    image.startsWith('/uploads/') ||
    (() => {
      try {
        return new URL(image).protocol === 'https:'
      } catch {
        return false
      }
    })()
  if (
    !name ||
    name.length > 100 ||
    description.length > 2000 ||
    !Number.isSafeInteger(priceCents) ||
    priceCents < 0 ||
    priceCents > 100_000_000 ||
    !Number.isSafeInteger(stock) ||
    stock < 0 ||
    stock > 1_000_000 ||
    typeof isActive !== 'boolean' ||
    !safeImage
  ) {
    throw appError(400, '商品名稱、價格、庫存或 HTTPS 圖片網址格式不正確。')
  }
  return { name, description, image, priceCents, stock, isActive }
}

app.get('/api/admin/products', requireAuthentication, requireCurrentPermission('products:manage'), (_request, response) => {
  response.json(db.prepare(`SELECT ${productFields} FROM products ORDER BY created_at DESC`).all())
})

app.post(
  '/api/admin/products',
  ...requireAdminMutation('products:manage'),
  (request, response) => {
    const product = normalizeProductInput(request.body)
    const id = `product-${randomUUID()}`
    db.prepare(`
      INSERT INTO products (id, name, description, price_cents, image, stock, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      product.name,
      product.description,
      product.priceCents,
      product.image,
      product.stock,
      Number(product.isActive),
    )
    response.status(201).json(db.prepare(`SELECT ${productFields} FROM products WHERE id = ?`).get(id))
  },
)

app.patch(
  '/api/admin/products/:id',
  ...requireAdminMutation('products:manage'),
  (request, response) => {
    const product = normalizeProductInput(request.body)
    const updateProduct = db.transaction(() => {
      const result = db.prepare(`
        UPDATE products
        SET name = ?, description = ?, price_cents = ?, image = ?, stock = ?, is_active = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        product.name,
        product.description,
        product.priceCents,
        product.image,
        product.stock,
        Number(product.isActive),
        request.params.id,
      )
      if (result.changes && !product.isActive) {
        db.prepare('DELETE FROM cart_items WHERE product_id = ?').run(request.params.id)
      }
      return result.changes
    })
    if (!updateProduct()) {
      sendError(response, 404, '找不到此商品。')
      return
    }
    response.json(
      db.prepare(`SELECT ${productFields} FROM products WHERE id = ?`).get(request.params.id),
    )
  },
)

app.delete(
  '/api/admin/products/:id',
  ...requireAdminMutation('products:manage'),
  (request, response) => {
    const disableProduct = db.transaction(() => {
      const result = db.prepare(`
        UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(request.params.id)
      if (!result.changes) return false
      db.prepare('DELETE FROM cart_items WHERE product_id = ?').run(request.params.id)
      return true
    })
    if (!disableProduct()) {
      sendError(response, 404, '找不到此商品。')
      return
    }
    response.json({ ok: true })
  },
)

app.get('/api/admin/sales', requireAuthentication, requireCurrentPermission('sales:view'), (_request, response) => {
  expirePendingOrders()
  const summary = db.prepare(`
    SELECT COUNT(*) AS orderCount,
           COALESCE(SUM(total_cents), 0) AS revenueCents
    FROM orders WHERE status = 'paid'
  `).get()
  const unitsSold = db.prepare(`
    SELECT COALESCE(SUM(order_items.quantity), 0) AS unitsSold
    FROM order_items JOIN orders ON orders.id = order_items.order_id
    WHERE orders.status = 'paid'
  `).get().unitsSold
  const bestSellers = db.prepare(`
    SELECT order_items.product_id AS productId, order_items.product_name AS name,
           SUM(order_items.quantity) AS unitsSold,
           SUM(order_items.unit_price_cents * order_items.quantity) AS revenueCents
    FROM order_items JOIN orders ON orders.id = order_items.order_id
    WHERE orders.status = 'paid'
    GROUP BY order_items.product_id, order_items.product_name
    ORDER BY unitsSold DESC, revenueCents DESC
    LIMIT 10
  `).all()
  const recentOrders = db.prepare(`
    SELECT orders.id, orders.status, orders.total_cents AS totalCents,
           orders.created_at AS createdAt, users.name AS customerName,
           COUNT(order_items.id) AS lineCount,
           COALESCE(SUM(order_items.quantity), 0) AS units
    FROM orders
    JOIN users ON users.id = orders.user_id
    LEFT JOIN order_items ON order_items.order_id = orders.id
    GROUP BY orders.id
    ORDER BY orders.created_at DESC
    LIMIT 50
  `).all()
  response.json({ ...summary, unitsSold, bestSellers, recentOrders })
})

app.use('/api', (_request, response) => sendError(response, 404, '找不到此 API。'))

app.use((error, _request, response, _next) => {
  if (response.headersSent) return
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? '圖片大小需小於 5 MB。' : '圖片上傳失敗。'
    sendError(response, 400, message)
    return
  }
  if (error.status) {
    sendError(response, error.status, error.message)
    return
  }
  console.error(error)
  sendError(response, 500, '伺服器發生錯誤，請稍後再試。')
})

const server = app.listen(port, () => {
  console.log(`Goodday API listening on http://127.0.0.1:${port}`)
  console.log(`SQLite database: ${path.relative(serverDirectory, path.join(dataDirectory, 'goodday.sqlite'))}`)
  if (process.env.NODE_ENV !== 'production' && process.env.SEED_PASSWORD === undefined) {
    console.log('Development demo accounts use username/password values described in README.md')
  }
})

const shutdown = () => {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
