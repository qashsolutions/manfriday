#!/usr/bin/env bash
# PostToolUse hook: validate requirements.txt after Edit/Write.
#
# Non-blocking: always exits 0. Emits a systemMessage JSON on any issue.
# Fast & offline: does not touch the network. Looks for the known-broken
# `slugify` package, missing setuptools pin for feedparser, and basic syntax.

set -u

# Read stdin (may be empty in manual tests)
payload="$(cat 2>/dev/null || echo '{}')"

file_path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null || true)

# Only act on requirements.txt files
case "${file_path}" in
  *requirements.txt|*requirements-*.txt) ;;
  *) exit 0 ;;
esac

# Resolve absolute path; fall back to repo-root requirements.txt if we can't
if [ ! -f "${file_path}" ]; then
  file_path="/home/user/manfriday/requirements.txt"
  [ -f "$file_path" ] || exit 0
fi

warnings=()

# Check 1: the bogus `slugify` package (distinct from `python-slugify`)
if grep -qE '^slugify([<>=!~ ]|$)' "$file_path"; then
  warnings+=("Found legacy \`slugify\` package — this is NOT \`python-slugify\` and breaks pip install on modern setuptools. Remove it.")
fi

# Check 2: feedparser without a setuptools pin in api/Dockerfile
if grep -qE '^feedparser([<>=!~ ]|$)' "$file_path"; then
  if ! grep -qE "setuptools.*<.*60" /home/user/manfriday/api/Dockerfile 2>/dev/null; then
    warnings+=("\`feedparser\` requires \`sgmllib3k\` which needs \`setuptools<60\`. Add \`RUN pip install 'setuptools<60'\` to api/Dockerfile before the main pip install.")
  fi
fi

# Check 3: basic syntax — each non-blank, non-comment line should look like a package spec
bad_lines=$(awk '
  /^[[:space:]]*$/ { next }
  /^[[:space:]]*#/ { next }
  /^-/ { next }   # -r, -e flags are legal
  !/^[A-Za-z0-9_.\-\[\]]+([<>=!~].*)?$/ { print NR": "$0 }
' "$file_path")
if [ -n "$bad_lines" ]; then
  warnings+=("Malformed dependency lines in $file_path:\n$bad_lines")
fi

# No issues — stay silent
if [ ${#warnings[@]} -eq 0 ]; then
  exit 0
fi

# Emit a systemMessage combining all warnings
message="requirements.txt validator found $(( ${#warnings[@]} )) issue(s):"
for w in "${warnings[@]}"; do
  message="${message}"$'\n'"• ${w}"
done

jq -cn --arg msg "$message" '{systemMessage: $msg, suppressOutput: true}'
exit 0
