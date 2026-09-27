const RIDERS = ['var(--color-rider-1)', 'var(--color-rider-2)', 'var(--color-rider-3)']

/** One colour per booking in a pool, so seats, map lines and names line up. */
export function riderColor(index: number): string {
  return RIDERS[((index % RIDERS.length) + RIDERS.length) % RIDERS.length]
}

const CAST: Record<string, string> = {
  'Jashim Uddin': 'var(--signal)',
  'Nusrat Jahan': 'var(--color-rider-1)',
  'Rafiq Hasan':  'var(--color-rider-2)',
  'Shirin Akter': 'var(--color-rider-3)',
}

export function personColor(name: string): string {
  if (CAST[name]) return CAST[name]
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return riderColor(h)
}
