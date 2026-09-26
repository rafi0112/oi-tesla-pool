# Oi Tesla Pool — Build Plan (Blocks A → K)

This is the complete, authoritative specification for this project.
Follow it in order. Do not invent requirements that are not written here.

---

## 0. Context

**Project:** RoBenDevs hiring challenge — a ride-pooling MVP for a three-seat
battery vehicle in Dhaka. One driver (Jashim) with one vehicle (Bullet, 3 seats)
can carry several independent passengers (Nusrat, Rafiq, Shirin) on one trip.
Each passenger books alone, pays their own fare, and has their own status.

**Deadline:** Sunday night. Optimise for a small, correct, well-documented MVP,
not for feature count. The brief scores process (git history, docs, Docker, tests)
as heavily as features.

**Starting point:** the repo may already be partly set up. Block A begins by
checking what exists and creating only what is missing. Do not assume anything is
present, and do not recreate anything that already is.

---

## 1. Working rules — read these before every step

1. **One step at a time.** Do exactly one numbered step, then stop and wait.
   Never run ahead to the next step.

2. **Never run `git commit`, `git add`, `git merge`, `git checkout` or `git push`.**
   After finishing a step, print the suggested commit message and stop.
   The human stages and commits by hand. This is deliberate: the git history is
   part of the assessment and must show real time passing between commits.
   Read-only git commands (`git status`, `git log`, `git branch`) are fine.

3. **Before writing code for a step, state in 2–3 lines what you are about to do
   and which files you will touch.** Then do it.

4. **After each step, print a short "How to verify" block** — the exact commands
   or clicks that prove the step works.

5. **No new dependencies** beyond those listed in a step. In particular: no ORM,
   no Redis, no message queue, no WebSocket library, no state-management library.

6. **Ask rather than assume.** If this document does not specify something,
   ask one short question instead of inventing behaviour.

7. **Never overwrite existing work.** If a file a step asks for already exists,
   read it, report whether it satisfies the step, and change only what is missing.

---

## 2. Architecture rules — apply to every step

**Layering.** `routes → zod validation → controllers → services → repositories`.

- Controllers contain no business rules. They parse the request, call one service,
  serialise the result through a DTO, and return.
- Services contain the business rules and own transactions.
- Repositories contain SQL only. They take and return plain objects.
- `src/domain/` holds pure functions with no I/O: fare, matching, state machine,
  money. These must be unit-testable without a database.

**Folder layout (target state):**

```
api/src
  config.ts
  index.ts
  db/            pool.ts  migrate.ts  seed.ts
  domain/        money.ts  fare.ts  matching.ts  stateMachine.ts
  repositories/  user.repo.ts  ride.repo.ts  pool.repo.ts  zone.repo.ts  event.repo.ts
  services/      auth.service.ts  ride.service.ts  pool.service.ts  driver.service.ts
  controllers/
  routes/
  dto/           passenger.dto.ts  driver.dto.ts
  middleware/    auth.ts  requireRole.ts  errorHandler.ts  idempotency.ts
  errors.ts
web/src
  main.tsx  App.tsx
  api/client.ts
  context/AuthContext.tsx
  pages/  Login.tsx  PassengerHome.tsx  DriverHome.tsx
  components/
```

**Money.** All currency is integer paisa. No floats anywhere in a money path.
Convert to taka only for display, in one place.

**Never return a raw database row to the client.** Always map through a DTO.

---

## 3. Domain specification — the single source of truth

### 3.1 Fare

```
baseFare      = 2000 paisa  (৳20)
perKm         = 1000 paisa  (৳10)

soloFarePaisa = baseFare + round(distanceKm * perKm)
poolDiscount  = 20% of soloFarePaisa, applied only when the pool has >= 2 active passengers
passengerFare = soloFarePaisa - poolDiscount
```

Worked examples that must hold exactly:

| Passenger | Route | Distance | Solo | Pooled |
|---|---|---|---|---|
| Nusrat | Banani → Mohakhali | 3.0 km | 5000 (৳50.00) | **4000 (৳40.00)** |
| Rafiq | Banani → Gulshan 1 | 4.0 km | 6000 (৳60.00) | **4800 (৳48.00)** |

