import { Upload, X } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@yatb/ui/alert'
import { Button, buttonVariants } from '@yatb/ui/button'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import { NativeSelect, NativeSelectOption } from '@yatb/ui/native-select'
import { Progress } from '@yatb/ui/progress'
import { uploadFile, type UploadProgress } from '#/client/upload'
import { type Draft } from '#/domain/reviews'
import { loadDrafts } from '#/server/reviews.functions'
import { ReviewPane } from './review-pane'

type DraftUpload = Readonly<{
  id: string
  name: string
  progress: UploadProgress
  state: 'reading' | 'uploading' | 'failed'
  error?: string
}>

function initialProgress(totalBytes: number): UploadProgress {
  return { sentBytes: 0, totalBytes, completedParts: 0, totalParts: 1 }
}

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

function durationMs(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const finish = () => URL.revokeObjectURL(url)
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const duration = Math.round(video.duration * 1000)
      finish()
      if (!Number.isSafeInteger(duration) || duration < 1) reject(new Error('The draft duration could not be read.'))
      else resolve(duration)
    }
    video.onerror = () => {
      finish()
      reject(new Error('This video cannot be played by your browser.'))
    }
    video.src = url
  })
}

export function ReviewWorkspace({ videoId, onFootageChanged }: { videoId: string; onFootageChanged: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [uploads, setUploads] = useState<DraftUpload[]>([])
  const [error, setError] = useState('')

  async function refresh(prefer?: string) {
    const next = await loadDrafts({ data: videoId })
    setDrafts(next)
    setSelectedId((current) => prefer ?? (next.some((draft) => draft.id === current) ? current : next[0]?.id ?? ''))
  }

  useEffect(() => { void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : 'Drafts could not be loaded.')) }, [videoId])

  async function chooseDrafts(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].filter((file) => file.size > 0)
    event.target.value = ''
    const items = files.map((file) => ({ id: crypto.randomUUID(), file }))
    setUploads((current) => [...current, ...items.map(({ id, file }) => ({ id, name: file.name, state: 'reading' as const, progress: initialProgress(file.size) }))])
    await mapConcurrent(items, async ({ id, file }) => {
      try {
        const duration = await durationMs(file)
        setUploads((current) => current.map((item) => item.id === id ? { ...item, state: 'uploading' } : item))
        const result = await uploadFile(videoId, file, {
          clientRequestId: id,
          purpose: { kind: 'draft', durationMs: duration },
          onProgress: (progress) => setUploads((current) => current.map((item) => item.id === id ? { ...item, progress } : item)),
        })
        if (result.kind !== 'draft') throw new Error('Draft upload returned an invalid result.')
        setUploads((current) => current.filter((item) => item.id !== id))
        await refresh(result.draft.id)
      } catch (reason) {
        setUploads((current) => current.map((item) => item.id === id
          ? { ...item, state: 'failed', error: reason instanceof Error ? reason.message : 'Draft upload failed.' }
          : item))
      }
    })
  }

  const selected = drafts.find((draft) => draft.id === selectedId) ?? null
  return <section className="review-workspace" aria-labelledby="review-heading">
    <header>
      <div><p className="eyebrow">Versioned review</p><h2 id="review-heading">Video drafts</h2></div>
      <Label className={buttonVariants()}><Upload /> Upload draft<Input className="sr-only" type="file" accept="video/mp4,video/webm,video/ogg" multiple onChange={(event) => void chooseDrafts(event)} /></Label>
    </header>
    {error && <Alert><AlertTitle>Review unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {uploads.length > 0 && <div className="upload-list" aria-label="Draft uploads">{uploads.map((upload) => {
      const percent = Math.round(upload.progress.sentBytes / upload.progress.totalBytes * 100)
      return <article className="upload-row" key={upload.id}>
        <div><strong>{upload.name}</strong><small>{upload.error ?? (upload.state === 'reading' ? 'Checking playback…' : `${percent}%`)}</small></div>
        <Progress value={percent} aria-label={`${upload.name} draft upload progress`} />
        {upload.state === 'failed' && <Button variant="ghost" size="icon-sm" aria-label={`Dismiss ${upload.name}`} onClick={() => setUploads((current) => current.filter((item) => item.id !== upload.id))}><X /></Button>}
      </article>
    })}</div>}
    {drafts.length === 0 && uploads.length === 0
      ? <p className="footage-empty">Upload the first edit to start a timestamped review.</p>
      : <>
        {selected && <div className="draft-selector"><Label>Draft version<NativeSelect value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{drafts.map((draft) => <NativeSelectOption key={draft.id} value={draft.id}>Version {draft.version} · {draft.file.displayName}</NativeSelectOption>)}</NativeSelect></Label><div className="draft-selector-actions"><small>{drafts.length} immutable {drafts.length === 1 ? 'version' : 'versions'} · newest first</small>{drafts.length >= 2 && <Link className={buttonVariants({ variant: 'outline' })} to="/videos/$videoId/compare" params={{ videoId }}>Compare versions</Link>}</div></div>}
        {selected && <ReviewPane key={selected.id} draft={selected} onFootageChanged={onFootageChanged} />}
      </>}
  </section>
}
