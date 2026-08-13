# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Serverless web app that generates amusing fake achievements in the style of the trolling AI from "Dungeon Crawler Carl". Users enter any activity and receive three creative achievements with copy-to-clipboard and local storage for recent generations.

## Architecture

**Cloudflare Pages + OpenRouter:**
- **`public/index.html`** — Single-page frontend (vanilla HTML/CSS/JS, no build step)
- **`src/core.ts`** — all generation logic: prompts, moods, styles, provider fallback, parsing
- **`functions/generate.ts`** — Cloudflare Pages Function; a thin adapter over `src/core.ts`
- **`server.ts`** — Node adapter over the same core (API only, see Gotchas)
- **OpenRouter** — AI provider; model switchable via `OPENROUTER_MODEL` env var (default: `anthropic/claude-haiku-4.5`)

**Key Design Decisions:**
- No database — achievements stored in browser LocalStorage
- Vanilla frontend, zero build complexity
- Prompts inlined in `src/core.ts` (CF Workers have no filesystem access)
- `prompts/` directory kept as source-of-truth reference for prompt editing

**API:**
- `POST /generate` — body `{ activity: string, style?: string, recentTitles?: string[] }` → `{ achievements: Achievement[], mood: string, framing: string, degraded: boolean, timestamp: string }` where `Achievement = { title, description, reward }` (always 3). `activity` is capped at 500 chars (`400` past that).
- **`degraded: true` means you are not getting primary-model output** — either Workers AI served the request after OpenRouter failed, or all providers failed and these are the canned `FALLBACK_ACHIEVEMENTS`. This is the monitoring hook; watch it.
- `OPTIONS /generate` — CORS preflight (`Access-Control-Allow-Origin: *`).
- OpenRouter call uses the `openai` SDK pointed at `https://openrouter.ai/api/v1`; sends `HTTP-Referer` + `X-Title` headers; `temperature: 0.9`, `max_tokens: 2000`.

**Frontend state:**
- LocalStorage key `recentAchievements` — array capped at 10 entries `{ activity, achievements, style, timestamp }`. Examples panel only renders when this key is empty.
- `tsconfig.json` covers `functions/**/*` only — frontend JS in `index.html` is not type-checked.

## Gotchas

- **`README.md` is the public-facing doc and is current** (rewritten 2026-08-12; it no longer describes
  the old AWS Bedrock/Lambda/SAM stack). It carries the self-hosting guide, so changes to ports,
  scripts, model defaults, or the style-pill markup have to land there too.
- **`server.ts` is not feature-equivalent to the Pages Function.** It serves `POST /generate` only —
  no static files, no Workers AI fallback, and no `degraded` flag in its response. Don't reach for it
  as a local stand-in for the real site; `make dev` runs the actual Workers runtime.
- **Variety knobs are server-side** — each request rolls a random `mood` (committed for all 3 achievements), a `seedPhrase`, and optionally applies a `recentTitles` Forbidden Words List. See `MOODS`, `SEED_PHRASES`, `buildForbiddenBlock` in `src/core.ts`. Response includes `mood` and `moodLabel` strings used by the loading sequence.
- **Two base prompts exist and diverge.** The runtime prompt is the `BASE_TEMPLATE` const inside `src/core.ts`. The files under `prompts/` are not loaded — they're an older reference snapshot. Edit the inlined string.
- **Backend never returns 5xx for AI/parsing failures.** It returns 200 with `FALLBACK_ACHIEVEMENTS`. The only real error responses are `400` (missing/empty or over-long `activity`). Because a broken site still returns 200 with plausible JSON, **uptime checks cannot detect an outage here** — check the `degraded` flag instead. This exact blind spot hid a full outage from 2026-05-28 to 2026-08-12.
- **Provider chain is OpenRouter → Workers AI → canned.** `runWithFallback` in `src/core.ts` (unit-tested) tries each in order; `degraded` is true if the first choice failed. Workers AI needs no key — it uses the `[ai]` binding in `wrangler.toml`.
- **Model slugs rot, and both providers have bitten us.** OpenRouter retired `anthropic/claude-3-5-haiku`; Workers AI renamed `@cf/meta/llama-3.1-8b-instruct` to `-fp8`. When output goes generic, re-check the slug against `https://openrouter.ai/api/v1/models` or `GET /accounts/{id}/ai/models/search`.
- **Workers AI returns two response shapes.** Classic models give `{ response }`; OpenAI-compatible ones (`gpt-oss`, reasoning models) give `{ choices[0].message.content }`, and reasoning models can return `content: null`. `callWorkersAI` reads both and throws on empty. The account is on the **Workers Free plan** — premium models like `@cf/zai-org/glm-5.2` return an availability error.
- **`public/html2canvas.min.js` is unused.** Image export uses a custom `drawAchievementCanvas()` (Canvas API) — html2canvas was left behind from an earlier approach.

