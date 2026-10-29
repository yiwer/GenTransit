# 部署与运维手册

GenTransit 用 Docker 单机部署：数据库、应用、备份三个容器（M4 计划第 4、5 节）。本文按顺序写首次部署、日常运维、升级回退、备份恢复与演练。

| 容器 | 镜像 | 说明 |
|---|---|---|
| `db` | `postgres:16.15-bookworm` | 数据在卷 `gt-db`；默认不对外暴露端口；保持 UTC 时区 |
| `app` | `gentransit:<版本>` | 启动时自动执行数据库迁移；端口默认 8080；上传文件在卷 `gt-uploads` |
| `backup` | `postgres:16.15-bookworm` | 每天定时备份数据库与上传文件到宿主机的 `./backups` |

Compose 的项目名固定为 `gentransit-app`，和开发库（`docker-compose.dev.yml`，项目名 `gentransit`）在同一台机器上互不干扰。

---

## 1. 准备

- **服务器：** Linux，Docker 24 以上并带 Compose 插件（`docker compose version` 能输出版本）。2 核 4 GB 内存起步；磁盘按照片量估算，备份目录另算（见第 6 节）。
- **高德：** 在高德开放平台准备三样东西：
  - JS API Key 与安全密钥：同一个"Web 端（JS API）"应用里生成。
  - Web 服务 Key：逆地理编码用，可选；没有时站点表单不给区划建议，地图照常可用。
  - 在 JS API Key 的**域名白名单**里加上用户访问系统的域名（或 IP）。
- **网络：** 应用容器要能访问 `webapi.amap.com`、`restapi.amap.com`、`fmap01.amap.com`（高德代理与逆地理编码）；浏览器要能访问高德的 JS 与瓦片域名。

## 2. 首次部署

### 能上网的服务器

```bash
git clone <仓库地址> gentransit && cd gentransit
cp .env.example .env      # 按第 3 节填写
bash deploy/build.sh      # 构建镜像 gentransit:<版本>-<短哈希> 与 latest
docker compose up -d --no-build
docker compose ps         # app 显示 healthy 即可
```

浏览器打开 `http://服务器:8080`，用 `.env` 里的 `GT_ADMIN_USERNAME`、`GT_ADMIN_PASSWORD` 登录，登录后尽快在"设置 → 账号"里改密码。初始账号只在库里还没有账号时创建，之后改 `.env` 不再生效。

### 不能上网的内网服务器（离线包）

在一台能上网、装了 Docker 的机器上：

```bash
bash deploy/pack.sh       # 产物 deploy/out/gentransit-<版本>.tar.gz
```

拷到内网服务器后：

```bash
tar xzf gentransit-<版本>.tar.gz && cd gentransit-<版本>
docker load -i images.tar.gz
cp .env.example .env      # 填写；GT_VERSION 填 VERSION 文件里的值，或留空用 latest
docker compose up -d --no-build
```

离线包里有 `docker-compose.yml`、`deploy/`（备份、恢复、演练脚本）、`.env.example` 与本手册。

## 3. 环境变量

`.env` 放在 `docker-compose.yml` 同一目录。完整列表见 `.env.example`，部署必看这几项：

| 变量 | 说明 |
|---|---|
| `POSTGRES_PASSWORD` | 数据库密码，**必填**，只用字母和数字（会拼进连接串） |
| `SESSION_SECRET` | 至少 32 个字符的随机串，例如 `openssl rand -hex 32` |
| `GT_ADMIN_USERNAME`、`GT_ADMIN_PASSWORD` | 初始账号 |
| `AMAP_JSAPI_KEY`、`AMAP_JSAPI_SECURITY_CODE`、`AMAP_WEB_SERVICE_KEY` | 高德三个变量。也可以设为宿主机环境变量（优先于 `.env`）。只在运行时传入，不进镜像 |
| `GT_HTTP_PORT` | 对外端口，默认 8080 |
| `TRUST_PROXY` | 信任哪些代理的 `X-Forwarded-*`，默认 `loopback,uniquelocal`（含 Docker 网桥） |
| `BACKUP_TIME`、`BACKUP_RETENTION_DAYS` | 每天几点备份（默认 02:30）、保留几天（默认 30） |
| `TZ` | 应用与备份容器的时区，默认 `Asia/Shanghai`。数据库容器不设，保持 UTC |
| `GT_BACKUP_PATH` | 备份目录在宿主机上的位置，默认 `./backups` |

