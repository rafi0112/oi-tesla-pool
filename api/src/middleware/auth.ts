import { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import { config } from '../config'
import { UnauthenticatedError } from '../errors'
import { findUserById } from '../repositories/user.repo'
import { AuthedRequest } from '../controllers/auth.controller'

// The anon key is enough here — asking Supabase to verify a token this way
// needs no secret of this app's own, works whether the token came from
// email/password or an OAuth provider, and needs no JWT-signing-algorithm
// bookkeeping on this side at all.
const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return next(new UnauthenticatedError())

  const token = header.slice(7)
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return next(new UnauthenticatedError())

  // Role lives in public.users (the on_auth_user_created trigger put it
  // there — see migration 007), not in the Supabase token itself. A user
  // Supabase considers valid but with no profile row yet (shouldn't happen —
  // the trigger is synchronous — but the check costs nothing) is treated as
  // unauthenticated rather than crashing every role-gated route downstream.
  const profile = await findUserById(data.user.id)
  if (!profile) return next(new UnauthenticatedError())

  ;(req as AuthedRequest).user = { id: data.user.id, role: profile.role }
  next()
}
