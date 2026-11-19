import { Maximize, Minimize, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Button } from '@yatb/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@yatb/ui/select'
import { Slider } from '@yatb/ui/slider'
import { formatTimestamp, type ReviewAnchor } from '../../shared/domain.ts'

export type TimelineMarker = Readonly<{ commentId: string; anchor: ReviewAnchor }>
export type PlayerHandle = Readonly<{
  seekTo: (milliseconds: number) => void
  seekBy: (milliseconds: number) => void
  pause: () => void
  togglePlayback: () => void
  toggleMute: () => void
  toggleFullscreen: () => void
  isPaused: () => boolean
}>
type Props = Readonly<{ src: string; label: string; markers: readonly TimelineMarker[]; onPlayheadChange: (milliseconds: number) => void }>
type Paint =
  | Readonly<{ kind: 'point'; atPercent: number; commentIds: readonly string[] }>
  | Readonly<{ kind: 'range'; startPercent: number; widthPercent: number; commentId: string }>
type Snapshot = Readonly<{ phase: 'loading' | 'ready' | 'failed'; paused: boolean; ended: boolean; currentMs: number; durationMs: number; muted: boolean; playbackRate: number }>
type PlayerStyle = CSSProperties & Readonly<{ '--review-video-aspect-ratio'?: number }>

export function clampMs(milliseconds: number, durationMs: number): number {
  if (!Number.isFinite(milliseconds) || !Number.isFinite(durationMs) || durationMs <= 0) return 0
  return Math.max(0, Math.min(durationMs, Math.round(milliseconds)))
}

export function buildTimelinePaint(markers: readonly TimelineMarker[], durationMs: number): Paint[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return []
  const ranges: Paint[] = []
  const points = new Map<number, string[]>()
  for (const { commentId, anchor } of markers) {
    if (anchor.kind === 'point') {
      const at = clampMs(anchor.atMs, durationMs)
      points.set(at, [...(points.get(at) ?? []), commentId])
    } else {
      const start = clampMs(anchor.startMs, durationMs)
      const end = clampMs(anchor.endMs, durationMs)
      ranges.push({ kind: 'range', startPercent: start / durationMs * 100, widthPercent: (end - start) / durationMs * 100, commentId })
    }
  }
  return [...ranges, ...[...points].sort(([a], [b]) => a - b).map(([at, commentIds]) => ({ kind: 'point' as const, atPercent: at / durationMs * 100, commentIds }))]
}

