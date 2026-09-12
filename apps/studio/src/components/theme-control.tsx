import { useEffect, useRef } from 'react'

type Theme = 'light' | 'dark' | 'system'

const THEME_KEY = 'yatb-studio-theme'

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function ThemeControl({ compact = false }: { compact?: boolean }) {
  const select = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    if (select.current) {
      select.current.value = readTheme()
      select.current.dataset.ready = ''
    }
  }, [])

  function setTheme(theme: Theme) {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {}
  }

  return (
    <label className={compact ? 'theme-control compact' : 'theme-control'}>
      <span>Theme</span>
      <select
        ref={select}
        aria-label="Color theme"
        defaultValue="system"
        onChange={(event) => setTheme(event.target.value as Theme)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  )
}
