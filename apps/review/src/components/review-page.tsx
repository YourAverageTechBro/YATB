import { Check, Copy } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription } from '@yatb/ui/alert'
import { Badge } from '@yatb/ui/badge'
import { Button } from '@yatb/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@yatb/ui/select'
import { commentThreads, anchorStartMs, type ReviewAnchor } from '../../shared/domain.ts'
import { setVersionInHash } from '../route.ts'
import { api } from '../api.ts'
import { usePolled } from '../use-polled.ts'
import { CommentCard } from './comment-card.tsx'
import { Composer, type ComposerHandle } from './composer.tsx'
import { ReviewPlayer, type PlayerHandle } from './review-player.tsx'

type Filter = 'unresolved' | 'all'
const FRAME_MS = 1000 / 30

function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="combobox"], [role="dialog"], [role="alertdialog"]') !== null
}

export function ReviewPage({ slug, version }: { slug: string; version?: number }) {
  const { data, error, refresh } = usePolled(useCallback(() => api.project(slug), [slug]), slug)
  const player = useRef<PlayerHandle>(null)
  const composer = useRef<ComposerHandle>(null)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [filter, setFilter] = useState<Filter>('unresolved')
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [firstLatest, setFirstLatest] = useState<number>()

  const latest = data?.drafts.at(-1)
  // Pin whatever was newest when the page opened so a polled newer draft never swaps the video mid-watch.
  if (firstLatest === undefined && latest) setFirstLatest(latest.version)
  const viewing = version ?? firstLatest
  const draft = data?.drafts.find((candidate) => candidate.version === viewing)

  const threads = useMemo(() => commentThreads(data?.comments.filter((c) => c.draftId === draft?.id) ?? []), [data, draft?.id])
  const markers = useMemo(() => threads.map(({ root }) => ({ commentId: root.id, anchor: root.anchor })), [threads])
  const visible = filter === 'all' ? threads : threads.filter(({ root }) => root.status !== 'resolved')
  // Claude replies on the version Thomas commented on, so unresolved threads from older versions follow him to the newer one.
  const carried = useMemo(() => (data?.drafts ?? []).filter((d) => viewing !== undefined && d.version < viewing).reverse()
    .map((d) => ({ draft: d, threads: commentThreads(data!.comments.filter((c) => c.draftId === d.id)).filter(({ root }) => root.status !== 'resolved') }))
    .filter((group) => group.threads.length > 0), [data, viewing])
  const openByDraft = useMemo(() => {
    const counts = new Map<string, number>()
    for (const comment of data?.comments ?? []) if (comment.status === 'open') counts.set(comment.draftId, (counts.get(comment.draftId) ?? 0) + 1)
    return counts
  }, [data])

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || isTyping(event.target)) return
      // A focused button treats Space as a click, so leave that to the button.
      if (event.key === ' ' && event.target instanceof Element && event.target.closest('button, a')) return
      const p = player.current
      if (!p) return
      switch (event.key.toLowerCase()) {
        case ' ': case 'k': p.togglePlayback(); break
        case 'arrowleft': p.seekBy(-5000); break
        case 'arrowright': p.seekBy(5000); break
        case 'j': if (p.isPaused()) p.seekBy(-FRAME_MS); break
        case 'l': if (p.isPaused()) p.seekBy(FRAME_MS); break
        case 'm': p.toggleMute(); break
        case 'f': p.toggleFullscreen(); break
        case 'c': composer.current?.focus(); break
        case 'i': composer.current?.markIn(); break
        case 'o': composer.current?.markOut(); break
        default: return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', keyDown)
    return () => window.removeEventListener('keydown', keyDown)
  }, [])

  async function copyPrompt() {
    if (!latest) return
    const prompt = `Read the open review feedback for ${slug} (latest draft v${latest.version}) with \`npm run review -- feedback ${slug}\` in ~/Developer/YATB and address every comment.`
    try { await navigator.clipboard.writeText(prompt); setCopied('copied') } catch { setCopied('failed') }
    setTimeout(() => setCopied('idle'), 2500)
  }

  const seek = (anchor: ReviewAnchor) => player.current?.seekTo(anchorStartMs(anchor))
  const onPlayhead = useCallback((ms: number) => setPlayheadMs(ms), [])

  if (!data) return <main className="review-home">{error ? <p role="alert" className="review-error">{error}</p> : <p className="review-muted">Loading…</p>}</main>

  return <main className="review-page">
    <header className="review-header">
      <div><a href="#/" className="review-muted">All reviews</a><h1>{data.project.title}</h1></div>
      <div className="review-header-actions">
        <Select value={String(viewing)} onValueChange={(value) => setVersionInHash(slug, Number(value))}>
          <SelectTrigger aria-label="Draft version" size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>{[...data.drafts].reverse().map((d) => <SelectItem key={d.id} value={String(d.version)}>v{d.version}{openByDraft.get(d.id) ? ` · ${openByDraft.get(d.id)} open` : ''}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void copyPrompt()}>{copied === 'copied' ? <Check /> : <Copy />} Copy prompt for Claude</Button>
        <span role="status" className="review-muted">{copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : ''}</span>
      </div>
    </header>
    {latest && viewing !== undefined && latest.version > viewing && <Alert className="review-notice" role="status">
      <AlertDescription>v{latest.version} is ready <Button size="sm" onClick={() => setVersionInHash(slug, latest.version)}>Switch to v{latest.version}</Button></AlertDescription>
    </Alert>}
    {!draft ? <p className="review-muted">{data.drafts.length === 0 ? 'No drafts yet.' : `Version ${viewing} does not exist.`}</p> : <div className="review-pane">
      <div className="review-player">
        <ReviewPlayer key={draft.id} ref={player} src={`/media/${draft.id}`} label={`${data.project.title} v${draft.version}`} markers={markers} onPlayheadChange={onPlayhead} />
      </div>
      <aside className="review-rail" aria-label={`Review v${draft.version}`}>
        {draft.note && <section className="review-note"><h2>What changed</h2><p className="review-body">{draft.note}</p></section>}
        <Composer key={draft.id} ref={composer} draftId={draft.id} playheadMs={playheadMs} onFocusComposer={() => player.current?.pause()} onPosted={refresh} />
        <section className="review-comments-content">
          <div className="review-comments-head">
            <h3>Comments <Badge variant="secondary">{visible.length}</Badge></h3>
            <Select value={filter} onValueChange={(value) => setFilter(value as Filter)}>
              <SelectTrigger aria-label="Filter comments" size="sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="unresolved">Unresolved</SelectItem><SelectItem value="all">All</SelectItem></SelectContent>
            </Select>
          </div>
          {visible.length === 0 ? <p className="review-muted">{threads.length === 0 ? 'No comments yet.' : 'Nothing unresolved.'}</p> : visible.map((thread) => <CommentCard key={thread.root.id} thread={thread} onSeek={seek} onChanged={refresh} />)}
        </section>
        {carried.map(({ draft: earlier, threads: earlierThreads }) => <section key={earlier.id} className="review-comments-content" aria-label={`Unresolved on v${earlier.version}`}>
          <h3 className="review-earlier-head">Unresolved on v{earlier.version} <Badge variant="secondary">{earlierThreads.length}</Badge></h3>
          <p className="review-muted">Timestamps refer to v{earlier.version}. Clicking one opens that version.</p>
          {earlierThreads.map((thread) => <CommentCard key={thread.root.id} thread={thread} onSeek={() => setVersionInHash(slug, earlier.version)} onChanged={refresh} />)}
        </section>)}
      </aside>
    </div>}
  </main>
}
