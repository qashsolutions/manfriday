"""Smoke test: every writer in workers/compile/ imports without error."""

import importlib
import pytest

COMPILE_MODULES = [
    "workers.compile.article_writer",
    "workers.compile.entity_writer",
    "workers.compile.concept_writer",
    "workers.compile.index_writer",
    "workers.compile.log_writer",
    "workers.compile.backlinks",
    "workers.compile.write_guard",
    "workers.compile.lint_queue",
    "workers.compile.schema_writer",
    "workers.compile.output_ingester",
    "workers.compile.playbook_writer",
    "workers.compile.embed_writer",
    "workers.compile.graph_builder",
    "workers.compile.graph_schema",
]


@pytest.mark.parametrize("module_path", COMPILE_MODULES)
def test_compile_module_importable(module_path):
    mod = importlib.import_module(module_path)
    assert mod is not None


def test_write_guard_validates_wiki_path():
    from workers.compile.write_guard import validate_write_path
    # Should not raise
    validate_write_path("user-123", "user-123/wiki/articles/foo.md")


def test_write_guard_blocks_raw_path():
    from workers.compile.write_guard import validate_write_path, WriteGuardError
    with pytest.raises(WriteGuardError):
        validate_write_path("user-123", "user-123/raw/source.md")


def test_write_guard_blocks_wrong_user():
    from workers.compile.write_guard import validate_write_path, WriteGuardError
    with pytest.raises(WriteGuardError):
        validate_write_path("user-123", "other-user/wiki/page.md")


def test_graph_schema_entity_valid():
    from workers.compile.graph_schema import GraphEntity
    e = GraphEntity(id="openai", name="OpenAI", type="org")
    assert e.appearances == 1


def test_graph_schema_entity_invalid_type():
    from workers.compile.graph_schema import GraphEntity
    with pytest.raises(ValueError):
        GraphEntity(id="x", name="X", type="invalid_type")


def test_graph_schema_wikigraph_add_entity():
    from workers.compile.graph_schema import GraphEntity, WikiGraph
    g = WikiGraph()
    e = GraphEntity(id="anthropic", name="Anthropic", type="org")
    g.add_entity(e)
    assert "anthropic" in g.entities


def test_graph_schema_wikigraph_dedup_relationship():
    from workers.compile.graph_schema import GraphEntity, GraphRelationship, WikiGraph
    g = WikiGraph()
    r1 = GraphRelationship(source="a", target="b", type="uses")
    r2 = GraphRelationship(source="a", target="b", type="uses", confidence=0.9)
    g.add_relationship(r1)
    g.add_relationship(r2)
    assert len(g.relationships) == 1
    assert g.relationships[0].confidence == 0.9


def test_graph_schema_serialization_roundtrip():
    from workers.compile.graph_schema import GraphEntity, WikiGraph
    g = WikiGraph()
    g.add_entity(GraphEntity(id="foo", name="Foo", type="concept"))
    json_str = g.to_json()
    g2 = WikiGraph.from_json(json_str)
    assert "foo" in g2.entities
