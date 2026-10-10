import type { ReactNode } from 'react'

// Eyebrow, display headline and a one-sentence lede; `actions` sit on the right.
export function PageHead({ eyebrow, title, lede, actions }: { eyebrow: string; title: string; lede?: string; actions?: ReactNode }) {
  return (
    <header className="page-head flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display mt-1.5">{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {actions}
    </header>
  )
}
