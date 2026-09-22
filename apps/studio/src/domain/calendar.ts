import type { VideoSummary } from './videos'

export type CalendarMonth = `${number}-${string}`

export type CalendarDay = Readonly<{
  date: string
  day: number
  inMonth: boolean
  videos: readonly VideoSummary[]
}>

export function currentCalendarMonth(now = new Date()): CalendarMonth {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}` as CalendarMonth
}

export function parseCalendarMonth(value: unknown): CalendarMonth {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error('Calendar month is invalid.')
  }
  return value as CalendarMonth
}

export function shiftCalendarMonth(month: CalendarMonth, amount: number): CalendarMonth {
  const [year, monthNumber] = month.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + amount, 1))
  return currentCalendarMonth(shifted)
}

export function calendarMonthRange(month: CalendarMonth): Readonly<{ start: string; end: string }> {
  return { start: `${month}-01`, end: `${shiftCalendarMonth(month, 1)}-01` }
}

export function calendarMonthLabel(month: CalendarMonth): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)))
}

export function buildCalendarMonth(
  month: CalendarMonth,
  videos: readonly VideoSummary[],
): readonly CalendarDay[] {
  const [year, monthNumber] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year, monthNumber - 1, 1))
  const gridStart = new Date(first)
  gridStart.setUTCDate(first.getUTCDate() - first.getUTCDay())
  const byDate = new Map<string, VideoSummary[]>()
  for (const video of videos) {
    if (!video.publishDate) continue
    byDate.set(video.publishDate, [...(byDate.get(video.publishDate) ?? []), video])
  }
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setUTCDate(gridStart.getUTCDate() + index)
    const value = date.toISOString().slice(0, 10)
    return {
      date: value,
      day: date.getUTCDate(),
      inMonth: date.getUTCFullYear() === year && date.getUTCMonth() === monthNumber - 1,
      videos: byDate.get(value) ?? [],
    }
  })
}
