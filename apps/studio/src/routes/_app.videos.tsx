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
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, LayoutGrid, List, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  DEFAULT_LIST_CONFIG,
  LAYOUT_CONFIG,
  STATUS,
  VIDEO_STATUSES,
  groupVideos,
  legalPromotions,
  parseListConfig,
  parsePlanningQuery,
  type Production,
  type VideoFormat,
  type VideoId,
  type VideoListConfig,
  type VideoStatus,
  type VideoSummary,
} from '#/domain/videos'
import { buildCalendarMonth, calendarMonthLabel, currentCalendarMonth, shiftCalendarMonth } from '#/domain/calendar'
import { emptyRichDocument } from '#/server/rich-document'
import { createSavedView, createVideo, loadPlanning, moveVideoStatus, removeSavedView } from '#/server/videos.functions'

const VIDEO_STATUS_CHIP_CLASS = {
  'not-started': 'video-status-chip--not-started',
  filming: 'video-status-chip--filming',
  'ready-to-edit': 'video-status-chip--ready-to-edit',
  'ready-to-review': 'video-status-chip--ready-to-review',
  published: 'video-status-chip--published',
} satisfies Record<VideoStatus, string>

function searchQuery(search: Record<string, unknown>) {
  try {
    return parsePlanningQuery({
      layout: search.layout ?? DEFAULT_LIST_CONFIG.layout,
      groupBy: search.groupBy ?? DEFAULT_LIST_CONFIG.groupBy,
      status: search.status ?? DEFAULT_LIST_CONFIG.status,
      format: search.format ?? DEFAULT_LIST_CONFIG.format,
      sort: search.sort ?? DEFAULT_LIST_CONFIG.sort,
      page: search.page ?? 1,
      month: search.month ?? currentCalendarMonth(),
    })
  } catch {
    return { config: DEFAULT_LIST_CONFIG, page: 1, month: currentCalendarMonth() }
  }
}

export const Route = createFileRoute('/_app/videos')({
  loaderDeps: ({ search }) => searchQuery(search),
  loader: async ({ deps }) => ({ ...deps, ...await loadPlanning({ data: deps }) }),
  component: Videos,
})

