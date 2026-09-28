/**
 * A CNG auto-rickshaw in side profile — Dhaka's actual three-wheeler, the
 * real-world shape "Bullet" riffs on. Same minimal line-art language as
 * BulletMark and the rest of the app's icons, not a photo — kept as a quiet
 * decorative touch, never competing with the radar for attention.
 */
export function Rickshaw({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 120" className={className} fill="none" aria-hidden>
      {/* canopy */}
      <path
        d="M46 58c0-20 14-34 34-34h28c9 0 14 6 16 14l4 20"
        stroke="var(--marigold)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
      />
      {/* roof cross-struts */}
      <path d="M60 58V40M84 58V28M108 58V26" stroke="var(--marigold)" strokeOpacity=".5" strokeWidth="2.5" strokeLinecap="round" />
      {/* body */}
      <path
        d="M30 92h4c2-9 9-15 18-15s16 6 18 15h44c2-9 9-15 18-15s16 6 18 15h6a6 6 0 0 0 6-7l-3-16c-1-5-4-9-9-11l-9-4-6-22a10 10 0 0 0-9-6H52a10 10 0 0 0-8 4L27 55c-6 1-11 6-12 12l-3 15a6 6 0 0 0 6 7z"
        stroke="var(--ink)" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" fill="var(--surface)"
      />
      {/* windscreen */}
      <path d="M44 58l6-20a6 6 0 0 1 6-4h6v24" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
      {/* seat divider */}
      <path d="M96 58v34" stroke="var(--ink)" strokeOpacity=".35" strokeWidth="2.5" />
      {/* headlamp */}
      <circle cx="36" cy="68" r="4" fill="var(--signal)" />
      {/* wheels */}
      <circle cx="52" cy="92" r="15" stroke="var(--ink)" strokeWidth="4" fill="var(--paper)" />
      <circle cx="52" cy="92" r="4" fill="var(--ink)" />
      <circle cx="132" cy="92" r="15" stroke="var(--ink)" strokeWidth="4" fill="var(--paper)" />
      <circle cx="132" cy="92" r="4" fill="var(--ink)" />
    </svg>
  )
}
