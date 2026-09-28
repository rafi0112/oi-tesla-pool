# Oi Tesla Pool — Assumptions

These assumptions were made where the brief did not fully specify behaviour.
Each is implemented consistently throughout the codebase and seed data.

1. **Joining a pool is allowed only while it is `FORMING` or `ACCEPTED` — never after
   the driver has arrived or the trip has started.**
   `FORMING` is the assembling phase (the accepted passenger's own `wait_minutes` was
   above 0, opening a window). `ACCEPTED` is the closed-and-ready phase (that passenger
   chose `wait_minutes: 0`, or the driver explicitly closed the pool via
   `POST /pools/:id/close`). Once the pool moves to `DRIVER_ARRIVED` or beyond, the
   passenger count is fixed. See assumption 13 for who decides the wait and how.

2. **Same pickup zone is mandatory; driver must also be in that zone.**
   The brief uses named areas without street addresses. Matching on zone is the
   simplest consistent rule. The driver sets their `current_zone_id` when going online
   (assumption 15 covers how a passenger's own `current_zone_id` is set, separately);
   the request feed only shows rides in that zone; `canJoin` condition 3 enforces
   zone equality at the pool level. All three guards together ensure driver and all
   passengers are always in the same pickup zone.

3. **The detour cap is an absolute 3.0 km, not a percentage of the solo distance.**
   A percentage cap would be unreasonable on short trips — 20% of a 2 km trip is only
   400 m, which would reject almost every pooling attempt in a dense city.

4. **The pooling window is chosen by the passenger, capped at 10 minutes, and only
   ever ratchets earlier as more people join.**
   Originally a fixed 10 minutes set by the driver. Reworked in assumption 13: each
   passenger states 0–10 minutes of their own patience at booking time, and the pool's
   live deadline is the earliest any current member asked for. 10 minutes remains the
   outer cap — a request arriving after everyone currently aboard has stopped waiting
   is likely headed to a different destination by a different route, so a hard ceiling
   keeps matching deterministic without real-time traffic data.

5. **Fare is quoted at booking time using the solo fare.**
   The passenger needs a price before a pool exists. The displayed fare is recomputed
   on every read before the trip starts (§3.3 of the BUILD_PLAN), so it updates live
   as pool membership changes.

6. **If a passenger cancels before pickup, the remaining members revert to the solo
   fare; after the trip starts fares are fixed.**
   A pool discount only makes sense with two or more people aboard. If cancellations
   reduce the pool to one, the discount disappears. Once the trip starts, fares are
   locked (`final_fare_paisa`) and cannot be retroactively changed.

7. **A passenger may have only one active ride at a time.**
   Enforced by a partial unique index on `ride_requests(passenger_id)` where status
   is `REQUESTED`, `MATCHED`, or `PICKED_UP`. Prevents accidental double-booking and
   simplifies the UI.

8. **A vehicle may have only one active pool at a time.**
   Enforced by a partial unique index on `pools(vehicle_id)` where status is not
   `COMPLETED` or `CANCELLED`. Bullet has three seats — carrying two simultaneous
   pools would make seat accounting ambiguous.

9. **Distances are seeded and symmetric (A→B = B→A); no map API is used.**
   The brief explicitly says not to fight map APIs. The seeded distance matrix covers
   all eight Dhaka zones used in the story and demo. Asymmetric distances could be
   added later by inserting separate rows.

10. **Payment is simulated — cash or wallet balance, no real gateway.**
    The brief states "Cash or simulated TeslaPay wallet — no real gateway needed."
    The MVP records a fare paisa amount; actual transfer of funds is out of scope.

11. **A booking may reserve 1–3 seats, and extra seats within that one booking cost
    nothing extra.**
    `ride_requests.seats` lets one passenger reserve several seats — the additional
    seats carry a friend or relative travelling with them, so that booking pays a
    single fare with no per-seat multiplier. `seats` is therefore a capacity concept
    only: it is what the atomic seat claim decrements and what `canJoin` condition 2
    tests, but it never enters the fare calculation.

    **The flat-seat rule is scoped to a single booking and never merges separate
    ones.** One fare is charged per `ride_requests` row. Two passengers who each book
    one seat are two rows and pay two fares — they do not share one fare just because
    they share the vehicle. The pool discount is what they get for sharing.

    | Bookings in the pool | Seats used | Fares charged |
    |---|---|---|
    | Nusrat books 2 | 2 of 3 | 1 fare, solo rate — she is the only booking |
    | Nusrat books 3 | 3 of 3 | 1 fare, solo rate — a private group, not a pool |
    | Nusrat 2 + Rafiq 1 | 3 of 3 | 2 fares, both at the pooled rate |
    | Nusrat 1 + Rafiq 1 | 2 of 3 | 2 fares, both at the pooled rate |

    The trade-off is accepted deliberately: a multi-seat booking earns the driver less
    than the same seats sold to separate passengers, in exchange for a fare that is
    honest about who is actually sharing the ride.

12. **Direction alignment uses a 90° bearing-diff threshold on seeded coordinates.**
    Each zone carries a fixed approximate lat/lng (real Dhaka neighbourhood centroids).
    `canJoin` computes the compass bearing from the origin to every active destination
    and to the candidate destination using `Math.atan2`. If any pair of bearings
    differs by more than 90°, the request is rejected with reason `'opposite_direction'`.
    The 90° threshold is a reasonable "same half of the city" rule; no map API is used.
    This is an explicit guard in addition to the detour-cap check — the two together
    catch wrong-direction routes both geometrically and by actual driving distance.

13. **Whether a pool waits, and for how long, is decided by the passengers who join
    it — never by the driver — and the deadline only ever moves earlier.**
    Every booking carries its own `wait_minutes` (0–10, offered as a short list of
    options, not a yes/no toggle): how long *that passenger* is willing to have the
    pool wait for more riders. The pool's `wait_until` is derived from this, never
    set directly: the first accepted request's `wait_minutes` opens it (`null`, i.e.
    closed to new joiners, if 0), and every later join ratchets it down —
    `wait_until = LEAST(wait_until, now + joiner.wait_minutes)` — if that joiner's own
    preference is above 0. A joiner who chose 0 has no opinion on the question and
    leaves the clock untouched; they don't get to slam the window shut on people who
    are already waiting. Concretely: Nusrat opens with 5 minutes; two minutes later
    Rafiq joins asking for 3, which computed from *his* join moment is later than
    Nusrat's original deadline, so nothing changes; a minute after that Shirin joins
    asking for 2, which *is* earlier, so the pool now closes 3 minutes after it
    opened — set by whoever aboard has the least patience at any given moment.
    `POST /pools/:id/close` clears `wait_until` to `null` outright in the same
    transaction as its status change, so closing early actually stops joins
    immediately rather than leaving the original deadline enforceable underneath.

    This was a deliberate reversal of the MVP's first design, where the driver
    supplied `waitForPool: true/false` when accepting the first request. That gave
    the driver a say over a passenger's own fare discount and patience — this is the
    passenger's trip and their money, not a schedule the driver sets for them.

    A passenger may self-join a pool this way without the driver's per-passenger
    approval: `GET /pools/nearby` surfaces joinable pools before booking, and
    `POST /rides { poolId }` runs the same atomic claim the driver's own accept
    action uses (§3.4), just with the passenger as the actor. `canJoin` is still the
    sole arbiter — a passenger can no more force their way into an incompatible pool
    this way than the driver could. The driver's explicit accept (E4) remains the
    only path when the passenger booked blind or picked wrong; nothing about it
    changed.

    **The listing is narrower than `canJoin` condition 1 allows.** `canJoin` treats
    `FORMING` and `ACCEPTED` alike (assumption 1), but `GET /pools/nearby` only
    ever lists `FORMING` pools. Every `ACCEPTED` pool has `wait_until = null` —
    either the accepted passenger chose `wait_minutes: 0` at creation, or the
    driver closed the pool (which now clears `wait_until` too) — so "still
    assembling" would be the wrong signal regardless; condition 5 would refuse
    them anyway. Self-service discovery is deliberately explicit about this
    rather than relying on condition 5 to filter it out silently.

    **A failed or lost-race join never fails the booking.** The ride request and
    the pool join are two different questions: if the join loses a race (seats
    just taken) or the pool disappears between listing and booking, the response
    reports `joinAttempt: { ok: false, reason, message }` and the ride is left
    `REQUESTED`, exactly as if no pool had been chosen. A passenger's booking
    should never be undone by someone else's timing.

