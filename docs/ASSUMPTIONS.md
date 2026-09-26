# Oi Tesla Pool — Assumptions

These assumptions were made where the brief did not fully specify behaviour.
Each is implemented consistently throughout the codebase and seed data.

1. **Joining a pool is allowed only while it is `FORMING` or `ACCEPTED` — never after
   the driver has arrived or the trip has started.**
   `FORMING` is the assembling phase (driver accepted first passenger, window open for
   more). `ACCEPTED` is the closed-and-ready phase (driver explicitly closed the pool
   via `POST /pools/:id/close`, or created it with `waitForPool: false`). Once the
   pool moves to `DRIVER_ARRIVED` or beyond, the passenger count is fixed.

2. **Same pickup zone is mandatory; driver must also be in that zone.**
   The brief uses named areas without street addresses. Matching on zone is the
   simplest consistent rule. The driver sets their `current_zone_id` when going online;
   the request feed only shows rides in that zone; `canJoin` condition 3 enforces
   zone equality at the pool level. All three guards together ensure driver and all
   passengers are always in the same pickup zone.

3. **The detour cap is an absolute 3.0 km, not a percentage of the solo distance.**
   A percentage cap would be unreasonable on short trips — 20% of a 2 km trip is only
   400 m, which would reject almost every pooling attempt in a dense city.

4. **The pooling window is 10 minutes from pool creation.**
   A request that arrives more than 10 minutes after the pool opened is likely headed
   to a different destination by a different route; a hard window keeps matching
   deterministic without real-time traffic data.

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

11. **Direction alignment uses a 90° bearing-diff threshold on seeded coordinates.**
    Each zone carries a fixed approximate lat/lng (real Dhaka neighbourhood centroids).
    `canJoin` computes the compass bearing from the origin to every active destination
    and to the candidate destination using `Math.atan2`. If any pair of bearings
    differs by more than 90°, the request is rejected with reason `'opposite_direction'`.
    The 90° threshold is a reasonable "same half of the city" rule; no map API is used.
    This is an explicit guard in addition to the detour-cap check — the two together
    catch wrong-direction routes both geometrically and by actual driving distance.
