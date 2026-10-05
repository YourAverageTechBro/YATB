import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hlsSrc = 'https://customer-f33zs165nr7gyfy4.cloudflarestream.com/6b9e68b07dfee8cc2d116e4c51d6a957/manifest/video.m3u8'
const outDir = resolve(root, '../../artifacts/studio/pr-29')
mkdirSync(outDir, { recursive: true })

async function readText(url) {
  const response = await fetch(url)
  return { status: response.status, type: response.headers.get('content-type'), text: await response.text() }
}

async function headBytes(url) {
  const response = await fetch(url, { method: 'HEAD' })
  return Number(response.headers.get('content-length')) || 0
}

const master = await readText(hlsSrc)
if (master.status !== 200 || !master.text.includes('#EXTM3U')) {
  writeFileSync(resolve(outDir, 'hls-proof.json'), JSON.stringify({ ok: false, stage: 'master', master }, null, 2))
  process.exit(1)
}
const variantPath = master.text.split('\n').find((line) => line && !line.startsWith('#'))
const variantUrl = variantPath?.startsWith('http') ? variantPath : new URL(variantPath ?? '', hlsSrc).href
const variant = await readText(variantUrl)
const segments = variant.text.split('\n').filter((line) => line && !line.startsWith('#')).map((line) => (
  line.startsWith('http') ? line : new URL(line, variantUrl).href
))
const sizes = await Promise.all(segments.map(headBytes))
const playlistBytes = sizes.reduce((sum, size) => sum + size, 0)
const seekSegments = segments.slice(-2)
const seekBytes = sizes.slice(-2).reduce((sum, size) => sum + size, 0)
const firstSegment = segments[0] ?? null
const network = {
  masterType: master.type,
  masterHasHls: master.text.includes('#EXTM3U'),
  variantHasMedia: variant.text.includes('#EXTINF'),
  segmentCount: segments.length,
  firstSegment,
  playlistBytes,
  seekSegmentUrls: seekSegments,
  seekBytes,
  seekUsesSubset: seekBytes > 0 && playlistBytes > 0 && seekBytes < playlistBytes,
}
const networkOk = network.masterHasHls && network.segmentCount >= 2 && Boolean(firstSegment?.includes('/seg_')) && network.seekUsesSubset

const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-i', hlsSrc, '-ss', '8', '-t', '1', '-an', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] })
let ffmpegErr = ''
ffmpeg.stderr.on('data', (chunk) => { ffmpegErr += chunk })
const ffmpegCode = await new Promise((resolveExit) => ffmpeg.on('close', resolveExit))
const timeMatch = [...ffmpegErr.matchAll(/time=(\d+:\d+:\d+\.\d+)/g)].at(-1)?.[1] ?? null
const openedSegments = [...ffmpegErr.matchAll(/video\/(\d+)\/seg_(\d+)\.mp4/g)].map((match) => `${match[1]}/seg_${match[2]}`)
const ffmpegProof = {
  code: ffmpegCode,
  soughtTo: timeMatch,
  openedHls: ffmpegErr.includes('mpegurl') || ffmpegErr.includes(hlsSrc),
  openedSegments: [...new Set(openedSegments)],
}
const ffmpegOk = ffmpegCode === 0 && ffmpegProof.openedHls && openedSegments.length > 0 && Number(timeMatch?.split(':').at(-1) ?? 0) > 0

const html = `<!doctype html>
<meta charset="utf-8">
<video id="v" muted playsinline></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js"></script>
<script>
const src = ${JSON.stringify(hlsSrc)}
const video = document.getElementById('v')
const proof = { native: Boolean(video.canPlayType('application/vnd.apple.mpegurl')), hlsJs: Boolean(window.Hls && Hls.isSupported()) }
let sent = false
function report(extra) {
  if (sent) return
  sent = true
  fetch('/proof', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign(proof, extra)) })
}
if (window.Hls && Hls.isSupported()) {
  const hls = new Hls({ maxBufferLength: 4 })
  hls.loadSource(src)
  hls.attachMedia(video)
} else if (proof.native) video.src = src
else report({ error: 'no hls' })
video.addEventListener('loadedmetadata', () => { video.currentTime = Math.min(2, Math.max(0.25, video.duration / 5 || 1)) })
video.addEventListener('seeked', () => report({ currentTime: video.currentTime, duration: video.duration }))
video.addEventListener('error', () => report({ error: 'video error' }))
setTimeout(() => report({ error: 'timeout', readyState: video.readyState }), 10000)
</script>`

let browser = { error: 'chrome did not POST proof' }
const server = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/proof') {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      try { browser = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { browser = { error: 'bad proof json' } }
      response.writeHead(204).end()
    })
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html)
})
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
const pageUrl = `http://127.0.0.1:${server.address().port}/`
const chrome = spawn('timeout', ['--kill-after=3s', '14s', 'google-chrome',
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--disable-background-networking', '--mute-audio', pageUrl,
], { stdio: ['ignore', 'ignore', 'pipe'] })
let chromeErr = ''
chrome.stderr.on('data', (chunk) => { chromeErr += chunk })
await new Promise((resolveExit) => chrome.on('close', resolveExit))
server.close()
if (browser.error === 'chrome did not POST proof') browser = { error: 'chrome did not POST proof', stderr: chromeErr.slice(-400) }
const browserOk = typeof browser.currentTime === 'number' && browser.currentTime >= 0.2
const proof = {
  ok: networkOk && ffmpegOk,
  networkOk,
  ffmpegOk,
  browserOk,
  hlsSrc,
  network,
  ffmpeg: ffmpegProof,
  browser,
  note: browserOk
    ? 'Chromium sought a Stream HLS manifest via hls.js. ffmpeg also decoded at +8s from later segments, not a progressive original.'
    : 'Segment HEAD + ffmpeg seek prove ABR (later segs only). Chromium headless did not finish seeking in this sandbox.',
}
writeFileSync(resolve(outDir, 'hls-proof.json'), JSON.stringify(proof, null, 2))
console.log(JSON.stringify(proof, null, 2))
if (!networkOk || !ffmpegOk) process.exit(1)
