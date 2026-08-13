.PHONY: dev deploy secret typecheck seo a11y open help

help:
	@echo "dev       - local dev server (uses .dev.vars)"
	@echo "deploy    - deploy to Cloudflare Pages"
	@echo "secret    - set OPENROUTER_API_KEY in CF (prompts for value)"
	@echo "typecheck - run TypeScript type checking"
	@echo "seo       - check metadata, DCC keywords, FAQ/JSON-LD sync, og.png"
	@echo "a11y      - axe + keyboard/focus + reflow checks (needs 'make dev' running)"
	@echo "open      - open the deployed site"

seo:
	node scripts/check-seo.mjs

# Needs a dev server on :8788. Run `make dev` in another terminal first.
a11y:
	node scripts/check-a11y.mjs

dev:
	npx wrangler pages dev public

deploy:
	CLOUDFLARE_API_TOKEN=$(shell security find-generic-password -a cloudflare -s dungeon-achievements-pages -w) npx wrangler pages deploy public

secret:
	npx wrangler pages secret put OPENROUTER_API_KEY

typecheck:
	npx tsc --noEmit

open:
	open https://dungeon-achievements.pages.dev
