"""Smoke test: every router in api/routers/ imports without error and exposes a router object."""

import importlib
import pytest

ROUTER_MODULES = [
    "api.routers.billing",
    "api.routers.compile",
    "api.routers.connectors",
    "api.routers.graph",
    "api.routers.health",
    "api.routers.ingest",
    "api.routers.memory",
    "api.routers.outputs",
    "api.routers.qa",
    "api.routers.schema",
    "api.routers.search",
    "api.routers.sources",
    "api.routers.stripe",
    "api.routers.wiki",
]


@pytest.mark.parametrize("module_path", ROUTER_MODULES)
def test_router_importable(module_path):
    mod = importlib.import_module(module_path)
    assert hasattr(mod, "router"), f"{module_path} has no 'router' attribute"


@pytest.mark.parametrize("module_path", ROUTER_MODULES)
def test_router_has_routes(module_path):
    mod = importlib.import_module(module_path)
    assert len(mod.router.routes) > 0, f"{module_path}.router has no routes"
