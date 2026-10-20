import { describe, expect, it } from 'vitest'
import { MONTHLY_AI_BUDGET } from '../src/domain/ai-spend'
import { JOB_LEASE_MS, JOB_MAX_ATTEMPTS, QUEUED_GRACE_MS, type JobKind } from '../src/domain/draft-ai'
import {
  CLAIM_JOB_SQL,
  EXPIRE_EXHAUSTED_SQL,
  FAIL_JOB_SQL,
  FAIL_ORPHANED_DEPENDENTS_SQL,
  INSERT_EDIT_SQL,
  MONTH_SPEND_SQL,
  PENDING_JOBS_SQL,
  QUEUED_DEPENDENTS_SQL,
  RECORD_AUDIO_SQL,
  RECORD_GENERATION_SQL,
  RECORD_TRANSCRIPT_SQL,
  REQUEST_JOB_SQL,
  RESERVED_SPEND_SQL,
  RESERVE_SPEND_SQL,
  SETTLE_SPEND_SQL,
  SUCCEED_JOB_SQL,
  UPDATE_EDIT_SQL,
} from '../src/server/draft-ai-sql'
import { ids, migratedDatabase, seedDraft, statement } from './support/draft-ai-db'

const T0 = 1_800_000_000_000

function ledger() {
  const db = migratedDatabase()
  seedDraft(db)
  return {
    db,
    request: (kind: JobKind, now = T0) => Number(statement(db, REQUEST_JOB_SQL).run(ids.draft, ids.video, kind, now).changes),
    claim: (kind: JobKind, leaseId: string, now = T0) => statement(db, CLAIM_JOB_SQL).all(ids.draft, kind, leaseId, now),
    succeed: (kind: JobKind, leaseId: string, now = T0) =>
      Number(statement(db, SUCCEED_JOB_SQL).run(ids.draft, kind, leaseId, now).changes),
    fail: (kind: JobKind, leaseId: string, retryable: boolean, code = 'provider', now = T0) =>
      statement(db, FAIL_JOB_SQL).all(ids.draft, kind, leaseId, retryable ? 1 : 0, code, 'detail', now),
    expire: (now: number) => Number(statement(db, EXPIRE_EXHAUSTED_SQL).run(now).changes),
    failOrphans: (now = T0) => Number(statement(db, FAIL_ORPHANED_DEPENDENTS_SQL).run(now).changes),
    pending: (now: number) => statement(db, PENDING_JOBS_SQL).all(now),
    recordAudio: (leaseId: string) => Number(statement(db, RECORD_AUDIO_SQL).run(ids.draft, leaseId, 'audio-etag', 'stub', T0).changes),
    recordTranscript: (leaseId: string) =>
      Number(statement(db, RECORD_TRANSCRIPT_SQL).run(ids.draft, leaseId, 'transcript-etag', 12, 290_000, T0).changes),
    recordGeneration: (kind: JobKind, leaseId: string, text = 'generated') =>
      Number(statement(db, RECORD_GENERATION_SQL).run(ids.draft, kind, leaseId, text, 'stub', 'stub-writer', T0).changes),
    job: (kind: JobKind) => db.prepare(
      'SELECT state, request_seq, attempts, lease_id, failure_code FROM draft_ai_job WHERE draft_id = ? AND kind = ?',
    ).get(ids.draft, kind),
  }
}

type Ledger = ReturnType<typeof ledger>

function transcribe(ledger: Ledger, leaseId = 'transcript-lease') {
  ledger.request('transcript')
  ledger.claim('transcript', leaseId)
  ledger.recordAudio(leaseId)
  ledger.recordTranscript(leaseId)
  ledger.succeed('transcript', leaseId)
}

