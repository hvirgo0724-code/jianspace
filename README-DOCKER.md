# 筑见 · Docker 部署说明

更新：2026-10-24。适用于本仓库 `compose.yaml`。一条命令启动 Web、API、Celery Worker、PostgreSQL 与 Redis；本机访问 `http://127.0.0.1:8080`。

## 架构

```text
浏览器 → 127.0.0.1:8080（Nginx / Web）
                     └─ /api/ → api:8000（FastAPI）
                                  ├─ db:5432（PostgreSQL 17）
                                  ├─ redis:6379（Celery Broker）
                                  └─ worker（Celery，处理生图/识别/导出任务）
共享卷：postgres_data、redis_data、asset_data（私有图片与导出文件）
```

只有 Web 端口映射到宿主机，数据库、Redis、API 不暴露公网。Web 默认只绑定 `127.0.0.1`，适合本机试用或放在 HTTPS 反向代理之后。

## 前置条件

- Docker Engine / Docker Desktop，含 Compose v2（已验证 Docker 29.7.2、Compose v5.4.0）。
- 可用端口 `8080`。
- 首次构建需要访问 Docker Hub、npm 与 PyPI；镜像构建完成后可离线重启。

## 一键启动

Windows（PowerShell）：

```powershell
cd D:\web_002\web\jianspace
.\scripts\docker-deploy.ps1
```

Linux / macOS：

```bash
cd jianspace
bash scripts/docker-deploy.sh
```

脚本会：
1. 检查 Docker 是否运行；
2. 若没有 `.env.docker`，就从 `.env.docker.example` 复制一份，生成随机数据库密码，并尽量沿用本地 `.env` 里的百炼、天气、SMTP 配置；
3. 执行 `docker compose --env-file .env.docker up -d --build`；
4. 轮询首页，最多等待 180 秒，然后打印访问地址与常用命令。

停止（保留数据）：

```powershell
.\scripts\docker-deploy.ps1 -Stop
```

```bash
bash scripts/docker-deploy.sh --stop
```

不重新构建、直接启动：加 `-NoBuild`（PowerShell）或 `--no-build`（Bash）。

## 首次使用

1. 打开 `http://127.0.0.1:8080`。示例配置为 `APP_ENV=development`，点“开启设计体验”即可直接进入；也可以邮箱密码注册。
2. 体验账户自带 100 点积分；注册账户默认 6 点，登录后在“账户”页领取家庭版试用积分（默认 30 点、14 天）。
3. 一次效果图生成 10 点、局部改图 8 点、平面图识别 5 点。
4. 未配置百炼 Key 时，量房、布局、预算与导出仍可用，但效果图、局部改图、平面图识别和小筑 AI 叙述不可用。
5. 对外公开部署时改成 `APP_ENV=production`：体验账户与管理员密码登录会关闭，必须使用 HTTPS 与 `COOKIE_SECURE=true`。

## 手动启动

```powershell
Copy-Item .env.docker.example .env.docker
# 修改 .env.docker：至少设置 POSTGRES_PASSWORD、DASHSCOPE_API_KEY
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
```

## 关键配置

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | 必填 | 数据库密码；脚本会自动生成 |
| `PUBLIC_URL` | `http://127.0.0.1:8080` | 公开访问地址，用于分享链接与邮件链接 |
| `COOKIE_SECURE` | `false` | 本机 HTTP 用 `false`；HTTPS 部署必须设为 `true` |
| `APP_ENV` | `development` | 示例配置开放体验账户；公开部署改为 `production`（强制 HTTPS/PostgreSQL/Celery） |
| `NPM_REGISTRY` | `https://registry.npmjs.org` | 构建期 npm 源；示例配置默认换成国内镜像 |
| `PIP_INDEX_URL` | `https://pypi.org/simple` | 构建期 PyPI 源；示例配置默认换成国内镜像 |
| `ALLOW_AI_CALLS` | `false` | 是否允许调用百炼；需同时配置 Key |
| `DASHSCOPE_API_KEY` | 空 | 百炼密钥，仅保存在服务端 |
| `DASHSCOPE_IMAGE_MODEL` | `qwen-image-2.0-pro` | 生图主模型 |
| `DASHSCOPE_IMAGE_FALLBACK_MODELS` | `qwen-image-2.0` | 可选备用模型，逗号分隔 |
| `DASHSCOPE_VISION_MODEL` | `qwen3-vl-plus` | 户型识别与结构检查 |
| `DASHSCOPE_TEXT_MODEL` | `qwen3.8-27b` | 小筑文本模型；留空只用规则知识库 |
| `WEATHER_DEFAULT_CITY` | 空 | 小筑天气默认城市；留空则反问城市 |
| `REGISTRATION_CREDITS` | `6` | 新账户初始积分 |
| `FAMILY_TRIAL_CREDITS` / `FAMILY_TRIAL_DAYS` | `30` / `14` | 家庭版试用积分与天数 |
| `SMTP_*` / `SUPPORT_EMAIL` | 空 | 密码恢复、邮箱验证与转人工通知 |
| `STORAGE_BACKEND` / `S3_*` | `local` | 默认本地卷；可切换 S3 兼容存储 |