`quoted_fare_paisa` is written at booking time. `final_fare_paisa` is written
when the trip starts (`EN_ROUTE`) and never changes afterwards. Before the trip
starts, a passenger's displayed fare is recomputed from current pool membership —
so if Rafiq cancels before pickup, Nusrat reverts to the solo fare.

### 3.2 Matching rule

```ts
export const POOL_POLICY = { detourCapKm: 3.0, poolWindowMinutes: 10 }
```

A ride request may join an existing pool only when **all five** hold:

1. `pool.status` is `FORMING` or `ACCEPTED`
2. `pool.seats_available >= request.seats`
3. `request.pickup_zone_id === pool.origin_zone_id`
4. `pooledRouteKm <= max(soloKm of all active members incl. the candidate) + detourCapKm`
5. `now - pool.created_at <= poolWindowMinutes`

`pooledRouteKm` is computed greedily: start at the origin zone, repeatedly travel
to the nearest not-yet-visited destination zone among all active members, summing
distances from the seeded matrix.

Must hold for the story: Banani → Mohakhali → Gulshan 1 = 3.0 + 2.0 = 5.0 km;
longest solo leg is Rafiq's 4.0 km; cap = 7.0 km; 5.0 ≤ 7.0, so they pool.

`canJoin(pool, request, distances)` returns `{ ok: boolean, reason?: string }`
and is a pure function.

### 3.3 State machines

```ts
RIDE_TRANSITIONS = {
  REQUESTED:   ['MATCHED', 'CANCELLED'],
  MATCHED:     ['PICKED_UP', 'CANCELLED'],
  PICKED_UP:   ['DROPPED_OFF'],       // no cancellation once on board
  DROPPED_OFF: [],
  CANCELLED:   [],
}

POOL_TRANSITIONS = {
  FORMING:        ['ACCEPTED', 'CANCELLED'],
  ACCEPTED:       ['DRIVER_ARRIVED', 'CANCELLED'],
  DRIVER_ARRIVED: ['EN_ROUTE', 'CANCELLED'],
  EN_ROUTE:       ['COMPLETED'],
  COMPLETED:      [],
  CANCELLED:      [],
}
```

A single `assertTransition(table, from, to)` guards every status change.
Every status change writes a row to `ride_status_events` **inside the same
transaction** as the update.

### 3.4 Seat capacity — the most important code in the project

Seats are decremented with one atomic conditional UPDATE. Never read-then-write.

```ts
const { rowCount } = await client.query(
  `UPDATE pools
      SET seats_available = seats_available - $2
    WHERE id = $1
      AND seats_available >= $2
      AND status IN ('FORMING','ACCEPTED')`,
  [poolId, seats]
)
if (rowCount === 0) throw new ConflictError('POOL_FULL', 'That seat was just taken')
```

Seats are returned on cancellation with the mirrored `+ $2` update, guarded so it
can never exceed the vehicle capacity.

### 3.5 Error contract

Every error response is:

