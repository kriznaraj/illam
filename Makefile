# Illam — dev helpers.
#
# `next dev` silently hops to the next free port when 3000 is taken, so a stray
# server leaves you editing one instance and looking at another. Every target
# here clears 3000-3002 first, so there is only ever one.

PORTS := 3000 3001 3002
PM    := pnpm

.PHONY: help dev dev-clean kill ports build test typecheck

help: ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2}'

kill: ## Stop anything listening on 3000-3002
	@pids=$$(lsof -ti:$(shell echo $(PORTS) | tr ' ' ',') 2>/dev/null); \
	if [ -n "$$pids" ]; then \
		echo "$$pids" | xargs kill -9 2>/dev/null || true; \
		echo "killed: $$(echo $$pids | tr '\n' ' ')"; \
	else \
		echo "nothing running on $(PORTS)"; \
	fi

ports: ## Show what is listening on 3000-3002
	@lsof -iTCP:$(shell echo $(PORTS) | tr ' ' ',') -sTCP:LISTEN -P -n 2>/dev/null \
		|| echo "nothing running on $(PORTS)"

dev: kill ## Run a single dev server on :3000
	@$(PM) run dev

# `npm run build` writes into the same .next the dev server is serving from, which
# leaves it 404ing its own chunks or throwing `__webpack_modules__ is not a
# function`. Wipe .next when that happens rather than debugging the app.
dev-clean: kill ## Wipe .next, then run a single dev server
	@$(PM) run dev:clean

build: ## Production build (runs the test suite first)
	@$(PM) run build

test: ## Run the test suite once
	@$(PM) run test:ci

typecheck: ## next.config.js ignores build errors, so check types explicitly
	@$(PM) exec tsc --noEmit
