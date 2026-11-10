import { canMarkReady, evaluateComposer, type PostDraft, type PostTarget } from '#/domain/posts'
import type { SavePostResult } from '#/server/posts.server'

type Snapshot = {
  draft: PostDraft
  status: { kind: 'clean' | 'scheduled' | 'saving' | 'saved' } | { kind: 'error'; message: string } | { kind: 'conflict'; latest: PostDraft }
}

type Mutations = {
  save: (data: {
    id: string
    expectedRevision: number
    target: PostTarget
    xPremium: boolean
    items: ReadonlyArray<{ id: string; body: string; media: ReadonlyArray<{ id: string; alt: string | null }> }>
  }) => Promise<SavePostResult>
}

function payload(draft: PostDraft) {
  return {
    id: draft.id,
    expectedRevision: draft.revision,
    target: draft.target,
    xPremium: draft.xPremium,
    items: draft.items.map((item) => ({
      id: item.id,
      body: item.body,
      media: item.media.map((file) => ({ id: file.id, alt: file.alt })),
    })),
  }
}

function same(left: PostDraft, right: PostDraft): boolean {
  return JSON.stringify(payload({ ...left, revision: 0, updatedAt: 0, status: 'draft' }))
    === JSON.stringify(payload({ ...right, revision: 0, updatedAt: 0, status: 'draft' }))
}

export function createPostsAutosave(loaded: PostDraft, mutations: Mutations) {
  let snapshot: Snapshot = { draft: loaded, status: { kind: 'clean' } }
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined
  let ready = false
  let active = true
  const listeners = new Set<() => void>()

  function publish(patch: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...patch }
    if (active) listeners.forEach((listener) => listener())
  }

  function schedule() {
    clearTimeout(timer)
    if (!active || snapshot.draft.status === 'posted' || snapshot.status.kind === 'conflict') return
    publish({ status: { kind: inFlight ? 'saving' : 'scheduled' } })
    timer = setTimeout(() => {
      timer = undefined
      ready = true
      save()
    }, 600)
  }

  function save() {
    if (!active || inFlight || !ready || snapshot.draft.status === 'posted') return
    ready = false
    const sent = snapshot.draft
    publish({ status: { kind: 'saving' } })
    inFlight = Promise.resolve().then(async () => {
      try {
        const result = await mutations.save(payload(sent))
        if (!active) return
        if (result.kind === 'saved') {
          const pending = snapshot.draft
          if (same(pending, sent) || same(pending, result.draft)) {
            publish({ draft: result.draft, status: { kind: 'saved' } })
          } else {
            publish({
              draft: { ...pending, revision: result.draft.revision, updatedAt: result.draft.updatedAt },
              status: { kind: 'scheduled' },
            })
            ready = true
          }
        } else if (result.kind === 'conflict') publish({ status: { kind: 'conflict', latest: result.latest } })
        else if (result.kind === 'posted') publish({ status: { kind: 'saved' } })
        else publish({ status: { kind: 'error', message: 'This draft is gone.' } })
      } catch {
        if (active) publish({ status: { kind: 'error', message: 'Could not save changes. Your edits are still here.' } })
      } finally {
        inFlight = undefined
        save()
      }
    })
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
        clearTimeout(timer)
      }
    },
    replace(next: PostDraft) {
      if (!active || snapshot.draft.status === 'posted') return
      publish({ draft: next })
      if (next.status === 'ready' || next.status === 'posted') {
        publish({ status: { kind: 'saved' } })
        return
      }
      schedule()
    },
    retry() {
      if (snapshot.status.kind === 'error') schedule()
    },
    loadLatest() {
      if (snapshot.status.kind !== 'conflict') return
      publish({ draft: snapshot.status.latest, status: { kind: 'clean' } })
    },
    report: () => evaluateComposer(snapshot.draft),
    canReady: () => canMarkReady(snapshot.draft),
  }
}
