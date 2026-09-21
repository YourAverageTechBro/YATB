import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import {
  mediaPreviewKind,
  parseBeginUpload,
  parseDisplayName,
  parseMediaId,
  parsePartNumber,
  parseSingleByteRange,
} from '#/domain/media'
import { parseVideoId } from '#/domain/videos'
import { PRIVATE_NO_STORE, requireStudioMutationOrigin, requireStudioSession } from './auth.server'
import {
  MediaError,
  beginUpload,
  cancelUpload,
  completeUpload,
  getStoredMedia,
  getUpload,
  listMedia,
  renameMedia,
  uploadPart,
} from './media.server'
import { compressedDisplayName } from '#/domain/derivatives'
import { getStoredDerivative } from './compression.server'

const bindings = env as Cloudflare.Env & { MEDIA: R2Bucket }

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': PRIVATE_NO_STORE },
  })
}

function errorResponse(error: unknown): Response {
  if (error instanceof Response) return error
  if (error instanceof MediaError) return json({ error: error.message }, error.status)
  if (error instanceof SyntaxError) return json({ error: 'Request body is invalid.' }, 400)
  if (error instanceof Error && /(?:required|invalid|between|exactly)/i.test(error.message)) {
    return json({ error: error.message }, 400)
  }
  console.error('Media request failed', error)
  return json({ error: 'Media operation failed.' }, 500)
}

async function run(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action()
  } catch (error) {
    return errorResponse(error)
  }
}

async function authenticated(): Promise<Awaited<ReturnType<typeof requireStudioSession>>> {
  return requireStudioSession()
}

async function mutation(): Promise<Awaited<ReturnType<typeof requireStudioSession>>> {
  const session = await authenticated()
  requireStudioMutationOrigin()
  return session
}

export function handleUploadCollection(request: Request, videoIdValue: string): Promise<Response> {
  return run(async () => {
    const videoId = parseVideoId(videoIdValue)
    const session = await mutation()
    const body = await request.json()
    const input = parseBeginUpload({ ...(body as object), videoId })
    const upload = await beginUpload(input, session.user.id)
    return json(upload, upload.state === 'initializing' ? 202 : 201)
  })
}

export function handleUpload(request: Request, videoIdValue: string, uploadIdValue: string): Promise<Response> {
  return run(async () => {
    const videoId = parseVideoId(videoIdValue)
    const uploadId = parseMediaId(uploadIdValue)
    if (request.method === 'GET') {
      await authenticated()
      return json(await getUpload(videoId, uploadId))
    }
    await mutation()
    return json(await cancelUpload(videoId, uploadId))
  })
}

export function handleUploadPart(
  request: Request,
  videoIdValue: string,
  uploadIdValue: string,
  partNumberValue: string,
): Promise<Response> {
  return run(async () => {
    await mutation()
    if (!request.body) throw new MediaError(400, 'Part body is required.')
    const rawLength = request.headers.get('content-length')
    if (!rawLength || !/^\d+$/.test(rawLength)) throw new MediaError(411, 'Content-Length is required.')
    const result = await uploadPart(
      parseVideoId(videoIdValue),
      parseMediaId(uploadIdValue),
      parsePartNumber(partNumberValue),
      Number(rawLength),
      request.body,
    )
    return json(result)
  })
}

export function handleUploadComplete(videoIdValue: string, uploadIdValue: string): Promise<Response> {
  return run(async () => {
    await mutation()
    return json(await completeUpload(parseVideoId(videoIdValue), parseMediaId(uploadIdValue)))
  })
}

export function handleMediaCollection(videoIdValue: string): Promise<Response> {
  return run(async () => {
    await authenticated()
    return json(await listMedia(parseVideoId(videoIdValue)))
  })
}

export function handleMediaMutation(request: Request, videoIdValue: string, fileIdValue: string): Promise<Response> {
  return run(async () => {
    await mutation()
    const body = await request.json() as { displayName?: unknown }
    return json(await renameMedia(
      parseVideoId(videoIdValue),
      parseMediaId(fileIdValue),
      parseDisplayName(body.displayName),
    ))
  })
}

function contentDisposition(name: string, attachment: boolean): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${attachment ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export function handleMediaRead(
  request: Request,
  videoIdValue: string,
  fileIdValue: string,
): Promise<Response> {
  return run(async () => {
    await authenticated()
    const file = await getStoredMedia(parseVideoId(videoIdValue), parseMediaId(fileIdValue))
    const url = new URL(request.url)
    const compressed = url.searchParams.get('download') === 'compressed'
    if (compressed) {
      const derivative = await getStoredDerivative(file.video_id, file.id)
      if (!derivative || derivative.state !== 'ready' || derivative.byteSize === null
          || derivative.contentType === null || derivative.objectEtag === null) {
        const state = derivative?.state ?? 'queued'
        const status = state === 'failed' ? 503 : state === 'unsupported' ? 422 : state === 'not_beneficial' ? 409 : 202
        return json({ state }, status)
      }
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Cache-Control': PRIVATE_NO_STORE,
        'Content-Disposition': contentDisposition(compressedDisplayName(derivative.sourceDisplayName), true),
        'Content-Type': derivative.contentType,
        'X-Content-Type-Options': 'nosniff',
        'X-Media-Derivative-State': 'ready',
      })
      let range
      try {
        range = parseSingleByteRange(request.headers.get('range'), derivative.byteSize)
      } catch {
        headers.set('Content-Range', `bytes */${derivative.byteSize}`)
        return new Response(null, { status: 416, headers })
      }
      headers.set('Content-Length', String(range?.length ?? derivative.byteSize))
      if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${derivative.byteSize}`)
      if (request.method === 'HEAD') {
        const object = await bindings.MEDIA.head(derivative.objectKey)
        if (!object) throw new MediaError(404, 'File not found.')
        headers.set('ETag', object.httpEtag)
        return new Response(null, { status: range ? 206 : 200, headers })
      }
      const object = await bindings.MEDIA.get(derivative.objectKey, range ? { range } : undefined)
      if (!object) throw new MediaError(404, 'File not found.')
      headers.set('ETag', object.httpEtag)
      return new Response(object.body, { status: range ? 206 : 200, headers })
    }
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': PRIVATE_NO_STORE,
      'Content-Type': file.content_type,
      'X-Content-Type-Options': 'nosniff',
    })
    const inline = mediaPreviewKind(file.content_type) !== 'file'
      && url.searchParams.get('download') !== '1'
    headers.set('Content-Disposition', contentDisposition(file.display_name, !inline))
    let range
    try {
      range = parseSingleByteRange(request.headers.get('range'), file.byte_size)
    } catch {
      headers.set('Content-Range', `bytes */${file.byte_size}`)
      return new Response(null, { status: 416, headers })
    }
    if (request.method === 'HEAD') {
      const object = await bindings.MEDIA.head(file.object_key)
      if (!object) throw new MediaError(404, 'File not found.')
      headers.set('ETag', object.httpEtag)
      headers.set('Content-Length', String(range?.length ?? file.byte_size))
      if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${file.byte_size}`)
      return new Response(null, { status: range ? 206 : 200, headers })
    }
    const object = await bindings.MEDIA.get(file.object_key, range ? { range } : undefined)
    if (!object) throw new MediaError(404, 'File not found.')
    headers.set('ETag', object.httpEtag)
    headers.set('Content-Length', String(range?.length ?? file.byte_size))
    if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${file.byte_size}`)
    return new Response(object.body, { status: range ? 206 : 200, headers })
  })
}
