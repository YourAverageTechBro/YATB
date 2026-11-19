import { useState, type KeyboardEvent } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@yatb/ui/alert-dialog'
import { Badge } from '@yatb/ui/badge'
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Textarea } from '@yatb/ui/textarea'
import { MAX_BODY_LENGTH, formatAnchor, nextStatuses, type Comment, type CommentStatus, type ReviewAnchor, type Thread } from '../../shared/domain.ts'
import { api } from '../api.ts'

type Props = Readonly<{ thread: Thread; onSeek: (anchor: ReviewAnchor) => void; onChanged: () => Promise<void> }>

// Claude moves open -> addressed through the CLI; the UI only offers Thomas's decisions.
const THOMAS_ACTIONS: Partial<Record<CommentStatus, string>> = { resolved: 'Resolve', open: 'Reopen' }

function submitOnModEnter(action: () => void) {
  return (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); action() }
  }
}

function TextForm({ label, initial, submitLabel, onSubmit, onCancel }: { label: string; initial: string; submitLabel: string; onSubmit: (text: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState(initial)
  const submit = () => { if (text.trim()) void onSubmit(text) }
  return <form onSubmit={(event) => { event.preventDefault(); submit() }}>
    <Textarea autoFocus aria-label={label} value={text} maxLength={MAX_BODY_LENGTH} onChange={(event) => setText(event.target.value)} onKeyDown={submitOnModEnter(submit)} />
    <footer><Button type="submit" size="sm" disabled={!text.trim()}>{submitLabel}</Button><Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button></footer>
  </form>
}

function Author({ comment }: { comment: Comment }) {
  return comment.author === 'claude' ? <Badge variant="secondary">Claude</Badge> : <strong>Thomas</strong>
}

export function CommentCard({ thread: { root, replies }, onSeek, onChanged }: Props) {
  const [mode, setMode] = useState<'view' | 'edit' | 'reply'>('view')
  const [editing, setEditing] = useState<Comment>()
  const [error, setError] = useState('')

  async function run(action: () => Promise<unknown>) {
    setError('')
    try { await action(); setMode('view'); setEditing(undefined); await onChanged() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Something went wrong.') }
  }

  const statusActions = nextStatuses(root.status).filter((status) => THOMAS_ACTIONS[status])

  return <Card className="review-comment" data-status={root.status}>
    <header>
      <div><Author comment={root} /><Badge variant={root.status === 'open' ? 'default' : 'outline'}>{root.status}</Badge></div>
      <Button variant="outline" size="sm" onClick={() => onSeek(root.anchor)} aria-label={`Seek to ${formatAnchor(root.anchor)}`}>{formatAnchor(root.anchor)}</Button>
    </header>
    {editing?.id === root.id
      ? <TextForm label="Edit comment" initial={root.body} submitLabel="Save" onSubmit={(text) => run(() => api.editComment(root.id, text))} onCancel={() => setEditing(undefined)} />
      : <p className="review-body">{root.body}</p>}
    {replies.map((reply) => <div key={reply.id} className="review-reply" data-author={reply.author}>
      <div className="review-reply-head"><Author comment={reply} />
        <span className="review-reply-actions">
          <Button variant="ghost" size="sm" onClick={() => setEditing(reply)}>Edit</Button>
          <DeleteButton label="reply" onConfirm={() => run(() => api.deleteComment(reply.id))} />
        </span>
      </div>
      {editing?.id === reply.id
        ? <TextForm label="Edit reply" initial={reply.body} submitLabel="Save" onSubmit={(text) => run(() => api.editComment(reply.id, text))} onCancel={() => setEditing(undefined)} />
        : <p className="review-body">{reply.body}</p>}
    </div>)}
    {error && <p role="alert" className="review-error">{error}</p>}
    {mode === 'reply'
      ? <TextForm label="Reply" initial="" submitLabel="Send reply" onSubmit={(text) => run(() => api.addComment(root.draftId, { parentId: root.id, anchor: root.anchor, body: text }))} onCancel={() => setMode('view')} />
      : <footer>
        {statusActions.map((status) => <Button key={status} variant={status === 'resolved' ? 'default' : 'outline'} size="sm" onClick={() => void run(() => api.setStatus(root.id, status))}>{THOMAS_ACTIONS[status]}</Button>)}
        <Button variant="ghost" size="sm" onClick={() => setMode('reply')}>Reply</Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(root)}>Edit</Button>
        <DeleteButton label="comment" onConfirm={() => run(() => api.deleteComment(root.id))} />
      </footer>}
  </Card>
}

function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  return <AlertDialog>
    <AlertDialogTrigger asChild><Button variant="ghost" size="sm">Delete</Button></AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Delete this {label}?</AlertDialogTitle><AlertDialogDescription>{label === 'comment' ? 'Its replies are deleted too.' : 'This cannot be undone.'}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={onConfirm}>Delete {label}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
