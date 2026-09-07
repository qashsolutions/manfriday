"""Shared Convex client for the worker + pipeline CLI."""
from convex import ConvexClient

from config import CONVEX_URL, WORKER_TOKEN

client = ConvexClient(CONVEX_URL)


def mutation(name: str, args: dict | None = None):
    return client.mutation(name, {"token": WORKER_TOKEN, **(args or {})})


def query(name: str, args: dict | None = None):
    return client.query(name, {"token": WORKER_TOKEN, **(args or {})})
