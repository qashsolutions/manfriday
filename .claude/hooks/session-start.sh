#!/usr/bin/env bash
# SessionStart hook: remind the wiki maintainer to run its session-start checklist.
#
# Non-blocking: always exits 0. Emits a systemMessage with the current wiki
# page count (if wiki/ exists) and last log.md entry. This is the "Session
# start checklist" enforcement from CLAUDE.md.

set -u

ROOT="/home/user/manfriday"
WIKI_DIR="${ROOT}/wiki"
INDEX="${WIKI_DIR}/index.md"
LOG="${WIKI_DIR}/log.md"
MANIFEST="${ROOT}/raw/manifest.json"

wiki_status="empty (no wiki/ directory yet)"
last_activity="none"
source_count="0"

if [ -d "$WIKI_DIR" ]; then
  pages=$(find "$WIKI_DIR" -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  wiki_status="${pages} pages"

  if [ -f "$INDEX" ]; then
    wikilink_count=$(grep -cE '^\- \[\[' "$INDEX" 2>/dev/null || echo 0)
    wiki_status="${pages} pages (${wikilink_count} catalogued in index.md)"
  fi

  if [ -f "$LOG" ]; then
    last_activity=$(grep -E '^## \[' "$LOG" 2>/dev/null | tail -1 | sed 's/^## //')
    [ -z "$last_activity" ] && last_activity="log.md exists but has no entries"
  fi
fi

if [ -f "$MANIFEST" ]; then
  source_count=$(jq -r '. | length' "$MANIFEST" 2>/dev/null || echo "?")
fi

message="ManFriday session start — CLAUDE.md checklist reminder:

1. Read CLAUDE.md (the agent constitution) at the repo root
2. Read wiki/index.md for the content catalog
3. Read the last 5 entries of wiki/log.md for recent context

Current wiki state:
• Pages: ${wiki_status}
• Sources in raw/manifest.json: ${source_count}
• Last activity: ${last_activity}

If this is a maintenance session (fixing infra, editing code), you can skip the ingest/query workflows. If the user is adding a source or asking a question, follow the wiki-maintainer agent in .claude/agents/wiki-maintainer.md."

jq -cn --arg msg "$message" '{systemMessage: $msg, suppressOutput: false}'
exit 0
