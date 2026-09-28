-- A passenger may rate and comment on a ride once they've been dropped off —
-- never before, and never more than once per ride (the UNIQUE below).
CREATE TABLE ride_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_request_id UUID NOT NULL UNIQUE REFERENCES ride_requests(id) ON DELETE CASCADE,
  passenger_id    UUID NOT NULL REFERENCES users(id),
  rating          INT  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
