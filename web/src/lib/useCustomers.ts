import { useCallback, useEffect, useState } from 'react'
import { ApiError } from './api'
import type { Tone } from '@/components/StatusPill'
import type { CBuyer, CCost, CInvoice, COrder, CustomerStats } from './customers'
import { fetchAll } from './useApi'

export interface CustomerData {
  buyers: CBuyer[]
  orders: COrder[]
  invoices: CInvoice[]
  costs: CCost[]
}

// The whole history (a few MB) is loaded once and shared by the list and the detail page.
// ponytail: client-side aggregation; move to a /reports/buyers endpoint if the history outgrows the browser.
let cache: Promise<CustomerData> | null = null
const load = () =>
  (cache ??= Promise.all([
    fetchAll<CBuyer>('/buyers'),
    fetchAll<COrder>('/orders'),
    fetchAll<CInvoice>('/invoices'),
    fetchAll<CCost>('/reports/order-costs'),
  ]).then(([buyers, orders, invoices, costs]) => ({ buyers, orders, invoices, costs })))

export function useCustomerData() {
  const [data, setData] = useState<CustomerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let live = true
    load()
      .then((d) => live && setData(d))
      .catch((e) => {
        cache = null
        if (live) setError(e instanceof ApiError ? e.message : 'Could not load client history.')
      })
    return () => {
      live = false
    }
  }, [nonce])

  const reload = useCallback(() => {
    cache = null
    setError(null)
    setNonce((n) => n + 1)
  }, [])

  return { data, error, reload }
}

export const PERIODS = [
  { key: '365', label: 'Last 12 months', days: 365 },
  { key: '730', label: 'Last 2 years', days: 730 },
  { key: 'all', label: 'All time', days: null },
] as const

export const GRADE_TONE: Record<CustomerStats['grade'], Tone> = { A: 'good', B: 'neutral', C: 'watch' }
