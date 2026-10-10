// "Live" marker for screens that refresh themselves, with the time of the last update.
export function LiveBadge({ at }: { at: Date | null }) {
  const time = at?.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.7rem] text-ink-3" aria-live="polite">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-good/60" />
        <span className="relative inline-flex size-2 rounded-full bg-good" />
      </span>
      Live{time && ` · updated ${time}`}
    </span>
  )
}
