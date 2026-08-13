# Dungeon Achievements

Generate three sarcastic, weirdly tender fake achievements in the voice of the trolling AI from [Dungeon Crawler Carl](https://mattdinniman.com/books/dungeon-crawler-carl/). Type what you did. Receive what you deserve.

**Live site:** https://achievements.carlkibler.com

This is an unofficial fan project. *Dungeon Crawler Carl* belongs to Matt Dinniman.

---

## News

**June 2026 — Peacock ordered a live-action *Dungeon Crawler Carl* series.** Universal International Studios and Seth MacFarlane's Fuzzy Door Productions are producing; Christopher Yost is writing; Matt Dinniman is an executive producer. Jeff Hays, who narrates the audiobooks, is voicing Princess Donut. Live-action casting is still ongoing and no premiere date has been announced. The project was first announced in August 2024 and went to series in June 2026.

- [Variety — series lands at Peacock](https://variety.com/2026/tv/news/dungeon-crawler-carl-tv-series-peacock-seth-macfarlane-1236705436/)
- [Deadline — series order](https://deadline.com/2026/06/dungeon-crawler-carl-tv-series-peacock-seth-macfarlane-matt-dinniman-1236962525/)
- [Peacock — everything to know](https://www.peacocktv.com/blog/dungeon-crawler-carl-tv-series-peacock)

Book eight, *A Parade of Horribles*, landed in 2026.

---

## Run your own copy

You need [Node](https://nodejs.org/) 22 or newer (wrangler requires it), a free [Cloudflare account](https://dash.cloudflare.com/sign-up), and an [OpenRouter API key](https://openrouter.ai/keys) (pay-as-you-go, ~$0.001 per generation). You can skip OpenRouter entirely — see [Workers AI](#use-cloudflare-workers-ai-instead-of-openrouter) below.

**1. Clone and install**

```bash
git clone https://github.com/carlkibler/dungeon-achievements
cd dungeon-achievements
npm install
```

**2. Run it locally**

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars: set OPENROUTER_API_KEY=sk-or-...

npm run dev
# open http://localhost:8788
```

This uses `workerd`, the same runtime Cloudflare runs in production, so local behaviour matches the deployed site.

**3. Deploy it**

```bash
npx wrangler login                                # one-time browser auth
npx wrangler pages project create dungeon-achievements   # first deploy only
npx wrangler pages secret put OPENROUTER_API_KEY  # paste your sk-or-... key
npm run deploy
```

Wrangler prints your `.pages.dev` URL. Add a custom domain in the Cloudflare dashboard under **Workers & Pages → your project → Custom domains**.

> Deploying from CI instead? Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment and skip `wrangler login`. The token needs **Cloudflare Pages: Edit**.

**4. Make it yours**

If you publish your own copy, change these so it doesn't claim to be mine:

| Where | What to change |
|---|---|
| `public/index.html` `<head>` | `<title>`, `<meta name="description">`, `<link rel="canonical">`, and every `og:`/`twitter:` URL |
| `public/index.html` JSON-LD | `url`, `@id`s, and the `author` name |
| `public/index.html` footer | The colophon paragraph — attribution and repo link |
| `public/robots.txt`, `public/sitemap.xml` | Your domain |
| `public/og.png` | Your own 1200×630 social card |
| `wrangler.toml` | `name` (the Pages project name) |

Keep the "unofficial fan project" disclaimer. *Dungeon Crawler Carl* is Matt Dinniman's, and a fan project should say so plainly.

---

## How it works, and the one thing to watch

`POST /generate` takes `{ activity, style?, recentTitles? }` and returns three achievements, each with a title, a description, and a reward. Variety is server-side: every request rolls a mood and a seed phrase, and recent titles become a forbidden-words list so the AI stops reaching for the same jokes.

Generation tries three providers in order:

```
OpenRouter  →  Cloudflare Workers AI  →  canned achievements
```

**The endpoint never returns a 5xx for an AI failure.** If every provider fails it returns HTTP 200 with hardcoded achievements and `"degraded": true`. That keeps the site pleasant when a model is down, but it means **an uptime check cannot detect an outage here** — a completely broken site still answers 200 with plausible JSON. This exact blind spot hid a full outage on the live site for eleven weeks.

If you self-host, monitor the flag, not the status code:

```bash
curl -s -X POST https://your-site.example/generate \
  -H 'content-type: application/json' \
  -d '{"activity":"canary"}' | jq .degraded    # want: false
```

`.github/workflows/` has a daily canary that does exactly this.

---

## Accessibility

The site is built to work with a keyboard and a screen reader, and `npm run check:a11y` enforces it — axe-core for static rules, plus behavioural tests for the things axe can't see.

- Skip link, `<main>` landmark, and a heading outline with no skipped levels
- Focus moves to the results heading when achievements arrive, so a keyboard user isn't stranded on the Generate button
- The style picker is an ARIA radiogroup: one Tab stop, arrow keys to move
- One polite live region announces progress, results, and copies; the loading animation is `aria-hidden` so its rotating text can't interrupt on a loop
- Action buttons carry unique labels naming their achievement, instead of a dozen identical "Copy"s
- Visible focus rings, WCAG AA contrast throughout, `prefers-reduced-motion` respected
- Reflows to 320px with no horizontal scrolling, which is also the 400%-zoom test

If you change markup, focus handling, or layout, run the check. Most of these fail silently — a broken live region or a lost focus target looks completely fine on screen.

---

## Alternative: run the API on plain Node

No Cloudflare account required. Any host that runs Node works.

```bash
OPENROUTER_API_KEY=sk-or-... npm run serve:node
# POST http://localhost:8787/generate
```

It shares the generation logic in `src/core.ts` with the Pages Function, but it is **an API server only** — it answers `POST /generate` and nothing else. `GET /` returns a JSON 404. To use the frontend against it, serve `public/` with any static server and point `API_BASE` in `index.html` at this port.

It also **does not implement the Workers AI fallback or the `degraded` flag** — those live in the Pages Function. If you deploy this way, you lose the outage signal described above.

---

## Use Cloudflare Workers AI instead of OpenRouter

If you want zero external API keys, Cloudflare's built-in AI works out of the box. Add an AI binding to `wrangler.toml`:

```toml
[ai]
binding = "AI"
```

Then deploy without setting `OPENROUTER_API_KEY`. The function falls back to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` automatically. To choose a different model, set `CF_AI_MODEL` as a Pages secret.

Workers AI has a free tier (10,000 neurons/day) and charges per use beyond that. Note that the **Workers Free plan cannot use premium models** — those return an availability error rather than falling back, so check the [model catalog](https://developers.cloudflare.com/workers-ai/models/) before switching.

Model slugs rot. Both providers have retired one out from under this project, and the symptom is generic-sounding output rather than an error — the fallback chain hides it. Watch the `degraded` flag (below) rather than trusting uptime.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server at localhost:8788 |
| `npm run deploy` | Deploy to Cloudflare Pages |
| `npm test` | Unit tests for the generation core (vitest) |
| `npm run typecheck` | Type-check CF and Node configs |
| `npm run check:seo` | Metadata, DCC keywords, FAQ/JSON-LD sync, og.png, robots, sitemap |
| `npm run check:a11y` | axe-core + keyboard/focus + reflow (needs `npm run dev` running) |
| `npm run analytics` | Print a usage report (requires `CF_ACCOUNT_ID` in `.env`) |

`make` wraps the same things (`make dev`, `make deploy`, `make seo`, `make a11y`, `make help`).

`check:a11y` needs a browser binary once: `npx playwright install chromium`.

---

## Dependencies

Every version in `package.json` is pinned exactly, and that's deliberate. `scripts/check-deps-age.js` runs on `postinstall` and refuses any package published less than 14 days ago — a small hedge against a compromised release being pulled in the hour it lands.

A caret range is in permanent conflict with that rule: npm re-resolves to the newest match on every install, and the newest match is always too fresh. The `overrides` block holds transitive dependencies at their newest cooldown-clearing release for the same reason.

To upgrade something, find a version at least 14 days old and pin it exactly:

```bash
npm view vite time --json     # publish dates for every version
```

`wrangler` and `@cloudflare/workers-types` must move together — wrangler declares the matching types package as a peer dependency, and mismatched majors fail the install outright.

Set `CI=1` to skip the cooldown check in automated environments.

---

## Adding a style

Two files, one change each.

**`src/core.ts`** — add a key to `STYLES`:

```ts
export const STYLES: Record<string, string> = {
    // ...existing styles...
    noir: `Hard-boiled detective monologue. Rain. Regret. The city never sleeps and neither does your shame.`,
};
```

**`public/index.html`** — add a pill button with a matching `data-style`. The picker is an ARIA radiogroup, so the extra attributes aren't optional: `tabindex="-1"` keeps the group to a single Tab stop, and the emoji is hidden so a screen reader announces "Noir" rather than "cloud with rain Noir".

```html
<button type="button" class="style-pill" role="radio" aria-checked="false" tabindex="-1"
        data-style="noir"><span aria-hidden="true">🌧️</span> Noir</button>
```

`npm run check:a11y` will catch it if you forget.

---

## Project layout

```
src/
  core.ts              Pure generation logic — prompts, moods, styles, parsing
  core.test.ts         Unit tests for the provider fallback chain and parsing
functions/
  generate.ts          Cloudflare Pages Function (thin adapter over src/core.ts)
server.ts              Node.js HTTP adapter (same core, no CF dependency)
public/
  index.html           Entire frontend — HTML, CSS, JS, no build step
  fonts/               Self-hosted woff2 fonts (no CDN requests)
  og.png               1200x630 social card
  robots.txt           Crawl rules; points at the sitemap
  sitemap.xml          One URL, for search engines
scripts/
  check-seo.mjs        Guards metadata, DCC keywords, FAQ/JSON-LD sync
  check-a11y.mjs       axe-core + keyboard/focus + reflow checks
  check-deps-age.js    Refuses dependencies published in the last 14 days
  analytics-report.js  CLI analytics dashboard
  provision-token.js   Creates a scoped CF token for analytics
corpus/                Source-linked DCC achievements used to tune the prompt
prompts/               Reference snapshots — NOT loaded at runtime
docs/                  Design notes and prompt-refinement history
.dev.vars.example      Template for local secrets
wrangler.toml          Cloudflare Pages config
```

Everything the browser runs lives in one file. There is no build step, no bundler, and no CDN request — the fonts are self-hosted and the JS is inline.

---

## Cost

Running this for personal use is nearly free.

- **Cloudflare Pages hosting:** free tier
- **OpenRouter (Claude Haiku 4.5, the default):** ~$0.001 per generation — 1,000 uses ≈ $1
- **Cloudflare Workers AI:** free up to 10k neurons/day, ~$0.01 per 1k after

There is no database and no accounts. Recent generations live in the visitor's own browser via LocalStorage, which is also why there's nothing to leak.

---

## Resources

Everything this project is a love letter to, in one place.

### Books and author

| Link | What it is |
|---|---|
| [mattdinniman.com](https://mattdinniman.com/) | Matt Dinniman's official site |
| [Dungeon Crawler Carl — book one](https://mattdinniman.com/books/dungeon-crawler-carl/) | Where to start |
| [Wikipedia: Dungeon Crawler Carl](https://en.wikipedia.org/wiki/Dungeon_Crawler_Carl) | Series overview, book list, adaptation history |
| [Goodreads series page](https://www.goodreads.com/series/309211-dungeon-crawler-carl) | Reading order and reviews |

### Audio

| Link | What it is |
|---|---|
| [The Dungeon Crawler Carl audiobooks](https://www.audible.com/series/Dungeon-Crawler-Carl-Audiobooks/B0937JMKYV) | Audible series page — Jeff Hays solo, every book |
| [Full cinematic versions](https://soundbooth.app/dungeon-crawler-carl) | The Audio Immersion Tunnel on Soundbooth — full cast, original score, sound design, bonus material. One season per book. Exclusive to Soundbooth |
| [Dungeon Crawler Carl audio experience](https://soundbooththeater.com/the-apocalypse-will-be-televised/) | Soundbooth Theater's landing page comparing both versions |
| [Soundbooth Theater — DCC series](https://soundbooththeater.com/series/dungeon-crawler-carl/) | Episode-by-episode catalog, vinyl, USB-cassette edition |

### People

| Link | Who |
|---|---|
| [Jeff Hays](https://soundbooththeater.com/team/jeff-hays/) | Narrator of the whole series and founder of [Soundbooth Theater](https://soundbooththeater.com/); voices Carl, Donut, and the System AI |
| [Andrea Parsneau](https://www.andreaparsneau.com/) | Immersion Tunnel cast |
| [Travis Baldree](https://www.travisbaldree.com/) | Immersion Tunnel cast; narrator and author of *Legends & Lattes* |
| [Heath Miller](https://www.heathmiller.net/) | Immersion Tunnel cast |
| [Johnathan McClain](https://www.johnathanmcclain.com/) | Immersion Tunnel cast |

### This project

| Link | What it is |
|---|---|
| [achievements.carlkibler.com](https://achievements.carlkibler.com) | The live site |
| [OpenRouter models](https://openrouter.ai/models) | Pick the model behind `OPENROUTER_MODEL` |
| [Cloudflare Workers AI models](https://developers.cloudflare.com/workers-ai/models/) | The no-key fallback provider |

---

## License

MIT — code only. Nothing here is licensed from or endorsed by Matt Dinniman or his publishers.
