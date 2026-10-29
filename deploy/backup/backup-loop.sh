#!/usr/bin/env bash
# backup 容器的主循环（M4 计划 5.2 节）：每天 BACKUP_TIME（容器本地时间，默认 02:30）执行一次 backup.sh；
# 失败时 1 小时后重试，最多重试 3 次，每次都写 status.json。不用 cron，容器更简单
set -uo pipefail
AT="${BACKUP_TIME:-02:30}"
if ! date -d "today $AT" >/dev/null 2>&1; then
  echo "[backup] BACKUP_TIME 不合法：$AT（应为 HH:MM）" >&2
  exit 1
fi
echo "[backup] 每天 $AT 备份，保留 ${BACKUP_RETENTION_DAYS:-30} 天；时区 ${TZ:-UTC}"
while true; do
  now=$(date +%s)
  next=$(date -d "today $AT" +%s)
  [ "$next" -le "$now" ] && next=$(date -d "tomorrow $AT" +%s)
  echo "[backup] 下次备份：$(date -d "@$next" '+%Y-%m-%d %H:%M')"
  sleep $((next - now))
  for attempt in 1 2 3 4; do
    if bash /scripts/backup.sh; then break; fi
    [ "$attempt" -eq 4 ] && { echo "[backup] 重试 3 次仍失败，等明天" >&2; break; }
    echo "[backup] 1 小时后第 $attempt 次重试" >&2
    sleep 3600
  done
done
