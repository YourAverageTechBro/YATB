import { Copy, Download, RotateCcw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@yatb/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '@yatb/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@yatb/ui/alert-dialog'
import { Badge } from '@yatb/ui/badge'
import { Button } from '@yatb/ui/button'
import { Label } from '@yatb/ui/label'
import { ScrollArea } from '@yatb/ui/scroll-area'
import { Textarea } from '@yatb/ui/textarea'
import { failureMessage, type WriteupField } from '#/domain/draft-ai'
import {
  generateBlockMessage,
  writeupsInProgress,
  type DraftTranscriptView,
  type DraftWriteupsView,
  type StaleReason,
  type TranscriptStatus,
  type WriteupFieldView,
  type WriteupTarget,
} from '#/domain/draft-writeups'
import { formatTimestamp } from '#/domain/reviews'
import { loadDraftTranscript, loadDraftWriteups, requestDraftWriteup, saveDraftWriteup } from '#/server/draft-ai.functions'
import { createWriteupAutosave, type WriteupSaveStatus } from './writeup-autosave'

const WRITEUP_POLL_MS = 3_000

const FIELD_LABELS = { description: 'Description', chapters: 'Chapters' } as const satisfies Record<WriteupField, string>

/** Loads the member view and polls while a transcript or field is being made. */
export function DraftWriteups({ videoId, draftId }: WriteupTarget) {
  const target = useMemo(() => ({ videoId, draftId }), [videoId, draftId])
  const [view, setView] = useState<DraftWriteupsView | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setView(await loadDraftWriteups({ data: target }))
    setError('')
  }, [target])

  useEffect(() => {
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : 'Description and chapters could not be loaded.'))
  }, [refresh])

  useEffect(() => {
    if (!view || !writeupsInProgress(view)) return
    const timer = setTimeout(() => { void refresh().catch(() => undefined) }, WRITEUP_POLL_MS)
    return () => clearTimeout(timer)
  }, [view, refresh])

  if (error) return <Alert className="draft-writeups"><AlertTitle>Description and chapters unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
  if (!view) return <section className="draft-writeups" aria-busy="true"><p className="writeup-status">Loading description and chapters…</p></section>
  return <DraftWriteupsPanel target={target} view={view} onView={setView} />
}

export function DraftWriteupsPanel({ target, view, onView }: {
  target: WriteupTarget
  view: DraftWriteupsView
  onView: (view: DraftWriteupsView) => void
}) {
  const headingId = useId()
  const stub = view.ai === 'stub' || view.description.stub || view.chapters?.stub === true
  return <section className="draft-writeups" aria-labelledby={headingId}>
    <header>
      <h3 id={headingId}>YouTube description and chapters</h3>
      {stub && <Badge variant="outline">Stub AI</Badge>}
    </header>
    <WriteupFieldEditor target={target} field={view.description} onView={onView} />
    {view.chapters && <WriteupFieldEditor target={target} field={view.chapters} onView={onView} />}
    <TranscriptSection target={target} status={view.transcript} />
  </section>
}

function useWriteupAutosave(target: WriteupTarget, field: WriteupFieldView) {
  const [autosave] = useState(() => createWriteupAutosave(field, (text, saveToken) =>
    saveDraftWriteup({ data: { ...target, field: field.field, text, saveToken } })))
  const state = useSyncExternalStore(autosave.subscribe, autosave.getSnapshot, autosave.getSnapshot)
  useEffect(autosave.connect, [autosave])
  useEffect(() => autosave.receive(field), [autosave, field])
  return { ...state, autosave }
}

function generateLabel(field: WriteupFieldView): string {
  if (field.progress.kind === 'failed' && field.generate.kind === 'allowed') return 'Retry'
  return field.origin === 'empty' ? 'Generate' : 'Regenerate'
}

function progressMessage(field: WriteupFieldView): string | null {
  switch (field.progress.kind) {
    case 'idle':
      return null
    case 'transcribing':
      return 'Transcribing the draft…'
    case 'writing':
      return `Writing the ${FIELD_LABELS[field.field].toLowerCase()}…`
    case 'failed':
      return failureMessage(field.progress.failure)
    default: {
      const unreachable: never = field.progress
      return unreachable
    }
  }
}

function staleMessage(reason: StaleReason): string {
  switch (reason) {
    case 'edited-elsewhere':
      return 'This text changed in another tab, so your edit was not saved.'
    case 'regenerated':
      return 'New generated text replaced the version you were editing, so your edit was not saved.'
    case 'generating':
      return 'Generation started before your edit reached the server, so your edit was not saved.'
    default: {
      const unreachable: never = reason
      return unreachable
    }
  }
}

