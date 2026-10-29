#!/usr/bin/env bash
# 离线打包（M4 计划 4.4 节）：在能上网的机器上构建镜像，把应用镜像与 PostgreSQL 镜像 docker save 后，
# 连同 docker-compose.yml、deploy/、.env.example、docs/deploy.md 打成一个包，拷到内网服务器上部署。
# 用法：bash deploy/pack.sh    产物在 deploy/out/gentransit-<版本>.tar.gz
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

PG_IMAGE=$(sed -n 's/^ *image: *\(postgres:[^ ]*\).*/\1/p' docker-compose.yml | head -1)
tag=$(bash deploy/build.sh | tail -1)
docker pull "$PG_IMAGE" >/dev/null

out="deploy/out/gentransit-$tag"
rm -rf "$out"
mkdir -p "$out/deploy" "$out/docs"
echo "导出镜像 gentransit:$tag、$PG_IMAGE …"
docker save "gentransit:$tag" gentransit:latest "$PG_IMAGE" | gzip >"$out/images.tar.gz"
cp docker-compose.yml .env.example "$out/"
cp docs/deploy.md "$out/docs/"
cp -r deploy/backup deploy/restore.sh deploy/drill.sh deploy/drill "$out/deploy/"
echo "GT_VERSION=$tag" >"$out/VERSION"
tar -czf "deploy/out/gentransit-$tag.tar.gz" -C deploy/out "gentransit-$tag"
rm -rf "$out"
echo "离线包：deploy/out/gentransit-$tag.tar.gz"
echo "在内网服务器上：tar xzf 解压 → docker load -i images.tar.gz → 复制 .env.example 为 .env 并填写 → docker compose up -d --no-build"
