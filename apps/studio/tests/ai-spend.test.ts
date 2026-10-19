import { describe, expect, it } from 'vitest'
import {
  MONTHLY_AI_BUDGET,
  chargeId,
  requestEstimate,
  spendMonth,
  transcriptionCost,
  withinBudget,
  writerCost,
  type Microusd,
} from '../src/domain/ai-spend'
import { MAX_GENERATION_DURATION_MS } from '../src/domain/draft-ai'

const usd = (value: number) => value as Microusd

describe('month cap', () => {
  it('allows a charge that lands exactly on the cap and blocks one micro-dollar more', () => {
    expect(withinBudget(usd(4_000_000), usd(1_000_000))).toBe(true)
    expect(withinBudget(usd(4_000_000), usd(1_000_001))).toBe(false)
    expect(withinBudget(MONTHLY_AI_BUDGET, usd(0))).toBe(true)
  })

  it('buckets spend by UTC month', () => {
    const lastMs = Date.UTC(2026, 9, 31, 23, 59, 59, 999)
    expect(spendMonth(lastMs)).toBe('2026-10')
    expect(spendMonth(lastMs + 1)).toBe('2026-11')
  })

  it('fits the longest allowed draft into an empty month', () => {
    expect(withinBudget(usd(0), requestEstimate(MAX_GENERATION_DURATION_MS, true))).toBe(true)
  })

  it('reserves less when the transcript already exists', () => {
    expect(requestEstimate(600_000, false)).toBeLessThan(requestEstimate(600_000, true))
  })

  it('never records nonzero usage as free', () => {
    expect(transcriptionCost(1)).toBeGreaterThan(0)
    expect(writerCost({ inputTokens: 1, outputTokens: 0 })).toBeGreaterThan(0)
    expect(writerCost({ inputTokens: 0, outputTokens: 0 })).toBe(0)
  })
})

describe('charge ids', () => {
  const key = { draftId: '5b0e913b-645c-4306-a71d-78115390b46d', kind: 'chapters' } as const

  it('repeat for the same call and differ across attempts, calls, and requests', () => {
    expect(chargeId(key, 1, 1, 'write-1')).toBe(chargeId(key, 1, 1, 'write-1'))
    const distinct = new Set([
      chargeId(key, 1, 1, 'write-1'),
      chargeId(key, 1, 1, 'write-2'),
      chargeId(key, 1, 2, 'write-1'),
      chargeId(key, 2, 1, 'write-1'),
      chargeId({ ...key, kind: 'description' }, 1, 1, 'write-1'),
    ])
    expect(distinct.size).toBe(5)
  })
})
