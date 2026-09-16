import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVideoAutosave } from '../src/components/video-autosave'
import type { SaveVideoResult, Video } from '../src/domain/videos'

const video: Video = {
  id: 'eb39f735-6548-4169-8a15-5eb6ffbd3b6f',
  title: 'Original title',
  production: { format: 'short', promotion: 'organic' },
  status: 'not-started',
  publishDate: null,
  script: { type: 'doc', content: [{ type: 'paragraph' }] },
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

type Mutations = Parameters<typeof createVideoAutosave>[1]

function setup(save = vi.fn<Mutations['save']>(async () => ({ kind: 'saved', video }))) {
  const remove = vi.fn<Mutations['remove']>(async () => ({ kind: 'deleted' }))
  return { autosave: createVideoAutosave(video, { save, remove }), save, remove }
}

describe('video autosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces rapid edits and persists the final draft after a pause', async () => {
    const save = vi.fn<Mutations['save']>(async (data) => ({ kind: 'saved', video: { ...video, ...data, revision: 2 } }))
    const autosave = createVideoAutosave(video, { save, remove: async () => ({ kind: 'deleted' }) })
    autosave.edit({ title: 'First edit' })
    await vi.advanceTimersByTimeAsync(400)
    autosave.edit({ title: 'Final title', status: 'filming', publishDate: '2026-09-17' })
    await vi.advanceTimersByTimeAsync(599)
    expect(save).not.toHaveBeenCalled()
    expect(autosave.getSnapshot().status.kind).toBe('scheduled')
    await vi.advanceTimersByTimeAsync(1)
    expect(save.mock.calls[0]?.[0]).toMatchObject({ title: 'Final title', status: 'filming', publishDate: '2026-09-17', expectedRevision: 1 })
    expect(autosave.getSnapshot()).toMatchObject({ video: { title: 'Final title', revision: 2 }, status: { kind: 'saved' } })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('preserves edits during a save and serializes the latest trailing draft with the acknowledged revision', async () => {
    const first = deferred<SaveVideoResult>()
    const second = deferred<SaveVideoResult>()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { autosave } = setup(save)
    autosave.edit({ title: 'First edit' })
    await vi.advanceTimersByTimeAsync(600)
    autosave.edit({ title: 'Intermediate edit' })
    await vi.advanceTimersByTimeAsync(600)
    autosave.edit({ title: 'Newest edit' })
    await vi.advanceTimersByTimeAsync(600)
    expect(save).toHaveBeenCalledTimes(1)
    first.resolve({ kind: 'saved', video: { ...video, title: 'First edit', revision: 2 } })
    await vi.advanceTimersByTimeAsync(0)
    expect(autosave.getSnapshot()).toMatchObject({ draft: { title: 'Newest edit' }, video: { title: 'First edit', revision: 2 }, status: { kind: 'saving' } })
    expect(save.mock.calls[1]?.[0]).toMatchObject({ title: 'Newest edit', expectedRevision: 2 })
    second.resolve({ kind: 'saved', video: { ...video, title: 'Newest edit', revision: 3 } })
    await vi.advanceTimersByTimeAsync(0)
    expect(autosave.getSnapshot()).toMatchObject({ draft: { title: 'Newest edit' }, video: { title: 'Newest edit', revision: 3 }, status: { kind: 'saved' } })
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('waits for the trailing debounce even when the first save finishes sooner', async () => {
    const first = deferred<SaveVideoResult>()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ kind: 'saved', video: { ...video, title: 'Newer', revision: 3 } })
    const { autosave } = setup(save)
    autosave.edit({ title: 'First' })
    await vi.advanceTimersByTimeAsync(600)
    autosave.edit({ title: 'Newer' })
    first.resolve({ kind: 'saved', video: { ...video, title: 'First', revision: 2 } })
    await vi.advanceTimersByTimeAsync(599)
    expect(save).toHaveBeenCalledTimes(1)
    expect(autosave.getSnapshot().draft.title).toBe('Newer')
    await vi.advanceTimersByTimeAsync(1)
    expect(autosave.getSnapshot().video.title).toBe('Newer')
  })

  it('retains an empty title without sending it and resumes when corrected', async () => {
    const { autosave, save } = setup()
    autosave.edit({ title: '  ' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(save).not.toHaveBeenCalled()
    expect(autosave.getSnapshot()).toMatchObject({ draft: { title: '  ' }, status: { kind: 'invalid', message: 'Title must be between 1 and 200 characters.' } })
    autosave.edit({ title: 'Corrected' })
    await vi.advanceTimersByTimeAsync(600)
    expect(save.mock.calls[0]?.[0]).toMatchObject({ title: 'Corrected' })
    expect(autosave.getSnapshot().status.kind).toBe('saved')
  })

  it('retains the draft after a thrown failure and retries only on request or another edit', async () => {
    const save = vi.fn().mockImplementationOnce(() => { throw new Error('Offline') }).mockResolvedValueOnce({ kind: 'saved', video: { ...video, title: 'Keep this', revision: 2 } })
    const { autosave } = setup(save)
    autosave.edit({ title: 'Keep this' })
    await vi.advanceTimersByTimeAsync(6000)
    expect(autosave.getSnapshot()).toMatchObject({ draft: { title: 'Keep this' }, status: { kind: 'error', operation: 'save' } })
    expect(save).toHaveBeenCalledTimes(1)
    autosave.retry()
    await vi.advanceTimersByTimeAsync(600)
    expect(autosave.getSnapshot()).toMatchObject({ video: { title: 'Keep this', revision: 2 }, status: { kind: 'saved' } })
  })

  it('pauses on conflict until the user loads the latest version', async () => {
    const latest = { ...video, title: 'Other session', revision: 4 }
    const { autosave, save } = setup(vi.fn(async () => ({ kind: 'conflict', latest })))
    autosave.edit({ title: 'Local edit' })
    await vi.advanceTimersByTimeAsync(600)
    autosave.edit({ title: 'Keep this local edit' })
    await vi.advanceTimersByTimeAsync(6000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(autosave.getSnapshot()).toMatchObject({ draft: { title: 'Keep this local edit' }, status: { kind: 'conflict', latest } })
    autosave.loadLatest()
    expect(autosave.getSnapshot()).toMatchObject({ draft: { title: 'Other session' }, video: { revision: 4 }, status: { kind: 'clean' } })
  })

  it('does not retry an invalid organic link automatically', async () => {
    const { autosave, save } = setup(vi.fn(async () => ({ kind: 'invalid-link', message: 'Choose an active organic long-form video.' })))
    autosave.edit({ production: { format: 'long', promotion: 'integration', organicVideoId: video.id } })
    await vi.advanceTimersByTimeAsync(6000)
    expect(autosave.getSnapshot().status).toEqual({ kind: 'invalid', message: 'Choose an active organic long-form video.' })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('cancels unsent edits and waits for the active save before deleting its acknowledged revision', async () => {
    const first = deferred<SaveVideoResult>()
    const { autosave, save, remove } = setup(vi.fn(() => first.promise))
    autosave.edit({ title: 'Being saved' })
    await vi.advanceTimersByTimeAsync(600)
    autosave.edit({ title: 'Unsent trailing edit' })
    const deletion = autosave.erase()
    await vi.advanceTimersByTimeAsync(600)
    expect(remove).not.toHaveBeenCalled()
    expect(autosave.getSnapshot().deleting).toBe(true)
    first.resolve({ kind: 'saved', video: { ...video, title: 'Being saved', revision: 2 } })
    expect(await deletion).toBe(true)
    expect(remove.mock.calls[0]?.[0]).toEqual({ id: video.id, expectedRevision: 2 })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flushes queued and in-flight edits before navigation', async () => {
    const first = deferred<SaveVideoResult>()
    const save = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ kind: 'saved', video: { ...video, title: 'Leaving now', revision: 3 } })
    const { autosave } = setup(save)
    autosave.edit({ title: 'Being saved' })
    await vi.advanceTimersByTimeAsync(600)
    autosave.edit({ title: 'Leaving now' })
    const flushed = autosave.flush()
    first.resolve({ kind: 'saved', video: { ...video, title: 'Being saved', revision: 2 } })
    await vi.advanceTimersByTimeAsync(0)
    expect(save.mock.calls[1]?.[0]).toMatchObject({ title: 'Leaving now', expectedRevision: 2 })
    expect(await flushed).toBe(true)
    expect(autosave.getSnapshot()).toMatchObject({ video: { title: 'Leaving now', revision: 3 }, draft: { title: 'Leaving now' } })
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('cancels a queued edit when the editor disconnects without a navigation flush', async () => {
    const { autosave, save } = setup()
    const disconnect = autosave.connect()
    autosave.edit({ title: 'Unsent edit' })
    disconnect()
    await vi.advanceTimersByTimeAsync(600)
    expect(save).not.toHaveBeenCalled()
  })

  it('does not request navigation when deletion finishes after the editor disconnects', async () => {
    const removal = deferred<{ kind: 'deleted' }>()
    const autosave = createVideoAutosave(video, { save: async () => ({ kind: 'saved', video }), remove: () => removal.promise })
    const disconnect = autosave.connect()
    const deletion = autosave.erase()
    await vi.advanceTimersByTimeAsync(0)
    disconnect()
    removal.resolve({ kind: 'deleted' })
    expect(await deletion).toBe(false)
    expect(autosave.getSnapshot().video.title).toBe('Original title')
  })
})
