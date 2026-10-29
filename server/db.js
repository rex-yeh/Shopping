import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
export const dataDirectory = path.resolve(process.env.DATA_DIRECTORY || path.join(serverDirectory, '../data'))
mkdirSync(dataDirectory, { recursive: true })

export const db = new Database(path.join(dataDirectory, 'goodday.sqlite'))
db.pragma('foreign_keys = ON')
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL UNIQUE,
    level INTEGER NOT NULL CHECK (level > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    group_id TEXT NOT NULL,
    group_label TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS slides (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL UNIQUE,
    eyebrow TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    image TEXT NOT NULL,
    action TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    image TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS cart_items (
    owner_key TEXT NOT NULL,
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (owner_key, product_id)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled')),
    payment_provider TEXT NOT NULL,
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    recipient_name TEXT NOT NULL,
    recipient_phone TEXT NOT NULL,
    shipping_address TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0)
  );
`)

const ecommercePermissions = [
  ['products:manage', '商品管理', 'store', '商店管理'],
  ['sales:view', '銷售報表', 'store', '商店管理'],
]
const insertEcommercePermission = db.prepare(`
  INSERT OR IGNORE INTO permissions (id, label, group_id, group_label, is_system)
  VALUES (?, ?, ?, ?, 1)
`)
for (const permission of ecommercePermissions) insertEcommercePermission.run(...permission)
const grantEcommercePermission = db.prepare(`
  INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT ?, ? WHERE EXISTS (SELECT 1 FROM roles WHERE id = ?)
`)
for (const roleId of ['superadmin', 'admin', 'manager']) {
  for (const [permissionId] of ecommercePermissions) {
    grantEcommercePermission.run(roleId, permissionId, roleId)
  }
}

export const seedPassword =
  process.env.SEED_PASSWORD ||
  (process.env.NODE_ENV === 'production' ? null : 'GooddayDemo2026!')

if (db.prepare('SELECT COUNT(*) AS count FROM roles').get().count === 0) {
  const permissions = [
    ['dashboard:view', '營運總覽', 'workspace', '工作空間'],
    ['admin:access', '管理後台登入', 'workspace', '工作空間'],
    ['reports:view', '報表分析', 'workspace', '工作空間'],
    ['content:edit', '首頁內容編輯', 'content', '網站內容'],
    ['users:manage', '成員管理', 'team', '團隊管理'],
    ['roles:manage', '角色權限管理', 'team', '團隊管理'],
    ['permissions:manage', '權限目錄管理', 'team', '團隊管理'],
  ]
  const roles = [
    ['superadmin', '超級管理員', 100],
    ['admin', '管理員', 80],
    ['manager', '經理', 60],
    ['editor', '編輯', 40],
    ['guest', '訪客', 10],
  ]
  const roleGrants = {
    superadmin: permissions.map(([id]) => id),
    admin: ['dashboard:view', 'admin:access', 'reports:view', 'content:edit', 'users:manage', 'roles:manage'],
    manager: ['dashboard:view', 'admin:access', 'reports:view', 'content:edit', 'users:manage', 'roles:manage'],
    editor: ['dashboard:view', 'admin:access', 'content:edit'],
    guest: [],
  }
  const seedRoles = db.transaction(() => {
    const insertPermission = db.prepare(
      'INSERT INTO permissions (id, label, group_id, group_label, is_system) VALUES (?, ?, ?, ?, 1)',
    )
    for (const permission of permissions) insertPermission.run(...permission)

    const insertRole = db.prepare('INSERT INTO roles (id, label, level) VALUES (?, ?, ?)')
    for (const role of roles) insertRole.run(...role)

    const grantPermission = db.prepare(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
    )
    for (const [roleId, permissionIds] of Object.entries(roleGrants)) {
      for (const permissionId of permissionIds) grantPermission.run(roleId, permissionId)
    }

    const slides = [
      {
        id: 'slow-living',
        eyebrow: '把日常，過成喜歡的樣子',
        title: '留一點時間，\n給生活慢慢發光。',
        description: '從一杯咖啡、一束花開始，收藏那些讓日子變好的小事。',
        image:
          'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=2000&q=85',
        action: '探索本季選品',
      },
      {
        id: 'everyday-objects',
        eyebrow: '為生活挑一件好物',
        title: '日日好物，\n陪你走過每個季節。',
        description: '挑選質感、耐用又有溫度的日常物件，讓家的每個角落都有故事。',
        image:
          'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=2000&q=85',
        action: '看看生活提案',
      },
      {
        id: 'weekend-escape',
        eyebrow: '週末，去喜歡的地方',
        title: '帶著好心情，\n去遇見新的風景。',
        description: '收集城市裡的靈感角落，為平凡日常安排一場剛剛好的小旅行。',
        image:
          'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=2000&q=85',
        action: '閱讀週末誌',
      },
    ]
    const insertSlide = db.prepare(
      'INSERT INTO slides (id, position, eyebrow, title, description, image, action) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    slides.forEach((slide, position) =>
      insertSlide.run(
        slide.id,
        position,
        slide.eyebrow,
        slide.title,
        slide.description,
        slide.image,
        slide.action,
      ),
    )
  })
  seedRoles()
}

for (const roleId of ['superadmin', 'admin', 'manager']) {
  for (const [permissionId] of ecommercePermissions) {
    grantEcommercePermission.run(roleId, permissionId, roleId)
  }
}

if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0) {
  if (!seedPassword) {
    throw new Error('Production requires SEED_PASSWORD to initialize the demo accounts.')
  }
  const seedUsers = [
    ['demo-superadmin', 'superadmin', 'Ada Lin', 'superadmin'],
    ['demo-admin', 'admin', 'Kevin Wu', 'admin'],
    ['demo-manager', 'manager', 'Mia Chen', 'manager'],
    ['demo-editor', 'editor', 'Jordan Lee', 'editor'],
    ['demo-guest', 'guest', 'Taylor Chen', 'guest'],
  ]
  const insertUser = db.prepare(
    'INSERT INTO users (id, username, name, password_hash, role_id) VALUES (?, ?, ?, ?, ?)',
  )
  const hash = bcrypt.hashSync(seedPassword, 12)
  const seedUsersTransaction = db.transaction(() => {
    for (const user of seedUsers) {
      insertUser.run(user[0], user[1], user[2], hash, user[3])
    }
  })
  seedUsersTransaction()
}

if (db.prepare('SELECT COUNT(*) AS count FROM products').get().count === 0) {
  const demoProducts = [
    [
      'product-linen-tote',
      '亞麻日常托特包',
      '以厚實亞麻布製作，收納日常隨身物品，簡約耐用。',
      68000,
      'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=1000&q=85',
      24,
    ],
    [
      'product-ceramic-mug',
      '手作陶器咖啡杯',
      '溫潤手感的手作陶杯，每一只都有獨一無二的釉色。',
      48000,
      'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=1000&q=85',
      18,
    ],
    [
      'product-scent-candle',
      '森林晨光香氛蠟燭',
      '木質與柑橘調香氣，為居家時光帶來安定片刻。',
      92000,
      'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=1000&q=85',
      12,
    ],
    [
      'product-cotton-throw',
      '純棉編織蓋毯',
      '親膚純棉編織，適合午後閱讀或涼爽夜晚。',
      128000,
      'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1000&q=85',
      9,
    ],
  ]
  const insertProduct = db.prepare(`
    INSERT INTO products (id, name, description, price_cents, image, stock)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const seedProducts = db.transaction(() => {
    for (const product of demoProducts) insertProduct.run(...product)
  })
  seedProducts()
}

export const userById = db.prepare(`
  SELECT users.id, users.username, users.name, users.role_id AS roleId, roles.label AS roleLabel,
         roles.level, users.is_active AS isActive
  FROM users JOIN roles ON roles.id = users.role_id
  WHERE users.id = ? AND users.is_active = 1
`)

export const permissionsByRole = db.prepare(`
  SELECT permissions.id, permissions.label, permissions.group_id AS groupId,
         permissions.group_label AS groupLabel
  FROM permissions
  JOIN role_permissions ON role_permissions.permission_id = permissions.id
  WHERE role_permissions.role_id = ?
  ORDER BY permissions.group_label, permissions.label
`)

export const getPublicUser = (user) => {
  if (!user) return null
  const permissions = permissionsByRole.all(user.roleId)
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    roleId: user.roleId,
    role: user.roleLabel,
    level: user.level,
    permissions: permissions.map((permission) => permission.id),
    permissionLabels: Object.fromEntries(
      permissions.map((permission) => [permission.id, permission.label]),
    ),
  }
}
