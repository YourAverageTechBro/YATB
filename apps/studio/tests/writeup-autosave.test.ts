import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WRITEUP_SAVE_DELAY_MS, createWriteupAutosave } from '../src/components/writeup-autosave'
import type { SaveWriteupResult, WriteupFieldView, WriteupSaveToken } from '../src/domain/draft-writeups'

function view(text: string, saveToken: string, origin: WriteupFieldView['origin'] = 'generated'): WriteupFieldView {
  return {
    field: 'description',
    text,
    origin,
    saveToken: saveToken as WriteupSaveToken,
    progress: { kind: 'idle' },
    generate: { kind: 'allowed' },
    problems: [],
    stub: false,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

type Save = (text: string, saveToken: WriteupSaveToken) => Promise<SaveWriteupResult>

function savedAs(text: string, saveToken: string): SaveWriteupResult {
  return { kind: 'saved', view: view(text, saveToken, 'edited') }
}

describe('writeup autosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('saves the last edit after a pause with the token the text was loaded at', async () => {
    const save = vi.fn<Save>(async (text) => savedAs(text, '1.1'))
    const autosave = createWriteupAutosave(view('Generated.', '1.0'), save)
    autosave.edit('Edited')
    await vi.advanceTimersByTimeAsync(300)
    autosave.edit('Edited twice')
    await vi.advanceTimersByTimeAsync(WRITEUP_SAVE_DELAY_MS - 1)
    expect(save).not.toHaveBeenCalled()
    expect(autosave.getSnapshot().status.kind).toBe('scheduled')
    await vi.advanceTimersByTimeAsync(1)
    expect(save.mock.calls).toEqual([['Edited twice', '1.0']])
    expect(autosave.getSnapshot()).toMatchObject({ text: 'Edited twice', base: { saveToken: '1.1' }, status: { kind: 'saved' } })
  })

  it('keeps typing during a save and sends the trailing text with the new token', async () => {
    const first = deferred<SaveWriteupResult>()
    const save = vi.fn<Save>().mockReturnValueOnce(first.promise).mockImplementationOnce(async (text) => savedAs(text, '1.2'))
    const autosave = createWriteupAutosave(view('Generated.', '1.0'), save)
    autosave.edit('One')
    await vi.advanceTimersByTimeAsync(WRITEUP_SAVE_DELAY_MS)
    autosave.edit('One two')
    await vi.advanceTimersByTimeAsync(WRITEUP_SAVE_DELAY_MS)
    expect(save).toHaveBeenCalledTimes(1)
    first.resolve(savedAs('One', '1.1'))
    await vi.advanceTimersByTimeAsync(WRITEUP_SAVE_DELAY_MS)
    expect(save.mock.calls[1]).toEqual(['One two', '1.1'])
    expect(autosave.getSnapshot()).toMatchObject({ text: 'One two', status: { kind: 'saved' } })
  })

  it('adopts the text the server normalized when nothing was typed since', async () => {
    const autosave = createWriteupAutosave(view('', '0.0', 'empty'), async () => savedAs('Hook.\n\nSummary.', '0.1'))
    autosave.edit('Hook.\r\n\r\nSummary.')
    await vi.advanceTimersByTimeAsync(WRITEUP_SAVE_DELAY_MS)
    expect(autosave.getSnapshot()).toMatchObject({ text: 'Hook.\n\nSummary.', status: { kind: 'saved' } })
  })

  it('stops on a stale save, keeps the member text, and loads the latest on request', async () => {
    const latest = view('Regenerated.', '2.0')
    const save = vi.fn<Save>(async () => ({ kind: 'stale', reason: 'regenerated', view: latest }))
    const autosave = createWriteupAutosave(view('Generated.', '1.0'), save)
    autosave.edit('Mine')
    await vi.advanceTimersByTimeAsync(WRITEUP_SAVE_DELAY_MS)
    expect(autosave.getSnapshot()).toMatchObject({ text: 'Mine', status: { kind: 'stale', reason: 'regenerated' } })
    autosave.edit('Mine, more')
    await vi.advanceTimersByTimeAsync(WRITEUP_SAVE_DELAY_MS * 2)
    expect(save).toHaveBeenCalledTimes(1)
    expect(await autosave.flush()).toBe(false)
    autosave.loadLatest()
    expect(autosave.getSnapshot()).toMatchObject({ text: 'Regenerated.', base: { saveToken: '2.0' }, status: { kind: 'clean' } })
  })

  it('takes polled text only while nothing is unsaved', async () => {
    const autosave = createWriteupAutosave(view('', '0.0', 'empty'), async (text) => savedAs(text, '0.1'))
    autosave.receive(view('Generated.', '1.0'))
    expect(autosave.getSnapshot().text).toBe('Generated.')
    autosave.edit('Typing')
    autosave.receive(view('Generated again.', '2.0'))
    expect(autosave.getSnapshot()).toMatchObject({ text: 'Typing', base: { saveToken: '1.0' } })
  })

  it('flushes pending text before resolving true, and reports a failed save until retried', async () => {
    const save = vi.fn<Save>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (text) => savedAs(text, '1.1'))
    const autosave = createWriteupAutosave(view('Generated.', '1.0'), save)
    autosave.edit('Before generate')
    expect(await autosave.flush()).toBe(false)
    expect(autosave.getSnapshot().status).toMatchObject({ kind: 'error' })
    autosave.retry()
    expect(await autosave.flush()).toBe(true)
    expect(save.mock.calls.map(([text]) => text)).toEqual(['Before generate', 'Before generate'])
    expect(autosave.getSnapshot().status.kind).toBe('saved')
  })
})
