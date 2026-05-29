.PHONY: dev deploy secret typecheck open help

help:
	@echo "dev       - local dev server (uses .dev.vars)"
	@echo "deploy    - deploy to Cloudflare Pages"
	@echo "secret    - set OPENROUTER_API_KEY in CF (prompts for value)"
	@echo "typecheck - run TypeScript type checking"
	@echo "open      - open the deployed site"

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
