/** ওই — "Oi", the Dhaka street hail — set in Galada, after hand-painted rickshaw signs. */
export function Logo({ size = 'md', sub }: { size?: 'sm' | 'md' | 'xl'; sub?: string }) {
  const bangla = { sm: 'text-[1.9rem]', md: 'text-[2.35rem]', xl: 'text-[5.5rem] sm:text-[7rem]' }[size]
  const latin  = { sm: 'text-[0.95rem]', md: 'text-[1.05rem]', xl: 'text-[1.6rem] sm:text-[2rem]' }[size]

  return (
    <div className="flex items-end gap-2.5 select-none" aria-label="Oi Tesla Pool">
      <span
        aria-hidden
        className={`font-bangla leading-[0.8] text-marigold ${bangla} translate-y-[0.08em]`}
      >
        ওই
      </span>
      <span className="flex flex-col leading-none">
        <span className={`font-display font-extrabold tracking-[-0.03em] text-ink ${latin}`}>
          Tesla Pool
        </span>
        {sub && <span className="eyebrow mt-1.5 !text-[0.6rem]">{sub}</span>}
      </span>
    </div>
  )
}
