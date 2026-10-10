import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function LoadMore({ hasMore, more }: { hasMore: boolean; more: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  if (!hasMore) return null
  return (
    <div className="flex justify-center">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => { setBusy(true); more().finally(() => setBusy(false)) }}>
        {busy ? 'Loading…' : 'Load more'}
      </Button>
    </div>
  )
}
