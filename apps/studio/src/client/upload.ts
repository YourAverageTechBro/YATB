import type { ReadyUpload, UploadPurpose, UploadSnapshot } from '#/domain/media'

export type UploadProgress = Readonly<{
  sentBytes: number
  totalBytes: number
  completedParts: number
  totalParts: number
}>

type UploadOptions = Readonly<{
  clientRequestId: string
  purpose: UploadPurpose
  signal?: AbortSignal
  onProgress: (progress: UploadProgress) => void
}>

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new HttpError(response.status, body.error ?? `Upload failed with ${response.status}.`)
  return body
}

export function isRetryableStatus(status: number | null): boolean {
  return status === null || status === 408 || status === 429 || status >= 500
}

function retryable(error: unknown): boolean {
  return isRetryableStatus(error instanceof HttpError ? error.status : null)
}

async function retry<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let failure: unknown
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Upload cancelled.', 'AbortError')
    try {
      return await action()
    } catch (error) {
      failure = error
      if ((error instanceof DOMException && error.name === 'AbortError') || !retryable(error)) throw error
      if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 300 * 2 ** attempt + Math.random() * 200))
    }
  }
  throw failure
}

function sendPart(
  url: string,
  blob: Blob,
  signal: AbortSignal | undefined,
  onProgress: (loaded: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    request.withCredentials = true
    request.upload.onprogress = (event) => onProgress(event.loaded)
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve()
      else {
        let message = `Part upload failed with ${request.status}.`
        try { message = (JSON.parse(request.responseText) as { error?: string }).error ?? message } catch {}
        reject(new HttpError(request.status, message))
      }
    }
    request.onerror = () => reject(new Error('Part upload lost its network connection.'))
    request.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'))
    const abort = () => request.abort()
    signal?.addEventListener('abort', abort, { once: true })
    request.onloadend = () => signal?.removeEventListener('abort', abort)
    request.send(blob)
  })
}

export async function uploadFile(
  videoId: string,
  file: File,
  options: UploadOptions,
): Promise<ReadyUpload> {
  const base = `/api/videos/${encodeURIComponent(videoId)}/uploads`
  let upload = await retry(async () => responseJson<UploadSnapshot>(await fetch(base, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRequestId: options.clientRequestId,
      displayName: file.name,
      byteSize: file.size,
      contentType: file.type || 'application/octet-stream',
      purpose: options.purpose,
    }),
  })), options.signal)
  while (upload.state === 'initializing') {
    await new Promise((resolve) => window.setTimeout(resolve, 400))
    upload = await retry(
      async () => responseJson<UploadSnapshot>(await fetch(`${base}/${upload.id}`, { credentials: 'same-origin' })),
      options.signal,
    )
  }
  if (upload.state === 'ready') return upload.result
  if (upload.state !== 'uploading') throw new Error('Upload is not available.')

  const persisted = new Set(upload.uploadedParts)
  const loaded = new Map<number, number>()
  const report = () => options.onProgress({
    sentBytes: Math.min(file.size,
      [...persisted].reduce((sum, part) => sum + Math.min(upload.partSize, file.size - upload.partSize * (part - 1)), 0)
      + [...loaded.values()].reduce((sum, size) => sum + size, 0)),
    totalBytes: file.size,
    completedParts: persisted.size,
    totalParts: upload.partCount,
  })
  const queue = Array.from({ length: upload.partCount }, (_, index) => index + 1)
    .filter((part) => !persisted.has(part))
  let cursor = 0
  const worker = async () => {
    while (cursor < queue.length) {
      const part = queue[cursor++]
      if (part === undefined) return
      const start = (part - 1) * upload.partSize
      const blob = file.slice(start, Math.min(file.size, start + upload.partSize))
      await retry(
        () => sendPart(`${base}/${upload.id}/parts/${part}`, blob, options.signal, (bytes) => {
          loaded.set(part, bytes)
          report()
        }),
        options.signal,
      )
      loaded.delete(part)
      persisted.add(part)
      report()
    }
  }
  try {
    await Promise.all([worker(), worker()])
    let complete = await retry(async () => responseJson<UploadSnapshot>(await fetch(`${base}/${upload.id}/complete`, {
      method: 'POST', credentials: 'same-origin',
    })), options.signal)
    while (complete.state === 'completing') {
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
      complete = await retry(async () => responseJson<UploadSnapshot>(await fetch(`${base}/${upload.id}/complete`, {
        method: 'POST', credentials: 'same-origin',
      })), options.signal)
    }
    if (complete.state !== 'ready') throw new Error('Upload completion did not publish a file.')
    return complete.result
  } catch (error) {
    if (options.signal?.aborted) {
      await fetch(`${base}/${upload.id}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined)
    }
    throw error
  }
}
