# Oi Tesla Pool — Project Conventions

## Authoritative specification

`BUILD_PLAN.md` at repo root is the single source of truth for this project.
Section 1 of that file (Working Rules) applies to every step without exception.

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js · Express · TypeScript · `pg` (raw SQL, **no ORM**) |
| Frontend | React · Vite · React Router · Tailwind CSS |
| Database | PostgreSQL 16 |
| Auth | `argon2` for password hashing · `jsonwebtoken` for JWT (24 h, HS256) |
| Validation | `zod` on every request body |
| Tests | Vitest · Supertest |
| Container | Docker Compose |

## Non-negotiable rules

1. **Integer paisa only.** All money is `INT` paisa in the database and in memory.
   No `NUMERIC`, no `float`, no `Decimal` type. Conversion to taka happens only in
   `src/domain/money.ts → formatTaka()` for display.

2. **Atomic seat update.** Seat decrement is one conditional `UPDATE … WHERE
   seats_available >= $2`. Never read seats then write them separately.

3. **State machine.** Every status change goes through `assertTransition()` in
   `src/domain/stateMachine.ts`. No ad-hoc `if (status === 'X')` checks.

4. **No business logic in controllers.** Controllers parse, delegate, serialise.
   Business rules live in services; SQL lives in repositories.

5. **DTOs always.** Never return a raw database row to the client.
   Use `toPassengerRideDTO` or `toDriverPoolDTO` from `src/dto/`.

6. **Story cast in seed and tests.** Seed users are Jashim Uddin (DRIVER),
   Nusrat Jahan, Rafiq Hasan, Shirin Akter (all PASSENGER). Tests reference them
   by name. No `user1` / `driver1` placeholders anywhere.

7. **No extra dependencies.** Do not add Redis, message queues, WebSockets,
   ORMs, or state-management libraries. Every addition requires a BUILD_PLAN step.

## Git — Claude never runs these

Claude must not run `git commit`, `git add`, `git merge`, `git checkout`,
`git push`, or any destructive git command. After completing a step, print the
suggested commit message and stop. The human stages and commits manually.

Read-only git commands (`git status`, `git log`, `git branch`, `git diff`) are fine.

## Architecture

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
