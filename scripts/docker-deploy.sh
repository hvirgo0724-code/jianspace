#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

NO_BUILD=0
STOP=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    --stop) STOP=1 ;;
    *) echo "未知参数：$arg（可用：--no-build、--stop）" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "未找到 Docker，请先安装。" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker 未运行，请先启动 Docker。" >&2; exit 1; }

if [ "$STOP" = "1" ]; then
  if [ -f .env.docker ]; then
    docker compose --env-file .env.docker down
  else
    echo "未找到 .env.docker，无需停止。"
  fi
  exit 0
fi

if [ ! -f .env.docker ]; then
  if command -v openssl >/dev/null 2>&1; then
    PASS=$(openssl rand -hex 24)
  else
    PASS=$(head -c 64 /dev/urandom | md5sum | cut -c1-48)
  fi
  awk -v p="$PASS" '{ if ($0 ~ /^POSTGRES_PASSWORD=/) print "POSTGRES_PASSWORD=" p; else print }' \
    .env.docker.example > .env.docker

  set_value() {
    local key="$1" value="$2" tmp
    tmp=$(mktemp)
    awk -v k="$key" -v v="$value" '
      index($0, k "=") == 1 { print k "=" v; next }
      { print }
    ' .env.docker > "$tmp"
    mv "$tmp" .env.docker
  }

  if [ -f .env ]; then
    for key in ALLOW_AI_CALLS DASHSCOPE_API_KEY DASHSCOPE_IMAGE_MODEL \
      DASHSCOPE_IMAGE_FALLBACK_MODELS DASHSCOPE_VISION_MODEL DASHSCOPE_TEXT_MODEL \
      DASHSCOPE_API_BASE AI_IMAGE_CREDITS AI_INPAINT_CREDITS AI_PLAN_CREDITS \
      AI_DAILY_LIMIT AI_STRUCTURE_REVIEW_ENABLED WEATHER_ENABLED WEATHER_DEFAULT_CITY \
      SUPPORT_EMAIL SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_FROM; do
      value=$(grep -E "^${key}=" .env | head -n 1 | cut -d= -f2- || true)
      if [ -n "${value:-}" ]; then set_value "$key" "$value"; fi
    done
  fi
  echo "已生成 .env.docker（数据库密码为随机值）。"
fi

if [ "$NO_BUILD" = "1" ]; then
  docker compose --env-file .env.docker up -d
else
  docker compose --env-file .env.docker up -d --build
fi

READY=0
if command -v curl >/dev/null 2>&1; then
  for _ in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:8080 >/dev/null 2>&1; then READY=1; break; fi
    sleep 3
  done
fi

docker compose --env-file .env.docker ps
if [ "$READY" = "0" ] && command -v curl >/dev/null 2>&1; then
  echo "容器已启动，但 180 秒内首页未就绪。请运行：docker compose --env-file .env.docker logs api worker web" >&2
  exit 1
fi

echo ""
echo "筑见已启动： http://127.0.0.1:8080"
echo "打开首页后可直接使用体验账户，也可注册；注册账户在“账户”页领取家庭版试用积分。"
if grep -q '^DASHSCOPE_API_KEY=$' .env.docker; then
  echo "提示：未配置 DASHSCOPE_API_KEY，AI 生图与平面图识别不可用；编辑 .env.docker 后重新运行本脚本。"
fi
echo "查看日志： docker compose --env-file .env.docker logs -f api worker"
echo "停止服务： ./scripts/docker-deploy.sh --stop"
