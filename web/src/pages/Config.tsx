import { useState, type FormEvent, type ReactNode } from 'react'
import { History, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/EmptyState'
import { Field, selectClass } from '@/components/Field'
import { PageHead } from '@/components/PageHead'
import { label } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError } from '@/lib/api'
import { formatDateTime, formatINR } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { Config as ConfigData, ConfigChange } from '@/types'

type Fabric = ConfigData['fabrics'][number]
type Material = ConfigData['materials'][number]
type Rule = ConfigData['rules'][number]

const cell = 'px-3 py-2.5'
const head = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground'
const numCell = cn(cell, 'tabular-nums')
const name = (m: { yarnType: string; colour: string }) => (m.colour ? `${m.yarnType} · ${m.colour}` : m.yarnType)
const pct = (n: number) => `${n > 0 ? '+' : ''}${n}%`

async function save(path: string, method: string, body: unknown, done: string) {
  try {
    await api(path, { method, body })
    toast.success(done)
    return true
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Something went wrong.')
    return false
  }
}

// The figures behind new orders, planning, costing and dispatch checks. The owner's, unless shared.
export function Config() {
  const config = useApi<ConfigData>('/config')
  const changes = useApi<ConfigChange[]>('/config/changes?limit=200')
  const c = config.data

  return (
    <div className="space-y-5">
      <PageHead eyebrow="Prices and rules" title="Mill Setup" />
      {config.error && <p className="text-sm text-problem">{config.error}</p>}
      {!c ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Tabs defaultValue="fabrics">
          <TabsList>
            <TabsTrigger value="fabrics">Fabrics</TabsTrigger>
            <TabsTrigger value="rules">Order rules</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="fabrics">
            <Fabrics fabrics={c.fabrics} yarns={c.materials.filter((m) => m.category === 'YARN')} />
          </TabsContent>
          <TabsContent value="rules">
            <Rules rules={c.rules} />
          </TabsContent>
          <TabsContent value="history">
            <Log rows={changes.data ?? []} loading={changes.loading} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// One narrow popup for every edit on this page: stacked fields, Cancel and Save.
function Popup({ title, hint, saveLabel = 'Save', canSave = true, onClose, onSave, extra, children }: { title: string; hint?: string; saveLabel?: string; canSave?: boolean; onClose: () => void; onSave: () => Promise<boolean>; extra?: ReactNode; children: ReactNode }) {
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    if (await onSave()) onClose()
    else setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {hint && <DialogDescription>{hint}</DialogDescription>}
        </DialogHeader>
        <form id="setup-form" onSubmit={submit} className="grid gap-4">
          {children}
        </form>
        <DialogFooter className={extra ? 'sm:justify-between' : undefined}>
          {extra}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="setup-form" disabled={busy || !canSave}>
              {saveLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// A number box with its unit shown inside, on the right.
function Num({ id, unit, value, onChange, ...rest }: { id: string; unit?: string; value: string; onChange: (v: string) => void; min?: number | string; max?: number | string; step?: number | string; required?: boolean; autoFocus?: boolean; placeholder?: string }) {
  return (
    <div className="relative">
      <Input id={id} type="number" className={cn('tabular-nums', unit && 'pr-14')} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
      {unit && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">{unit}</span>}
    </div>
  )
}

const EditButton = ({ onClick, what }: { onClick: () => void; what: string }) => (
  <Button size="xs" variant="outline" aria-label={`Edit ${what}`} onClick={onClick}>
    Edit
  </Button>
)

// ---------------------------------------------------------------- fabrics --

function Fabrics({ fabrics, yarns }: { fabrics: Fabric[]; yarns: Material[] }) {
  const [editing, setEditing] = useState<Fabric | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const yarnName = (id: string | null) => {
    const y = yarns.find((m) => m.id === id)
    return y ? name(y) : '—'
  }
  const q = search.trim().toLowerCase()
  const rows = fabrics.filter((f) => !q || [f.fabricType, yarnName(f.materialId)].some((v) => v.toLowerCase().includes(q)))

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Search fabrics" placeholder="Search fabric or yarn" className="bg-white pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button size="sm" className="gap-1" onClick={() => setEditing('new')}>
          <Plus className="size-3.5" />
          New fabric
        </Button>
      </div>
      <div className="data-table-wrap overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={head}>Fabric</th>
              <th className={head}>Yarn</th>
              <th className={head}>Yarn / m</th>
              <th className={head}>Wastage</th>
              <th className={head}>Price / m</th>
              <th className={head} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  {q ? (
                    <EmptyState icon={Search} line={`No fabric matches "${search.trim()}".`} actionLabel="Clear search" onAction={() => setSearch('')} />
                  ) : (
                    <EmptyState icon={Plus} line="No fabrics yet." actionLabel="New fabric" onAction={() => setEditing('new')} />
                  )}
                </td>
              </tr>
            )}
            {rows.map((f) => (
              <tr key={f.fabricType} className="border-t border-border">
                <td className={cn(cell, 'font-medium')}>
                  {f.fabricType}
                </td>
                <td className={cn(cell, 'text-ink-2')}>{yarnName(f.materialId)}</td>
                <td className={numCell}>{f.yarnPerMetre} kg</td>
                <td className={numCell}>{f.wastagePct}%</td>
                <td className={numCell}>{formatINR(f.pricePerMetre)}</td>
                <td className={cn(cell, 'text-right')}>
                  <EditButton what={f.fabricType} onClick={() => setEditing(f)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <FabricDialog fabric={editing === 'new' ? null : editing} taken={fabrics.map((f) => f.fabricType.toLowerCase())} yarns={yarns} onClose={() => setEditing(null)} />}
    </section>
  )
}

function FabricDialog({ fabric, taken, yarns, onClose }: { fabric: Fabric | null; taken: string[]; yarns: Material[]; onClose: () => void }) {
  const [form, setForm] = useState({
    fabricType: fabric?.fabricType ?? '',
    materialId: fabric?.materialId ?? '',
    yarnPerMetre: fabric ? String(fabric.yarnPerMetre) : '',
    wastagePct: fabric ? String(fabric.wastagePct) : '3',
    pricePerMetre: fabric ? String(fabric.pricePerMetre) : '',
  })
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const fabricType = form.fabricType.trim()
  const exists = !fabric && taken.includes(fabricType.toLowerCase())
  const [removing, setRemoving] = useState(false)

  async function remove() {
    setRemoving(true)
    if (await save(`/config/fabrics/${encodeURIComponent(fabricType)}`, 'DELETE', undefined, `${fabricType} removed`)) onClose()
    else setRemoving(false)
  }

  return (
    <Popup
      title={fabric ? fabric.fabricType : 'New fabric'}
      saveLabel={fabric ? 'Save' : 'Add fabric'}
      canSave={!exists && !removing}
      onClose={onClose}
      extra={
        !fabric ? undefined : fabric.history ? (
          <span className="text-xs text-muted-foreground">Has orders, so it can't be removed.</span>
        ) : (
          <Button variant="ghost" className="-ml-2 text-problem hover:text-problem" disabled={removing} onClick={remove}>
            Remove
          </Button>
        )
      }
      onSave={() =>
        save(
          `/config/fabrics/${encodeURIComponent(fabricType)}`,
          'PUT',
          { materialId: form.materialId || null, yarnPerMetre: Number(form.yarnPerMetre), wastagePct: Number(form.wastagePct), pricePerMetre: Number(form.pricePerMetre) },
          fabric ? `${fabricType} saved` : `${fabricType} added`,
        )
      }
    >
      {!fabric && (
        <Field label="Fabric name" htmlFor="fabric-name" hint={exists ? <span className="text-problem">That fabric is already in the list.</span> : undefined}>
          <Input id="fabric-name" required autoFocus maxLength={60} value={form.fabricType} onChange={(e) => set('fabricType')(e.target.value)} />
        </Field>
      )}
      <Field label="Usual yarn" htmlFor="fabric-yarn">
        <select id="fabric-yarn" className={selectClass} value={form.materialId} onChange={(e) => set('materialId')(e.target.value)}>
          <option value="">None</option>
          {yarns.map((m) => (
            <option key={m.id} value={m.id}>
              {name(m)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Yarn per metre (kg)" htmlFor="fabric-ypm">
        <Num id="fabric-ypm" unit="kg" required min="0.0001" max="5" step="0.0001" value={form.yarnPerMetre} onChange={set('yarnPerMetre')} />
      </Field>
      <Field label="Wastage (%)" htmlFor="fabric-waste">
        <Num id="fabric-waste" unit="%" required min="0" max="50" step="0.1" value={form.wastagePct} onChange={set('wastagePct')} />
      </Field>
      <Field label="Price per metre (₹)" htmlFor="fabric-price">
        <Num id="fabric-price" unit="₹" required min="0.01" step="0.01" value={form.pricePerMetre} onChange={set('pricePerMetre')} />
      </Field>
    </Popup>
  )
}

// ------------------------------------------------------------------ rules --

const KINDS = [
  { kind: 'QUANTITY' as const, title: 'Small orders', unit: 'm', lead: 'Order under' },
  { kind: 'DEADLINE' as const, title: 'Rush orders', unit: 'days', lead: 'Deadline under' },
]
type Kind = (typeof KINDS)[number]

function Rules({ rules }: { rules: Rule[] }) {
  const [editing, setEditing] = useState<{ kind: Kind; rule: Rule | null } | null>(null)

  return (
    <section className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        {KINDS.map((k) => {
          const mine = rules.filter((r) => r.kind === k.kind)
          return (
            <div key={k.kind} className="data-table-wrap">
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <h2 className="section-head">{k.title}</h2>
                <Button size="xs" variant="outline" className="gap-1" onClick={() => setEditing({ kind: k, rule: null })}>
                  <Plus className="size-3" />
                  Add rule
                </Button>
              </div>
              {mine.length === 0 ? (
                <p className="border-t border-border px-3 py-6 text-center text-sm text-muted-foreground">No rules yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-t border-border">
                      <th className={head}>When</th>
                      <th className={head}>Price</th>
                      <th className={head}>Wastage</th>
                      <th className={head} />
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className={cell}>
                          {k.lead} {r.below.toLocaleString('en-IN')} {k.unit}
                        </td>
                        <td className={numCell}>{pct(r.pricePct)}</td>
                        <td className={numCell}>{pct(r.wastagePct)}</td>
                        <td className={cn(cell, 'text-right')}>
                          <EditButton what={`${k.lead} ${r.below} ${k.unit}`} onClick={() => setEditing({ kind: k, rule: r })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>
      {editing && <RuleDialog {...editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function RuleDialog({ kind, rule, onClose }: { kind: Kind; rule: Rule | null; onClose: () => void }) {
  const before = { below: rule ? String(rule.below) : '', pricePct: rule ? String(rule.pricePct) : '', wastagePct: rule ? String(rule.wastagePct) : '' }
  const [form, setForm] = useState(before)
  const [removing, setRemoving] = useState(false)
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const body = { pricePct: Number(form.pricePct || 0), wastagePct: Number(form.wastagePct || 0) }
  const when = `${kind.lead} ${rule?.below.toLocaleString('en-IN')} ${kind.unit}`

  async function remove() {
    setRemoving(true)
    if (await save(`/config/rules/${rule!.id}`, 'DELETE', undefined, 'Rule removed')) onClose()
    else setRemoving(false)
  }

  return (
    <Popup
      title={rule ? when : `New rule · ${kind.title.toLowerCase()}`}
      saveLabel={rule ? 'Save' : 'Add rule'}
      canSave={!removing && JSON.stringify(form) !== JSON.stringify(before)}
      onClose={onClose}
      onSave={() => (rule ? save(`/config/rules/${rule.id}`, 'PATCH', body, 'Rule saved') : save('/config/rules', 'POST', { kind: kind.kind, below: Number(form.below), ...body }, 'Rule added'))}
      extra={
        rule ? (
          <Button variant="ghost" className="-ml-2 text-problem hover:text-problem" disabled={removing} onClick={remove}>
            Remove
          </Button>
        ) : undefined
      }
    >
      {!rule && (
        <Field label={`${kind.lead} (${kind.unit})`} htmlFor="rule-below">
          <Num id="rule-below" unit={kind.unit} required autoFocus min="1" step="1" value={form.below} onChange={set('below')} />
        </Field>
      )}
      <Field label="Price change (%)" htmlFor="rule-price" hint="Use a minus to give a discount.">
        <Num id="rule-price" unit="%" min="-50" max="100" step="0.5" placeholder="0" value={form.pricePct} onChange={set('pricePct')} />
      </Field>
      <Field label="Extra wastage (%)" htmlFor="rule-waste">
        <Num id="rule-waste" unit="%" min="-50" max="100" step="0.5" placeholder="0" value={form.wastagePct} onChange={set('wastagePct')} />
      </Field>
    </Popup>
  )
}

// ---------------------------------------------------------------- history --

const FIELD: Record<string, string> = {
  materialId: 'usual yarn',
  yarnPerMetre: 'yarn per metre',
  wastagePct: 'wastage %',
  pricePerMetre: 'price per metre',
  pricePct: 'price %',
  below: 'limit',
  reorderLevel: 'low-stock level',
  supplierId: 'usual supplier',
  leadDays: 'delivery days',
  rule: 'rule',
  fabric: 'fabric',
  qcDays: 'quality check time',
  rollLength: 'roll length',
  shiftHours: 'hours in a shift',
  dispatchTolerancePct: 'dispatch tolerance',
  shelfWaitDays: 'finished fabric wait limit',
}

function Log({ rows, loading }: { rows: ConfigChange[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-64 w-full" />
  if (!rows.length)
    return (
      <div className="data-table-wrap">
        <EmptyState icon={History} line="No changes yet. Every edit on this page is recorded here." />
      </div>
    )
  return (
    <div className="data-table-wrap overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {['When', 'Item', 'Field', 'From', 'To', 'By'].map((h) => (
              <th key={h} className={head}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className={cn(cell, 'whitespace-nowrap text-ink-2')}>{formatDateTime(r.changedAt)}</td>
              <td className={cell}>{r.what}</td>
              <td className={cell}>{FIELD[r.field] ?? label(r.field)}</td>
              <td className={cn(numCell, 'text-muted-foreground')}>{r.oldValue ?? '—'}</td>
              <td className={cn(numCell, 'font-medium')}>{r.newValue ?? '—'}</td>
              <td className={cell}>{r.changedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
