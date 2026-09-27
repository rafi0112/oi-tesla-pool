export interface LatLng {
  lat: number
  lng: number
}

const RAD = Math.PI / 180

/** Compass bearing in degrees, 0 = north, clockwise. Same formula as the API's matching rule. */
export function bearingDeg(from: LatLng, to: LatLng): number {
  const dLng = (to.lng - from.lng) * RAD
  const lat1 = from.lat * RAD
  const lat2 = to.lat * RAD
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) / RAD + 360) % 360
}

export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLng = (b.lng - a.lng) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** SVG point for a bearing/radius around a centre; north is up. */
export function polar(bearing: number, radius: number, cx: number, cy: number) {
  return {
    x: cx + radius * Math.sin(bearing * RAD),
    y: cy - radius * Math.cos(bearing * RAD),
  }
}

export const MAX_BEARING_DIFF = 90

/**
 * The arc of headings a new destination may point in and still pool with every
 * existing one — the intersection of each member's ±90° half-circle. Null means
 * there is no one aboard yet, so every direction is open.
 */
export function acceptableArc(bearings: number[]): { start: number; sweep: number } | null {
  if (bearings.length === 0) return null

  const ok = (deg: number) => bearings.every(b => angleDiff(deg, b) <= MAX_BEARING_DIFF)

  const accepted: boolean[] = Array.from({ length: 360 }, (_, d) => ok(d))
  const firstBlocked = accepted.indexOf(false)
  if (firstBlocked === -1) return { start: 0, sweep: 360 }

  // Walk clockwise from a blocked degree to find where the open arc begins and ends.
  let start = -1
  let sweep = 0
  for (let i = 1; i <= 360; i++) {
    const deg = (firstBlocked + i) % 360
    if (accepted[deg]) {
      if (start === -1) start = deg
      sweep++
    } else if (start !== -1) {
      break
    }
  }
  return start === -1 ? null : { start, sweep }
}

/** SVG path for a pie wedge from `start` sweeping clockwise. */
export function wedgePath(start: number, sweep: number, r: number, cx: number, cy: number): string {
  if (sweep >= 360) {
    return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`
  }
  const a = polar(start, r, cx, cy)
  const b = polar(start + sweep, r, cx, cy)
  const large = sweep > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y} Z`
}

export function compassPoint(bearing: number): string {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return points[Math.round(bearing / 45) % 8]
}
