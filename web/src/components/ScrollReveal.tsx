import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Marks blocks that start below the fold so they arrive on scroll (CSS scroll timelines
// in index.css). Blocks already on screen keep their first-paint entrance instead.
const REVEALABLE = ['.stat-card', '.card', '.data-table-wrap', 'main > * > section'].join(',')

export function ScrollReveal() {
  const { pathname } = useLocation()

  // After the first entrance has played, later pages arrive in place with no delay.
  useEffect(() => {
    const t = window.setTimeout(() => document.documentElement.setAttribute('data-entered', ''), 2400)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!CSS.supports('animation-timeline: view()')) return

    // Layout position, not getBoundingClientRect: blocks are drawn offset while their entrance waits.
    const layoutTop = (el: HTMLElement) => {
      let y = 0
      for (let n: Element | null = el; n instanceof HTMLElement; n = n.offsetParent) y += n.offsetTop
      return y - window.scrollY
    }
    const mark = () => {
      const fold = window.innerHeight
      document.querySelectorAll<HTMLElement>(REVEALABLE).forEach((el) => {
        if (el.parentElement?.closest(REVEALABLE)) return // nested fades multiply
        if (layoutTop(el) > fold * 0.92) el.setAttribute('data-reveal', '')
      })
    }
    // Data loads after mount, so measure again once it has had time to arrive.
    const frame = requestAnimationFrame(mark)
    const later = [400, 1200, 2000].map((ms) => window.setTimeout(mark, ms))
    return () => {
      cancelAnimationFrame(frame)
      later.forEach(window.clearTimeout)
    }
  }, [pathname])

  return null
}
