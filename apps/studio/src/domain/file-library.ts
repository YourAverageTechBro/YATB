import type { MediaFile, MediaFileId } from './media'

export type LibraryFile = Readonly<{
  file: MediaFile
  videoTitle: string
  shareToken: string | null
}>

export type FileGroup = Readonly<{ key: string; label: string; files: readonly LibraryFile[] }>
export type FileGrouping = 'date' | 'content'

export function formatUploadedDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(timestamp)
}

export function formatUploadedTimestamp(timestamp: number): string {
  return `${new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(timestamp)} UTC`
}

export function parseFileGrouping(value: unknown): FileGrouping {
  return value === 'content' ? 'content' : 'date'
}

export function filterLibraryFiles(files: readonly LibraryFile[], search: string): LibraryFile[] {
  const term = search.trim().toLocaleLowerCase()
  return term ? files.filter(({ file }) => file.displayName.toLocaleLowerCase().includes(term)) : [...files]
}

export function groupLibraryFiles(files: readonly LibraryFile[], grouping: FileGrouping): FileGroup[] {
  const groups = new Map<string, { label: string; files: LibraryFile[] }>()
  for (const entry of files) {
    const uploaded = new Date(entry.file.createdAt)
    const key = grouping === 'content'
      ? entry.file.videoId
      : `${uploaded.getUTCFullYear()}-${String(uploaded.getUTCMonth() + 1).padStart(2, '0')}-${String(uploaded.getUTCDate()).padStart(2, '0')}`
    const label = grouping === 'content'
      ? entry.videoTitle
      : formatUploadedDate(entry.file.createdAt)
    const group = groups.get(key) ?? { label, files: [] }
    group.files.push(entry)
    groups.set(key, group)
  }
  return [...groups].map(([key, group]) => ({ key, ...group }))
}

export function parseShareToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Share link is invalid.')
  return value
}

export function parseLibraryFileId(value: unknown): MediaFileId {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('File id is invalid.')
  }
  return value
}
