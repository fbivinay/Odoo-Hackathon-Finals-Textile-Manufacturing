import { useSyncExternalStore } from 'react'

// Every screen reads from the same database, so a save anywhere can change what another section
// shows (a dispatch moves stock, invoices and the dashboard). Any successful write bumps this
// version; every data hook re-fetches when it changes. Other open tabs and coming back to the
// tab bump it too, so nothing on screen stays stale.
let version = 0
const subs = new Set<() => void>()
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('everest-data')

function bump() {
  version += 1
  subs.forEach((f) => f())
}

export function dataChanged() {
  bump()
  channel?.postMessage('changed')
}

if (channel) channel.onmessage = bump
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => !document.hidden && bump())

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}

export const useDataVersion = () => useSyncExternalStore(subscribe, () => version)
