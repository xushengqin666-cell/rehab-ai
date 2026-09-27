# tests/start-servers.ps1 — 一键启动测试环境（幂等 + 就绪等待）
# 1) 清掉 8000/8555 上所有历史监听进程（孤儿 python 会互相冲突）
# 2) 用 Start-Process 脱离启动（不随 pwsh 包装进程消亡）
# 3) v2.42.2：改成轮询等待真正就绪。原来固定等 2 秒，冷启动时 8000 还没起来，
#    调用方（finish-release.ps1）会读到 DOWN，整套验收直接崩在第一屏
#    （SecurityError: Failed to read the 'localStorage' property ... Access is denied）。
#    未就绪时以退出码 1 结束，调用方必须终止流程。
$ErrorActionPreference = 'Continue'

function Get-ListeningPid($port) {
  $pids = @()
  try {
    # 首选 Get-NetTCPConnection：netstat 文本解析在本机对刚启动的进程不可靠
    $pids += @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess)
  } catch {
    $rows = netstat -ano | Select-String ":$port\s+.*LISTENING"
    foreach ($r in $rows) {
      $m = [regex]::Match($r.Line.Trim(), '(\d+)\s*$')
      if ($m.Success) { $pids += [int]$m.Groups[1].Value }
    }
  }
  return @($pids | Sort-Object -Unique)
}

function Kill-Port($port) {
  Get-ListeningPid $port | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800
}

# 静态服务器：必须真的返回 200 才算就绪
function Wait-HttpOk($url, $seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try { if ((Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 3).StatusCode -eq 200) { return '200' } } catch { }
    Start-Sleep -Milliseconds 500
  }
  return 'DOWN'
}

# mock-supabase：根路由本来就是 404，任何 HTTP 响应都说明进程在线
function Wait-HttpAny($url, $seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try { Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 3 | Out-Null; return 'up' } catch { if ($_.Exception.Response) { return 'up' } }
    Start-Sleep -Milliseconds 500
  }
  return 'DOWN'
}

Kill-Port 8000
Kill-Port 8555
$root = 'C:\Users\User\Desktop\项目文件夹\rehab-app'
Start-Process -FilePath 'python' -ArgumentList '-m','http.server','8000','--bind','0.0.0.0' -WorkingDirectory $root -WindowStyle Hidden
Start-Process -FilePath 'node' -ArgumentList 'tests\mock-supabase.mjs' -WorkingDirectory $root -WindowStyle Hidden

$s8000 = Wait-HttpOk 'http://127.0.0.1:8000/index.html' 30
$s8555 = Wait-HttpAny 'http://127.0.0.1:8555/' 30
"8000: $s8000 | 8555: $s8555"
if ($s8000 -ne '200') { Write-Host '静态服务器 8000 未就绪 → 验收会崩在第一屏，已中止'; exit 1 }
exit 0
