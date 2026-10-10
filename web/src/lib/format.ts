export function formatINR(amount: number | string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(typeof amount === 'string' ? parseFloat(amount) : amount)
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}


export function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}



export function formatQty(v: number | string, unit = 'm'): string {
  return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(Number(v))} ${unit}`
}

export const unitFor = (stage: string) => (stage === 'SPINNING' ? 'kg' : 'm')

// YYYY-MM-DD for today plus `days` (negative for the past), for API date filters.
export const dayFromToday = (days: number) => toISODate(new Date(Date.now() + days * 86400000))

export function formatDayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

// Rupees the way the mill reads them: crore and lakh above a lakh.
export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const a = Math.abs(amount)
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)} L`
  return `${sign}${formatINR(a)}`
}
