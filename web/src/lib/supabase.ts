import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — see web/.env')
}

/**
 * The one Supabase client this app uses. Session persistence, refresh, and
 * the OAuth redirect handshake are all handled by supabase-js itself — see
 * AuthContext.tsx for how the app's own state stays in sync with it.
 */
export const supabase = createClient(url, anonKey)
