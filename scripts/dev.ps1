param([ValidateSet('all','api','web')][string]$Service='all')
$ErrorActionPreference='Stop'
$ProjectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $ProjectRoot
if (!(Test-Path -LiteralPath '.venv\Scripts\python.exe')) { throw '请先按 README 创建 Python 3.12 虚拟环境并安装依赖。' }
if ($Service -eq 'api') { & '.\.venv\Scripts\python.exe' -m uvicorn interior.main:app --app-dir apps/api --host 127.0.0.1 --port 8000; exit $LASTEXITCODE }
if ($Service -eq 'web') { & npm.cmd run dev; exit $LASTEXITCODE }
$ApiProcess=Start-Process -FilePath (Join-Path $ProjectRoot '.venv\Scripts\python.exe') -ArgumentList @('-m','uvicorn','interior.main:app','--app-dir','apps/api','--host','127.0.0.1','--port','8000') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
try { Write-Host '筑见前端 http://127.0.0.1:5180  | API http://127.0.0.1:8000/docs'; & npm.cmd run dev }
finally { if (!$ApiProcess.HasExited) { Stop-Process -Id $ApiProcess.Id } }
