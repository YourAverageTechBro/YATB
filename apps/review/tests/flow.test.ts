import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../server/cli.ts'
import { openStore, type Store } from '../server/store.ts'

let dir: string
let store: Store
const cli = (...argv: string[]) => runCli(argv, { store, baseUrl: 'http://127.0.0.1:3002', cwd: dir })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'review-flow-'))
  writeFileSync(join(dir, 'cut.mp4'), 'video')
  store = openStore(join(dir, 'review.db'))
})
afterEach(() => store.close())

describe('review loop', () => {
  it('posts drafts, takes a comment, and lets Claude reply through the CLI path', () => {
    expect(cli('post', 'demo', 'cut.mp4', '--note', 'first cut')).toContain('/#/p/demo?v=1')
    expect(cli('post', 'demo', 'cut.mp4', '--note', 'tighter intro')).toContain('/#/p/demo?v=2')

    const v2 = store.getProject('demo').drafts[1]!
    const root = store.addComment({ draftId: v2.id, anchor: { kind: 'range', startMs: 83_400, endMs: 90_000 }, body: 'Cut this pause', author: 'thomas' })

    const before = cli('feedback', 'demo')
    expect(before).toContain(`[${root.id.slice(0, 8)}] v2 1:23.4–1:30.0 open`)
    expect(before).toContain('Cut this pause')
    expect(before).toContain(join(dir, 'cut.mp4'))

    cli('reply', root.id.slice(0, 8), 'Trimmed 1.2s')
    expect(store.findComment(root.id).status).toBe('addressed')
    expect(cli('feedback', 'demo')).toBe('No open feedback for demo.')
    const all = cli('feedback', 'demo', '--all')
    expect(all).toContain('addressed')
    expect(all).toContain('claude')
    expect(all).toContain('Trimmed 1.2s')

    const json = JSON.parse(cli('feedback', 'demo', '--all', '--json'))
    expect(json.drafts[0].threads[0]).toMatchObject({ id: root.id, startMs: 83_400, endMs: 90_000, status: 'addressed' })
  })

  it('assigns increasing versions and counts open comments in the list', () => {
    cli('post', 'demo', 'cut.mp4')
    const { draft } = store.postDraft({ slug: 'demo', file: 'cut.mp4', cwd: dir })
    expect(draft.version).toBe(2)
    store.addComment({ draftId: draft.id, anchor: { kind: 'point', atMs: 0 }, body: 'x', author: 'thomas' })
    expect(cli('list')).toContain('demo  v2  1 open')
  })

  it('rejects bad input with a readable error', () => {
    expect(() => cli('post', 'demo', 'missing.mp4')).toThrow(/not a file/)
    expect(() => cli('post', 'Not Kebab', 'cut.mp4')).toThrow(/kebab-case/)
    expect(() => cli('reply', 'deadbeef', 'hi')).toThrow(/no comment matches/)
    expect(() => cli('nope')).toThrow(/unknown command/)
  })

  it('rejects an illegal status change and requires an unambiguous prefix', () => {
    cli('post', 'demo', 'cut.mp4')
    const draft = store.getProject('demo').drafts[0]!
    const a = store.addComment({ draftId: draft.id, anchor: { kind: 'point', atMs: 1 }, body: 'a', author: 'thomas' })
    store.setStatus(a.id, 'resolved')
    expect(() => cli('reply', a.id.slice(0, 8), 'done')).toThrow(/cannot change status from resolved to addressed/)
    expect(store.findComment(a.id).status).toBe('resolved')
    expect(() => store.findComment('-')).toThrow()
  })

  it('deleting a root removes its replies', () => {
    cli('post', 'demo', 'cut.mp4')
    const draft = store.getProject('demo').drafts[0]!
    const root = store.addComment({ draftId: draft.id, anchor: { kind: 'point', atMs: 1 }, body: 'a', author: 'thomas' })
    cli('reply', root.id.slice(0, 8), 'ok')
    store.deleteComment(root.id)
    expect(store.getProject('demo').comments).toEqual([])
  })
})
