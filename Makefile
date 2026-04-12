.PHONY: dev test ingest compile lint validate-key deploy-staging

# ── Local dev ──────────────────────────────────────────────
dev:
	docker compose up --build

down:
	docker compose down -v

# ── Workers (one-shot) ─────────────────────────────────────
ingest:
	@test -n "$(URL)" || (echo "Usage: make ingest URL=https://..." && exit 1)
	python -m workers.ingest.main --url "$(URL)" --user-id "$${USER_ID:-test-user}"

compile:
	@test -n "$(USER_ID)" || (echo "Usage: make compile USER_ID=..." && exit 1)
	python -m workers.compile.main --user-id "$(USER_ID)"

lint:
	@test -n "$(USER_ID)" || (echo "Usage: make lint USER_ID=..." && exit 1)
	python -m workers.lint.main --user-id "$(USER_ID)"

validate-key:
	@test -n "$(PROVIDER)" || (echo "Usage: make validate-key PROVIDER=anthropic KEY=sk-..." && exit 1)
	python -m shared.python.manfriday_core.llm validate --provider "$(PROVIDER)" --key "$(KEY)"

# ── Tests ──────────────────────────────────────────────────
test:
	python3 -m pytest tests/ -v --tb=short

test-ingest:
	python3 -m pytest tests/workers/ingest/ -v

test-compile:
	python3 -m pytest tests/workers/compile/ -v

test-api:
	python3 -m pytest tests/api/ -v

# ── Deploy ─────────────────────────────────────────────────
deploy-staging:
	gcloud run deploy manfriday-api --source api/ --region us-central1 --project manfriday-staging
	gcloud run jobs deploy manfriday-ingest --source workers/ingest/ --region us-central1 --project manfriday-staging
	gcloud run jobs deploy manfriday-compile --source workers/compile/ --region us-central1 --project manfriday-staging
	gcloud run jobs deploy manfriday-lint --source workers/lint/ --region us-central1 --project manfriday-staging