function saveMessage(status: WriteupSaveStatus): string | null {
  switch (status.kind) {
    case 'clean':
      return null
    case 'scheduled':
    case 'saving':
      return 'Saving…'
    case 'saved':
      return 'Saved'
    case 'stale':
      return staleMessage(status.reason)
    case 'error':
      return status.message
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

function WriteupFieldEditor({ target, field, onView }: {
  target: WriteupTarget
  field: WriteupFieldView
  onView: (view: DraftWriteupsView) => void
}) {
  const inputId = useId()
  const label = FIELD_LABELS[field.field]
  const { text, status, autosave } = useWriteupAutosave(target, field)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState('')
  const working = field.progress.kind === 'transcribing' || field.progress.kind === 'writing'
  const progress = progressMessage(field)
  const blocked = field.generate.kind === 'blocked' && !working ? generateBlockMessage(field.generate.reason) : null
  const saved = saveMessage(status)
  const action = generateLabel(field)

  async function generate(overwriteEdits: boolean) {
    setBusy(true)
    setMessage('')
    try {
      if (!(await autosave.flush())) {
        setMessage(`Resolve the ${label.toLowerCase()} save problem before generating.`)
        return
      }
      const result = await requestDraftWriteup({ data: { ...target, field: field.field, overwriteEdits } })
      switch (result.kind) {
        case 'accepted':
          onView(result.view)
          break
        case 'needs-confirmation':
          setConfirming(true)
          break
        case 'blocked':
          setMessage(generateBlockMessage(result.reason))
          break
        default: {
          const unreachable: never = result
          return unreachable
        }
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Generation could not start.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setMessage(`${label} copied`)
    } catch {
      setMessage(`Could not copy the ${label.toLowerCase()}.`)
    }
  }

  return <div className="writeup-field">
    <div className="writeup-field-header">
      <Label htmlFor={inputId}>{label}</Label>
      {saved && <small role="status">{saved}</small>}
    </div>
    <Textarea
      id={inputId}
      value={text}
      readOnly={working}
      rows={field.field === 'description' ? 9 : 7}
      placeholder={field.field === 'description' ? 'Generate a description from the transcript, or write one.' : '0:00 Intro'}
      onChange={(event) => autosave.edit(event.target.value)}
    />
    {field.problems.length > 0 && <ul className="writeup-problems" aria-label={`${label} problems`}>
      {field.problems.map((problem) => <li key={problem}>{problem}</li>)}
    </ul>}
    {progress && <p className="writeup-status" role="status">{progress}</p>}
    {status.kind === 'stale' && <Button variant="outline" size="sm" onClick={autosave.loadLatest}>Load latest {label.toLowerCase()}</Button>}
    {status.kind === 'error' && <Button variant="outline" size="sm" onClick={autosave.retry}>Retry save</Button>}
    <div className="writeup-actions">
      <Button variant="outline" size="sm" disabled={!text} onClick={() => void copy()} aria-label={`Copy ${label.toLowerCase()}`}><Copy /> Copy</Button>
      <Button
        size="sm"
        disabled={busy || working || field.generate.kind === 'blocked'}
        onClick={() => void generate(false)}
        aria-label={`${action} ${label.toLowerCase()}`}
      >{action === 'Retry' ? <RotateCcw /> : <Sparkles />} {action}</Button>
      {blocked && blocked !== progress && <small>{blocked}</small>}
    </div>
    {message && <p className="writeup-status" role="status">{message}</p>}
    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace your edited {label.toLowerCase()}?</AlertDialogTitle>
          <AlertDialogDescription>Generating writes new text over the {label.toLowerCase()} you edited. Copy it first if you want to keep it.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep my edits</AlertDialogCancel>
          <AlertDialogAction onClick={() => void generate(true)}>Replace and generate</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}

function transcriptSummary(status: TranscriptStatus): string {
  switch (status.kind) {
    case 'none':
      return 'Made when you first generate'
    case 'working':
      return status.stage === 'extracting-audio' ? 'Extracting audio…' : 'Transcribing…'
    case 'ready':
      return `${status.segmentCount} ${status.segmentCount === 1 ? 'line' : 'lines'}${status.stub ? ' · stub' : ''}`
    case 'failed':
      return failureMessage(status.failure)
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

function TranscriptSection({ target, status }: { target: WriteupTarget; status: TranscriptStatus }) {
  const [transcript, setTranscript] = useState<DraftTranscriptView | null>(null)
  const [error, setError] = useState('')

  async function open(value: string) {
    if (!value || transcript || status.kind !== 'ready') return
    try {
      setTranscript(await loadDraftTranscript({ data: target }))
    } catch {
      setError('The transcript could not be loaded.')
    }
  }

  return <div className="writeup-transcript">
    <Accordion type="single" collapsible onValueChange={(value) => void open(value)}>
      <AccordionItem value="transcript">
        <AccordionTrigger>Transcript <small>{transcriptSummary(status)}</small></AccordionTrigger>
        <AccordionContent>
          {error && <p role="alert" className="dialog-error">{error}</p>}
          {transcript
            ? <ScrollArea className="transcript-scroll" viewportProps={{ 'aria-label': 'Transcript', tabIndex: 0 }}>
              <ol className="transcript-lines">{transcript.segments.map((segment) => <li key={segment.startMs}>
                <time>{formatTimestamp(segment.startMs)}</time> {segment.text}
              </li>)}</ol>
            </ScrollArea>
            : <p className="writeup-status">{status.kind === 'ready' ? 'Loading transcript…' : transcriptSummary(status)}</p>}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
    {status.kind === 'ready' && <Button asChild variant="outline" size="sm">
      <a href={`/api/videos/${target.videoId}/drafts/${target.draftId}/transcript`} download><Download /> Download transcript .txt</a>
    </Button>}
  </div>
}
