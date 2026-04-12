"""Smoke test: deterministic quality scoring logic (no external services)."""

import pytest

# Import only modules that have no side effects at import time.
from workers.ingest.fetchers.base import FetcherBase


def test_extract_image_urls_from_markdown():
    md = "Text ![alt](https://example.com/img.png) more text ![x](https://cdn.test/a.jpg)"
    urls = FetcherBase.extract_image_urls(md)
    assert urls == ["https://example.com/img.png", "https://cdn.test/a.jpg"]


def test_extract_image_urls_empty():
    assert FetcherBase.extract_image_urls("no images here") == []


def test_slugify_special_chars():
    result = FetcherBase.slugify("C++ Programming & Design!")
    assert " " not in result
    assert "&" not in result
    assert "!" not in result


def test_slugify_max_length():
    long_text = "a" * 200
    result = FetcherBase.slugify(long_text)
    assert len(result) <= 80


def test_slugify_hyphens_normalized():
    result = FetcherBase.slugify("foo  --  bar")
    assert "--" not in result
    assert result == "foo-bar"
