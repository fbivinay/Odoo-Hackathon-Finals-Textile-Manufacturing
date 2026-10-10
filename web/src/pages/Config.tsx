import { useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { selectClass } from '@/components/Field'
import { PageHead } from '@/components/PageHead'
import { Pill, label } from '@/components/StatusPill'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError } from '@/lib/api'
import { formatDateTime, formatINR } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import type { Config as ConfigData, ConfigChange, Ref } from '@/types'

type Fabric = ConfigData['fabrics'][number]
type Material = ConfigData['materials'][number]
type Rule = ConfigData['rules'][number]

const cell = 'px-3 py-2'
const head = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground'
const numInput = 'h-8 w-24 tabular-nums'
// A copy of a record without one key (to drop a row's unsaved edit).
const without = <T,>(o: Record<string, T>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key))
const name = (m: { yarnType: string; colour: string }) => (m.colour ? `${m.yarnType} · ${m.colour}` : m.yarnType)

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

// The owner's figures: everything the order form, planning, costing and dispatch checks use.
export function Config() {
  const config = useApi<ConfigData>('/config')
  const changes = useApi<ConfigChange[]>('/config/changes?limit=200')
  const suppliers = useApi<Ref[]>('/suppliers')
  const c = config.data

  return (
    <div className="space-y-5">
      <PageHead eyebrow="Owner only" title="Config" />
      <p className="-mt-3 max-w-3xl text-sm text-ink-2">
        The figures behind new orders, planning, costing and dispatch checks. A fabric marked <em>from history</em> uses the last year's orders until you save it.
      </p>
      {config.error && <p className="text-sm text-problem">{config.error}</p>}
      {!c ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Tabs defaultValue="fabrics">
          <TabsList>
            <TabsTrigger value="fabrics">Fabrics</TabsTrigger>
            <TabsTrigger value="materials">Materials</TabsTrigger>
            <TabsTrigger value="rules">Order rules</TabsTrigger>
            <TabsTrigger value="mill">Mill settings</TabsTrigger>
            <TabsTrigger value="log">Change log</TabsTrigger>
          </TabsList>
          <TabsContent value="fabrics">
            <Fabrics fabrics={c.fabrics} yarns={c.materials.filter((m) => m.category === 'YARN')} />
          </TabsContent>
          <TabsContent value="materials">
            <Materials materials={c.materials} suppliers={suppliers.data ?? []} />
          </TabsContent>
          <TabsContent value="rules">
            <Rules rules={c.rules} />
          </TabsContent>
          <TabsContent value="mill">
            <Mill settings={c.settings} />
          </TabsContent>
          <TabsContent value="log">
            <Log rows={changes.data ?? []} loading={changes.loading} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- fabrics --

type FabricDraft = { materialId: string; yarnPerMetre: string; wastagePct: string; pricePerMetre: string }
const draftOf = (f: Fabric): FabricDraft => ({ materialId: f.materialId ?? '', yarnPerMetre: String(f.yarnPerMetre), wastagePct: String(f.wastagePct), pricePerMetre: String(f.pricePerMetre) })

function Fabrics({ fabrics, yarns }: { fabrics: Fabric[]; yarns: Material[] }) {
  const [edits, setEdits] = useState<Record<string, FabricDraft>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState({ fabricType: '', materialId: '', yarnPerMetre: '', wastagePct: '3', pricePerMetre: '' })

  const draft = (f: Fabric) => edits[f.fabricType] ?? draftOf(f)
  const edit = (f: Fabric, k: keyof FabricDraft, v: string) => setEdits((e) => ({ ...e, [f.fabricType]: { ...draft(f), [k]: v } }))
  const dirty = (f: Fabric) => Boolean(edits[f.fabricType]) && JSON.stringify(edits[f.fabricType]) !== JSON.stringify(draftOf(f))

  async function saveRow(fabricType: string, d: FabricDraft) {
    setBusy(fabricType)
    const ok = await save(
      `/config/fabrics/${encodeURIComponent(fabricType)}`,
      'PUT',
      { materialId: d.materialId || null, yarnPerMetre: Number(d.yarnPerMetre), wastagePct: Number(d.wastagePct), pricePerMetre: Number(d.pricePerMetre) },
      `${fabricType} saved`,
    )
    if (ok) setEdits((e) => without(e, fabricType))
    setBusy(null)
    return ok
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    const name = adding.fabricType.trim()
    if (await saveRow(name, adding)) setAdding({ ...adding, fabricType: '', yarnPerMetre: '', pricePerMetre: '' })
  }

  return (
    <section className="space-y-3">
      <p className="text-sm text-ink-2">Yarn to issue for an order = metres × yarn per metre × (1 + wastage %). The price is the starting price on a new order.</p>
      <div className="data-table-wrap overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={head}>Fabric</th>
              <th className={head}>Usual yarn</th>
              <th className={head}>Yarn per metre (kg)</th>
              <th className={head}>Wastage %</th>
              <th className={head}>Price per metre (₹)</th>
              <th className={head} />
            </tr>
          </thead>
          <tbody>
            {fabrics.map((f) => {
              const d = draft(f)
              return (
                <tr key={f.fabricType} className="border-t border-border">
                  <td className={cn(cell, 'font-medium')}>
                    {f.fabricType}
                    <div className="mt-0.5">{f.saved ? <Pill tone="good">Saved</Pill> : <Pill>From history</Pill>}</div>
                  </td>
                  <td className={cell}>
                    <select aria-label={`Usual yarn for ${f.fabricType}`} className={cn(selectClass, 'h-8 min-w-48')} value={d.materialId} onChange={(e) => edit(f, 'materialId', e.target.value)}>
                      <option value="">None</option>
                      {yarns.map((m) => (
                        <option key={m.id} value={m.id}>
                          {name(m)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={cell}>
                    <Input aria-label={`Yarn per metre for ${f.fabricType}`} type="number" min="0.0001" step="0.0001" className={numInput} value={d.yarnPerMetre} onChange={(e) => edit(f, 'yarnPerMetre', e.target.value)} />
                  </td>
                  <td className={cell}>
                    <Input aria-label={`Wastage for ${f.fabricType}`} type="number" min="0" max="50" step="0.1" className={numInput} value={d.wastagePct} onChange={(e) => edit(f, 'wastagePct', e.target.value)} />
                  </td>
                  <td className={cell}>
                    <Input aria-label={`Price per metre for ${f.fabricType}`} type="number" min="0.01" step="0.01" className={numInput} value={d.pricePerMetre} onChange={(e) => edit(f, 'pricePerMetre', e.target.value)} />
                  </td>
                  <td className={cn(cell, 'text-right')}>
                    <Button size="sm" variant={dirty(f) ? 'default' : 'outline'} disabled={busy === f.fabricType || (f.saved && !dirty(f))} onClick={() => saveRow(f.fabricType, d)}>
                      {busy === f.fabricType ? 'Saving…' : 'Save'}
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-zinc-50/60">
              <td className={cell}>
                <Input form="add-fabric" aria-label="New fabric name" required placeholder="New fabric" className="h-8 w-36" value={adding.fabricType} onChange={(e) => setAdding({ ...adding, fabricType: e.target.value })} />
              </td>
              <td className={cell}>
                <select form="add-fabric" aria-label="Usual yarn for new fabric" className={cn(selectClass, 'h-8 min-w-48')} value={adding.materialId} onChange={(e) => setAdding({ ...adding, materialId: e.target.value })}>
                  <option value="">None</option>
                  {yarns.map((m) => (
                    <option key={m.id} value={m.id}>
                      {name(m)}
                    </option>
                  ))}
                </select>
              </td>
              <td className={cell}>
                <Input form="add-fabric" aria-label="Yarn per metre for new fabric" required type="number" min="0.0001" step="0.0001" className={numInput} value={adding.yarnPerMetre} onChange={(e) => setAdding({ ...adding, yarnPerMetre: e.target.value })} />
              </td>
              <td className={cell}>
                <Input form="add-fabric" aria-label="Wastage for new fabric" required type="number" min="0" max="50" step="0.1" className={numInput} value={adding.wastagePct} onChange={(e) => setAdding({ ...adding, wastagePct: e.target.value })} />
              </td>
              <td className={cell}>
                <Input form="add-fabric" aria-label="Price per metre for new fabric" required type="number" min="0.01" step="0.01" className={numInput} value={adding.pricePerMetre} onChange={(e) => setAdding({ ...adding, pricePerMetre: e.target.value })} />
              </td>
              <td className={cn(cell, 'text-right')}>
                <form id="add-fabric" onSubmit={add}>
                  <Button size="sm" type="submit" className="gap-1" disabled={busy !== null}>
                    <Plus className="size-3.5" />
                    Add
                  </Button>
                </form>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

// -------------------------------------------------------------- materials --

type MaterialDraft = { reorderLevel: string; supplierId: string; leadDays: string }
const matDraftOf = (m: Material): MaterialDraft => ({ reorderLevel: String(m.reorderLevel), supplierId: m.supplierId ?? '', leadDays: String(m.leadDays) })

function Materials({ materials, suppliers }: { materials: Material[]; suppliers: Ref[] }) {
  const [edits, setEdits] = useState<Record<string, MaterialDraft>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const draft = (m: Material) => edits[m.id] ?? matDraftOf(m)
  const edit = (m: Material, k: keyof MaterialDraft, v: string) => setEdits((e) => ({ ...e, [m.id]: { ...draft(m), [k]: v } }))
  const dirty = (m: Material) => Boolean(edits[m.id]) && JSON.stringify(edits[m.id]) !== JSON.stringify(matDraftOf(m))

  async function saveRow(m: Material) {
    const d = draft(m)
    setBusy(m.id)
    const ok = await save(`/config/materials/${m.id}`, 'PATCH', { reorderLevel: Number(d.reorderLevel), supplierId: d.supplierId || null, leadDays: Number(d.leadDays) }, `${name(m)} saved`)
    if (ok) setEdits((e) => without(e, m.id))
    setBusy(null)
  }

  return (
    <section className="space-y-3">
      <p className="text-sm text-ink-2">
        The low-stock level drives the shortage warnings and the refill on purchase orders. Delivery days is how long a short yarn holds up an order in the plan.
      </p>
      <div className="data-table-wrap overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={head}>Material</th>
              <th className={head}>Type</th>
              <th className={head}>Low-stock level</th>
              <th className={head}>Usual supplier</th>
              <th className={head}>Delivery days</th>
              <th className={head}>Average cost</th>
              <th className={head} />
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => {
              const d = draft(m)
              return (
                <tr key={m.id} className="border-t border-border">
                  <td className={cn(cell, 'font-medium')}>{name(m)}</td>
                  <td className={cn(cell, 'text-ink-2')}>{label(m.category)}</td>
                  <td className={cell}>
                    <div className="flex items-center gap-1">
                      <Input aria-label={`Low-stock level for ${name(m)}`} type="number" min="0" step="1" className={numInput} value={d.reorderLevel} onChange={(e) => edit(m, 'reorderLevel', e.target.value)} />
                      <span className="text-xs text-muted-foreground">{m.unit}</span>
                    </div>
                  </td>
                  <td className={cell}>
                    <select aria-label={`Usual supplier for ${name(m)}`} className={cn(selectClass, 'h-8 min-w-44')} value={d.supplierId} onChange={(e) => edit(m, 'supplierId', e.target.value)}>
                      <option value="">Last one used</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={cell}>
                    <Input aria-label={`Delivery days for ${name(m)}`} type="number" min="0" max="120" step="1" className="h-8 w-20 tabular-nums" value={d.leadDays} onChange={(e) => edit(m, 'leadDays', e.target.value)} />
                  </td>
                  <td className={cn(cell, 'tabular-nums text-ink-2')}>
                    {formatINR(m.avgCost)}/{m.unit}
                  </td>
                  <td className={cn(cell, 'text-right')}>
                    <Button size="sm" variant={dirty(m) ? 'default' : 'outline'} disabled={!dirty(m) || busy === m.id} onClick={() => saveRow(m)}>
                      {busy === m.id ? 'Saving…' : 'Save'}
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ rules --

const KINDS = [
  { kind: 'QUANTITY' as const, title: 'Order size', unit: 'm', lead: 'Orders under', hint: 'Small orders waste more at set-up and cost more per metre.' },
  { kind: 'DEADLINE' as const, title: 'Deadline', unit: 'days', lead: 'Deadline under', hint: 'Rushed orders jump the queue and run overtime.' },
]

function Rules({ rules }: { rules: Rule[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {KINDS.map((k) => (
        <RuleList key={k.kind} {...k} rules={rules.filter((r) => r.kind === k.kind)} />
      ))}
    </div>
  )
}

function RuleList({ kind, title, unit, lead, hint, rules }: (typeof KINDS)[number] & { rules: Rule[] }) {
  const [form, setForm] = useState({ below: '', pricePct: '', wastagePct: '' })
  const [edits, setEdits] = useState<Record<string, { pricePct: string; wastagePct: string }>>({})

  async function add(e: FormEvent) {
    e.preventDefault()
    const ok = await save('/config/rules', 'POST', { kind, below: Number(form.below), pricePct: Number(form.pricePct || 0), wastagePct: Number(form.wastagePct || 0) }, 'Rule added')
    if (ok) setForm({ below: '', pricePct: '', wastagePct: '' })
  }

  return (
    <section className="data-table-wrap space-y-3 p-4">
      <div>
        <h2 className="section-head">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint} The tightest band that fits applies; size and deadline bands add up.</p>
      </div>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-b border-border pb-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          {lead} ({unit})
          <Input required type="number" min="1" step="1" className="h-8 w-28" value={form.below} onChange={(e) => setForm({ ...form, below: e.target.value })} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Price %
          <Input type="number" step="0.5" placeholder="0" className="h-8 w-20" value={form.pricePct} onChange={(e) => setForm({ ...form, pricePct: e.target.value })} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Extra wastage %
          <Input type="number" step="0.5" placeholder="0" className="h-8 w-20" value={form.wastagePct} onChange={(e) => setForm({ ...form, wastagePct: e.target.value })} />
        </label>
        <Button size="sm" type="submit" className="gap-1">
          <Plus className="size-3.5" />
          Add band
        </Button>
      </form>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={cn(head, 'px-0')}>When</th>
            <th className={head}>Price %</th>
            <th className={head}>Extra wastage %</th>
            <th className={head} />
          </tr>
        </thead>
        <tbody>
          {rules.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-sm text-muted-foreground">
                No bands yet.
              </td>
            </tr>
          )}
          {rules.map((r) => {
            const d = edits[r.id] ?? { pricePct: String(r.pricePct), wastagePct: String(r.wastagePct) }
            const dirty = Boolean(edits[r.id]) && (d.pricePct !== String(r.pricePct) || d.wastagePct !== String(r.wastagePct))
            return (
              <tr key={r.id} className="border-t border-border">
                <td className="py-2">
                  {lead} {r.below.toLocaleString('en-IN')} {unit}
                </td>
                <td className={cell}>
                  <Input aria-label="Price change %" type="number" step="0.5" className="h-8 w-20" value={d.pricePct} onChange={(e) => setEdits({ ...edits, [r.id]: { ...d, pricePct: e.target.value } })} />
                </td>
                <td className={cell}>
                  <Input aria-label="Extra wastage %" type="number" step="0.5" className="h-8 w-20" value={d.wastagePct} onChange={(e) => setEdits({ ...edits, [r.id]: { ...d, wastagePct: e.target.value } })} />
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {dirty && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        if (await save(`/config/rules/${r.id}`, 'PATCH', { pricePct: Number(d.pricePct), wastagePct: Number(d.wastagePct) }, 'Rule saved'))
                          setEdits((e) => without(e, r.id))
                      }}
                    >
                      Save
                    </Button>
                  )}
                  <Button size="icon-xs" variant="ghost" aria-label={`Remove ${lead} ${r.below} ${unit}`} onClick={() => save(`/config/rules/${r.id}`, 'DELETE', undefined, 'Rule removed')}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

// ------------------------------------------------------------------- mill --

const USED_BY: Record<string, string> = {
  qcDays: 'Order Forecast: days between the last dyeing shift and ready',
  rollLength: 'Production: dyed fabric is cut into rolls of this length',
  shiftHours: 'Costing: labour cost per shift worked',
  dispatchTolerancePct: 'Dispatch: a truck within this % of the order counts as complete',
  shelfWaitDays: 'Dispatch: finished fabric waiting longer than this is flagged',
}

function Mill({ settings }: { settings: ConfigData['settings'] }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const changed = Object.entries(values).filter(([k, v]) => String(settings.find((s) => s.key === k)?.value) !== v)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    if (await save('/config/settings', 'PUT', Object.fromEntries(changed.map(([k, v]) => [k, Number(v)])), 'Mill settings saved')) setValues({})
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="data-table-wrap max-w-3xl space-y-4 p-4">
      {settings.map((s) => (
        <div key={s.key} className="grid items-center gap-2 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor={s.key} className="text-sm font-medium">
              {s.label}
            </label>
            <p className="text-xs text-muted-foreground">
              {USED_BY[s.key]} · default {s.default}
            </p>
          </div>
          <Input id={s.key} type="number" min={s.min} max={s.max} step="any" className="h-9 w-28 tabular-nums" value={values[s.key] ?? String(s.value)} onChange={(e) => setValues({ ...values, [s.key]: e.target.value })} />
        </div>
      ))}
      <div className="flex justify-end border-t border-border pt-3">
        <Button type="submit" disabled={busy || changed.length === 0}>
          {busy ? 'Saving…' : changed.length ? `Save ${changed.length} change${changed.length > 1 ? 's' : ''}` : 'No changes'}
        </Button>
      </div>
    </form>
  )
}

// -------------------------------------------------------------------- log --

const FIELD: Record<string, string> = {
  materialId: 'usual yarn',
  yarnPerMetre: 'yarn per metre',
  wastagePct: 'wastage %',
  pricePerMetre: 'price per metre',
  pricePct: 'price %',
  below: 'band',
  reorderLevel: 'low-stock level',
  supplierId: 'usual supplier',
  leadDays: 'delivery days',
  rule: 'rule',
}

function Log({ rows, loading }: { rows: ConfigChange[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-64 w-full" />
  if (!rows.length) return <p className="py-6 text-sm text-muted-foreground">No changes yet. Every edit on this page is recorded here.</p>
  return (
    <div className="data-table-wrap overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {['When', 'What', 'Changed', 'From', 'To', 'By'].map((h) => (
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
              <td className={cn(cell, 'tabular-nums text-muted-foreground')}>{r.oldValue ?? '—'}</td>
              <td className={cn(cell, 'tabular-nums font-medium')}>{r.newValue ?? '—'}</td>
              <td className={cell}>{r.changedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
