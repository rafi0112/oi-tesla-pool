import { ZoneRow } from '../repositories/zone.repo'

export interface ZoneDTO {
  id: number
  name: string
}

// lat/lng are inputs to the matching rule, not something a client needs.
export function toZoneDTO(z: ZoneRow): ZoneDTO {
  return { id: z.id, name: z.name }
}
