#!/usr/bin/env bash
# PostToolUse hook: validate docker-compose.yml after Edit/Write.
#
# Non-blocking: always exits 0. Emits a systemMessage JSON on any issue.
# Prefers `docker compose config` if docker is available; falls back to
# a lightweight YAML parse + depends_on cross-reference otherwise.

set -u

payload="$(cat 2>/dev/null || echo '{}')"

file_path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null || true)

case "${file_path}" in
  *docker-compose.yml|*docker-compose.yaml|*compose.yml|*compose.yaml) ;;
  *) exit 0 ;;
esac

# Fall back to the canonical repo-root compose file if the given path doesn't exist
if [ ! -f "${file_path}" ]; then
  file_path="/home/user/manfriday/docker-compose.yml"
  [ -f "$file_path" ] || exit 0
fi

warnings=()

# Check 1: obsolete `version:` key
if grep -qE '^version:' "$file_path"; then
  warnings+=("Obsolete \`version:\` key in docker-compose.yml — delete it (Compose v2 infers schema).")
fi

# Check 2: if `docker compose` is available, use it as the source of truth
if command -v docker >/dev/null 2>&1; then
  compose_dir="$(dirname "$file_path")"
  output=$(cd "$compose_dir" && docker compose -f "$(basename "$file_path")" config --quiet 2>&1)
  status=$?
  if [ $status -ne 0 ]; then
    # Strip the obsolete-version warning from docker's output (we already flagged it)
    cleaned=$(printf '%s' "$output" | grep -vE "(the attribute \`version\` is obsolete|WARN|warning)")
    [ -n "$cleaned" ] && warnings+=("\`docker compose config\` failed:\n$cleaned")
  fi
else
  # Check 3 (fallback): parse depends_on and verify each referenced service exists
  # This is a best-effort YAML scan, not a real parser.
  services=$(awk '
    /^services:/ { in_services=1; indent=-1; next }
    in_services && /^[a-zA-Z]/ { in_services=0 }
    in_services && /^  [a-zA-Z][a-zA-Z0-9_-]*:/ { sub(/:.*/, ""); sub(/^  /, ""); print }
  ' "$file_path")

  deps=$(awk '
    /depends_on:/ { in_deps=1; next }
    in_deps && /^    - / { sub(/^    - /, ""); print; next }
    in_deps && /^[[:space:]]*[a-zA-Z]/ { in_deps=0 }
  ' "$file_path")

  for dep in $deps; do
    if ! printf '%s\n' "$services" | grep -qx "$dep"; then
      warnings+=("\`depends_on: $dep\` references a service that does not exist. Defined services: $(printf '%s, ' $services | sed 's/, $//')")
    fi
  done
fi

if [ ${#warnings[@]} -eq 0 ]; then
  exit 0
fi

message="docker-compose validator found $(( ${#warnings[@]} )) issue(s):"
for w in "${warnings[@]}"; do
  message="${message}"$'\n'"• ${w}"
done

jq -cn --arg msg "$message" '{systemMessage: $msg, suppressOutput: true}'
exit 0
