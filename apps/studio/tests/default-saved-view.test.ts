import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from 'vitest'
import { SET_DEFAULT_SAVED_VIEW_SQL } from '#/server/video-sql'

test('defaults switch atomically, reject foreign views, and clear when the selected view is deleted', () => {
  const db = new DatabaseSync(':memory:')
  const migrationsDir = resolve(process.cwd(), 'migrations')
  db.exec('PRAGMA foreign_keys = ON')
  for (const migration of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(resolve(migrationsDir, migration), 'utf8'))
  }
  db.exec(`
    INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES
      ('alice', 'Alice', 'alice@example.com', 1, 1, 1),
      ('bob', 'Bob', 'bob@example.com', 1, 1, 1);
  `)
  const insert = db.prepare(`INSERT INTO saved_view VALUES (?, ?, ?, 'list', 'none', '["filming"]', 'all', 'updated-desc', 1, 1)`)
  insert.run('a1', 'alice', 'First')
  insert.run('a2', 'alice', 'Second')
  insert.run('b1', 'bob', 'Private')
  const setDefault = db.prepare(SET_DEFAULT_SAVED_VIEW_SQL)
  const current = () => db.prepare('SELECT default_saved_view_id FROM user_video_preference WHERE owner_user_id = ?').get('alice')
  setDefault.run('alice', 'a1')
  expect(current()).toEqual({ default_saved_view_id: 'a1' })
  setDefault.run('alice', 'a2')
  expect(current()).toEqual({ default_saved_view_id: 'a2' })
  expect(setDefault.run('alice', 'b1').changes).toBe(0)
  expect(current()).toEqual({ default_saved_view_id: 'a2' })
  expect(() => db.prepare('UPDATE user_video_preference SET default_saved_view_id = ? WHERE owner_user_id = ?').run('b1', 'alice')).toThrow()
  db.prepare('DELETE FROM saved_view WHERE id = ?').run('a2')
  expect(db.prepare('SELECT count(*) AS total FROM user_video_preference').get()).toEqual({ total: 0 })
  setDefault.run('bob', 'b1')
  db.prepare('DELETE FROM user WHERE id = ?').run('bob')
  expect(db.prepare('SELECT count(*) AS total FROM user_video_preference').get()).toEqual({ total: 0 })
  db.close()
})
