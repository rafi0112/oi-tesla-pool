-- Email/password signUp() always sends role+gender as metadata, so that
-- profile is complete the instant the trigger creates it. An OAuth sign-in
-- (Google, LinkedIn) can supply neither — there's no form to fill in before
-- the redirect — so its profile starts incomplete, and the frontend sends
-- that person to a short "finish setting up your account" step
-- (POST /auth/complete-profile) once they land back.
ALTER TABLE users ADD COLUMN profile_completed BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN

    CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
    RETURNS trigger AS $fn$
    DECLARE
      meta jsonb := NEW.raw_user_meta_data;
    BEGIN
      INSERT INTO public.users (id, name, email, role, gender, profile_completed)
      VALUES (
        NEW.id,
        COALESCE(meta->>'name', split_part(NEW.email, '@', 1)),
        NEW.email,
        COALESCE(meta->>'role', 'PASSENGER'),
        COALESCE(meta->>'gender', 'OTHER'),
        meta ? 'role'
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

  END IF;
END $$;
