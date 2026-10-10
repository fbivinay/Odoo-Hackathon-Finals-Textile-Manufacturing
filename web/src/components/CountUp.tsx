import { useLayoutEffect, useRef, useState } from 'react'

// Counts the first number inside an already formatted string ("₹1,23,456", "4,820 m", "43%")
// up from zero whenever it scrolls into view, keeping prefix, suffix and Indian grouping.
const NUMBER = /\d[\d,]*(?:\.\d+)?/
const DURATION = 900
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

export function CountUp({ text }: { text: string }) {
  const [shown, setShown] = useState(text)
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const match = text.match(NUMBER)
    const node = ref.current
    setShown(text)
    if (!node || !match || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const raw = match[0]
    const target = Number(raw.replace(/,/g, ''))
    const decimals = raw.includes('.') ? raw.split('.')[1].length : 0
    const prefix = text.slice(0, match.index)
    const suffix = text.slice((match.index ?? 0) + raw.length)
    const fmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

    let frame = 0
    let start = 0
    const step = (now: number) => {
      if (!start) start = now
      const t = Math.min(1, (now - start) / DURATION)
      setShown(t === 1 ? text : prefix + fmt.format(target * easeOut(t)) + suffix)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        cancelAnimationFrame(frame)
        if (!entry.isIntersecting) return
        start = 0
        frame = requestAnimationFrame(step)
      },
      { threshold: 0.25 },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [text])

  return (
    <span ref={ref} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {shown}
    </span>
  )
}
