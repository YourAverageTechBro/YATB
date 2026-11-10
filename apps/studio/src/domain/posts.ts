import twitterText from 'twitter-text'

export type PostId = string
export type PostItemId = string
export type PostMediaId = string
export type PostRevision = number
export type PostTarget = 'x' | 'threads' | 'both'
export type PostStatus = 'draft' | 'ready' | 'posted'
export type PostPlatform = 'x' | 'threads'
export type PostMediaKind = 'image' | 'gif' | 'video'

export const X_STANDARD_LIMIT = 280
export const X_PREMIUM_LIMIT = 25_000
export const THREADS_CODEPOINT_LIMIT = 500
export const X_MAX_IMAGES = 4
export const THREADS_MAX_MEDIA = 20
export const X_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const X_GIF_MAX_BYTES = 15 * 1024 * 1024
export const X_VIDEO_MAX_BYTES = 512 * 1024 * 1024
export const X_VIDEO_MAX_MS = 140_000
export const POST_UPLOAD_MAX_BYTES = X_VIDEO_MAX_BYTES

export type PostMedia = Readonly<{
  id: PostMediaId
  order: number
  mime: string
  alt: string | null
  byteSize: number
  durationMs: number | null
  objectKey: string
  displayName: string
}>

export type PostItem = Readonly<{
  id: PostItemId
  order: number
  body: string
  media: readonly PostMedia[]
}>

export type PostPublication = Readonly<{
  platform: PostPlatform
  postIds: readonly string[]
  urls: readonly string[]
  postedAt: number
}>

export type PostDraft = Readonly<{
  id: PostId
  target: PostTarget
  xPremium: boolean
  status: PostStatus
  revision: PostRevision
  items: readonly PostItem[]
  publications: readonly PostPublication[]
  updatedByUserId: string
  createdAt: number
  updatedAt: number
}>

export type PostSummary = Readonly<{
  id: PostId
  target: PostTarget
  xPremium: boolean
  status: PostStatus
  revision: PostRevision
  postCount: number
  preview: string
  updatedAt: number
}>

export type ComposerIssue = Readonly<{
  severity: 'error' | 'warning'
  code:
    | 'empty-post'
    | 'x-over-limit'
    | 'threads-over-limit'
    | 'x-media-mix'
    | 'x-too-many-images'
    | 'x-too-many-video'
    | 'threads-too-many-media'
    | 'x-image-too-large'
    | 'x-gif-too-large'
    | 'x-video-too-large'
    | 'x-video-too-long'
    | 'x-video-duration-missing'
    | 'unsupported-media'
    | 'extra-hashtags'
    | 'missing-alt'
  message: string
  postIndex: number
  mediaIndex: number | null
}>

export type ComposerReport = Readonly<{
  issues: readonly ComposerIssue[]
  x: readonly PostCount[]
  threads: readonly PostCount[]
}>

export type PostCount = Readonly<{
  used: number
  limit: number
  over: boolean
}>

export type MarkPostedResult =
  | { kind: 'ok'; draft: PostDraft }
  | { kind: 'invalid'; message: string }

export type GetPostInput = Readonly<{
  draft: unknown
  posts: readonly unknown[]
  media: readonly unknown[]
  publications: readonly unknown[]
}>

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])

function invalid(message: string): never {
  throw new Error(message)
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(message)
  return value as Record<string, unknown>
}

function asString(value: unknown, message: string): string {
  return typeof value === 'string' ? value : invalid(message)
}

function asInt(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(message)
  return value
}

export function parsePostId(value: unknown): PostId {
  const id = asString(value, 'Post id is required.')
  if (!ID_PATTERN.test(id)) invalid('Post id is invalid.')
  return id
}

export function parsePostItemId(value: unknown): PostItemId {
  return parsePostId(value)
}

export function parsePostMediaId(value: unknown): PostMediaId {
  return parsePostId(value)
}

export function parsePostRevision(value: unknown): PostRevision {
  const revision = asInt(value, 'Revision is invalid.')
  if (revision < 1) invalid('Revision is invalid.')
  return revision
}

export function parsePostTarget(value: unknown): PostTarget {
  const target = asString(value, 'Target is required.')
  if (target === 'x' || target === 'threads' || target === 'both') return target
  invalid('Target is invalid.')
}

export function parsePostStatus(value: unknown): PostStatus {
  const status = asString(value, 'Status is required.')
  if (status === 'draft' || status === 'ready' || status === 'posted') return status
  invalid('Status is invalid.')
}

export function parsePostPlatform(value: unknown): PostPlatform {
  const platform = asString(value, 'Platform is required.')
  if (platform === 'x' || platform === 'threads') return platform
  invalid('Platform is invalid.')
}

