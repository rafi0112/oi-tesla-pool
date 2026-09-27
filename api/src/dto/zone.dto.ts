import { ZoneRow } from '../repositories/zone.repo'

export interface ZoneDTO {
  id: number
  name: string
  lat: number
  lng: number
}

// Coordinates are public neighbourhood centroids. The driver console plots each
// destination at its true bearing from the pickup, so the client needs them.
export function toZoneDTO(z: ZoneRow): ZoneDTO {
  return { id: z.id, name: z.name, lat: z.lat, lng: z.lng }
}
