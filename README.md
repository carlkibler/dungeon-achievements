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

## Deploy in 5 minutes (Cloudflare Pages)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and an [OpenRouter API key](https://openrouter.ai/keys) (pay-as-you-go, ~$0.001 per generation).

```bash
git clone https://github.com/carlkibler/dungeon-achievements
cd dungeon-achievements
npm install
```

Set your secrets:

```bash
npx wrangler pages secret put OPENROUTER_API_KEY
# paste your sk-or-... key when prompted
```

Deploy:

```bash
npm run deploy
```

That's it. Wrangler prints your `.pages.dev` URL. Add a custom domain in the Cloudflare dashboard if you want one.

---

## Local development

Copy the example env file and fill in your key:

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars: set OPENROUTER_API_KEY=sk-or-...
```

Start the dev server (uses the real Cloudflare Workers runtime locally):

```bash
npm run dev
# open http://localhost:8787
```

---

## Alternative: run as a plain Node server

No Cloudflare account required. Any host that runs Node works.

```bash
OPENROUTER_API_KEY=sk-or-... node --import tsx server.ts
# open http://localhost:8787
```

The Node server and the CF Pages Function share the same generation logic in `src/core.ts`.

---

## Use Cloudflare Workers AI instead of OpenRouter

If you want zero external API keys, Cloudflare's built-in AI works out of the box. Add an AI binding to `wrangler.toml`:

```toml
[ai]
binding = "AI"
```

Then deploy without setting `OPENROUTER_API_KEY`. The function will use `@cf/meta/llama-3.1-8b-instruct` automatically. To choose a different model, set `CF_AI_MODEL` as a Pages secret.

Workers AI has a free tier (10,000 neurons/day) and charges per use beyond that.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server at localhost:8787 |
| `npm run deploy` | Deploy to Cloudflare Pages |
| `npm run typecheck` | Type-check CF and Node configs |
| `npm run analytics` | Print a usage report (requires `CF_ACCOUNT_ID` in `.env`) |

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

**`public/index.html`** — add a pill button with a matching `data-style`:

```html
<button class="style-pill" data-style="noir">🌧️ Noir</button>
```

---

## Project layout

```
src/
  core.ts              Pure generation logic — prompts, moods, styles, parsing
functions/
  generate.ts          Cloudflare Pages Function (thin adapter over src/core.ts)
server.ts              Node.js HTTP adapter (same core, no CF dependency)
public/
  index.html           Entire frontend — HTML, CSS, JS, no build step
  fonts/               Self-hosted woff2 fonts
scripts/
  analytics-report.js  CLI analytics dashboard
  provision-token.js   Creates a scoped CF token for analytics
.dev.vars.example      Template for local secrets
wrangler.toml          Cloudflare Pages config
```

---

## Cost

Running this for personal use is nearly free.

- **Cloudflare Pages hosting:** free tier
- **OpenRouter (Claude 3.5 Haiku):** ~$0.001 per generation — 1,000 uses ≈ $1
- **Cloudflare Workers AI:** free up to 10k neurons/day, ~$0.01 per 1k after

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
