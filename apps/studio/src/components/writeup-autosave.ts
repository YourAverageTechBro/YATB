import type { SaveWriteupResult, StaleReason, WriteupFieldView, WriteupSaveToken } from '#/domain/draft-writeups'

export const WRITEUP_SAVE_DELAY_MS = 600

export type WriteupSaveStatus =
  | Readonly<{ kind: 'clean' | 'scheduled' | 'saving' | 'saved' }>
  | Readonly<{ kind: 'stale'; reason: StaleReason; latest: WriteupFieldView }>
  | Readonly<{ kind: 'error'; message: string }>

/** `base` is the last view the server acknowledged. `text` is what the member sees. */
type WriteupAutosaveSnapshot = Readonly<{ base: WriteupFieldView; text: string; status: WriteupSaveStatus }>

type Save = (text: string, saveToken: WriteupSaveToken) => Promise<SaveWriteupResult>

export function createWriteupAutosave(initial: WriteupFieldView, save: Save) {
  let snapshot: WriteupAutosaveSnapshot = { base: initial, text: initial.text, status: { kind: 'clean' } }
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined
  let active = true
  const listeners = new Set<() => void>()

  function publish(patch: Partial<WriteupAutosaveSnapshot>) {
    snapshot = { ...snapshot, ...patch }
    if (active) listeners.forEach((listener) => listener())
  }

  const dirty = () => snapshot.text !== snapshot.base.text
  const halted = () => !active || snapshot.status.kind === 'stale' || snapshot.status.kind === 'error'

  function cancelScheduled() {
    clearTimeout(timer)
    timer = undefined
  }

  function schedule() {
    cancelScheduled()
    if (halted()) return
    if (!inFlight && !dirty()) {
      publish({ status: { kind: 'saved' } })
      return
    }
    publish({ status: { kind: inFlight ? 'saving' : 'scheduled' } })
    timer = setTimeout(() => {
      timer = undefined
      void send()
    }, WRITEUP_SAVE_DELAY_MS)
  }

  function send(): Promise<void> {
    if (inFlight) return inFlight
    if (halted() || !dirty()) return Promise.resolve()
    const sent = snapshot.text
    publish({ status: { kind: 'saving' } })
    inFlight = (async () => {
      try {
        const result = await save(sent, snapshot.base.saveToken)
        if (!active) return
        switch (result.kind) {
          case 'saved': {
            const text = snapshot.text === sent ? result.view.text : snapshot.text
            publish({ base: result.view, text, status: { kind: text === result.view.text ? 'saved' : 'scheduled' } })
            break
          }
          case 'stale':
            cancelScheduled()
            publish({ status: { kind: 'stale', reason: result.reason, latest: result.view } })
            break
          default: {
            const unreachable: never = result
            return unreachable
          }
        }
      } catch {
        if (active) {
          cancelScheduled()
          publish({ status: { kind: 'error', message: 'Could not save. Your text is still here.' } })
        }
      } finally {
        inFlight = undefined
        if (!halted() && dirty()) schedule()
      }
    })()
    return inFlight
  }

  /** Saves pending text now. True when the server holds exactly what the member sees. */
  async function flush(): Promise<boolean> {
    for (;;) {
      cancelScheduled()
      if (halted()) return false
      if (!inFlight && !dirty()) return true
      await send()
    }
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
    edit(text: string) {
      if (!active) return
      publish({ text })
      schedule()
    },
    /** A polled view replaces the text only while the member has nothing unsaved. */
    receive(view: WriteupFieldView) {
      if (inFlight || timer || dirty() || snapshot.status.kind === 'stale') return
      publish({ base: view, text: view.text })
    },
    loadLatest() {
      if (snapshot.status.kind !== 'stale') return
      const { latest } = snapshot.status
      cancelScheduled()
      publish({ base: latest, text: latest.text, status: { kind: 'clean' } })
    },
    retry() {
      if (snapshot.status.kind !== 'error') return
      publish({ status: { kind: 'scheduled' } })
      schedule()
    },
    flush,
  }
}
