import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { api, setToken } from '../api/client'
import type { User } from '../api/types'

export type OAuthProvider = 'google' | 'linkedin_oidc'

export interface RegisterInput {
  name: string
  email: string
  password: string
  role: 'PASSENGER' | 'DRIVER'
  gender: 'MALE' | 'FEMALE' | 'OTHER'
  /** Required only when role is 'DRIVER' — creates that driver's one vehicle. */
  vehicleName?: string
  seatCapacity?: number
}

interface AuthValue {
  user: User | null
  /** True until the initial Supabase session (if any) has been checked and this app's own profile fetched for it. */
  restoring: boolean
  login: (email: string, password: string) => Promise<User>
  register: (input: RegisterInput) => Promise<User>
  loginWithOAuth: (provider: OAuthProvider) => Promise<void>
  logout: () => Promise<void>
  /** Re-fetches this app's own profile — call after completeProfile() so a stale role/profileCompleted doesn't linger. */
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [restoring, setRestoring] = useState(true)

  // This app's own profile (role, gender, profileCompleted) lives in
  // public.users, not in anything Supabase's session itself carries — every
  // session change needs this extra round trip to know who the app thinks
  // they are, not just who Supabase Auth thinks they are.
  const loadProfile = useCallback(async (session: Session | null) => {
    if (!session) {
      setToken(null)
      setUser(null)
      return
    }
    setToken(session.access_token)
    try {
      const { user: profile } = await api.me()
      setUser(profile)
    } catch {
      // Supabase considers the session valid but this app has no matching
      // profile row (shouldn't happen — the trigger is synchronous) — treat
      // it the same as not being signed in rather than getting stuck.
      setToken(null)
      setUser(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      void loadProfile(data.session).finally(() => setRestoring(false))
    })

    // Fires on sign-in, sign-out, token refresh, and — critically — the
    // moment supabase-js finishes parsing an OAuth redirect back into this
    // app, so /auth/callback needs no bespoke handling of its own.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      void loadProfile(session)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const login = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    setToken(data.session.access_token)
    const { user: profile } = await api.me()
    setUser(profile)
    return profile
  }, [])

  // Signing up signs the new account straight in — Supabase issues a session
  // immediately since email confirmation is off (see docs/ASSUMPTIONS.md) —
  // the same one-step experience the app had before this migration. The
  // on_auth_user_created trigger runs inside the same transaction as the
  // auth.users insert, so the profile row already exists by the time signUp()
  // resolves; no separate "wait for it" step is needed.
  const register = useCallback(async (input: RegisterInput) => {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          name: input.name,
          role: input.role,
          gender: input.gender,
          ...(input.role === 'DRIVER' ? { vehicleName: input.vehicleName, seatCapacity: input.seatCapacity } : {}),
        },
      },
    })
    if (error) throw error
    if (!data.session) throw new Error('Registered, but no session was returned — check email confirmation is off')
    setToken(data.session.access_token)
    const { user: profile } = await api.me()
    setUser(profile)
    return profile
  }, [])

  // Leaves the page entirely — Supabase redirects back to /auth/callback,
  // which hands the session to onAuthStateChange above like any other sign-in.
  const loginWithOAuth = useCallback(async (provider: OAuthProvider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) throw error
  }, [])

  // A hard redirect, not just clearing state — see the note this replaced:
  // the whole app remounting fresh against /login can't be raced by a
  // component's own error rendering the way a client-side route swap could.
  const logout = useCallback(async () => {
    await supabase.auth.signOut()
    setToken(null)
    setUser(null)
    if (window.location.pathname !== '/login') {
      window.location.assign('/login')
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    const { user: profile } = await api.me()
    setUser(profile)
  }, [])

  const value = useMemo(
    () => ({ user, restoring, login, register, loginWithOAuth, logout, refreshProfile }),
    [user, restoring, login, register, loginWithOAuth, logout, refreshProfile],
  )

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
