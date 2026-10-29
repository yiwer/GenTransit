#!/usr/bin/env bash
# 备份恢复演练（M4 计划 5.4 节）。在独立的 compose 项目 gentransit-drill 里进行：卷、端口、备份目录都单独一套，
# 不碰正式部署（gentransit-app）与开发库（docker-compose.dev.yml，端口 54329）。
#   1. 构建镜像，检查镜像内容：没有 .env；镜像里没有本机环境变量中高德安全密钥与 Web 服务 Key 的值（只报告次数与长度）
#   2. 启动环境 A：临时发布 A 的数据库端口，从宿主机执行 pnpm db:seed --reset；登录、上传图片、新建 API Token
#   3. 备份 A，记下指纹：每张表的行数与内容 md5、上传文件清单的 SHA-256
#   4. 在 A 上继续改数据（删站点、停运线路、再传一张图），证明恢复回到的是备份时的状态
#   5. 原地恢复 A：指纹与第 3 步相同
#   6. 在全新环境 B 上恢复（只复制备份目录，模拟换新机器）：指纹相同；能登录；第 2 步的 Token 能调用 /api/v1/stops；
#      用 /api/v1/files/{id} 下载的图片与原文件字节相同
#   7. 清理：down -v 清掉演练环境，输出结论（deploy/drill-work/drill-report.md）
# 用法：bash deploy/drill.sh   需要 docker、node、pnpm、curl；构建时的代理见 deploy/build.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

PROJECT=gentransit-drill
DEV_DB_PORT=54329
HTTP_PORT="${GT_DRILL_HTTP_PORT:-18080}"
DB_PORT="${GT_DRILL_DB_PORT:-55439}"
WORK=deploy/drill-work
BASE="http://127.0.0.1:$HTTP_PORT"

[ "$DB_PORT" != "$DEV_DB_PORT" ] || { echo "演练库端口不能是开发库的 $DEV_DB_PORT" >&2; exit 1; }

# 演练前先记下高德密钥（只在本进程里用来比对，不打印），然后从 compose 的环境里去掉：演练不访问高德
SECRET_CODE="${AMAP_JSAPI_SECURITY_CODE:-}"
SECRET_WEB="${AMAP_WEB_SERVICE_KEY:-}"
SECRET_API="${AMAP_API_KEY:-}"
export AMAP_JSAPI_KEY='' AMAP_JSAPI_SECURITY_CODE='' AMAP_WEB_SERVICE_KEY='' AMAP_API_KEY=''

rand() { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('hex'))"; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s)$1;process.stdout.write(String(v))})"; }
log() { printf '\n== %s\n' "$*"; }
REPORT=()
note() { REPORT+=("$*"); echo "   $*"; }

rm -rf "$WORK"
mkdir -p "$WORK/backups-a" "$WORK/backups-b"
PW=$(rand 16)
ADMIN_USER=drill
ADMIN_PW=$(rand 12)
cat >"$WORK/drill.env" <<EOF
SESSION_SECRET=$(rand 32)
GT_ADMIN_USERNAME=$ADMIN_USER
GT_ADMIN_PASSWORD=$ADMIN_PW
LOG_LEVEL=warn
EOF
export COMPOSE_PROJECT_NAME=$PROJECT
export COMPOSE_PATH_SEPARATOR=':'
export COMPOSE_FILE="docker-compose.yml:deploy/drill/compose.drill.yml"
export GT_ENV_FILE="./$WORK/drill.env"
export GT_HTTP_PORT=$HTTP_PORT GT_DRILL_DB_PORT=$DB_PORT
export POSTGRES_PASSWORD=$PW
export GT_BACKUP_PATH="./$WORK/backups-a"

cleanup() {
  local code=$?
  if [ "${KEEP:-}" != 1 ]; then
    docker compose down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$WORK/backups-a" "$WORK/backups-b" "$WORK/drill.env" "$WORK/cookies.txt" "$WORK/body.json" "$WORK/anon.json" "$WORK"/*.png "$WORK"/*.bin
  fi
  [ "$code" -eq 0 ] || echo "演练失败（退出码 $code）。设置 KEEP=1 可保留演练环境排查。" >&2
}
trap cleanup EXIT

