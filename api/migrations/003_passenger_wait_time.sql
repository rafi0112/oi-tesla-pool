-- The driver no longer decides whether a pool waits for more passengers — each
-- passenger states their own patience when booking, and the pool's effective
-- deadline is the earliest (minimum) any current member has asked for.

ALTER TABLE ride_requests
  ADD COLUMN wait_minutes INT NOT NULL DEFAULT 0
    CHECK (wait_minutes >= 0 AND wait_minutes <= 10);

ALTER TABLE pools
  ADD COLUMN wait_until TIMESTAMPTZ;

-- wait_until supersedes wait_for_pool: NULL means "not accepting new joins at
-- all" (nobody aboard asked to wait, or the driver closed the pool early); a
-- timestamp is the live deadline, which only ever ratchets earlier as members
-- with shorter patience join.
ALTER TABLE pools
  DROP COLUMN wait_for_pool;
