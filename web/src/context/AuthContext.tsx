import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setToken, setUnauthorizedHandler } from '../api/client'
import type { User } from '../api/types'

const STORAGE_KEY = 'oi-tesla-pool.session'

interface Session {
  token: string
  user: User
}

interface AuthValue {
  user: User | null
  /** True until a stored session has been checked against the server. */
  restoring: boolean
  login: (email: string, password: string) => Promise<User>
  logout: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

// Storage can throw outright (private mode, blocked site data) — never let that
// take the app down; the session simply won't survive a reload.
function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

function writeSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* non-persistent session is fine */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [restoring, setRestoring] = useState(true)

  const logout = useCallback(() => {
    setToken(null)
    writeSession(null)
    setUser(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
    return () => setUnauthorizedHandler(null)
  }, [logout])

  useEffect(() => {
    const stored = readSession()
    if (!stored) {
      setRestoring(false)
      return
    }

    setToken(stored.token)
    api.me()
      .then(({ user: fresh }) => {
        setUser(fresh)
        writeSession({ token: stored.token, user: fresh })
      })
      .catch(() => logout())
      .finally(() => setRestoring(false))
  }, [logout])

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: signedIn } = await api.login(email, password)
    setToken(token)
    writeSession({ token, user: signedIn })
    setUser(signedIn)
    return signedIn
  }, [])

  const value = useMemo(() => ({ user, restoring, login, logout }), [user, restoring, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function homeFor(role: User['role']): string {
  return role === 'DRIVER' ? '/driver' : '/passenger'
}
