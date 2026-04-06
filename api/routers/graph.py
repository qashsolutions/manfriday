"""Graph router — world model graph API endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth import get_current_user
from shared.python.manfriday_core.gcs import read_text, exists, user_path
from workers.compile.graph_schema import WikiGraph

router = APIRouter()


def _load_graph(user_id: str) -> WikiGraph:
    """Load graph.json for a user, or return empty graph."""
    graph_path = user_path(user_id, "wiki", "graph.json")
    if not exists(graph_path):
        return WikiGraph()
    raw = read_text(graph_path)
    return WikiGraph.from_json(raw)


@router.get("")
async def get_graph(user: dict = Depends(get_current_user)):
    """Return the full world model graph for the authenticated user."""
    graph = _load_graph(user["user_id"])
    return graph.to_dict()


@router.get("/entity/{name}")
async def get_entity(name: str, user: dict = Depends(get_current_user)):
    """Return a single entity with all its relationships."""
    graph = _load_graph(user["user_id"])
    entity = graph.get_entity(name)
    if entity is None:
        raise HTTPException(status_code=404, detail=f"Entity not found: {name}")

    relationships = graph.get_relationships_for(name)
    return {
        "entity": {
            "id": entity.id,
            "name": entity.name,
            "type": entity.type,
            "confidence": entity.confidence,
            "first_mention": entity.first_mention,
            "appearances": entity.appearances,
        },
        "relationships": [
            {
                "source": r.source,
                "target": r.target,
                "type": r.type,
                "confidence": r.confidence,
                "source_page": r.source_page,
            }
            for r in relationships
        ],
    }


@router.get("/neighbors/{name}")
async def get_neighbors(
    name: str,
    depth: int = Query(default=1, ge=1, le=5),
    user: dict = Depends(get_current_user),
):
    """Return the N-hop neighborhood subgraph around an entity."""
    graph = _load_graph(user["user_id"])
    if graph.get_entity(name) is None:
        raise HTTPException(status_code=404, detail=f"Entity not found: {name}")

    subgraph = graph.get_neighbors(name, depth=depth)
    return subgraph.to_dict()
