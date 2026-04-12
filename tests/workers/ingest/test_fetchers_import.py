"""Smoke test: every fetcher in workers/ingest/fetchers/ imports and can be instantiated."""

import pytest

from workers.ingest.fetchers.base import FetcherBase, FetchResult
from workers.ingest.fetchers.jina import JinaFetcher
from workers.ingest.fetchers.rss import RSSFetcher
from workers.ingest.fetchers.github import GitHubFetcher
from workers.ingest.fetchers.pdf import PDFFetcher
from workers.ingest.fetchers.dataset import DatasetFetcher


def test_jina_fetcher_instantiates():
    f = JinaFetcher()
    assert isinstance(f, FetcherBase)
    assert f.SOURCE_TYPE == "url"


def test_rss_fetcher_instantiates():
    f = RSSFetcher()
    assert isinstance(f, FetcherBase)
    assert f.SOURCE_TYPE == "rss"


def test_github_fetcher_instantiates():
    f = GitHubFetcher()
    assert isinstance(f, FetcherBase)
    assert f.SOURCE_TYPE == "github"


def test_pdf_fetcher_instantiates():
    f = PDFFetcher()
    assert isinstance(f, FetcherBase)
    assert f.SOURCE_TYPE == "pdf"


def test_dataset_fetcher_instantiates():
    f = DatasetFetcher()
    assert isinstance(f, FetcherBase)
    assert f.SOURCE_TYPE == "dataset"


def test_fetch_result_dataclass():
    r = FetchResult(slug="test-slug", content_md="# Hello")
    assert r.slug == "test-slug"
    assert r.images == []
    assert r.metadata == {}


def test_slugify():
    f = JinaFetcher()
    assert f.slugify("Hello World!") == "hello-world"
    assert f.slugify("  spaces  ") == "spaces"


def test_github_fetcher_matches():
    assert GitHubFetcher.matches("https://github.com/openai/gpt-4")
    assert not GitHubFetcher.matches("https://example.com/repo")
