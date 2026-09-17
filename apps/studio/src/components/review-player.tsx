import { Maximize, Minimize, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Button } from '@yatb/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@yatb/ui/select'
import { Slider } from '@yatb/ui/slider'
import { formatTimestamp, type ReviewAnchor } from '#/domain/reviews'

export type ReviewTimelineMarker = Readonly<{ commentId: string; anchor: ReviewAnchor }>
export type ReviewPlayerHandle = Readonly<{ seekTo: (milliseconds: number) => void }>
type Props = Readonly<{
  src: string
  durationMs: number
  label: string
  markers: readonly ReviewTimelineMarker[]
  onPlayheadChange: (milliseconds: number) => void
}>
type TimelinePaint =
  | Readonly<{ kind: 'point'; atPercent: number; commentIds: readonly string[] }>
  | Readonly<{ kind: 'range'; startPercent: number; widthPercent: number; commentId: string }>
type PlayerSnapshot = Readonly<{
  phase: 'loading' | 'ready' | 'failed'
  paused: boolean
  ended: boolean
  currentMs: number
  volume: number
  muted: boolean
  playbackRate: number
}>
type PlayerStyle = CSSProperties & Readonly<{ '--review-video-aspect-ratio'?: number }>

export function intrinsicAspectRatio(width: number, height: number): number | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined
  return width / height
}

export function clampPlayheadMs(milliseconds: number, durationMs: number): number {
  if (!Number.isFinite(milliseconds) || !Number.isFinite(durationMs) || durationMs <= 0) return 0
  return Math.max(0, Math.min(durationMs, Math.round(milliseconds)))
}

export function buildTimelinePaint(markers: readonly ReviewTimelineMarker[], durationMs: number): TimelinePaint[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return []
  const ranges: TimelinePaint[] = []
  const points = new Map<number, string[]>()
  for (const { commentId, anchor } of markers) {
    if (anchor.kind === 'point') {
      if (!Number.isFinite(anchor.atMs)) continue
      const at = clampPlayheadMs(anchor.atMs, durationMs)
      const ids = points.get(at) ?? []
      ids.push(commentId)
      points.set(at, ids)
    } else {
      if (!Number.isFinite(anchor.startMs) || !Number.isFinite(anchor.endMs) || anchor.endMs <= anchor.startMs) continue
      const start = clampPlayheadMs(anchor.startMs, durationMs)
      const end = clampPlayheadMs(anchor.endMs, durationMs)
      ranges.push({ kind: 'range', startPercent: start / durationMs * 100, widthPercent: (end - start) / durationMs * 100, commentId })
    }
  }
  return [...ranges, ...[...points].sort(([left], [right]) => left - right).map(([at, commentIds]) => ({
    kind: 'point' as const, atPercent: at / durationMs * 100, commentIds,
  }))]
}

