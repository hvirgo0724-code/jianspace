$ErrorActionPreference='Stop'
$ProjectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $ProjectRoot
& '.\.venv\Scripts\python.exe' -m pytest apps/api/tests -q
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& npm.cmd test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& npm.cmd run build
exit $LASTEXITCODE
