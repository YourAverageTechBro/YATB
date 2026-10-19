import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unstable_readConfig } from 'wrangler'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/server'
import { JOB_MAX_ATTEMPTS } from '../src/domain/draft-ai'
import { CONTAINER_INSTANCES } from '../src/server/container-instances'
import { messageBatch } from './support/draft-ai-env'

const mocks = vi.hoisted(() => ({
  consumeCompressionQueue: vi.fn(async () => undefined),
  consumeDraftAiQueue: vi.fn(async () => undefined),
  reconcileDraftAiJobs: vi.fn(async () => 0),
}))

vi.mock('@tanstack/react-start/server-entry', () => ({ default: { fetch: vi.fn() } }))
vi.mock('../src/server/compression-container', () => ({ CompressionContainer: class {} }))
vi.mock('../src/server/media.server', () => ({ cleanupTombstonedVideos: vi.fn(async () => undefined) }))
vi.mock('../src/server/stream.server', () => ({ reconcileDraftStreams: vi.fn(async () => 0) }))
vi.mock('../src/server/compression.server', () => ({
  consumeCompressionQueue: mocks.consumeCompressionQueue,
  reconcileDerivatives: vi.fn(async () => 0),
}))
vi.mock('../src/server/draft-ai.server', () => ({
  consumeDraftAiQueue: mocks.consumeDraftAiQueue,
  reconcileDraftAiJobs: mocks.reconcileDraftAiJobs,
}))

/** wrangler types its Config through @cloudflare/workers-utils, which it bundles without installing, so tsc reads it as any. */
type WranglerConfig = {
  queues: {
    producers?: { binding: string; queue: string }[]
    consumers?: { queue: string; max_retries?: number }[]
  }
  triggers: { crons: string[] }
  containers?: { class_name: string; max_instances?: number }[]
  ai?: { binding: string }
  vars: Record<string, unknown>
  secrets?: { required?: string[] }
}

const config: WranglerConfig = unstable_readConfig(
  { config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)) },
  { hideWarnings: true },
)
const env = {} as Cloudflare.Env

const consumerFor = {
  'yatb-video-compression': mocks.consumeCompressionQueue,
  'yatb-draft-ai': mocks.consumeDraftAiQueue,
}

describe('draft AI deploy wiring', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes each configured consumer queue to its own handler', async () => {
    expect(config.queues.consumers?.map((consumer) => consumer.queue).sort()).toEqual(Object.keys(consumerFor).sort())
    for (const [queue, consume] of Object.entries(consumerFor)) {
      vi.clearAllMocks()
      const { batch } = messageBatch([{ queue }], queue)
      await worker.queue(batch, env)
      expect(consume).toHaveBeenCalledExactlyOnceWith(batch, env)
      for (const other of Object.values(consumerFor)) if (other !== consume) expect(other).not.toHaveBeenCalled()
    }
  })

  it('refuses a batch from a queue it has no consumer for', () => {
    expect(() => worker.queue(messageBatch([], 'yatb-unknown').batch, env)).toThrow('No consumer for queue yatb-unknown')
  })

  it('wakes draft AI jobs on a queue that retries longer than the job ledger', () => {
    expect(config.queues.producers).toContainEqual({ binding: 'DRAFT_AI_QUEUE', queue: 'yatb-draft-ai' })
    const consumer = config.queues.consumers?.find((candidate) => candidate.queue === 'yatb-draft-ai')
    expect(consumer?.max_retries).toBeGreaterThanOrEqual(JOB_MAX_ATTEMPTS)
  })

  it('reconciles draft AI jobs on the cron tick', async () => {
    expect(config.triggers.crons).toEqual(['*/15 * * * *'])
    await worker.scheduled({} as ScheduledController, env)
    expect(mocks.reconcileDraftAiJobs).toHaveBeenCalledExactlyOnceWith(env)
  })

  it('runs one container instance per named instance', () => {
    const container = config.containers?.find((candidate) => candidate.class_name === 'CompressionContainer')
    expect(container?.max_instances).toBe(Object.keys(CONTAINER_INSTANCES).length)
  })

  it('deploys live AI with the gateway id left to an operator secret, and develops on stubs', () => {
    expect(config.ai).toEqual({ binding: 'AI' })
    expect(config.vars.DRAFT_AI_MODE).toBe('live')
    expect(config.vars).not.toHaveProperty('AI_GATEWAY_ID')
    expect(config.secrets?.required).not.toContain('AI_GATEWAY_ID')
    const devVars = readFileSync(fileURLToPath(new URL('../.dev.vars.example', import.meta.url)), 'utf8')
    expect(devVars).toMatch(/^DRAFT_AI_MODE=stub$/m)
  })
})
