// The letter E, its three bars cut by a mountain slope: stacked weft threads rising to a yellow summit.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="currentColor" className={className} aria-hidden="true">
      <path d="M10 9.5h9l5.2 7H10z" fill="#facc15" />
      <path d="M10 20.5h17.2l5.2 7H10zM10 31.5h25.4l5.2 7H10z" />
    </svg>
  )
}
