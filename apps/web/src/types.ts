export interface User {
  id: string
  username: string
  role: 'ADMIN' | 'MEMBER'
  status: 'ACTIVE' | 'DISABLED'
  mustChangePassword: boolean
  createdAt?: string
}

export interface Asset {
  id: string
  ownerId: string
  ownerName: string
  type: 'IMAGE' | 'VIDEO' | 'LIVE_PHOTO'
  visibility: 'SHARED' | 'PRIVATE'
  status: 'PROCESSING' | 'READY' | 'FAILED'
  originalName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  durationMs: number | null
  uploadedAt: string
  processingError: string | null
  originalUrl: string
  liveOriginalUrl: string | null
  liveVideoUrl: string | null
  thumbnailUrl: string | null
  previewUrl: string | null
  backupStatus: 'NOT_CONFIGURED'
}

export interface Folder {
  id: string
  name: string
  itemCount: number
  createdAt: string
}

export interface UploadItem {
  id: string
  file: File
  progress: number
  status: 'WAITING' | 'UPLOADING' | 'DONE' | 'FAILED'
  error: string | null
}

export interface StorageSummary {
  disk: {
    totalBytes: number
    freeBytes: number
    usedBytes: number
  }
  assets: {
    count: number
    originalBytes: number
  }
}