export const ReviewPlayer = forwardRef<PlayerHandle, Props>(function ReviewPlayer({ src, label, markers, onPlayheadChange }, ref) {
  const video = useRef<HTMLVideoElement>(null)
  const container = useRef<HTMLElement>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>({ phase: 'loading', paused: true, ended: false, currentMs: 0, durationMs: 0, muted: false, playbackRate: 1 })
  const [fullscreen, setFullscreen] = useState(false)
  const [notice, setNotice] = useState('')
  const [aspect, setAspect] = useState<number>()
  const { durationMs } = snapshot
  const paints = useMemo(() => buildTimelinePaint(markers, durationMs), [markers, durationMs])
  const disabled = snapshot.phase !== 'ready' || durationMs === 0
  const fullscreenAvailable = typeof document !== 'undefined' && document.fullscreenEnabled
  const playLabel = snapshot.ended ? 'Replay video' : snapshot.paused ? 'Play video' : 'Pause video'

  function synchronize() {
    const media = video.current
    if (!media) return
    const duration = Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : 0
    const currentMs = clampMs(media.currentTime * 1000, duration)
    setSnapshot({
      phase: media.error ? 'failed' : media.readyState >= 1 ? 'ready' : 'loading',
      paused: media.paused, ended: media.ended, currentMs, durationMs: duration, muted: media.muted, playbackRate: media.playbackRate,
    })
    onPlayheadChange(currentMs)
  }

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === container.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

  function seekTo(milliseconds: number) {
    const media = video.current
    if (!media || media.readyState < 1 || media.error) return
    media.currentTime = clampMs(milliseconds, Math.round(media.duration * 1000)) / 1000
    synchronize()
  }

  async function togglePlayback() {
    const media = video.current
    if (!media || media.readyState < 1) return
    setNotice('')
    if (!media.paused) return media.pause()
    if (media.ended) seekTo(0)
    try { await media.play() } catch { setNotice('Playback could not start. Try playing again.') }
  }

  function toggleMute() {
    if (video.current) video.current.muted = !video.current.muted
  }

  async function toggleFullscreen() {
    if (!fullscreenAvailable) return
    try {
      if (document.fullscreenElement === container.current) await document.exitFullscreen()
      else await container.current?.requestFullscreen()
    } catch { setNotice('Full screen is unavailable. Continue watching here.') }
  }

  useImperativeHandle(ref, () => ({
    seekTo,
    seekBy: (delta) => seekTo((video.current?.currentTime ?? 0) * 1000 + delta),
    pause: () => video.current?.pause(),
    togglePlayback: () => void togglePlayback(),
    toggleMute,
    toggleFullscreen: () => void toggleFullscreen(),
    isPaused: () => video.current?.paused ?? true,
  }))

  const style: PlayerStyle = aspect === undefined ? {} : { '--review-video-aspect-ratio': aspect }

  return <section className="custom-player" data-video-orientation={aspect !== undefined && aspect < 1 ? 'portrait' : 'landscape'} ref={container} style={style} aria-label={label}>
    <video ref={video} src={src} preload="metadata" playsInline tabIndex={-1} aria-label={label}
      onClick={() => void togglePlayback()}
      onLoadedMetadata={(event) => { const { videoWidth, videoHeight } = event.currentTarget; setAspect(videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : undefined); synchronize() }}
      onDurationChange={synchronize} onPlay={synchronize} onPause={synchronize} onEnded={synchronize} onTimeUpdate={synchronize}
      onVolumeChange={synchronize} onRateChange={synchronize} onError={synchronize} onEmptied={synchronize} />
    <div className="custom-player-controls">
      <div className="custom-player-timeline">
        <Slider min={0} max={durationMs || 1} step={100} value={[snapshot.currentMs]} disabled={disabled}
          aria-label="Seek video" aria-valuetext={`${formatTimestamp(snapshot.currentMs)} of ${formatTimestamp(durationMs)}`}
          onValueChange={([value]) => seekTo(value ?? 0)} />
        <div className="comment-marker-layer" aria-hidden="true">{paints.map((paint) => paint.kind === 'range'
          ? <span key={paint.commentId} className="comment-range-marker" style={{ left: `${paint.startPercent}%`, width: `${paint.widthPercent}%` }} />
          : <span key={paint.commentIds.join(':')} className="comment-point-marker" style={{ left: `${paint.atPercent}%`, width: Math.min(6, paint.commentIds.length + 1) }} />)}</div>
      </div>
      <div className="custom-player-control-row">
        <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={playLabel} title={playLabel} onClick={() => void togglePlayback()}>{snapshot.ended ? <RotateCcw aria-hidden="true" /> : snapshot.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}</Button>
        <output aria-label="Current playback time">{formatTimestamp(snapshot.currentMs)} / {formatTimestamp(durationMs)}</output>
        <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={snapshot.muted ? 'Unmute video' : 'Mute video'} onClick={toggleMute}>{snapshot.muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button>
        <Select value={String(snapshot.playbackRate)} disabled={disabled} onValueChange={(value) => { if (video.current) video.current.playbackRate = Number(value) }}><SelectTrigger aria-label="Playback speed" size="sm"><SelectValue /></SelectTrigger><SelectContent>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <SelectItem key={rate} value={String(rate)}>{rate}×</SelectItem>)}</SelectContent></Select>
        <Button type="button" variant="ghost" size="icon-sm" disabled={!fullscreenAvailable} aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}</Button>
      </div>
      {snapshot.phase === 'failed' && <p role="alert" className="custom-player-message">This video cannot be played.</p>}
      {notice && <p role="status" className="custom-player-message">{notice}</p>}
    </div>
  </section>
})
