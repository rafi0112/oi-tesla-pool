-- Passwords now live in Supabase Auth's own auth.users table, not this app's
-- — drop the column this app used to hash and store them in itself.
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;

-- Everything below only applies where an `auth` schema actually exists — a
-- real Supabase project. A plain local Postgres (the docker-compose service)
-- has no such schema; this migration simply no-ops there rather than
-- failing, so `npm run migrate` still runs cleanly in either environment.
-- Local dev's own login just won't work without a Supabase project behind it
-- from here on — see docs/ASSUMPTIONS.md.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN

    -- users.id is now always a Supabase Auth id, never a value this app
    -- invents itself.
    ALTER TABLE users ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE users
      ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

    -- Populates a matching public.users row — and, for a driver, their
    -- vehicle — the instant Supabase Auth inserts into auth.users. Covers
    -- email/password signup and every OAuth provider identically, since all
    -- of them create that row the same way. Extra fields (name, role,
    -- gender, vehicleName, seatCapacity) travel through signUp()'s own
    -- `options.data`, landing in raw_user_meta_data; an OAuth sign-in
    -- supplies none of these, so it gets sane defaults and the frontend
    -- prompts to complete the profile afterward
    -- (POST /auth/complete-profile).
    CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
    RETURNS trigger AS $fn$
    DECLARE
      meta jsonb := NEW.raw_user_meta_data;
    BEGIN
      INSERT INTO public.users (id, name, email, role, gender)
      VALUES (
        NEW.id,
        COALESCE(meta->>'name', split_part(NEW.email, '@', 1)),
        NEW.email,
        COALESCE(meta->>'role', 'PASSENGER'),
        COALESCE(meta->>'gender', 'OTHER')
      )
      ON CONFLICT (id) DO NOTHING;

      IF COALESCE(meta->>'role', '') = 'DRIVER' AND meta ? 'vehicleName' THEN
        INSERT INTO public.vehicles (driver_id, name, seat_capacity)
        VALUES (NEW.id, meta->>'vehicleName', COALESCE((meta->>'seatCapacity')::int, 3))
        ON CONFLICT (driver_id) DO NOTHING;
      END IF;

      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

  END IF;
END $$;
