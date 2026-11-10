import {
  markPosted,
  parsePostPlatform,
  type PostDraft,
  type PostPlatform,
  type PostTarget,
} from './posts'

export function mcpTargets(target: PostTarget): readonly PostPlatform[] {
  switch (target) {
    case 'both':
      return ['x', 'threads']
    case 'x':
      return ['x']
    case 'threads':
      return ['threads']
    default: {
      const unexpected: never = target
      throw new Error(unexpected)
    }
  }
}

export function applyPosted(
  draft: PostDraft,
  platform: PostPlatform,
  postIds: readonly string[],
  now: number,
  urls?: readonly string[],
): ReturnType<typeof markPosted> {
  const forMark = draft.status === 'draft' ? { ...draft, status: 'ready' as const } : draft
  const result = markPosted(forMark, platform, postIds, now)
  if (result.kind !== 'ok') return result
  const next = result.draft
  const keptDraft = draft.status === 'draft' && next.status !== 'posted'
    ? { ...next, status: 'draft' as const }
    : next
  if (!urls) return { kind: 'ok', draft: keptDraft }
  if (urls.length !== postIds.length || urls.some((url) => typeof url !== 'string' || url.trim() === '')) {
    return { kind: 'invalid', message: 'Provide one url for each posted id, or omit urls.' }
  }
  const publications = keptDraft.publications.map((row) => (
    row.platform === platform && row.postedAt === now
      ? { ...row, urls: urls.map((url) => url.trim()) }
      : row
  ))
  return { kind: 'ok', draft: { ...keptDraft, publications } }
}

export function parseMarkPostedInput(value: unknown): {
  platform: PostPlatform
  postIds: readonly string[]
  urls?: readonly string[]
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('mark_posted input is invalid.')
  }
  const input = value as Record<string, unknown>
  const platform = parsePostPlatform(input.platform)
  if (!Array.isArray(input.post_ids) && !Array.isArray(input.postIds)) {
    throw new Error('Posted ids are required.')
  }
  const postIds = (input.post_ids ?? input.postIds) as unknown[]
  if (postIds.some((id) => typeof id !== 'string')) throw new Error('Posted ids are required.')
  const urlsValue = input.urls
  const urls = urlsValue === undefined
    ? undefined
    : Array.isArray(urlsValue) && urlsValue.every((url) => typeof url === 'string')
      ? urlsValue
      : (() => { throw new Error('Posted urls are invalid.') })()
  return { platform, postIds: postIds as string[], urls }
}
