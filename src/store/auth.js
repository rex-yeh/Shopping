import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { apiRequest, initializeCsrf, setCsrfToken } from '../lib/api'
import { isShowcaseMode } from '../lib/showcase'

const groupPermissions = (permissions) => {
  const groups = new Map()
  for (const permission of permissions) {
    if (!groups.has(permission.groupId)) {
      groups.set(permission.groupId, {
        id: permission.groupId,
        label: permission.groupLabel,
        children: [],
      })
    }
    groups.get(permission.groupId).children.push(permission)
  }
  return [...groups.values()]
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const actorUser = ref(null)
  const viewingAs = ref(false)
  const roles = ref([])
  const permissionItems = ref([])
  const accounts = ref([])
  const assignableRoles = ref([])
  const initialized = ref(false)
  let initializePromise

  const effectiveRole = computed(() => user.value?.roleId || null)
  const isLoggedIn = computed(() => Boolean(user.value))
  const permissionTree = computed(() => groupPermissions(permissionItems.value))
  const roleMap = computed(() => {
    const roleEntries = roles.value.map((role) => [role.id, { label: role.label }])
    for (const role of assignableRoles.value) {
      if (!roleEntries.some(([id]) => id === role.id)) roleEntries.push([role.id, { label: role.label }])
    }
    if (user.value?.roleId && !roleEntries.some(([id]) => id === user.value.roleId)) {
      roleEntries.push([user.value.roleId, { label: user.value.role }])
    }
    return Object.fromEntries(roleEntries)
  })

  const applySession = (session) => {
    user.value = session.user
    actorUser.value = session.actorUser
    viewingAs.value = Boolean(session.viewingAs)
  }

  const initialize = () => {
    if (isShowcaseMode) {
      initialized.value = true
      return Promise.resolve()
    }

    if (!initializePromise) {
      initializePromise = (async () => {
        try {
          await initializeCsrf()
          const session = await apiRequest('/api/auth/me')
          applySession(session)
        } finally {
          initialized.value = true
        }
      })().catch((error) => {
        initializePromise = null
        throw error
      })
    }
    return initializePromise
  }

  const login = async (username, password) => {
    const session = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    applySession(session)
    initialized.value = true
  }

  const register = async ({ username, name, password }) => {
    const session = await apiRequest('/api/member/register', {
      method: 'POST',
      body: JSON.stringify({ username, name, password }),
    })
    applySession(session)
    initialized.value = true
  }

  const logout = async () => {
    if (isLoggedIn.value) await apiRequest('/api/auth/logout', { method: 'POST' })
    user.value = null
    actorUser.value = null
    viewingAs.value = false
    roles.value = []
    permissionItems.value = []
    accounts.value = []
    assignableRoles.value = []
    setCsrfToken('')
  }

  const hasPermission = (permission) => Boolean(user.value?.permissions.includes(permission))

  const getRole = (roleId) => roles.value.find((role) => role.id === roleId)

  const loadRoles = async () => {
    const [roleData, permissions] = await Promise.all([
      apiRequest('/api/admin/roles'),
      apiRequest('/api/admin/permissions'),
    ])
    roles.value = roleData
    permissionItems.value = permissions
    return roleData
  }

  const loadMembers = async () => {
    const data = await apiRequest('/api/admin/members')
    accounts.value = data.members
    assignableRoles.value = data.assignableRoles
    return data
  }

  const updateRole = async (roleId, updates) => {
    const updated = await apiRequest(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
    roles.value = roles.value.map((role) => (role.id === roleId ? { ...role, ...updated } : role))
    return updated
  }

  const createRole = async (role) => {
    const created = await apiRequest('/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify(role),
    })
    roles.value = [...roles.value, created].sort((a, b) => b.level - a.level)
    return created
  }

  const deleteRole = async (roleId) => {
    await apiRequest(`/api/admin/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' })
    roles.value = roles.value.filter((role) => role.id !== roleId)
  }

  const updateAccountRole = async (accountId, roleId) => {
    const updated = await apiRequest(`/api/admin/members/${encodeURIComponent(accountId)}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ roleId }),
    })
    accounts.value = accounts.value.map((account) =>
      account.id === accountId ? { ...account, ...updated } : account,
    )
  }

  const previewMember = async (accountId) => {
    const session = await apiRequest(
      `/api/admin/members/${encodeURIComponent(accountId)}/preview`,
      { method: 'POST' },
    )
    applySession(session)
  }

  const exitPreview = async () => {
    const session = await apiRequest('/api/auth/preview/exit', { method: 'POST' })
    applySession(session)
  }

  const addPermission = async ({ groupId, id, label }) => {
    const group = permissionTree.value.find((item) => item.id === groupId)
    if (!group) throw new Error('找不到權限所屬分類。')
    const permission = await apiRequest('/api/admin/permissions', {
      method: 'POST',
      body: JSON.stringify({ id: id.trim(), label: label.trim(), groupId, groupLabel: group.label }),
    })
    permissionItems.value = [...permissionItems.value, permission]
    return permission
  }

  const updatePermission = async (permissionId, label) => {
    const updated = await apiRequest(`/api/admin/permissions/${encodeURIComponent(permissionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ label: label.trim() }),
    })
    permissionItems.value = permissionItems.value.map((permission) =>
      permission.id === permissionId ? { ...permission, ...updated } : permission,
    )
  }

  const deletePermission = async (permissionId) => {
    await apiRequest(`/api/admin/permissions/${encodeURIComponent(permissionId)}`, {
      method: 'DELETE',
    })
    permissionItems.value = permissionItems.value.filter((permission) => permission.id !== permissionId)
    roles.value = roles.value.map((role) => ({
      ...role,
      permissions: role.permissions.filter((permission) => permission !== permissionId),
    }))
  }

  return {
    user,
    actorUser,
    viewingAs,
    roles,
    accounts,
    assignableRoles,
    permissionItems,
    permissionTree,
    roleMap,
    effectiveRole,
    isLoggedIn,
    initialized,
    initialize,
    login,
    register,
    logout,
    hasPermission,
    getRole,
    loadRoles,
    loadMembers,
    updateRole,
    createRole,
    deleteRole,
    updateAccountRole,
    previewMember,
    exitPreview,
    addPermission,
    updatePermission,
    deletePermission,
  }
})
