import { useEffect, useState } from 'react'
import { NativeSelect, NativeSelectOption } from '@yatb/ui/native-select'

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
        <NativeSelect aria-label="Color theme" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
          <NativeSelectOption value="system">System</NativeSelectOption>
          <NativeSelectOption value="light">Light</NativeSelectOption>
          <NativeSelectOption value="dark">Dark</NativeSelectOption>
        </NativeSelect>
      </span>
    </label>
  )
}
