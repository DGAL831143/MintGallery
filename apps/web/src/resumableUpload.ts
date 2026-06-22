import { Upload } from 'tus-js-client'
import { ApiError, api } from './api'
import type { Asset } from './types'

const CHUNK_SIZE = 1024 * 1024
const RETRY_DELAYS = [0, 1000, 3000, 5000, 10000, 20000, 30000]

function uploadIdFromUrl(uploadUrl: string): string {
  const pathname = new URL(uploadUrl, window.location.href).pathname
  const uploadId = pathname.split('/').filter(Boolean).at(-1)
  if (!uploadId) throw new Error('服务器没有返回有效的上传编号')
  return uploadId
}

export function uploadResumableAsset(
  file: File,
  visibility: 'SHARED' | 'PRIVATE',
  ownerId: string,
  onProgress: (percent: number) => void,
): Promise<Asset> {
  return new Promise((resolve, reject) => {
    let settled = false
    const upload = new Upload(file, {
      endpoint: '/api/uploads/resumable',
      chunkSize: CHUNK_SIZE,
      retryDelays: RETRY_DELAYS,
      removeFingerprintOnSuccess: true,
      fingerprint: async (selectedFile) => JSON.stringify([
        'mintgallery',
        ownerId,
        visibility,
        selectedFile.name,
        selectedFile.type,
        selectedFile.size,
        selectedFile.lastModified,
      ]),
      metadata: {
        filename: file.name,
        filetype: file.type,
        visibility,
      },
      onProgress(bytesUploaded, bytesTotal) {
        if (bytesTotal > 0) onProgress(Math.round((bytesUploaded / bytesTotal) * 100))
      },
      onError(error) {
        if (settled) return
        settled = true
        reject(new ApiError(`上传连接多次重试后仍然失败：${error.message}`, 0))
      },
      onSuccess() {
        void (async () => {
          try {
            if (!upload.url) throw new Error('服务器没有返回上传地址')
            const uploadId = uploadIdFromUrl(upload.url)
            const response = await api<{ asset: Asset }>(
              `/api/uploads/resumable/${encodeURIComponent(uploadId)}/result`,
            )
            if (settled) return
            settled = true
            resolve(response.asset)
          } catch (error) {
            if (settled) return
            settled = true
            reject(error)
          }
        })()
      },
    })

    void upload.findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads.length > 0) upload.resumeFromPreviousUpload(previousUploads[0])
        upload.start()
      })
      .catch(() => upload.start())
  })
}