# ---------------- 1. 构建镜像并检查 ----------------
log "1. 构建镜像并检查镜像内容"
TAG=$(bash deploy/build.sh | tail -1)
export GT_VERSION=$TAG
note "镜像：gentransit:$TAG"
cid=$(docker create "gentransit:$TAG")
docker export "$cid" >"$WORK/image.bin"
docker rm "$cid" >/dev/null
if tar -tf "$WORK/image.bin" | grep -Eq '(^|/)\.env$'; then
  echo "镜像里有 .env 文件" >&2
  exit 1
fi
note "镜像里没有 .env 文件"
for pair in "高德安全密钥:$SECRET_CODE" "高德 Web 服务 Key:$SECRET_WEB" "高德路线规划 Key（AMAP_API_KEY）:$SECRET_API"; do
  label=${pair%%:*}
  value=${pair#*:}
  if [ -z "$value" ]; then
    note "本机没有设置$label，跳过"
    continue
  fi
  n=$(grep -c -a -F -- "$value" "$WORK/image.bin" || true)
  [ "$n" -eq 0 ] || { echo "镜像里出现了$label（$n 处，长度 ${#value}）" >&2; exit 1; }
  note "镜像里没有$label（长度 ${#value}，出现 0 次）"
done
rm -f "$WORK/image.bin"

# ---------------- 2. 环境 A ----------------
log "2. 启动环境 A，写入种子数据"
docker compose down -v --remove-orphans >/dev/null 2>&1 || true
docker compose up -d --wait --no-build
SEED_URL="postgresql://gentransit:$PW@127.0.0.1:$DB_PORT/gentransit"
case "$SEED_URL" in *":$DEV_DB_PORT/"*) echo "种子数据不能指向开发库" >&2; exit 1 ;; esac
# Windows 的 Git Bash 里 pnpm 启动脚本依赖路径转换，这一步不带 MSYS_NO_PATHCONV
env -u MSYS_NO_PATHCONV DATABASE_URL="$SEED_URL" pnpm --silent db:seed --reset >"$WORK/seed.log" 2>&1
note "种子数据：$(tail -1 "$WORK/seed.log")"

api() { curl -sS -f -b "$WORK/cookies.txt" -c "$WORK/cookies.txt" -H 'X-GT-Request: 1' "$@"; }
# JSON 请求体写到文件再发：Windows 上命令行参数里的中文会被转成本地编码
post_json() {
  printf '%s' "$2" >"$WORK/body.json"
  api -H 'Content-Type: application/json' --data-binary "@$WORK/body.json" "$1"
}
login() {
  rm -f "$WORK/cookies.txt"
  post_json "$BASE/api/auth/login" "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PW\"}" >/dev/null
}
login
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d >"$WORK/drill.png"
UPLOAD_ID=$(api -F "file=@$WORK/drill.png;type=image/png" "$BASE/api/uploads" | json '.id')
TOKEN=$(post_json "$BASE/api/api-tokens" '{"name":"演练"}' | json '.token')
STOP_ID=$(post_json "$BASE/api/stops" '{"name":"演练站","direction":"东","lng":120.15,"lat":30.28}' | json '.item.id')
note "已登录；上传图片 $UPLOAD_ID；新建 Token（前缀 ${TOKEN:0:10}）；新建站点 $STOP_ID"

