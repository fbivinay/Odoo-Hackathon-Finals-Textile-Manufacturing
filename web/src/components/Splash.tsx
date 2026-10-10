import { Logo } from '@/components/Logo'

// The loading cover. Entirely CSS (see .splash in index.css): it starts at first paint and
// lifts on its own, so it can't get stuck waiting on React. Plays once every six hours.
export function Splash() {
  return (
    <div className="splash" aria-hidden="true">
      <div className="splash__inner">
        <span className="flex size-12 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <Logo className="size-8" />
        </span>
        <div className="splash__name">Everest</div>
        <div className="splash__sub">Textile Mills</div>
        <div className="splash__tag">Yarn · Looms · QC · Dispatch</div>
        <div className="splash__track">
          <span className="splash__fill" />
        </div>
        <div className="splash__pct" />
      </div>
    </div>
  )
}
