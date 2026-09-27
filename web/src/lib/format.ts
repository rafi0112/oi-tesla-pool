import type { PoolStatus, RideStatus } from '../api/types'

export function formatTaka(paisa: number): string {
  return `৳${(paisa / 100).toFixed(2)}`
}

/** Whole taka when there are no paisa — "৳40" reads better than "৳40.00" in headings. */
export function formatTakaShort(paisa: number): string {
  return paisa % 100 === 0 ? `৳${paisa / 100}` : formatTaka(paisa)
}

export const RIDE_STATUS_LABEL: Record<RideStatus, string> = {
  REQUESTED:   'Finding Bullet',
  MATCHED:     'Bullet is coming',
  PICKED_UP:   'On board',
  DROPPED_OFF: 'Arrived',
  CANCELLED:   'Cancelled',
}

export const POOL_STATUS_LABEL: Record<PoolStatus, string> = {
  FORMING:        'Forming',
  ACCEPTED:       'Ready to go',
  DRIVER_ARRIVED: 'At pickup',
  EN_ROUTE:       'En route',
  COMPLETED:      'Completed',
  CANCELLED:      'Cancelled',
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return shortDate(iso)
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function firstName(fullName: string): string {
  return fullName.split(' ')[0]
}

export function initials(fullName: string): string {
  return fullName.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
