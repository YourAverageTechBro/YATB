import { McpServer, createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { mcpTargets, parseMarkPostedInput } from '#/domain/mcp-posts'
import {
  MCP_MEDIA_TTL_MS,
  MCP_SCOPES,
  isMcpScope,
  parseBearerToken,
  signMcpMedia,
  verifyMcpMediaMac,
  type McpScope,
} from '#/domain/mcp-tokens'
import {
  FILES_MIGRATION_MESSAGE,
  getFileInputSchema,
  listFilesInputSchema,
  parseFileKind,
  parseGetFileInput,
  parseListFilesInput,
  parsePatchFileTagsInput,
  parseSetFileTagsInput,
  patchFileTagsInputSchema,
  setFileTagsInputSchema,
  type CatalogFile,
  type FileKind,
} from '#/domain/mcp-files'
import {
  applyVideoPatch,
  createVideoInputSchema,
  getVideoInputSchema,
  linkedOrganicId,
  listVideosInputSchema,
  mcpVideoView,
  parseCreateVideoToolInput,
  parseGetVideoInput,
  parseListVideosInput,
  updateVideoInputSchema,
} from '#/domain/mcp-videos'
import { parseMediaId } from '#/domain/media'
import { parsePostId, parsePostMediaId, parsePostStatus, type PostDraft, type PostStatus } from '#/domain/posts'
import { emptyRichDocument, parseRichDocument } from './rich-document'
import { getPostDraft, getPostMediaObject, listPostDrafts, recordStudioPosted } from './posts.server'
import {
  addFileTags,
  FilesCatalogError,
  getCatalogObject,
  listCatalogFiles,
  removeFileTags,
  resolveCatalogFile,
  setFileTags,
} from './files.server'
import { resolveMcpBearer } from './mcp-tokens.server'
import {
  createVideo as createStudioVideo,
  getVideo as getStudioVideo,
  listInboundIntegrations,
  listMcpVideos,
  parseCreateVideoInput,
  parseEditVideoInput,
  updateVideo as updateStudioVideo,
} from './videos.server'

const bindings = env as Cloudflare.Env & { BETTER_AUTH_SECRET: string }

function unauthorized(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'WWW-Authenticate': 'Bearer realm="YATB Studio", error="invalid_token"',
    },
  })
}

