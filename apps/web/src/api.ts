import type { Asset, StorageSummary, User } from './types'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  const body = await response.json().catch(() => ({ message: '请求失败，请稍后重试' }))
  throw new ApiError(body.message ?? '请求失败，请稍后重试', response.status)
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers,
  })
  return parseResponse<T>(response)
}

export const authApi = {
  bootstrapStatus: () => api<{ needsSetup: boolean }>('/api/bootstrap/status'),
  bootstrap: (username: string, password: string) =>
    api<{ user: User }>('/api/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    api<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => api<{ user: User }>('/api/auth/me'),
  logout: () => api<void>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
}

export const galleryApi = {
  list: (scope: 'SHARED' | 'PRIVATE', cursor?: string | null) => {
    const search = new URLSearchParams({ scope, limit: '30' })
    if (cursor) search.set('cursor', cursor)
    return api<{ assets: Asset[]; nextCursor: string | null }>(`/api/assets?${search}`)
  },
}

export const adminApi = {
  users: () => api<{ users: User[] }>('/api/users'),
  stats: () => api<StorageSummary>('/api/admin/stats'),
  createUser: (username: string, temporaryPassword: string) =>
    api<{ id: string; username: string }>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username, temporaryPassword }),
    }),
  setUserStatus: (id: string, status: 'ACTIVE' | 'DISABLED') =>
    api<{ ok: boolean }>(`/api/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
}

export function uploadAsset(
  file: File,
  visibility: 'SHARED' | 'PRIVATE',
  onProgress: (percent: number) => void,
): Promise<Asset> {
  const form = new FormData()
  form.append('file', file, file.name)
  return uploadForm(`/api/assets?visibility=${visibility}`, form, onProgress)
}

export function uploadLivePhoto(
  photo: File,
  video: File,
  visibility: 'SHARED' | 'PRIVATE',
  onProgress: (percent: number) => void,
): Promise<Asset> {
  const form = new FormData()
  form.append('photo', photo, photo.name)
  form.append('video', video, video.name)
  return uploadForm(`/api/assets/live-photo?visibility=${visibility}`, form, onProgress)
}

function uploadForm(
  url: string,
  form: FormData,
  onProgress: (percent: number) => void,
): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()

    request.open('POST', url)
    request.withCredentials = true
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    })
    request.addEventListener('load', () => {
      let body: { asset?: Asset; message?: string } = {}
      try {
        body = JSON.parse(request.responseText || '{}') as typeof body
      } catch {
        body = { message: '服务器返回了无法识别的结果' }
      }
      if (request.status >= 200 && request.status < 300 && body.asset) {
        resolve(body.asset)
      } else {
        reject(new ApiError(body.message ?? '上传失败', request.status))
      }
    })
    request.addEventListener('error', () => reject(new ApiError('网络连接中断', 0)))
    request.send(form)
  })
}
