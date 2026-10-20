import { JOB_LEASE_MS, JOB_MAX_ATTEMPTS, QUEUED_GRACE_MS } from '#/domain/draft-ai'

/**
 * ready or failed -> queued with a new request_seq and attempts reset. A no-op while queued or processing,
 * so a double click is idempotent. A ready transcript never re-queues.
 * ?1 draft_id ?2 video_id ?3 kind ?4 now
 */
export const REQUEST_JOB_SQL = `
INSERT INTO draft_ai_job (draft_id, video_id, kind, request_seq, state, attempts, created_at, updated_at)
VALUES (?1, ?2, ?3, 1, 'queued', 0, ?4, ?4)
ON CONFLICT (draft_id, kind) DO UPDATE SET
  request_seq = draft_ai_job.request_seq + 1, state = 'queued', attempts = 0,
  lease_id = NULL, lease_until = NULL, failure_code = NULL, failure_detail = NULL,
  updated_at = excluded.updated_at
WHERE draft_ai_job.state = 'failed'
   OR (draft_ai_job.state = 'ready' AND draft_ai_job.kind != 'transcript')`

/**
 * queued, or processing with an expired lease and attempts left -> processing under a fresh lease id.
 * Field jobs claim only once the transcript exists, so waiting never burns an attempt.
 * ?1 draft_id ?2 kind ?3 lease_id ?4 now
 */
export const CLAIM_JOB_SQL = `
UPDATE draft_ai_job SET
  state = 'processing', attempts = attempts + 1, lease_id = ?3, lease_until = ?4 + ${JOB_LEASE_MS}, updated_at = ?4
WHERE draft_id = ?1 AND kind = ?2 AND attempts < ${JOB_MAX_ATTEMPTS}
  AND (state = 'queued' OR (state = 'processing' AND lease_until <= ?4))
  AND EXISTS (SELECT 1 FROM video v WHERE v.id = draft_ai_job.video_id AND v.deleted_at IS NULL)
  AND (kind = 'transcript' OR EXISTS (
    SELECT 1 FROM draft_transcript t WHERE t.draft_id = ?1 AND t.transcript_etag IS NOT NULL))
RETURNING video_id, request_seq, attempts`

/** ?1 draft_id ?2 kind ?3 lease_id ?4 now */
export const SUCCEED_JOB_SQL = `
UPDATE draft_ai_job SET
  state = 'ready', lease_id = NULL, lease_until = NULL, failure_code = NULL, failure_detail = NULL, updated_at = ?4
WHERE draft_id = ?1 AND kind = ?2 AND lease_id = ?3`

/**
 * processing -> queued when retryable with attempts left, else failed. Fenced by lease_id.
 * ?1 draft_id ?2 kind ?3 lease_id ?4 retryable (0 or 1) ?5 code ?6 detail ?7 now
 */
export const FAIL_JOB_SQL = `
UPDATE draft_ai_job SET
  state = CASE WHEN ?4 = 1 AND attempts < ${JOB_MAX_ATTEMPTS} THEN 'queued' ELSE 'failed' END,
  failure_code = ?5, failure_detail = ?6, lease_id = NULL, lease_until = NULL, updated_at = ?7
WHERE draft_id = ?1 AND kind = ?2 AND lease_id = ?3
RETURNING state`

/** An expired lease with no attempts left can never be claimed again, so it fails here. ?1 now */
export const EXPIRE_EXHAUSTED_SQL = `
UPDATE draft_ai_job SET
  state = 'failed', failure_code = 'timed-out', failure_detail = 'The job stopped responding.',
  lease_id = NULL, lease_until = NULL, updated_at = ?1
WHERE state = 'processing' AND lease_until <= ?1 AND attempts >= ${JOB_MAX_ATTEMPTS}`

/** A queued field job whose transcript failed can never claim. Failing it lets the panel offer Retry. ?1 now */
export const FAIL_ORPHANED_DEPENDENTS_SQL = `
UPDATE draft_ai_job SET
  state = 'failed', failure_code = 'transcript-failed', failure_detail = NULL, updated_at = ?1
WHERE kind != 'transcript' AND state = 'queued' AND EXISTS (
  SELECT 1 FROM draft_ai_job t
  WHERE t.draft_id = draft_ai_job.draft_id AND t.kind = 'transcript' AND t.state = 'failed')`

/** Cron wake-ups for lost messages and expired leases with attempts left. ?1 now */
export const PENDING_JOBS_SQL = `
SELECT j.draft_id, j.kind FROM draft_ai_job j
WHERE ((j.state = 'queued' AND j.updated_at <= ?1 - ${QUEUED_GRACE_MS})
    OR (j.state = 'processing' AND j.lease_until <= ?1 AND j.attempts < ${JOB_MAX_ATTEMPTS}))
  AND (j.kind = 'transcript' OR EXISTS (
    SELECT 1 FROM draft_transcript t WHERE t.draft_id = j.draft_id AND t.transcript_etag IS NOT NULL))
ORDER BY j.updated_at ASC LIMIT 50`

/** Field jobs to wake right after the transcript lands. ?1 draft_id */
export const QUEUED_DEPENDENTS_SQL = `
SELECT draft_id, kind FROM draft_ai_job WHERE draft_id = ?1 AND kind != 'transcript' AND state = 'queued'`

/**
 * Lease-fenced artifact writes. Zero rows change when the job row is gone, because the video was purged
 * and the draft cascaded, or when the lease was lost.
 * ?1 draft_id ?2 lease_id ?3 audio_etag ?4 provider ?5 now
 */
