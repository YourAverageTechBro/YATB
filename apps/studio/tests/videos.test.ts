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
import { emptyRichDocument } from '../src/server/rich-document'
import { ACTIVE_VIDEO_SQL } from '../src/server/video-sql'

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

const second: Video = { ...first, id: '28a2b4a2-1ee2-44d8-8e3a-0c2dbd5b2d27', title: 'Alpha', production: { format: 'long', promotion: 'integration' }, status: 'published', publishDate: '2026-10-01', updatedAt: 2 }

describe('video planning domain', () => {
  it('keeps promotion legal for its format', () => {
    expect(parseProduction({ format: 'short', promotion: 'advertisement' })).toEqual({ format: 'short', promotion: 'advertisement' })
    expect(() => parseProduction({ format: 'short', promotion: 'integration' })).toThrow('not available')
  })

  it('rejects an impossible board grouping and parses a user-owned view name', () => {
    expect(() => parseListConfig({ layout: 'board', groupBy: 'format', status: 'all', format: 'all', sort: 'updated-desc' })).toThrow('incompatible')
    expect(parseSavedViewName('  Review queue  ')).toBe('Review queue')
  })

  it('accepts only positive planning pages', () => {
    expect(parsePlanningQuery({ layout: 'list', groupBy: 'none', status: 'all', format: 'all', sort: 'updated-desc', page: '2' }).page).toBe(2)
    expect(() => parsePlanningQuery({ layout: 'list', groupBy: 'none', status: 'all', format: 'all', sort: 'updated-desc', page: 0 })).toThrow('Page')
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
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE "user" ("id" TEXT PRIMARY KEY NOT NULL);')
    db.exec(readFileSync(resolve(process.cwd(), 'migrations/0002_planning.sql'), 'utf8'))
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
})
