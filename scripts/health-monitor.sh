#!/bin/bash
# Health monitor — add to cron every 5 min or systemd timer
URL="${HEALTH_URL:-http://127.0.0.1:3002/api/health}"
ALERT="${ALERT_WEBHOOK:-}"
if curl -fsS --max-time 10 "$URL" | grep -q '"ok":true'; then
  exit 0
fi
MSG="Daogreen Spec API down: $URL"
logger -t daogreen-health "$MSG"
if [ -n "$ALERT" ]; then
  curl -fsS -X POST -H "Content-Type: application/json" -d "{\"text\":\"$MSG\"}" "$ALERT" >/dev/null 2>&1 || true
fi
exit 1
