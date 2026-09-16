import { parsePublishDate, parseTitle, type SaveVideoResult, type Video } from '#/domain/videos'
import { parseRichDocument } from '#/server/rich-document'

export type VideoDraft = Pick<Video, 'title' | 'production' | 'status' | 'script'> & { publishDate: string }
export type VideoSaveStatus =
  | { kind: 'clean' | 'scheduled' | 'saving' | 'saved' }
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; message: string; operation: 'save' | 'delete' }
  | { kind: 'conflict'; latest: Video }

type SaveInput = Omit<VideoDraft, 'publishDate'> & { id: string; expectedRevision: number; publishDate: string | null }
type Mutations = {
  save: (data: SaveInput) => Promise<SaveVideoResult>
  remove: (data: { id: string; expectedRevision: number }) => Promise<SaveVideoResult | { kind: 'deleted' }>
}
type Snapshot = { video: Video; draft: VideoDraft; status: VideoSaveStatus; deleting: boolean }

function draftOf(video: Video): VideoDraft {
  const { title, production, status, script, publishDate } = video
  return { title, production, status, script, publishDate: publishDate ?? '' }
}

function validationMessage(draft: VideoDraft): string | null {
  try {
    parseTitle(draft.title)
    parsePublishDate(draft.publishDate || null)
    parseRichDocument(draft.script)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Check the video fields before saving.'
  }
}

function sameDraft(left: VideoDraft, right: VideoDraft): boolean {
  return JSON.stringify({ ...left, title: left.title.trim() }) === JSON.stringify({ ...right, title: right.title.trim() })
}

export function createVideoAutosave(video: Video, mutations: Mutations) {
  let snapshot: Snapshot = { video, draft: draftOf(video), status: { kind: 'clean' }, deleting: false }
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined
  let ready = false
  let active = true
  const listeners = new Set<() => void>()

  function publish(patch: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...patch }
    if (active) listeners.forEach((listener) => listener())
  }

  function cancelScheduled() {
    clearTimeout(timer)
    timer = undefined
    ready = false
  }

  function schedule() {
    cancelScheduled()
    if (!active || snapshot.deleting || snapshot.status.kind === 'conflict') return
    const message = validationMessage(snapshot.draft)
    if (message) {
      publish({ status: { kind: 'invalid', message } })
      return
    }
    if (!inFlight && sameDraft(snapshot.draft, draftOf(snapshot.video))) {
      publish({ status: { kind: 'saved' } })
      return
    }
    publish({ status: { kind: inFlight ? 'saving' : 'scheduled' } })
    timer = setTimeout(() => {
      timer = undefined
      ready = true
      save()
    }, 600)
  }

  function save() {
    if (!active || inFlight || !ready || snapshot.deleting) return
    ready = false
    const sent = snapshot.draft
    const acknowledged = snapshot.video
    publish({ status: { kind: 'saving' } })
    inFlight = Promise.resolve().then(async () => {
      try {
        const result = await mutations.save({
          ...sent,
          title: sent.title.trim(),
          publishDate: sent.publishDate || null,
          id: acknowledged.id,
          expectedRevision: acknowledged.revision,
        })
        if (!active) return
        if (result.kind === 'saved') {
          publish({ video: result.video })
          if (snapshot.draft === sent || sameDraft(snapshot.draft, draftOf(result.video))) {
            cancelScheduled()
            publish({ status: { kind: 'saved' } })
          } else if (snapshot.status.kind !== 'invalid') {
            publish({ status: { kind: 'scheduled' } })
          }
        } else {
          cancelScheduled()
          if (result.kind === 'conflict') publish({ status: { kind: 'conflict', latest: result.latest } })
          if (result.kind === 'invalid-link') publish({ status: { kind: 'invalid', message: result.message } })
          if (result.kind === 'not-found') publish({ status: { kind: 'invalid', message: 'This video no longer exists. Your changes have not been saved.' } })
        }
      } catch {
        if (active) {
          cancelScheduled()
          publish({ status: { kind: 'error', operation: 'save', message: 'Could not save changes. Your edits are still here.' } })
        }
      } finally {
        inFlight = undefined
        save()
      }
    })
  }

  async function flush(): Promise<boolean> {
    cancelScheduled()
    if (!active || snapshot.deleting || snapshot.status.kind === 'conflict') return false
    const message = validationMessage(snapshot.draft)
    if (message) {
      publish({ status: { kind: 'invalid', message } })
      return false
    }
    if (!inFlight && sameDraft(snapshot.draft, draftOf(snapshot.video))) {
      publish({ status: { kind: 'saved' } })
      return true
    }
    ready = true
    save()
    while (inFlight) await inFlight
    return sameDraft(snapshot.draft, draftOf(snapshot.video))
  }

  async function erase(): Promise<boolean> {
    if (!active || snapshot.deleting) return false
    cancelScheduled()
    publish({ deleting: true })
    await inFlight
    if (!active) return false
    if (snapshot.status.kind === 'conflict') {
      publish({ deleting: false })
      return false
    }
    try {
      const result = await mutations.remove({ id: snapshot.video.id, expectedRevision: snapshot.video.revision })
      if (!active) return false
      if (result.kind === 'deleted' || result.kind === 'not-found') return true
      if (result.kind === 'conflict') publish({ status: { kind: 'conflict', latest: result.latest } })
      if (result.kind === 'invalid-link') publish({ status: { kind: 'invalid', message: result.message } })
    } catch {
      if (active) publish({ status: { kind: 'error', operation: 'delete', message: 'Could not delete this video. Try again.' } })
    }
    if (active) publish({ deleting: false })
    return false
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    connect() {
      active = true
      return () => {
        active = false
        cancelScheduled()
      }
    },
    edit(patch: Partial<VideoDraft>) {
      if (!active || snapshot.deleting) return
      publish({ draft: { ...snapshot.draft, ...patch } })
      schedule()
    },
    retry() {
      if (snapshot.status.kind === 'error' && snapshot.status.operation === 'save') schedule()
    },
    loadLatest() {
      if (snapshot.status.kind !== 'conflict') return
      const latest = snapshot.status.latest
      cancelScheduled()
      publish({ video: latest, draft: draftOf(latest), status: { kind: 'clean' } })
    },
    flush,
    erase,
  }
}
