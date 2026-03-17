#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_PATH="$(command -v node)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.ken.cme-gold-stocks.plist"
DATA_DIR="$HOME/Documents/CME-Gold-Stocks"
LOG_DIR="$DATA_DIR/logs"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ken.cme-gold-stocks</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_PATH</string>
    <string>$SCRIPT_DIR/download_gold_stocks.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$SCRIPT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>1800</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/launchd.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/launchd.stderr.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl load "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/com.ken.cme-gold-stocks" >/dev/null 2>&1 || true

echo "Installed launch agent: $PLIST_PATH"
echo "The job runs every 30 minutes."
echo "The script itself only downloads during 12:00-15:59 America/New_York on CME business days."
echo "Downloads are saved to: $DATA_DIR/downloads"
