import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Which page buttons to draw: the first, the last and the ones around the current page, with a
// gap marker where pages are skipped. 1 … 6 7 8 … 140
function around(page: number, pages: number): (number | 'gap')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const near = [page - 1, page, page + 1].filter((n) => n > 1 && n < pages)
  if (page <= 3) near.push(2, 3, 4)
  if (page >= pages - 2) near.push(pages - 3, pages - 2, pages - 1)
  const mid = [...new Set(near)].filter((n) => n > 1 && n < pages).sort((a, b) => a - b)
  return [1, ...(mid[0] > 2 ? ['gap' as const] : []), ...mid, ...(mid[mid.length - 1] < pages - 1 ? ['gap' as const] : []), pages]
}

// The one pager used under every long list: "21–40 of 2,792" on the left, page buttons on the
// right. Changing page brings the top of the list back into view.
export function Pagination({ page, pages, total, size, onPage, className }: { page: number; pages: number; total: number; size: number; onPage: (page: number) => void; className?: string }) {
  const root = useRef<HTMLElement>(null)
  if (total <= 0) return null
  const from = (page - 1) * size + 1
  const to = Math.min(page * size, total)
  const go = (n: number) => {
    if (n < 1 || n > pages || n === page) return
    onPage(n)
    requestAnimationFrame(() => root.current?.previousElementSibling?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <nav ref={root} aria-label="Pages" className={cn('flex flex-wrap items-center justify-between gap-3 text-sm', className)}>
      <p className="text-muted-foreground tabular-nums">
        {from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="gap-1 pl-2" disabled={page <= 1} onClick={() => go(page - 1)}>
            <ChevronLeft className="size-4" />
            Previous
          </Button>
          <div className="hidden items-center gap-1 sm:flex">
            {around(page, pages).map((n, i) =>
              n === 'gap' ? (
                <span key={`gap-${i}`} className="px-1 text-muted-foreground">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  aria-label={`Page ${n}`}
                  aria-current={n === page ? 'page' : undefined}
                  onClick={() => go(n)}
                  className={cn(
                    'h-8 min-w-8 rounded-full px-2 text-sm tabular-nums transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    n === page ? 'bg-brand font-medium text-white' : 'text-zinc-600 hover:bg-zinc-200/70',
                  )}
                >
                  {n.toLocaleString('en-IN')}
                </button>
              ),
            )}
          </div>
          <span className="px-1 text-muted-foreground tabular-nums sm:hidden">
            {page} / {pages}
          </span>
          <Button size="sm" variant="outline" className="gap-1 pr-2" disabled={page >= pages} onClick={() => go(page + 1)}>
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </nav>
  )
}
