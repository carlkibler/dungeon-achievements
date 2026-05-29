# Dungeon Achievements

Generate three sarcastic, weirdly tender fake achievements in the voice of the trolling AI from [Dungeon Crawler Carl](https://www.amazon.com/dp/B08FT5T73G). Type what you did. Receive what you deserve.

**Live site:** https://achievements.carlkibler.com

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

## License

MIT
