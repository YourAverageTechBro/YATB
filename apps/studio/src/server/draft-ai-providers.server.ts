import '@tanstack/react-start/server-only'
import type { WriterUsage } from '#/domain/ai-spend'
import { WRITER_MAX_OUTPUT_TOKENS, type AiAvailability, type AiProviderMode, type JobKey } from '#/domain/draft-ai'
import { WRITER_MODEL, type WriterPrompt } from '#/domain/draft-ai-writer'
import { TRANSCRIBE_MODEL, segmentWords, type TimedWord, type TranscriptDoc, type TranscriptSegment } from '#/domain/transcript'
import { CONTAINER_INSTANCES } from './container-instances'

export type ProviderErrorCode = 'no-audio' | 'no-speech' | 'rejected' | 'transient'

export class ProviderError extends Error {
  constructor(public readonly code: ProviderErrorCode, message: string) {
    super(message)
  }
}

export type SpeechSource = Readonly<{ objectKey: string; byteSize: number; contentType: string }>
/** `usage` is null when the provider did not report it, so the reservation stays at its estimate. */
export type WriterReply = Readonly<{ text: string; usage: WriterUsage | null }>
export type Transcription = Readonly<{ doc: TranscriptDoc; audioMs: number }>

export interface DraftAiProviders {
  readonly mode: AiProviderMode
  readonly writerModel: string
  extractSpeechAudio(source: SpeechSource, targetKey: string): Promise<Readonly<{ etag: string }>>
  transcribe(audioKey: string, durationMs: number): Promise<Transcription>
  write(prompt: WriterPrompt, key: JobKey): Promise<WriterReply>
}

export type DraftAiProviderEnv = Readonly<{
  AI?: Ai
  AI_GATEWAY_ID?: string
  DRAFT_AI_MODE?: string
  MEDIA: R2Bucket
  VIDEO_TRANSCODER: DurableObjectNamespace
}>

declare const gatewayIdBrand: unique symbol
export type GatewayId = string & { readonly [gatewayIdBrand]: true }

/** Rejects '' and 'default'. The 'default' id auto-creates a gateway, which this project must not do. */
export function parseGatewayId(value: unknown): GatewayId | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return id !== 'default' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id as GatewayId : null
}

const SPEECH_AUDIO_TYPE = 'audio/ogg'

function nova3Words(output: unknown): TimedWord[] {
  const results = (output as { results?: { channels?: Array<{ alternatives?: Array<{ words?: unknown }> }> } } | null)?.results
  const words = results?.channels?.[0]?.alternatives?.[0]?.words
  if (!Array.isArray(words)) return []
  return words.flatMap((value: unknown) => {
    const word = value as { start?: unknown; end?: unknown; word?: unknown; punctuated_word?: unknown }
    const text = typeof word.punctuated_word === 'string' ? word.punctuated_word : word.word
    if (typeof word.start !== 'number' || typeof word.end !== 'number' || typeof text !== 'string' || !text.trim()) return []
    const startMs = Math.round(word.start * 1000)
    return [{ startMs, endMs: Math.max(startMs, Math.round(word.end * 1000)), text: text.trim() }]
  })
}

function anthropicReply(output: Record<string, unknown>): WriterReply {
  const content = Array.isArray(output.content) ? output.content as Array<{ type?: unknown; text?: unknown }> : []
  const text = content.flatMap((part) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])).join('')
  if (!text) throw new ProviderError('transient', 'The writer reply had no text.')
  const usage = output.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined
  return {
    text,
    usage: typeof usage?.input_tokens === 'number' && typeof usage.output_tokens === 'number'
      ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }
      : null,
  }
}

