import { createServer } from 'node:http'
import { createReadStream, createWriteStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = Number(process.env.PORT ?? 8080)
const GiB = 1024 * 1024 * 1024

const routes = {
  '/transcode': {
    maxInputBytes: 3 * GiB,
    extension: 'mp4',
    contentType: 'video/mp4',
    args: (input, output) => [
      '-i', input,
      '-map', '0:v:0', '-map', '0:a?', '-map_metadata', '0',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '25', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output,
    ],
  },
  '/extract-audio': {
    maxInputBytes: 6 * GiB,
    extension: 'ogg',
    contentType: 'audio/ogg',
    missingStreamError: 'no-audio',
    args: (input, output) => [
      '-i', input,
      '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000',
      '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', '-f', 'ogg', output,
    ],
  },
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    process.stderr.setEncoding('utf8')
    process.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000) })
    process.once('error', reject)
    process.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`)))
  })
}

function failureHeaders(route, message) {
  const headers = { 'content-type': 'text/plain' }
  if (route.missingStreamError && /matches no streams/.test(message)) headers['x-extract-error'] = route.missingStreamError
  return headers
}

createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    return
  }
  const route = request.method === 'POST' ? routes[request.url] : undefined
  if (!route) {
    response.writeHead(404).end()
    return
  }
  const contentLength = Number(request.headers['content-length'])
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > route.maxInputBytes) {
    response.writeHead(413, { 'content-type': 'text/plain' }).end('A valid bounded Content-Length is required.')
    return
  }
  const token = randomUUID()
  const input = join(tmpdir(), `${token}.input`)
  const output = join(tmpdir(), `${token}.${route.extension}`)
  const clean = async () => Promise.allSettled([unlink(input), unlink(output)])
  try {
    await pipeline(request, createWriteStream(input, { flags: 'wx' }))
    await runFfmpeg(route.args(input, output))
    const result = await stat(output)
    response.writeHead(200, {
      'content-length': String(result.size),
      'content-type': route.contentType,
    })
    await pipeline(createReadStream(output), response)
  } catch (error) {
    if (!response.headersSent) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : 'Transcode failed.'
      response.writeHead(422, failureHeaders(route, message)).end(message)
    } else {
      response.destroy()
    }
  } finally {
    await clean()
  }
}).listen(port, '0.0.0.0')
