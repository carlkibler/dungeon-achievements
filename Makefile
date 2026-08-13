.PHONY: dev deploy secret typecheck seo a11y vendor open help

help:
	@echo "dev       - local dev server (uses .dev.vars)"
	@echo "deploy    - deploy to Cloudflare Pages"
	@echo "secret    - set OPENROUTER_API_KEY in CF (prompts for value)"
	@echo "typecheck - run TypeScript type checking"
	@echo "seo       - check metadata, DCC keywords, FAQ/JSON-LD sync, og.png"
	@echo "a11y      - axe + keyboard/focus + reflow checks (needs 'make dev' running)"
	@echo "vendor    - check public/vendor/ matches the pinned package"
	@echo "open      - open the deployed site"

seo:
	node scripts/check-seo.mjs

vendor:
	node scripts/check-vendor.mjs

# Needs a dev server on :8788. Run `make dev` in another terminal first.
a11y:
	node scripts/check-a11y.mjs

dev:
	npx wrangler pages dev public

# Uses the project deploy token from the macOS Keychain when it's there, and falls
# back to whatever wrangler already has (`wrangler login`, or CLOUDFLARE_API_TOKEN).
deploy:
	CLOUDFLARE_API_TOKEN=$(shell security find-generic-password -a cloudflare -s dungeon-achievements-pages -w 2>/dev/null) npx wrangler pages deploy public

secret:
	npx wrangler pages secret put OPENROUTER_API_KEY

typecheck:
	npx tsc --noEmit

open:
	open https://dungeon-achievements.pages.dev
