import { db } from '../db/pool'

export interface ZoneRow {
  id: number
  name: string
  lat: number
  lng: number
}

export async function getAllZones(): Promise<ZoneRow[]> {
  const { rows } = await db.query<ZoneRow>(`SELECT id, name, lat, lng FROM zones ORDER BY name`)
  return rows
}

export async function getDistance(fromZoneId: number, toZoneId: number): Promise<number | null> {
  const { rows } = await db.query<{ distance_km: number }>(
    `SELECT distance_km FROM zone_distances WHERE from_zone_id = $1 AND to_zone_id = $2`,
    [fromZoneId, toZoneId],
  )
  return rows[0]?.distance_km ?? null
}
