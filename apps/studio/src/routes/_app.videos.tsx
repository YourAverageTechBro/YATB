import { Alert, AlertDescription } from '@yatb/ui/alert'
import { Badge } from '@yatb/ui/badge'
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@yatb/ui/dialog'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import { NativeSelect, NativeSelectOption } from '@yatb/ui/native-select'
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
import { createSavedView, createVideo, loadPlanning, moveVideoStatus, removeSavedView } from '#/server/videos.functions'

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
  loader: async ({ deps }) => ({ config: deps.config, page: deps.page, ...await loadPlanning({ data: deps }) }),
  component: Videos,
})

function production(format: VideoFormat, promotion: string): Production {
  return format === 'short'
    ? { format, promotion: promotion === 'advertisement' ? 'advertisement' : 'organic' }
    : { format, promotion: promotion === 'integration' ? 'integration' : 'organic' }
}

function VideoCard({ video, board = false }: { video: VideoSummary; board?: boolean }) {
  const router = useRouter()
  const [conflict, setConflict] = useState(false)

  async function move(status: VideoSummary['status']) {
    if (status === video.status) return
    const result = await moveVideoStatus({ data: { id: video.id, expectedRevision: video.revision, status } })
    setConflict(result.kind === 'conflict')
    await router.invalidate()
  }

  return <Card className="video-card">
    <a href={`/videos/${video.id}`}><strong>{video.title}</strong></a>
    <p>{video.production.format} · {video.production.promotion}</p>
    {video.publishDate && <small>Publish {video.publishDate}</small>}
    {board ? <Label>
      Move to
      <NativeSelect value={video.status} onChange={(event) => void move(event.target.value as VideoSummary['status'])}>
        {VIDEO_STATUSES.map((status) => <NativeSelectOption key={status} value={status}>{STATUS[status].label}</NativeSelectOption>)}
      </NativeSelect>
    </Label> : <Badge variant="secondary">{STATUS[video.status].label}</Badge>}
    {conflict && <Alert><AlertDescription>This video changed elsewhere. The latest version is now loaded.</AlertDescription></Alert>}
  </Card>
}