describe('draft AI job ledger', () => {
  it('queues once, ignores a double request, and claims under a lease', () => {
    const l = ledger()
    expect(l.request('transcript')).toBe(1)
    expect(l.request('transcript')).toBe(0)
    expect(l.claim('transcript', 'lease-a')).toEqual([{ video_id: ids.video, request_seq: 1, attempts: 1 }])
    expect(l.request('transcript')).toBe(0)
    expect(l.job('transcript')).toEqual({ state: 'processing', request_seq: 1, attempts: 1, lease_id: 'lease-a', failure_code: null })
  })

  it('records the transcript with its span end and never re-queues a ready transcript', () => {
    const l = ledger()
    transcribe(l)
    expect(l.db.prepare('SELECT audio_etag, transcript_etag, segment_count, span_end_ms FROM draft_transcript').get()).toEqual({
      audio_etag: 'audio-etag', transcript_etag: 'transcript-etag', segment_count: 12, span_end_ms: 290_000,
    })
    expect(l.request('transcript')).toBe(0)
    expect(l.job('transcript')).toEqual({ state: 'ready', request_seq: 1, attempts: 1, lease_id: null, failure_code: null })
  })

  it('holds a field job until the transcript lands without burning attempts', () => {
    const l = ledger()
    l.request('transcript')
    l.request('chapters')
    expect(l.claim('chapters', 'early')).toEqual([])
    expect(l.pending(T0 + QUEUED_GRACE_MS)).toEqual([{ draft_id: ids.draft, kind: 'transcript' }])
    l.claim('transcript', 'transcript-lease')
    l.recordAudio('transcript-lease')
    l.recordTranscript('transcript-lease')
    l.succeed('transcript', 'transcript-lease')
    expect(statement(l.db, QUEUED_DEPENDENTS_SQL).all(ids.draft)).toEqual([{ draft_id: ids.draft, kind: 'chapters' }])
    expect(l.pending(T0 + QUEUED_GRACE_MS)).toEqual([{ draft_id: ids.draft, kind: 'chapters' }])
    expect(l.claim('chapters', 'field-lease')).toEqual([{ video_id: ids.video, request_seq: 1, attempts: 1 }])
  })

  it('regenerates a ready field under a new request and refuses ready for the old artifact', () => {
    const l = ledger()
    transcribe(l)
    l.request('description')
    l.claim('description', 'first')
    l.recordGeneration('description', 'first', 'first text')
    expect(l.succeed('description', 'first')).toBe(1)

    expect(l.request('description')).toBe(1)
    expect(l.job('description')).toEqual({ state: 'queued', request_seq: 2, attempts: 0, lease_id: null, failure_code: null })
    l.claim('description', 'second')
    expect(() => l.succeed('description', 'second')).toThrow('draft_ai_job_ready_requires_artifact')
    l.recordGeneration('description', 'second', 'second text')
    expect(l.succeed('description', 'second')).toBe(1)
    expect(l.db.prepare('SELECT field, seq, text FROM draft_generation').all()).toEqual([
      { field: 'description', seq: 2, text: 'second text' },
    ])
  })

  it('ignores every write from a lease that was reclaimed', () => {
    const l = ledger()
    transcribe(l)
    l.request('chapters')
    l.claim('chapters', 'stale')
    const reclaimedAt = T0 + JOB_LEASE_MS
    expect(l.claim('chapters', 'fresh', reclaimedAt)).toEqual([{ video_id: ids.video, request_seq: 1, attempts: 2 }])
    expect(l.recordGeneration('chapters', 'stale')).toBe(0)
    expect(l.succeed('chapters', 'stale')).toBe(0)
    expect(l.fail('chapters', 'stale', false)).toEqual([])
    expect(l.job('chapters')).toEqual({ state: 'processing', request_seq: 1, attempts: 2, lease_id: 'fresh', failure_code: null })
    expect(l.db.prepare('SELECT COUNT(*) AS n FROM draft_generation').get()).toEqual({ n: 0 })
  })

  it('re-queues retryable failures until attempts run out, and fails permanent ones at once', () => {
    const l = ledger()
    l.request('transcript')
    for (let attempt = 1; attempt <= JOB_MAX_ATTEMPTS; attempt += 1) {
      l.claim('transcript', `lease-${attempt}`)
      const expected = attempt < JOB_MAX_ATTEMPTS ? 'queued' : 'failed'
      expect(l.fail('transcript', `lease-${attempt}`, true)).toEqual([{ state: expected }])
    }
    expect(l.claim('transcript', 'one-more')).toEqual([])
    expect(l.job('transcript')).toEqual({ state: 'failed', request_seq: 1, attempts: JOB_MAX_ATTEMPTS, lease_id: null, failure_code: 'provider' })

    expect(l.request('transcript')).toBe(1)
    l.claim('transcript', 'permanent')
    expect(l.fail('transcript', 'permanent', false, 'no-speech')).toEqual([{ state: 'failed' }])
    expect(l.job('transcript')).toEqual({ state: 'failed', request_seq: 2, attempts: 1, lease_id: null, failure_code: 'no-speech' })
  })

  it('fails an expired lease that has no attempts left as timed out', () => {
    const l = ledger()
    l.request('transcript')
    let now = T0
    for (let attempt = 1; attempt <= JOB_MAX_ATTEMPTS; attempt += 1) {
      expect(l.claim('transcript', `lease-${attempt}`, now)).toHaveLength(1)
      now += JOB_LEASE_MS
    }
    expect(l.expire(now - 1)).toBe(0)
    expect(l.claim('transcript', 'too-late', now)).toEqual([])
    expect(l.pending(now)).toEqual([])
    expect(l.job('transcript')).toEqual({ state: 'processing', request_seq: 1, attempts: JOB_MAX_ATTEMPTS, lease_id: `lease-${JOB_MAX_ATTEMPTS}`, failure_code: null })

    expect(l.expire(now)).toBe(1)
    expect(l.job('transcript')).toEqual({ state: 'failed', request_seq: 1, attempts: JOB_MAX_ATTEMPTS, lease_id: null, failure_code: 'timed-out' })
    expect(l.request('transcript')).toBe(1)
  })

  it('fails queued field jobs whose transcript failed, and leaves finished fields alone', () => {
    const l = ledger()
    l.request('transcript')
    l.request('description')
    l.claim('transcript', 'lease')
    l.fail('transcript', 'lease', false, 'no-speech')
    expect(l.failOrphans()).toBe(1)
    expect(l.job('description')).toEqual({ state: 'failed', request_seq: 1, attempts: 0, lease_id: null, failure_code: 'transcript-failed' })
    expect(l.failOrphans()).toBe(0)
  })

  it('wakes a queued job only after the grace period, and an expired lease with attempts left', () => {
    const l = ledger()
    l.request('transcript')
    expect(l.pending(T0 + QUEUED_GRACE_MS - 1)).toEqual([])
    expect(l.pending(T0 + QUEUED_GRACE_MS)).toEqual([{ draft_id: ids.draft, kind: 'transcript' }])
    l.claim('transcript', 'lease', T0 + QUEUED_GRACE_MS)
    expect(l.pending(T0 + QUEUED_GRACE_MS + JOB_LEASE_MS - 1)).toEqual([])
    expect(l.pending(T0 + QUEUED_GRACE_MS + JOB_LEASE_MS)).toEqual([{ draft_id: ids.draft, kind: 'transcript' }])
  })

  it('stops claiming once the video is tombstoned, and drops writes after the draft is purged', () => {
    const l = ledger()
    l.request('transcript')
    l.db.prepare('UPDATE video SET deleted_at = 5 WHERE id = ?').run(ids.video)
    expect(l.claim('transcript', 'lease')).toEqual([])
    l.db.prepare('UPDATE video SET deleted_at = NULL WHERE id = ?').run(ids.video)
    l.claim('transcript', 'lease')
    l.db.prepare('DELETE FROM draft WHERE id = ?').run(ids.draft)
    expect(l.recordAudio('lease')).toBe(0)
    expect(l.db.prepare('SELECT COUNT(*) AS n FROM draft_transcript').get()).toEqual({ n: 0 })
  })
})