14. **A pool closes itself the moment its wait time elapses — the next read or
    action against it does the closing, not a background job.**
    There is no scheduler in this project by design (no queue, no cron — see the
    non-negotiable rules), so `FORMING → ACCEPTED` on expiry can't run on a timer
    in the background. Instead, every function that fetches a pool by id
    (`GET /pools/active`, `GET /pools/nearby`, joining, closing, arriving, …)
    calls `autoCloseIfExpired` first: if the pool is still `FORMING` and its
    `wait_until` has passed, it transitions to `ACCEPTED` right there, with
    `actorUserId: null` (nobody clicked anything) and `reason: 'wait_time_elapsed'`
    in the audit trail, before the caller proceeds.

    This is a real correctness fix, not just tidiness: without it, a `POST
    /pools/:id/arrive` against an expired-but-still-`FORMING` row would fail
    `assertTransition('pool', 'FORMING', 'DRIVER_ARRIVED')` with
    `INVALID_TRANSITION`, even though the window had plainly closed — a driver
    who arrived after the wait time ran out, without ever separately loading the
    pool screen, would have hit that error for no reason a passenger or driver
    could see. Making every read self-heal the stale status closes that gap
    without adding a dependency this project explicitly rules out.

    In the driver console this is invisible in the pleasant way: the status
    badge and countdown just flip from "Forming" to "Ready to go" between one
    4-second poll and the next, with no button ever clicked.