export const RECORD_AUDIO_SQL = `
INSERT INTO draft_transcript (draft_id, video_id, audio_etag, provider, created_at, updated_at)
SELECT j.draft_id, j.video_id, ?3, ?4, ?5, ?5 FROM draft_ai_job j
WHERE j.draft_id = ?1 AND j.kind = 'transcript' AND j.lease_id = ?2
ON CONFLICT (draft_id) DO UPDATE SET audio_etag = excluded.audio_etag, provider = excluded.provider,
  updated_at = excluded.updated_at`

/** ?1 draft_id ?2 lease_id ?3 transcript_etag ?4 segment_count ?5 span_end_ms ?6 now */
export const RECORD_TRANSCRIPT_SQL = `
UPDATE draft_transcript SET transcript_etag = ?3, segment_count = ?4, span_end_ms = ?5, updated_at = ?6
WHERE draft_id = ?1 AND EXISTS (
  SELECT 1 FROM draft_ai_job j WHERE j.draft_id = ?1 AND j.kind = 'transcript' AND j.lease_id = ?2)`

/** ?1 draft_id ?2 kind ?3 lease_id ?4 text ?5 provider ?6 model ?7 now */
export const RECORD_GENERATION_SQL = `
INSERT INTO draft_generation (draft_id, video_id, field, seq, text, provider, model, created_at)
SELECT j.draft_id, j.video_id, j.kind, j.request_seq, ?4, ?5, ?6, ?7 FROM draft_ai_job j
WHERE j.draft_id = ?1 AND j.kind = ?2 AND j.lease_id = ?3
ON CONFLICT (draft_id, field) DO UPDATE SET seq = excluded.seq, text = excluded.text,
  provider = excluded.provider, model = excluded.model, created_at = excluded.created_at`

/** The draft a member is looking at, only while its video is live. ?1 draft_id ?2 video_id */
export const PANEL_DRAFT_SQL = `
SELECT d.id, d.video_id, d.version, d.duration_ms, f.byte_size, f.object_key, f.content_type, v.format, v.title
FROM draft d
JOIN video v ON v.id = d.video_id AND v.deleted_at IS NULL
JOIN media_file f ON f.id = d.media_file_id AND f.video_id = d.video_id
WHERE d.id = ?1 AND d.video_id = ?2`

/** ?1 draft_id */
export const PANEL_JOBS_SQL = `
SELECT kind, state, request_seq, failure_code, failure_detail FROM draft_ai_job WHERE draft_id = ?1`

/** ?1 draft_id */
export const PANEL_TRANSCRIPT_SQL = `
SELECT transcript_etag, segment_count, span_end_ms, provider FROM draft_transcript WHERE draft_id = ?1`

/** ?1 draft_id */
export const PANEL_GENERATIONS_SQL = `SELECT field, seq, text, provider FROM draft_generation WHERE draft_id = ?1`

/** ?1 draft_id */
export const PANEL_EDITS_SQL = `SELECT field, text, base_seq, revision FROM draft_text_edit WHERE draft_id = ?1`

/** ?1 month */
export const MONTH_SPEND_SQL = `SELECT COALESCE(SUM(microusd), 0) AS spent FROM ai_spend WHERE month = ?1`

/**
 * Inserts only while the month stays within the cap. INSERT OR IGNORE makes a repeat of the same charge id
 * a no-op, and RESERVED_SPEND_SQL then still finds the earlier row.
 * ?1 id ?2 month ?3 kind ?4 video_id ?5 draft_id ?6 estimate ?7 now ?8 cap
 */
export const RESERVE_SPEND_SQL = `
INSERT OR IGNORE INTO ai_spend (id, month, kind, video_id, draft_id, microusd, settled, created_at, updated_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7
WHERE (SELECT COALESCE(SUM(microusd), 0) FROM ai_spend WHERE month = ?2) + ?6 <= ?8`

/** ?1 id */
export const RESERVED_SPEND_SQL = `SELECT id FROM ai_spend WHERE id = ?1`

/** ?1 id ?2 microusd ?3 audio_ms ?4 input_tokens ?5 output_tokens ?6 now */
export const SETTLE_SPEND_SQL = `
UPDATE ai_spend SET microusd = ?2, settled = 1, audio_ms = ?3, input_tokens = ?4, output_tokens = ?5, updated_at = ?6
WHERE id = ?1`

/**
 * A member's write lands only over the current generation and while no run for the field is in flight.
 * ?1 draft_id ?3 field ?5 base_seq
 */
const EDIT_ALLOWED_SQL = `
  ?5 = COALESCE((SELECT g.seq FROM draft_generation g WHERE g.draft_id = ?1 AND g.field = ?3), 0)
  AND NOT EXISTS (SELECT 1 FROM draft_ai_job j
    WHERE j.draft_id = ?1 AND j.kind = ?3 AND j.state IN ('queued', 'processing'))`

/** First save for a field. ?1 draft_id ?2 video_id ?3 field ?4 text ?5 base_seq ?6 user_id ?7 now */
export const INSERT_EDIT_SQL = `
INSERT OR IGNORE INTO draft_text_edit (draft_id, video_id, field, text, base_seq, revision, updated_by_user_id, updated_at)
SELECT d.id, d.video_id, ?3, ?4, ?5, 1, ?6, ?7
FROM draft d JOIN video v ON v.id = d.video_id AND v.deleted_at IS NULL
WHERE d.id = ?1 AND d.video_id = ?2 AND ${EDIT_ALLOWED_SQL}`

/** Later saves. ?8 expected revision. */
export const UPDATE_EDIT_SQL = `
UPDATE draft_text_edit SET text = ?4, base_seq = ?5, revision = revision + 1, updated_by_user_id = ?6, updated_at = ?7
WHERE draft_id = ?1 AND video_id = ?2 AND field = ?3 AND revision = ?8 AND ${EDIT_ALLOWED_SQL}`
