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
   simplest consistent rule. The driver sets their `current_zone_id` when going online;
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
