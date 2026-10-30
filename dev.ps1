param(
    [int]$BackendPort = 3000,
    [int]$WebPort = 5173
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$webDir = Join-Path $root 'web'

if (-not (Test-Path (Join-Path $webDir 'node_modules'))) {
    Write-Host "前端依赖未安装，请先执行: cd web; npm install" -ForegroundColor Yellow
    exit 1
}

$busy = $false
try {
    $busy = [bool](Get-NetTCPConnection -State Listen -LocalPort $BackendPort -ErrorAction SilentlyContinue)
} catch {
    $busy = $false
}

if ($busy) {
    Write-Host "端口 $BackendPort 已被占用，后端会自动改用其他端口，导致前端代理失效。" -ForegroundColor Red
    Write-Host "请先释放该端口，或改用: .\dev.ps1 -BackendPort 3001" -ForegroundColor Red
    exit 1
}

$shell = (Get-Process -Id $PID).Path

Write-Host "启动后端 http://localhost:$BackendPort ..." -ForegroundColor Cyan
Start-Process $shell -ArgumentList '-NoExit', '-Command', "cd '$root'; go run main.go" -WorkingDirectory $root

$backendReady = $false
for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 1
    try {
        if ((Invoke-WebRequest "http://localhost:$BackendPort/api/status" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) {
            $backendReady = $true
            break
        }
    } catch {
    }
}

if (-not $backendReady) {
    Write-Host "后端 120 秒内未就绪，请查看后端窗口的输出。" -ForegroundColor Red
    exit 1
}

Write-Host "启动前端 http://localhost:$WebPort ..." -ForegroundColor Cyan
Start-Process $shell -ArgumentList '-NoExit', '-Command', "cd '$webDir'; `$env:VITE_REACT_APP_SERVER_URL='http://localhost:$BackendPort'; node node_modules/@rsbuild/core/bin/rsbuild.js dev --port $WebPort" -WorkingDirectory $webDir

for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    try {
        if ((Invoke-WebRequest "http://localhost:$WebPort/" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) {
            break
        }
    } catch {
    }
}

Start-Process "http://localhost:$WebPort/"
Write-Host "已启动: 前端 http://localhost:$WebPort  ->  后端 http://localhost:$BackendPort" -ForegroundColor Green
Write-Host "在各自窗口按 Ctrl+C 关闭服务。"
