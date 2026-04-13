"""Smoke test: api.main.app imports cleanly and has routes."""

from api.main import app


def test_app_imports():
    assert app is not None


def test_app_has_routes():
    assert len(app.routes) > 0


def test_app_title():
    assert "ManFriday" in app.title
