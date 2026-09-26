-- one active pool per vehicle at a time
CREATE UNIQUE INDEX one_active_pool_per_vehicle
  ON pools(vehicle_id)
  WHERE status IN ('FORMING','ACCEPTED','DRIVER_ARRIVED','EN_ROUTE');

-- one active ride per passenger at a time
CREATE UNIQUE INDEX one_active_ride_per_passenger
  ON ride_requests(passenger_id)
  WHERE status IN ('REQUESTED','MATCHED','PICKED_UP');

CREATE INDEX ON ride_requests(pool_id);
CREATE INDEX ON ride_requests(passenger_id, created_at DESC);
CREATE INDEX ON pools(vehicle_id, status);

-- used by GET /driver/requests to find open rides in a zone efficiently
CREATE INDEX open_requests_by_zone
  ON ride_requests(pickup_zone_id) WHERE status = 'REQUESTED';

CREATE INDEX ON ride_status_events(ride_request_id, created_at);
CREATE INDEX ON pool_status_events(pool_id, created_at);
