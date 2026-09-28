-- A passenger may offer an optional bonus on top of the normal fare, paid to
-- attract a driver faster — most useful after their last request expired
-- unanswered, but not restricted to that moment.
ALTER TABLE ride_requests
  ADD COLUMN bonus_paisa INT NOT NULL DEFAULT 0 CHECK (bonus_paisa >= 0);

-- No index needed for the 15-minute expiry check itself (see
-- ride.service.ts expireIfStale): it runs against a single already-loaded
-- row's created_at, the same self-healing pattern pools already use for
-- their own wait_until, not a scheduled sweep.
