// Printing one document out of a busy screen.
//
// Anything marked `.print-area` (an invoice popup, a payslip, a purchase order) prints on its own.
// Hiding the rest of the page with CSS alone is fragile: the area sits inside popups, scrolling
// panels and the app frame, and inherits their position, clipping and transforms. So just before
// the browser prints, the area is copied to the top of the document as a plain block, everything
// else is switched off (see `.print-root` in index.css), and the copy is removed afterwards.
function mount() {
  unmount()
  // The last one is the one on top: a popup opened over a printable page.
  const areas = document.querySelectorAll<HTMLElement>('.print-area')
  const source = areas[areas.length - 1]
  if (!source) return
  const copy = source.cloneNode(true) as HTMLElement
  copy.classList.remove('print-area')
  copy.removeAttribute('id')
  copy.removeAttribute('style')
  // Typed values don't survive a clone; carry them over so a filled-in form prints as seen.
  const from = source.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')
  copy.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea').forEach((el, i) => {
    el.value = from[i]?.value ?? ''
  })
  const root = document.createElement('div')
  root.className = 'print-root'
  root.appendChild(copy)
  document.body.appendChild(root)
}

function unmount() {
  document.querySelectorAll('.print-root').forEach((el) => el.remove())
}

export function setUpPrinting() {
  window.addEventListener('beforeprint', mount)
  window.addEventListener('afterprint', unmount)
}