function liveProviders(env: DraftAiProviderEnv, ai: Ai, gatewayId: GatewayId): DraftAiProviders {
  return {
    mode: 'live',
    writerModel: WRITER_MODEL,
    async extractSpeechAudio(source, targetKey) {
      const original = await env.MEDIA.get(source.objectKey)
      if (!original) throw new ProviderError('rejected', 'The original draft object is missing.')
      const upload = new FixedLengthStream(source.byteSize)
      const sent = original.body.pipeTo(upload.writable)
      const [response] = await Promise.all([
        env.VIDEO_TRANSCODER.getByName(CONTAINER_INSTANCES.speechAudio).fetch(new Request('http://container/extract-audio', {
          method: 'POST',
          headers: { 'Content-Length': String(source.byteSize), 'Content-Type': source.contentType },
          body: upload.readable,
        })),
        sent,
      ])
      if (response.status === 422 && response.headers.get('x-extract-error') === 'no-audio') {
        await response.body?.cancel()
        throw new ProviderError('no-audio', 'The draft has no audio track.')
      }
      if (!response.ok || !response.body) {
        const detail = (await response.text()).slice(0, 300)
        throw new ProviderError(
          response.status >= 500 ? 'transient' : 'rejected',
          `Audio extraction returned ${response.status}${detail ? `: ${detail}` : '.'}`,
        )
      }
      const size = Number(response.headers.get('content-length'))
      if (!Number.isSafeInteger(size) || size < 1) {
        await response.body.cancel()
        throw new ProviderError('transient', 'Audio extraction returned an invalid size.')
      }
      const download = new FixedLengthStream(size)
      const received = response.body.pipeTo(download.writable)
      const [stored] = await Promise.all([
        env.MEDIA.put(targetKey, download.readable, { httpMetadata: { contentType: SPEECH_AUDIO_TYPE } }),
        received,
      ])
      return { etag: stored.httpEtag }
    },
    async transcribe(audioKey, durationMs) {
      const audio = await env.MEDIA.get(audioKey)
      if (!audio) throw new ProviderError('transient', 'The speech audio object is missing.')
      const output = await ai.run(TRANSCRIBE_MODEL, {
        audio: { body: audio.body, contentType: SPEECH_AUDIO_TYPE },
        language: 'en',
        smart_format: true,
        punctuate: true,
      }, { gateway: { id: gatewayId } })
      const words = nova3Words(output)
      if (words.length === 0) throw new ProviderError('no-speech', 'The transcript has no words.')
      return { doc: { version: 1, model: TRANSCRIBE_MODEL, language: 'en', segments: segmentWords(words) }, audioMs: durationMs }
    },
    async write(prompt, key) {
      const output = await ai.run(WRITER_MODEL, {
        max_tokens: WRITER_MAX_OUTPUT_TOKENS,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      }, { gateway: { id: gatewayId, skipCache: true, metadata: { draftId: key.draftId, kind: key.kind } } })
      return anthropicReply(output)
    },
  }
}

const STUB_SEGMENT_MS = 20_000
const STUB_CHAPTER_COUNT = 5

function stubSegments(durationMs: number): TranscriptSegment[] {
  return Array.from({ length: Math.max(1, Math.ceil(durationMs / STUB_SEGMENT_MS)) }, (_, index) => {
    const startMs = index * STUB_SEGMENT_MS
    return { startMs, endMs: Math.min(durationMs, startMs + STUB_SEGMENT_MS - 1_000), text: `Stub transcript line ${index + 1}.` }
  })
}

/** Builds the reply from the `[m:ss]` labels in the prompt, as a model would. */
function stubReply(prompt: WriterPrompt): string {
  const title = /^Title: (.*)$/m.exec(prompt.user)?.[1] ?? 'this draft'
  const labels = [...prompt.user.matchAll(/^\[(\d+:\d{2}(?::\d{2})?)\]/gm)].map((match) => match[1] ?? '0:00')
  const picks = [...new Set(Array.from({ length: STUB_CHAPTER_COUNT }, (_, index) => Math.floor(index * labels.length / STUB_CHAPTER_COUNT)))]
  return JSON.stringify({
    description: `Stub hook for ${title}.\n\nStub summary written without a model. Set DRAFT_AI_MODE to live for real text.`,
    chapters: picks.map((index, order) => ({ start: labels[index] ?? '0:00', title: `Stub chapter ${order + 1}` })),
  })
}

function stubProviders(env: DraftAiProviderEnv): DraftAiProviders {
  return {
    mode: 'stub',
    writerModel: 'stub-writer',
    async extractSpeechAudio(_source, targetKey) {
      const stored = await env.MEDIA.put(targetKey, new TextEncoder().encode('stub speech audio'), {
        httpMetadata: { contentType: SPEECH_AUDIO_TYPE },
      })
      return { etag: stored.httpEtag }
    },
    async transcribe(_audioKey, durationMs) {
      return { doc: { version: 1, model: 'stub', language: 'en', segments: stubSegments(durationMs) }, audioMs: 0 }
    },
    async write(prompt) {
      return { text: stubReply(prompt), usage: { inputTokens: 0, outputTokens: 0 } }
    },
  }
}

export type DraftAiSetup = Readonly<{ availability: AiAvailability; providers: DraftAiProviders | null }>

function unavailable(reason: string): DraftAiSetup {
  return { availability: { kind: 'unavailable', reason }, providers: null }
}

/** `live` needs the AI binding and a named gateway. Anything else makes generation unavailable. */
export function draftAiProviders(env: DraftAiProviderEnv): DraftAiSetup {
  const mode = env.DRAFT_AI_MODE ?? 'live'
  if (mode === 'stub') return { availability: { kind: 'stub' }, providers: stubProviders(env) }
  if (mode !== 'live') return unavailable('DRAFT_AI_MODE must be live or stub.')
  if (!env.AI) return unavailable('The AI binding is missing.')
  const gatewayId = parseGatewayId(env.AI_GATEWAY_ID)
  if (!gatewayId) return unavailable('AI_GATEWAY_ID must name an existing AI Gateway.')
  return { availability: { kind: 'live' }, providers: liveProviders(env, env.AI, gatewayId) }
}
