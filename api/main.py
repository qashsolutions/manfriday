"""ManFriday API — FastAPI gateway (Cloud Run Service)."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import ingest, compile, qa, wiki, outputs, sources, memory, schema, health, search

app = FastAPI(
    title="ManFriday API",
    version="0.1.0",
    description="Personal LLM knowledge base gateway",
)

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
