export const ACTIVE_VIDEO_SQL = 'deleted_at IS NULL'
export const ORGANIC_LONG_VIDEO_SQL = `${ACTIVE_VIDEO_SQL} AND format = 'long' AND promotion = 'organic'`

export function organicVideoOptionsSql(excludeCurrent: boolean): string {
  return `SELECT id, title, status, publish_date
FROM video
WHERE ${ORGANIC_LONG_VIDEO_SQL}${excludeCurrent ? ' AND id != ?' : ''}
ORDER BY title COLLATE NOCASE ASC, id ASC`
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
