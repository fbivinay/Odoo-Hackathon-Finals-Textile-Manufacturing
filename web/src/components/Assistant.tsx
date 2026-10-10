import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUp, ImagePlus, RotateCcw, SquarePen, X } from 'lucide-react'
import { AskEverestLogo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ChatImage, ChatReply, User } from '@/types'

interface Attached extends ChatImage {
  url: string // preview
}
interface Message {
  role: 'user' | 'assistant'
  text: string
  images?: Attached[]
  failed?: boolean // the answer never came; offers a retry and is left out of the history sent next
  fresh?: boolean // just arrived: written out bit by bit, once
}

const MAX_IMAGES = 3
const SEEN_KEY = 'everest_assistant_seen'
const MAX_EDGE = 1400 // px; photos are shrunk in the browser before upload

// One starter question per section the person can open, so the first tap already works for them.
const STARTERS: [tab: string, question: string][] = [
  ['/dashboard', 'How is the mill doing today?'],
  ['/orders', 'Which orders are past their deadline?'],
  ['/materials', 'Which yarns are low on stock?'],
  ['/production', 'Which machines are idle right now?'],
  ['/planning', 'Which yarns do we need to buy?'],
  ['/qc', 'How many rolls are waiting for quality check?'],
  ['/waste', 'What are the top defects this month?'],
  ['/dispatch', 'What is ready to dispatch?'],
  ['/clients', 'Which buyer has placed the most orders?'],
  ['/raw-materials', 'What dyes and chemicals are running low?'],
]

// Shrink to MAX_EDGE and re-encode as JPEG: phone photos drop from several MB to a few hundred KB.
async function toAttached(file: File): Promise<Attached> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff' // transparent PNGs would turn black as JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const url = canvas.toDataURL('image/jpeg', 0.85)
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), url }
}

// The assistant answers in plain text with "- " bullets and **bold**; render just those.
function Rich({ text }: { text: string }) {
  const bold = (line: string) => line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part))
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (!bullets.length) return
    blocks.push(
      <ul key={blocks.length} className="list-disc space-y-0.5 pl-4">
        {bullets.map((b, i) => (
          <li key={i}>{bold(b)}</li>
        ))}
      </ul>,
    )
    bullets = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const bullet = /^[-•*]\s+(.*)$/.exec(line)
    if (bullet) bullets.push(bullet[1])
    else {
      flush()
      if (line) blocks.push(<p key={blocks.length}>{bold(line.replace(/^#+\s*/, ''))}</p>)
    }
  }
  flush()
  return <div className="space-y-1.5">{blocks}</div>
}

// Writes an answer out a few characters at a time, the way a person types, then hands back to the
// plain renderer. The whole answer is already here; this only paces how it appears.
function Typed({ text, onStep, onDone }: { text: string; onStep: () => void; onDone: () => void }) {
  const [shown, setShown] = useState(0)
  const done = useRef(onDone)
  const step = useRef(onStep)
  done.current = onDone
  step.current = onStep

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return done.current()
    // Long answers move faster, so nothing takes more than about three seconds.
    const stride = Math.max(1, Math.ceil(text.length / 180))
    const id = window.setInterval(() => {
      setShown((n) => {
        const next = Math.min(text.length, n + stride)
        if (next === text.length) {
          window.clearInterval(id)
          window.setTimeout(() => done.current(), 0)
        }
        return next
      })
      step.current()
    }, 16)
    return () => window.clearInterval(id)
  }, [text])

  // A bold marker cut in half would flash as raw asterisks; close it until the rest arrives.
  let partial = text.slice(0, shown).replace(/\*+$/, '')
  if ((partial.match(/\*\*/g) ?? []).length % 2) partial += '**'
  return <Rich text={partial} />
}