## Dependencies

**Every version in `package.json` is pinned exactly, and that is load-bearing.** `scripts/check-deps-age.js`
runs on `postinstall` and refuses any package published less than 14 days ago. A caret range is in
permanent conflict with that rule: npm re-resolves to the newest match on every install, and the
newest match is always too fresh. Before this was pinned, a plain `npm install` failed on 20 packages.

- `overrides` in `package.json` holds transitive deps (vite, rolldown, postcss, nanoid, …) at the
  newest release that clears the cooldown. They are not arbitrary — each was too fresh at pin time.
- To upgrade anything, find the newest version at least 14 days old and set it exactly. `npm view
  <pkg> time --json` gives publish dates.
- `wrangler` and `@cloudflare/workers-types` must move together — wrangler declares the matching
  types package as a peer dependency, and mismatched majors fail `npm install` outright.
- `package-lock.json` is gitignored, so `npm ci` is not available here; `npm install` is the entry point.

## Commands

```bash
make dev        # local dev server on :8788 (reads .dev.vars)
make deploy     # deploy to Cloudflare Pages
make secret     # set OPENROUTER_API_KEY in CF
make typecheck  # TypeScript type checking
make seo        # metadata, DCC keywords, FAQ/JSON-LD sync, og.png, robots, sitemap
make a11y       # axe + keyboard/focus + reflow (needs `make dev` running)
npm test        # vitest — provider fallback chain and parsing
```

## Project Structure

```
public/
├── index.html          # Frontend with embedded CSS/JS
├── robots.txt          # Allows all; points at sitemap
├── sitemap.xml         # Single URL — bump <lastmod> on meaningful content changes
├── og.png              # 1200x630 social card (regenerate: see SEO note below)
└── fonts/              # Self-hosted woff2 (no CDN). Add <link rel=preload> + @font-face for any new file.
    ├── PressStart2P-Regular.woff2    # Page title (pixel)
    ├── outfit-variable.woff2         # Body / UI
    ├── cormorant-garamond-latin-400-normal.woff2
    ├── cormorant-garamond-latin-400-italic.woff2  # Achievement titles
    └── cormorant-garamond-latin-600-normal.woff2
src/
├── core.ts             # All generation logic — the file you usually want
└── core.test.ts        # Unit tests for the fallback chain and parsing
functions/
└── generate.ts         # CF Pages Function — thin adapter over src/core.ts
server.ts               # Node adapter (API only — no static files, no degraded flag)
scripts/
├── check-seo.mjs       # Guards metadata + FAQ/JSON-LD sync (no deps)
├── check-a11y.mjs      # axe + keyboard/focus + reflow (needs playwright)
├── check-deps-age.js   # 14-day supply-chain cooldown, runs on postinstall
├── analytics-report.js # CLI analytics dashboard
└── provision-token.js  # Creates a scoped CF token for analytics
corpus/                 # Source-linked DCC achievements used to tune the prompt
prompts/                # Reference snapshots only — NOT loaded at runtime. Editing has no effect.
docs/                   # Brainstorm notes and design decisions
.github/workflows/      # canary.yml watches the `degraded` flag daily; deploy.yml
wrangler.toml           # Cloudflare Pages config
.dev.vars               # Local secrets (gitignored)
.dev.vars.example       # Template for .dev.vars
Makefile                # Dev shortcuts
```

**Type scale:** every `font-size` in the stylesheet is in `rem`, so `html { font-size }` (currently
`118.75%` = 19px) is the single dial for the whole page. Scale the page there, not by editing
individual rules. The canvas export sizes are px in JS and deliberately do *not* follow it.

## Accessibility

