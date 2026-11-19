import { describe, expect, it } from 'vitest'
import { COMMENT_STATUSES, ReviewError, canTransition, formatAnchor, parseAnchor, parseBody, type CommentStatus } from '../shared/domain.ts'

describe('status state machine', () => {
  const allowed: [CommentStatus, CommentStatus][] = [['open', 'addressed'], ['addressed', 'resolved'], ['addressed', 'open'], ['resolved', 'open']]

  it.each(allowed)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it('rejects every other change', () => {
    for (const from of COMMENT_STATUSES) for (const to of COMMENT_STATUSES) {
      if (!allowed.some(([a, b]) => a === from && b === to)) expect(canTransition(from, to)).toBe(false)
    }
  })
})

describe('anchor parsing', () => {
  it('accepts a point and a range', () => {
    expect(parseAnchor({ kind: 'point', atMs: 1234.4 })).toEqual({ kind: 'point', atMs: 1234 })
    expect(parseAnchor({ kind: 'range', startMs: 1000, endMs: 2500 })).toEqual({ kind: 'range', startMs: 1000, endMs: 2500 })
  })

  it.each([
    { kind: 'range', startMs: 2000, endMs: 2000 },
    { kind: 'range', startMs: 3000, endMs: 1000 },
    { kind: 'point', atMs: -1 },
    { kind: 'point', atMs: '5' },
    { kind: 'line' },
    null,
  ])('rejects %j', (input) => {
    expect(() => parseAnchor(input)).toThrow(ReviewError)
  })

  it('formats timestamps with tenths', () => {
    expect(formatAnchor({ kind: 'point', atMs: 83_450 })).toBe('1:23.4')
    expect(formatAnchor({ kind: 'range', startMs: 83_400, endMs: 90_000 })).toBe('1:23.4–1:30.0')
  })
})

describe('comment bodies', () => {
  it('trims and enforces 1..4000 characters', () => {
    expect(parseBody('  hi  ')).toBe('hi')
    expect(() => parseBody('   ')).toThrow(ReviewError)
    expect(() => parseBody('x'.repeat(4001))).toThrow(ReviewError)
  })
})
