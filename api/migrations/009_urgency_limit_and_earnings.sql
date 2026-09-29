-- One "in a hurry" press per booking, not per pool visit — see
-- pool.service.ts's applyUrgency, which locks this row and checks it inside
-- the same transaction as the halving itself.
ALTER TABLE ride_requests
  ADD COLUMN urgency_used BOOLEAN NOT NULL DEFAULT false;

-- Recorded the moment a ride is actually dropped off (not the same instant as
-- final_fare_paisa, which is locked in earlier, at boarding) so "earnings
-- today" can filter directly without re-deriving the timestamp from
-- ride_status_events on every read — see pool.service.ts's dropOffPassenger
-- and ride.repo.ts's sumDriverEarnings.
ALTER TABLE ride_requests
  ADD COLUMN dropped_off_at TIMESTAMPTZ;

-- Serves the "today" half of sumDriverEarnings' single aggregate query.
CREATE INDEX ride_requests_dropped_off_at_idx
  ON ride_requests (dropped_off_at)
  WHERE status = 'DROPPED_OFF';
