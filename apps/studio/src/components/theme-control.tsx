import { useEffect, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@yatb/ui/select'

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
  const [theme, setPreference] = useState<Theme>('system')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setPreference(readTheme())
    setReady(true)
  }, [])

  function setTheme(theme: Theme) {
    setPreference(theme)
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {}
  }

  return (
    <label className={compact ? 'theme-control compact' : 'theme-control'}>
      <span>Theme</span>
      <span className="theme-select-shell" data-ready={ready ? '' : undefined}>
        <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <SelectTrigger aria-label="Color theme" size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </span>
    </label>
  )
}
