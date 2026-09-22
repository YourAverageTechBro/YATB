import { VIDEO_STATUSES, type VideoStatusFilter } from '#/domain/videos'

export const ACTIVE_VIDEO_SQL = 'deleted_at IS NULL'
export const ORGANIC_LONG_VIDEO_SQL = `${ACTIVE_VIDEO_SQL} AND format = 'long' AND promotion = 'organic'`

export function organicVideoOptionsSql(excludeCurrent: boolean): string {
  return `SELECT id, title, status, publish_date
FROM video
WHERE ${ORGANIC_LONG_VIDEO_SQL}${excludeCurrent ? ' AND id != ?' : ''}
ORDER BY title COLLATE NOCASE ASC, id ASC`
}

export function statusFilterSql(statuses: VideoStatusFilter): Readonly<{ clause: string; values: VideoStatusFilter }> {
  if (statuses.length === VIDEO_STATUSES.length) return { clause: '', values: [] }
  if (statuses.length === 0) return { clause: ' AND 0 = 1', values: [] }
  return {
    clause: ` AND status IN (${Array.from({ length: statuses.length }, () => '?').join(', ')})`,
    values: statuses,
  }
}

export function calendarVideosSql(statuses: VideoStatusFilter, filterFormat: boolean): string {
  const status = statusFilterSql(statuses)
  return `SELECT id, title, format, promotion, linked_organic_video_id, status, publish_date, revision, created_at, updated_at
FROM video
WHERE ${ACTIVE_VIDEO_SQL} AND publish_date >= ? AND publish_date < ?${status.clause}${filterFormat ? ' AND format = ?' : ''}
ORDER BY publish_date ASC, title COLLATE NOCASE ASC, id ASC`
}

export const CREATE_VIDEO_SQL = `INSERT INTO video (
  id, title, format, promotion, linked_organic_video_id, status, publish_date,
  script_json, revision, created_at, updated_at
)
SELECT ?, ?, ?, ?, ?, 'not-started', ?, ?, 1, ?, ?
WHERE ? IS NULL OR EXISTS (
  SELECT 1 FROM video WHERE id = ? AND ${ORGANIC_LONG_VIDEO_SQL}
)`

export const UPDATE_VIDEO_SQL = `UPDATE video SET
  title = ?, format = ?, promotion = ?, linked_organic_video_id = ?, status = ?,
  publish_date = ?, script_json = ?, revision = revision + 1, updated_at = ?
WHERE id = ? AND revision = ? AND ${ACTIVE_VIDEO_SQL}
  AND (? IS NULL OR EXISTS (
    SELECT 1 FROM video WHERE id = ? AND ${ORGANIC_LONG_VIDEO_SQL}
  ))`
