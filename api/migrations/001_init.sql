CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- zones must come first: referenced by users (current_zone_id), pools, ride_requests, zone_distances
CREATE TABLE zones (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  lat  NUMERIC(9,6) NOT NULL,
  lng  NUMERIC(9,6) NOT NULL
);

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('PASSENGER','DRIVER')),
  is_online       BOOLEAN NOT NULL DEFAULT false,
  current_zone_id INT  REFERENCES zones(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  seat_capacity INT  NOT NULL CHECK (seat_capacity > 0)
);

CREATE TABLE zone_distances (
  from_zone_id INT NOT NULL REFERENCES zones(id),
  to_zone_id   INT NOT NULL REFERENCES zones(id),
  distance_km  NUMERIC(5,1) NOT NULL CHECK (distance_km > 0),
  PRIMARY KEY (from_zone_id, to_zone_id)
);

CREATE TABLE pools (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      UUID NOT NULL REFERENCES vehicles(id),
  origin_zone_id  INT  NOT NULL REFERENCES zones(id),
  seats_available INT  NOT NULL CHECK (seats_available >= 0),
  status          TEXT NOT NULL CHECK (status IN
                    ('FORMING','ACCEPTED','DRIVER_ARRIVED','EN_ROUTE','COMPLETED','CANCELLED')),
  wait_for_pool   BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ride_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id        UUID NOT NULL REFERENCES users(id),
  pool_id             UUID REFERENCES pools(id),
  pickup_zone_id      INT  NOT NULL REFERENCES zones(id),
  destination_zone_id INT  NOT NULL REFERENCES zones(id),
  seats               INT  NOT NULL CHECK (seats BETWEEN 1 AND 3),
  quoted_fare_paisa   INT  NOT NULL CHECK (quoted_fare_paisa >= 0),
  final_fare_paisa    INT  CHECK (final_fare_paisa >= 0),
  status              TEXT NOT NULL CHECK (status IN
                        ('REQUESTED','MATCHED','PICKED_UP','DROPPED_OFF','CANCELLED')),
  idempotency_key     TEXT UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (pickup_zone_id <> destination_zone_id)
);

CREATE TABLE pool_status_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id       UUID NOT NULL REFERENCES pools(id),
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id),
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ride_status_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_request_id UUID NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  actor_user_id   UUID REFERENCES users(id),
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
