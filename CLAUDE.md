# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Serverless web app that generates amusing fake achievements in the style of the trolling AI from "Dungeon Crawler Carl". Users enter any activity and receive three creative achievements with copy-to-clipboard and local storage for recent generations.

## Architecture

**Cloudflare Pages + OpenRouter:**
- **`public/index.html`** — Single-page frontend (vanilla HTML/CSS/JS, no build step)
- **`functions/generate.ts`** — Cloudflare Pages Function handling POST `/generate`
- **OpenRouter** — AI provider; model switchable via `OPENROUTER_MODEL` env var (default: `anthropic/claude-haiku-4.5`)

**Key Design Decisions:**
- No database — achievements stored in browser LocalStorage
- Vanilla frontend, zero build complexity
- Prompts inlined in `functions/generate.ts` (CF Workers have no filesystem access)
- `prompts/` directory kept as source-of-truth reference for prompt editing

**API:**
- `POST /generate` — body `{ activity: string, style?: string, recentTitles?: string[] }` → `{ achievements: Achievement[], mood: string, timestamp: string }` where `Achievement = { title, description, reward }` (always 3).
- `OPTIONS /generate` — CORS preflight (`Access-Control-Allow-Origin: *`).
- OpenRouter call uses the `openai` SDK pointed at `https://openrouter.ai/api/v1`; sends `HTTP-Referer` + `X-Title` headers; `temperature: 0.9`, `max_tokens: 2000`.

**Frontend state:**
- LocalStorage key `recentAchievements` — array capped at 10 entries `{ activity, achievements, style, timestamp }`. Examples panel only renders when this key is empty.
- `tsconfig.json` covers `functions/**/*` only — frontend JS in `index.html` is not type-checked.

## Gotchas

- **`README.md` is stale** — describes the old AWS Bedrock/Lambda/SAM stack. Trust this file and the code, not the README.
- **Variety knobs are server-side** — each request rolls a random `mood` (committed for all 3 achievements), a `seedPhrase`, and optionally applies a `recentTitles` Forbidden Words List. See `MOODS`, `SEED_PHRASES`, `buildForbiddenBlock` in `functions/generate.ts`. Response includes `mood` and `moodLabel` strings used by the loading sequence.
- **Two base prompts exist and diverge.** The runtime prompt is the `BASE_TEMPLATE` const inside `functions/generate.ts`. The files under `prompts/` are not loaded — they're an older reference snapshot. Edit the inlined string.
- **Backend never returns 5xx for AI/parsing failures.** On any OpenRouter or JSON-parse error it returns 200 with three hardcoded `FALLBACK_ACHIEVEMENTS`. The only real error response is `400` for missing/empty `activity`.
- **`public/html2canvas.min.js` is unused.** Image export uses a custom `drawAchievementCanvas()` (Canvas API) — html2canvas was left behind from an earlier approach.

## Commands

```bash
make dev        # local dev server (reads .dev.vars)
make deploy     # deploy to Cloudflare Pages
make secret     # set OPENROUTER_API_KEY in CF
make typecheck  # TypeScript type checking
```

## Project Structure

```
public/
├── index.html          # Frontend with embedded CSS/JS
└── fonts/              # Self-hosted woff2 (no CDN). Add <link rel=preload> + @font-face for any new file.
    ├── PressStart2P-Regular.woff2    # Page title (pixel)
    ├── outfit-variable.woff2         # Body / UI
    ├── cormorant-garamond-latin-400-normal.woff2
    ├── cormorant-garamond-latin-400-italic.woff2  # Achievement titles
    └── cormorant-garamond-latin-600-normal.woff2
functions/
└── generate.ts         # CF Pages Function — calls OpenRouter API
prompts/                # Reference snapshots only — NOT loaded at runtime. Editing has no effect.
docs/                   # Brainstorm notes and design decisions
wrangler.toml           # Cloudflare Pages config
.dev.vars               # Local secrets (gitignored)
.dev.vars.example       # Template for .dev.vars
Makefile                # Dev shortcuts
```

**Visual design — Crawler Codex palette** (CSS vars in `index.html`):
- `--c-bg #0b0906` warm dark base, `--c-accent #9c6644` iron-rust, `--c-accent-soft #c4845a` phosphor-amber (AI voice), `--c-amber #e6a674` warm highlight.
- Achievement title: Cormorant Garamond italic + amber CRT glow text-shadow.
- Cards: dark panel + rivet corner dots (CSS `radial-gradient` in `background-image`).
- Token variant documented in `sugarhouse-design-system/tokens/variants/dungeon.json`.

## Adding New Features

**New style:** Both sides must agree. Add a key to the `STYLES` object in `functions/generate.ts` AND a matching pill button (with `data-style="<key>"`) in `public/index.html`. The reference file in `prompts/styles/` is optional and not loaded at runtime.

**Switch AI model:** Change `OPENROUTER_MODEL` secret in Cloudflare dashboard, or locally in `.dev.vars`. Browse models at https://openrouter.ai/models.

**Custom domain:** Add via Cloudflare Pages dashboard → Custom domains.

## Local Development

Requires a `.dev.vars` file (copy from `.dev.vars.example`):
```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-haiku-4.5
```

## Deployment

Hosted at https://achievements.carlkibler.com (CF Pages: https://dungeon-achievements.pages.dev)

Secrets stored in Cloudflare Pages dashboard (not in wrangler.toml).
