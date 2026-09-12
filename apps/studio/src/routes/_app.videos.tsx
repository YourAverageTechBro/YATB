import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Clapperboard, LayoutGrid, List, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  DEFAULT_LIST_CONFIG,
  STATUS,
  VIDEO_STATUSES,
  groupVideos,
  legalPromotions,
  parseListConfig,
  parsePlanningQuery,
  type Production,
  type VideoFormat,
  type VideoListConfig,
  type VideoSummary,
} from '#/domain/videos'
import { emptyRichDocument } from '#/server/rich-document'
import {
  createSavedView,
  createVideo,
  loadPlanning,
  moveVideoStatus,
  removeSavedView,
} from '#/server/videos.functions'

function searchQuery(search: Record<string, unknown>) {
  try {
    return parsePlanningQuery({
      layout: search.layout ?? DEFAULT_LIST_CONFIG.layout,
      groupBy: search.groupBy ?? DEFAULT_LIST_CONFIG.groupBy,
      status: search.status ?? DEFAULT_LIST_CONFIG.status,
      format: search.format ?? DEFAULT_LIST_CONFIG.format,
      sort: search.sort ?? DEFAULT_LIST_CONFIG.sort,
      page: search.page ?? 1,
    })
  } catch {
    return { config: DEFAULT_LIST_CONFIG, page: 1 }
  }
}

export const Route = createFileRoute('/_app/videos')({
  loaderDeps: ({ search }) => searchQuery(search),
  loader: async ({ deps }) => ({
    config: deps.config,
    page: deps.page,
    ...await loadPlanning({ data: deps }),
  }),
  component: Videos,
})

function production(format: VideoFormat, promotion: string): Production {
  return format === 'short'
    ? { format, promotion: promotion === 'advertisement' ? 'advertisement' : 'organic' }
    : { format, promotion: promotion === 'integration' ? 'integration' : 'organic' }
}

function VideoCard({ video, board = false }: { video: VideoSummary; board?: boolean }) {
  const router = useRouter()

  async function move(status: VideoSummary['status']) {
    if (status === video.status) return
    const result = await moveVideoStatus({
      data: { id: video.id, expectedRevision: video.revision, status },
    })
    if (result.kind === 'conflict') {
      window.alert('This video changed elsewhere. Reloading the latest state.')
    }
    await router.invalidate()
  }

  return (
    <article className="video-card">
      <a href={`/videos/${video.id}`}><strong>{video.title}</strong></a>
      <p>{video.production.format} · {video.production.promotion}</p>
      {video.publishDate && <small>Publish {video.publishDate}</small>}
      {board ? (
        <label>
          Move to
          <select value={video.status} onChange={(event) => void move(event.target.value as VideoSummary['status'])}>
            {VIDEO_STATUSES.map((status) => <option key={status} value={status}>{STATUS[status].label}</option>)}
          </select>
        </label>
      ) : <small>{STATUS[video.status].label}</small>}
    </article>
  )
}

