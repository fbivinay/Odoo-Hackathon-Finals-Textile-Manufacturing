import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, FlaskConical } from 'lucide-react'
import { selectClass } from '@/components/Field'
import { Figure } from '@/components/Figure'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatDateTime } from '@/lib/format'
import { emptyDraft, show, type Intelligence as Data, type Recommendation, type SummaryMetric } from '@/lib/lab'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { Shared } from '@/pages/Lab'
import { Confidence, Section, Tag } from './parts'

const PERIODS = [30, 90, 180, 365]
const ago = (days: number) => new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10)

export function Intelligence({ setDraft, go }: Shared) {
  const [days, setDays] = useState(90)
  const { data, loading, error, reload } = useApi<Data>(`/lab/intelligence?from=${ago(days)}`)
  const navigate = useNavigate()

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {data ? (
            <>
              Period {formatDate(data.period.from)} to {formatDate(data.period.to)} · plan looks {data.freshness.planHorizonDays} days ahead · data read {formatDateTime(data.freshness.snapshotAt)}
              {data.freshness.lastProductionLog && ` · last production entry ${formatDateTime(data.freshness.lastProductionLog)}`}
            </>
          ) : (
            'Reading the mill’s records…'
          )}
        </p>
        <select aria-label="Period" className={cn(selectClass, 'w-44 bg-surface')} value={days} onChange={(e) => setDays(+e.target.value)}>
          {PERIODS.map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="data-table-wrap flex items-center justify-between gap-3 p-4 text-sm">
          <span className="text-problem">{error}</span>
          <Button size="sm" variant="outline" onClick={reload}>
            Try again
          </Button>
        </div>
      )}

      <section className="figures-panel">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="section-head">The mill right now</h2>
          <Tag kind="actual" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(data?.summary ?? Array.from({ length: 4 }, (_, i): SummaryMetric => ({ key: String(i), label: '', value: null }))).map((m) => (
            <Figure
              key={m.key}
              label={m.label || ' '}
              value={m.value === null ? 'Not available' : show(m.value, m.unit === '₹' ? 'INR' : (m.unit ?? ''))}
              note={m.note}
              tone={m.tone}
              loading={loading && !data}
              onClick={m.link ? () => navigate(m.link!) : undefined}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-head flex items-center gap-2">
            Top recommendations <Tag kind="rules" />
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setDraft(emptyDraft())
              go('builder')
            }}
          >
            <FlaskConical className="size-4" />
            Build your own scenario
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The four the records back most strongly. Each comes from a fixed rule with its evidence; gains with figures were simulated on today’s plan. Nothing has been changed.
        </p>
        {loading && !data ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-56 w-full" />
            ))}
          </div>
        ) : data && data.recommendations.length === 0 ? (
          <Section title="Nothing stands out">
            <p className="text-sm text-muted-foreground">No rule found a problem or opportunity in this period. Try a longer period, or build a scenario.</p>
          </Section>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {data?.recommendations.map((r) => (
              <Card
                key={r.id}
                r={r}
                onSimulate={() => {
                  setDraft({ ...emptyDraft(), name: r.scenario!.name, changes: r.scenario!.changes })
                  go('builder')
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Card({ r, onSimulate }: { r: Recommendation; onSimulate: () => void }) {
  const [open, setOpen] = useState(false)
  const rows: [string, string][] = [
    ['Recommended action', r.action],
    ['Why this', r.why],
    ['Expected benefit', r.benefit],
    ['Cost', r.cost],
    ['Risks and trade-offs', r.risks],
  ]
  return (
    <article className="data-table-wrap flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold leading-snug">{r.title}</h3>
        <Confidence level={r.confidence} pct={r.confidencePct} />
      </div>
      <p className="text-sm text-muted-foreground">{r.problem}</p>
      <dl className="space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs font-medium text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {open && (
        <div className="space-y-2 rounded-lg border border-border bg-zinc-50/60 p-3 text-sm">
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Evidence <Tag kind="actual" />
          </p>
          <ul className="space-y-1">
            {r.evidence.map((e) => (
              <li key={e.label + e.value} className="flex justify-between gap-3">
                {e.link ? (
                  <Link to={e.link} className="text-brand hover:underline">
                    {e.label}
                  </Link>
                ) : (
                  <span>{e.label}</span>
                )}
                <span className="text-right tabular-nums">{e.value}</span>
              </li>
            ))}
          </ul>
          {r.assumptions.length > 0 && <p className="text-xs text-muted-foreground">Assumptions: {r.assumptions.join(' ')}</p>}
          {r.limitations.length > 0 && <p className="text-xs text-muted-foreground">Limits of the data: {r.limitations.join(' ')}</p>}
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} />
          {open ? 'Hide evidence' : 'Inspect evidence'}
        </Button>
        {r.scenario && (
          <Button size="sm" className="gap-1.5" onClick={onSimulate}>
            <FlaskConical className="size-4" />
            Simulate this
          </Button>
        )}
      </div>
    </article>
  )
}
