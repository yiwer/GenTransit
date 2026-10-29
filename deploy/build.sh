#!/usr/bin/env bash
# 构建应用镜像（M4 计划 4.1 节）：标签 gentransit:<版本>-<git 短哈希>，同时打 latest。
# 版本取根目录 package.json；工作区有未提交的改动时短哈希后加 -dirty。
# 用法：bash deploy/build.sh       输出最终标签到标准输出最后一行
# 构建时的代理：Docker 客户端配置里的代理会传进构建容器。指向 127.0.0.1 的代理在容器里连不上时，
#   GT_BUILD_PROXY=direct bash deploy/build.sh               构建时不用代理
#   GT_BUILD_PROXY=http://代理地址:端口 bash deploy/build.sh   构建时改用这个代理
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./package.json').version")
hash=$(git rev-parse --short HEAD 2>/dev/null || echo nogit)
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then hash="${hash}-dirty"; fi
tag="${version}-${hash}"

proxy_args=()
if [ -n "${GT_BUILD_PROXY:-}" ]; then
  p="${GT_BUILD_PROXY}"
  [ "$p" = direct ] && p=''
  for k in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy; do proxy_args+=(--build-arg "$k=$p"); done
fi

echo "构建 gentransit:${tag} …" >&2
docker build "${proxy_args[@]}" --build-arg "APP_VERSION=${tag}" -t "gentransit:${tag}" -t gentransit:latest . >&2
echo "${tag}"