// `tabs`: the sidebar paths this person can open; it picks the starter questions.
export function Assistant({ user, tabs }: { user: User; tabs: string[] }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<Attached[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  // Whether this person has opened the assistant in this browser session; the launcher calms down after that.
  const [seen, setSeen] = useState(() => {
    try {
      return sessionStorage.getItem(SEEN_KEY) === '1'
    } catch {
      return false
    }
  })
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' })
  }, [open, messages, busy])
  useEffect(() => {
    if (!open) return
    // The panel only accepts focus once it has started to appear.
    const id = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(id)
  }, [open])

  function openPanel() {
    setOpen(true)
    setSeen(true)
    try {
      sessionStorage.setItem(SEEN_KEY, '1')
    } catch {
      // private mode: the ripples simply come back on the next load
    }
  }

  const starters = STARTERS.filter(([tab]) => tabs.includes(tab)).slice(0, 4)

  async function attach(files: Iterable<File>) {
    const picked = [...files].filter((f) => f.type.startsWith('image/'))
    if (!picked.length) return setNote('Only pictures can be attached.')
    const room = MAX_IMAGES - images.length
    setNote(picked.length > room ? `Up to ${MAX_IMAGES} pictures per message.` : null)
    try {
      const added = await Promise.all(picked.slice(0, Math.max(0, room)).map(toAttached))
      setImages((list) => [...list, ...added])
    } catch {
      setNote('That picture could not be read. Try a JPG or PNG.')
    }
  }

  async function ask(history: Message[]) {
    setBusy(true)
    try {
      const { reply } = await api<ChatReply>('/assistant/chat', {
        method: 'POST',
        quiet: true,
        body: {
          messages: history
            .filter((m) => !m.failed)
            .map((m) => ({ role: m.role, text: m.text, images: m.images?.map(({ mediaType, data }) => ({ mediaType, data })) })),
        },
      })
      setMessages([...history, { role: 'assistant', text: reply, fresh: true }])
    } catch (e) {
      setMessages([...history, { role: 'assistant', text: e instanceof ApiError ? e.message : 'Could not reach the assistant. Check your connection.', failed: true }])
    } finally {
      setBusy(false)
    }
  }

  function send(text = draft) {
    const clean = text.trim()
    if (busy || (!clean && !images.length)) return
    const history = [...messages.filter((m) => !m.failed), { role: 'user' as const, text: clean, images: images.length ? images : undefined }]
    setMessages(history)
    setDraft('')
    setImages([])
    setNote(null)
    void ask(history)
  }

  // Drop the failed answer and ask the same question again.
  const retry = () => void ask(messages.filter((m) => !m.failed))

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }
  function onPaste(e: ClipboardEvent) {
    const files = [...e.clipboardData.files]
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault()
      void attach(files)
    }
  }
  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void attach(e.dataTransfer.files)
  }

  // Both the button and the panel stay mounted so opening and closing can animate:
  // the panel grows out of the button's corner and sinks back into it.
  return (
    <>
      <div
        className={cn(
          'ask-launcher fixed right-5 bottom-5 z-30 size-12 transition-all duration-200 ease-out motion-reduce:transition-none print:hidden',
          open && 'pointer-events-none scale-50 opacity-0',
        )}
      >
        {/* Glow and ripples sit behind the button (index.css). The ripples stop once it has been opened. */}
        <span className="ask-halo" aria-hidden="true" />
        {!seen && (
          <>
            <span className="ask-ring" aria-hidden="true" />
            <span className="ask-ring" aria-hidden="true" />
          </>
        )}
        <button
          type="button"
          onClick={openPanel}
          aria-label="Open the assistant"
          title="Ask Everest"
          aria-hidden={open}
          tabIndex={open ? -1 : 0}
          className="relative flex size-12 items-center justify-center rounded-full bg-brand text-white shadow-lg outline-none transition-transform duration-200 hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <AskEverestLogo className="size-7" />
        </button>
      </div>

      <section
        aria-label="Assistant"
        aria-hidden={!open}
        inert={!open}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'fixed inset-0 z-40 flex origin-bottom-right flex-col bg-white transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:inset-auto sm:right-5 sm:bottom-5 sm:h-[min(620px,calc(100vh-2.5rem))] sm:w-[400px] sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl print:hidden',
          open ? 'visible translate-y-0 scale-100 opacity-100' : 'invisible translate-y-6 scale-90 opacity-0',
          dragging && 'ring-2 ring-brand',
        )}
      >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        {/* Same living glow as the closed button; it ripples while an answer is on its way. */}
        <div className="relative size-8 shrink-0">
          <span className="ask-halo ask-halo--sm" aria-hidden="true" />
          {busy && (
            <>
              <span className="ask-ring" aria-hidden="true" />
              <span className="ask-ring" aria-hidden="true" />
            </>
          )}
          <div className="relative flex size-8 items-center justify-center rounded-full bg-brand text-white">
            <AskEverestLogo className="size-5" />
          </div>
        </div>
        <div className="flex-1 leading-tight">
          <p className="text-sm font-medium">Ask Everest</p>
          <p className="text-[11px] text-muted-foreground">Answers from your sections</p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="icon-sm" title="New chat" aria-label="New chat" disabled={busy} onClick={() => setMessages([])}>
            <SquarePen className="size-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Close the assistant" onClick={() => setOpen(false)}>
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex h-full flex-col justify-end gap-4">
            <div>
              <p className="text-base font-medium">Hi {user.name.split(' ')[0]}, what do you need?</p>
              <p className="mt-1 text-muted-foreground">Ask in your own words, or attach a photo of a bill, a roll or a screen.</p>
            </div>
            <div className="grid gap-1.5">
              {starters.map(([, q]) => (
                <button key={q} type="button" onClick={() => send(q)} className="rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-brand-tint hover:text-brand">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex flex-col items-end gap-1.5">
              {m.images && (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {m.images.map((img, n) => (
                    <img key={n} src={img.url} alt="Attached" className="max-h-40 max-w-[70%] rounded-xl border border-border object-cover" />
                  ))}
                </div>
              )}
              {m.text && <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3 py-2 whitespace-pre-wrap text-white">{m.text}</p>}
            </div>
          ) : (
            <div key={i} className="flex flex-col items-start gap-1.5">
              <div className={cn('max-w-[90%] rounded-2xl rounded-bl-md px-3 py-2', m.failed ? 'bg-problem/10 text-problem' : 'bg-zinc-100')}>
                {m.fresh ? (
                  <Typed
                    text={m.text}
                    onStep={() => endRef.current?.scrollIntoView({ block: 'end' })}
                    onDone={() => setMessages((list) => list.map((x) => (x === m ? { ...x, fresh: false } : x)))}
                  />
                ) : (
                  <Rich text={m.text} />
                )}
              </div>
              {m.failed && i === messages.length - 1 && (
                <Button size="xs" variant="outline" className="gap-1" onClick={retry}>
                  <RotateCcw className="size-3" />
                  Try again
                </Button>
              )}
            </div>
          ),
        )}

        {busy && (
          <div className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md bg-zinc-100 px-3 py-3" role="status" aria-label="The assistant is looking it up">
            {[0, 150, 300].map((d) => (
              <span key={d} className="size-1.5 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <footer className="border-t border-border p-3">
        {note && <p className="mb-2 text-xs text-problem">{note}</p>}
        {images.length > 0 && (
          <div className="mb-2 flex gap-2">
            {images.map((img, n) => (
              <div key={n} className="relative">
                <img src={img.url} alt="To send" className="size-14 rounded-lg border border-border object-cover" />
                <button
                  type="button"
                  aria-label="Remove picture"
                  onClick={() => setImages((list) => list.filter((_, k) => k !== n))}
                  className="absolute -top-1.5 -right-1.5 flex size-4.5 items-center justify-center rounded-full bg-zinc-800 text-white"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5 rounded-xl border border-input px-1.5 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void attach(e.target.files)
              e.target.value = ''
            }}
          />
          <Button variant="ghost" size="icon-sm" title="Attach a picture" aria-label="Attach a picture" disabled={images.length >= MAX_IMAGES} onClick={() => fileRef.current?.click()}>
            <ImagePlus className="size-4" />
          </Button>
          <textarea
            ref={inputRef}
            id="assistant-input"
            rows={1}
            value={draft}
            maxLength={4000}
            placeholder="Ask about the mill…"
            aria-label="Message"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            style={{ outline: 'none', boxShadow: 'none' }} // the wrapper shows the focus ring
            className="field-sizing-content max-h-28 min-h-7 flex-1 resize-none bg-transparent py-1 text-sm placeholder:text-muted-foreground"
          />
          <Button size="icon-sm" aria-label="Send" className="rounded-full" disabled={busy || (!draft.trim() && !images.length)} onClick={() => send()}>
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </footer>
    </section>
    </>
  )
}