`.env` 里开发用的 `DATABASE_URL`、`UPLOAD_DIR` 等在部署时会被 compose 覆盖，同一个文件两种场景都能用。

**安全：** 安全密钥与 Web 服务 Key 只在服务端使用：浏览器经 `/_AMapService` 代理访问高德，代理在服务端附加安全密钥，并把上游回显里的密钥换成 `***`。镜像构建不读取 `.env`（`.dockerignore` 排除了它）。

## 4. HTTPS 反向代理

建议在前面放一个 HTTPS 反向代理。此时把端口只绑到本机，在 `.env` 里设 `GT_HTTP_PORT=127.0.0.1:8080`。Nginx 示例：

```nginx
server {
    listen 443 ssl http2;
    server_name transit.example.com;
    ssl_certificate     /etc/nginx/certs/transit.crt;
    ssl_certificate_key /etc/nginx/certs/transit.key;
    client_max_body_size 25m;              # 导入文件最大 20 MB

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;           # 大批量导入
    }
}
server {
    listen 80;
    server_name transit.example.com;
    return 301 https://$host$request_uri;
}
```

应用根据 `X-Forwarded-Proto` 判断 HTTPS，给登录 Cookie 加 `Secure`。反向代理不在本机或不在私有网段时，把它的地址加进 `TRUST_PROXY`。记得把 HTTPS 域名加进高德 JS API Key 的域名白名单。

## 5. 日常运维

```bash
docker compose ps                      # 状态与健康检查
docker compose logs -f app             # 应用日志（JSON，一行一条；不记录请求头与密钥）
docker compose logs --tail 100 backup  # 备份日志
docker compose restart app
docker compose down                    # 停止（数据在卷里，不会丢）
```

- 日志用 `json-file`，单个文件 10 MB、保留 5 个，不会撑满磁盘。
- 系统里"设置 → 备份"显示最近一次备份与 30 天日历；备份超过 48 小时没有成功或最近一次失败时，工作台顶部有提醒。
- 只读 API 的文档在 `/api/v1/docs`，Token 在"设置 → API Token"里管理。

## 6. 备份与恢复

### 备份的内容

每天 `BACKUP_TIME` 自动备份一次，失败 1 小时后重试（最多 3 次）。每份备份是 `backups/<YYYYMMDD-HHMMSS>/`：

- `db.dump`：`pg_dump -Fc` 导出的整个数据库。
- `uploads/`：上传文件的完整文件树。未变化的文件与上一份硬链接，不重复占空间；删除旧备份不影响其他备份。
- `manifest.json`：时间、应用版本、最后一个迁移、导出文件的大小与 SHA-256、文件数、各表行数。

保留 `BACKUP_RETENTION_DAYS` 天，但始终保留最新一份。状态写在 `backups/status.json`，失败原因写在 `backups/failures/`。

**磁盘估算：** 数据库导出通常几十 MB；照片只占一份空间（硬链接）。按"数据库导出 × 30 + 全部照片"预留。

**放到别的机器：** 备份目录就是普通文件，用 `rsync -aH`（`-H` 保留硬链接）同步到另一台机器或 NAS，例如每天 04:00：

```bash
0 4 * * * rsync -aH --delete /srv/gentransit/backups/ backup-host:/data/gentransit-backups/
```

### 手动备份

```bash
docker compose exec backup bash /scripts/backup.sh manual
```

**升级前一定先手动备份一次。**

### 恢复

```bash
ls backups/                          # 选一份
bash deploy/restore.sh 20261028-023000   # 要求再输入一次备份名确认；加 --yes 跳过
```

