import { createFileRoute, notFound, useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
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
    if (!window.confirm('Delete this video?')) return
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
      {conflict && <aside className="conflict">
        <strong>This video changed in another session.</strong>
        <button type="button" onClick={() => loadLatest(conflict)}>Load latest version</button>
      </aside>}
      <form onSubmit={(event) => void submit(event)}>
        <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required /></label>
        <div className="field-grid">
          <label>Format<select value={format} onChange={(event) => { const next = event.target.value as VideoFormat; setFormat(next); setPromotion('organic') }}><option value="short">Short</option><option value="long">Long</option></select></label>
          <label>Promotion<select value={promotion} onChange={(event) => setPromotion(event.target.value as typeof promotion)}>{legalPromotions(format).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{Object.entries(STATUS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
          <label>Publish date<input type="date" value={publishDate} onChange={(event) => setPublishDate(event.target.value)} /></label>
        </div>
        <label>Script<RichEditor value={script} onChange={setScript} /></label>
        <footer><button className="primary-button" type="submit">Save changes</button><button className="danger-button" type="button" onClick={() => void erase()}>Delete video</button></footer>
      </form>
    </main>
  )
}
