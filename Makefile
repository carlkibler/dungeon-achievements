.PHONY: dev deploy secret typecheck seo a11y style vendor open help

help:
	@echo "dev       - local dev server (uses .dev.vars)"
	@echo "deploy    - deploy to Cloudflare Pages"
	@echo "secret    - set OPENROUTER_API_KEY in CF (prompts for value)"
	@echo "typecheck - run TypeScript type checking"
	@echo "seo       - check metadata, DCC keywords, FAQ/JSON-LD sync, og.png"
	@echo "a11y      - axe + keyboard/focus + reflow checks (needs 'make dev' running)"
	@echo "style     - sample real generations and measure achievement length (costs API calls)"
	@echo "vendor    - check public/vendor/ matches the pinned package"
	@echo "open      - open the deployed site"

seo:
	node scripts/check-seo.mjs

vendor:
	node scripts/check-vendor.mjs

# Needs a dev server on :8788. Run `make dev` in another terminal first.
a11y:
	node scripts/check-a11y.mjs

style:
	node --experimental-strip-types scripts/check-style.mjs

dev:
	npx wrangler pages dev public

# Deploys with the project token from .dev.vars, the same file `make dev` reads.
#
# Exporting it here is not optional. A CLOUDFLARE_API_TOKEN exported globally from a
# shell profile will otherwise win, and a token without Pages:Edit fails as an
# "Authentication error [code: 10000]" against the projects endpoint — which reads as a
# broken account, not as the wrong credential. The preflight below says which it is.
deploy:
	@if [ ! -f .dev.vars ]; then \
		echo "No .dev.vars. Copy .dev.vars.example and set CLOUDFLARE_API_TOKEN (needs Pages:Edit),"; \
		echo "or run 'npm run deploy' to use an existing 'wrangler login' session."; \
		exit 1; \
	fi; \
	unset CLOUDFLARE_API_TOKEN; \
	set -a; . ./.dev.vars; set +a; \
	if [ -z "$$CLOUDFLARE_API_TOKEN" ]; then \
		echo "No CLOUDFLARE_API_TOKEN in .dev.vars. Add one with Cloudflare Pages:Edit,"; \
		echo "or run 'npm run deploy' to use an existing 'wrangler login' session."; \
		exit 1; \
	fi; \
	curl -sS https://api.cloudflare.com/client/v4/user/tokens/verify \
		-H "Authorization: Bearer $$CLOUDFLARE_API_TOKEN" | grep -q '"success":true' || { \
		echo "The CLOUDFLARE_API_TOKEN in .dev.vars is not valid. Rotate it in the CF dashboard."; \
		exit 1; \
	}; \
	export CLOUDFLARE_API_TOKEN; \
	npx wrangler pages deploy public

secret:
	npx wrangler pages secret put OPENROUTER_API_KEY

typecheck:
	npx tsc --noEmit

open:
	open https://dungeon-achievements.pages.dev
