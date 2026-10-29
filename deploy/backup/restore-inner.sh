#!/usr/bin/env bash
# 恢复的容器内部分（M4 计划 5.3 节），由宿主机的 deploy/restore.sh 通过 docker compose run restore 调用：
# 校验备份 → 删库重建 → pg_restore → 清空上传卷并复制文件树 → 核对行数与文件数
# 用法：restore-inner.sh <备份名>
set -Eeuo pipefail
NAME="${1:?缺少备份名}"
SRC="/backups/$NAME"
DB="${PGDATABASE:-gentransit}"
step() { echo "[restore] $*"; }

[ -f "$SRC/manifest.json" ] || { echo "[restore] 找不到 $SRC/manifest.json，不是一份完整的备份" >&2; exit 2; }
want_sha=$(sed -n 's/.*"sha256": *"\([0-9a-f]*\)".*/\1/p' "$SRC/manifest.json" | head -1)
have_sha=$(sha256sum "$SRC/db.dump" | cut -d' ' -f1)
[ "$want_sha" = "$have_sha" ] || { echo "[restore] db.dump 的 SHA-256 与清单不符，备份可能已损坏" >&2; exit 3; }

step "删库重建 $DB（整库重建，不会留下新版本迁移建的表）"
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)"
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE \"$DB\" OWNER \"$PGUSER\""

step "pg_restore"
pg_restore --no-owner --exit-on-error -d "$DB" "$SRC/db.dump"

step "恢复上传文件"
find /uploads -mindepth 1 -delete
cp -a "$SRC/uploads/." /uploads/
# 应用容器以 node 用户（uid 1000）运行，要能继续写入
chown -R 1000:1000 /uploads

step "核对行数与文件数"
tables=$(sed -n 's/.*"tables": *\({.*}\).*/\1/p' "$SRC/manifest.json" | tr -d ' \n')
[ -n "$tables" ] || tables=$(tr -d '\n' <"$SRC/manifest.json" | sed -n 's/.*"tables": *\({[^}]*}\).*/\1/p' | tr -d ' ')
bad=0
for pair in $(echo "$tables" | tr -d '{}"' | tr ',' ' '); do
  t="${pair%%:*}"
  n="${pair##*:}"
  got=$(psql -X -At -d "$DB" -c "SELECT count(*) FROM public.\"$t\"")
  if [ "$got" != "$n" ]; then echo "[restore] 表 $t：清单 $n 行，恢复后 $got 行" >&2; bad=1; fi
done
want_files=$(tr -d '\n' <"$SRC/manifest.json" | sed -n 's/.*"uploads": *{ *"files": *\([0-9]*\).*/\1/p')
got_files=$(find /uploads -type f | wc -l)
if [ "$want_files" != "$got_files" ]; then echo "[restore] 上传文件：清单 $want_files 个，恢复后 $got_files 个" >&2; bad=1; fi
[ "$bad" -eq 0 ] || exit 4
step "完成：$NAME（迁移 $(sed -n 's/.*"migration": *"\([^"]*\)".*/\1/p' "$SRC/manifest.json")）"
