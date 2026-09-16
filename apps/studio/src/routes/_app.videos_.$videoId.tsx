import { createFileRoute, Link, notFound, useBlocker, useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@yatb/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@yatb/ui/alert-dialog'
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@yatb/ui/select'
import { FootageSection } from '#/components/footage-section'
import { RichEditor } from '#/components/rich-editor'
import { ReviewWorkspace } from '#/components/review-workspace'
import { useVideoAutosave } from '#/components/use-video-autosave'
import {
  DEFAULT_LIST_CONFIG,
  STATUS,
  legalPromotions,
  type OrganicVideoOption,
  type Production,
  type Video,
  type VideoFormat,
  type VideoId,
} from '#/domain/videos'
import { loadVideo } from '#/server/videos.functions'

export const Route = createFileRoute('/_app/videos_/$videoId')({
  loader: async ({ params }) => {
    const result = await loadVideo({ data: params.videoId })
    if (!result.video) throw notFound()
    return { video: result.video, organicVideoOptions: result.organicVideoOptions }
  },
  component: VideoDetail,
})

function asProduction(
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

function VideoDetail() {
  const { video: loaded, organicVideoOptions } = Route.useLoaderData()
  return <VideoEditor key={loaded.id} loaded={loaded} organicVideoOptions={organicVideoOptions} />
}

function VideoEditor({ loaded, organicVideoOptions }: { loaded: Video; organicVideoOptions: OrganicVideoOption[] }) {
  const navigate = useNavigate()
  const { video, draft, status: saveStatus, deleting, edit, retry, loadLatest, flush, erase } = useVideoAutosave(loaded)
  const { title, production, status, publishDate, script } = draft
  const { format, promotion } = production
  const organicVideoId = production.promotion === 'integration' ? production.organicVideoId ?? 'none' : 'none'
  const [footageRevision, setFootageRevision] = useState(0)
  const needsSave = saveStatus.kind !== 'clean' && saveStatus.kind !== 'saved'
  const saveBeforeNavigation = useCallback(async () => !(await flush()), [flush])

  useBlocker({
    shouldBlockFn: saveBeforeNavigation,
    enableBeforeUnload: needsSave,
    disabled: !needsSave || deleting,
  })

  const persistedOrganicVideoId = video.production.promotion === 'integration'
    ? video.production.organicVideoId
    : null

  async function deleteVideo() {
    if (await erase()) {
      await navigate({ to: '/videos', search: DEFAULT_LIST_CONFIG })
    }
  }

  return (
    <main className="video-detail">
      <Link to="/videos" search={DEFAULT_LIST_CONFIG}>← Videos</Link>
      <header className="video-detail-heading">
        <div><p className="eyebrow">Production video</p><h1>{video.title}</h1></div>
        <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="destructive" type="button" disabled={deleting}>Delete video</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Delete {video.title}?</AlertDialogTitle><AlertDialogDescription>This hides the task immediately and schedules its footage for permanent removal.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void deleteVideo()}>Delete video</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </header>
      {saveStatus.kind === 'conflict' && <Alert className="conflict">
        <AlertTitle>This video changed in another session.</AlertTitle>
        <AlertDescription><Button variant="outline" size="sm" type="button" onClick={loadLatest}>Load latest version</Button></AlertDescription>
      </Alert>}
      <Card className="video-form-card">
        <div className="video-edit-fields" aria-busy={deleting} inert={deleting}>
          <Label>Title<Input value={title} onChange={(event) => edit({ title: event.target.value })} maxLength={200} required aria-invalid={!title.trim()} aria-describedby="video-save-status" disabled={deleting} /></Label>
          <div className="field-grid">
            <Label>Format<Select value={format} disabled={deleting} onValueChange={(value) => edit({ production: asProduction(value as VideoFormat, 'organic', null) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="short">Short</SelectItem><SelectItem value="long">Long</SelectItem></SelectContent></Select></Label>
            <Label>Promotion<Select value={promotion} disabled={deleting} onValueChange={(value) => edit({ production: asProduction(format, value, null) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{legalPromotions(format).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Label>
            <Label>Status<Select value={status} disabled={deleting} onValueChange={(value) => edit({ status: value as typeof status })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATUS).map(([key, item]) => <SelectItem key={key} value={key}>{item.label}</SelectItem>)}</SelectContent></Select></Label>
            <Label>Publish date<Input type="date" value={publishDate} disabled={deleting} onChange={(event) => edit({ publishDate: event.target.value })} /></Label>
            {format === 'long' && promotion === 'integration' && <div className="linked-video-field field-grid-wide">
              <Label>Organic video (optional)<Select value={organicVideoId} disabled={deleting} onValueChange={(value) => edit({ production: asProduction(format, promotion, value === 'none' ? null : value) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not linked</SelectItem>{organicVideoOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.title}</SelectItem>)}</SelectContent></Select></Label>
              <div className="linked-video-help">
                <p className="field-help">Choose the organic long-form video that will carry this integration.</p>
                {organicVideoOptions.length === 0 && <p className="field-help">No organic long-form videos available.</p>}
                {persistedOrganicVideoId && <Button asChild variant="link" size="sm"><a href={`/videos/${persistedOrganicVideoId}`}>Open linked video</a></Button>}
              </div>
            </div>}
          </div>
          <Label>Script<RichEditor value={script} onChange={(value) => edit({ script: value })} /></Label>
          <footer>
            <p id="video-save-status" className="field-help" role="status" aria-live="polite" aria-atomic="true">
              {deleting ? 'Deleting…' : saveStatus.kind === 'saving' || saveStatus.kind === 'scheduled' ? 'Saving…'
                : saveStatus.kind === 'saved' ? 'Saved'
                  : saveStatus.kind === 'invalid' || saveStatus.kind === 'error' ? saveStatus.message
                    : saveStatus.kind === 'conflict' ? 'Changes paused. Load the latest version to continue.'
                      : 'Changes save automatically.'}
            </p>
            {saveStatus.kind === 'error' && saveStatus.operation === 'save' && <Button type="button" variant="outline" size="sm" onClick={retry}>Retry</Button>}
          </footer>
        </div>
      </Card>
      <ReviewWorkspace videoId={video.id} onFootageChanged={() => setFootageRevision((value) => value + 1)} />
      <FootageSection videoId={video.id} refreshToken={footageRevision} />
    </main>
  )
}
