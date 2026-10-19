import type { DatabaseSync } from 'node:sqlite'
import type { JobKey } from '../../src/domain/draft-ai'
import type { DraftAiBindings } from '../../src/server/draft-ai.server'
import { d1, ids } from './draft-ai-db'

export const originalKey = `videos/${ids.video}/drafts/${ids.file}`
export const target = { videoId: ids.video, draftId: ids.draft } as const

export type StoredObject = Readonly<{ bytes: Uint8Array; contentType: string | undefined; etag: string }>

async function bytesOf(value: unknown): Promise<Uint8Array> {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof Uint8Array) return value
  if (value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer())
  throw new Error('Unsupported R2 body.')
}

export function mediaBucket(objects = new Map<string, StoredObject>()): R2Bucket {
  let version = 0
  return {
    async head(key: string) {
      const stored = objects.get(key)
      return stored ? { key, size: stored.bytes.byteLength, httpEtag: stored.etag } : null
    },
    async get(key: string) {
      const stored = objects.get(key)
      if (!stored) return null
      const text = new TextDecoder().decode(stored.bytes)
      return {
        key,
        size: stored.bytes.byteLength,
        httpEtag: stored.etag,
        body: new Blob([new Uint8Array(stored.bytes)]).stream(),
        text: async () => text,
        json: async () => JSON.parse(text),
      }
    },
    async put(key: string, value: unknown, options?: R2PutOptions) {
      const bytes = await bytesOf(value)
      version += 1
      const etag = `"etag-${version}"`
      const contentType = options?.httpMetadata && 'contentType' in options.httpMetadata
        ? options.httpMetadata.contentType
        : undefined
      objects.set(key, { bytes, contentType, etag })
      return { key, size: bytes.byteLength, httpEtag: etag }
    },
    async delete(keys: string | string[]) {
      for (const key of [keys].flat()) objects.delete(key)
    },
  } as unknown as R2Bucket
}

export type ContainerHandler = (instance: string, path: string, body: Uint8Array, request: Request) => Promise<Response>

export function containerNamespace(handler: ContainerHandler): DurableObjectNamespace {
  return {
    getByName(instance: string) {
      return {
        async fetch(request: Request) {
          return handler(instance, new URL(request.url).pathname, new Uint8Array(await request.arrayBuffer()), request)
        },
      }
    },
  } as unknown as DurableObjectNamespace
}

export const unusedContainer = containerNamespace(async () => {
  throw new Error('The container should not be called.')
})

export type AiCall = Readonly<{ model: string; input: Record<string, unknown>; options: Record<string, unknown> | undefined }>
export type AiHandler = (call: AiCall) => Promise<unknown>

export function workersAi(handler: AiHandler): Ai & { calls: AiCall[] } {
  const calls: AiCall[] = []
  return {
    calls,
    async run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>) {
      const call = { model, input, options }
      calls.push(call)
      return handler(call)
    },
  } as unknown as Ai & { calls: AiCall[] }
}

/** nova-3 reports word times in seconds. */
export function nova3Output(words: ReadonlyArray<readonly [number, number, string]>) {
  return {
    results: {
      channels: [{
        alternatives: [{
          words: words.map(([start, end, word]) => ({ start, end, word: word.toLowerCase(), punctuated_word: word })),
        }],
      }],
    },
  }
}

export function anthropicOutput(reply: unknown, usage = { input_tokens: 1_200, output_tokens: 300 }) {
  return {
    content: [{ type: 'text', text: typeof reply === 'string' ? reply : JSON.stringify(reply) }],
    usage,
  }
}

export type QueueOutcome = Readonly<{ body: unknown; outcome: 'ack' | Readonly<{ retryDelaySeconds: number | undefined }> }>

export type TestEnv = Readonly<{
  env: DraftAiBindings
  objects: Map<string, StoredObject>
  sent: JobKey[]
}>

export function draftAiEnv(
  db: DatabaseSync,
  overrides: Readonly<{
    DRAFT_AI_MODE?: string
    AI?: Ai
    AI_GATEWAY_ID?: string
    VIDEO_TRANSCODER?: DurableObjectNamespace
  }> = {},
): TestEnv {
  const objects = new Map<string, StoredObject>()
  const sent: JobKey[] = []
  const env = {
    DB: d1(db),
    MEDIA: mediaBucket(objects),
    DRAFT_AI_QUEUE: { async send(body: JobKey) { sent.push(body) } },
    VIDEO_TRANSCODER: unusedContainer,
    ...overrides,
  } as unknown as DraftAiBindings
  return { env, objects, sent }
}

export function messageBatch(
  bodies: readonly unknown[],
  queue = 'yatb-draft-ai',
): Readonly<{ batch: MessageBatch<unknown>; outcomes: QueueOutcome[] }> {
  const outcomes: QueueOutcome[] = []
  const messages = bodies.map((body) => ({
    id: crypto.randomUUID(),
    timestamp: new Date(),
    attempts: 1,
    body,
    ack: () => outcomes.push({ body, outcome: 'ack' }),
    retry: (options?: QueueRetryOptions) => outcomes.push({ body, outcome: { retryDelaySeconds: options?.delaySeconds } }),
  }))
  return {
    batch: { queue, messages, ackAll: () => {}, retryAll: () => {} } as unknown as MessageBatch<unknown>,
    outcomes,
  }
}

/** Delivers every sent message one at a time until the queue is empty. Retried messages are returned, not redelivered. */
export async function drain(
  test: TestEnv,
  consume: (batch: MessageBatch<unknown>, env: DraftAiBindings) => Promise<void>,
): Promise<QueueOutcome[]> {
  const outcomes: QueueOutcome[] = []
  for (let round = 0; test.sent.length > 0; round += 1) {
    if (round > 20) throw new Error('The draft AI queue did not drain.')
    const delivered = test.sent.splice(0, 1)
    const batch = messageBatch(delivered)
    await consume(batch.batch, test.env)
    outcomes.push(...batch.outcomes)
  }
  return outcomes
}

/** The Workers runtime accepts a streamed request body without `duplex` and provides FixedLengthStream. Node does neither. */
export class WorkersRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init?.body instanceof ReadableStream ? { ...init, duplex: 'half' } as RequestInit : init)
  }
}

export class FixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(readonly expectedLength: number) {
    super()
  }
}

export function jobRows(db: DatabaseSync) {
  return db.prepare(
    'SELECT kind, state, attempts, failure_code FROM draft_ai_job WHERE draft_id = ? ORDER BY kind',
  ).all(ids.draft) as Array<{ kind: string; state: string; attempts: number; failure_code: string | null }>
}

export function spendRows(db: DatabaseSync) {
  return db.prepare(
    'SELECT kind, microusd, settled, audio_ms, input_tokens, output_tokens FROM ai_spend ORDER BY created_at, id',
  ).all() as Array<{
    kind: string
    microusd: number
    settled: number
    audio_ms: number | null
    input_tokens: number | null
    output_tokens: number | null
  }>
}
