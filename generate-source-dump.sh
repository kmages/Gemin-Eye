#!/bin/bash
OUTPUT="client/public/source.txt"
echo "# GEMIN-EYE — FULL SOURCE CODE" > "$OUTPUT"
echo "# AI-Powered Customer Acquisition Platform" >> "$OUTPUT"
echo "# https://gemin-eye.com" >> "$OUTPUT"
echo "# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUTPUT"
echo "# Paste this URL into any AI (Claude, ChatGPT, etc.) for code review." >> "$OUTPUT"
echo "# URL: https://gemin-eye.com/source.txt" >> "$OUTPUT"
echo "############################################################" >> "$OUTPUT"
echo "" >> "$OUTPUT"

FILES=(
  "shared/schema.ts"
  "shared/models/auth.ts"
  "shared/models/chat.ts"
  "server/index.ts"
  "server/routes.ts"
  "server/storage.ts"
  "server/db.ts"
  "server/telegram.ts"
  "server/telegram-bot.ts"
  "server/reddit-monitor.ts"
  "server/google-alerts-monitor.ts"
  "client/src/App.tsx"
  "client/src/pages/landing.tsx"
  "client/src/pages/dashboard.tsx"
  "client/src/pages/onboarding.tsx"
  "client/src/pages/client-guide.tsx"
  "client/src/hooks/use-auth.ts"
  "client/src/lib/queryClient.ts"
  "client/src/components/theme-provider.tsx"
  "client/public/spy-glass.js"
  "client/public/li-spy-glass.js"
  "replit.md"
)

for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    LINES=$(wc -l < "$f")
    echo "============================================================" >> "$OUTPUT"
    echo "FILE: $f ($LINES lines)" >> "$OUTPUT"
    echo "============================================================" >> "$OUTPUT"
    cat "$f" >> "$OUTPUT"
    echo "" >> "$OUTPUT"
    echo "" >> "$OUTPUT"
  fi
done

echo "Generated source.txt ($(wc -c < "$OUTPUT") bytes)"
