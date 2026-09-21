import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  failedSave,
  filterVideos,
  groupVideos,
  parseListConfig,
  parsePlanningQuery,
  parseProduction,
  parseSavedViewName,
  type Video,
} from '../src/domain/videos'
import { buildCalendarMonth, calendarMonthRange, parseCalendarMonth, shiftCalendarMonth } from '../src/domain/calendar'
import { emptyRichDocument } from '../src/server/rich-document'
import { ACTIVE_VIDEO_SQL, UPDATE_VIDEO_SQL, calendarVideosSql, organicVideoOptionsSql } from '../src/server/video-sql'

const first: Video = {
  id: '1b0e913b-645c-4306-a71d-78115390b46d',
  title: 'Beta',
  production: { format: 'short', promotion: 'organic' },
  status: 'filming',
  publishDate: null,
  script: emptyRichDocument(),
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
}

const second: Video = { ...first, id: '28a2b4a2-1ee2-44d8-8e3a-0c2dbd5b2d27', title: 'Alpha', production: { format: 'long', promotion: 'integration', organicVideoId: null }, status: 'published', publishDate: '2026-10-01', updatedAt: 2 }

const ids = {
  target: '1b0e913b-645c-4306-a71d-78115390b46d',
  otherTarget: '28a2b4a2-1ee2-44d8-8e3a-0c2dbd5b2d27',
  firstSource: '3879b960-ec74-4c13-b823-c6d32cb15b7d',
  secondSource: '4a686415-fc7e-47ec-818b-775817a66c7e',
  missing: '5b93d874-2479-4d98-8b3d-49e6c2fb9330',
} as const

function planningDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE "user" ("id" TEXT PRIMARY KEY NOT NULL);')
  db.exec(readFileSync(resolve(process.cwd(), 'migrations/0002_planning.sql'), 'utf8'))
  db.exec(readFileSync(resolve(process.cwd(), 'migrations/0005_integration_organic_link.sql'), 'utf8'))
  db.exec(readFileSync(resolve(process.cwd(), 'migrations/0007_video_calendar.sql'), 'utf8'))
  return db
}

function insertVideo(
  db: DatabaseSync,
  id: string,
  format: 'short' | 'long',
  promotion: 'organic' | 'advertisement' | 'integration',
  linkedOrganicVideoId: string | null = null,
  deletedAt: number | null = null,
): void {
  db.prepare(`INSERT INTO video (
    id, title, format, promotion, linked_organic_video_id, status, script_json,
    revision, created_at, updated_at, deleted_at
  ) VALUES (?, ?, ?, ?, ?, 'not-started', '{"type":"doc","content":[]}', 1, 1, 1, ?)`).run(
    id,
    `Video ${id}`,
    format,
    promotion,
    linkedOrganicVideoId,
    deletedAt,
  )
}

function updateLink(
  db: DatabaseSync,
  id: string,
  expectedRevision: number,
  linkedOrganicVideoId: string | null,
): number {
  return Number(db.prepare(UPDATE_VIDEO_SQL).run(
    `Video ${id}`,
    'long',
    'integration',
    linkedOrganicVideoId,
    'not-started',
    null,
    '{"type":"doc","content":[]}',
    10,
    id,
    expectedRevision,
    linkedOrganicVideoId,
    linkedOrganicVideoId,
  ).changes)
}

