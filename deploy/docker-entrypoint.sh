#!/bin/sh
# 应用容器入口（M4 计划 4.1 节，默认决定 14）：先执行数据库迁移，再启动服务。
# 迁移失败时容器退出，原因写在日志里；不自动执行种子数据
set -e
echo "[gentransit] 执行数据库迁移（prisma migrate deploy）…"
node node_modules/prisma/build/index.js migrate deploy
echo "[gentransit] 启动服务 ${APP_VERSION:-dev}"
exec node dist/main.js