export function targetsPlatform(target: PostTarget, platform: PostPlatform): boolean {
  switch (target) {
    case 'both':
      return true
    case 'x':
      return platform === 'x'
    case 'threads':
      return platform === 'threads'
    default: {
      const unexpected: never = target
      throw new Error(unexpected)
    }
  }
}

export function xLimit(xPremium: boolean): number {
  return xPremium ? X_PREMIUM_LIMIT : X_STANDARD_LIMIT
}

export function mediaKind(mime: string): PostMediaKind | null {
  if (IMAGE_TYPES.has(mime)) return 'image'
  if (mime === 'image/gif') return 'gif'
  if (VIDEO_TYPES.has(mime)) return 'video'
  return null
}

export function postObjectKey(draftId: PostId, mediaId: PostMediaId): string {
  return `posts/${draftId}/${mediaId}`
}

const TWITTER_TEXT_V3 = {
  version: 3,
  scale: 100,
  defaultWeight: 200,
  emojiParsingEnabled: true,
  transformedURLLength: 23,
  ranges: [
    { start: 0, end: 4351, weight: 100 },
    { start: 8192, end: 8205, weight: 100 },
    { start: 8208, end: 8223, weight: 100 },
    { start: 8242, end: 8247, weight: 100 },
  ],
} satisfies Parameters<typeof twitterText.parseTweet>[1]

export function countX(text: string, xPremium: boolean): PostCount {
  const limit = xLimit(xPremium)
  const used = twitterText.parseTweet(text, { ...TWITTER_TEXT_V3, maxWeightedTweetLength: limit }).weightedLength
  return { used, limit, over: used > limit }
}

export function countThreads(text: string): PostCount {
  const used = [...text].length
  return { used, limit: THREADS_CODEPOINT_LIMIT, over: used > THREADS_CODEPOINT_LIMIT }
}

export function threadsHashtags(text: string): readonly string[] {
  return twitterText.extractHashtags(text)
}

export function rejectPostUpload(input: {
  target: PostTarget
  mime: string
  byteSize: number
  durationMs: number | null
}): string | null {
  if (input.byteSize < 1 || input.byteSize > POST_UPLOAD_MAX_BYTES) return 'File size is invalid.'
  const kind = mediaKind(input.mime)
  if (kind === null) return 'This file type is not supported.'
  if (!targetsPlatform(input.target, 'x')) return null
  switch (kind) {
    case 'image':
      return input.byteSize > X_IMAGE_MAX_BYTES ? 'X images must be 5 MB or smaller.' : null
    case 'gif':
      return input.byteSize > X_GIF_MAX_BYTES ? 'X GIFs must be 15 MB or smaller.' : null
    case 'video':
      if (input.byteSize > X_VIDEO_MAX_BYTES) return 'X videos must be 512 MB or smaller.'
      if (input.durationMs === null) return 'X videos need a duration.'
      if (input.durationMs > X_VIDEO_MAX_MS) return 'X videos must be 140 seconds or shorter.'
      return null
    default: {
      const unexpected: never = kind
      throw new Error(unexpected)
    }
  }
}

function issue(
  severity: ComposerIssue['severity'],
  code: ComposerIssue['code'],
  message: string,
  postIndex: number,
  mediaIndex: number | null = null,
): ComposerIssue {
  return { severity, code, message, postIndex, mediaIndex }
}

function xMediaIssues(media: readonly PostMedia[], postIndex: number): ComposerIssue[] {
  const issues: ComposerIssue[] = []
  const kinds = media.map((item) => mediaKind(item.mime))
  if (kinds.some((kind) => kind === null)) {
    kinds.forEach((kind, mediaIndex) => {
      if (kind === null) issues.push(issue('error', 'unsupported-media', 'This file type is not supported.', postIndex, mediaIndex))
    })
    return issues
  }
  const images = kinds.filter((kind) => kind === 'image').length
  const gifs = kinds.filter((kind) => kind === 'gif').length
  const videos = kinds.filter((kind) => kind === 'video').length
  if (gifs + videos > 0 && (images > 0 || gifs + videos > 1 || media.length > 1)) {
    issues.push(issue('error', 'x-media-mix', 'X allows up to 4 images, or one GIF, or one video, not mixed.', postIndex))
  } else if (videos > 1 || gifs > 1) {
    issues.push(issue('error', 'x-too-many-video', 'X allows one GIF or one video.', postIndex))
  } else if (images > X_MAX_IMAGES) {
    issues.push(issue('error', 'x-too-many-images', 'X allows at most 4 images.', postIndex))
  }
  media.forEach((item, mediaIndex) => {
    const rejected = rejectPostUpload({
      target: 'x',
      mime: item.mime,
      byteSize: item.byteSize,
      durationMs: item.durationMs,
    })
    if (!rejected) return
    const kind = mediaKind(item.mime)
    const code: ComposerIssue['code'] = rejected.includes('duration')
      ? 'x-video-duration-missing'
      : rejected.includes('140')
        ? 'x-video-too-long'
        : kind === 'image'
          ? 'x-image-too-large'
          : kind === 'gif'
            ? 'x-gif-too-large'
            : 'x-video-too-large'
    issues.push(issue('error', code, rejected, postIndex, mediaIndex))
  })
  return issues
}

