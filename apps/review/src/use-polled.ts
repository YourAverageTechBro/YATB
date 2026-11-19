import { useCallback, useEffect, useRef, useState } from 'react'

const POLL_MS = 3000

// Skips setState when the payload is unchanged so a poll never re-renders the page, the player, or a half-typed comment.
export function usePolled<T>(load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const last = useRef('')

  // `key` stands in for whatever `load` closes over, so callers can pass an inline function.
  const refresh = useCallback(async () => {
    try {
      const next = await load()
      const json = JSON.stringify(next)
      if (json !== last.current) { last.current = json; setData(next) }
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load.')
    }
  }, [key])

  useEffect(() => {
    void refresh()
    const tick = () => { if (!document.hidden) void refresh() }
    const timer = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [refresh])

  return { data, error, refresh }
}
