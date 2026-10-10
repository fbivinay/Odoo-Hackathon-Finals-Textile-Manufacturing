import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './api'
import { useDataVersion } from './changes'
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
// An invoice without its dispatch (order, buyer) cannot be attributed, so it is skipped, not crashed on.
let cache: Promise<CustomerData> | null = null
const load = () =>
  (cache ??= Promise.all([
    fetchAll<CBuyer>('/buyers'),
    fetchAll<COrder>('/orders'),
    fetchAll<CInvoice>('/invoices'),
    fetchAll<CCost>('/reports/order-costs'),
  ]).then(([buyers, orders, invoices, costs]) => ({ buyers, orders, invoices: invoices.filter((i) => i.dispatch?.order && i.dispatch.buyer), costs })))

export function useCustomerData() {
  const [data, setData] = useState<CustomerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  // A save anywhere (an order, a dispatch, a payment) changes the history: drop the copy and reload.
  const version = useDataVersion()
  const seen = useRef(version)

  useEffect(() => {
    if (seen.current !== version) {
      seen.current = version
      cache = null
    }
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
  }, [nonce, version])

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
