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
  privacyMasked: boolean
  favorite: boolean
  tags: string[]
  status: 'PROCESSING' | 'READY' | 'FAILED'
  originalName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  durationMs: number | null
  shootingTime: string | null
  uploadedAt: string
  deletedAt: string | null
  processingError: string | null
  originalUrl: string
  liveOriginalUrl: string | null
  liveVideoUrl: string | null
  thumbnailUrl: string | null
  previewUrl: string | null
  edited: boolean
  editedAt: string | null
  backupStatus: 'NOT_CONFIGURED'
}

export interface ImageEditOperations {
  crop: {
    x: number
    y: number
    width: number
    height: number
  }
  rotate: 0 | 90 | 180 | 270
  flipX: boolean
  flipY: boolean
}

export interface TimelineMonth {
  month: string
  count: number
}

export type MediaTypeFilter = 'ALL' | 'IMAGE' | 'VIDEO' | 'LIVE_PHOTO'

export type SmartFilter =
  | 'ALL'
  | 'RECENT_IMPORTS'
  | 'UNTAGGED'
  | 'PRIVACY_MASKED'
  | 'TODAY_IN_HISTORY'
  | 'THIS_MONTH_HISTORY'

export type GridDensity = 'COMFORTABLE' | 'STANDARD' | 'COMPACT'

export type GalleryFilter = 'ALL' | 'FAVORITES' | 'DELETED'

export interface FeaturedCollection {
  id: 'TODAY_IN_HISTORY' | 'THIS_MONTH_HISTORY'
  title: string
  subtitle: string
  count: number
  filter: GalleryFilter
  mediaType: MediaTypeFilter
  smartFilter: SmartFilter
  covers: Asset[]
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

export interface ImportDuplicateAsset {
  id: string
  originalName: string
  type: 'IMAGE' | 'VIDEO' | 'LIVE_PHOTO'
}

export interface ImportCandidateFile {
  role: 'PHOTO' | 'VIDEO' | 'MEDIA'
  path: string
  relativePath: string
  name: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

export interface ImportCandidate {
  id: string
  type: 'IMAGE' | 'VIDEO' | 'LIVE_PHOTO'
  originalName: string
  mimeType: string
  sizeBytes: number
  sha256: string
  duplicate: boolean
  duplicateAssets: ImportDuplicateAsset[]
  files: ImportCandidateFile[]
  warnings: string[]
}

export interface ImportSkippedFile {
  path: string
  relativePath: string
  reason: string
}

export interface ImportScanResult {
  rootPath: string
  candidates: ImportCandidate[]
  skipped: ImportSkippedFile[]
  summary: {
    scannedFiles: number
    candidates: number
    newCandidates: number
    duplicates: number
    livePhotoCandidates: number
    skipped: number
    truncated: boolean
  }
}

export interface ImportRunResult {
  imported: Array<{
    candidateId: string
    assetId: string
    type: 'IMAGE' | 'VIDEO' | 'LIVE_PHOTO'
    originalName: string
  }>
  skipped: Array<{
    candidateId: string
    originalName: string
    reason: string
  }>
  summary: {
    requested: number
    imported: number
    skipped: number
  }
}
