export type Route = Readonly<{ slug: string; version?: number }> | null

export function parseHash(hash: string): Route {
  const match = /^#\/p\/([^/?]+)(?:\?(.*))?$/.exec(hash)
  if (!match) return null
  const version = Number(new URLSearchParams(match[2]).get('v'))
  return { slug: decodeURIComponent(match[1]!), version: Number.isInteger(version) && version > 0 ? version : undefined }
}

export function setVersionInHash(slug: string, version: number): void {
  location.hash = `#/p/${encodeURIComponent(slug)}?v=${version}`
}
