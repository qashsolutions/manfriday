"""Secret Manager client for ManFriday.

BYOK keys stored as: byok-{provider}-{user_id}
Supports GCP Secret Manager in prod; env vars in local dev.
"""

from __future__ import annotations

import os

ENV = os.getenv("ENV", "development")
GCP_PROJECT = os.getenv("GCP_PROJECT", "manfriday-prod")


def _secret_name(provider: str, user_id: str) -> str:
    return f"byok-{provider}-{user_id}"


def get_byok_key(provider: str, user_id: str) -> str:
    """Retrieve user's BYOK API key for the given provider.

    In development: reads from env var BYOK_{PROVIDER}_{USER_ID} or BYOK_{PROVIDER}.
    In production: reads from GCP Secret Manager.
    """
    if ENV == "development":
        # Try user-specific first, then provider-level fallback
        env_key = f"BYOK_{provider.upper()}_{user_id.replace('-', '_').upper()}"
        key = os.getenv(env_key) or os.getenv(f"BYOK_{provider.upper()}")
        if not key:
            raise ValueError(f"No BYOK key found. Set {env_key} or BYOK_{provider.upper()}")
        return key

    from google.cloud import secretmanager

    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{GCP_PROJECT}/secrets/{_secret_name(provider, user_id)}/versions/latest"
    response = client.access_secret_version(request={"name": name})
    return response.payload.data.decode("utf-8")


def store_byok_key(provider: str, user_id: str, key: str) -> None:
    """Store user's BYOK API key.

    In development: prints a warning (use env vars).
    In production: creates/updates GCP Secret Manager secret.
    """
    if ENV == "development":
        print(f"[dev] Would store BYOK key for {provider}/{user_id} — use env vars locally")
        return

    from google.cloud import secretmanager

    client = secretmanager.SecretManagerServiceClient()
    secret_id = _secret_name(provider, user_id)
    parent = f"projects/{GCP_PROJECT}"

    # Create secret if it doesn't exist
    try:
        client.create_secret(
            request={
                "parent": parent,
                "secret_id": secret_id,
                "secret": {"replication": {"automatic": {}}},
            }
        )
    except Exception:
        pass  # Secret already exists

    # Add new version
    secret_path = f"{parent}/secrets/{secret_id}"
    client.add_secret_version(
        request={"parent": secret_path, "payload": {"data": key.encode("utf-8")}}
    )


def delete_byok_key(provider: str, user_id: str) -> None:
    """Delete user's BYOK key from Secret Manager."""
    if ENV == "development":
        return

    from google.cloud import secretmanager

    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{GCP_PROJECT}/secrets/{_secret_name(provider, user_id)}"
    client.delete_secret(request={"name": name})
