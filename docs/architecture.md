# Oi Tesla Pool — Architecture

## (a) System Flowchart

```mermaid
flowchart TD
    Browser["Browser\n(React + Vite + Tailwind)"]

    Browser -->|"REST + JWT · 4-second polling"| API

    subgraph API["Express API (TypeScript)"]
        Routes["Routes"]
        Zod["Zod Validation"]
        Controllers["Controllers"]
        Services["Services\n(business logic)"]
        Repositories["Repositories\n(DB access)"]

        Routes --> Zod --> Controllers --> Services --> Repositories
    end

    subgraph Domain["Pure Domain Logic"]
        Fare["Fare Engine\n(fare.ts)"]
        Match["Matching Rule\n(matching.ts)"]
        SM["State Machine\n(stateMachine.ts)"]
        Money["Money\n(money.ts)"]
    end

    Services -.->|"pure fn calls"| Fare
    Services -.->|"pure fn calls"| Match
    Services -.->|"pure fn calls"| SM
    Fare -.-> Money

    Repositories -->|"pg · raw SQL"| DB[(PostgreSQL)]
```

## (b) Layer Responsibilities

| Layer | Responsibility |
|---|---|
| **Routes** | Mount path + HTTP verb; attach middleware chain; delegate to controller |
| **Zod Validation** | Parse and type-check incoming request bodies and params; reject early with `422` |
| **Controllers** | Parse validated request, call one service method, serialise result through a DTO, return HTTP response — **no business rules** |
| **Services** | Own all business logic and database transactions; call repositories and domain functions |
| **Repositories** | Execute SQL only; accept and return plain objects; no business logic |
| **Domain (pure)** | Stateless functions with zero I/O — fare arithmetic, pool matching, state-machine transitions, money formatting — unit-testable without a database |

> **Governing rule:** No business logic in controllers. A controller that does arithmetic or enforces a rule is a bug.

## (c) Entity-Relationship Diagram

> **8 tables.** Every passenger who joins a pool gets their own row in `ride_requests`
> (linked via `pool_id`). Pool-level transitions are logged in `pool_status_events`;
> individual ride transitions are logged in `ride_status_events`. These are two
> separate tables — never a junction — because the two transition types track
> different lifecycles at different granularities.

```mermaid
erDiagram
    users {
        UUID id PK
        TEXT name
        TEXT email
        TEXT password_hash
        TEXT role
        BOOLEAN is_online
        TIMESTAMPTZ created_at
    }
    vehicles {
        UUID id PK
        UUID driver_id FK
        TEXT name
        INT seat_capacity
    }
    zones {
        SERIAL id PK
        TEXT name
    }
    zone_distances {
        INT from_zone_id FK
        INT to_zone_id FK
        NUMERIC distance_km
    }
    pools {
        UUID id PK
        UUID vehicle_id FK
        INT origin_zone_id FK
        INT seats_available
        TEXT status
        BOOLEAN wait_for_pool
        TIMESTAMPTZ created_at
    }
    ride_requests {
        UUID id PK
        UUID passenger_id FK
        UUID pool_id FK
        INT pickup_zone_id FK
        INT destination_zone_id FK
        INT seats
        INT quoted_fare_paisa
        INT final_fare_paisa
        TEXT status
        TEXT idempotency_key
        TIMESTAMPTZ created_at
    }
    pool_status_events {
        UUID id PK
        UUID pool_id FK
        TEXT from_status
        TEXT to_status
        UUID actor_user_id FK
        TEXT reason
        TIMESTAMPTZ created_at
    }
    ride_status_events {
        UUID id PK
        UUID ride_request_id FK
        TEXT from_status
        TEXT to_status
        UUID actor_user_id FK
        TEXT reason
        TIMESTAMPTZ created_at
    }

    users ||--o| vehicles : "owns (driver_id UNIQUE)"
    users ||--o{ ride_requests : "books"
    vehicles ||--o{ pools : "carries"
    pools ||--o{ ride_requests : "groups (one row per passenger)"
    pools ||--o{ pool_status_events : "logs pool transitions"
    ride_requests ||--o{ ride_status_events : "logs ride transitions"
    zones ||--o{ ride_requests : "origin of (pickup_zone_id)"
    zones ||--o{ ride_requests : "destination of (destination_zone_id)"
    zones ||--o{ zone_distances : "from"
    zones ||--o{ zone_distances : "to"
```

## Design Decisions

**`seats_available` is its own column (not computed from ride_requests).**
The concurrency-safe seat claim is a single atomic conditional `UPDATE pools SET seats_available = seats_available - $2 WHERE id = $1 AND seats_available >= $2`. A computed value would require a read-then-write, which is a TOCTOU race under concurrent requests.

**`pool_id` on `ride_requests` is nullable.**
A ride request exists before any pool exists — the passenger books first, the driver accepts later. The column is set at the moment the driver accepts.

**One `ride_requests` row per passenger, not per pool.**
Each passenger books independently and has their own status, fare, pickup, and destination. The `pool_id` FK is what groups them. This keeps each passenger's state machine isolated — one passenger cancelling does not directly mutate another passenger's row.

**Two separate event tables, not one.**
`pool_status_events` records pool-level transitions (`FORMING → ACCEPTED → EN_ROUTE → COMPLETED`). `ride_status_events` records individual ride transitions (`REQUESTED → MATCHED → PICKED_UP → DROPPED_OFF`). When a pool goes `EN_ROUTE` and all passengers go `PICKED_UP`, that is one row in `pool_status_events` and one row per passenger in `ride_status_events`, all written in the same transaction. Keeping them separate avoids nullable FK columns, avoids junction tables, and keeps each audit query simple.

**`wait_for_pool` on `pools`.**
When the first passenger's ride is accepted, the driver asks them whether they are willing to wait for a second passenger. `wait_for_pool = false` closes the pool to new joiners immediately — the driver can depart right away. `wait_for_pool = true` opens a 10-minute window during which a second passenger may join. The flag makes the first passenger's preference an explicit datum in the database rather than implicit timing logic.

**Pool auto-cancellation rule.**
A passenger may cancel their own ride at any time before boarding (`PICKED_UP`). However:
- If the first passenger cancels **before** a second joins, the pool has no remaining members and auto-cancels. One `pool_status_events` row is written with `reason: 'sole_passenger_cancelled'`.
- After a second passenger joins, the first passenger can only cancel their own ride — not the pool. The pool continues with the remaining member(s).
- If every passenger eventually cancels, the pool auto-cancels. One `pool_status_events` row is written with `reason: 'all_passengers_cancelled'`.
- This logic lives entirely in the service layer; the state machine only enforces valid transitions.

**`quoted_fare_paisa` and `final_fare_paisa` are separate columns.**
`quoted_fare_paisa` is calculated at booking time and may change (e.g., a second passenger joins and the pool discount applies, or someone cancels and the discount is lost). `final_fare_paisa` is written exactly once, when the trip starts (`EN_ROUTE`), and never changes. Keeping them separate makes the audit trail unambiguous.

**Every money column carries a `_paisa` suffix.**
All currency is stored as integer paisa (1 taka = 100 paisa). The suffix is a compile-time and grep-time reminder that a value is paisa, not taka — preventing accidental decimal arithmetic or display of raw paisa to users. Conversion to taka happens in exactly one place: `formatTaka` in `money.ts`.
