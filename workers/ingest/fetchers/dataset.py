"""Dataset fetcher — CSV/JSON profiling summary via pandas."""

from __future__ import annotations

import io
import json
from typing import Any

import pandas as pd

from workers.ingest.fetchers.base import FetcherBase, FetchResult


class DatasetFetcher(FetcherBase):
    SOURCE_TYPE = "dataset"

    async def fetch(self, source: str, **kwargs: Any) -> FetchResult:
        """Profile a CSV or JSON dataset and produce a markdown summary.

        Args:
            source: GCS path to the dataset file
            **kwargs: Must include 'data_bytes' (bytes) and 'file_type' ('csv' or 'json')
        """
        data_bytes: bytes = kwargs.get("data_bytes", b"")
        file_type: str = kwargs.get("file_type", "csv")

        if not data_bytes:
            from shared.python.manfriday_core.gcs import read_bytes

            data_bytes = read_bytes(source)

        # Parse into DataFrame
        if file_type == "json":
            data = json.loads(data_bytes.decode("utf-8"))
            df = pd.DataFrame(data) if isinstance(data, list) else pd.json_normalize(data)
        else:
            df = pd.read_csv(io.BytesIO(data_bytes))

        # Build profiling summary
        lines = [
            f"# Dataset: {source.split('/')[-1]}",
            "",
            f"**Rows**: {len(df)} | **Columns**: {len(df.columns)}",
            "",
            "## Columns",
            "",
            "| Column | Type | Non-null | Unique | Sample |",
            "|--------|------|----------|--------|--------|",
        ]

        for col in df.columns:
            dtype = str(df[col].dtype)
            non_null = df[col].notna().sum()
            unique = df[col].nunique()
            sample = str(df[col].dropna().iloc[0])[:50] if non_null > 0 else "—"
            lines.append(f"| {col} | {dtype} | {non_null} | {unique} | {sample} |")

        lines.extend(["", "## Descriptive Statistics", ""])

        # Numeric summary
        desc = df.describe()
        if not desc.empty:
            lines.append(desc.to_markdown())

        content_md = "\n".join(lines)
        filename = source.split("/")[-1]
        slug = self.slugify(filename.rsplit(".", 1)[0])

        return FetchResult(
            slug=slug,
            content_md=content_md,
            metadata={
                "source_url": source,
                "source_type": "dataset",
                "title": filename,
                "rows": len(df),
                "columns": len(df.columns),
                "column_names": list(df.columns),
                "word_count": len(content_md.split()),
            },
        )
