import { lazy, Suspense, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { emptyDraft, type Draft, type LabResult } from '@/lib/lab'
import { useApi } from '@/lib/useApi'
import type { LabOptions } from '@/lib/lab'

const Intelligence = lazy(() => import('@/pages/lab/Intelligence').then((m) => ({ default: m.Intelligence })))
const Builder = lazy(() => import('@/pages/lab/Builder').then((m) => ({ default: m.Builder })))
const Results = lazy(() => import('@/pages/lab/Results').then((m) => ({ default: m.Results })))
const Saved = lazy(() => import('@/pages/lab/Saved').then((m) => ({ default: m.Saved })))

const TABS = [
  ['intelligence', 'Intelligence'],
  ['builder', 'Scenario builder'],
  ['results', 'Results'],
  ['saved', 'Saved scenarios'],
] as const
export type Tab = (typeof TABS)[number][0]

// A simulation: the inputs and what they gave.
export type Run = { draft: Draft; result: LabResult }

// Everest Lab: understand the mill, take a recommendation or build a what-if, see what it does,
// decide. Simulations plan the real data in memory on the server; nothing here changes the mill.
export function Lab() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'intelligence'
  const go = (t: Tab) => setParams((p) => { const out = new URLSearchParams(p); out.set('tab', t); return out }, { replace: true })
  const options = useApi<LabOptions>('/lab/options')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [current, setCurrent] = useState<Run | null>(null)

  const shared = { options: options.data, optionsError: options.error, draft, setDraft, go }

  return (
    <div>
      <Tabs value={tab} onValueChange={(v) => go(v as Tab)} className="gap-3">
        {/* Three columns on wide screens so the tabs sit in the middle of the page, as in Accounts. */}
        <header className="flex flex-wrap items-center justify-between gap-4 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-2">
          <h1 className="display">Everest Lab</h1>
          <TabsList className="flex-wrap lg:justify-self-center">
            {TABS.map(([k, label]) => (
              // 15% larger than the shared tab size (15.5px text).
              <TabsTrigger key={k} value={k} className="group-data-[variant=default]/tabs-list:px-[16.5px] group-data-[variant=default]/tabs-list:py-[10px] group-data-[variant=default]/tabs-list:text-[17.8px]">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </header>
        <Suspense fallback={<Skeleton className="mt-4 h-96 w-full" />}>
          <TabsContent value="intelligence">{tab === 'intelligence' && <Intelligence {...shared} />}</TabsContent>
          <TabsContent value="builder">
            {tab === 'builder' && (
              <Builder
                {...shared}
                onResult={(run) => {
                  setCurrent(run)
                  go('results')
                }}
              />
            )}
          </TabsContent>
          <TabsContent value="results">{tab === 'results' && <Results {...shared} run={current} />}</TabsContent>
          <TabsContent value="saved">
            {tab === 'saved' && (
              <Saved
                {...shared}
                onOpen={(run) => {
                  setCurrent(run)
                  go('results')
                }}
              />
            )}
          </TabsContent>
        </Suspense>
      </Tabs>
    </div>
  )
}

export type Shared = {
  options: LabOptions | null
  optionsError: string | null
  draft: Draft
  setDraft: (d: Draft) => void
  go: (t: Tab) => void
}
