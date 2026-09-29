import { createClient } from '@supabase/supabase-js'
import { config } from '../config'
import { SEED_PASSWORD, USERS, VEHICLE } from './seedData'

/**
 * Creates the story cast through Supabase Auth itself, rather than inserting
 * rows into `users` directly — the same path a real signup takes. The
 * on_auth_user_created trigger (migration 007) does the rest: it reads
 * user_metadata and creates the matching public.users row, and for the
 * driver, their vehicle. Uses the service role key, so this only ever runs
 * server-side (never ship this key to the frontend).
 */
async function seedAuth() {
  const admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  for (const u of USERS) {
    const { data: existing } = await admin.auth.admin.listUsers()
    const already = existing.users.find(x => x.email === u.email)
    if (already) {
      console.log(`skipped  ${u.email} (already exists)`)
      continue
    }

    const { error } = await admin.auth.admin.createUser({
      email: u.email,
      password: SEED_PASSWORD,
      email_confirm: true, // matches "log in immediately" — no confirmation email in this demo
      user_metadata: {
        name: u.name,
        role: u.role,
        gender: u.gender,
        ...(u.role === 'DRIVER' ? { vehicleName: VEHICLE.name, seatCapacity: VEHICLE.seatCapacity } : {}),
      },
    })

    if (error) {
      console.error(`failed   ${u.email}:`, error.message)
      process.exitCode = 1
      continue
    }
    console.log(`created  ${u.email}`)
  }

  console.log('seedAuth complete')
}

seedAuth().catch(err => {
  console.error('seedAuth failed:', err)
  process.exit(1)
})
