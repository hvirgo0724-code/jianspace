param(
    [switch]$NoBuild,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $Root
$EnvFile = Join-Path $Root '.env.docker'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw '未找到 Docker。请先安装 Docker Desktop 并启动。'
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker 未运行。请启动 Docker Desktop 后重试。'
}

if ($Stop) {
    if (Test-Path $EnvFile) {
        & docker compose --env-file $EnvFile down
    } else {
        Write-Host '未找到 .env.docker，无需停止。'
    }
    exit $LASTEXITCODE
}

if (-not (Test-Path $EnvFile)) {
    $lines = [IO.File]::ReadAllLines((Join-Path $Root '.env.docker.example'), $Utf8)
    $bytes = New-Object byte[] 24
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $password = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    $lines = $lines | ForEach-Object {
        if ($_ -match '^POSTGRES_PASSWORD=') { "POSTGRES_PASSWORD=$password" } else { $_ }
    }

    # Reuse the developer .env for AI, weather and mail settings when available.
    $inherited = @(
        'ALLOW_AI_CALLS', 'DASHSCOPE_API_KEY', 'DASHSCOPE_IMAGE_MODEL',
        'DASHSCOPE_IMAGE_FALLBACK_MODELS', 'DASHSCOPE_VISION_MODEL',
        'DASHSCOPE_TEXT_MODEL', 'DASHSCOPE_API_BASE', 'AI_IMAGE_CREDITS',
        'AI_INPAINT_CREDITS', 'AI_PLAN_CREDITS', 'AI_DAILY_LIMIT',
        'AI_STRUCTURE_REVIEW_ENABLED', 'WEATHER_ENABLED', 'WEATHER_DEFAULT_CITY',
        'SUPPORT_EMAIL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER',
        'SMTP_PASSWORD', 'SMTP_FROM'
    )
    if (Test-Path (Join-Path $Root '.env')) {
        $values = @{}
        foreach ($line in [IO.File]::ReadAllLines((Join-Path $Root '.env'), $Utf8)) {
            if ($line -match '^\s*([A-Za-z0-9_]+)\s*=(.*)$') {
                $values[$matches[1]] = $matches[2].Trim()
            }
        }
        foreach ($key in $inherited) {
            if ($values.ContainsKey($key)) {
                $lines = $lines | ForEach-Object {
                    if ($_ -match "^$key=") { "$key=$($values[$key])" } else { $_ }
                }
            }
        }
    }
    [IO.File]::WriteAllLines($EnvFile, $lines, $Utf8)
    Write-Host "已生成 .env.docker（数据库密码为随机值）。" -ForegroundColor Green
}

$composeArgs = @('compose', '--env-file', $EnvFile, 'up', '-d')
if (-not $NoBuild) { $composeArgs += '--build' }
& docker @composeArgs
if ($LASTEXITCODE -ne 0) {
    throw 'docker compose 启动失败，请查看上面的日志。'
}

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8080' -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 3
}

& docker compose --env-file $EnvFile ps
if (-not $ready) {
    Write-Warning '容器已启动，但 180 秒内首页未就绪。请运行：docker compose --env-file .env.docker logs api worker web'
    exit 1
}

$keyLine = ([IO.File]::ReadAllLines($EnvFile, $Utf8) | Where-Object { $_ -match '^DASHSCOPE_API_KEY=' } | Select-Object -First 1)
Write-Host ''
Write-Host '筑见已启动： http://127.0.0.1:8080' -ForegroundColor Green
Write-Host '打开首页后可直接使用体验账户，也可注册；注册账户在“账户”页领取家庭版试用积分。'
if (-not $keyLine -or $keyLine -eq 'DASHSCOPE_API_KEY=') {
    Write-Host '提示：未配置 DASHSCOPE_API_KEY，AI 生图与平面图识别不可用；编辑 .env.docker 后重新运行本脚本。' -ForegroundColor Yellow
}
Write-Host '查看日志： docker compose --env-file .env.docker logs -f api worker'
Write-Host '停止服务： .\scripts\docker-deploy.ps1 -Stop'
