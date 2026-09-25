#!/bin/zsh
# Run the Highway engine as a macOS background service that restarts itself and keeps
# the Mac awake. Usage: scripts/service.sh install | uninstall | start | stop | restart | status | logs
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.highway.engine"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BIN="$ROOT/.venv/bin/highway"

case "${1:-status}" in
  install)
    mkdir -p "$ROOT/data/logs" "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string><string>-ims</string>
    <string>$BIN</string><string>run</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$ROOT/data/logs/launchd.out</string>
  <key>StandardErrorPath</key><string>$ROOT/data/logs/launchd.err</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed and started. Dashboard: http://127.0.0.1:8787"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Stopped and removed."
    ;;
  restart)
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    echo "Restarted."
    ;;
  stop)
    # KeepAlive means launchd relaunches the engine the moment it dies, so stopping it takes
    # a bootout, not a kill. Anything that edits the database directly must do this first:
    # a live engine holds the fund in memory and will save straight over your changes.
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    for _ in {1..15}; do pgrep -f "highway run" >/dev/null || break; sleep 1; done
    if pgrep -f "highway run" >/dev/null; then echo "STILL RUNNING - do not touch the database"; exit 1; fi
    echo "Stopped. The engine is not running; start it again with: $0 start"
    ;;
  start)
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Started. Dashboard: http://127.0.0.1:8787"
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state|pid|last exit" || echo "Not installed."
    ;;
  logs)
    tail -n 60 -f "$ROOT/data/logs/engine.log"
    ;;
  *)
    echo "usage: $0 install | uninstall | start | stop | restart | status | logs"; exit 1 ;;
esac