脚本依次：停止 app → 先给当前数据备份一份（后缀 `-pre-restore`，选错时还能回去）→ 删库重建并还原 → 清空上传卷并复制文件树 → 核对行数与文件数 → 启动 app 并等健康检查通过。备份来自旧版本时，app 启动时会自动把迁移补齐。

**换机器恢复：** 新机器按第 2 节准备好 `.env` 与镜像，把那一份备份目录拷到新机器的 `backups/` 下，执行 `docker compose up -d --no-build db` 后运行 `bash deploy/restore.sh <备份名>`。

## 7. 演练

`deploy/drill.sh` 在独立的 compose 项目 `gentransit-drill` 里完整走一遍：构建镜像并检查镜像里没有 `.env` 与高德密钥 → 启动环境 A 写入种子数据、上传图片、新建 Token → 备份并记下指纹（各表行数与内容 md5、上传文件的 SHA-256）→ 改数据 → 原地恢复并核对指纹 → 在全新环境 B 上只用备份目录恢复，核对指纹、登录、Token 调用只读 API、下载图片比对字节 → `down -v` 清理。结论写在 `deploy/drill-work/drill-report.md`。

演练用自己的卷、端口（18080、55439）与备份目录，不碰正式部署与开发库，也不需要 `.env`。建议在新服务器上线前、以及每次大版本升级前跑一次：

```bash
bash deploy/drill.sh
```

在正式服务器上做"真恢复"演练的做法：找一台空闲机器按"换机器恢复"的步骤用最近一份备份恢复，登录核对几个站点与站牌集，再用 Token 调一次 `/api/v1/stops`。

## 8. 升级与回退

**升级：**

1. 手动备份一次（第 6 节）。
2. 拿到新版本：`git pull && bash deploy/build.sh`，或加载新的离线包 `docker load -i images.tar.gz`。
3. 在 `.env` 里把 `GT_VERSION` 改成新标签（用 `latest` 时可省略），执行 `docker compose up -d --no-build`。app 启动时自动执行迁移，`docker compose logs app` 能看到迁移记录。

**回退：** 迁移只向前，不能自动回退。回退等于：把 `GT_VERSION` 改回旧标签，再用升级前那份手动备份恢复（`bash deploy/restore.sh <备份名>`）。升级后新录入的数据会丢失，所以回退要尽早决定。

## 9. 常见问题

- **app 一直不健康：** `docker compose logs app`。迁移失败时容器会退出，日志里有原因；常见的是 `POSTGRES_PASSWORD` 含特殊字符导致连接串不合法。
- **地图是灰色示意平面：** 没有配置 `AMAP_JSAPI_KEY` 或 `AMAP_JSAPI_SECURITY_CODE`（两个都要有）；或者 JS API Key 的域名白名单里没有当前访问的域名。
- **站点表单没有区划建议：** 没有配置 `AMAP_WEB_SERVICE_KEY`，或者容器访问不到 `restapi.amap.com`。
- **构建时 apt、npm 连不上 `127.0.0.1:端口`：** Docker 客户端配置里的代理会传进构建容器，而容器里的 127.0.0.1 是容器自己。执行 `GT_BUILD_PROXY=direct bash deploy/build.sh`（不用代理）或 `GT_BUILD_PROXY=http://代理地址:端口 bash deploy/build.sh`。
- **登录后马上被踢回登录页（HTTPS 下）：** 反向代理没有传 `X-Forwarded-Proto`，或者它的地址不在 `TRUST_PROXY` 里。
- **备份失败：** 看"设置 → 备份"的错误信息与 `backups/failures/`；常见是磁盘满了。处理后可以手动备份一次确认。
- **Windows 上运行脚本：** 用 Git Bash 执行 `bash deploy/*.sh`。仓库的 `.gitattributes` 保证脚本是 LF 换行。
- **脚本提示没有执行权限：** 用 `bash deploy/xxx.sh` 执行；容器里的备份脚本也都是用 `bash` 调用的。