describe('member edits', () => {
  const insertEdit = (l: Ledger, field: JobKind, text: string, baseSeq: number) =>
    Number(statement(l.db, INSERT_EDIT_SQL).run(ids.draft, ids.video, field, text, baseSeq, ids.user, T0).changes)
  const updateEdit = (l: Ledger, field: JobKind, text: string, baseSeq: number, revision: number) =>
    Number(statement(l.db, UPDATE_EDIT_SQL).run(ids.draft, ids.video, field, text, baseSeq, ids.user, T0, revision).changes)
  const edits = (l: Ledger) => l.db.prepare('SELECT field, text, base_seq, revision FROM draft_text_edit').all()

  it('saves over no generation, then advances the revision on each save', () => {
    const l = ledger()
    expect(insertEdit(l, 'description', 'typed', 0)).toBe(1)
    expect(updateEdit(l, 'description', 'typed more', 0, 1)).toBe(1)
    expect(updateEdit(l, 'description', 'from a stale tab', 0, 1)).toBe(0)
    expect(edits(l)).toEqual([{ field: 'description', text: 'typed more', base_seq: 0, revision: 2 }])
  })

  it('refuses a save while that field is generating or over an older generation', () => {
    const l = ledger()
    transcribe(l)
    l.request('chapters')
    expect(insertEdit(l, 'chapters', '0:00 Mine', 0)).toBe(0)
    expect(insertEdit(l, 'description', 'other field is fine', 0)).toBe(1)
    l.claim('chapters', 'lease')
    l.recordGeneration('chapters', 'lease')
    l.succeed('chapters', 'lease')
    expect(insertEdit(l, 'chapters', '0:00 Mine', 0)).toBe(0)
    expect(insertEdit(l, 'chapters', '0:00 Mine', 1)).toBe(1)
  })

  it('refuses a first save on a tombstoned video', () => {
    const l = ledger()
    l.db.prepare('UPDATE video SET deleted_at = 5 WHERE id = ?').run(ids.video)
    expect(insertEdit(l, 'description', 'typed', 0)).toBe(0)
  })
})