function jsonTool(value: unknown, isError = false) {
  return {
    isError,
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
}

function missingScope(scope: McpScope) {
  return jsonTool({ error: `Missing scope ${scope}` }, true)
}

function scopesOf(auth: AuthInfo | undefined): readonly McpScope[] {
  return (auth?.scopes ?? []).filter((scope): scope is McpScope => (
    (MCP_SCOPES as readonly string[]).includes(scope)
  ))
}

function toolCaught(error: unknown) {
  if (error instanceof Error) return jsonTool({ error: error.message }, true)
  return jsonTool({ error: 'Request is invalid.' }, true)
}

async function signedMediaUrl(mediaId: string, now: number): Promise<string> {
  const exp = now + MCP_MEDIA_TTL_MS
  const sig = await signMcpMedia(bindings.BETTER_AUTH_SECRET, mediaId, exp)
  const origin = new URL(bindings.APP_ORIGIN).origin
  return `${origin}/mcp/media/${mediaId}?exp=${exp}&sig=${sig}`
}

async function signedFileUrl(kind: CatalogFile['kind'], fileId: string, now: number): Promise<{
  download_url: string
  download_expires_at: number
}> {
  const exp = now + MCP_MEDIA_TTL_MS
  const mediaId = `${kind}/${fileId}`
  const sig = await signMcpMedia(bindings.BETTER_AUTH_SECRET, mediaId, exp)
  const origin = new URL(bindings.APP_ORIGIN).origin
  return {
    download_url: `${origin}/mcp/files/${kind}/${fileId}?exp=${exp}&sig=${sig}`,
    download_expires_at: exp,
  }
}

async function mcpFileView(file: CatalogFile, now: number) {
  return { ...file, ...await signedFileUrl(file.kind, file.id, now) }
}

function filesCaught(error: unknown) {
  if (error instanceof FilesCatalogError) return jsonTool({ error: error.message }, true)
  if (error instanceof Error && error.message === FILES_MIGRATION_MESSAGE) {
    return jsonTool({ error: FILES_MIGRATION_MESSAGE }, true)
  }
  return toolCaught(error)
}

async function mcpPostView(draft: PostDraft, now: number) {
  return {
    id: draft.id,
    targets: mcpTargets(draft.target),
    x_premium: draft.xPremium,
    status: draft.status,
    updated_at: draft.updatedAt,
    publications: draft.publications,
    posts: await Promise.all(draft.items.map(async (item) => ({
      order: item.order,
      text: item.body,
      media: await Promise.all(item.media.map(async (file) => ({
        order: file.order,
        mime: file.mime,
        alt: file.alt,
        url: await signedMediaUrl(file.id, now),
      }))),
    }))),
  }
}

const mcpHandler = createMcpHandler((ctx) => {
  const scopes = scopesOf(ctx.authInfo)
  const server = new McpServer({ name: 'yatb-studio-posts', version: '1.0.0' })

  server.registerTool(
    'list_posts',
    {
      description: 'List Studio social post drafts. Optional status filter: draft, ready, or posted.',
      inputSchema: z.object({
        status: z.enum(['draft', 'ready', 'posted']).optional(),
      }),
    },
    async ({ status }) => {
      if (!isMcpScope(scopes, 'posts:read')) return missingScope('posts:read')
      const parsedStatus = status === undefined ? undefined : parsePostStatus(status) as PostStatus
      const rows = await listPostDrafts(parsedStatus)
      return jsonTool(rows.map((row) => ({
        id: row.id,
        title: row.preview,
        targets: mcpTargets(row.target),
        status: row.status,
        updated_at: row.updatedAt,
      })))
    },
  )

  server.registerTool(
    'get_post',
    {
      description: 'Get one Studio thread with per-target text, Premium flag, and short-lived media URLs.',
      inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) => {
      if (!isMcpScope(scopes, 'posts:read')) return missingScope('posts:read')
      const draft = await getPostDraft(parsePostId(id))
      if (!draft) return jsonTool({ error: 'Post not found.' }, true)
      return jsonTool(await mcpPostView(draft, Date.now()))
    },
  )

  server.registerTool(
    'mark_posted',
    {
      description: 'Record posted ids for X or Threads. Becomes posted when every target has ids. Idempotent.',
      inputSchema: z.object({
        id: z.string(),
        platform: z.enum(['x', 'threads']),
        post_ids: z.array(z.string()).min(1),
        urls: z.array(z.string()).optional(),
      }),
    },
    async (raw) => {
      if (!isMcpScope(scopes, 'posts:mark_posted')) return missingScope('posts:mark_posted')
      const id = parsePostId(raw.id)
      const input = parseMarkPostedInput(raw)
      const result = await recordStudioPosted(id, input.platform, input.postIds, Date.now(), input.urls)
      if (result.kind === 'missing') return jsonTool({ error: 'Post not found.' }, true)
      if (result.kind === 'invalid') return jsonTool({ error: result.message }, true)
      return jsonTool({
        id: result.draft.id,
        status: result.draft.status,
        publications: result.draft.publications,
      })
    },
  )

  server.registerTool(
    'list_videos',
    {
      description: 'List Studio videos. Optional filters: status, format, promotion. Paginated.',
      inputSchema: listVideosInputSchema,
    },
    async (raw) => {
      if (!isMcpScope(scopes, 'videos:read')) return missingScope('videos:read')
      try {
        const input = parseListVideosInput(raw)
        const rows = await listMcpVideos({
          status: input.status,
          format: input.format,
          promotion: input.promotion,
          limit: input.limit + 1,
          offset: (input.page - 1) * input.limit,
        })
        const hasMore = rows.length > input.limit
        return jsonTool({
          videos: rows.slice(0, input.limit).map(mcpVideoView),
          page: input.page,
          limit: input.limit,
          has_more: hasMore,
        })
      } catch (error) {
        return toolCaught(error)
      }
    },
  )

  server.registerTool(
    'get_video',
    {
      description: 'Get one Studio video, including the linked organic video and inbound integrations.',
      inputSchema: getVideoInputSchema,
    },
    async (raw) => {
      if (!isMcpScope(scopes, 'videos:read')) return missingScope('videos:read')
      try {
        const id = parseGetVideoInput(raw)
        const video = await getStudioVideo(id)
        if (!video) return jsonTool({ error: 'Video not found.' }, true)
        const organicId = linkedOrganicId(video.production)
        const [linkedOrganic, inbound] = await Promise.all([
          organicId ? getStudioVideo(organicId) : Promise.resolve(null),
          listInboundIntegrations(id),
        ])
        return jsonTool({
          ...mcpVideoView(video),
          linked_organic: linkedOrganic ? mcpVideoView(linkedOrganic) : null,
          inbound_integrations: inbound.map(mcpVideoView),
        })
      } catch (error) {
        return toolCaught(error)
      }
    },
  )

  server.registerTool(
    'create_video',
    {
      description: 'Create a Studio video. Same validation as the New video form.',
      inputSchema: createVideoInputSchema,
    },
    async (raw) => {
      if (!isMcpScope(scopes, 'videos:write')) return missingScope('videos:write')
      try {
        const input = parseCreateVideoToolInput(raw)
        const script = input.script === undefined ? emptyRichDocument() : parseRichDocument(input.script)
        const result = await createStudioVideo(parseCreateVideoInput({
          title: input.title,
          production: input.production,
          publishDate: input.publishDate,
          script,
        }))
        if (result.kind === 'invalid-link') return jsonTool({ error: result.message }, true)
        if (input.status === 'not-started') return jsonTool(mcpVideoView(result.video))
        const saved = await updateStudioVideo(parseEditVideoInput({
          ...result.video,
          expectedRevision: result.video.revision,
          status: input.status,
        }))
        if (saved.kind === 'invalid-link') return jsonTool({ error: saved.message }, true)
        if (saved.kind === 'conflict' || saved.kind === 'not-found') {
          return jsonTool({ error: 'Created video could not be updated.' }, true)
        }
        return jsonTool(mcpVideoView(saved.video))
      } catch (error) {
        return toolCaught(error)
      }
    },
  )

  server.registerTool(
    'update_video',
    {
      description: 'Partially update a Studio video. Same validation as the video editor save path.',
      inputSchema: updateVideoInputSchema,
    },
    async (raw) => {
      if (!isMcpScope(scopes, 'videos:write')) return missingScope('videos:write')
      try {
        const id = parseGetVideoInput({ id: typeof raw === 'object' && raw !== null && 'id' in raw ? raw.id : undefined })
        const current = await getStudioVideo(id)
        if (!current) return jsonTool({ error: 'Video not found.' }, true)
        const patch = applyVideoPatch(current, raw)
        const script = patch.script === current.script ? current.script : parseRichDocument(patch.script)
        const result = await updateStudioVideo(parseEditVideoInput({ ...patch, script }))
        if (result.kind === 'invalid-link') return jsonTool({ error: result.message }, true)
        if (result.kind === 'conflict') return jsonTool({ error: 'Video was updated elsewhere. Retry.' }, true)
        if (result.kind === 'not-found') return jsonTool({ error: 'Video not found.' }, true)
        return jsonTool(mcpVideoView(result.video))
      } catch (error) {
        return toolCaught(error)
      }
    },
  )

  server.registerTool(
    'list_files',
    {
      description: 'List Studio files across footage, review cuts, and post media. Filter by kind, video, post, tag, name, type, or created range.',
      inputSchema: listFilesInputSchema,
    },
    async (raw) => {
      if (!isMcpScope(scopes, 'files:read')) return missingScope('files:read')
      try {
        const input = parseListFilesInput(raw)
        const listed = await listCatalogFiles(input)
        const now = Date.now()
        return jsonTool({
          files: await Promise.all(listed.files.map((file) => mcpFileView(file, now))),
          page: listed.page,
          limit: listed.limit,
          has_more: listed.has_more,
        })
      } catch (error) {
        return filesCaught(error)
      }
    },
  )

  server.registerTool(
    'get_file',
    {
      description: 'Get one Studio file. Pass kind when the same id could exist in more than one catalog.',
      inputSchema: getFileInputSchema,
    },
    async (raw) => {
      if (!isMcpScope(scopes, 'files:read')) return missingScope('files:read')
      try {
        const input = parseGetFileInput(raw)
        return jsonTool(await mcpFileView(await resolveCatalogFile(input.id, input.kind), Date.now()))
      } catch (error) {
        return filesCaught(error)
      }
    },
  )

  server.registerTool(
    'set_file_tags',
    {
      description: 'Replace all tags on a Studio file. Requires files:write.',
      inputSchema: setFileTagsInputSchema,
    },
    async (raw) => {
      if (!isMcpScope(scopes, 'files:write')) return missingScope('files:write')
      try {
        const input = parseSetFileTagsInput(raw)
        return jsonTool(await mcpFileView(await setFileTags(input.kind, input.id, input.tags), Date.now()))
      } catch (error) {
        return filesCaught(error)
      }
    },
  )

  server.registerTool(
    'add_file_tags',
    {
      description: 'Add tags to a Studio file without removing existing ones. Requires files:write.',
      inputSchema: patchFileTagsInputSchema,
    },
    async (raw) => {
      if (!isMcpScope(scopes, 'files:write')) return missingScope('files:write')
      try {
        const input = parsePatchFileTagsInput(raw)
        return jsonTool(await mcpFileView(await addFileTags(input.kind, input.id, input.tags), Date.now()))
      } catch (error) {
        return filesCaught(error)
      }
    },
  )

  server.registerTool(
    'remove_file_tags',
    {
      description: 'Remove tags from a Studio file. Requires files:write.',
      inputSchema: patchFileTagsInputSchema,
    },
    async (raw) => {
      if (!isMcpScope(scopes, 'files:write')) return missingScope('files:write')
      try {
        const input = parsePatchFileTagsInput(raw)
        return jsonTool(await mcpFileView(await removeFileTags(input.kind, input.id, input.tags), Date.now()))
      } catch (error) {
        return filesCaught(error)
      }
    },
  )

  return server
})

function mcpOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true
    return origin === new URL(bindings.APP_ORIGIN).origin
  } catch {
    return false
  }
}

