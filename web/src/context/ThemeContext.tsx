import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'oi-tesla-theme'

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Only present once the person has explicitly picked a side — absent means "follow the system". */
function readStored(): Theme | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null)

/**
 * Applies `data-theme` to <html> and mirrors index.html's inline pre-paint
 * script (kept in sync manually — see the comment there) so there's no flash
 * of the wrong theme between first paint and hydration.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => readStored() ?? (systemPrefersDark() ? 'dark' : 'light'))

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Once the person picks explicitly, stop following the OS. Until then, a
  // system-level change (e.g. sunset auto dark mode) keeps tracking live.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => {
      if (readStored()) return
      setTheme(e.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  function toggle() {
    setTheme(t => {
      const next = t === 'light' ? 'dark' : 'light'
      try { window.localStorage.setItem(STORAGE_KEY, next) } catch { /* private mode, etc. */ }
      return next
    })
  }

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
