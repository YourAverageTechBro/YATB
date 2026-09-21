import { createServer } from 'node:http'
import { createReadStream, createWriteStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = Number(process.env.PORT ?? 8080)
const maxInputBytes = 3 * 1024 * 1024 * 1024

function runFfmpeg(input, output) {
  return new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
      '-map', '0:v:0', '-map', '0:a?', '-map_metadata', '0',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '25', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    process.stderr.setEncoding('utf8')
    process.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000) })
    process.once('error', reject)
    process.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`)))
  })
}

createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    return
  }
  if (request.method !== 'POST' || request.url !== '/transcode') {
    response.writeHead(404).end()
    return
  }
  const contentLength = Number(request.headers['content-length'])
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maxInputBytes) {
    response.writeHead(413, { 'content-type': 'text/plain' }).end('A valid bounded Content-Length is required.')
    return
  }
  const token = randomUUID()
  const input = join(tmpdir(), `${token}.input`)
  const output = join(tmpdir(), `${token}.mp4`)
  const clean = async () => Promise.allSettled([unlink(input), unlink(output)])
  try {
    await pipeline(request, createWriteStream(input, { flags: 'wx' }))
    await runFfmpeg(input, output)
    const result = await stat(output)
    response.writeHead(200, {
      'content-length': String(result.size),
      'content-type': 'video/mp4',
    })
    await pipeline(createReadStream(output), response)
  } catch (error) {
    if (!response.headersSent) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : 'Transcode failed.'
      response.writeHead(422, { 'content-type': 'text/plain' }).end(message)
    } else {
      response.destroy()
    }
  } finally {
    await clean()
  }
}).listen(port, '0.0.0.0')

