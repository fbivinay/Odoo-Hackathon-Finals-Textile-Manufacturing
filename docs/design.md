# Design Guide

What the app looks like and which colours to use. Tokens live in `web/src/index.css`.

## Colour palette

### Brand

| Name | Value | Tailwind | Use |
|---|---|---|---|
| Indigo | `#4f46e5` | `indigo-600` | Logo tile, active menu item text (`indigo-700`), glow on sign-in |
| Indigo tint | `#eef2ff` | `indigo-50` | Active menu item background |
| Deep indigo | `#1e2a78` | — | Logo tile in `favicon.svg` and `logo.svg` only |
| Summit yellow | `#facc15` | `yellow-400` | Top bar of the logo. Nowhere else. |

### Neutrals

| Name | Value | Token / class | Use |
|---|---|---|---|
| Ground | `#f1f1f2` | `bg-ground`, `bg-background` | Page background |
| Surface | `#ffffff` | `bg-surface`, `bg-white` | Cards, sidebar, top bar |
| Line | `#e3e3e6` | `border-line`, `border-border` | Borders and dividers |
| Ink | `#0b0b0c` | `text-ink`, `bg-primary` | Main text, primary buttons |
| Ink 2 | `#4a4a52` | `text-ink-2` | Secondary text |
| Ink 3 | `#6b6b74` | `text-ink-3`, `text-muted-foreground` | Captions, hints |
| Sign-in panel | `#09090b` | `bg-zinc-950` | Dark left panel on sign-in |

### Status (the only other colour on working screens)

| Meaning | Text | Background | Classes | Examples |
|---|---|---|---|---|
| Good | `#16704a` | `#e6f2ec` | `text-good` `bg-good-bg` | Passed, paid, on time, running |
| Watch | `#96600a` | `#f8efdc` | `text-watch` `bg-watch-bg` | Low stock, rework, part-paid, maintenance |
| Problem | `#a82e22` | `#fbe9e7` | `text-problem` `bg-problem-bg` | Delayed, rejected, breakdown, form errors |
| Neutral | `#6b6b74` | `#eeeef0` | `text-neutral` `bg-neutral-bg` | Pending, idle |

Rule: colour means "look at this". Don't use status colours for decoration, and don't add new hues.

## Type and shape

| Thing | Value |
|---|---|
| Font | Geist Variable (`font-sans`); Geist Mono for figures (`font-mono`, `.tabular`) |
| Base size | Root is 20px (125% scale), so `text-sm` is the body size |
| Radius | `rounded-lg` (10px) for inputs, menu items, sign-in buttons; cards use the `.card` class |

## Layout (do not restyle without asking Gopal)

| Screen | Layout |
|---|---|
| Sign-in | Two halves. Left: dark panel, logo, headline, four feature rows. Right: white card with the form on the ground colour, demo sign-in buttons under it. |
| App shell | Fixed left sidebar (240px): logo, menu with icons, Log out at the bottom. Slim top bar with the user's name and role. On phones the sidebar opens from the menu button. |
| Pages | Each page starts with `<PageHead eyebrow title lede />`, then cards and tables. |

Adding a page: add one entry to `NAV` in `web/src/components/AppShell.tsx` (path, label, icon, roles) and a route in `App.tsx`. The sidebar and role access follow from that.

## Copy

| Where | Text |
|---|---|
| Headline | Every thread, accounted for. |
| Subline | One system for the whole mill. |
| Role names | Owner, Store, Production, Quality Control, Dispatch |

Keep labels short: two or three words, no full sentences on buttons or menu items.

## Logo

| File | Use |
|---|---|
| `web/src/components/Logo.tsx` | In-app mark; always on an indigo tile, white bars, yellow top bar |
| `web/public/favicon.svg` | Browser tab |
| `web/public/logo.svg` | Full logo with wordmark, for slides and the README |