```json
{ "error": { "code": "POOL_FULL", "message": "human readable", "details": {} } }
```

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHENTICATED` | missing or invalid token |
| 403 | `FORBIDDEN_ROLE` | a passenger calls a driver endpoint, or vice versa |
| 404 | `NOT_FOUND` | resource missing **or not owned by the caller** |
| 409 | `POOL_FULL` | no seats left |
| 409 | `INVALID_TRANSITION` | illegal status change |
| 409 | `NOT_JOINABLE` | matching rule rejected the request |
| 409 | `ALREADY_ACTIVE` | passenger already has an active ride |
| 422 | `VALIDATION_ERROR` | zod rejected the body |

Ownership failures return **404, not 403**, to avoid resource enumeration.

### 3.6 DTOs

`toPassengerRideDTO` returns: id, status, farePaisa, pickup/destination zone names,
seats, driver `{ name, vehicle }` when matched, `sharedWith` (count of other active
passengers), and `canCancel` (derived from the transition table).
It must **never** include other passengers' names or fares.

`toDriverPoolDTO` returns: id, status, seatsAvailable, seatCapacity, originZone,
and per-passenger `{ rideId, name, seats, pickupZone, destinationZone, status }`.
It must **never** include fares.

---

## 4. Block A — Foundations (steps A0–A3)

Branch: `feature/project-setup`

### A0 — Audit first, build second

**This step is a check, not a build.** Run read-only commands and report.

```bash
git log --oneline --all
git branch -a
git status
ls -a
ls docs 2>/dev/null
```

Produce a table with one row per item below: present / missing / present but
incomplete.

| Item | Expected |
|---|---|
| Branches | `master`, `pre-release`, `feature/project-setup` |
| `.gitignore` | contains `node_modules`, `.env`, `dist`, `coverage` |
| Folders | `api/src`, `web`, `docs` |
| `CLAUDE.md` | at repo root, holds project conventions |
| `docs/architecture.md` | flowchart + layer table + ERD (A1) |
| `docs/ASSUMPTIONS.md` | 10 numbered assumptions (A2) |
| `BUILD_PLAN.md` | this file, at repo root |

Then **stop**. Do not create anything yet. The human will tell you which of
A1–A3 to run. Skip any step whose output already exists and is complete; say so
rather than rewriting it.

### A1 — `docs/architecture.md`

Three parts, in English.

**(a)** A Mermaid `flowchart TD`: Browser (React + Vite + Tailwind) → REST + JWT,
4-second polling → Express API (TypeScript) → `pg` → PostgreSQL. A subgraph for
the API's internal layers: Routes → Zod validation → Controllers → Services
(business logic) → Repositories (DB access). A second subgraph "pure domain logic"
containing Fare Engine, Matching Rule and State Machine, reached from Services by
dotted arrows.

**(b)** A table of the layers, one line of responsibility each. The governing
rule: no business logic in controllers.

**(c)** A Mermaid `erDiagram` with seven tables:

- `users` — id, name, email, password_hash, role (PASSENGER/DRIVER), is_online
- `vehicles` — id, driver_id (unique FK), name, seat_capacity
- `zones` — id, name
- `zone_distances` — from_zone_id, to_zone_id, distance_km
- `pools` — id, vehicle_id, origin_zone_id, seats_available, status, created_at
- `ride_requests` — id, passenger_id, pool_id (nullable), pickup_zone_id,
  destination_zone_id, seats, quoted_fare_paisa, final_fare_paisa, status,
  idempotency_key
- `ride_status_events` — id, ride_request_id, from_status, to_status,
  actor_user_id, created_at

Relationships: users 1—0..1 vehicles · users 1—0..* ride_requests ·
vehicles 1—0..* pools · pools 1—0..* ride_requests ·
ride_requests 1—0..* ride_status_events · zones 1—0..* ride_requests.

Finish with a short "Design decisions" section: why `seats_available` is its own
column (it is the target of the atomic update), why `pool_id` is nullable (a
request exists before a pool does), why quoted and final fare are separate, and
why every money column carries a `_paisa` suffix.

Commit: `docs(architecture): add system diagram and erd`

### A2 — `docs/ASSUMPTIONS.md`

Ten numbered assumptions, each with a one-line reason, in English:

1. Joining a pool is allowed only while it is `FORMING` or `ACCEPTED` — never
   after the trip starts.
2. Same pickup zone is mandatory; pickup points inside a zone are not modelled.
3. Detour cap is an absolute 3.0 km, not a percentage — a percentage would be
   unreasonable on short trips.
4. Pooling window is 10 minutes.
5. Fare is quoted at booking and locked when the trip starts.
6. If someone cancels before pickup, the remaining passengers revert to the solo
   fare; after the trip starts fares are fixed.
7. A passenger may have only one active ride at a time (enforced by a DB index).
8. A vehicle may have only one active pool at a time.
9. Distances are seeded and symmetric (A→B = B→A); no map API is used.
10. Payment is simulated — cash or wallet balance, no real gateway.

Commit: `docs(assumptions): record pooling, fare and cancellation rules`

### A3 — `CLAUDE.md` (only if missing)

Repo root. Must state: the stack (Express + TypeScript + `pg` with raw SQL, no
ORM; React + Vite + React Router + Tailwind; Vitest + Supertest); that
`BUILD_PLAN.md` is the authoritative spec and §1 applies to every step; the
non-negotiable rules from §3 (integer paisa, atomic seat update, transition table,
no business logic in controllers, DTOs always, story cast in seed and tests, no
Redis/queue/WebSocket/ORM); and that you never run git commands.

Commit: `docs(claude): add project conventions and guardrails`

---

## 5. Block B — Database foundation (steps B1–B5)

Branch: `feature/db-schema`

### B1 — Postgres container

Root `docker-compose.yml`, `db` service only: `postgres:16-alpine`, env vars via
`${...}`, a `pg_isready` healthcheck (interval 5s, retries 5), named volume
`pgdata`, port mapping `5433:5432` (5433 to avoid clashing with a local Postgres).

Root `.env.example`:

```
POSTGRES_USER=tesla
POSTGRES_PASSWORD=change_me
POSTGRES_DB=tesla_pool
DATABASE_URL=postgresql://tesla:change_me@localhost:5433/tesla_pool
JWT_SECRET=replace_with_long_random_string
API_PORT=4000
```

Commit: `build(docker): add postgres service with healthcheck`

### B2 — API scaffold

In `api/`: `npm init`; dependencies `express pg dotenv zod cors pino pino-http
argon2 jsonwebtoken`; dev dependencies `typescript tsx @types/node @types/express
@types/pg @types/jsonwebtoken`.

- `tsconfig.json` — strict, target ES2022, outDir `dist`
- `src/config.ts` — reads env, throws immediately if a variable is missing
- `src/db/pool.ts` — one shared `pg` Pool plus a `withTransaction(fn)` helper
  handling BEGIN / COMMIT / ROLLBACK
- `src/index.ts` — express app with cors, json, pino-http, and
  `GET /health` returning `{ status: 'ok' }`
- `package.json` scripts: `dev`, `build`, `migrate`, `seed`

Commit: `chore(api): add typescript express scaffold with health endpoint`

### B3 — Migration runner

`api/src/db/migrate.ts`, no library:

- creates `_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`
  if absent
- reads `.sql` files from `api/migrations/`, sorted by name
- runs only those not yet recorded, each in its own transaction, recording the
  name on success
- prints which ran and which were skipped

Running it twice must be safe.

Commit: `feat(db): add sql migration runner`

### B4 — Schema

`api/migrations/001_init.sql` — use exactly this:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('PASSENGER','DRIVER')),
  is_online     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  seat_capacity INT  NOT NULL CHECK (seat_capacity > 0)
);

CREATE TABLE zones (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
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

CREATE TABLE ride_status_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_request_id UUID NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  actor_user_id   UUID REFERENCES users(id),
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`api/migrations/002_indexes.sql` — use exactly this:

```sql
CREATE UNIQUE INDEX one_active_pool_per_vehicle
  ON pools(vehicle_id)
  WHERE status IN ('FORMING','ACCEPTED','DRIVER_ARRIVED','EN_ROUTE');

