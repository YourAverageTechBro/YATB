import { MessageSquare } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@yatb/ui/badge'
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import { ScrollArea } from '@yatb/ui/scroll-area'
import { ThemeControl } from '#/components/theme-control'
import { ReviewPlayer, type ReviewPlayerHandle } from '#/components/review-player'
import { RichDocumentView } from '#/components/rich-document-view'
import {
  commentSeekMs,
  commentThreads,
  formatTimestamp,
  guestReviewPlaybackSrc,
  parseGuestIdentity,
  type Draft,
  type GuestIdentity,
  type ReviewComment,
} from '#/domain/reviews'
import { streamStatusLabel } from '#/domain/stream'
import { addGuestComment, loadSharedReview } from '#/server/reviews.functions'

const STORAGE_KEY = 'yatb-studio-guest-review'

type SharedReviewData = Awaited<ReturnType<typeof loadSharedReview>>

function readStoredIdentity(): GuestIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? parseGuestIdentity(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function rememberIdentity(identity: GuestIdentity) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
  document.cookie = `${STORAGE_KEY}=1; Path=/; Max-Age=31536000; SameSite=Lax`
}

export function GuestReviewPage({ token, data }: { token: string; data: SharedReviewData }) {
  if (!data.available) {
    return <main className="shared-file-page guest-review-page">
      <header><a className="wordmark shared-file-brand" href="/"><span>YATB</span> Studio</a><ThemeControl /></header>
      <Card className="shared-file-card">
        <p className="eyebrow">Guest review</p>
        <h1>Link no longer available</h1>
        <p className="shared-file-context">This guest review link was revoked or is not valid.</p>
      </Card>
    </main>
  }
  return <GuestReviewWorkspace token={token} videoTitle={data.videoTitle} draft={data.draft} initialComments={data.comments} />
}

function GuestReviewWorkspace({
  token,
  videoTitle,
  draft,
  initialComments,
}: {
  token: string
  videoTitle: string
  draft: Draft
  initialComments: readonly ReviewComment[]
}) {
  const player = useRef<ReviewPlayerHandle>(null)
  const playerSrc = guestReviewPlaybackSrc(token, draft)
  const [comments, setComments] = useState(initialComments)
  const [currentMs, setCurrentMs] = useState(0)
  const [identity, setIdentity] = useState<GuestIdentity | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [replyFor, setReplyFor] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())

  useEffect(() => {
    const stored = readStoredIdentity()
    if (stored) {
      setIdentity(stored)
      setEmail(stored.email)
      setName(stored.name ?? '')
    }
  }, [])

  async function refresh() {
    const next = await loadSharedReview({ data: token })
    if (!next.available) {
      setError('This review link is no longer available.')
      setComments([])
      return
    }
    setComments(next.comments)
  }

  const threads = useMemo(() => commentThreads(comments), [comments])
  const markers = useMemo(() => comments.map(({ id, anchor }) => ({ commentId: id, anchor })), [comments])

  async function saveIdentity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const next = parseGuestIdentity({ email, name })
      rememberIdentity(next)
      setIdentity(next)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Enter a valid email.')
    }
  }

  async function submit(parentId: string | null, body: string) {
    if (!identity) {
      setError('Enter an email before commenting.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await addGuestComment({ data: {
        clientRequestId: requestId,
        token,
        parentId,
        anchor: { kind: 'point', atMs: currentMs },
        text: body,
        identity,
      } })
      setRequestId(crypto.randomUUID())
      if (parentId) { setReplyText(''); setReplyFor(null) }
      else setText('')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Comment could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return <main className="shared-file-page guest-review-page">
    <header><a className="wordmark shared-file-brand" href="/"><span>YATB</span> Studio</a><ThemeControl /></header>
    <Card className="shared-file-card">
      <p className="eyebrow">Guest review</p>
      <h1>{videoTitle}</h1>
      <p className="shared-file-context">Draft version {draft.version} · {draft.file.displayName}</p>
      <div className="review-pane guest-review-pane">
        <div className="review-player">
          <ReviewPlayer
            ref={player}
            src={playerSrc}
            durationMs={draft.durationMs}
            label={`Version ${draft.version}: ${draft.file.displayName}`}
            markers={markers}
            onPlayheadChange={setCurrentMs}
          />
          <p role="status" className="stream-status">{streamStatusLabel(draft.stream.state)}</p>
        </div>
        <aside className="review-rail" aria-label={`Guest review version ${draft.version}`}>
          <Card className="comment-composer">
            {!identity
              ? <form onSubmit={(event) => void saveIdentity(event)}>
                <p>Enter an email before commenting. Name is optional.</p>
                <Label>Email<Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></Label>
                <Label>Name<Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></Label>
                {error && <p role="alert" className="dialog-error">{error}</p>}
                <Button type="submit">Continue as guest</Button>
              </form>
              : <form onSubmit={(event) => { event.preventDefault(); void submit(null, text) }}>
                <p className="shared-file-context">Commenting as {identity.name ? `${identity.name} · ` : ''}{identity.email}</p>
                <Label>Timestamp<Input value={(currentMs / 1000).toFixed(3)} readOnly /></Label>
                <Label>Review comment<textarea className="guest-comment-input" value={text} onChange={(event) => setText(event.target.value)} required maxLength={4000} /></Label>
                {error && <p role="alert" className="dialog-error">{error}</p>}
                <Button type="submit" disabled={saving}><MessageSquare /> {saving ? 'Saving…' : 'Add comment'}</Button>
              </form>}
          </Card>
          <ScrollArea className="review-comments" viewportProps={{ 'aria-label': `Comments for version ${draft.version}`, tabIndex: 0 }}>
            <section className="review-comments-content">
              <h3>Comments <Badge variant="secondary">{comments.length}</Badge></h3>
              {threads.length === 0 ? <p className="footage-empty">No review notes yet.</p> : threads.map(({ root, replies }) => (
                <GuestThread
                  key={root.id}
                  comment={root}
                  replies={replies}
                  onSeek={(anchor) => player.current?.seekTo(commentSeekMs(anchor, draft.durationMs))}
                  replyOpen={replyFor === root.id}
                  replyText={replyText}
                  onReplyOpen={() => { setReplyFor(root.id); setReplyText('') }}
                  onReplyText={setReplyText}
                  onReply={() => void submit(root.id, replyText)}
                  canReply={Boolean(identity)}
                  saving={saving}
                />
              ))}
            </section>
          </ScrollArea>
        </aside>
      </div>
    </Card>
  </main>
}