function production(
  format: VideoFormat,
  promotion: string,
  organicVideoId: VideoId | null,
): Production {
  return format === 'short'
    ? { format, promotion: promotion === 'advertisement' ? 'advertisement' : 'organic' }
    : promotion === 'integration'
      ? { format, promotion, organicVideoId }
      : { format, promotion: 'organic' }
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
      <Badge className={`video-status-chip ${VIDEO_STATUS_CHIP_CLASS[video.status]}`} variant="secondary">{STATUS[video.status].label}</Badge>
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

function CalendarVideoCard({ video }: { video: VideoSummary }) {
  return <a className="calendar-video-card" href={`/videos/${video.id}`} aria-label={`${video.title}, ${video.production.format}, ${video.production.promotion}, ${STATUS[video.status].label}, publish ${video.publishDate}`}>
    <strong title={video.title}>{video.title}</strong>
    <span>{video.production.format} · {video.production.promotion}</span>
    <Badge className={`video-status-chip ${VIDEO_STATUS_CHIP_CLASS[video.status]}`} variant="secondary">{STATUS[video.status].label}</Badge>
  </a>
}

function VideoCalendar({ month, videos }: { month: ReturnType<typeof currentCalendarMonth>; videos: readonly VideoSummary[] }) {
  const days = buildCalendarMonth(month, videos)
  return <>
    <div className="calendar-weekdays" aria-hidden="true">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div>
    <section className="video-calendar" aria-label={`${calendarMonthLabel(month)} calendar`}>
      {days.map((day) => <div className={`calendar-day${day.inMonth ? '' : ' calendar-day--outside'}`} key={day.date}>
        <time dateTime={day.date}>{day.day}</time>
        <div>{day.videos.map((video) => <CalendarVideoCard key={video.id} video={video} />)}</div>
      </div>)}
    </section>
    <section className="calendar-agenda" aria-label={`${calendarMonthLabel(month)} agenda`}>
      {days.filter((day) => day.inMonth && day.videos.length > 0).map((day) => <div className="agenda-day" key={day.date}>
        <time dateTime={day.date}>{new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.date}T00:00:00Z`))}</time>
        <div>{day.videos.map((video) => <CalendarVideoCard key={video.id} video={video} />)}</div>
      </div>)}
    </section>
  </>
}

function Videos() {
  const planning = Route.useLoaderData()
  const { config, page, month, videos, savedViews, organicVideoOptions } = planning
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [format, setFormat] = useState<VideoFormat>('short')
  const [promotionName, setPromotionName] = useState('organic')
  const [organicVideoId, setOrganicVideoId] = useState<VideoId | 'none'>('none')
  const [createError, setCreateError] = useState<string | null>(null)
  const [savingView, setSavingView] = useState(false)
  const [viewName, setViewName] = useState('')

  function updateFilters(next: { status?: VideoListConfig['status']; format?: VideoListConfig['format'] }) {
    void navigate({ search: { ...config, ...next, page: 1, month } })
  }

  function setLayout(layout: VideoListConfig['layout']) {
    void navigate({ search: { ...LAYOUT_CONFIG[layout](config), page: 1, month } })
  }

  function updateCollection(next: { groupBy?: 'none' | 'status' | 'format'; sort?: VideoListConfig['sort'] }) {
    if (config.layout === 'calendar') return
    const safe = parseListConfig({ ...config, ...next })
    void navigate({ search: { ...safe, page: 1, month } })
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await createVideo({
      data: {
        title,
        production: production(
          format,
          promotionName,
          organicVideoId === 'none' ? null : organicVideoId,
        ),
        publishDate: null,
        script: emptyRichDocument(),
      },
    })
    if (result.kind === 'invalid-link') {
      setCreateError(result.message)
      return
    }
    await navigate({ to: '/videos/$videoId', params: { videoId: result.video.id }, search: config })
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
      <Button type="button" onClick={() => { setCreateError(null); setCreating(true) }}><Plus /> New video</Button>
    </header>
    <section className="planning-toolbar" aria-label="Video view controls">
      <Select value={config.status} onValueChange={(value) => updateFilters({ status: value as VideoListConfig['status'] })}><SelectTrigger aria-label="Status filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{VIDEO_STATUSES.map((status) => <SelectItem key={status} value={status}>{STATUS[status].label}</SelectItem>)}</SelectContent></Select>
      <Select value={config.format} onValueChange={(value) => updateFilters({ format: value as VideoListConfig['format'] })}><SelectTrigger aria-label="Format filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All formats</SelectItem><SelectItem value="short">Short</SelectItem><SelectItem value="long">Long</SelectItem></SelectContent></Select>
      {config.layout !== 'calendar' && <Select value={config.sort} onValueChange={(value) => updateCollection({ sort: value as VideoListConfig['sort'] })}><SelectTrigger aria-label="Sort videos"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="updated-desc">Recently updated</SelectItem><SelectItem value="publish-date-asc">Publish date</SelectItem><SelectItem value="title-asc">Title</SelectItem></SelectContent></Select>}
      {config.layout === 'list' && <Select value={config.groupBy} onValueChange={(value) => updateCollection({ groupBy: value as 'none' | 'status' | 'format' })}><SelectTrigger aria-label="Group videos"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No grouping</SelectItem><SelectItem value="status">Group by status</SelectItem><SelectItem value="format">Group by format</SelectItem></SelectContent></Select>}
      <div className="layout-controls" role="group" aria-label="Video layout">
        <Button variant={config.layout === 'list' ? 'default' : 'outline'} type="button" aria-pressed={config.layout === 'list'} onClick={() => setLayout('list')}><List /> List</Button>
        <Button variant={config.layout === 'board' ? 'default' : 'outline'} type="button" aria-pressed={config.layout === 'board'} onClick={() => setLayout('board')}><LayoutGrid /> Board</Button>
        <Button variant={config.layout === 'calendar' ? 'default' : 'outline'} type="button" aria-pressed={config.layout === 'calendar'} onClick={() => setLayout('calendar')}><CalendarDays /> Calendar</Button>
      </div>
      <Button variant="outline" type="button" onClick={() => setSavingView(true)}>Save view</Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" type="button">Saved views <ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="start">{savedViews.length === 0 ? <DropdownMenuItem disabled>No saved views</DropdownMenuItem> : savedViews.map((view) => <DropdownMenuItem key={view.id} onSelect={() => void navigate({ search: { ...view.config, page: 1, month } })}>{view.name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    </section>
    {savedViews.length > 0 && <div className="saved-views">
      {savedViews.map((view) => <Badge variant="outline" key={view.id}>{view.name}<Button variant="ghost" size="icon-xs" aria-label={`Delete ${view.name}`} type="button" onClick={() => void deleteView(view.id)}><Trash2 /></Button></Badge>)}
    </div>}
    {config.layout === 'calendar' && <section className="calendar-shell">
      <header className="calendar-header"><h2>{calendarMonthLabel(month)}</h2><div><Button variant="outline" size="icon" aria-label="Previous month" onClick={() => void navigate({ search: { ...config, page: 1, month: shiftCalendarMonth(month, -1) } })}><ChevronLeft /></Button><Button variant="outline" onClick={() => void navigate({ search: { ...config, page: 1, month: currentCalendarMonth() } })}>Today</Button><Button variant="outline" size="icon" aria-label="Next month" onClick={() => void navigate({ search: { ...config, page: 1, month: shiftCalendarMonth(month, 1) } })}><ChevronRight /></Button></div></header>
      {videos.length === 0 ? <section className="empty-state calendar-empty"><div className="empty-icon"><CalendarDays size={25} /></div><h2>No scheduled videos</h2><p>No videos have a publish date in {calendarMonthLabel(month)}.</p></section> : <VideoCalendar month={month} videos={videos} />}
    </section>}
    {config.layout !== 'calendar' && (videos.length === 0 && page === 1 ? <section className="empty-state"><div className="empty-icon"><Clapperboard size={25} /></div><h2>No videos yet</h2><p>Your production schedule will live here.</p></section> : config.layout === 'board' ? <section className="board">{VIDEO_STATUSES.map((status) => <div className="board-column" key={status}><h2>{STATUS[status].label}</h2>{groups.get(status)?.map((video) => <VideoCard key={video.id} video={video} board />)}</div>)}</section> : <section className="video-list">{[...groups].map(([group, grouped]) => <div key={group}><h2>{group === 'all' ? 'All videos' : group in STATUS ? STATUS[group as keyof typeof STATUS].label : group}</h2>{grouped.map((video) => <VideoCard key={video.id} video={video} />)}</div>)}</section>)}
    {planning.kind === 'collection' && (page > 1 || planning.hasMore) && <nav className="pagination" aria-label="Video pages">
      <Button variant="outline" type="button" disabled={page === 1} onClick={() => void navigate({ search: { ...config, page: page - 1, month } })}>Previous</Button>
      <span>Page {page}</span>
      <Button variant="outline" type="button" disabled={!planning.hasMore} onClick={() => void navigate({ search: { ...config, page: page + 1, month } })}>Next</Button>
    </nav>}
    <Dialog open={creating} onOpenChange={setCreating}>
      <DialogContent>
        <DialogHeader><DialogTitle>New video</DialogTitle><DialogDescription>Add a short or long video to the production schedule.</DialogDescription></DialogHeader>
        <form className="dialog-form" onSubmit={(event) => void submitCreate(event)}>
          <Label>Title<Input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} autoFocus /></Label>
          {createError && <Alert><AlertDescription>{createError}</AlertDescription></Alert>}
          <Label>Format<Select value={format} onValueChange={(value) => { const next = value as VideoFormat; setFormat(next); setPromotionName('organic'); setOrganicVideoId('none'); setCreateError(null) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="short">Short</SelectItem><SelectItem value="long">Long</SelectItem></SelectContent></Select></Label>
          <Label>Promotion<Select value={promotionName} onValueChange={(value) => { setPromotionName(value); if (value !== 'integration') setOrganicVideoId('none'); setCreateError(null) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{legalPromotions(format).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Label>
          {format === 'long' && promotionName === 'integration' && <div className="linked-video-field">
            <Label>Organic video (optional)<Select value={organicVideoId} onValueChange={(value) => { setOrganicVideoId(value as VideoId | 'none'); setCreateError(null) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not linked</SelectItem>{organicVideoOptions.map((video) => <SelectItem key={video.id} value={video.id}>{video.title}</SelectItem>)}</SelectContent></Select></Label>
            <p className="field-help">Choose the organic long-form video that will carry this integration.</p>
            {organicVideoOptions.length === 0 && <p className="field-help">No organic long-form videos available.</p>}
          </div>}
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
