-- A passenger deciding whether to join a pool can now see the gender of who's
-- already aboard (never their name — see poolOption.dto.ts), and a completed
-- ride's history records who was shared with, by name and gender.

ALTER TABLE users
  ADD COLUMN gender TEXT CHECK (gender IN ('MALE', 'FEMALE', 'OTHER'));

-- Backfill the story cast so this migration leaves an already-seeded dev
-- database consistent; seed.ts also sets this going forward.
UPDATE users SET gender = 'MALE'   WHERE email = 'jashim@oitesla.test';
UPDATE users SET gender = 'FEMALE' WHERE email = 'nusrat@oitesla.test';
UPDATE users SET gender = 'MALE'   WHERE email = 'rafiq@oitesla.test';
UPDATE users SET gender = 'FEMALE' WHERE email = 'shirin@oitesla.test';

-- Anyone else already in the table (extra users a test or a manual insert left
-- behind) gets a safe default rather than blocking the NOT NULL below.
UPDATE users SET gender = 'OTHER' WHERE gender IS NULL;

ALTER TABLE users
  ALTER COLUMN gender SET NOT NULL;
