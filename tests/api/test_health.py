"""Smoke test: GET /health returns 200 with no auth."""

import pytest
from fastapi.testclient import TestClient

from api.main import app


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def test_health_200(client):
    response = client.get("/health")
    assert response.status_code == 200


def test_health_body(client):
    response = client.get("/health")
    body = response.json()
    assert body["status"] == "ok"
    assert "service" in body
