# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Serverless web app that generates amusing fake achievements in the style of the trolling AI from "Dungeon Crawler Carl". Users enter any activity and receive three creative achievements with copy-to-clipboard and local storage for recent generations.

## Architecture

**Cloudflare Pages + OpenRouter:**
- **`public/index.html`** — Single-page frontend (vanilla HTML/CSS/JS, no build step)
- **`functions/generate.ts`** — Cloudflare Pages Function handling POST `/generate`
- **OpenRouter** — AI provider; model switchable via `OPENROUTER_MODEL` env var (default: `anthropic/claude-3-5-haiku`)

**Key Design Decisions:**
- No database — achievements stored in browser LocalStorage
- Vanilla frontend, zero build complexity
- Prompts inlined in `functions/generate.ts` (CF Workers have no filesystem access)
- `prompts/` directory kept as source-of-truth reference for prompt editing

## Commands

```bash
make dev        # local dev server (reads .dev.vars)
make deploy     # deploy to Cloudflare Pages
make secret     # set OPENROUTER_API_KEY in CF
make typecheck  # TypeScript type checking
make open       # open https://dungeon-achievements.pages.dev
```

## Project Structure

```
public/
└── index.html          # Frontend with embedded CSS/JS
functions/
└── generate.ts         # CF Pages Function — calls OpenRouter API
prompts/
├── config.json         # Style registry (reference only, not loaded at runtime)
├── base-template.md    # Base prompt template (reference)
└── styles/             # Per-style prompt files (reference)
wrangler.toml           # Cloudflare Pages config
.dev.vars               # Local secrets (gitignored)
.dev.vars.example       # Template for .dev.vars
Makefile                # Dev shortcuts
```

## Adding New Features

**New style:** Add the style instruction string to the `STYLES` object in `functions/generate.ts`, add a pill button in `public/index.html`, and add a reference file in `prompts/styles/`.

**Switch AI model:** Change `OPENROUTER_MODEL` secret in Cloudflare dashboard, or locally in `.dev.vars`. Browse models at https://openrouter.ai/models.

**Custom domain:** Add via Cloudflare Pages dashboard → Custom domains.

## Local Development

Requires a `.dev.vars` file (copy from `.dev.vars.example`):
```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-3-5-haiku
```

## Deployment

Hosted at https://achievements.carlkibler.com (CF Pages: https://dungeon-achievements.pages.dev)

Secrets stored in Cloudflare Pages dashboard (not in wrangler.toml).
