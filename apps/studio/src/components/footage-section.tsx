import { Download, FileVideo, Pencil, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, buttonVariants } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import { Progress } from '@yatb/ui/progress'
import { uploadFile, type UploadProgress } from '#/client/upload'
import type { MediaFile } from '#/domain/media'

type Pending = {
  id: string
  file: File
  progress: UploadProgress
  state: 'queued' | 'uploading' | 'failed'
  error?: string
  controller: AbortController
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? 'Media request failed.')
  return body
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.ceil(bytes / 1024)} KB`
}

export function FootageSection({ videoId, refreshToken = 0 }: { videoId: string; refreshToken?: number }) {
  const [files, setFiles] = useState<MediaFile[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [rename, setRename] = useState<{ fileId: string; value: string; pending: boolean; error?: string } | null>(null)
  const running = useRef(false)
  const queue = useRef<Pending[]>([])

  async function refresh() {
    setFiles(await json<MediaFile[]>(await fetch(`/api/videos/${videoId}/media`, { credentials: 'same-origin' })))
  }

  useEffect(() => { void refresh() }, [videoId, refreshToken])

  async function runQueue(items: Pending[]) {
    queue.current.push(...items)
    if (running.current) return
    running.current = true
    const worker = async () => {
      while (queue.current.length > 0) {
        const item = queue.current.shift()
        if (!item) return
        setPending((current) => current.map((entry) => entry.id === item.id ? { ...entry, state: 'uploading' } : entry))
        try {
          const file = await uploadFile(videoId, item.file, {
            clientRequestId: item.id,
            purpose: { kind: 'footage' },
            signal: item.controller.signal,
            onProgress: (progress) => setPending((current) => current.map((entry) => entry.id === item.id ? { ...entry, progress } : entry)),
          })
          if (file.kind !== 'footage') throw new Error('Footage upload returned an invalid result.')
          setFiles((current) => [file.file, ...current.filter((entry) => entry.id !== file.file.id)])
          setPending((current) => current.filter((entry) => entry.id !== item.id))
        } catch (error) {
          if (item.controller.signal.aborted) {
            setPending((current) => current.filter((entry) => entry.id !== item.id))
          } else {
            setPending((current) => current.map((entry) => entry.id === item.id
              ? { ...entry, state: 'failed', error: error instanceof Error ? error.message : 'Upload failed.' }
              : entry))
          }
        }
      }
    }
    await Promise.all([worker(), worker()])
    running.current = false
    if (queue.current.length > 0) void runQueue([])
  }

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = [...(event.target.files ?? [])].filter((file) => file.size > 0)
    const items = selected.map<Pending>((file) => ({
      id: crypto.randomUUID(), file, state: 'queued', controller: new AbortController(),
      progress: { sentBytes: 0, totalBytes: file.size, completedParts: 0, totalParts: 1 },
    }))
    setPending((current) => [...current, ...items])
    void runQueue(items)
    event.target.value = ''
  }

  async function saveRename(event: React.FormEvent<HTMLFormElement>, file: MediaFile) {
    event.preventDefault()
    if (!rename || rename.fileId !== file.id) return
    if (rename.value === file.displayName) return setRename(null)
    setRename({ ...rename, pending: true, error: undefined })
    try {
      const updated = await json<MediaFile>(await fetch(`/api/videos/${videoId}/media/${file.id}`, {
        method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: rename.value }),
      }))
      setFiles((current) => current.map((entry) => entry.id === updated.id ? updated : entry))
      setRename(null)
    } catch (error) {
      setRename({ ...rename, pending: false, error: error instanceof Error ? error.message : 'Rename failed.' })
    }
  }

  return (
    <section className="footage-section" aria-labelledby="footage-heading">
      <header>
        <div><p className="eyebrow">Original media</p><h2 id="footage-heading">Footage upload</h2></div>
        <Label className={buttonVariants({ className: 'upload-button' })}><Upload /> Add footage<Input className="sr-only" type="file" multiple disabled={pending.some((item) => item.state !== 'failed')} onChange={choose} /></Label>
      </header>
      {pending.length > 0 && <div className="upload-list" aria-label="Uploads">
        {pending.map((item) => {
          const percent = Math.round(item.progress.sentBytes / item.progress.totalBytes * 100)
          return <article key={item.id} className="upload-row">
            <div><strong>{item.file.name}</strong><small>{item.state === 'failed' ? item.error : `${percent}% · ${formatBytes(item.progress.sentBytes)} of ${formatBytes(item.progress.totalBytes)}`}</small></div>
            <Progress value={percent} aria-label={`${item.file.name} upload progress`} />
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label={`${item.state === 'failed' ? 'Retry' : 'Cancel'} ${item.file.name}`}
              onClick={() => {
                if (item.state !== 'failed') return item.controller.abort()
                setPending((current) => current.map((entry) => entry.id === item.id ? { ...entry, state: 'queued', error: undefined } : entry))
                void runQueue([item])
              }}
            >{item.state === 'failed' ? 'Retry' : <X />}</Button>
            {item.state === 'failed' && <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label={`Dismiss ${item.file.name}`}
              onClick={() => setPending((current) => current.filter((entry) => entry.id !== item.id))}
            ><X /></Button>}
          </article>
        })}
      </div>}
      {files.length === 0 && pending.length === 0
        ? <p className="footage-empty">Drop in camera originals, audio, screen recordings, and references.</p>
        : <div className="footage-grid">{files.map((file) => <Card key={file.id} className="footage-card gap-0 py-0 shadow-none">
          {file.contentType.startsWith('video/')
            ? <video controls preload="metadata" src={`/api/videos/${videoId}/media/${file.id}`} />
            : <div className="file-placeholder"><FileVideo size={24} /></div>}
          {rename?.fileId === file.id
            ? <form className="footage-rename" onSubmit={(event) => void saveRename(event, file)}>
              <Label>File name<Input
                aria-label={`New name for ${file.displayName}`}
                value={rename.value}
                onChange={(event) => setRename({ ...rename, value: event.target.value, error: undefined })}
                minLength={1}
                maxLength={240}
                disabled={rename.pending}
                required
                autoFocus
              /></Label>
              {rename.error && <small role="alert">{rename.error}</small>}
              <div><Button size="sm" type="submit" disabled={rename.pending}>{rename.pending ? 'Saving…' : 'Save filename'}</Button><Button size="sm" variant="outline" type="button" disabled={rename.pending} onClick={() => setRename(null)}>Cancel rename</Button></div>
            </form>
            : <>
              <div><strong>{file.displayName}</strong><small>{formatBytes(file.byteSize)}</small></div>
              <footer>
                <Button variant="ghost" size="sm" type="button" onClick={() => setRename({ fileId: file.id, value: file.displayName, pending: false })}><Pencil /> Rename</Button>
                <Button asChild variant="ghost" size="sm"><a href={`/api/videos/${videoId}/media/${file.id}?download=1`}><Download /> Download</a></Button>
              </footer>
            </>}
        </Card>)}</div>}
    </section>
  )
}
