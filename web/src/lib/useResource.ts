import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'

export interface Resource<T> {
  data: T | undefined
  error: ApiError | null
  /** True only for the very first load — polls refresh silently. */
  loading: boolean
  /** A background poll failed but we are still showing the last good data. */
  stale: boolean
  reload: () => Promise<void>
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Something went wrong')
}

/**
 * Loads once, then re-polls every `pollMs` while `enabled`. Polling pauses while
 * the tab is hidden and resumes with an immediate refresh when it returns.
 */
export function useResource<T>(
  load: () => Promise<T>,
  { pollMs, enabled = true, key }: { pollMs?: number; enabled?: boolean; key?: string | number | null } = {},
): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [stale, setStale] = useState(false)

  const loadRef = useRef(load)
  loadRef.current = load
  const hasData = useRef(false)

  const reload = useCallback(async () => {
    try {
      const next = await loadRef.current()
      hasData.current = true
      setData(next)
      setError(null)
      setStale(false)
    } catch (err) {
      const apiErr = toApiError(err)
      if (hasData.current) setStale(true)
      else setError(apiErr)
    } finally {
      setLoading(false)
    }
  }, [])

  // A new subject means the old data no longer applies.
  useEffect(() => {
    hasData.current = false
    setData(undefined)
    setError(null)
    setStale(false)
  }, [key])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    setLoading(!hasData.current)
    void reload()

    if (!pollMs) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload()
    }, pollMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, pollMs, reload, key])

  return { data, error, loading, stale, reload }
}

export const POLL_MS = 4000

/** The current time, re-rendering every `everyMs` while `active`. */
export function useNow(everyMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(id)
  }, [everyMs, active])
  return now
}