15. **A passenger's `current_zone_id` means something different from a driver's, even
    though it's the same column.**
    Only a driver's `current_zone_id` gates anything (assumption 2, condition 3) — it
    is null exactly when they're offline, and the request feed treats it as "which
    zone am I serving right now". A passenger has no online/offline concept, so their
    `current_zone_id` is purely a remembered default: every `POST /rides` sets it to
    that booking's `pickupZoneId` in the same transaction, and `PATCH /passengers/me
    { zoneId }` lets them set it directly without booking. Nothing in the matching
    rule, the driver's feed, or any authorization check ever reads a passenger's
    `current_zone_id` — the sole consumer is the booking form defaulting its own
    "From" field to wherever that passenger last requested from, so returning
    passengers don't re-pick their own neighbourhood every time.

    Reusing one column for two unrelated meanings was a deliberate trade-off: adding
    a second column (`last_pickup_zone_id`, say) would have been more explicit, but
    `current_zone_id` already means "the zone this user is currently associated
    with" in the schema's own terms, and a passenger's last pickup is exactly that,
    just read by a different service layer for a different purpose. The two
    interpretations can't collide because a passenger's row is never read through
    `driver.service.ts` and a driver's is never read through `passenger.service.ts`.

16. **The driver now sees every fare — this reverses the MVP's original secrecy rule.**
    Earlier revisions deliberately withheld fare numbers from `DriverRequestDTO` and
    `DriverPoolDTO` on the theory that a driver shouldn't see what a passenger pays.
    That rule is gone: `GET /drivers/requests` now carries `grossFarePaisa` per open
    request — the passenger's own solo fare if the driver has no active pool yet
    (accepting opens a fresh one), or the whole pool's new total if the driver already
    has one (every current member plus the candidate, all re-priced at the bigger
    shared-ride discount) — so a driver knows what accepting is worth *before* they
    accept, not after. `GET /pools/active` similarly carries `grossFarePaisa` on the
    pool and `farePaisa` on each passenger. `GET /drivers/me` gains
    `totalEarningsPaisa`, the lifetime sum of `final_fare_paisa` across every ride
    this driver has taken all the way to `DROPPED_OFF` — a fare only ever counts once
    it's locked in at boarding, so a cancelled or still-forming ride never inflates it.
    The projection formula (`farePaisaFor` in `src/domain/fare.ts`) is the same
    solo/pooled pricing a passenger's own fare uses, just evaluated at a hypothetical
    member count before the driver commits — so the number a driver sees while
    deciding and the number the passenger is actually charged after accepting always
    agree.

17. **A passenger may see another passenger's gender, never their name — this
    holds everywhere two passengers' data could meet, not just before joining.**
    Every user now carries a `gender` (`MALE` / `FEMALE` / `OTHER`, required at
    registration, `NOT NULL` from migration `004_user_gender.sql`). `GET
    /pools/nearby` — the one endpoint assumption 13 documents as deliberately
    withholding co-passenger names — gains `memberGenders`, one entry per
    passenger already aboard (current status `MATCHED`/`PICKED_UP`), so someone
    deciding whether to join a pool can see who's already in it without that
    pool exposing anyone's identity. The same rule extends to a passenger's own
    matched ride and its history: `PassengerRideDTO` replaces the bare
    `sharedWith` count with `sharedGenders`, a `Gender[]` — one entry per
    co-passenger, deliberately never a name — covering everyone who rode along
    in that pool, including bookings already `DROPPED_OFF`, which `shared_with`
    itself deliberately excludes (assumption 16's fare math only counts still-
    active bookings; a completed ride's history is a different question, not
    a live price). This is why `ride.repo.ts` computes `shared_genders` as its
    own subquery rather than reusing `shared_with`'s: the two intentionally
    disagree once a passenger drops off. A past ride's card on `PastRides`
    shows exactly this list — its "record in history" is this same
    `sharedGenders` array, not a separately stored snapshot, so it stays
    correct if a ride's pool membership is ever re-read. (An earlier revision
    of this feature also surfaced each co-passenger's first name here; that was
    a mistake this assumption corrects — a driver still sees full names, via
    `DriverPassengerDTO`, because a driver is not a fellow passenger and needs
    to identify who to pick up.)

18. **A passenger may rate a ride only after being dropped off, and only once.**
    `ride_feedback` (migration `005_ride_feedback.sql`) holds one row per ride:
    `rating` (1–5, required) and an optional `comment`, behind a
    `UNIQUE(ride_request_id)` — a second attempt hits that constraint rather
    than a read-then-write race, mirroring how seat claims and pool joins are
    guarded elsewhere in this project. `POST /rides/:id/feedback` refuses with
    `NOT_DROPPED_OFF` at any earlier status (`REQUESTED`, `MATCHED`,
    `PICKED_UP`) and `FEEDBACK_ALREADY_GIVEN` on a repeat, and — like every
    other ride endpoint — is scoped to the calling passenger's own ride, so one
    passenger can never rate another's trip. `PassengerRideDTO` carries the
    result back as `feedback` (null until given) and a precomputed
    `canGiveFeedback` boolean (`status === 'DROPPED_OFF' && feedback === null`),
    so the frontend never has to re-derive that rule itself — the same pattern
    `canCancel` already uses.

19. **`GET /drivers/history` mirrors `GET /rides/mine` on the driver side: every
    finished trip belonging to the calling driver, and nothing belonging to any
    other driver.**
    A passenger's ride history has existed since the MVP (`findRidesByPassenger`
    scoped by `passenger_id`); the driver console had no equivalent — only
    `GET /pools/active`, which shows the one pool currently in progress and
    nothing once it's `COMPLETED` or `CANCELLED`. `findPoolHistoryByDriver`
    closes that gap the same way: `WHERE v.driver_id = $1`, with `$1` always
    the calling driver's own id from their JWT, never a request parameter — so
    with any number of drivers on the platform, each one only ever sees pools
    their own vehicle carried. Reuses `toDriverPoolDTO`, the same DTO
    `GET /pools/active` already returns, so a finished trip's shape in history
    is identical to the shape it had while active — passenger names, per-seat
    fares and all, since a driver (unlike a fellow passenger — see assumption
    17) has always been shown who they drove.

20. **A REQUESTED ride nobody has matched within 15 minutes expires on its own,
    the same self-healing way a pool's own wait window does.**
    `POOL_POLICY.requestExpiryMinutes = 15` (`domain/matching.ts`). There is no
    scheduler in this project (see the non-negotiable rules), so this can't run
    on a timer — `ride.service.ts`'s `expireIfStale` runs the check inline,
    exactly mirroring `pool.service.ts`'s `autoCloseIfExpired` (assumption 14):
    the next read or action against the ride does the transitioning, under a
    row lock so a concurrent driver accept racing the expiry can't double-fire.
    It's wired into every place a REQUESTED ride is read — a single ride
    (`GET /rides/:id`), the passenger's own list (`GET /rides/mine`), and the
    driver's request feed (`GET /drivers/requests`, scoped to the zone being
    queried) — plus `requestRide` itself, which self-heals the passenger's own
    stale request *before* attempting a new booking, so "request again after
    15 minutes" works immediately without the passenger first having to open
    their ride list to free up `one_active_ride_per_passenger`. The expiry is
    recorded as an ordinary `CANCELLED` transition with `reason:
    'request_expired'`, surfaced to the frontend as `cancelReason` so it can
    say "expired" rather than "cancelled".

21. **A passenger may offer a bonus on top of their fare to attract a driver
    faster — capped, transparent, and folded into every fare figure everyone
    already sees, never a separate number to reconcile.**
    `ride_requests.bonus_paisa` (migration `006_request_expiry_and_bonus.sql`),
    capped at `FARE_POLICY.maxBonusPaisa` (a flat sanity bound, not a
    percentage — the same reasoning assumption 3 gives for the detour cap).
    `quoted_fare_paisa` is set to `soloFare(distanceKm) + bonusPaisa` at
    booking time, so the passenger's own upfront quote already reflects it
    honestly; the live-recompute path (`effectiveFarePaisa` in
    `passenger.dto.ts`) and the driver-facing projection (`farePaisaFor` in
    `domain/fare.ts`, now taking `bonusPaisa` as a parameter) both add it back
    on top of the solo/pooled formula, so a boosted request's fare agrees
    everywhere — the passenger's own view, every driver's request-feed
    preview, and the amount locked into `final_fare_paisa` at boarding.
    `GET /drivers/requests` orders by `bonus_paisa DESC` before `created_at
    DESC`, so a boosted request actually surfaces first in every driver's feed
    in that zone — the literal mechanism by which it "attracts a driver
    faster", not just a number shown alongside an unchanged list. The bonus
    stays available on any booking, not gated behind a prior expiry, but the
    booking form nudges it by default right after the passenger's last request
    timed out.

22. **Registration creates a driver's vehicle in the same transaction as the
    account — there is no separate "add a vehicle" step, before or after.**
    `POST /auth/register` now takes an optional `vehicleName` /
    `seatCapacity`, required if and only if `role: 'DRIVER'`
    (`ValidationError` otherwise, same as any other missing field). Both are
    written by `createVehicle` inside the same `withTransaction` as
    `createUser`, so a driver can never exist without a vehicle, and a vehicle
    can never exist without its driver — `vehicles.driver_id` stays `UNIQUE`
    and this is its only writer outside `seed.ts`. A passenger registering
    supplies neither field. The frontend (`Register.tsx`) mirrors this: the
    two vehicle inputs only render, and only become required, once "Driver"
    is chosen.

23. **The API can point at any Postgres, local or managed, through
    `DATABASE_URL` alone — nothing else in the code is host-specific.**
    The project already used raw `pg` with no ORM, so a managed host (Supabase
    among them) needs only its own TLS: `db/pool.ts` now enables
    `ssl: { rejectUnauthorized: false }` automatically whenever the connection
    host isn't `localhost`/`127.0.0.1`/`::1`, and leaves local Postgres (the
    docker-compose service) untouched. `rejectUnauthorized: false` is a
    deliberate simplification for a project without a bundled CA list, not a
    security posture — accepted here because the same connection string
    already carries the database password as its own credential. Nothing else
    changes: the same migrations, the same `pg` client, the same custom
    argon2 + JWT auth against the same `users` table, whether that table lives
    in the docker-compose container or a Supabase project.

24. **Any current member of a pool — not just whoever's own `wait_minutes`
    opened it — may halve however much time is actually left on the window,
    and every other member and the driver see the shorter timer immediately.**
    `POST /pools/:id/urgent` is the "I'm in a hurry" button. It's deliberately
    not scoped to the passenger whose join first opened the FORMING window
    (assumption 13) — anyone currently `MATCHED` in that pool can press it,
    since urgency is personal, not seniority. `halveWaitUntil` (`pool.repo.ts`)
    computes `now() + (wait_until - now()) / 2` — half of what's *left*, not
    half of the original window — and only takes effect while the pool is
    still `FORMING` with time actually remaining; pressing it on a closed or
    already-expired window does nothing (`409 NOT_WAITING`), same as trying to
    join one. This needed no new "make everyone see it" mechanism: `wait_until`
    was already the one pool-level field every member's own ride view and the
    driver's console both read live (assumption 13's `ratchetWaitUntil` already
    established this pattern for a joiner's own patience) — halving it here
    updates that same row, so the next poll from any of them just shows a
    smaller number. `canJoin`'s window check, `autoCloseIfExpired`, and the
    nearby-pools countdown all read the same `wait_until` the same way
    regardless of who shortened it, which is what "the rest of the
    functionality will work accordingly" means concretely: nothing downstream
    had to be taught about urgency at all.

    A passenger's own ride view gains `poolWaitUntil` (`PassengerRideDTO`) —
    the same value `DriverPoolDTO.waitUntil` already exposed, now visible to
    the passenger side too, rendered by the same `WindowTimer` component both
    consoles share. Gender-only visibility before joining a pool (assumption
    17, `PoolOptionDTO.memberGenders`) was already in place and needed no
    change for this feature.
