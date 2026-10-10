import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { LegalDoc } from '@/lib/legal'

// One layout for both documents: the short version first, then numbered sections to scroll through.
export function LegalDialog({ doc, onClose }: { doc: LegalDoc; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">{doc.title}</DialogTitle>
          <DialogDescription>
            {doc.intro} Last updated {doc.updated}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 overflow-y-auto px-5 py-4 text-sm">
          <section className="rounded-lg bg-brand-tint p-3.5">
            <h3 className="text-xs font-medium tracking-wide text-brand uppercase">In short</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-brand-deep">
              {doc.inShort.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          {doc.sections.map((s, i) => (
            <section key={s.heading}>
              <h3 className="font-medium">
                {i + 1}. {s.heading}
              </h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-zinc-600">
                {s.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
