import { Alert, AlertDescription } from '@yatb/ui/alert'
import { Badge } from '@yatb/ui/badge'
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@yatb/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@yatb/ui/dropdown-menu'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@yatb/ui/select'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ChevronDown, Clapperboard, LayoutGrid, List, Plus, Trash2 } from 'lucide-react'
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

  if (!board) return <a className="video-card-link" href={`/videos/${video.id}`}>
    <Card className="video-card">
      <strong>{video.title}</strong>
      <p>{video.production.format} · {video.production.promotion}</p>
      {video.publishDate && <small>Publish {video.publishDate}</small>}
      <Badge variant="secondary">{STATUS[video.status].label}</Badge>
    </Card>
  </a>

  return <Card className="video-card">
    <a href={`/videos/${video.id}`}><strong>{video.title}</strong></a>
    <p>{video.production.format} · {video.production.promotion}</p>
    {video.publishDate && <small>Publish {video.publishDate}</small>}
    <Label>
      Move to
      <Select value={video.status} onValueChange={(value) => void move(value as VideoSummary['status'])}>
        <SelectTrigger aria-label={`Move ${video.title} to status`}><SelectValue /></SelectTrigger>
        <SelectContent>{VIDEO_STATUSES.map((status) => <SelectItem key={status} value={status}>{STATUS[status].label}</SelectItem>)}</SelectContent>
      </Select>
    </Label>
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
      <Select value={config.status} onValueChange={(value) => update({ status: value as VideoListConfig['status'] })}><SelectTrigger aria-label="Status filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{VIDEO_STATUSES.map((status) => <SelectItem key={status} value={status}>{STATUS[status].label}</SelectItem>)}</SelectContent></Select>
      <Select value={config.format} onValueChange={(value) => update({ format: value as VideoListConfig['format'] })}><SelectTrigger aria-label="Format filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All formats</SelectItem><SelectItem value="short">Short</SelectItem><SelectItem value="long">Long</SelectItem></SelectContent></Select>
      <Select value={config.sort} onValueChange={(value) => update({ sort: value as VideoListConfig['sort'] })}><SelectTrigger aria-label="Sort videos"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="updated-desc">Recently updated</SelectItem><SelectItem value="publish-date-asc">Publish date</SelectItem><SelectItem value="title-asc">Title</SelectItem></SelectContent></Select>
      {config.layout === 'list' && <Select value={config.groupBy} onValueChange={(value) => update({ groupBy: value as 'none' | 'status' | 'format' })}><SelectTrigger aria-label="Group videos"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No grouping</SelectItem><SelectItem value="status">Group by status</SelectItem><SelectItem value="format">Group by format</SelectItem></SelectContent></Select>}
      <Button variant="outline" type="button" onClick={() => update({ layout: config.layout === 'list' ? 'board' : 'list' })}>
        {config.layout === 'list' ? <><LayoutGrid /> Board</> : <><List /> List</>}
      </Button>
      <Button variant="outline" type="button" onClick={() => setSavingView(true)}>Save view</Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" type="button">Saved views <ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="start">{savedViews.length === 0 ? <DropdownMenuItem disabled>No saved views</DropdownMenuItem> : savedViews.map((view) => <DropdownMenuItem key={view.id} onSelect={() => void navigate({ search: { ...view.config, page: 1 } })}>{view.name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
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
          <Label>Format<Select value={format} onValueChange={(value) => { const next = value as VideoFormat; setFormat(next); setPromotionName('organic') }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="short">Short</SelectItem><SelectItem value="long">Long</SelectItem></SelectContent></Select></Label>
          <Label>Promotion<Select value={promotionName} onValueChange={setPromotionName}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{legalPromotions(format).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Label>
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
