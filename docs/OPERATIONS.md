# 运维说明

## 本地模式

默认仅监听本机 5180/8000。数据在 `data/jianspace.db`、照片和导出在 `data/assets/`；这两个目录不进版本库。清理依赖或重装源码时不要误删用户数据目录。

SQLite 使用 WAL，适合开发和单进程体验。数据库调度器串行处理任务，并发/高负载请切换 PostgreSQL+Redis+Celery。进程崩溃后超过 300 秒租约的任务会失败并释放应用积分；收费请求可能已送至服务商，不会自动重试。

## 部署模式

`compose.yaml` 提供独立网络中的 PostgreSQL 17、Redis 7.4、一次性迁移、API、Worker 与 Nginx Web。一键启动使用 `.\scripts\docker-deploy.ps1`（Windows）或 `bash scripts/docker-deploy.sh`；脚本生成 `.env.docker` 并启动完整栈，详见 [Docker 部署说明](../README-DOCKER.md)。

`APP_ENV=production` 会拒绝 SQLite、非安全 Cookie 和非 Celery 任务后端，也会禁用体验账号，因此对外部署必须同时设置 `PUBLIC_URL=https://你的域名`、`COOKIE_SECURE=true`、`APP_ENV=production`。本机 HTTP 试用使用 `APP_ENV=development`。

在 `.env.docker` 中设置 `POSTGRES_PASSWORD`（脚本自动生成，仅字母数字避免 URL 解释问题）、`PUBLIC_URL`，以及可选的 AI/SMTP/S3 凭证。保持密钥仅服务端可见，不用 `VITE_*` 传递密钥。公网入口需使用可信 TLS 反代，转发至本机 8080；API、Redis 和数据库不绑定公网。

S3 兼容存储配置 `STORAGE_BACKEND=s3`、`S3_ENDPOINT_URL`、`S3_BUCKET`、访问密钥；桶必须私有。当前走服务端授权代理，撤销项目访问立即影响文件读取，无长期公开对象 URL。

已在 Docker 29.7.2 / Compose v5.4.0 上构建并启动完整栈，验证迁移、健康检查、Nginx 代理、体验登录和一次 Celery 平面图识别任务。多 Worker、S3、真实 SMTP、生产 HTTPS 反向代理与备份恢复演练仍需在目标基础设施上验收。

## 数据库迁移

从空库执行 `alembic upgrade head`。已有本版本开发库先备份再 `alembic stamp head`。未来修改数据模型必须新增迁移，不能用删除数据库代替升级。

PostgreSQL 的 JSON 字段使用 JSONB；工作副本修订号通过条件 UPDATE 防覆盖。项目元数据修订号与工作副本修订号不同。几何和设计版本只创建不覆盖。

## 积分与收费

生成任务在同一数据库事务中创建任务、Outbox 和积分冻结记录。结算/释放有唯一事件键。应用积分不是人民币余额。支付未启用，禁止把开发赠送或运维发放伪装成支付成功。

生产按 Redis 计数限制注册、登录及找回密码请求；本地使用单进程计数。补充 API 网关、队列积压告警与服务商月度预算限制后再开放规模使用。真实服务商用量应结合其账单核对。

## 本地备份

SQLite + 本地资产模式可直接生成一致性备份（不包含 `.env` 或密钥）：

```powershell
.\.venv\Scripts\python.exe scripts/backup.py --output backups --label before-upgrade
```

脚本使用 SQLite 在线备份接口复制数据库，并复制 `data/assets/`，输出 `manifest.json`（时间、数据库大小与 SHA-256、资产文件数与字节数）。恢复时停止 API/worker，将备份中的 `jianspace.db` 与 `assets/` 一起替换，再启动服务。PostgreSQL 部署须使用 `pg_dump` 与对象存储版本；本脚本会明确拒绝非 SQLite 数据库。

备份目录不能位于资产目录内部，避免递归复制。

## 小筑转人工工单

用户在小筑面板中提交工单后，记录保存在 `assistant_handoffs`。配置 `SUPPORT_EMAIL` 且 SMTP 可用时会发送通知；发送失败不影响工单创建。

```powershell
# 查看待处理工单
.\.venv\Scripts\python.exe scripts/handoffs.py --status pending
# 查看全部
.\.venv\Scripts\python.exe scripts/handoffs.py
# 回复并标记已解决（ID 可用前 8 位）
.\.venv\Scripts\python.exe scripts/handoffs.py --id 2d9e5555 --set-status resolved --resolution "已电话回访并确认验收节点。"
```

回复会以“【人工客服】”消息写回该用户的对话。管理员也可使用 `GET /api/admin/assistant/handoffs` 与 `PATCH /api/admin/assistant/handoffs/{id}`。当前没有管理员工单页面，需通过 CLI 或 API 处理。

## 删除与保留

项目删除立即阻止项目/文件访问并撤销分享，随后请求取消活动任务。当前采用软删除。运维可先预览：

```powershell
.\.venv\Scripts\python.exe scripts/cleanup.py --older-than-days 30
```

检查清单、完成备份且确认保留要求后，添加 `--execute` 才物理清理已删除且超过期限的项目及对象。存在活动任务的项目跳过，账本保留并解除任务关联。脚本不会物理清理未被用户删除的项目。

用户单张照片删除目前为不可访问标记，文件物理回收随项目清理；尚未提供独立图片引用计数和自动生命周期任务。备份脚本已提供，但定时备份、恢复演练、账号级删除、数据主体请求及法定保留策略仍需在正式发布前补齐。

## 支持与故障

- UI 显示任务失败码与友好说明；API 返回 `X-Request-Id`。
- `REVISION_CONFLICT`：保留浏览器草稿，下载 JSON 后载入服务器版本，不能重试覆盖。
- `MEASUREMENT_UNCONFIRMED`：修改几何后重新确认实测。
- `PROVIDER_NOT_CONFIGURED`：配置服务端密钥和调用开关，重启 API。
- `INSUFFICIENT_CREDITS`：无公共充值通道，按授权走运维发放。
- `WORKER_INTERRUPTED`：应用额度已释放，人工核对服务商实际请求，不盲目重放。
- `WALL_BOUNDARY_MISMATCH`：净轮廓需与墙内表面一致；不要缩放家具掩盖结构错误。

完整 OpenAPI 以 `docs/openapi.implemented.json` 和运行中的 `/docs` 为准；原设计文档包含尚未上线的目标接口。