function Videos() {
  const { config, page, videos, savedViews, hasMore } = Route.useLoaderData()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [format, setFormat] = useState<VideoFormat>('short')
  const [promotionName, setPromotionName] = useState('organic')

  function update(next: Partial<VideoListConfig>) {
    const candidate = { ...config, ...next }
    const safe = parseListConfig(
      candidate.layout === 'board' ? { ...candidate, groupBy: 'status' } : candidate,
    )
    void navigate({ search: { ...safe, page: 1 } })
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const video = await createVideo({
      data: {
        title,
        production: production(format, promotionName),
        publishDate: null,
        script: emptyRichDocument(),
      },
    })
    await navigate({
      to: '/videos/$videoId',
      params: { videoId: video.id },
      search: config,
    })
  }

  async function saveCurrentView() {
    const name = window.prompt('Name this view')
    if (!name) return
    await createSavedView({ data: { name, config } })
    await router.invalidate()
  }

  async function deleteView(id: string) {
    await removeSavedView({ data: id })
    await router.invalidate()
  }

  const groups = groupVideos(videos, config)
  return (
    <main className="workspace">
      <header className="workspace-header">
        <div><p className="eyebrow">Production</p><h1>Videos</h1></div>
        <button className="primary-button" type="button" onClick={() => setCreating(true)}>
          <Plus size={17} /> New video
        </button>
      </header>
      <section className="planning-toolbar" aria-label="Video view controls">
        <select value={config.status} onChange={(event) => update({ status: event.target.value as VideoListConfig['status'] })}>
          <option value="all">All statuses</option>
          {VIDEO_STATUSES.map((status) => <option key={status} value={status}>{STATUS[status].label}</option>)}
        </select>
        <select value={config.format} onChange={(event) => update({ format: event.target.value as VideoListConfig['format'] })}>
          <option value="all">All formats</option><option value="short">Short</option><option value="long">Long</option>
        </select>
        <select value={config.sort} onChange={(event) => update({ sort: event.target.value as VideoListConfig['sort'] })}>
          <option value="updated-desc">Recently updated</option><option value="publish-date-asc">Publish date</option><option value="title-asc">Title</option>
        </select>
        {config.layout === 'list' && <select value={config.groupBy} onChange={(event) => update({ groupBy: event.target.value as 'none' | 'status' | 'format' })}>
          <option value="none">No grouping</option><option value="status">Group by status</option><option value="format">Group by format</option>
        </select>}
        <button type="button" onClick={() => update({ layout: config.layout === 'list' ? 'board' : 'list' })}>
          {config.layout === 'list' ? <><LayoutGrid size={15} /> Board</> : <><List size={15} /> List</>}
        </button>
        <button type="button" onClick={() => void saveCurrentView()}>Save view</button>
        <select value="" aria-label="Saved views" onChange={(event) => {
          const view = savedViews.find((entry) => entry.id === event.target.value)
          if (view) void navigate({ search: { ...view.config, page: 1 } })
        }}>
          <option value="">Saved views</option>
          {savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
        </select>
      </section>
      {savedViews.length > 0 && <div className="saved-views">
        {savedViews.map((view) => <span key={view.id}>{view.name}<button aria-label={`Delete ${view.name}`} type="button" onClick={() => void deleteView(view.id)}><Trash2 size={12} /></button></span>)}
      </div>}
      {creating && <form className="create-video" onSubmit={(event) => void submitCreate(event)}>
        <h2>New video</h2>
        <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} autoFocus /></label>
        <label>Format<select value={format} onChange={(event) => { const next = event.target.value as VideoFormat; setFormat(next); setPromotionName('organic') }}><option value="short">Short</option><option value="long">Long</option></select></label>
        <label>Promotion<select value={promotionName} onChange={(event) => setPromotionName(event.target.value)}>{legalPromotions(format).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <div><button className="primary-button" type="submit">Create</button><button type="button" onClick={() => setCreating(false)}>Cancel</button></div>
      </form>}
      {videos.length === 0 && page === 1 ? <section className="empty-state"><div className="empty-icon"><Clapperboard size={25} /></div><h2>No videos yet</h2><p>Your production schedule will live here.</p></section> : config.layout === 'board' ? <section className="board">{VIDEO_STATUSES.map((status) => <div className="board-column" key={status}><h2>{STATUS[status].label}</h2>{groups.get(status)?.map((video) => <VideoCard key={video.id} video={video} board />)}</div>)}</section> : <section className="video-list">{[...groups].map(([group, grouped]) => <div key={group}><h2>{group === 'all' ? 'All videos' : group in STATUS ? STATUS[group as keyof typeof STATUS].label : group}</h2>{grouped.map((video) => <VideoCard key={video.id} video={video} />)}</div>)}</section>}
      {(page > 1 || hasMore) && <nav className="pagination" aria-label="Video pages">
        <button type="button" disabled={page === 1} onClick={() => void navigate({ search: { ...config, page: page - 1 } })}>Previous</button>
        <span>Page {page}</span>
        <button type="button" disabled={!hasMore} onClick={() => void navigate({ search: { ...config, page: page + 1 } })}>Next</button>
      </nav>}
    </main>
  )
}
