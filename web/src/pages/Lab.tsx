import { lazy, Suspense, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHead } from '@/components/PageHead'
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
    <div className="space-y-5">
      <PageHead
        eyebrow="Owner only · decision support"
        title="Everest Lab"
        lede="See what is happening, get recommendations backed by the records, and test decisions before you make them. Simulations never change real orders, stock or accounts."
      />
      <Tabs value={tab} onValueChange={(v) => go(v as Tab)}>
        <TabsList className="flex-wrap">
          {TABS.map(([k, label]) => (
            <TabsTrigger key={k} value={k}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
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
