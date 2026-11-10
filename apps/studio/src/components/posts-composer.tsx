import { useState } from 'react'
import { Alert, AlertDescription } from '@yatb/ui/alert'
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import { Textarea } from '@yatb/ui/textarea'
import { useNavigate } from '@tanstack/react-router'
import type { PostDraft, PostItem, PostMedia } from '#/domain/posts'
import { duplicatePostDraft, markPostReady } from '#/server/posts.functions'
import { uploadPostMedia, videoDurationMs } from '#/client/post-upload'
import { usePostsAutosave } from './use-posts-autosave'

function saveLabel(kind: string): string {
  if (kind === 'saving' || kind === 'scheduled') return 'Saving'
  if (kind === 'saved') return 'Saved'
  return 'All changes saved'
}

function Preview({ draft, platform }: { draft: PostDraft; platform: 'x' | 'threads' }) {
  const counts = platform === 'x' ? 'x' : 'threads'
  return <section className="post-preview" aria-label={platform === 'x' ? 'X preview' : 'Threads preview'}>
    <h2>{platform === 'x' ? 'X' : 'Threads'}</h2>
    {draft.items.map((item, index) => <Card className="post-preview-card" key={item.id}>
      <p>{item.body || ' '}</p>
      {item.media.length > 0 && <div className="post-preview-media">
        {item.media.map((file) => <img key={file.id} alt={file.alt ?? ''} src={`/api/posts/${draft.id}/media/${file.id}`} />)}
      </div>}
      <small>{counts === 'x' ? 'X' : 'Threads'} post {index + 1}</small>
    </Card>)}
  </section>
}

function MediaList({
  draftId,
  item,
  readOnly,
  onChange,
}: {
  draftId: string
  item: PostItem
  readOnly: boolean
  onChange: (media: readonly PostMedia[]) => void
}) {
  const [message, setMessage] = useState('')

  async function add(files: FileList | null) {
    if (!files || readOnly) return
    setMessage('')
    let media = [...item.media]
    for (const file of [...files]) {
      try {
        const uploaded = await uploadPostMedia(draftId, item.id, file, {
          clientRequestId: crypto.randomUUID(),
          durationMs: await videoDurationMs(file),
          onProgress: () => undefined,
        })
        media = [...media, uploaded]
        onChange(media)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Upload failed.')
        break
      }
    }
  }

  function move(index: number, delta: number) {
    const next = [...item.media]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const current = next[index]
    const swap = next[target]
    if (!current || !swap) return
    next[index] = swap
    next[target] = current
    onChange(next.map((file, order) => ({ ...file, order })))
  }

  return <div className="post-media">
    <div className="post-media-list">
      {item.media.map((file, index) => <div className="post-media-item" key={file.id}>
        <img alt={file.alt ?? file.displayName} src={`/api/posts/${draftId}/media/${file.id}`} />
        <Label>Alt text<Input
          aria-label={`Alt text for ${file.displayName}`}
          disabled={readOnly}
          value={file.alt ?? ''}
          onChange={(event) => onChange(item.media.map((entry) => entry.id === file.id ? { ...entry, alt: event.target.value || null } : entry))}
        /></Label>
        {!readOnly && <div className="post-media-item-actions">
          <Button type="button" size="sm" variant="outline" onClick={() => move(index, -1)}>Up</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => move(index, 1)}>Down</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(item.media.filter((entry) => entry.id !== file.id))}>Remove</Button>
        </div>}
      </div>)}
    </div>
    {!readOnly && <Label className="upload-button">Add media
      <Input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" multiple onChange={(event) => { void add(event.target.files); event.target.value = '' }} />
    </Label>}
    {message && <p role="status">{message}</p>}
  </div>
}