async function authorizeMcp(request: Request): Promise<AuthInfo | null> {
  const plaintext = parseBearerToken(request.headers.get('authorization'))
  if (!plaintext) return null
  const token = await resolveMcpBearer(plaintext)
  if (!token) return null
  return {
    token: token.id,
    clientId: token.id,
    scopes: [...token.scopes],
  }
}

async function handleMcpMedia(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const mediaId = url.pathname.slice('/mcp/media/'.length)
  let id: string
  try { id = parsePostMediaId(mediaId) } catch {
    return new Response('Not found.', { status: 404 })
  }
  const exp = Number(url.searchParams.get('exp'))
  const sig = url.searchParams.get('sig') ?? ''
  if (!(await verifyMcpMediaMac(bindings.BETTER_AUTH_SECRET, id, exp, sig))) {
    return new Response('Not found.', { status: 404 })
  }
  const file = await getPostMediaObject(id)
  if (!file) return new Response('Not found.', { status: 404 })
  const headers = new Headers({
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Type': file.content_type,
    'Content-Disposition': `inline; filename="${file.display_name.replace(/[^\x20-\x7e]/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    const object = await bindings.MEDIA.head(file.object_key)
    if (!object) return new Response('Not found.', { status: 404 })
    return new Response(null, { status: 200, headers })
  }
  const object = await bindings.MEDIA.get(file.object_key)
  if (!object) return new Response('Not found.', { status: 404 })
  return new Response(object.body, { status: 200, headers })
}

async function handleMcpFile(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const rest = url.pathname.slice('/mcp/files/'.length)
  const slash = rest.indexOf('/')
  if (slash < 1) return new Response('Not found.', { status: 404 })
  let kind: FileKind
  let id: string
  try {
    kind = parseFileKind(rest.slice(0, slash))
    id = kind === 'post_media' ? parsePostMediaId(rest.slice(slash + 1)) : parseMediaId(rest.slice(slash + 1))
  } catch {
    return new Response('Not found.', { status: 404 })
  }
  const exp = Number(url.searchParams.get('exp'))
  const sig = url.searchParams.get('sig') ?? ''
  if (!(await verifyMcpMediaMac(bindings.BETTER_AUTH_SECRET, `${kind}/${id}`, exp, sig))) {
    return new Response('Not found.', { status: 404 })
  }
  let file
  try {
    file = await getCatalogObject(kind, id)
  } catch {
    return new Response('Not found.', { status: 404 })
  }
  if (!file) return new Response('Not found.', { status: 404 })
  const headers = new Headers({
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Type': file.content_type,
    'Content-Disposition': `attachment; filename="${file.display_name.replace(/[^\x20-\x7e]/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    const object = await bindings.MEDIA.head(file.object_key)
    if (!object) return new Response('Not found.', { status: 404 })
    return new Response(null, { status: 200, headers })
  }
  const object = await bindings.MEDIA.get(file.object_key)
  if (!object) return new Response('Not found.', { status: 404 })
  return new Response(object.body, { status: 200, headers })
}

export async function handleStudioMcp(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname
  if (!mcpOriginAllowed(request)) return new Response('Forbidden', { status: 403 })
  if (path.startsWith('/mcp/files/')) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 })
    }
    return handleMcpFile(request)
  }
  if (path.startsWith('/mcp/media/')) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 })
    }
    return handleMcpMedia(request)
  }
  if (path !== '/mcp') return new Response('Not found.', { status: 404 })
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': request.headers.get('origin') ?? '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      },
    })
  }
  const authInfo = await authorizeMcp(request)
  if (!authInfo) return unauthorized()
  return mcpHandler.fetch(request, { authInfo })
}
