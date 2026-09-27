import { ZONES, DISTANCES } from '../../src/db/seedData'
import { Zone, DistanceMatrix, distanceKey } from '../../src/domain/matching'

// Mirrors the SERIAL ids the seed assigns: first zone in the array is id 1.
export const zoneIdByName = new Map<string, number>(
  ZONES.map((z, i) => [z.name, i + 1]),
)

export function zoneId(name: string): number {
  const id = zoneIdByName.get(name)
  if (id === undefined) throw new Error(`Unknown seed zone: ${name}`)
  return id
}

export const zones: Map<number, Zone> = new Map(
  ZONES.map((z, i) => [i + 1, { id: i + 1, name: z.name, lat: z.lat, lng: z.lng }]),
)

export const distances: DistanceMatrix = (() => {
  const m: DistanceMatrix = new Map()
  for (const [from, to, km] of DISTANCES) {
    m.set(distanceKey(zoneId(from), zoneId(to)), km)
    m.set(distanceKey(zoneId(to), zoneId(from)), km)
  }
  return m
})()
