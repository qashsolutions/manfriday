"""ManFriday API — FastAPI gateway (Cloud Run Service)."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import ingest, compile, qa, wiki, outputs, sources, memory, schema, health, search, stripe, connectors, billing, graph
from api.middleware.security import CSPHeadersMiddleware, install_log_redaction

# Install log redaction BEFORE anything else logs
install_log_redaction()

app = FastAPI(
    title="ManFriday API",
    version="0.1.0",
    description="Personal LLM knowledge base gateway",
)

# Security headers (CSP, X-Frame-Options, etc.)
app.add_middleware(CSPHeadersMiddleware)

# CORS for web client
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://manfriday.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(health.router, tags=["health"])
app.include_router(ingest.router, prefix="/ingest", tags=["ingest"])
app.include_router(compile.router, prefix="/compile", tags=["compile"])
app.include_router(qa.router, prefix="/qa", tags=["qa"])
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(wiki.router, prefix="/wiki", tags=["wiki"])
app.include_router(outputs.router, prefix="/outputs", tags=["outputs"])
app.include_router(sources.router, prefix="/sources", tags=["sources"])
app.include_router(memory.router, prefix="/memory", tags=["memory"])
app.include_router(schema.router, prefix="/schema", tags=["schema"])
app.include_router(stripe.router, tags=["stripe"])
app.include_router(billing.router, prefix="/billing", tags=["billing"])
app.include_router(connectors.router, prefix="/connectors", tags=["connectors"])
app.include_router(graph.router, prefix="/graph", tags=["graph"])

# Top-level /file-back endpoint (spec requires this at root, not nested under /outputs)
from fastapi import Depends
from api.middleware.auth import get_current_user
from api.models.requests import FileBackRequest
from api.routers.outputs import file_back as _file_back


@app.post("/file-back", tags=["outputs"])
async def file_back_root(req: FileBackRequest, user: dict = Depends(get_current_user)):
    return await _file_back(req, user)


# Top-level /suppressed, /validate-key, /settings/providers endpoints (spec requires root, not under /sources)
from api.models.requests import ValidateKeyRequest
from api.routers.sources import list_suppressed as _list_suppressed
from api.routers.sources import restore_suppressed as _restore_suppressed
from api.routers.sources import validate_api_key as _validate_key
from api.routers.sources import get_providers as _get_providers


@app.get("/suppressed", tags=["sources"])
async def suppressed_root(user: dict = Depends(get_current_user)):
    return await _list_suppressed(user)


@app.post("/suppressed/{slug}/restore", tags=["sources"])
async def restore_suppressed_root(slug: str, user: dict = Depends(get_current_user)):
    return await _restore_suppressed(slug, user)


@app.post("/validate-key", tags=["sources"])
async def validate_key_root(req: ValidateKeyRequest, user: dict = Depends(get_current_user)):
    return await _validate_key(req, user)


@app.get("/settings/providers", tags=["settings"])
async def settings_providers_root(user: dict = Depends(get_current_user)):
    return await _get_providers(user)