修改 `.env.docker` 后执行：

```powershell
docker compose --env-file .env.docker up -d
```

API 与 Worker 会重建容器并读取新配置，不需要重新构建镜像。

## 对外 HTTPS 部署

1. 用 Caddy、Nginx 或云负载均衡把域名转发到 `127.0.0.1:8080`。
2. 修改 `.env.docker`：

```dotenv
PUBLIC_URL=https://jianspace.example.com
COOKIE_SECURE=true
```

3. 重新执行 `docker compose --env-file .env.docker up -d`。
4. 确认反向代理传递 `X-Forwarded-For` 与 `X-Forwarded-Proto`；Nginx 容器已把客户端 IP 继续传给 API。

Caddy 示例：

```caddyfile
jianspace.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

不要把 `8080` 直接暴露到公网；仓库内的 Nginx 只负责静态文件与同源 API 代理，不包含证书。

## 常用运维

```powershell
# 状态与日志
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f api worker web

# 健康检查
curl http://127.0.0.1:8080/api/health

# 小筑转人工工单（运维 CLI）
docker compose --env-file .env.docker exec api python scripts/handoffs.py
docker compose --env-file .env.docker exec api python scripts/handoffs.py --id <工单ID> --resolution "已电话回访" --set-status resolved

# 停止（保留数据）
docker compose --env-file .env.docker down

# 停止并删除数据卷（不可恢复）
docker compose --env-file .env.docker down -v
```

## 备份与恢复

PostgreSQL 逻辑备份：

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
docker compose --env-file .env.docker exec -T db pg_dump -U jianspace -d jianspace -Fc > backups\jianspace.dump
```

图片与导出文件：

```powershell
docker compose --env-file .env.docker cp api:/app/data/assets ./backups/assets
```

恢复时先停止 `api` 与 `worker`，再执行 `pg_restore` 并回填 `asset_data` 卷。`scripts/backup.py` 只适用于本地 SQLite，不要用于这里。

## 升级

```powershell
git pull
.\scripts\docker-deploy.ps1
```

脚本会重新构建并执行 `alembic upgrade head`，迁移失败时不会启动 API。升级前先备份数据库与资产。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 端口 8080 被占用 | 关闭占用进程，或修改 `compose.yaml` 里的端口映射 |
| 登录后立刻掉线 | 本机 HTTP 时必须 `COOKIE_SECURE=false`；HTTPS 时必须 `true` |
| `migrate` 退出非 0 | `docker compose --env-file .env.docker logs migrate`，检查数据库密码与迁移 |
| 构建时 npm ECONNRESET 或镜像 401 | 检查 `.env.docker` 的 `NPM_REGISTRY`、`PIP_INDEX_URL`；也可先手动 `docker pull python:3.12-slim node:24-alpine nginx:1.28-alpine` |
| AI 按钮禁用 | 检查 `ALLOW_AI_CALLS`、`DASHSCOPE_API_KEY`，并 `up -d` 重建容器 |
| 任务一直排队 | 查看 `worker` 日志与 Redis 健康状态；确认 `TASK_BACKEND=celery` |
| 首页 502 | API 健康检查未通过，查看 `api` 日志与数据库连接 |
| 上传图片失败 | 检查 `asset_data` 卷权限与剩余磁盘空间 |

## 已验证范围与限制

已在 Docker 29.7.2 / Compose v5.4.0 上实际构建并启动完整栈：PostgreSQL 17、Redis 7.4、Alembic 迁移、API、Celery Worker、Nginx Web。验证结果：

- `docker compose ps` 中 db、redis、api、web 均为 healthy，`worker` 正常运行。
- `http://127.0.0.1:8080` 首页加载正常，浏览器控制台无 CSP 或 `/api` 报错；体验账户可登录并进入项目概览。
- 通过 Web 代理完成一次真实任务：上传虚构平面图 → Celery 后台识别 → 2 个空间、3 个门窗，5 应用积分结算（100→95），草稿要求复核。
- 本机数据写入 Docker 卷，与本地开发 SQLite 库互不影响。

未包含/未验证：
- 内置 TLS 证书与域名：需要自备反向代理。
- 支付、套餐购买与运营后台：当前只有应用积分与家庭版试用。
- 多节点高可用、对象存储联调、真实 SMTP 发信、备份恢复演练、生产 HTTPS 模式实机验证。
- 生产模式管理员密码登录被禁用；转人工工单请使用上面的运维 CLI。
