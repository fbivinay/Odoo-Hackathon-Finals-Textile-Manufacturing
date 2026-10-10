import { useState } from 'react'
import { ChevronRight, FileText, LogOut, Settings, ShieldCheck } from 'lucide-react'
import { ROLE_LABEL } from '@/components/AppShell'
import { LegalDialog } from '@/components/LegalDialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatDate } from '@/lib/format'
import { PRIVACY, TERMS, type LegalDoc } from '@/lib/legal'
import { cn } from '@/lib/utils'
import type { User } from '@/types'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

// The sidebar's bottom button: who is signed in, the two documents, and the way out.
// `onSignOut` opens the "Log out?" confirmation; nothing here ends the session by itself.
export function SettingsMenu({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const [doc, setDoc] = useState<LegalDoc | null>(null)

  const show = (d: LegalDoc) => {
    setOpen(false)
    setDoc(d)
  }
  const rowClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-zinc-700 transition-colors outline-none hover:bg-zinc-100 focus-visible:bg-zinc-100'

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* Same box as the menu links above it, so the hover background lines up with them. */}
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-600 transition-colors outline-none hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-zinc-100 aria-expanded:text-zinc-900"
          >
            <Settings className="size-4" />
            Settings
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" sideOffset={8} className="w-[13.5rem] gap-0 p-1.5">
          <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-xs font-medium text-brand">{initials(user.name)}</div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</p>
            </div>
          </div>
          {user.createdAt && <p className="px-2.5 pb-2 text-xs text-muted-foreground">Joined {formatDate(user.createdAt)}</p>}

          <div className="border-t border-border pt-1.5">
            <button type="button" className={rowClass} onClick={() => show(TERMS)}>
              <FileText className="size-4 text-zinc-500" />
              <span className="flex-1 text-left">Terms &amp; Conditions</span>
              <ChevronRight className="size-3.5 text-zinc-400" />
            </button>
            <button type="button" className={rowClass} onClick={() => show(PRIVACY)}>
              <ShieldCheck className="size-4 text-zinc-500" />
              <span className="flex-1 text-left">Privacy Policy</span>
              <ChevronRight className="size-3.5 text-zinc-400" />
            </button>
          </div>

          <div className="mt-1.5 border-t border-border pt-1.5">
            <button
              type="button"
              className={cn(rowClass, 'text-problem hover:bg-problem/10 focus-visible:bg-problem/10')}
              onClick={() => {
                setOpen(false)
                onSignOut()
              }}
            >
              <LogOut className="size-4" />
              Log out
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {doc && <LegalDialog doc={doc} onClose={() => setDoc(null)} />}
    </>
  )
}