describe('video planning domain', () => {
  it('keeps promotion legal for its format', () => {
    expect(parseProduction({ format: 'short', promotion: 'advertisement' })).toEqual({ format: 'short', promotion: 'advertisement' })
    expect(parseProduction({ format: 'long', promotion: 'integration' })).toEqual({ format: 'long', promotion: 'integration', organicVideoId: null })
    expect(parseProduction({ format: 'long', promotion: 'integration', organicVideoId: ids.target })).toEqual({ format: 'long', promotion: 'integration', organicVideoId: ids.target })
    expect(() => parseProduction({ format: 'short', promotion: 'integration' })).toThrow('not available')
    expect(() => parseProduction({ format: 'long', promotion: 'organic', organicVideoId: ids.target })).toThrow('Only long-form integrations')
  })

  it('rejects an impossible board grouping and parses a user-owned view name', () => {
    expect(() => parseListConfig({ layout: 'board', groupBy: 'format', status: 'all', format: 'all', sort: 'updated-desc' })).toThrow('incompatible')
    expect(parseSavedViewName('  Review queue  ')).toBe('Review queue')
  })

  it('accepts only positive planning pages', () => {
    expect(parsePlanningQuery({ layout: 'list', groupBy: 'none', status: 'all', format: 'all', sort: 'updated-desc', page: '2', month: '2026-09' }).page).toBe(2)
    expect(() => parsePlanningQuery({ layout: 'list', groupBy: 'none', status: 'all', format: 'all', sort: 'updated-desc', page: 0, month: '2026-09' })).toThrow('Page')
  })

  it('models calendar as a fixed publish-date view with a strict month', () => {
    expect(parseListConfig({ layout: 'calendar', groupBy: 'none', status: 'all', format: 'all', sort: 'publish-date-asc' })).toMatchObject({ layout: 'calendar' })
    expect(() => parseListConfig({ layout: 'calendar', groupBy: 'status', status: 'all', format: 'all', sort: 'publish-date-asc' })).toThrow('incompatible')
    expect(() => parseCalendarMonth('2026-9')).toThrow('month')
    expect(() => parseCalendarMonth('2026-13')).toThrow('month')
  })

  it('builds a stable six-week UTC grid across leap days and year shifts', () => {
    expect(shiftCalendarMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftCalendarMonth('2026-12', 1)).toBe('2027-01')
    expect(calendarMonthRange('2024-02')).toEqual({ start: '2024-02-01', end: '2024-03-01' })
    const days = buildCalendarMonth('2024-02', [{ ...second, publishDate: '2024-02-29' }])
    expect(days).toHaveLength(42)
    expect(days[0]?.date).toBe('2024-01-28')
    expect(days.at(-1)?.date).toBe('2024-03-09')
    expect(days.find((day) => day.date === '2024-02-29')?.videos).toHaveLength(1)
  })

  it('loads every scheduled video in the requested month without pagination', () => {
    const db = planningDatabase()
    for (let index = 0; index < 25; index += 1) {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      insertVideo(db, id, index % 2 === 0 ? 'short' : 'long', 'organic')
      db.prepare('UPDATE video SET publish_date = ? WHERE id = ?').run(`2026-09-${String(index + 1).padStart(2, '0')}`, id)
    }
    insertVideo(db, ids.missing, 'short', 'organic')
    db.prepare("UPDATE video SET publish_date = '2026-10-01' WHERE id = ?").run(ids.missing)
    const rows = db.prepare(calendarVideosSql(false, false)).all('2026-09-01', '2026-10-01')
    expect(rows).toHaveLength(25)
    expect(rows[0]?.publish_date).toBe('2026-09-01')
    expect(rows.at(-1)?.publish_date).toBe('2026-09-25')
    db.close()
  })

  it('preserves existing saved views while allowing calendar views', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON; CREATE TABLE "user" ("id" TEXT PRIMARY KEY NOT NULL);')
    db.exec("INSERT INTO user (id) VALUES ('owner')")
    db.exec(readFileSync(resolve(process.cwd(), 'migrations/0002_planning.sql'), 'utf8'))
    db.exec(`INSERT INTO saved_view VALUES (
      '${ids.target}', 'owner', 'Existing board', 'board', 'status', 'all', 'all', 'updated-desc', 1, 1
    )`)
    db.exec(readFileSync(resolve(process.cwd(), 'migrations/0005_integration_organic_link.sql'), 'utf8'))
    db.exec(readFileSync(resolve(process.cwd(), 'migrations/0007_video_calendar.sql'), 'utf8'))
    expect(db.prepare('SELECT name, layout, group_by FROM saved_view').all()).toEqual([
      { name: 'Existing board', layout: 'board', group_by: 'status' },
    ])
    db.exec(`INSERT INTO saved_view VALUES (
      '${ids.otherTarget}', 'owner', 'Calendar', 'calendar', 'none', 'all', 'all', 'publish-date-asc', 2, 2
    )`)
    expect(db.prepare("SELECT layout FROM saved_view WHERE name = 'Calendar'").get()).toEqual({ layout: 'calendar' })
    db.close()
  })

  it('renders metadata-only calendar cards that link to the video detail', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/routes/_app.videos.tsx'), 'utf8')
    const card = route.slice(route.indexOf('function CalendarVideoCard'), route.indexOf('function VideoCalendar'))
    expect(card).toContain('href={`/videos/${video.id}`}')
    expect(card).toContain('video.production.format')
    expect(card).toContain('video.production.promotion')
    expect(card).toContain('STATUS[video.status].label')
    expect(card).not.toMatch(/<(?:img|video|picture|source)\b/)
    expect(card).not.toContain('MediaPreview')
    expect(card).not.toMatch(/<(?:button|select|input)\b/i)
  })

  it('filters, sorts, and groups the visible task collection', () => {
    const config = parseListConfig({ layout: 'list', groupBy: 'format', status: 'all', format: 'all', sort: 'title-asc' })
    expect(filterVideos([first, second], { ...config, format: 'long' })).toEqual([second])
    expect([...groupVideos([first, second], config)]).toEqual([['long', [second]], ['short', [first]]])
  })

  it('classifies a failed conditional save without inventing a fourth state', () => {
    expect(failedSave(second)).toEqual({ kind: 'conflict', latest: second })
    expect(failedSave(null)).toEqual({ kind: 'not-found' })
  })

  it('omits a tombstoned row through the store active predicate', () => {
    const db = planningDatabase()
    db.exec(`
      INSERT INTO video (id, title, format, promotion, status, script_json, revision, created_at, updated_at)
      VALUES ('1b0e913b-645c-4306-a71d-78115390b46d', 'Active', 'short', 'organic', 'not-started', '{"type":"doc","content":[]}', 1, 1, 1);
      INSERT INTO video (id, title, format, promotion, status, script_json, revision, created_at, updated_at, deleted_at)
      VALUES ('28a2b4a2-1ee2-44d8-8e3a-0c2dbd5b2d27', 'Deleted', 'long', 'organic', 'not-started', '{"type":"doc","content":[]}', 1, 1, 1, 2);
    `)
    expect(db.prepare(`SELECT title FROM video WHERE ${ACTIVE_VIDEO_SQL}`).all()).toEqual([
      { title: 'Active' },
    ])
    db.close()
  })

  it('allows integrations to share one active organic long-form target', () => {
    const db = planningDatabase()
    insertVideo(db, ids.target, 'long', 'organic')
    insertVideo(db, ids.firstSource, 'long', 'integration', ids.target)
    insertVideo(db, ids.secondSource, 'long', 'integration', ids.target)

    expect(db.prepare(
      'SELECT id, linked_organic_video_id FROM video WHERE linked_organic_video_id IS NOT NULL ORDER BY id',
    ).all()).toEqual([
      { id: ids.firstSource, linked_organic_video_id: ids.target },
      { id: ids.secondSource, linked_organic_video_id: ids.target },
    ])
    db.close()
  })

  it('lists active organic long-form candidates by stable title order and excludes the current video', () => {
    const db = planningDatabase()
    insertVideo(db, ids.target, 'long', 'organic')
    insertVideo(db, ids.otherTarget, 'long', 'organic')
    insertVideo(db, ids.firstSource, 'short', 'organic')
    db.prepare("UPDATE video SET title = 'Zulu', status = 'filming', publish_date = '2026-10-02' WHERE id = ?").run(ids.target)
    db.prepare("UPDATE video SET title = 'alpha', status = 'published' WHERE id = ?").run(ids.otherTarget)

    expect(db.prepare(organicVideoOptionsSql(false)).all()).toEqual([
      { id: ids.otherTarget, title: 'alpha', status: 'published', publish_date: null },
      { id: ids.target, title: 'Zulu', status: 'filming', publish_date: '2026-10-02' },
    ])
    expect(db.prepare(organicVideoOptionsSql(true)).all(ids.otherTarget)).toEqual([
      { id: ids.target, title: 'Zulu', status: 'filming', publish_date: '2026-10-02' },
    ])
    db.close()
  })

  it('rejects missing, deleted, or ineligible targets and non-integration sources', () => {
    const db = planningDatabase()
    insertVideo(db, ids.target, 'short', 'organic')
    insertVideo(db, ids.otherTarget, 'long', 'organic', null, 2)

    expect(() => insertVideo(db, ids.firstSource, 'long', 'integration', ids.missing)).toThrow('video-link-invalid')
    expect(() => insertVideo(db, ids.firstSource, 'long', 'integration', ids.target)).toThrow('video-link-invalid')
    expect(() => insertVideo(db, ids.firstSource, 'long', 'integration', ids.otherTarget)).toThrow('video-link-invalid')
    db.prepare("UPDATE video SET format = 'long' WHERE id = ?").run(ids.target)
    expect(() => insertVideo(db, ids.firstSource, 'long', 'organic', ids.target)).toThrow('video-link-invalid')
    expect(db.prepare('SELECT COUNT(*) AS count FROM video WHERE id = ?').get(ids.firstSource)).toEqual({ count: 0 })
    db.close()
  })

  it('rejects an organic video reclassified into a self-linked integration', () => {
    const db = planningDatabase()
    insertVideo(db, ids.target, 'long', 'organic')

    expect(() => updateLink(db, ids.target, 1, ids.target)).toThrow('video-link-invalid')
    expect(db.prepare(
      'SELECT format, promotion, linked_organic_video_id, revision FROM video WHERE id = ?',
    ).get(ids.target)).toEqual({
      format: 'long',
      promotion: 'organic',
      linked_organic_video_id: null,
      revision: 1,
    })
    db.close()
  })

  it('links and unlinks through the optimistic store update while incrementing revision', () => {
    const db = planningDatabase()
    insertVideo(db, ids.target, 'long', 'organic')
    insertVideo(db, ids.firstSource, 'long', 'integration')

    expect(updateLink(db, ids.firstSource, 1, ids.target)).toBe(1)
    expect(db.prepare('SELECT linked_organic_video_id, revision FROM video WHERE id = ?').get(ids.firstSource)).toEqual({
      linked_organic_video_id: ids.target,
      revision: 2,
    })
    expect(updateLink(db, ids.firstSource, 2, null)).toBe(1)
    expect(db.prepare('SELECT linked_organic_video_id, revision FROM video WHERE id = ?').get(ids.firstSource)).toEqual({
      linked_organic_video_id: null,
      revision: 3,
    })
    db.close()
  })

  it('clears dependent links and bumps their revision when a target becomes ineligible', () => {
    const db = planningDatabase()
    insertVideo(db, ids.target, 'long', 'organic')
    insertVideo(db, ids.firstSource, 'long', 'integration', ids.target)
    db.prepare("UPDATE video SET format = 'short', updated_at = 5 WHERE id = ?").run(ids.target)

    expect(db.prepare('SELECT linked_organic_video_id, revision, updated_at FROM video WHERE id = ?').get(ids.firstSource)).toEqual({
      linked_organic_video_id: null,
      revision: 2,
      updated_at: 5,
    })
    db.close()
  })

  it('clears dependent links when an organic target is tombstoned', () => {
    const db = planningDatabase()
    insertVideo(db, ids.target, 'long', 'organic')
    insertVideo(db, ids.firstSource, 'long', 'integration', ids.target)
    db.prepare('UPDATE video SET deleted_at = 7, updated_at = 7 WHERE id = ?').run(ids.target)

    expect(db.prepare('SELECT linked_organic_video_id, revision, updated_at FROM video WHERE id = ?').get(ids.firstSource)).toEqual({
      linked_organic_video_id: null,
      revision: 2,
      updated_at: 7,
    })
    db.close()
  })

  it('leaves a source unchanged for invalid targets and stale revisions', () => {
    const db = planningDatabase()
    insertVideo(db, ids.target, 'long', 'organic')
    insertVideo(db, ids.firstSource, 'long', 'integration')

    expect(updateLink(db, ids.firstSource, 1, ids.missing)).toBe(0)
    expect(updateLink(db, ids.firstSource, 0, ids.target)).toBe(0)
    expect(db.prepare('SELECT linked_organic_video_id, revision, updated_at FROM video WHERE id = ?').get(ids.firstSource)).toEqual({
      linked_organic_video_id: null,
      revision: 1,
      updated_at: 1,
    })
    db.close()
  })

  it('hard-deletes a target without leaving a dangling link', () => {
    const db = planningDatabase()
    insertVideo(db, ids.target, 'long', 'organic')
    insertVideo(db, ids.firstSource, 'long', 'integration', ids.target)
    db.prepare('DELETE FROM video WHERE id = ?').run(ids.target)

    expect(db.prepare('SELECT linked_organic_video_id, revision FROM video WHERE id = ?').get(ids.firstSource)).toEqual({
      linked_organic_video_id: null,
      revision: 2,
    })
    db.close()
  })

  it('requires a tombstoned source to clear its outgoing link', () => {
    const db = planningDatabase()
    insertVideo(db, ids.target, 'long', 'organic')
    insertVideo(db, ids.firstSource, 'long', 'integration', ids.target)

    expect(() => db.prepare('UPDATE video SET deleted_at = 9 WHERE id = ?').run(ids.firstSource)).toThrow('video-link-invalid')
    db.prepare('UPDATE video SET deleted_at = 9, linked_organic_video_id = NULL WHERE id = ?').run(ids.firstSource)
    expect(db.prepare('SELECT deleted_at, linked_organic_video_id FROM video WHERE id = ?').get(ids.firstSource)).toEqual({
      deleted_at: 9,
      linked_organic_video_id: null,
    })
    db.close()
  })
})
