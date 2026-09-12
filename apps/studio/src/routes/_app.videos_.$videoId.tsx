import { createFileRoute, notFound, useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@yatb/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@yatb/ui/alert-dialog'
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import { NativeSelect, NativeSelectOption } from '@yatb/ui/native-select'
import { FootageSection } from '#/components/footage-section'
import { RichEditor } from '#/components/rich-editor'
import {
  DEFAULT_LIST_CONFIG,
  STATUS,
  legalPromotions,
  type Production,
  type Video,
  type VideoFormat,
} from '#/domain/videos'
import { type RichDocument } from '#/server/rich-document'
import { loadVideo, removeVideo, saveVideo } from '#/server/videos.functions'

export const Route = createFileRoute('/_app/videos_/$videoId')({
  loader: async ({ params }) => {
    const video = await loadVideo({ data: params.videoId })
    if (!video) throw notFound()
    return video
  },
  component: VideoDetail,
})

function asProduction(format: VideoFormat, promotion: string): Production {
  return format === 'short'
    ? { format, promotion: promotion === 'advertisement' ? 'advertisement' : 'organic' }
    : { format, promotion: promotion === 'integration' ? 'integration' : 'organic' }
}

function VideoDetail() {
  const loaded = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const [video, setVideo] = useState(loaded)
  const [title, setTitle] = useState(loaded.title)
  const [format, setFormat] = useState<VideoFormat>(loaded.production.format)
  const [promotion, setPromotion] = useState(loaded.production.promotion)
  const [status, setStatus] = useState(loaded.status)
  const [publishDate, setPublishDate] = useState(loaded.publishDate ?? '')
  const [script, setScript] = useState<RichDocument>(loaded.script)
  const [conflict, setConflict] = useState<Video | null>(null)

  useEffect(() => {
    setVideo(loaded)
    setTitle(loaded.title)
    setFormat(loaded.production.format)
    setPromotion(loaded.production.promotion)
    setStatus(loaded.status)
    setPublishDate(loaded.publishDate ?? '')
    setScript(loaded.script)
    setConflict(null)
  }, [loaded])

  function loadLatest(latest: Video) {
    setVideo(latest)
    setTitle(latest.title)
    setFormat(latest.production.format)
    setPromotion(latest.production.promotion)
    setStatus(latest.status)
    setPublishDate(latest.publishDate ?? '')
    setScript(latest.script)
    setConflict(null)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await saveVideo({
      data: {
        id: video.id,
        expectedRevision: video.revision,
        title,
        production: asProduction(format, promotion),
        status,
        publishDate: publishDate || null,
        script,
      },
    })
    if (result.kind === 'saved') {
      loadLatest(result.video)
      await router.invalidate()
    }
    if (result.kind === 'conflict') setConflict(result.latest)
    if (result.kind === 'not-found') {
      await navigate({ to: '/videos', search: DEFAULT_LIST_CONFIG })
    }
  }

  async function erase() {
    const result = await removeVideo({
      data: { id: video.id, expectedRevision: video.revision },
    })
    if (result.kind === 'deleted' || result.kind === 'not-found') {
      await navigate({ to: '/videos', search: DEFAULT_LIST_CONFIG })
    }
    if (result.kind === 'conflict') setConflict(result.latest)
  }

  return (
    <main className="video-detail">
      <a href="/videos">← Videos</a>
      <header><p className="eyebrow">Production video</p><h1>{video.title}</h1></header>
      {conflict && <Alert className="conflict">
        <AlertTitle>This video changed in another session.</AlertTitle>
        <AlertDescription><Button variant="outline" size="sm" type="button" onClick={() => loadLatest(conflict)}>Load latest version</Button></AlertDescription>
      </Alert>}
      <Card className="video-form-card">
        <form onSubmit={(event) => void submit(event)}>
          <Label>Title<Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required /></Label>
          <div className="field-grid">
            <Label>Format<NativeSelect value={format} onChange={(event) => { const next = event.target.value as VideoFormat; setFormat(next); setPromotion('organic') }}><NativeSelectOption value="short">Short</NativeSelectOption><NativeSelectOption value="long">Long</NativeSelectOption></NativeSelect></Label>
            <Label>Promotion<NativeSelect value={promotion} onChange={(event) => setPromotion(event.target.value as typeof promotion)}>{legalPromotions(format).map((item) => <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>)}</NativeSelect></Label>
            <Label>Status<NativeSelect value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{Object.entries(STATUS).map(([key, item]) => <NativeSelectOption key={key} value={key}>{item.label}</NativeSelectOption>)}</NativeSelect></Label>
            <Label>Publish date<Input type="date" value={publishDate} onChange={(event) => setPublishDate(event.target.value)} /></Label>
          </div>
          <Label>Script<RichEditor value={script} onChange={setScript} /></Label>
          <footer>
            <Button type="submit">Save changes</Button>
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="destructive" type="button">Delete video</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>Delete {video.title}?</AlertDialogTitle><AlertDialogDescription>This hides the task immediately and schedules its footage for permanent removal.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void erase()}>Delete video</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </footer>
        </form>
      </Card>
      <FootageSection videoId={video.id} />
    </main>
  )
}
