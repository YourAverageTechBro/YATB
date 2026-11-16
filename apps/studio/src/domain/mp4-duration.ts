const MVHD = 0x6d766864
const MOOV = 0x6d6f6f76

export function readMp4DurationMs(bytes: Uint8Array): number | null {
  const duration = readBoxDuration(bytes, 0, bytes.byteLength)
  if (duration === null || !Number.isSafeInteger(duration) || duration < 1) return null
  return duration
}

function readBoxDuration(bytes: Uint8Array, start: number, end: number): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = start
  while (offset + 8 <= end) {
    let size = view.getUint32(offset)
    const type = view.getUint32(offset + 4)
    let header = 8
    if (size === 1) {
      if (offset + 16 > end) return null
      const large = Number(view.getBigUint64(offset + 8))
      if (!Number.isSafeInteger(large)) return null
      size = large
      header = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < header || offset + size > end) return null
    const payloadStart = offset + header
    const payloadEnd = offset + size
    if (type === MVHD) return readMvhd(view, payloadStart, payloadEnd)
    if (type === MOOV) {
      const nested = readBoxDuration(bytes, payloadStart, payloadEnd)
      if (nested !== null) return nested
    }
    offset += size
  }
  return null
}

function readMvhd(view: DataView, start: number, end: number): number | null {
  if (start + 20 > end) return null
  const version = view.getUint8(start)
  if (version === 1) {
    if (start + 32 > end) return null
    const timescale = view.getUint32(start + 20)
    const duration = Number(view.getBigUint64(start + 24))
    return durationMs(timescale, duration)
  }
  if (version !== 0) return null
  const timescale = view.getUint32(start + 12)
  const duration = view.getUint32(start + 16)
  return durationMs(timescale, duration)
}

function durationMs(timescale: number, duration: number): number | null {
  if (timescale < 1 || duration < 1 || !Number.isSafeInteger(duration)) return null
  return Math.round(duration / timescale * 1000)
}

export function testMp4(durationMsValue: number): Uint8Array {
  const timescale = 1000
  const mvhdPayload = new Uint8Array(108)
  const mvhd = new DataView(mvhdPayload.buffer)
  mvhd.setUint32(12, timescale)
  mvhd.setUint32(16, durationMsValue)
  const moov = box('moov', box('mvhd', mvhdPayload))
  const ftyp = box('ftyp', new TextEncoder().encode('isomiso2mp41'))
  const mdat = box('mdat', new Uint8Array([0, 0, 0, 1]))
  const out = new Uint8Array(ftyp.length + moov.length + mdat.length)
  out.set(ftyp, 0)
  out.set(moov, ftyp.length)
  out.set(mdat, ftyp.length + moov.length)
  return out
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length)
  new DataView(out.buffer).setUint32(0, out.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(payload, 8)
  return out
}
