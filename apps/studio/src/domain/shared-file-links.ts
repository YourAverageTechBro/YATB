const URL_PATTERN = /https?:\/\/[^\s<>]+/g

export type SharedFileTextPart = Readonly<{ text: string; href?: string }>

export function isSharedFileUrl(value: string): boolean {
  let url: URL
  try { url = new URL(value) } catch { return false }
  const production = url.origin === 'https://studio.youraveragetechbro.com'
  const local = url.origin === 'http://localhost:3001'
  return (production || local) && /^\/shared-files\/[a-f0-9]{64}\/?$/.test(url.pathname)
    && !url.search && !url.hash
}

export function sharedFileTextParts(text: string): SharedFileTextPart[] {
  const result: SharedFileTextPart[] = []
  let cursor = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index
    if (start > cursor) result.push({ text: text.slice(cursor, start) })
    const candidate = match[0]
    const trimmed = candidate.replace(/[.,;!?)]*$/, '')
    if (isSharedFileUrl(trimmed)) result.push({ text: trimmed, href: trimmed })
    else result.push({ text: trimmed })
    if (trimmed.length < candidate.length) result.push({ text: candidate.slice(trimmed.length) })
    cursor = start + candidate.length
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor) })
  return result.length ? result : [{ text }]
}