export const ReviewPlayer = forwardRef<ReviewPlayerHandle, Props>(function ReviewPlayer({ src, durationMs, label, markers, onPlayheadChange }, ref) {
  const video = useRef<HTMLVideoElement>(null)
  const container = useRef<HTMLElement>(null)
  const lastVolume = useRef(1)
  const descriptionId = useId()
  const [snapshot, setSnapshot] = useState<PlayerSnapshot>({ phase: 'loading', paused: true, ended: false, currentMs: 0, volume: 1, muted: false, playbackRate: 1 })
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false)
  const [notice, setNotice] = useState('')
  const [aspectRatio, setAspectRatio] = useState<number>()
  const paints = useMemo(() => buildTimelinePaint(markers, durationMs), [markers, durationMs])
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0
  const disabled = snapshot.phase !== 'ready' || duration === 0
  const silent = snapshot.muted || snapshot.volume === 0
  const playLabel = snapshot.ended ? 'Replay video' : snapshot.paused ? 'Play video' : 'Pause video'
  const muteLabel = silent ? 'Unmute video' : 'Mute video'
  const fullscreenLabel = !fullscreenAvailable ? 'Fullscreen unavailable' : fullscreen ? 'Exit full screen' : 'Enter full screen'

  function synchronize() {
    const media = video.current
    if (!media) return
    const currentMs = clampPlayheadMs(media.currentTime * 1000, duration)
    if (media.volume > 0) lastVolume.current = media.volume
    setSnapshot({
      phase: media.error ? 'failed' : media.readyState >= 1 ? 'ready' : 'loading',
      paused: media.paused, ended: media.ended, currentMs,
      volume: media.volume, muted: media.muted, playbackRate: media.playbackRate,
    })
    onPlayheadChange(currentMs)
  }

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === container.current)
    setFullscreenAvailable(Boolean(document.fullscreenEnabled && container.current?.requestFullscreen))
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

  useEffect(() => setAspectRatio(undefined), [src])

  function seekTo(milliseconds: number) {
    const media = video.current
    if (!media || media.readyState < 1 || media.error || duration === 0) return
    media.currentTime = clampPlayheadMs(milliseconds, duration) / 1000
    synchronize()
  }

  useImperativeHandle(ref, () => ({ seekTo }))

  async function togglePlayback() {
    const media = video.current
    if (!media || disabled) return
    setNotice('')
    if (!media.paused) return media.pause()
    if (media.ended) seekTo(0)
    try { await media.play() }
    catch { setNotice('Playback could not start. Try playing again.'); synchronize() }
  }

  function toggleMute() {
    const media = video.current
    if (!media || disabled) return
    if (media.muted || media.volume === 0) {
      if (media.volume === 0) media.volume = lastVolume.current
      media.muted = false
    } else media.muted = true
  }

  async function toggleFullscreen() {
    if (!fullscreenAvailable) return
    setNotice('')
    try {
      if (document.fullscreenElement === container.current) await document.exitFullscreen()
      else await container.current?.requestFullscreen()
    } catch { setNotice('Full screen is unavailable. Continue watching here.') }
  }

  function shortcut(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return
    if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [contenteditable="true"], [role="slider"], [role="combobox"]')) return
    switch (event.key.toLowerCase()) {
      case ' ': case 'k': void togglePlayback(); break
      case 'arrowleft': seekTo((video.current?.currentTime ?? 0) * 1000 - 5000); break
      case 'arrowright': seekTo((video.current?.currentTime ?? 0) * 1000 + 5000); break
      case 'm': toggleMute(); break
      case 'f': void toggleFullscreen(); break
      default: return
    }
    event.preventDefault()
  }

  const playerStyle: PlayerStyle = aspectRatio === undefined ? {} : { '--review-video-aspect-ratio': aspectRatio }

  return <section className="custom-player" ref={container} style={playerStyle} aria-label={label} tabIndex={0} onKeyDown={shortcut}>
    <video ref={video} src={src} preload="metadata" playsInline tabIndex={-1} aria-label={label}
      onClick={() => void togglePlayback()} onLoadedMetadata={(event) => { setAspectRatio(intrinsicAspectRatio(event.currentTarget.videoWidth, event.currentTarget.videoHeight)); synchronize() }} onDurationChange={synchronize}
      onPlay={synchronize} onPause={synchronize} onEnded={synchronize} onTimeUpdate={synchronize}
      onVolumeChange={synchronize} onRateChange={synchronize} onError={synchronize} onEmptied={synchronize} />
    <div className="custom-player-controls">
      <div className="custom-player-timeline">
        <Slider min={0} max={duration || 1} step={100} value={[snapshot.currentMs]} disabled={disabled}
          aria-label="Seek video" aria-valuetext={`${formatTimestamp(snapshot.currentMs)} of ${formatTimestamp(duration)}`}
          aria-describedby={descriptionId} onValueChange={([value]) => seekTo(value ?? 0)}
          onKeyDown={(event) => { if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key === 'Home' || event.key === 'End')) { event.preventDefault(); seekTo(event.key === 'Home' ? 0 : duration) } }} />
        <div className="comment-marker-layer" aria-hidden="true">{paints.map((paint) => paint.kind === 'range'
          ? <span key={paint.commentId} className="comment-range-marker" style={{ left: `${paint.startPercent}%`, width: `${paint.widthPercent}%` }} />
          : <span key={paint.commentIds.join(':')} className="comment-point-marker" style={{ left: `${paint.atPercent}%`, width: Math.min(6, paint.commentIds.length + 1) }} />)}</div>
      </div>
      <p id={descriptionId} className="sr-only">{markers.length === 0 ? 'No comments are marked on the timeline.' : `${markers.length} ${markers.length === 1 ? 'comment is' : 'comments are'} marked on the timeline. Use the timestamp buttons in the comments list to seek to each point or range start.`}</p>
      <div className="custom-player-control-row">
        <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={playLabel} title={playLabel} onClick={() => void togglePlayback()}>{snapshot.ended ? <RotateCcw aria-hidden="true" /> : snapshot.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}</Button>
        <output aria-label="Current playback time">{formatTimestamp(snapshot.currentMs)} / {formatTimestamp(duration)}</output>
        <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={muteLabel} title={muteLabel} onClick={toggleMute}>{silent ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button>
        <Slider className="custom-player-volume" min={0} max={1} step={0.05} value={[snapshot.volume]} disabled={disabled} aria-label="Volume" aria-valuetext={`${Math.round(snapshot.volume * 100)}%`} onValueChange={([value]) => { if (video.current && value !== undefined) { video.current.volume = value; if (value > 0) video.current.muted = false } }} />
        <Select value={String(snapshot.playbackRate)} disabled={disabled} onValueChange={(value) => { if (video.current) video.current.playbackRate = Number(value) }}><SelectTrigger aria-label="Playback speed" size="sm"><SelectValue /></SelectTrigger><SelectContent>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <SelectItem key={rate} value={String(rate)}>{rate}×</SelectItem>)}</SelectContent></Select>
        <Button type="button" variant="ghost" size="icon-sm" disabled={!fullscreenAvailable} aria-label={fullscreenLabel} title={fullscreenLabel} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}</Button>
      </div>
      <p className="comment-marker-legend"><span aria-hidden="true" className="comment-marker-key" /> Comments: ticks mark points, bars mark ranges.</p>
      {snapshot.phase === 'failed' && <p role="alert" className="custom-player-message">This video cannot be played.</p>}
      {notice && <p role="status" className="custom-player-message">{notice}</p>}
    </div>
  </section>
})