export function evaluateComposer(draft: PostDraft): ComposerReport {
  const x: PostCount[] = []
  const threads: PostCount[] = []
  const issues: ComposerIssue[] = []
  draft.items.forEach((item, postIndex) => {
    const xCount = countX(item.body, draft.xPremium)
    const threadCount = countThreads(item.body)
    x.push(xCount)
    threads.push(threadCount)
    if (item.body.trim() === '' && item.media.length === 0) {
      issues.push(issue('error', 'empty-post', 'Each post needs text or media.', postIndex))
    }
    if (targetsPlatform(draft.target, 'x') && xCount.over) {
      issues.push(issue('error', 'x-over-limit', `This post is over the X ${xCount.limit}-character limit.`, postIndex))
    }
    if (targetsPlatform(draft.target, 'threads') && threadCount.over) {
      issues.push(issue('error', 'threads-over-limit', 'This post is over the Threads 500-character limit.', postIndex))
    }
    if (targetsPlatform(draft.target, 'threads') && threadsHashtags(item.body).length > 1) {
      issues.push(issue('warning', 'extra-hashtags', 'Only the first hashtag becomes a Threads topic tag.', postIndex))
    }
    if (targetsPlatform(draft.target, 'x')) issues.push(...xMediaIssues(item.media, postIndex))
    if (targetsPlatform(draft.target, 'threads') && item.media.length > THREADS_MAX_MEDIA) {
      issues.push(issue('error', 'threads-too-many-media', 'Threads allows at most 20 media items.', postIndex))
    }
    item.media.forEach((file, mediaIndex) => {
      if (mediaKind(file.mime) === null) {
        issues.push(issue('error', 'unsupported-media', 'This file type is not supported.', postIndex, mediaIndex))
      }
      if (!file.alt || file.alt.trim() === '') {
        issues.push(issue('warning', 'missing-alt', 'Add alt text for this image or video.', postIndex, mediaIndex))
      }
    })
  })
  return { issues, x, threads }
}

export function canMarkReady(draft: PostDraft): boolean {
  if (draft.items.length < 1) return false
  return evaluateComposer(draft).issues.every((item) => item.severity !== 'error')
}

