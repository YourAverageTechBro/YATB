import { WRITER_MAX_OUTPUT_TOKENS, WRITER_TRIES, type JobKey } from './draft-ai'

declare const microusdBrand: unique symbol
export type Microusd = number & { readonly [microusdBrand]: true }
declare const spendMonthBrand: unique symbol
/** UTC `YYYY-MM`. */
export type SpendMonth = string & { readonly [spendMonthBrand]: true }
declare const chargeIdBrand: unique symbol
export type ChargeId = string & { readonly [chargeIdBrand]: true }

export const MONTHLY_AI_BUDGET = 5_000_000 as Microusd

/** Estimates, not vendor quotes. Check current Workers AI and Unified Billing prices before relying on the cap. */
export const AI_PRICE_ESTIMATES = {
  transcribePerAudioMinute: 5_200,
  writerPerMillionInputTokens: 1_000_000,
  writerPerMillionOutputTokens: 5_000_000,
  writerPromptTokens: 1_000,
  writerTranscriptTokensPerMinute: 250,
} as const

export type ChargeCall = 'transcribe' | `write-${number}`
export type WriterUsage = Readonly<{ inputTokens: number; outputTokens: number }>

export function spendMonth(now: number): SpendMonth {
  return new Date(now).toISOString().slice(0, 7) as SpendMonth
}

/** Deterministic, so reserving the same attempt's call twice is a no-op. */
export function chargeId(key: JobKey, requestSeq: number, attempt: number, call: ChargeCall): ChargeId {
  return `${key.draftId}:${key.kind}:${requestSeq}:${attempt}:${call}` as ChargeId
}

export function transcriptionCost(durationMs: number): Microusd {
  return Math.ceil((durationMs / 60_000) * AI_PRICE_ESTIMATES.transcribePerAudioMinute) as Microusd
}

export function writerCost(usage: WriterUsage): Microusd {
  return Math.ceil(
    (usage.inputTokens * AI_PRICE_ESTIMATES.writerPerMillionInputTokens +
      usage.outputTokens * AI_PRICE_ESTIMATES.writerPerMillionOutputTokens) /
      1_000_000,
  ) as Microusd
}

/** One writer call at its output cap, with a prompt sized from the transcript length. */
export function writerEstimate(durationMs: number): Microusd {
  const inputTokens =
    AI_PRICE_ESTIMATES.writerPromptTokens +
    Math.ceil((durationMs / 60_000) * AI_PRICE_ESTIMATES.writerTranscriptTokensPerMinute)
  return writerCost({ inputTokens, outputTokens: WRITER_MAX_OUTPUT_TOKENS })
}

/** Worst case for one field request: the transcript when it is still needed, plus every writer try. */
export function requestEstimate(durationMs: number, needsTranscript: boolean): Microusd {
  const transcript = needsTranscript ? transcriptionCost(durationMs) : 0
  return (transcript + WRITER_TRIES * writerEstimate(durationMs)) as Microusd
}

export function withinBudget(spent: Microusd, charge: Microusd): boolean {
  return spent + charge <= MONTHLY_AI_BUDGET
}
