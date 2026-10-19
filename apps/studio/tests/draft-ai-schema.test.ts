import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { FAILURE_CODES, JOB_KINDS, WRITEUP_FIELDS } from '../src/domain/draft-ai'
import { ids, migratedDatabase, seedDraft } from './support/draft-ai-db'

function seeded(): DatabaseSync {
  const db = migratedDatabase()
  seedDraft(db)
  return db
}

function insertJob(db: DatabaseSync, kind: string, extra: Partial<Record<'state' | 'failure_code' | 'lease_id' | 'lease_until', string | number>> = {}) {
  db.prepare(`INSERT INTO draft_ai_job (
    draft_id, video_id, kind, request_seq, state, attempts, lease_id, lease_until, failure_code, created_at, updated_at
  ) VALUES (?, ?, ?, 1, ?, 0, ?, ?, ?, 1, 1)`).run(
    ids.draft, ids.video, kind, extra.state ?? 'queued', extra.lease_id ?? null, extra.lease_until ?? null, extra.failure_code ?? null,
  )
}

function insertGeneration(db: DatabaseSync, field: string, seq: number) {
  db.prepare(`INSERT INTO draft_generation (draft_id, video_id, field, seq, text, provider, model, created_at)
    VALUES (?, ?, ?, ?, 'text', 'stub', 'stub', 1)
    ON CONFLICT (draft_id, field) DO UPDATE SET seq = excluded.seq`).run(ids.draft, ids.video, field, seq)
}

const markReady = (db: DatabaseSync, kind: string) =>
  db.prepare("UPDATE draft_ai_job SET state = 'ready' WHERE draft_id = ? AND kind = ?").run(ids.draft, kind)

describe('migration 0013', () => {
  it('accepts exactly the job kinds and writeup fields the domain names', () => {
    const db = seeded()
    for (const kind of JOB_KINDS) insertJob(db, kind)
    expect(() => insertJob(db, 'thumbnail')).toThrow()
    for (const field of WRITEUP_FIELDS) insertGeneration(db, field, 1)
    expect(() => insertGeneration(db, 'transcript', 1)).toThrow()
  })

  it('accepts exactly the failure codes the domain names, and only on failed rows', () => {
    const db = seeded()
    db.prepare(`INSERT INTO draft_ai_job (
      draft_id, video_id, kind, request_seq, state, attempts, failure_code, created_at, updated_at
    ) VALUES (?, ?, 'transcript', 1, 'failed', 1, 'provider', 1, 1)`).run(ids.draft, ids.video)
    const setCode = db.prepare("UPDATE draft_ai_job SET failure_code = ? WHERE kind = 'transcript'")
    for (const code of FAILURE_CODES) setCode.run(code)
    expect(() => setCode.run('cosmic-rays')).toThrow()
    expect(() => insertJob(db, 'description', { state: 'failed' })).toThrow()
  })

  it('holds a lease exactly while processing', () => {
    const db = seeded()
    expect(() => insertJob(db, 'transcript', { state: 'processing' })).toThrow()
    expect(() => insertJob(db, 'transcript', { lease_id: 'lease', lease_until: 10 })).toThrow()
    insertJob(db, 'transcript', { state: 'processing', lease_id: 'lease', lease_until: 10 })
  })

  it('fills the transcript etag, segment count, and span end together', () => {
    const db = seeded()
    const insert = db.prepare(`INSERT INTO draft_transcript (
      draft_id, video_id, audio_etag, transcript_etag, segment_count, span_end_ms, provider, created_at, updated_at
    ) VALUES (?, ?, 'audio', ?, ?, ?, 'stub', 1, 1)`)
    expect(() => insert.run(ids.draft, ids.video, 'transcript', 3, null)).toThrow()
    expect(() => insert.run(ids.draft, ids.video, null, null, 1_000)).toThrow()
    insert.run(ids.draft, ids.video, null, null, null)
    db.prepare("UPDATE draft_transcript SET transcript_etag = 'transcript', segment_count = 3, span_end_ms = 1000").run()
    expect(db.prepare('SELECT span_end_ms FROM draft_transcript').get()).toEqual({ span_end_ms: 1_000 })
  })

  it('refuses ready without the artifact for that request', () => {
    const db = seeded()
    insertJob(db, 'transcript')
    insertJob(db, 'chapters')
    expect(() => markReady(db, 'transcript')).toThrow('draft_ai_job_ready_requires_artifact')
    db.prepare(`INSERT INTO draft_transcript (
      draft_id, video_id, audio_etag, transcript_etag, segment_count, span_end_ms, provider, created_at, updated_at
    ) VALUES (?, ?, 'audio', 'transcript', 2, 9000, 'stub', 1, 1)`).run(ids.draft, ids.video)
    markReady(db, 'transcript')

    insertGeneration(db, 'description', 1)
    expect(() => markReady(db, 'chapters')).toThrow('draft_ai_job_ready_requires_artifact')
    insertGeneration(db, 'chapters', 2)
    expect(() => markReady(db, 'chapters')).toThrow('draft_ai_job_ready_requires_artifact')
    insertGeneration(db, 'chapters', 1)
    markReady(db, 'chapters')
    expect(db.prepare('SELECT kind, state FROM draft_ai_job ORDER BY kind').all()).toEqual([
      { kind: 'chapters', state: 'ready' },
      { kind: 'transcript', state: 'ready' },
    ])
  })

  it('drops draft AI rows with the draft and keeps spend', () => {
    const db = seeded()
    insertJob(db, 'transcript')
    insertGeneration(db, 'description', 1)
    db.prepare(`INSERT INTO draft_text_edit (draft_id, video_id, field, text, base_seq, revision, updated_by_user_id, updated_at)
      VALUES (?, ?, 'description', 'mine', 1, 1, ?, 1)`).run(ids.draft, ids.video, ids.user)
    db.prepare(`INSERT INTO ai_spend (id, month, kind, video_id, draft_id, microusd, settled, created_at, updated_at)
      VALUES ('charge', '2026-10', 'transcript', ?, ?, 10, 1, 1, 1)`).run(ids.video, ids.draft)
    db.prepare('DELETE FROM draft WHERE id = ?').run(ids.draft)
    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    expect([count('draft_ai_job'), count('draft_generation'), count('draft_text_edit'), count('ai_spend')]).toEqual([0, 0, 0, 1])
  })
})
