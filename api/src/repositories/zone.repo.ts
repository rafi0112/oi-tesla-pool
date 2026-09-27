import { db } from '../db/pool'
import { Zone, DistanceMatrix, distanceKey } from '../domain/matching'

export type ZoneRow = Zone

// pg returns NUMERIC as a string — every lat/lng/distance must be coerced here,
// or numeric comparisons downstream silently become string comparisons.
interface RawZone { id: number; name: string; lat: string; lng: string }

export async function getAllZones(): Promise<ZoneRow[]> {
  const { rows } = await db.query<RawZone>(
    `SELECT id, name, lat, lng FROM zones ORDER BY name`,
  )
  return rows.map(r => ({ id: r.id, name: r.name, lat: Number(r.lat), lng: Number(r.lng) }))
}

export async function findZoneById(id: number): Promise<ZoneRow | null> {
  const { rows } = await db.query<RawZone>(
    `SELECT id, name, lat, lng FROM zones WHERE id = $1`,
    [id],
  )
  const r = rows[0]
  return r ? { id: r.id, name: r.name, lat: Number(r.lat), lng: Number(r.lng) } : null
}

export async function getZoneMap(): Promise<Map<number, Zone>> {
  const zones = await getAllZones()
  return new Map(zones.map(z => [z.id, z]))
}

export async function getDistance(
  fromZoneId: number,
  toZoneId: number,
): Promise<number | null> {
  const { rows } = await db.query<{ distance_km: string }>(
    `SELECT distance_km FROM zone_distances WHERE from_zone_id = $1 AND to_zone_id = $2`,
    [fromZoneId, toZoneId],
  )
  const raw = rows[0]?.distance_km
  return raw === undefined ? null : Number(raw)
}

export async function getDistanceMatrix(): Promise<DistanceMatrix> {
  const { rows } = await db.query<{
    from_zone_id: number
    to_zone_id: number
    distance_km: string
  }>(`SELECT from_zone_id, to_zone_id, distance_km FROM zone_distances`)

  const matrix: DistanceMatrix = new Map()
  for (const r of rows) {
    matrix.set(distanceKey(r.from_zone_id, r.to_zone_id), Number(r.distance_km))
  }
  return matrix
}
