import type { Gender } from '../api/types'

const LABEL: Record<Gender, string> = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' }
const LETTER: Record<Gender, string> = { MALE: 'M', FEMALE: 'F', OTHER: 'O' }

/** A compact, neutral badge — used wherever a passenger can see who's already aboard. */
export function GenderTag({ gender, className = '' }: { gender: Gender; className?: string }) {
  return (
    <span
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-line-2 bg-surface-2 px-1 font-mono text-[0.65rem] font-bold text-ink-2 ${className}`}
      title={LABEL[gender]}
    >
      {LETTER[gender]}
    </span>
  )
}