function GuestThread({
  comment,
  replies,
  onSeek,
  replyOpen,
  replyText,
  onReplyOpen,
  onReplyText,
  onReply,
  canReply,
  saving,
}: {
  comment: ReviewComment
  replies: readonly ReviewComment[]
  onSeek: (anchor: ReviewComment['anchor']) => void
  replyOpen: boolean
  replyText: string
  onReplyOpen: () => void
  onReplyText: (value: string) => void
  onReply: () => void
  canReply: boolean
  saving: boolean
}) {
  return <Card className="review-comment">
    <GuestCommentBody comment={comment} onSeek={() => onSeek(comment.anchor)} />
    {replies.map((reply) => <div key={reply.id} className="guest-reply"><GuestCommentBody comment={reply} onSeek={() => onSeek(reply.anchor)} /></div>)}
    {canReply && (replyOpen
      ? <form onSubmit={(event) => { event.preventDefault(); onReply() }}>
        <Label>Reply<textarea className="guest-comment-input" value={replyText} onChange={(event) => onReplyText(event.target.value)} required maxLength={4000} /></Label>
        <Button type="submit" disabled={saving}>Add reply</Button>
      </form>
      : <Button variant="ghost" size="sm" onClick={onReplyOpen}>Reply</Button>)}
  </Card>
}

function GuestCommentBody({ comment, onSeek }: { comment: ReviewComment; onSeek: () => void }) {
  const label = comment.anchor.kind === 'point'
    ? formatTimestamp(comment.anchor.atMs)
    : `${formatTimestamp(comment.anchor.startMs)}–${formatTimestamp(comment.anchor.endMs)}`
  return <>
    <header>
      <div>
        <strong>{comment.author.name}</strong>
        {comment.author.guest && <Badge variant="secondary">Guest</Badge>}
        <small>{comment.author.email}</small>
      </div>
      <Button variant="outline" size="sm" onClick={onSeek}>{label}</Button>
    </header>
    <RichDocumentView value={comment.body} />
  </>
}
