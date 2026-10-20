import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { speechAudioKey } from '../src/domain/draft-ai'
import { draftAiProviders } from '../src/server/draft-ai-providers.server'
import { ids } from './support/draft-ai-db'
import { FixedLengthStream, WorkersRequest, containerNamespace, mediaBucket, originalKey, type StoredObject } from './support/draft-ai-env'

vi.mock('@tanstack/react-start/server-only', () => ({}))

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

function ffmpeg(args: string[]) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  if (result.status !== 0) throw new Error(result.stderr.toString())
}

function probe(path: string): Record<string, string> {
  const output = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,channels', '-of', 'default=nw=1', path])
  return Object.fromEntries(output.stdout.toString().trim().split('\n').map((line) => line.split('=') as [string, string]))
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address ? resolvePort(address.port) : reject(new Error('No port.'))))
    })
  })
}

describe.skipIf(!hasFfmpeg)('speech audio container', () => {
  let dir: string
  let server: ChildProcess
  let base: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'speech-audio-'))
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest', join(dir, 'with-audio.mp4')])
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=2', '-c:v', 'libx264', join(dir, 'silent.mp4')])
    const port = await freePort()
    base = `http://127.0.0.1:${port}`
    server = spawn('node', [resolve(process.cwd(), 'container/server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await fetch(base).then((response) => response.ok, () => false)) return
      await new Promise((wait) => setTimeout(wait, 100))
    }
    throw new Error('The container server did not start.')
  }, 30_000)

  afterAll(() => {
    server?.kill()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  function post(path: string, file: string) {
    return fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: readFileSync(join(dir, file)) })
  }

  it('returns mono Opus in Ogg with an exact length for a draft with audio', async () => {
    const response = await post('/extract-audio', 'with-audio.mp4')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/ogg')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(Number(response.headers.get('content-length'))).toBe(bytes.byteLength)
    writeFileSync(join(dir, 'speech.ogg'), bytes)
    expect(probe(join(dir, 'speech.ogg'))).toEqual({ codec_type: 'audio', codec_name: 'opus', channels: '1' })
  })

  it('marks a draft with no audio track as no-audio', async () => {
    const response = await post('/extract-audio', 'silent.mp4')
    expect(response.status).toBe(422)
    expect(response.headers.get('x-extract-error')).toBe('no-audio')
  })

  it('still transcodes a compact MP4 on /transcode', async () => {
    const response = await post('/transcode', 'with-audio.mp4')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('x-extract-error')).toBeNull()
  }, 30_000)

  it('lets the live provider stream an R2 original through the container into R2', async () => {
    vi.stubGlobal('Request', WorkersRequest)
    vi.stubGlobal('FixedLengthStream', FixedLengthStream)
    try {
      const original = readFileSync(join(dir, 'with-audio.mp4'))
      const objects = new Map<string, StoredObject>([[originalKey, { bytes: original, contentType: 'video/mp4', etag: '"o"' }]])
      const setup = draftAiProviders({
        DRAFT_AI_MODE: 'live',
        AI: {} as Ai,
        AI_GATEWAY_ID: 'yatb-studio',
        MEDIA: mediaBucket(objects),
        VIDEO_TRANSCODER: containerNamespace(async (_instance, path, body, request) =>
          fetch(`${base}${path}`, { method: 'POST', headers: request.headers, body: body.slice().buffer })),
      })
      const key = speechAudioKey(ids.video, ids.draft)
      await setup.providers?.extractSpeechAudio({ objectKey: originalKey, byteSize: original.byteLength, contentType: 'video/mp4' }, key)
      const stored = objects.get(key)
      expect(stored?.contentType).toBe('audio/ogg')
      writeFileSync(join(dir, 'stored.ogg'), stored?.bytes ?? new Uint8Array())
      expect(probe(join(dir, 'stored.ogg'))).toMatchObject({ codec_name: 'opus', channels: '1' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
