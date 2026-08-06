#!/usr/bin/env python3
"""One-off ops script: provision YouTube Reporting API reach jobs.

Thumbnail impressions/CTR (video_thumbnail_impressions,
video_thumbnail_impressions_ctr) are delivered only through Reporting API
reach report jobs, and a channel's reach data accrues from job creation
(plus at most the docs' general 30-day historical window) — so the jobs
must exist before the data is ever wanted.
Docs: developers.google.com/youtube/reporting/revision_history (Jan 15,
2026 entry) and developers.google.com/youtube/reporting/v1/reports.

Usage (from youtube-mcp/, under the MCP venv):
  .venv/bin/python create_reach_jobs.py          # jobs.list, create missing, verify
  .venv/bin/python create_reach_jobs.py spike    # read-only Analytics API probe:
                                                 # do targeted queries serve the
                                                 # thumbnail metrics for past dates?
  .venv/bin/python create_reach_jobs.py reports  # read-only: list available
                                                 # reports per job and print the
                                                 # earliest report date

Reuses the local MCP server's OAuth token (.oauth-token.json), refreshing
and writing it back the same way server.py's _oauth_creds() does. Honors
the YT_OAUTH_TOKEN env override. Never prints token material.
"""

import os
import sys

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_PATH = os.environ.get("YT_OAUTH_TOKEN", os.path.join(BASE_DIR, ".oauth-token.json"))
OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
]

REACH_REPORT_TYPES = ["channel_reach_basic_a1", "channel_reach_combined_a1"]


def creds_or_die():
    if not os.path.exists(TOKEN_PATH):
        sys.exit(f"No OAuth token at {TOKEN_PATH} — run authorize.py first.")
    creds = Credentials.from_authorized_user_file(TOKEN_PATH, OAUTH_SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())
    if not creds.valid:
        sys.exit("OAuth token invalid and could not be refreshed — re-run authorize.py.")
    return creds


def masked(value, keep=8):
    """Mask an identifier for pasteable output, keeping a recognizable prefix."""
    if not value:
        return value
    return value[:keep] + "…" if len(value) > keep else value


def print_job(job):
    line = (
        f"  id={masked(job.get('id'))}  reportTypeId={job.get('reportTypeId')}  "
        f"name={job.get('name')!r}  createTime={job.get('createTime')}"
    )
    if job.get("expireTime"):
        line += f"  expireTime={job['expireTime']}"
    if job.get("systemManaged"):
        line += "  systemManaged=true"
    print(line)


def create_jobs(creds):
    reporting = build("youtubereporting", "v1", credentials=creds, cache_discovery=False)

    try:
        existing = reporting.jobs().list().execute().get("jobs", [])
    except HttpError as e:
        if e.resp.status == 403:
            sys.exit(
                "jobs.list failed with 403 — the YouTube Reporting API is its own "
                "Google Cloud service (youtubereporting.googleapis.com) and likely "
                "is not enabled in the OAuth client's project. Enable it at "
                "console.cloud.google.com/apis/library/youtubereporting.googleapis.com "
                f"and re-run.\nFull error: {e}"
            )
        raise

    print(f"jobs.list before: {len(existing)} job(s)")
    for job in existing:
        print_job(job)

    have = {j.get("reportTypeId") for j in existing}
    for report_type in REACH_REPORT_TYPES:
        if report_type in have:
            print(f"skip: job for {report_type} already exists")
            continue
        try:
            job = (
                reporting.jobs()
                .create(body={"reportTypeId": report_type, "name": f"manfriday {report_type}"})
                .execute()
            )
            print(f"created job for {report_type}:")
            print_job(job)
        except HttpError as e:
            if e.resp.status == 409:
                print(f"skip: job for {report_type} already exists (409 Conflict)")
            else:
                print(f"FAILED creating job for {report_type}: {e}")

    verify = reporting.jobs().list().execute().get("jobs", [])
    print(f"\njobs.list verify: {len(verify)} job(s)")
    for job in verify:
        print_job(job)

    missing = [r for r in REACH_REPORT_TYPES if r not in {j.get("reportTypeId") for j in verify}]
    if missing:
        sys.exit(f"NOT PROVISIONED: {missing}")
    print("\nBoth reach jobs provisioned.")


# Spike windows: a pre-launch month (metrics announced Jan 15, 2026), the
# launch window, and a recent month — each with a views control query so an
# empty thumbnail-metrics result is distinguishable from a dead channel.
SPIKE_WINDOWS = [
    ("pre-launch month", "2025-12-01", "2025-12-31", "day"),
    ("launch window", "2026-01-15", "2026-02-15", "day"),
    ("recent month", "2026-07-01", "2026-07-31", "day"),
    ("recent month by video", "2026-07-01", "2026-07-31", "video"),
]


def run_query(analytics, label, **params):
    print(f"\n--- {label}")
    print(f"    params: {params}")
    try:
        resp = analytics.reports().query(ids="channel==MINE", **params).execute()
        headers = [h.get("name") for h in resp.get("columnHeaders", [])]
        rows = resp.get("rows") or []
        print(f"    columnHeaders: {headers}")
        print(f"    {len(rows)} row(s)")
        for row in rows:
            if headers and headers[0] == "video":
                row = [masked(str(row[0]), keep=4)] + row[1:]
            print(f"      {row}")
    except HttpError as e:
        print(f"    HttpError {e.resp.status}: {e.error_details or e}")


def spike(creds):
    analytics = build("youtubeAnalytics", "v2", credentials=creds, cache_discovery=False)
    metrics = "videoThumbnailImpressions,videoThumbnailImpressionsClickRate"
    for label, start, end, dimension in SPIKE_WINDOWS:
        common = {"startDate": start, "endDate": end, "dimensions": dimension}
        if dimension == "video":
            common["sort"] = "-videoThumbnailImpressions"
            common["maxResults"] = 10
            run_query(analytics, f"{label} — thumbnail metrics", metrics=metrics, **common)
            continue
        run_query(analytics, f"{label} — views control", metrics="views", **common)
        run_query(analytics, f"{label} — thumbnail metrics", metrics=metrics, **common)


def list_reports(creds):
    reporting = build("youtubereporting", "v1", credentials=creds, cache_discovery=False)
    jobs = reporting.jobs().list().execute().get("jobs", [])
    print(f"jobs.list: {len(jobs)} job(s)")

    earliest_overall = None
    for job in jobs:
        print_job(job)
        reports = []
        page_token = None
        while True:
            resp = (
                reporting.jobs()
                .reports()
                .list(jobId=job["id"], pageToken=page_token)
                .execute()
            )
            reports.extend(resp.get("reports", []))
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
        if not reports:
            print("    no reports available yet")
            continue
        reports.sort(key=lambda r: r.get("startTime", ""))
        for report in reports:
            print(
                f"    report id={masked(report.get('id'))}  "
                f"window {report.get('startTime')} → {report.get('endTime')}  "
                f"createTime={report.get('createTime')}"
            )
        earliest = reports[0].get("startTime")
        print(f"    earliest report date for {job.get('reportTypeId')}: {earliest}")
        if earliest and (earliest_overall is None or earliest < earliest_overall):
            earliest_overall = earliest

    if earliest_overall:
        print(f"\nEarliest report date across all jobs: {earliest_overall}")
    else:
        print("\nNo reports available on any job yet.")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "create"
    credentials = creds_or_die()
    if mode == "create":
        create_jobs(credentials)
    elif mode == "spike":
        spike(credentials)
    elif mode == "reports":
        list_reports(credentials)
    else:
        sys.exit(f"Unknown mode {mode!r} — use 'create' (default), 'spike', or 'reports'.")
