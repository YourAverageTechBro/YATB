import { Download, MessageSquare, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@yatb/ui/alert-dialog'
import { Badge } from '@yatb/ui/badge'
import { Button, buttonVariants } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import { ScrollArea } from '@yatb/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@yatb/ui/select'
import { uploadFile } from '#/client/upload'
import { anchorStartMs, formatTimestamp, type Draft, type ReviewAnchor, type ReviewComment } from '#/domain/reviews'
import { addComment, loadComments, removeComment, saveComment } from '#/server/reviews.functions'
import { emptyRichDocument, type RichDocument } from '#/server/rich-document'
import { RichDocumentView } from './rich-document-view'
import { RichEditor } from './rich-editor'
import { ReviewPlayer, type ReviewPlayerHandle } from './review-player'

type Attachment = Readonly<{ id: string; file: File }>

async function mapConcurrent<T, R>(items: readonly T[], action: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++
      const item = items[index]
      if (item !== undefined) results[index] = await action(item)
    }
  }
  await Promise.all([worker(), worker()])
  return results
}

function milliseconds(value: string): number {
  return Math.round(Number(value) * 1000)
}

export function ReviewPane({ draft, onFootageChanged }: { draft: Draft; onFootageChanged?: () => void }) {
  const draftMediaUrl = `/api/videos/${draft.videoId}/media/${draft.file.id}`
  const player = useRef<ReviewPlayerHandle>(null)
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [currentMs, setCurrentMs] = useState(0)
  const [kind, setKind] = useState<'point' | 'range'>('point')
  const [start, setStart] = useState('0')
  const [end, setEnd] = useState('0')
  const [body, setBody] = useState<RichDocument>(emptyRichDocument())
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [commentRequestId, setCommentRequestId] = useState(() => crypto.randomUUID())

  async function refresh() {
    setComments(await loadComments({ data: { videoId: draft.videoId, draftId: draft.id } }))
  }

  useEffect(() => { void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : 'Comments could not be loaded.')) }, [draft.id])

  const pointSeconds = (currentMs / 1000).toFixed(3)
  const markers = useMemo(() => comments.map(({ id, anchor }) => ({ commentId: id, anchor })), [comments])
  const anchor = useMemo<ReviewAnchor>(() => kind === 'point'
    ? { kind: 'point', atMs: currentMs }
    : { kind: 'range', startMs: milliseconds(start), endMs: milliseconds(end) }, [kind, currentMs, start, end])

  function seek(milliseconds: number) {
    player.current?.seekTo(milliseconds)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    setSaving(true)
    setError('')
    try {
      const files = await mapConcurrent(attachments, async (attachment) => {
        const result = await uploadFile(draft.videoId, attachment.file, {
          clientRequestId: attachment.id,
          purpose: { kind: 'footage' },
          onProgress: () => undefined,
        })
        if (result.kind !== 'footage') throw new Error('Attachment upload returned an invalid result.')
        return result.file
      })
      await addComment({ data: {
        clientRequestId: commentRequestId,
        videoId: draft.videoId,
        draftId: draft.id,
        anchor,
        body,
        attachmentIds: files.map((file) => file.id),
      } })
      if (files.length > 0) onFootageChanged?.()
      setBody(emptyRichDocument())
      setAttachments([])
      setCommentRequestId(crypto.randomUUID())
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Comment could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="review-pane">
    <div className="review-player">
      <ReviewPlayer ref={player} src={draftMediaUrl} durationMs={draft.durationMs} label={`Version ${draft.version}: ${draft.file.displayName}`} markers={markers} onPlayheadChange={setCurrentMs} />
      <div className="player-state">
        <Button asChild variant="outline" size="sm"><a href={`${draftMediaUrl}?download=1`} aria-label={`Download version ${draft.version}: ${draft.file.displayName}`}><Download /> Download</a></Button>
      </div>
    </div>
    <aside className="review-rail" aria-label={`Review version ${draft.version}`}>
      <Card className="comment-composer">
        <form onSubmit={(event) => void submit(event)}>
          <div className="comment-anchor-controls">
            <Label>Comment timing<Select value={kind} onValueChange={(value) => setKind(value as 'point' | 'range')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="point">Point</SelectItem><SelectItem value="range">Range</SelectItem></SelectContent></Select></Label>
            {kind === 'point'
              ? <Label>Timestamp<Input value={pointSeconds} readOnly /></Label>
              : <><Label>Start seconds<Input type="number" min="0" step="0.001" value={start} onChange={(event) => setStart(event.target.value)} required /></Label><Button variant="outline" type="button" onClick={() => setStart(pointSeconds)}>Use playhead</Button><Label>End seconds<Input type="number" min="0" step="0.001" value={end} onChange={(event) => setEnd(event.target.value)} required /></Label><Button variant="outline" type="button" onClick={() => setEnd(pointSeconds)}>Use playhead</Button></>}
          </div>
          <RichEditor ariaLabel="Review comment" value={body} onChange={setBody} />
          <Label className={buttonVariants({ variant: 'outline', className: 'upload-button' })}>Attach images or video<Input className="sr-only" type="file" accept="image/*,video/*" multiple onChange={(event) => { setAttachments([...(event.target.files ?? [])].slice(0, 12).map((file) => ({ id: crypto.randomUUID(), file }))); event.target.value = '' }} /></Label>
          {attachments.length > 0 && <ScrollArea className="attachment-selection-scroll" viewportProps={{ 'aria-label': 'Selected attachments', tabIndex: 0 }}><ul className="attachment-selection">{attachments.map((attachment) => <li key={attachment.id}><span>{attachment.file.name}</span><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${attachment.file.name}`} onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}><X /></Button></li>)}</ul></ScrollArea>}
          {error && <p role="alert" className="dialog-error">{error}</p>}
          <Button type="submit" disabled={saving}><MessageSquare /> {saving ? 'Saving…' : 'Add comment'}</Button>
        </form>
      </Card>
      <ScrollArea className="review-comments" viewportProps={{ 'aria-label': `Comments for version ${draft.version}`, tabIndex: 0 }}>
        <section className="review-comments-content">
          <h3>Comments <Badge variant="secondary">{comments.length}</Badge></h3>
          {comments.length === 0 ? <p className="footage-empty">No review notes yet.</p> : comments.map((comment) => <CommentCard key={comment.id} comment={comment} onSeek={seek} onChanged={refresh} />)}
        </section>
      </ScrollArea>
    </aside>
  </div>
}

function CommentCard({ comment, onSeek, onChanged }: { comment: ReviewComment; onSeek: (milliseconds: number) => void; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(comment.body)
  const [error, setError] = useState('')
  const label = comment.anchor.kind === 'point'
    ? formatTimestamp(comment.anchor.atMs)
    : `${formatTimestamp(comment.anchor.startMs)}–${formatTimestamp(comment.anchor.endMs)}`

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    try {
      await saveComment({ data: { videoId: comment.videoId, id: comment.id, expectedRevision: comment.revision, body } })
      setEditing(false)
      await onChanged()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Comment could not be updated.') }
  }

  async function erase() {
    try {
      await removeComment({ data: { videoId: comment.videoId, id: comment.id, expectedRevision: comment.revision } })
      await onChanged()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Comment could not be deleted.') }
  }

  return <Card className="review-comment">
    <header><div><strong>{comment.author.name}</strong><small>{comment.author.email}</small></div><Button variant="outline" size="sm" onClick={() => onSeek(anchorStartMs(comment.anchor))}>{label}</Button></header>
    {editing
      ? <form onSubmit={(event) => void save(event)}><RichEditor ariaLabel="Edit review comment" value={body} onChange={setBody} /><footer><Button type="submit">Save comment</Button><Button type="button" variant="outline" onClick={() => { setBody(comment.body); setEditing(false) }}>Cancel</Button></footer></form>
      : <RichDocumentView value={comment.body} />}
    {comment.attachments.length > 0 && <div className="comment-attachments">{comment.attachments.map((attachment) => attachment.contentType.startsWith('image/')
      ? <a key={attachment.id} href={`/api/videos/${comment.videoId}/media/${attachment.id}`} target="_blank" rel="noreferrer"><img src={`/api/videos/${comment.videoId}/media/${attachment.id}`} alt={attachment.displayName} /></a>
      : <video key={attachment.id} controls preload="metadata" src={`/api/videos/${comment.videoId}/media/${attachment.id}`} />)}</div>}
    {error && <p role="alert" className="dialog-error">{error}</p>}
    {!editing && <footer><Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit comment</Button><AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="sm">Delete comment</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this comment?</AlertDialogTitle><AlertDialogDescription>The uploaded attachment files remain available in task footage.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void erase()}>Delete comment</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></footer>}
  </Card>
}
