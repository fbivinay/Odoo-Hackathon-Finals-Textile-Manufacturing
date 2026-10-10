// The letter E, its three bars cut by a mountain slope: stacked weft threads rising to a yellow summit.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="currentColor" className={className} aria-hidden="true">
      <path d="M10 9.5h9l5.2 7H10z" fill="#facc15" />
      <path d="M10 20.5h17.2l5.2 7H10zM10 31.5h25.4l5.2 7H10z" />
    </svg>
  )
}

// Ask Everest, the assistant: the brand's E-mountain bars speaking from a chat bubble.
export function AskEverestLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="currentColor" className={className} aria-hidden="true">
      <path
        d="M9 6h30a5 5 0 0 1 5 5v21a5 5 0 0 1-5 5H22l-9 7v-7H9a5 5 0 0 1-5-5V11a5 5 0 0 1 5-5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path d="M13 12.5h6.2l3.4 4.6H13z" fill="#facc15" />
      <path d="M13 19.7h11.6l3.4 4.6H13zM13 26.9h17l3.4 4.6H13z" />
    </svg>
  )
}
