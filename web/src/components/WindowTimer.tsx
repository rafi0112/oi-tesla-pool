/**
 * The pool's live wait countdown — shared by the driver console and the
 * passenger's own ride ticket, since both read the exact same wait_until off
 * the one pool row every member and the driver share. Whoever presses
 * "urgent" shortens what every one of them sees here.
 */
export function WindowTimer({ waitUntil, now, className = '' }: { waitUntil: string; now: number; className?: string }) {
  const left = Math.max(0, new Date(waitUntil).getTime() - now)
  const mins = Math.floor(left / 60_000)
  const secs = Math.floor((left % 60_000) / 1000)
  const expired = left === 0

  return (
    <span
      className={`font-mono text-sm font-bold ${expired ? 'text-ink-3' : 'text-marigold'} ${className}`}
      title="Set by whichever current passenger chose the shortest wait"
    >
      {expired ? 'window closed' : `${mins}:${String(secs).padStart(2, '0')} to join`}
    </span>
  )
}
