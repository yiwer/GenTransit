#!/usr/bin/env bash
# 一份备份（M4 计划 5.1 节），在 backup 容器里执行：
#   /backups/<YYYYMMDD-HHMMSS>[-后缀]/
#     db.dump         pg_dump -Fc（自定义格式、压缩），导出后用 pg_restore --list 自检
#     uploads/        上传目录的完整文件树：先硬链接上一份，再补新文件（文件只增不改不删）
#     manifest.json   时间、应用版本、最后一个迁移、db.dump 的大小与 SHA-256、文件数与总大小、各表行数
# 先写到 <名称>.partial/，全部完成才改名；然后更新 /backups/status.json，清理过期备份。
# 失败时在 /backups/failures/<名称>.txt 记下原因，并更新 status.json。
# 用法：backup.sh [后缀]       后缀如 manual、pre-restore
set -Eeuo pipefail

ROOT=/backups
UPLOADS=/uploads
SUFFIX="${1:-}"
NAME="$(date +%Y%m%d-%H%M%S)${SUFFIX:+-$SUFFIX}"
WORK="$ROOT/$NAME.partial"
NOW_UTC() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }
STARTED=$(NOW_UTC)
STEP='准备'

json_escape() { sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g' -e 's/\t/ /g'; }

# 读出上一份 status.json 里的字段（没有 jq，用 sed 取简单的字符串值）
status_field() {
  [ -f "$ROOT/status.json" ] || return 0
  sed -n "s/.*\"$1\": *\"\\([^\"]*\\)\".*/\\1/p" "$ROOT/status.json" | head -1
}

write_status() { # $1=lastSuccessAt $2=lastError(已转义) $3=latest 的 JSON
  local tmp="$ROOT/.status.json.tmp"
  {
    echo '{'
    echo "  \"lastAttemptAt\": \"$STARTED\","
    if [ -n "$1" ]; then echo "  \"lastSuccessAt\": \"$1\","; else echo '  "lastSuccessAt": null,'; fi
    if [ -n "$2" ]; then echo "  \"lastError\": \"$2\","; else echo '  "lastError": null,'; fi
    echo "  \"latest\": ${3:-null}"
    echo '}'
  } >"$tmp"
  mv -f "$tmp" "$ROOT/status.json"
}

fail() {
  local code=$?
  local msg
  msg="$(printf '%s失败（退出码 %s）' "$STEP" "$code")"
  mkdir -p "$ROOT/failures"
  { echo "$msg"; [ -f "$WORK/error.log" ] && tail -n 20 "$WORK/error.log"; } >"$ROOT/failures/$NAME.txt" || true
  local prev_ok prev_latest=null
  prev_ok=$(status_field lastSuccessAt)
  [ -f "$ROOT/status.json" ] && prev_latest=$(sed -n 's/.*"latest": *\({.*}\).*/\1/p' "$ROOT/status.json" | head -1)
  write_status "$prev_ok" "$(printf '%s' "$msg" | json_escape)" "${prev_latest:-null}" || true
  echo "[backup] $NAME：$msg" >&2
  exit "$code"
}
trap fail ERR

mkdir -p "$ROOT"
mkdir -p "$WORK"
echo "[backup] 开始 $NAME"

# 1. 导出数据库：在同一个只读快照里导出、统计各表行数与最后一个迁移，保证清单与导出内容一致
STEP='导出数据库'
coproc PSQL { psql -X -q -At -v ON_ERROR_STOP=1 2>>"$WORK/error.log"; }
echo "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY; SELECT pg_export_snapshot();" >&"${PSQL[1]}"
read -r SNAPSHOT <&"${PSQL[0]}"
pg_dump -Fc --snapshot="$SNAPSHOT" -f "$WORK/db.dump" 2>>"$WORK/error.log"
cat >&"${PSQL[1]}" <<'SQL'
SELECT coalesce(json_object_agg(table_name, n ORDER BY table_name), '{}') FROM (
  SELECT table_name,
         (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', table_name), false, true, '')))[1]::text::bigint AS n
  FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
) t;
SELECT coalesce((SELECT (xpath('/row/m/text()', query_to_xml('SELECT migration_name AS m FROM public._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1', false, true, '')))[1]::text WHERE to_regclass('public._prisma_migrations') IS NOT NULL), '');
SQL
read -r TABLES <&"${PSQL[0]}"
read -r MIGRATION <&"${PSQL[0]}"
echo "COMMIT;" >&"${PSQL[1]}"
exec {PSQL[1]}>&-
wait "$PSQL_PID" 2>/dev/null || true

STEP='自检数据库导出'
pg_restore --list "$WORK/db.dump" >/dev/null 2>>"$WORK/error.log"
DB_SIZE=$(stat -c %s "$WORK/db.dump")
DB_SHA=$(sha256sum "$WORK/db.dump" | cut -d' ' -f1)

# 2. 上传文件：硬链接上一份完整备份的文件树，再补上新文件；文件系统不支持硬链接时整份复制
STEP='复制上传文件'
PREV=$(find "$ROOT" -mindepth 1 -maxdepth 1 -type d -name '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]*' \
  ! -name '*.partial' ! -name "$NAME.partial" -exec test -f '{}/manifest.json' ';' -print | sort | tail -1)
HARDLINK=false
if [ -n "$PREV" ] && [ -d "$PREV/uploads" ]; then
  if cp -al "$PREV/uploads" "$WORK/uploads" 2>/dev/null; then
    HARDLINK=true
  else
    rm -rf "$WORK/uploads"
    cp -a "$PREV/uploads" "$WORK/uploads"
  fi
else
  mkdir -p "$WORK/uploads"
fi
if [ -d "$UPLOADS" ]; then cp -rn "$UPLOADS/." "$WORK/uploads/" 2>>"$WORK/error.log"; fi
FILES=$(find "$WORK/uploads" -type f | wc -l)
UP_SIZE=$(find "$WORK/uploads" -type f -printf '%s\n' | awk '{s+=$1} END {print s+0}')

# 3. 清单
STEP='写清单'
CREATED=$(NOW_UTC)
cat >"$WORK/manifest.json" <<JSON
{
  "name": "$NAME",
  "createdAt": "$CREATED",
  "startedAt": "$STARTED",
  "appVersion": "${APP_VERSION:-}",
  "migration": "$MIGRATION",
  "db": { "file": "db.dump", "size": $DB_SIZE, "sha256": "$DB_SHA" },
  "uploads": { "files": $FILES, "size": $UP_SIZE, "hardlinked": $HARDLINK },
  "tables": $TABLES
}
JSON
rm -f "$WORK/error.log"

# 4. 改名去掉 .partial：没改名的不算成功
STEP='完成'
mv "$WORK" "$ROOT/$NAME"
trap - ERR
write_status "$CREATED" "" "{ \"name\": \"$NAME\", \"size\": $((DB_SIZE + UP_SIZE)) }"
echo "[backup] 完成 $NAME：数据库 $DB_SIZE 字节，上传文件 $FILES 个、$UP_SIZE 字节"

# 5. 保留：删除早于保留天数的备份，但永远保留最新一份成功的；超过 1 天的 .partial 与过期的失败记录也删除
DAYS="${BACKUP_RETENTION_DAYS:-30}"
CUTOFF=$(date -d "-$DAYS days" +%Y%m%d-%H%M%S)
for d in "$ROOT"/*; do
  [ -d "$d" ] || continue
  n=$(basename "$d")
  case "$n" in
    "$NAME") ;;
    *.partial)
      if [ -n "$(find "$d" -maxdepth 0 -mmin +1440)" ]; then rm -rf "$d"; echo "[backup] 清理未完成的 $n"; fi
      ;;
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]*)
      if [[ "${n:0:15}" < "$CUTOFF" ]]; then rm -rf "$d"; echo "[backup] 删除过期备份 $n"; fi
      ;;
  esac
done
if [ -d "$ROOT/failures" ]; then
  for f in "$ROOT"/failures/*.txt; do
    [ -f "$f" ] || continue
    n=$(basename "$f" .txt)
    if [[ "${n:0:15}" < "$CUTOFF" ]]; then rm -f "$f"; fi
  done
fi
