// Woven grid: warp and weft crossing.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className}>
      <path d="M4 8h16M4 16h16M8 4v16M16 4v16" />
    </svg>
  )
}
