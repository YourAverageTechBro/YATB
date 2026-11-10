import type { PostMedia } from '#/domain/posts'

export type PostUploadProgress = Readonly<{
  sentBytes: number
  totalBytes: number
}>

type Snapshot = {
  id: string
  partSize: number
  partCount: number
  uploadedParts: number[]
  state: string
  result?: PostMedia
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new HttpError(response.status, body.error ?? `Upload failed with ${response.status}.`)
  return body
}

export async function uploadPostMedia(
  draftId: string,
  postId: string,
  file: File,
  options: {
    clientRequestId: string
    durationMs: number | null
    signal?: AbortSignal
    onProgress: (progress: PostUploadProgress) => void
  },
): Promise<PostMedia> {
  const base = `/api/posts/${encodeURIComponent(draftId)}/uploads`
  let upload = await readJson<Snapshot>(await fetch(base, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postId,
      clientRequestId: options.clientRequestId,
      displayName: file.name,
      byteSize: file.size,
      contentType: file.type || 'application/octet-stream',
      durationMs: options.durationMs,
    }),
    signal: options.signal,
  }))
  while (upload.state === 'initializing') {
    await new Promise((resolve) => window.setTimeout(resolve, 400))
    upload = await readJson<Snapshot>(await fetch(`${base}/${upload.id}`, { credentials: 'same-origin', signal: options.signal }))
  }
  if (upload.state === 'ready' && upload.result) return upload.result
  if (upload.state !== 'uploading') throw new Error('Upload is not available.')
  const persisted = new Set(upload.uploadedParts)
  for (let part = 1; part <= upload.partCount; part += 1) {
    if (persisted.has(part)) continue
    const start = (part - 1) * upload.partSize
    const blob = file.slice(start, Math.min(file.size, start + upload.partSize))
    const response = await fetch(`${base}/${upload.id}/parts/${part}`, {
      method: 'PUT',
      credentials: 'same-origin',
      body: blob,
      signal: options.signal,
    })
    if (!response.ok) {
      const body = await response.json() as { error?: string }
      throw new HttpError(response.status, body.error ?? 'Part upload failed.')
    }
    options.onProgress({ sentBytes: Math.min(file.size, part * upload.partSize), totalBytes: file.size })
  }
  const complete = await readJson<Snapshot>(await fetch(`${base}/${upload.id}/complete`, {
    method: 'POST',
    credentials: 'same-origin',
    signal: options.signal,
  }))
  if (!complete.result) throw new Error('Upload completion did not publish a file.')
  return complete.result
}

export async function videoDurationMs(file: File): Promise<number | null> {
  if (!file.type.startsWith('video/')) return null
  return await new Promise((resolve) => {
    const element = document.createElement('video')
    element.preload = 'metadata'
    element.onloadedmetadata = () => {
      const duration = Number.isFinite(element.duration) ? Math.round(element.duration * 1000) : null
      URL.revokeObjectURL(element.src)
      resolve(duration && duration > 0 ? duration : null)
    }
    element.onerror = () => {
      URL.revokeObjectURL(element.src)
      resolve(null)
    }
    element.src = URL.createObjectURL(file)
  })
}