describe('monthly spend', () => {
  const reserve = (l: Ledger, id: string, microusd: number, month = '2026-10') =>
    Number(statement(l.db, RESERVE_SPEND_SQL).run(id, month, 'transcript', ids.video, ids.draft, microusd, T0, MONTHLY_AI_BUDGET).changes)
  const reserved = (l: Ledger, id: string) => statement(l.db, RESERVED_SPEND_SQL).get(id) !== undefined
  const spent = (l: Ledger, month = '2026-10') => (statement(l.db, MONTH_SPEND_SQL).get(month) as { spent: number }).spent

  it('reserves up to the cap and refuses the charge that would cross it', () => {
    const l = ledger()
    expect(reserve(l, 'a', MONTHLY_AI_BUDGET - 10)).toBe(1)
    expect(reserve(l, 'b', 11)).toBe(0)
    expect(reserved(l, 'b')).toBe(false)
    expect(reserve(l, 'c', 10)).toBe(1)
    expect(spent(l)).toBe(MONTHLY_AI_BUDGET)
    expect(reserve(l, 'next-month', 10, '2026-11')).toBe(1)
  })

  it('treats a repeated charge id as the same reservation', () => {
    const l = ledger()
    expect(reserve(l, 'charge', 100)).toBe(1)
    expect(reserve(l, 'charge', 100)).toBe(0)
    expect(reserved(l, 'charge')).toBe(true)
    expect(spent(l)).toBe(100)
  })

  it('settles a reservation to the measured cost', () => {
    const l = ledger()
    reserve(l, 'charge', 1_000)
    statement(l.db, SETTLE_SPEND_SQL).run('charge', 420, 60_000, null, null, T0)
    expect(l.db.prepare('SELECT microusd, settled, audio_ms FROM ai_spend').get()).toEqual({ microusd: 420, settled: 1, audio_ms: 60_000 })
    expect(spent(l)).toBe(420)
  })
})
