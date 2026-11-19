import { MessageSquare } from 'lucide-react'
import { useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Textarea } from '@yatb/ui/textarea'
import { MAX_BODY_LENGTH, formatTimestamp, type ReviewAnchor } from '../../shared/domain.ts'
import { api } from '../api.ts'

export type ComposerHandle = Readonly<{ focus: () => void; markIn: () => void; markOut: () => void }>
type Props = Readonly<{ ref: Ref<ComposerHandle>; draftId: string; playheadMs: number; onFocusComposer: () => void; onPosted: () => Promise<void> }>
type Marks = Readonly<{ inMs: number | null; outMs: number | null }>

export function anchorFor(marks: Marks, nowMs: number): ReviewAnchor | undefined {
  const { inMs, outMs } = marks
  if (inMs !== null && outMs !== null) return outMs > inMs ? { kind: 'range', startMs: inMs, endMs: outMs } : undefined
  return { kind: 'point', atMs: inMs ?? nowMs }
}

export function Composer({ ref, draftId, playheadMs, onFocusComposer, onPosted }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [body, setBody] = useState('')
  const [frozenMs, setFrozenMs] = useState<number | null>(null)
  const [marks, setMarks] = useState<Marks>({ inMs: null, outMs: null })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const nowMs = frozenMs ?? playheadMs
  const anchor = anchorFor(marks, nowMs)
  const canSubmit = anchor !== undefined && body.trim().length > 0 && !saving

  useImperativeHandle(ref, () => ({
    focus: () => textarea.current?.focus(),
    markIn: () => setMarks((m) => ({ ...m, inMs: nowMs })),
    markOut: () => setMarks((m) => ({ ...m, outMs: nowMs })),
  }))

  async function submit() {
    if (!anchor || !canSubmit) return
    setSaving(true)
    setError('')
    try {
      await api.addComment(draftId, { anchor, body })
      setBody('')
      setFrozenMs(null)
      setMarks({ inMs: null, outMs: null })
      await onPosted()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Comment could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit() }
  }

  const label = anchor?.kind === 'range' ? `${formatTimestamp(anchor.startMs)}–${formatTimestamp(anchor.endMs)}` : formatTimestamp(anchor?.kind === 'point' ? anchor.atMs : nowMs)

  return <Card className="comment-composer">
    <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <div className="comment-anchor-controls">
        <output aria-label="Comment timestamp" className="comment-timestamp">{label}{frozenMs !== null && ' (paused)'}</output>
        <Button type="button" variant="outline" size="sm" onClick={() => setMarks((m) => ({ ...m, inMs: nowMs }))}>Set in{marks.inMs !== null && ` ${formatTimestamp(marks.inMs)}`}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setMarks((m) => ({ ...m, outMs: nowMs }))}>Set out{marks.outMs !== null && ` ${formatTimestamp(marks.outMs)}`}</Button>
        {(marks.inMs !== null || marks.outMs !== null) && <Button type="button" variant="ghost" size="sm" onClick={() => setMarks({ inMs: null, outMs: null })}>Clear</Button>}
      </div>
      <Textarea ref={textarea} aria-label="Review comment" placeholder="Leave a comment (Cmd/Ctrl+Enter to send)" value={body} maxLength={MAX_BODY_LENGTH}
        onChange={(event) => setBody(event.target.value)} onKeyDown={keyDown}
        onFocus={() => { onFocusComposer(); setFrozenMs(playheadMs) }}
        onBlur={() => { if (body.trim() === '') setFrozenMs(null) }} />
      {anchor === undefined && <p role="alert" className="review-error">Out must be after in.</p>}
      {error && <p role="alert" className="review-error">{error}</p>}
      <Button type="submit" disabled={!canSubmit}><MessageSquare /> {saving ? 'Saving…' : 'Add comment'}</Button>
    </form>
  </Card>
}
