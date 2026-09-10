#!/bin/zsh
# Demo helper: asks TikTok's Content Posting API for the delivery status of the
# most recent Man Friday scheduled post (or a publish_id passed as $1).
cd "$(dirname "$0")"
TOKEN="$(npx convex data socialAccounts 2>/dev/null | grep '"tiktok"' | awk -F'|' '{print $3}' | tr -d ' "')"
PUBLISH_ID="${1:-$(npx convex data publications --limit 1 --order desc 2>/dev/null | tail -n +3 | awk -F'|' '{print $7}' | tr -d '" ')}"
echo "TikTok Content Posting API — publish status"
echo "publish_id: $PUBLISH_ID"
/usr/bin/curl -s -X POST "https://open.tiktokapis.com/v2/post/publish/status/fetch/" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"publish_id\":\"$PUBLISH_ID\"}" | /usr/bin/python3 -m json.tool
