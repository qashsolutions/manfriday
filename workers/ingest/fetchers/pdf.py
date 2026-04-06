"""PDF fetcher — extract text from uploaded PDF via PyMuPDF."""

from __future__ import annotations

from typing import Any

from workers.ingest.fetchers.base import FetcherBase, FetchResult


class PDFFetcher(FetcherBase):
    SOURCE_TYPE = "pdf"

    async def fetch(self, source: str, **kwargs: Any) -> FetchResult:
        """Extract text from PDF bytes stored in GCS.

        Args:
            source: GCS path to the uploaded PDF (e.g., uploads/{uuid}.pdf)
            **kwargs: Must include 'pdf_bytes' (bytes) or 'user_id' to read from GCS
        """
        import fitz  # PyMuPDF

        pdf_bytes = kwargs.get("pdf_bytes")
        if not pdf_bytes:
            from shared.python.manfriday_core.gcs import read_bytes

            user_id = kwargs.get("user_id", "")
            pdf_bytes = read_bytes(source)

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")

        pages = []
        for i, page in enumerate(doc):
            text = page.get_text("text")
            if text.strip():
                pages.append(f"## Page {i + 1}\n\n{text.strip()}")

        content_md = "\n\n---\n\n".join(pages) if pages else "*(empty PDF)*"

        # Derive title from first page or filename
        title = ""
        if doc.metadata:
            title = doc.metadata.get("title", "")
        if not title and pages:
            # Use first non-empty line
            for line in content_md.split("\n"):
                line = line.strip().lstrip("#").strip()
                if line and not line.startswith("Page"):
                    title = line[:100]
                    break
        title = title or source.split("/")[-1].replace(".pdf", "")

        slug = self.slugify(title)
        doc.close()

        return FetchResult(
            slug=slug,
            content_md=content_md,
            metadata={
                "source_url": source,
                "source_type": "pdf",
                "title": title,
                "page_count": len(pages),
                "word_count": len(content_md.split()),
            },
        )