export function PostsComposer({ loaded }: { loaded: PostDraft }) {
  const navigate = useNavigate()
  const { draft, status, replace, retry, loadLatest, report, canReady } = usePostsAutosave(loaded)
  const readOnly = draft.status === 'posted'
  const errors = report.issues.filter((issue) => issue.severity === 'error')
  const warnings = report.issues.filter((issue) => issue.severity === 'warning')

  function patch(next: Partial<PostDraft> | ((current: PostDraft) => PostDraft)) {
    replace(typeof next === 'function' ? next(draft) : { ...draft, ...next })
  }

  function patchItem(id: string, update: Partial<PostItem>) {
    patch({
      items: draft.items.map((item) => item.id === id ? { ...item, ...update } : item),
    })
  }

  async function ready() {
    const result = await markPostReady({ data: { id: draft.id, expectedRevision: draft.revision } })
    if (result.kind === 'ready') replace(result.draft)
    if (result.kind === 'conflict') loadLatest()
  }

  async function duplicate() {
    const copy = await duplicatePostDraft({ data: draft.id })
    if (copy) await navigate({ to: '/posts/$postId', params: { postId: copy.id } })
  }

  return <main className="posts-composer">
    <a href="/posts">← Posts</a>
    <header className="posts-composer-header">
      <div>
        <p className="eyebrow">Shared drafts</p>
        <h1>{draft.items[0]?.body.trim() || 'Untitled draft'}</h1>
        <p role="status" aria-live="polite">{saveLabel(status.kind)}</p>
      </div>
      <div className="posts-composer-actions">
        {readOnly
          ? <Button type="button" onClick={() => void duplicate()}>Duplicate as new draft</Button>
          : <Button type="button" disabled={!canReady} onClick={() => void ready()}>Mark ready</Button>}
      </div>
    </header>
    {status.kind === 'conflict' && <Alert><AlertDescription>This draft changed elsewhere. <Button type="button" variant="outline" onClick={loadLatest}>Load latest</Button></AlertDescription></Alert>}
    {status.kind === 'error' && <Alert><AlertDescription>{status.message} <Button type="button" variant="outline" onClick={retry}>Retry</Button></AlertDescription></Alert>}
    <fieldset className="post-targets" disabled={readOnly}>
      <legend>Target</legend>
      {(['x', 'threads', 'both'] as const).map((target) => <Label key={target}>
        <input type="radio" name="target" checked={draft.target === target} onChange={() => patch({ target })} value={target} />
        {target === 'x' ? 'X' : target === 'threads' ? 'Threads' : 'Both'}
      </Label>)}
    </fieldset>
    <Label className="post-premium">
      <input type="checkbox" checked={draft.xPremium} disabled={readOnly} onChange={(event) => patch({ xPremium: event.target.checked })} />
      Premium long post
    </Label>
    {draft.items.map((item, index) => <Card className="post-editor" key={item.id}>
      <header>
        <h2>Post {index + 1}</h2>
        {!readOnly && draft.items.length > 1 && <Button type="button" variant="ghost" onClick={() => patch({ items: draft.items.filter((entry) => entry.id !== item.id).map((entry, order) => ({ ...entry, order })) })}>Remove post</Button>}
      </header>
      <Label>Text
        <Textarea
          aria-label={`Post ${index + 1} text`}
          disabled={readOnly}
          value={item.body}
          onChange={(event) => patchItem(item.id, { body: event.target.value })}
        />
      </Label>
      <p className="post-counters">
        <span>X {report.x[index]?.used ?? 0}/{report.x[index]?.limit ?? 280}</span>
        <span>Threads {report.threads[index]?.used ?? 0}/{report.threads[index]?.limit ?? 500}</span>
      </p>
      <MediaList draftId={draft.id} item={item} readOnly={readOnly} onChange={(media) => patchItem(item.id, { media })} />
    </Card>)}
    {!readOnly && <Button type="button" variant="outline" onClick={() => patch({
      items: [...draft.items, { id: crypto.randomUUID(), order: draft.items.length, body: '', media: [] }],
    })}>Add post</Button>}
    {(errors.length > 0 || warnings.length > 0) && <ul className="post-issues">
      {errors.map((issue, index) => <li key={`e${index}`}>{issue.message} (post {issue.postIndex + 1})</li>)}
      {warnings.map((issue, index) => <li key={`w${index}`}>{issue.message} (post {issue.postIndex + 1})</li>)}
    </ul>}
    <div className="post-previews">
      {(draft.target === 'x' || draft.target === 'both') && <Preview draft={draft} platform="x" />}
      {(draft.target === 'threads' || draft.target === 'both') && <Preview draft={draft} platform="threads" />}
    </div>
  </main>
}