# ---------------- 3. 备份与指纹 ----------------
psql_a() { docker compose exec -T db psql -X -U gentransit -d gentransit -At -c "$1"; }
fingerprint() {
  psql_a "SELECT string_agg(format('%s %s %s', table_name, n, h), E'\n' ORDER BY table_name) FROM (
    SELECT table_name,
      (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', table_name), false, true, '')))[1]::text AS n,
      (xpath('/row/h/text()', query_to_xml(format('SELECT md5(coalesce(string_agg(t::text, ''|'' ORDER BY t::text), '''')) AS h FROM public.%I t', table_name), false, true, '')))[1]::text AS h
    FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') x"
  echo "uploads $(docker compose exec -T app sh -c 'cd /data/uploads && find . -type f | LC_ALL=C sort | xargs -r sha256sum' | sha256sum | cut -d' ' -f1)"
}
log "3. 备份 A，记下指纹"
docker compose exec -T backup bash /scripts/backup.sh drill
NAME=$(find "$GT_BACKUP_PATH" -mindepth 2 -maxdepth 2 -name manifest.json | xargs -n1 dirname | xargs -n1 basename | sort | tail -1)
fingerprint >"$WORK/fp-backup.txt"
TABLES=$(grep -vc '^uploads ' "$WORK/fp-backup.txt")
ROWS=$(awk '$1 != "uploads" {s += $2} END {print s}' "$WORK/fp-backup.txt")
note "备份 $NAME：$TABLES 张表、$ROWS 行；$(sed -n 's/.*"files": *\([0-9]*\).*/\1/p' "$GT_BACKUP_PATH/$NAME/manifest.json") 个上传文件；硬链接 $(sed -n 's/.*"hardlinked": *\([a-z]*\).*/\1/p' "$GT_BACKUP_PATH/$NAME/manifest.json")"

# ---------------- 4. 继续改数据 ----------------
log "4. 在 A 上继续改数据"
api -X DELETE "$BASE/api/stops/$STOP_ID" >/dev/null
read -r LINE_ID LINE_REV <<<"$(psql_a "SELECT id, rev FROM \"Line\" WHERE status = 'running' ORDER BY id LIMIT 1" | tr '|' ' ')"
post_json "$BASE/api/lines/$LINE_ID/suspend" "{\"rev\":$LINE_REV}" >/dev/null
api -F "file=@$WORK/drill.png;type=image/png" "$BASE/api/uploads" >/dev/null
fingerprint >"$WORK/fp-changed.txt"
if cmp -s "$WORK/fp-backup.txt" "$WORK/fp-changed.txt"; then
  echo "改数据后指纹没有变化，演练无效" >&2
  exit 1
fi
note "删除站点、停运线路 $LINE_ID、再上传一张图片：指纹已与备份时不同"

# ---------------- 5. 原地恢复 ----------------
log "5. 原地恢复 A"
bash deploy/restore.sh "$NAME" --yes
fingerprint >"$WORK/fp-restore-a.txt"
if ! diff "$WORK/fp-backup.txt" "$WORK/fp-restore-a.txt"; then
  echo "原地恢复后的指纹与备份时不同" >&2
  exit 1
fi
note "原地恢复：指纹与备份时相同"
PRE=$(find "$GT_BACKUP_PATH" -mindepth 1 -maxdepth 1 -name '*-pre-restore' | sort | tail -1)
note "恢复前自动备份 $(basename "$PRE")；上传文件与上一份硬链接：$(sed -n 's/.*"hardlinked": *\([a-z]*\).*/\1/p' "$PRE/manifest.json")"

# ---------------- 6. 新环境 B ----------------
log "6. 在全新环境 B 上恢复"
docker compose down -v --remove-orphans
mkdir -p "$WORK/backups-b"
cp -r "$GT_BACKUP_PATH/$NAME" "$WORK/backups-b/"
export GT_BACKUP_PATH="./$WORK/backups-b"
docker compose up -d --wait --no-build db
bash deploy/restore.sh "$NAME" --yes
docker compose up -d --wait --no-build
fingerprint >"$WORK/fp-restore-b.txt"
if ! diff "$WORK/fp-backup.txt" "$WORK/fp-restore-b.txt"; then
  echo "新环境恢复后的指纹与备份时不同" >&2
  exit 1
fi
note "新环境恢复：指纹与备份时相同"
login
note "恢复后能登录"
STOPS=$(curl -sS -f -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/stops?limit=500&updatedSince=2000-01-01T00:00:00.000Z" | json '.items.length')
ANON=$(curl -sS -o "$WORK/anon.json" -w '%{http_code}' "$BASE/api/v1/stops")
[ "$ANON" = 401 ] || { echo "不带 Token 调用 /api/v1/stops 返回 $ANON" >&2; exit 1; }
note "第 2 步的 Token 能调用 /api/v1/stops（$STOPS 个站点）；不带 Token 返回 401"
curl -sS -f -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/files/$UPLOAD_ID" -o "$WORK/downloaded.png"
cmp "$WORK/drill.png" "$WORK/downloaded.png"
note "/api/v1/files/$UPLOAD_ID 下载的图片与原文件字节相同"

# ---------------- 7. 结论 ----------------
log "7. 清理并输出结论"
{
  echo "# 备份恢复演练结论"
  echo
  echo "- 时间：$(date '+%Y-%m-%d %H:%M:%S %z')"
  for r in "${REPORT[@]}"; do echo "- $r"; done
  echo "- 结论：通过"
} >"$WORK/drill-report.md"
cat "$WORK/drill-report.md"
