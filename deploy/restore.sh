#!/usr/bin/env bash
# 恢复到某一份备份（M4 计划 5.3 节）。在宿主机的部署目录（docker-compose.yml 所在目录）执行：
#   bash deploy/restore.sh <备份名> [--yes]
# 步骤：确认 → 停止 app → 先给当前数据备份一份（后缀 -pre-restore）→ 删库重建并 pg_restore →
#       清空上传卷并复制文件树 → 核对行数与文件数 → 启动 app（入口会把迁移补齐）→ 等健康检查通过。
# 数据库与文件操作都在容器里执行，宿主机只负责启停和传参，Linux 服务器与 Windows 的 Git Bash 都能运行
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

NAME="${1:-}"
YES="${2:-}"
BACKUP_PATH="${GT_BACKUP_PATH:-./backups}"
if [ -z "$NAME" ]; then
  echo "用法：bash deploy/restore.sh <备份名> [--yes]" >&2
  echo "可用的备份：" >&2
  find "$BACKUP_PATH" -mindepth 2 -maxdepth 2 -name manifest.json 2>/dev/null | xargs -r -n1 dirname | xargs -r -n1 basename | sort >&2
  exit 1
fi
if [ ! -f "$BACKUP_PATH/$NAME/manifest.json" ]; then
  echo "找不到备份 $BACKUP_PATH/$NAME（要有 manifest.json）" >&2
  exit 1
fi

if [ "$YES" != "--yes" ]; then
  echo "将用备份 $NAME 覆盖当前的数据库与上传文件。恢复前会先给当前数据备份一份。"
  read -r -p "请输入备份名确认：" confirm
  [ "$confirm" = "$NAME" ] || { echo "备份名不一致，已取消"; exit 1; }
fi

# 中途失败时 app 保持停止（库可能已删掉一半，不能直接启动），提示下一步怎么做
on_fail() {
  echo "[restore] 失败：app 保持停止。如果已生成 -pre-restore 备份，可用它恢复：bash deploy/restore.sh <那份备份名>；" >&2
  echo "[restore] 排查原因见上面的输出，确认数据无误后再执行 docker compose up -d app" >&2
}
trap on_fail ERR

echo "[restore] 停止 app"
docker compose stop app
docker compose up -d --wait db

echo "[restore] 先给当前数据备份一份（-pre-restore）"
docker compose run --rm --no-deps -T --entrypoint bash backup /scripts/backup.sh pre-restore

echo "[restore] 恢复 $NAME"
docker compose run --rm --no-deps -T restore "$NAME"

echo "[restore] 启动 app，等待健康检查"
docker compose up -d --wait app
echo "[restore] 完成：已恢复到 $NAME"
