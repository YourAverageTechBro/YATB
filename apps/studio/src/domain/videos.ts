export type VideoId = string
export type SavedViewId = string
export type VideoRevision = number

export type VideoFormat = 'short' | 'long'

export type Production =
  | { format: 'short'; promotion: 'organic' | 'advertisement' }
  | { format: 'long'; promotion: 'organic' | 'integration' }

export const STATUS = {
  'not-started': { label: 'Not started', order: 0 },
  filming: { label: 'Filming', order: 1 },
  'ready-to-edit': { label: 'Ready to edit', order: 2 },
  'ready-to-review': { label: 'Ready to review', order: 3 },
  published: { label: 'Published', order: 4 },
} as const

export type VideoStatus = keyof typeof STATUS
export const VIDEO_STATUSES = Object.keys(STATUS) as VideoStatus[]

export type VideoSort = 'updated-desc' | 'publish-date-asc' | 'title-asc'
export type ListLayout = 'list'
export type BoardLayout = 'board'
export type VideoListConfig =
  | {
      layout: ListLayout
      groupBy: 'none' | 'status' | 'format'
      status: VideoStatus | 'all'
      format: VideoFormat | 'all'
      sort: VideoSort
    }
  | {
      layout: BoardLayout
      groupBy: 'status'
      status: VideoStatus | 'all'
      format: VideoFormat | 'all'
      sort: VideoSort
    }

export const DEFAULT_LIST_CONFIG: VideoListConfig = {
  layout: 'list',
  groupBy: 'none',
  status: 'all',
  format: 'all',
  sort: 'updated-desc',
}

export type PlanningQuery = Readonly<{ config: VideoListConfig; page: number }>

export function parsePlanningQuery(value: unknown): PlanningQuery {
  const input = record(value, 'Planning query is required.')
  const page = input.page === undefined ? 1 : Number(input.page)
  if (!Number.isSafeInteger(page) || page < 1) invalid('Page is invalid.')
  return { config: parseListConfig(input.config ?? input), page }
}

export type Video = Readonly<{
  id: VideoId
  title: string
  production: Production
  status: VideoStatus
  publishDate: string | null
  script: import('#/server/rich-document').RichDocument
  revision: VideoRevision
  createdAt: number
  updatedAt: number
}>

export type VideoSummary = Omit<Video, 'script'>

export type SavedView = Readonly<{
  id: SavedViewId
  name: string
  config: VideoListConfig
  createdAt: number
  updatedAt: number
}>

export type SaveVideoResult =
  | { kind: 'saved'; video: Video }
  | { kind: 'conflict'; latest: Video }
  | { kind: 'not-found' }

function invalid(message: string): never {
  throw new Error(message)
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(message)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, message: string): string {
  return typeof value === 'string' ? value : invalid(message)
}

function optionalString(value: unknown, message: string): string | null {
  return value === null || value === undefined ? null : string(value, message)
}

export function parseVideoId(value: unknown): VideoId {
  const id = string(value, 'Video id is required.')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    invalid('Video id is invalid.')
  }
  return id
}

export function parseSavedViewId(value: unknown): SavedViewId {
  return parseVideoId(value)
}

export function parseRevision(value: unknown): VideoRevision {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid('Revision is invalid.')
  }
  return value
}

export function parseProduction(value: unknown): Production {
  const input = record(value, 'Production is required.')
  const format = string(input.format, 'Video format is required.')
  const promotion = string(input.promotion, 'Promotion is required.')
  if (format === 'short' && (promotion === 'organic' || promotion === 'advertisement')) {
    return { format, promotion }
  }
  if (format === 'long' && (promotion === 'organic' || promotion === 'integration')) {
    return { format, promotion }
  }
  invalid('This promotion is not available for the selected format.')
}

export function legalPromotions(format: VideoFormat): readonly Production['promotion'][] {
  return format === 'short' ? ['organic', 'advertisement'] : ['organic', 'integration']
}

export function parseStatus(value: unknown): VideoStatus {
  const status = string(value, 'Status is required.')
  return status in STATUS ? status as VideoStatus : invalid('Status is invalid.')
}

function parseFormatFilter(value: unknown): VideoFormat | 'all' {
  return value === 'all' || value === 'short' || value === 'long'
    ? value
    : invalid('Format filter is invalid.')
}

function parseStatusFilter(value: unknown): VideoStatus | 'all' {
  return value === 'all' ? value : parseStatus(value)
}

function parseSort(value: unknown): VideoSort {
  return value === 'updated-desc' || value === 'publish-date-asc' || value === 'title-asc'
    ? value
    : invalid('Sort is invalid.')
}

export function parseListConfig(value: unknown): VideoListConfig {
  const input = record(value, 'View configuration is required.')
  const layout = string(input.layout, 'Layout is required.')
  const groupBy = string(input.groupBy, 'Group is required.')
  const filters = {
    status: parseStatusFilter(input.status),
    format: parseFormatFilter(input.format),
    sort: parseSort(input.sort),
  }
  if (layout === 'list' && (groupBy === 'none' || groupBy === 'status' || groupBy === 'format')) {
    return { layout, groupBy, ...filters }
  }
  if (layout === 'board' && groupBy === 'status') return { layout, groupBy, ...filters }
  invalid('Layout and grouping are incompatible.')
}

export function parsePublishDate(value: unknown): string | null {
  const date = optionalString(value, 'Publish date is invalid.')
  if (date === null) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid('Publish date is invalid.')
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (
    Number.isNaN(parsed.valueOf())
    || parsed.getUTCFullYear() !== Number(date.slice(0, 4))
    || parsed.getUTCMonth() + 1 !== Number(date.slice(5, 7))
    || parsed.getUTCDate() !== Number(date.slice(8, 10))
  ) invalid('Publish date is invalid.')
  return date
}

export function parseTitle(value: unknown): string {
  const title = string(value, 'Title is required.').trim()
  if (title.length < 1 || title.length > 200) invalid('Title must be between 1 and 200 characters.')
  return title
}

export function parseSavedViewName(value: unknown): string {
  const name = string(value, 'Saved view name is required.').trim()
  if (name.length < 1 || name.length > 80) invalid('Saved view name must be between 1 and 80 characters.')
  return name
}

export function filterVideos(videos: readonly VideoSummary[], config: VideoListConfig): VideoSummary[] {
  return videos.filter((video) =>
    (config.status === 'all' || video.status === config.status)
    && (config.format === 'all' || video.production.format === config.format),
  )
}

export function sortVideos(videos: readonly VideoSummary[], sort: VideoSort): VideoSummary[] {
  return [...videos].sort((left, right) => {
    if (sort === 'title-asc') return left.title.localeCompare(right.title)
    if (sort === 'publish-date-asc') {
      return (left.publishDate ?? '9999-12-31').localeCompare(right.publishDate ?? '9999-12-31')
    }
    return right.updatedAt - left.updatedAt
  })
}

export function groupVideos(videos: readonly VideoSummary[], config: VideoListConfig): Map<string, VideoSummary[]> {
  const groups = new Map<string, VideoSummary[]>()
  for (const video of sortVideos(filterVideos(videos, config), config.sort)) {
    const key = config.groupBy === 'status'
      ? video.status
      : config.groupBy === 'format'
        ? video.production.format
        : 'all'
    groups.set(key, [...(groups.get(key) ?? []), video])
  }
  return groups
}

export function failedSave(latest: Video | null): SaveVideoResult {
  return latest ? { kind: 'conflict', latest } : { kind: 'not-found' }
}