`make a11y` (needs `make dev` running) runs axe-core, keyboard/focus behaviour, and a reflow sweep
from 1600px to 320px. Run it after any change to markup, focus handling, or layout. It needs the
Playwright browser binary once: `npx playwright install chromium`.

- **`#srStatus` is the only thing that talks.** The loading panel is `aria-hidden` on purpose — its
  verdict line swaps every 3.5s and would interrupt a screen reader on a loop. Announce through
  `announce()` instead, and strip emoji from anything announced (`plainTitle()`).
- **Focus moves to `#achievementsHeading` when results land.** Without it a keyboard user is stranded
  on the Generate button with no idea the page changed. Don't replace this with scrolling alone.
- **Action buttons need unique `aria-label`s** — "Copy" appears a dozen times per page, so the label
  must name its achievement. `cardActions()` builds them; the a11y check fails on duplicates.
- **The style picker is an ARIA radiogroup** with roving tabindex (one Tab stop, arrow keys move).
  Adding a style means adding a `role="radio"` pill with `aria-checked` and `tabindex="-1"`.
- **Never use `transition: all` on an interactive control** — it animates `outline-color`, so the
  focus ring fades in over 200ms instead of appearing. Name the properties.
- **Reflow is the zoom test.** Browser zoom shrinks the CSS viewport: 1280px at 400% zoom is a 320px
  layout. `white-space: nowrap` on a button is the usual thing that breaks it.

**Visual design — Crawler Codex palette** (CSS vars in `index.html`):
- `--c-bg #0b0906` warm dark base, `--c-accent #9c6644` iron-rust, `--c-accent-soft #c4845a` phosphor-amber (AI voice), `--c-amber #e6a674` warm highlight.
- Achievement title: Cormorant Garamond italic + amber CRT glow text-shadow.
- Cards: dark panel + rivet corner dots (CSS `radial-gradient` in `background-image`).
- Token variant documented in `sugarhouse-design-system/tokens/variants/dungeon.json`.

## Adding New Features

**New style:** Both sides must agree. Add a key to the `STYLES` object in `src/core.ts` AND a matching pill button in `public/index.html` — which must carry `role="radio" aria-checked="false" tabindex="-1"` and an `aria-hidden` emoji span, or it breaks the radiogroup (`make a11y` catches this). The reference file in `prompts/styles/` is optional and not loaded at runtime.

**Switch AI model:** Change `OPENROUTER_MODEL` secret in Cloudflare dashboard, or locally in `.dev.vars`. Browse models at https://openrouter.ai/models.

**Custom domain:** Add via Cloudflare Pages dashboard → Custom domains.

## SEO

The site's whole discovery hook is "Dungeon Crawler Carl" / "DCC" — those strings must stay in
crawlable text, not just in the prompts. They currently live in: `<title>`, meta description, OG +
Twitter tags, JSON-LD (`WebApplication` + `FAQPage`), the `.tagline` under the `<h1>`, and the
`<footer class="site-footer">` about + FAQ copy.

**`make seo` (or `npm run check:seo`) enforces all of this** — run it after touching `index.html`'s
head or footer. It fails on missing meta tags, a missing "Dungeon Crawler Carl"/"DCC" in visible copy,
unparseable JSON-LD, an FAQ answer that isn't on the page, a wrong-sized `og.png`, or a broken
robots/sitemap.

- **The visible FAQ and the `FAQPage` JSON-LD must stay in sync.** Google drops structured data whose
  answers don't appear on the page — silently. `make seo` compares them sentence by sentence, which is
  why the JSON-LD answers are verbatim copies of the footer text rather than paraphrases.
- **The fan-project disclaimer is load-bearing** — it names Matt Dinniman as rights holder and is the
  honest answer to "is this official?", which is also a real search query. Don't quietly drop it.
- **Regenerate `og.png`** from a 1200x630 HTML card via
  `chrome-shot --size 1200x630 -o public/og.png file:///path/to/card.html`. Social scrapers cache it
  hard — changing the image usually needs a cache-busting filename, not just a redeploy.

## Local Development

Requires a `.dev.vars` file (copy from `.dev.vars.example`):
```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-haiku-4.5
```

## Deployment

Hosted at https://achievements.carlkibler.com (CF Pages: https://dungeon-achievements.pages.dev)

Secrets stored in Cloudflare Pages dashboard (not in wrangler.toml).
