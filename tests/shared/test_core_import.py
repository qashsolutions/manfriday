"""Smoke test: shared/python/manfriday_core/ modules import without error."""

import importlib
import pytest

CORE_MODULES = [
    "shared.python.manfriday_core.gcs",
    "shared.python.manfriday_core.secrets",
    "shared.python.manfriday_core.llm",
    "shared.python.manfriday_core.pgvector",
]


@pytest.mark.parametrize("module_path", CORE_MODULES)
def test_core_module_importable(module_path):
    mod = importlib.import_module(module_path)
    assert mod is not None


def test_gcs_user_path():
    from shared.python.manfriday_core.gcs import user_path
    assert user_path("alice", "wiki", "index.md") == "alice/wiki/index.md"
    assert user_path("bob") == "bob"


def test_secrets_mask_key_long():
    from shared.python.manfriday_core.secrets import mask_key
    key = "sk-ant-api03-LONGKEYHERE"
    masked = mask_key(key)
    assert masked.startswith("sk-ant-a")
    assert "****" in masked
    assert masked.endswith(key[-4:])


def test_secrets_mask_key_short():
    from shared.python.manfriday_core.secrets import mask_key
    assert mask_key("short") == "****"
    assert mask_key("") == "****"


def test_llm_config_resolved_model():
    from shared.python.manfriday_core.llm import LLMConfig
    cfg = LLMConfig(provider="anthropic")
    assert cfg.resolved_model == "claude-sonnet-4-20250514"


def test_llm_config_custom_model():
    from shared.python.manfriday_core.llm import LLMConfig
    cfg = LLMConfig(provider="openai", model="gpt-4-turbo")
    assert cfg.resolved_model == "gpt-4-turbo"


def test_llm_providers_constant():
    from shared.python.manfriday_core.llm import VALID_PROVIDERS
    assert "anthropic" in VALID_PROVIDERS
    assert "openai" in VALID_PROVIDERS
    assert "gemini" in VALID_PROVIDERS


def test_pgvector_embedding_dims():
    from shared.python.manfriday_core.pgvector import EMBEDDING_DIMS
    assert EMBEDDING_DIMS["openai"] == 1536
    assert EMBEDDING_DIMS["gemini"] == 768