CREATE UNIQUE INDEX one_active_ride_per_passenger
  ON ride_requests(passenger_id)
  WHERE status IN ('REQUESTED','MATCHED','PICKED_UP');

CREATE INDEX ON ride_requests(pool_id);
CREATE INDEX ON ride_requests(passenger_id, created_at DESC);
CREATE INDEX ON pools(vehicle_id, status);
CREATE INDEX open_requests_by_zone
  ON ride_requests(pickup_zone_id) WHERE status = 'REQUESTED';
CREATE INDEX ON ride_status_events(ride_request_id, created_at);
```

Do not alter this SQL.

Commit: `feat(db): add core schema with seat and active-ride invariants`

### B5 — Seed

`api/src/db/seed.ts`, fully idempotent (`ON CONFLICT DO NOTHING` / `DO UPDATE`),
safe to run repeatedly.

Users — password `Password123!` for all, hashed with argon2:

| Name | Email | Role |
|---|---|---|
| Jashim Uddin | jashim@oitesla.test | DRIVER |
| Nusrat Jahan | nusrat@oitesla.test | PASSENGER |
| Rafiq Hasan | rafiq@oitesla.test | PASSENGER |
| Shirin Akter | shirin@oitesla.test | PASSENGER |

Vehicle: **Bullet**, owned by Jashim, `seat_capacity` 3.

Zones: Banani, Gulshan 1, Mohakhali, Dhanmondi, Mirpur, Uttara, Farmgate,
Bashundhara.

Distances in km — insert **both directions** for every pair:

```
Banani–Gulshan 1 4.0        Banani–Mohakhali 3.0        Banani–Dhanmondi 8.0
Banani–Mirpur 7.0           Banani–Uttara 9.0           Banani–Farmgate 6.0
Banani–Bashundhara 6.5      Gulshan 1–Mohakhali 2.0     Gulshan 1–Dhanmondi 9.0
Gulshan 1–Mirpur 9.5        Gulshan 1–Uttara 11.0       Gulshan 1–Farmgate 7.0
Gulshan 1–Bashundhara 5.0   Mohakhali–Dhanmondi 6.5     Mohakhali–Mirpur 7.5
Mohakhali–Uttara 11.5       Mohakhali–Farmgate 4.0      Mohakhali–Bashundhara 7.0
Dhanmondi–Mirpur 8.0        Dhanmondi–Uttara 16.0       Dhanmondi–Farmgate 3.5
Dhanmondi–Bashundhara 12.0  Mirpur–Uttara 12.0          Mirpur–Farmgate 6.0
Mirpur–Bashundhara 13.0     Uttara–Farmgate 14.0        Uttara–Bashundhara 8.0
Farmgate–Bashundhara 10.0
```

Seed no pools and no rides — those are created live during the demo.

Commit: `feat(db): seed Jashim, Bullet, Nusrat, Rafiq and Shirin`

**Verify before committing:**

```bash
cp .env.example .env
docker compose up -d db
docker compose ps                              # db healthy
cd api && npm run migrate && npm run migrate    # second run says "skipped"
npm run seed && npm run seed                    # second run does not crash
```

---

## 6. Block C — Authentication (steps C1–C3)

Branch: `feature/passenger-auth`

**C1 — Errors, validation and error handling middleware**
`src/errors.ts` with `AppError` base plus `ValidationError`, `UnauthenticatedError`,
`ForbiddenRoleError`, `NotFoundError`, `ConflictError(code, message)`.
`src/middleware/errorHandler.ts` maps them to the contract in §3.5, logs 5xx with
pino, and never leaks a stack trace to the client. Wire it in `index.ts` last.
A `validate(schema)` middleware turns zod failures into `422 VALIDATION_ERROR`.

Commit: `feat(api): add error contract and validation middleware`

**C2 — Registration and login**
`POST /auth/register` `{ name, email, password, role }` — argon2 hash, returns 201
with a token. `POST /auth/login` returns `{ token, user }`. `GET /auth/me`.
JWT payload `{ sub, role }`, 24h expiry, signed with `JWT_SECRET`.
Repository, service, controller, route — four files, following §2.

Commit: `feat(auth): add registration and login with jwt issuance`

**C3 — Auth and role middleware**
`middleware/auth.ts` reads the Bearer token, verifies it, attaches
`req.user = { id, role }`, throws `UNAUTHENTICATED` otherwise.
`middleware/requireRole('DRIVER')` throws `FORBIDDEN_ROLE`.
Add a typed `AuthedRequest`.

Commit: `feat(auth): add bearer token and role guard middleware`

---

## 7. Block D — Fare engine (steps D1–D3)

Branch: `feature/fare-engine`

**D1 — Money module**
`src/domain/money.ts`: `Paisa` branded type, `taka(n)`, `toTaka(paisa)`,
`formatTaka(paisa)` → `"৳40.00"`. All rounding via `Math.round`. No floats stored.

Commit: `feat(fare): add integer paisa money module`

**D2 — Fare calculation**
`src/domain/fare.ts`: `FARE_POLICY = { baseFarePaisa: 2000, perKmPaisa: 1000, poolDiscountPercent: 20 }`,
`soloFare(distanceKm)`, `pooledFare(distanceKm)`, `fareFor(distanceKm, activePassengerCount)`.
Pure, no imports from db.

Commit: `feat(fare): add solo and pooled fare calculation`

**D3 — Zones and quote endpoint**
`GET /zones` (public). `POST /rides/quote` `{ pickupZoneId, destinationZoneId, seats }`
→ `{ distanceKm, soloFarePaisa, pooledFarePaisa }`. Reads the distance matrix through
`zone.repo.ts`. Creates no rows.

Commit: `feat(api): add zones and fare quote endpoints`

---

## 8. Block E — Pooling (steps E1–E5) ⭐

Branch: `feature/tesla-pooling`
This is the core of the assessment. Take extra care here.

**E1 — Ride request creation with idempotency**
`POST /rides` `{ pickupZoneId, destinationZoneId, seats }` with an
`Idempotency-Key` header. Stores the key in `ride_requests.idempotency_key`;
a repeat of the same key returns the original ride instead of creating a new one.
Rejects with `ALREADY_ACTIVE` if the passenger already has an active ride
(the DB partial unique index is the real guard; catch the unique violation and
translate it). Writes `quoted_fare_paisa` from the solo fare.
`GET /rides/mine`, `GET /rides/:id` (404 if not owner).

Commit: `feat(ride): add ride request creation with idempotency key`

**E2 — Matching rule**
`src/domain/matching.ts` exactly as §3.2, including `pooledRouteKm` greedy ordering.
Pure function, no db access.

Commit: `feat(pool): add same-origin detour-capped matching rule`

**E3 — Pool creation**
`POST /pools` `{ rideRequestId }` (driver only). Creates a pool for the driver's
vehicle with `seats_available = seat_capacity - request.seats`, status `ACCEPTED`,
`origin_zone_id` from the request, and moves the ride to `MATCHED` with its
`pool_id` set — all in one transaction, with a status event written.
Rejects if the driver already has an active pool (the partial unique index).

Commit: `feat(pool): create pool on first accepted request`

**E4 — Joining a pool, atomically**
`POST /pools/:id/rides` `{ rideRequestId }` (driver only). In one transaction:
run `canJoin`; reject with `NOT_JOINABLE` and the reason if false; then the atomic
conditional UPDATE from §3.4; `rowCount === 0` → `POOL_FULL`; then move the ride to
`MATCHED`, set `pool_id`, and write the status event.

Commit: `feat(pool): enforce Bullet's seat capacity atomically`

