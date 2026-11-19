import type { Comment, CommentStatus, ProjectDetail, ProjectSummary, ReviewAnchor } from '../shared/domain.ts'

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.status === 204) return undefined as T
  const payload = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`)
  return payload
}

export const api = {
  projects: () => call<ProjectSummary[]>('/api/projects'),
  project: (slug: string) => call<ProjectDetail>(`/api/projects/${encodeURIComponent(slug)}`),
  addComment: (draftId: string, input: { parentId?: string; anchor: ReviewAnchor; body: string }) => call<Comment>(`/api/drafts/${draftId}/comments`, 'POST', input),
  editComment: (id: string, body: string) => call<Comment>(`/api/comments/${id}`, 'PATCH', { body }),
  setStatus: (id: string, status: CommentStatus) => call<Comment>(`/api/comments/${id}/status`, 'POST', { status }),
  deleteComment: (id: string) => call<void>(`/api/comments/${id}`, 'DELETE'),
}