export function publicationUrl(platform: PostPlatform, postId: string): string {
  switch (platform) {
    case 'x':
      return `https://x.com/i/status/${postId}`
    case 'threads':
      return `https://www.threads.net/t/${postId}`
    default: {
      const unexpected: never = platform
      throw new Error(unexpected)
    }
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function markPosted(
  draft: PostDraft,
  platform: PostPlatform,
  postIds: readonly string[],
  now: number,
): MarkPostedResult {
  if (draft.status === 'draft') return { kind: 'invalid', message: 'Mark ready before recording a posted id.' }
  if (!targetsPlatform(draft.target, platform)) {
    return { kind: 'invalid', message: 'This draft is not targeting that platform.' }
  }
  if (postIds.length !== draft.items.length) {
    return { kind: 'invalid', message: 'Provide one posted id for each post in the thread.' }
  }
  if (postIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
    return { kind: 'invalid', message: 'Posted ids are required.' }
  }
  const existing = draft.publications.find((item) => item.platform === platform)
  if (existing && sameIds(existing.postIds, postIds)) return { kind: 'ok', draft }
  if (existing) return { kind: 'invalid', message: 'This platform already has posted ids.' }
  const publication: PostPublication = {
    platform,
    postIds: postIds.map((id) => id.trim()),
    urls: postIds.map((id) => publicationUrl(platform, id.trim())),
    postedAt: now,
  }
  const publications = [...draft.publications, publication]
  const complete = (['x', 'threads'] as const).filter((item) => targetsPlatform(draft.target, item))
    .every((item) => publications.some((row) => row.platform === item))
  return {
    kind: 'ok',
    draft: {
      ...draft,
      publications,
      status: complete ? 'posted' : draft.status,
      updatedAt: now,
    },
  }
}

function previewFrom(body: string): string {
  const text = body.trim().replace(/\s+/g, ' ')
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`
}

function parseStringArray(value: unknown, message: string): readonly string[] {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { invalid(message) }
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) invalid(message)
  return parsed as string[]
}

function parseMediaRow(value: unknown): PostMedia & { postId: PostItemId } {
  const row = record(value, 'Stored post media is invalid.')
  const altValue = row.alt === undefined ? null : row.alt
  const duration = row.duration_ms === undefined ? row.durationMs : row.duration_ms
  return {
    id: parsePostMediaId(row.id),
    postId: parsePostItemId(row.post_id ?? row.postId),
    order: asInt(row.position ?? row.order, 'Media order is invalid.'),
    mime: asString(row.content_type ?? row.mime, 'Media type is required.'),
    alt: altValue === null ? null : asString(altValue, 'Alt text is invalid.'),
    byteSize: asInt(row.byte_size ?? row.byteSize, 'Media size is invalid.'),
    durationMs: duration === null || duration === undefined ? null : asInt(duration, 'Media duration is invalid.'),
    objectKey: asString(row.object_key ?? row.objectKey, 'Media object key is required.'),
    displayName: asString(row.display_name ?? row.displayName, 'Media name is required.'),
  }
}

function parsePublicationRow(value: unknown): PostPublication {
  const row = record(value, 'Stored publication is invalid.')
  return {
    platform: parsePostPlatform(row.platform),
    postIds: parseStringArray(row.post_ids_json ?? row.postIds, 'Posted ids are invalid.'),
    urls: parseStringArray(row.urls_json ?? row.urls, 'Posted urls are invalid.'),
    postedAt: asInt(row.posted_at ?? row.postedAt, 'Posted time is invalid.'),
  }
}

export function listPosts(rows: readonly unknown[]): readonly PostSummary[] {
  return rows.map((value) => {
    const row = record(value, 'Stored post list row is invalid.')
    const body = typeof row.body === 'string' ? row.body : typeof row.preview === 'string' ? row.preview : ''
    const premium = row.x_premium ?? row.xPremium
    return {
      id: parsePostId(row.id),
      target: parsePostTarget(row.target),
      xPremium: premium === 1 || premium === true,
      status: parsePostStatus(row.status),
      revision: parsePostRevision(row.revision),
      postCount: asInt(row.post_count ?? row.postCount, 'Post count is invalid.'),
      preview: previewFrom(body),
      updatedAt: asInt(row.updated_at ?? row.updatedAt, 'Update time is invalid.'),
    }
  })
}

export function getPost(input: GetPostInput): PostDraft {
  const row = record(input.draft, 'Stored post draft is invalid.')
  const premium = row.x_premium ?? row.xPremium
  const media = input.media.map(parseMediaRow)
  const items = [...input.posts].map((value) => {
    const post = record(value, 'Stored post is invalid.')
    const id = parsePostItemId(post.id)
    return {
      id,
      order: asInt(post.position ?? post.order, 'Post order is invalid.'),
      body: asString(post.body, 'Post body is required.'),
      media: media.filter((item) => item.postId === id).sort((left, right) => left.order - right.order).map((item) => ({
        id: item.id,
        order: item.order,
        mime: item.mime,
        alt: item.alt,
        byteSize: item.byteSize,
        durationMs: item.durationMs,
        objectKey: item.objectKey,
        displayName: item.displayName,
      })),
    }
  }).sort((left, right) => left.order - right.order)
  if (items.length < 1) invalid('A draft needs at least one post.')
  return {
    id: parsePostId(row.id),
    target: parsePostTarget(row.target),
    xPremium: premium === 1 || premium === true,
    status: parsePostStatus(row.status),
    revision: parsePostRevision(row.revision),
    items,
    publications: input.publications.map(parsePublicationRow),
    updatedByUserId: asString(row.updated_by_user_id ?? row.updatedByUserId, 'Updated by is required.'),
    createdAt: asInt(row.created_at ?? row.createdAt, 'Creation time is invalid.'),
    updatedAt: asInt(row.updated_at ?? row.updatedAt, 'Update time is invalid.'),
  }
}

export function duplicateAsDraft(
  draft: PostDraft,
  ids: { draftId: PostId; items: ReadonlyArray<{ id: PostItemId; mediaIds: readonly PostMediaId[] }> },
  now: number,
  userId: string,
): PostDraft {
  return {
    id: ids.draftId,
    target: draft.target,
    xPremium: draft.xPremium,
    status: 'draft',
    revision: 1,
    items: draft.items.map((item, index) => {
      const assigned = ids.items[index]
      if (!assigned || assigned.mediaIds.length !== item.media.length) invalid('Duplicate ids do not match the thread.')
      return {
        id: assigned.id,
        order: index,
        body: item.body,
        media: item.media.map((file, mediaIndex) => ({
          ...file,
          id: assigned.mediaIds[mediaIndex]!,
          objectKey: postObjectKey(ids.draftId, assigned.mediaIds[mediaIndex]!),
          order: mediaIndex,
        })),
      }
    }),
    publications: [],
    updatedByUserId: userId,
    createdAt: now,
    updatedAt: now,
  }
}