**E5 — Pool-aware fares**
When a pool has two or more active passengers, every active member's displayed fare
is the pooled fare; when it drops back to one, it reverts to solo. Implement this as
a recomputation in the read path (services/DTO), not as a stored value, until the
trip starts.

Commit: `feat(pool): apply pool discount when a second passenger joins`

---

## 9. Block F — Ride lifecycle (steps F1–F4)

Branch: `feature/ride-lifecycle`

**F1 — State machine module**
`src/domain/stateMachine.ts` with both tables from §3.3 and `assertTransition`.
Refactor E3/E4 to use it. No ad-hoc status checks anywhere else.

Commit: `feat(ride): add ride and pool transition tables`

**F2 — Audit trail**
`event.repo.ts` plus a `transitionRide(tx, ride, next, actorId, reason?)` helper
used by every status change; it asserts, updates, and inserts the event in the same
transaction. Expose the timeline on `GET /rides/:id`.

Commit: `feat(ride): record status events for audit trail`

**F3 — Cancellation**
`POST /rides/:id/cancel` (passenger; 404 if not owner). Rejected after `PICKED_UP`
by the transition table. If the ride was in a pool, return its seats with the
mirrored update in the same transaction. If the pool has no active members left,
cancel the pool too.

Commit: `feat(ride): release seats on passenger cancellation`

