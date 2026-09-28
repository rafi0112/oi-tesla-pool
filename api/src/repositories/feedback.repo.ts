import { PoolClient } from 'pg'

/**
 * One row per completed ride, enforced by ride_feedback's own UNIQUE
 * (ride_request_id) — a second attempt hits that constraint rather than a
 * read-then-write race.
 */
export async function insertFeedback(
  tx: PoolClient,
  data: { rideRequestId: string; passengerId: string; rating: number; comment: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO ride_feedback (ride_request_id, passenger_id, rating, comment)
     VALUES ($1, $2, $3, $4)`,
    [data.rideRequestId, data.passengerId, data.rating, data.comment],
  )
}