function Videos() {
  const { config, page, videos, savedViews, hasMore } = Route.useLoaderData()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [format, setFormat] = useState<VideoFormat>('short')
  const [promotionName, setPromotionName] = useState('organic')
  const [savingView, setSavingView] = useState(false)
  const [viewName, setViewName] = useState('')

  function update(next: Partial<VideoListConfig>) {
    const candidate = { ...config, ...next }
    const safe = parseListConfig(candidate.layout === 'board' ? { ...candidate, groupBy: 'status' } : candidate)
    void navigate({ search: { ...safe, page: 1 } })
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const video = await createVideo({ data: { title, production: production(format, promotionName), publishDate: null, script: emptyRichDocument() } })
    await navigate({ to: '/videos/$videoId', params: { videoId: video.id }, search: config })
  }

  async function saveCurrentView(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await createSavedView({ data: { name: viewName, config } })
    setSavingView(false)
    setViewName('')
    await router.invalidate()
  }

  async function deleteView(id: string) {
    await removeSavedView({ data: id })
    await router.invalidate()
  }

  const groups = groupVideos(videos, config)
  return <main className="workspace">
    <header className="workspace-header">
      <div><p className="eyebrow">Production</p><h1>Videos</h1></div>
      <Button type="button" onClick={() => setCreating(true)}><Plus /> New video</Button>
    </header>
    <section className="planning-toolbar" aria-label="Video view controls">
      <NativeSelect aria-label="Status filter" value={config.status} onChange={(event) => update({ status: event.target.value as VideoListConfig['status'] })}>
        <NativeSelectOption value="all">All statuses</NativeSelectOption>
        {VIDEO_STATUSES.map((status) => <NativeSelectOption key={status} value={status}>{STATUS[status].label}</NativeSelectOption>)}
      </NativeSelect>
      <NativeSelect aria-label="Format filter" value={config.format} onChange={(event) => update({ format: event.target.value as VideoListConfig['format'] })}>
        <NativeSelectOption value="all">All formats</NativeSelectOption><NativeSelectOption value="short">Short</NativeSelectOption><NativeSelectOption value="long">Long</NativeSelectOption>
      </NativeSelect>
      <NativeSelect aria-label="Sort videos" value={config.sort} onChange={(event) => update({ sort: event.target.value as VideoListConfig['sort'] })}>
        <NativeSelectOption value="updated-desc">Recently updated</NativeSelectOption><NativeSelectOption value="publish-date-asc">Publish date</NativeSelectOption><NativeSelectOption value="title-asc">Title</NativeSelectOption>
      </NativeSelect>
      {config.layout === 'list' && <NativeSelect aria-label="Group videos" value={config.groupBy} onChange={(event) => update({ groupBy: event.target.value as 'none' | 'status' | 'format' })}>
        <NativeSelectOption value="none">No grouping</NativeSelectOption><NativeSelectOption value="status">Group by status</NativeSelectOption><NativeSelectOption value="format">Group by format</NativeSelectOption>
      </NativeSelect>}
      <Button variant="outline" type="button" onClick={() => update({ layout: config.layout === 'list' ? 'board' : 'list' })}>
        {config.layout === 'list' ? <><LayoutGrid /> Board</> : <><List /> List</>}
      </Button>
      <Button variant="outline" type="button" onClick={() => setSavingView(true)}>Save view</Button>
      <NativeSelect aria-label="Saved views" value="" onChange={(event) => {
        const view = savedViews.find((entry) => entry.id === event.target.value)
        if (view) void navigate({ search: { ...view.config, page: 1 } })
      }}>
        <NativeSelectOption value="">Saved views</NativeSelectOption>
        {savedViews.map((view) => <NativeSelectOption key={view.id} value={view.id}>{view.name}</NativeSelectOption>)}
      </NativeSelect>
    </section>
    {savedViews.length > 0 && <div className="saved-views">
      {savedViews.map((view) => <Badge variant="outline" key={view.id}>{view.name}<Button variant="ghost" size="icon-xs" aria-label={`Delete ${view.name}`} type="button" onClick={() => void deleteView(view.id)}><Trash2 /></Button></Badge>)}
    </div>}
    {videos.length === 0 && page === 1 ? <section className="empty-state"><div className="empty-icon"><Clapperboard size={25} /></div><h2>No videos yet</h2><p>Your production schedule will live here.</p></section> : config.layout === 'board' ? <section className="board">{VIDEO_STATUSES.map((status) => <div className="board-column" key={status}><h2>{STATUS[status].label}</h2>{groups.get(status)?.map((video) => <VideoCard key={video.id} video={video} board />)}</div>)}</section> : <section className="video-list">{[...groups].map(([group, grouped]) => <div key={group}><h2>{group === 'all' ? 'All videos' : group in STATUS ? STATUS[group as keyof typeof STATUS].label : group}</h2>{grouped.map((video) => <VideoCard key={video.id} video={video} />)}</div>)}</section>}
    {(page > 1 || hasMore) && <nav className="pagination" aria-label="Video pages">
      <Button variant="outline" type="button" disabled={page === 1} onClick={() => void navigate({ search: { ...config, page: page - 1 } })}>Previous</Button>
      <span>Page {page}</span>
      <Button variant="outline" type="button" disabled={!hasMore} onClick={() => void navigate({ search: { ...config, page: page + 1 } })}>Next</Button>
    </nav>}
    <Dialog open={creating} onOpenChange={setCreating}>
      <DialogContent>
        <DialogHeader><DialogTitle>New video</DialogTitle><DialogDescription>Add a short or long video to the production schedule.</DialogDescription></DialogHeader>
        <form className="dialog-form" onSubmit={(event) => void submitCreate(event)}>
          <Label>Title<Input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} autoFocus /></Label>
          <Label>Format<NativeSelect value={format} onChange={(event) => { const next = event.target.value as VideoFormat; setFormat(next); setPromotionName('organic') }}><NativeSelectOption value="short">Short</NativeSelectOption><NativeSelectOption value="long">Long</NativeSelectOption></NativeSelect></Label>
          <Label>Promotion<NativeSelect value={promotionName} onChange={(event) => setPromotionName(event.target.value)}>{legalPromotions(format).map((item) => <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>)}</NativeSelect></Label>
          <DialogFooter><Button variant="outline" type="button" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit">Create</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={savingView} onOpenChange={setSavingView}>
      <DialogContent>
        <DialogHeader><DialogTitle>Save view</DialogTitle><DialogDescription>Keep this layout, filter, grouping, and sort configuration.</DialogDescription></DialogHeader>
        <form className="dialog-form" onSubmit={(event) => void saveCurrentView(event)}>
          <Label>View name<Input value={viewName} onChange={(event) => setViewName(event.target.value)} required maxLength={100} autoFocus /></Label>
          <DialogFooter><Button variant="outline" type="button" onClick={() => setSavingView(false)}>Cancel</Button><Button type="submit">Save view</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </main>
}