**F4 — Fare locking**
When the pool transitions to `EN_ROUTE`, write `final_fare_paisa` for every active
member based on the membership count at that moment. After that, fares are read
from `final_fare_paisa` and never recomputed.

Commit: `feat(ride): lock fares when the trip starts`

---

## 10. Block G — Driver flow (steps G1–G4)

Branch: `feature/driver-flow`

**G1 — Availability**
`PATCH /drivers/me` `{ isOnline }`. Offline drivers receive no request feed.

Commit: `feat(driver): add online and offline availability`

**G2 — Request feed**
`GET /driver/requests` — open `REQUESTED` rides, newest first. If the driver has an
active pool, annotate each with `{ joinable: boolean, reason?: string }` from
`canJoin`. Uses the `open_requests_by_zone` partial index.

Commit: `feat(driver): add open request feed with joinability hints`

**G3 — Trip actions**
`POST /pools/:id/arrive` → `DRIVER_ARRIVED`.
`POST /pools/:id/start` → `EN_ROUTE`, moves every `MATCHED` member to `PICKED_UP`
and locks fares (F4).
`POST /pools/:id/rides/:rideId/dropoff` → that member to `DROPPED_OFF` only.
`POST /pools/:id/complete` → `COMPLETED`; rejected while any member is still
`PICKED_UP`.
`GET /pools/active` — the driver's current pool.
All driver-only, all ownership-checked (404 if the pool is not this driver's).

Commit: `feat(driver): add arrive, start, dropoff and complete actions`

**G4 — Role-scoped DTOs**
Implement §3.6 and route every response through them. Verify by hand that a
passenger response contains no other passenger's name or fare.

Commit: `feat(api): add role scoped dtos hiding co-passenger fares`

---

## 11. Block H — Tests (steps H1–H3)

Branch: `feature/tests`
Add `vitest` and `supertest`. Integration tests go through the real HTTP layer
against a test database; truncate all tables before each test. Domain tests need
no database.

**H1 — Domain unit tests**
- Nusrat's pooled fare is exactly `4000`; Rafiq's is exactly `4800` (`toBe`, not `toBeCloseTo`)
- solo fares are `5000` and `6000`
- `canJoin` accepts the Nusrat/Rafiq case (5.0 km ≤ 7.0 km cap)
- `canJoin` rejects a different pickup zone, a full pool, and an `EN_ROUTE` pool
- `assertTransition` rejects `DROPPED_OFF → PICKED_UP`

Commit: `test(domain): cover fare, matching and transition rules`

**H2 — The concurrency test** ⭐
With a pool that has exactly 1 seat left, fire five join requests with
`Promise.all`. Assert exactly one `201`, four `409 POOL_FULL`, and
`seats_available === 0` afterwards.

Commit: `test(pool): cover concurrent seat claims on the last seat`

**H3 — API behaviour tests**
- a fourth passenger cannot exceed Bullet's 3 seats
- Shirin cannot cancel Nusrat's ride → `404`
- cancelling after `PICKED_UP` → `409`
- cancelling a matched ride returns the seat to the pool
- a passenger calling a driver endpoint → `403`

Commit: `test(api): cover capacity, ownership and cancellation rules`

---

## 12. Block I — Frontend (steps I1–I4)

Branch: `feature/frontend`
React + Vite + React Router + Tailwind. Three pages only. Plain and clean;
no animation work. Every page needs explicit loading, error and empty states.

**I1 — Shell**
Vite + Tailwind setup in `web/`. `api/client.ts` with a typed `request()` that
attaches the bearer token and throws a typed error carrying `error.code`.
`AuthContext` (token in memory + localStorage, wrapped in try/catch).
Router with a `ProtectedRoute` that redirects by role.

Commit: `feat(web): add app shell, api client and auth context`

**I2 — Login**
Email + password, error display, and a visible list of the four seeded demo
accounts with a one-click fill so the evaluator never has to type.

Commit: `feat(web): add login screen with seeded demo accounts`

**I3 — Passenger page**
Booking form: pickup zone, destination zone, seats; a live quote (debounced
`/rides/quote`) showing solo and pooled fare before booking.
Once a ride is active, the same page shows a status timeline
(`REQUESTED → MATCHED → PICKED_UP → DROPPED_OFF`), the current fare, the driver and
vehicle, `Shared with N other passenger(s)`, and a Cancel button that is disabled
whenever `canCancel` is false. Polls every 4 seconds while a ride is active.

Commit: `feat(web): add passenger booking and ride tracking`

**I4 — Driver page**
Online/offline toggle. Open request feed with an Accept button — disabled with the
reason shown when `joinable` is false. Active pool panel: seats remaining out of
capacity, each passenger with pickup and destination, and per-passenger Drop off
buttons. Arrive / Start / Complete buttons gated by pool status. Shows the
`POOL_FULL` message plainly when the race is lost. Polls every 4 seconds.

Commit: `feat(web): add driver dashboard and active pool management`

---

## 13. Block J — Docker (steps J1–J2)

Branch: `feature/docker`

**J1 — Images**
`api/Dockerfile` (multi-stage, production deps only) and `web/Dockerfile`
(build then serve the static bundle). `.dockerignore` for both.

Commit: `build(docker): add api and web images`

**J2 — Compose**
Add `api` and `web` to `docker-compose.yml`. `api` depends on `db` with
`condition: service_healthy`, runs migrations and the seed on start, and has its
own healthcheck hitting `/health`. `web` depends on `api`. Update `.env.example`
with the in-network `DATABASE_URL` and `VITE_API_URL`.

Commit: `build(docker): run migrations and seed on container start`

**Verification — do not skip.** Clone the repo into a fresh directory,
`cp .env.example .env`, `docker compose down -v`, `docker compose up --build`.
All three containers healthy, seed data present, login works in the browser.

---

## 14. Block K — Documentation and release (steps K1–K3)

Branch: `pre-release` (merge `master` into it first; no new features here).

**K1 — README**
Sections, in this order: summary and problem statement; features implemented;
screenshots; architecture diagram; ERD; tech stack with justification for every
non-mandated choice (including **why no ORM** — see below); project structure;
prerequisites; environment variables; local setup; Docker instructions; migrations
and seed; how to run frontend, backend and tests; demo credentials; API overview;
fare model with the Nusrat/Rafiq table; matching rule with the 5.0 ≤ 7.0 km
calculation; concurrency handling and what would change at scale; key decisions and
trade-offs; known limitations; next improvements; AI usage; demo video link.

The no-ORM justification: the riskiest part of this app is seat-capacity
concurrency, whose solution is one atomic conditional UPDATE that an ORM would
obscure; partial unique indexes and CHECK constraints are central to the design and
must be hand-written SQL regardless; the schema is seven tables, so an ORM's
leverage is small. Would switch to Prisma at 20+ tables or with a larger team.

Commit: `docs(readme): add setup, architecture and decision records`

**K2 — Scaling and AI usage**
The "If Oi Tesla Goes Viral" section: stateless API behind a load balancer;
read replicas for history; geohash or PostGIS for proximity search instead of fixed
zones; Redis for the zone and distance cache; per-vehicle seat counters with a Lua
CAS and geohash-partitioned matching to remove DB contention; SSE instead of
polling; queues for receipts and notifications but **not** for matching; idempotency
and rate limiting on writes; structured logs, trace ids, and a seat-conflict-rate
metric. Reasoning matters more than box count.

The AI Usage section must name the tools used, what they were used for, one
suggestion accepted, and one rejected with the reason. Ask the human for these two
examples rather than inventing them.

Commit: `docs(readme): add scaling notes and ai usage section`

**K3 — Known limitations**
Not deployed publicly (documented Docker deployment instead, permitted by the
brief); no passenger history UI; cash only, no wallet; no registration UI (seeded
accounts); no driver history page; matching is zone-based, not geographic.

Commit: `docs(readme): record known limitations and next steps`

---

## 15. Final sequence — human runs this

```bash
git checkout pre-release
git merge --no-ff master
# K1–K3 commits happen here
git checkout -b release/v1.0.0
git tag -a v1.0.0 -m "Oi Tesla Pool MVP"

git push -u origin master
git push -u origin pre-release
git push -u origin release/v1.0.0
git push origin --tags
git push origin --all
```

Never squash or rebase. The history is part of the submission.

---

## 16. Demo video — 6 minutes maximum

- **0:00–1:00** The problem in the presenter's own words: two strangers going the
  same way, one vehicle, fair split, seat integrity.
- **1:00–3:00** Architecture diagram, ERD, the two-level lifecycle (Nusrat dropped
  off while Rafiq is still on board), one key decision (atomic capacity update,
  with the code on screen), one trade-off (polling instead of WebSocket).
- **3:00–6:00** Product tour: Nusrat books Banani → Mohakhali (৳50 solo); Rafiq
  books Banani → Gulshan 1; Jashim accepts both; **both fares drop to ৳40 and ৳48**;
  Nusrat sees "shared with 1 other" but not Rafiq's name or fare; arrive → start →
  drop off Nusrat → Rafiq still en route → drop off Rafiq → complete; finally the
  edge case: Shirin tries the last seat and gets a clear `POOL_FULL`.

---

## 17. If time runs short

Cut in this order, top first. Never cut Docker, the six test behaviours, the three
branches, the README, or the video.

1. Driver joinability annotations in the feed (accept, then let the API reject)
2. The status timeline widget (a plain status label is enough)
3. Passenger `GET /rides/mine` UI
4. The zone distance matrix beyond the six zones used in the demo