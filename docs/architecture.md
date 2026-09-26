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
    pools ||--o{ ride_requests : "groups"
    ride_requests ||--o{ ride_status_events : "logs"
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

**`quoted_fare_paisa` and `final_fare_paisa` are separate columns.**
`quoted_fare_paisa` is calculated at booking time and may change (e.g., a second passenger joins and the pool discount applies, or someone cancels and the discount is lost). `final_fare_paisa` is written exactly once, when the trip starts (`EN_ROUTE`), and never changes. Keeping them separate makes the audit trail unambiguous.

**Every money column carries a `_paisa` suffix.**
All currency is stored as integer paisa (1 taka = 100 paisa). The suffix is a compile-time and grep-time reminder that a value is paisa, not taka — preventing accidental decimal arithmetic or display of raw paisa to users. Conversion to taka happens in exactly one place: `formatTaka` in `money.ts`.
