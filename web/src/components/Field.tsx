import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

// Native <select> styled like the shadcn Input — no extra popover logic needed for short lists.
// The browser's own arrow hugs the edge, so `.select-chevron` (index.css) draws one with the same inset as the text.
export const selectClass =
  'select-chevron h-8 w-full appearance-none truncate rounded-lg border border-input bg-transparent pr-8 pl-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}
