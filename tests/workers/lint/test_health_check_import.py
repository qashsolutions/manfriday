"""Smoke test: workers/lint/ modules import without error."""

import importlib
import pytest

LINT_MODULES = [
    "workers.lint.health_check",
    "workers.lint.web_search",
    "workers.lint.output_filing_worker",
    "workers.lint.queue_writer",
]


@pytest.mark.parametrize("module_path", LINT_MODULES)
def test_lint_module_importable(module_path):
    mod = importlib.import_module(module_path)
    assert mod is not None


def test_health_check_dataclasses_importable():
    from workers.lint.health_check import HealthReport, HealthIssue
    report = HealthReport(user_id="u1", run_date="2026-01-01")
    assert report.pages_sampled == 0
    assert report.issues == []
    issue = HealthIssue(
        check="structural",
        severity="low",
        page="wiki/index.md",
        detail="missing backlinks",
    )
    assert issue.suggestion == ""
