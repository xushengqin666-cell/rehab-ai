# tests/start-servers.ps1 — 一键启动测试环境（幂等）
# 1) 清掉 8000/8555 上所有历史监听进程（孤儿 python 会互相冲突）
# 2) 用 Start-Process 脱离启动（不随 pwsh 包装进程消亡）
$ErrorActionPreference = 'Continue'
function Kill-Port($port) {
  $rows = netstat -ano | Select-String (":$port\s+.*LISTENING")
  $pids = @()
  foreach ($r in $rows) {
    $m = [regex]::Match($r.Line.Trim(), '(\d+)\s*$')
    if ($m.Success) { $pids += [int]$m.Groups[1].Value }
  }
  $pids | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800
}
Kill-Port 8000
Kill-Port 8555
$root = 'C:\Users\User\Desktop\项目文件夹\rehab-app'
Start-Process -FilePath 'python' -ArgumentList '-m','http.server','8000','--bind','0.0.0.0' -WorkingDirectory $root -WindowStyle Hidden
Start-Process -FilePath 'node' -ArgumentList 'tests\mock-supabase.mjs' -WorkingDirectory $root -WindowStyle Hidden
Start-Sleep -Seconds 2
$s8000 = try { (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8000/index.html' -TimeoutSec 3).StatusCode } catch { 'DOWN' }
$s8555 = try { (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8555/' -TimeoutSec 3).StatusCode } catch { 'no-root-route(up)' }
"8000: $s8000 | 8555: $s8555"
