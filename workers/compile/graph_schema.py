"""Graph data model — dataclasses for the world model graph.

Entities, relationships, and the top-level WikiGraph with JSON serialization.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from typing import Any


RELATIONSHIP_TYPES = frozenset({
    "creates",
    "uses",
    "extends",
    "competes_with",
    "part_of",
    "influences",
    "authored_by",
})

ENTITY_TYPES = frozenset({
    "person",
    "org",
    "project",
    "concept",
})


@dataclass
class GraphEntity:
    """A node in the world model graph."""

    id: str  # slug-form, e.g. "openai" or "transformer-architecture"
    name: str  # human-readable, e.g. "OpenAI" or "Transformer Architecture"
    type: str  # person | org | project | concept
    confidence: float = 1.0
    first_mention: str = ""  # ISO date YYYY-MM-DD
    appearances: int = 1  # how many wiki pages mention this entity

    def __post_init__(self) -> None:
        if self.type not in ENTITY_TYPES:
            raise ValueError(f"Invalid entity type '{self.type}'. Must be one of {ENTITY_TYPES}")


@dataclass
class GraphRelationship:
    """An edge in the world model graph."""

    source: str  # entity id
    target: str  # entity id
    type: str  # one of RELATIONSHIP_TYPES
    confidence: float = 0.8
    source_page: str = ""  # wiki page slug where this relationship was extracted

    def __post_init__(self) -> None:
        if self.type not in RELATIONSHIP_TYPES:
            raise ValueError(
                f"Invalid relationship type '{self.type}'. Must be one of {RELATIONSHIP_TYPES}"
            )


@dataclass
class WikiGraph:
    """Top-level world model graph: entities + relationships."""

    entities: dict[str, GraphEntity] = field(default_factory=dict)
    relationships: list[GraphRelationship] = field(default_factory=list)

    # ── Mutations ──────────────────────────────────────────

    def add_entity(self, entity: GraphEntity) -> None:
        """Add or merge an entity. If it already exists, increment appearances."""
        if entity.id in self.entities:
            existing = self.entities[entity.id]
            existing.appearances += entity.appearances
            # Keep higher confidence
            existing.confidence = max(existing.confidence, entity.confidence)
        else:
            self.entities[entity.id] = entity

    def add_relationship(self, rel: GraphRelationship) -> None:
        """Add a relationship if it doesn't duplicate an existing one."""
        for existing in self.relationships:
            if (
                existing.source == rel.source
                and existing.target == rel.target
                and existing.type == rel.type
            ):
                # Update confidence to max
                existing.confidence = max(existing.confidence, rel.confidence)
                return
        self.relationships.append(rel)

    # ── Query helpers ──────────────────────────────────────

    def get_entity(self, entity_id: str) -> GraphEntity | None:
        return self.entities.get(entity_id)

    def get_relationships_for(self, entity_id: str) -> list[GraphRelationship]:
        """Return all relationships where entity is source or target."""
        return [
            r
            for r in self.relationships
            if r.source == entity_id or r.target == entity_id
        ]

    def get_neighbors(self, entity_id: str, depth: int = 1) -> WikiGraph:
        """Return a subgraph of N-hop neighbors around an entity."""
        visited: set[str] = set()
        frontier: set[str] = {entity_id}

        for _ in range(depth):
            next_frontier: set[str] = set()
            for eid in frontier:
                if eid in visited:
                    continue
                visited.add(eid)
                for rel in self.get_relationships_for(eid):
                    neighbor = rel.target if rel.source == eid else rel.source
                    if neighbor not in visited:
                        next_frontier.add(neighbor)
            frontier = next_frontier

        visited.update(frontier)

        sub_entities = {eid: self.entities[eid] for eid in visited if eid in self.entities}
        sub_rels = [
            r
            for r in self.relationships
            if r.source in visited and r.target in visited
        ]
        return WikiGraph(entities=sub_entities, relationships=sub_rels)

    # ── Serialization ──────────────────────────────────────

    def to_json(self) -> str:
        """Serialize to JSON string."""
        data: dict[str, Any] = {
            "entities": {eid: asdict(e) for eid, e in self.entities.items()},
            "relationships": [asdict(r) for r in self.relationships],
        }
        return json.dumps(data, indent=2, default=str)

    @classmethod
    def from_json(cls, raw: str) -> WikiGraph:
        """Deserialize from JSON string."""
        data = json.loads(raw)
        entities = {
            eid: GraphEntity(**edata)
            for eid, edata in data.get("entities", {}).items()
        }
        relationships = [
            GraphRelationship(**rdata)
            for rdata in data.get("relationships", [])
        ]
        return cls(entities=entities, relationships=relationships)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict (for JSON responses)."""
        return json.loads(self.to_json())
