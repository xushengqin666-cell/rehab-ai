# 康复AI 一键收尾（版本号自动读 latest.json）：跑验收 → 通过才提交/构建/发版/刷新产物
# 用法（任选其一）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\项目文件夹\rehab-app\tests\finish-release.ps1"
#   pwsh     -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\项目文件夹\rehab-app\tests\finish-release.ps1"
#   ... 再加 -From 6   → 只从第 6 步开始跑（长流程被中断后续跑用：前几步的产物已在磁盘上，
#                        不必重跑十几分钟的验收和几分钟的构建）
#
# v2.42.2 修复（本次）：
#   1) 本文件存成 UTF-8 with BOM。本机没有 PowerShell 7（只有 5.1），无 BOM 时 5.1 按 ANSI
#      解码，脚本里的中文项目路径会变成乱码，脚本直接跑不起来（上一版就是这么坏的）。
#   2) 提交信息不再写死（原来无论发什么版本都提交「第 9 模块设置 + 第 10 模块全局收官」），
#      改为读 latest.json 的 notes；中文提交信息走 -F 文件，避免命令行传参编码出错。
#   3) 测试环境改为「等待就绪」：原来固定等 2 秒，冷启动时 8000 还没起来，
#      整套验收会崩在第一屏（SecurityError: localStorage Access is denied）。
#   4) 清理错名旧产物不再写死 v2.21.8，改为「同目录存在与当前版本同名、同尺寸的文件才算错名副本」。
#   5) CDP(9228) 探活改用 HTTP 探测（netstat 在本机对刚起来的进程不可靠）。
#   6) 发版前先跑 tests/preflight.mjs：把「文件被写坏成双重编码」「含中文的 .ps1 缺 BOM」
#      「版本号三处不一致」这三类事故挡在提交之前（v2.42.1 的界面乱码、上一版脚本跑不起来，
#      都是这一类；版本号漏改一处会让关于页显示旧版本）。
#   7) 分清两个目录（写混了会在 bundleRelease 之前报「找不到路径 ...\.rehab-cap\android」）：
#        $CAP      = C:\Users\User\rehab-cap         ← Capacitor 工程根目录，android/ 与 gradle 在这
#        $CAPSCRIPT= C:\Users\User\.rehab-cap\build-apk.ps1  ← 打包脚本（注意是隐藏目录）
#   8) 新增 -From 参数用于续跑；并修掉「查 Release 是否存在」的写法 —— gh 查不到版本时会往
#      stderr 写「release not found」，在 Stop 模式下会被 PowerShell 当成终止性错误，
#      直接把发版中断在创建 Release 之前，所以探活必须临时切到 Continue 并只看退出码。
#
# 说明：验收不过会立即中止，不会提交、不会构建、不会发版。
param([int]$From = 1)

$ErrorActionPreference = 'Stop'
$ROOT = 'C:\Users\User\Desktop\项目文件夹\rehab-app'
$CAP  = 'C:\Users\User\rehab-cap'
$CAPSCRIPT = 'C:\Users\User\.rehab-cap\build-apk.ps1'
$DESK = 'C:\Users\User\Desktop'
$env:JAVA_HOME = 'C:\jdk-21.0.12.1+1'
$env:ANDROID_HOME = 'C:\android-sdk'
$env:PATH = "$env:JAVA_HOME\bin;C:\android-sdk\platform-tools;$env:PATH"

# 版本号与更新说明的唯一来源：显式按 UTF-8 读，避免 5.1 默认 ANSI 读坏中文 notes
$meta = [IO.File]::ReadAllText("$ROOT\latest.json", [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
$VER  = $meta.version
$subject = ($meta.notes -replace '\s+', ' ').Trim()
# notes 通常以「v2.42.2 修复…」开头，而提交信息本身已经带 v$VER 前缀，去掉重复的版本号
$subject = $subject -replace ('^v?' + [regex]::Escape($VER) + '[:：\s]*'), ''
if ($subject.Length -gt 72) { $subject = $subject.Substring(0, 72) + '…' }
if (-not $subject) { $subject = '发版' }

function Step($n, $t) { Write-Host ''; Write-Host "=== $n $t ===" }
function Commit-Msg($msg) {
  $f = Join-Path $env:TEMP 'rh-commit-msg.txt'
  [IO.File]::WriteAllText($f, $msg, [Text.UTF8Encoding]::new($false))   # UTF-8 无 BOM：git 按 UTF-8 读
  git commit -F $f
  return $LASTEXITCODE
}
function Wait-Cdp($seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9228/json/version' -TimeoutSec 3 | Out-Null; return $true } catch { Start-Sleep -Milliseconds 500 }
  }
  return $false
}

Write-Host "版本号（latest.json）: $VER（从第 $From 步开始）"
Set-Location $ROOT

if ($From -le 1) {
  Step '1/8' '启动测试环境（8000 静态 + 8555 mock-supabase + 9228 无头 Chrome）'
  & powershell.exe -ExecutionPolicy Bypass -File "$ROOT\tests\start-servers.ps1"
  if ($LASTEXITCODE -ne 0) { throw '测试环境未就绪（8000 静态服务器没起来）→ 已中止' }
  $chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
  if (-not (Wait-Cdp 3)) {
    Start-Process -FilePath $chrome -ArgumentList '--headless=new','--disable-gpu','--no-first-run','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--remote-debugging-port=9228','--remote-allow-origins=*',"--user-data-dir=$env:TEMP\rh-cdp",'about:blank'
    if (-not (Wait-Cdp 20)) { throw '无头 Chrome CDP(9228) 未就绪 → 已中止' }
  }
  $env:RH_CDP_PORT = '9228'
}

if ($From -le 2) {
  Step '2/8' '发版前置检查 + 跑全量验收（全量日志：tests\_last-run.txt）'
  node tests/preflight.mjs
  if ($LASTEXITCODE -ne 0) { throw '发版前置检查未通过（乱码 / .ps1 缺 BOM / 版本号三处不一致）→ 已中止' }
  node tests/full.mjs | Out-Null
  $runCode = $LASTEXITCODE
  $log = "$ROOT\tests\_last-run.txt"
  $sum = (Select-String -Path $log -Pattern 'PASS \d+ / FAIL \d+ / ' | Select-Object -Last 1).Line
  Write-Host $sum
  if ((-not $sum) -or ($sum -notmatch 'FAIL 0 /')) {
    Select-String -Path $log -Pattern '^FAIL ' | ForEach-Object { Write-Host $_.Line }
    throw "验收未通过或没跑完（node 退出码 $runCode）→ 已中止（未提交、未构建、未发布）"
  }
  node tests/keycheck.mjs | Select-Object -Last 1
  if ($LASTEXITCODE -ne 0) { throw 'keycheck（i18n 键覆盖）未通过 → 已中止' }
  # 设计系统验收：DESIGN.md 的 token 必须真的落到运行时（覆盖层、统一度、无障碍四项）
  node tests/design-system.mjs
  if ($LASTEXITCODE -ne 0) { throw '设计系统验收未通过（DESIGN.md 与运行时不一致）→ 已中止' }
}

if ($From -le 3) {
  Step '3/8' '提交并推送网页版（GitHub Pages + jsDelivr 双源）'
  git add -A
  Commit-Msg "v$VER`: $subject" | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host '（无改动可提交，继续）' }
  git push
  if ($LASTEXITCODE -ne 0) { throw 'git push 失败' }
}

if ($From -le 4) {
  Step '4/8' '构建 APK/AAB（Capacitor 同步 + 签名）'
  & powershell.exe -ExecutionPolicy Bypass -File $CAPSCRIPT
  if ($LASTEXITCODE -ne 0) { throw 'build-apk.ps1 失败' }
  Set-Location "$CAP\android"
  .\gradlew.bat bundleRelease --no-daemon
  if ($LASTEXITCODE -ne 0) { throw 'gradlew bundleRelease 失败' }
}

if ($From -le 5) {
  Step '5/8' '归档安装包（downloads / 桌面安装包 / 上架提交包）'
  $apk = "$CAP\android\app\build\outputs\apk\release\app-release.apk"
  $aab = "$CAP\android\app\build\outputs\bundle\release\app-release.aab"
  if (-not (Test-Path $apk)) { throw "找不到 APK：$apk" }
  if (-not (Test-Path $aab)) { throw "找不到 AAB：$aab" }
  New-Item -ItemType Directory -Force -Path "$ROOT\downloads" | Out-Null
  Copy-Item $apk "$ROOT\downloads\RehabAI-v$VER.apk" -Force
  Copy-Item $aab "$ROOT\downloads\RehabAI-v$VER.aab" -Force
  Copy-Item $apk "$DESK\安装包\康复AI-v$VER.apk" -Force
  Copy-Item $aab "$DESK\安装包\康复AI-v$VER.aab" -Force
  Copy-Item $apk "$DESK\康复AI上架提交包\1-安装包\康复AI-v$VER.apk" -Force
  Copy-Item $aab "$DESK\康复AI上架提交包\1-安装包\康复AI-v$VER.aab" -Force
  # 上架提交包只留当前版本；桌面「安装包」保留历史版本（是用户的产物档案）
  Get-ChildItem -Path "$DESK\康复AI上架提交包\1-安装包\*" -Include '*.apk','*.aab' -File | Where-Object { $_.Name -notlike "*v$VER*" } | Remove-Item -Force -ErrorAction SilentlyContinue
  # 旧版打包脚本曾把产物名写死成 v2.21.8（与真实版本不符）。只在「同目录存在与当前版本同名、同尺寸的文件」
  # 时才认定它是本次构建的错名副本并删除；否则保留（可能是真实的历史版本，不动用户档案）。
  foreach ($stale in (Get-ChildItem -Path "$DESK\安装包\*" -Filter '康复AI-v2.21.8*.apk' -File -ErrorAction SilentlyContinue)) {
    $twin = Get-ChildItem -Path "$DESK\安装包\*" -Include '*.apk' -File | Where-Object { ($_.Name -like "*v$VER*") -and ($_.Length -eq $stale.Length) } | Select-Object -First 1
    if ($twin) { Remove-Item $stale.FullName -Force -ErrorAction SilentlyContinue; Write-Host "清理错名旧产物：$($stale.Name)（与 $($twin.Name) 同尺寸）" }
  }
  Set-Location $ROOT
  git add -A
  Commit-Msg "dist: v$VER APK/AAB" | Out-Null
  git push
  if ($LASTEXITCODE -ne 0) { throw 'dist 推送失败' }
}

if ($From -le 6) {
  Step '6/8' '创建 GitHub Release（附 APK/AAB）'
  $gh = Join-Path $env:TEMP 'gh-cli\bin\gh.exe'
  $notesFile = Join-Path $env:TEMP 'rh-release-notes.md'
  [IO.File]::WriteAllText($notesFile, [string]$meta.notes, [Text.UTF8Encoding]::new($false))   # gh 按 UTF-8 读
  # 探活要临时切 Continue：gh 查不到版本时往 stderr 写「release not found」，
  # 在 Stop 模式下会被 PowerShell 当成终止性错误（上一轮就是这么中断在创建 Release 之前的）。
  $pref = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $gh release view "v$VER" --json tagName 2>&1 | Out-Null
  $relExists = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $pref
  if ($relExists) {
    Write-Host "Release v$VER 已存在 → 覆盖附件与说明（不删除重建）"
    & $gh release upload "v$VER" "$ROOT\downloads\RehabAI-v$VER.apk" "$ROOT\downloads\RehabAI-v$VER.aab" --clobber
    if ($LASTEXITCODE -ne 0) { throw 'gh release upload 失败' }
    & $gh release edit "v$VER" --title "康复AI v$VER" --notes-file $notesFile
    if ($LASTEXITCODE -ne 0) { throw 'gh release edit 失败' }
  } else {
    & $gh release create "v$VER" "$ROOT\downloads\RehabAI-v$VER.apk" "$ROOT\downloads\RehabAI-v$VER.aab" --title "康复AI v$VER" --notes-file $notesFile
    if ($LASTEXITCODE -ne 0) { throw 'gh release create 失败' }
  }
}

if ($From -le 7) {
  Step '7/8' '刷新 CDN 缓存 + 二维码'
  foreach ($f in @('latest.json','index.html','app.js','style.css','i18n.js','sw.js','manifest.json','README.md')) {
    try { Invoke-WebRequest -UseBasicParsing "https://purge.jsdelivr.net/gh/xushengqin666-cell/rehab-ai@main/$f" -TimeoutSec 20 | Out-Null; Write-Host "purge ok：$f" } catch { Write-Host "purge 跳过：$f" }
  }
  try {
    qrcode -o "$DESK\图片\康复AI-线上网址二维码.png" -w 640 'https://xushengqin666-cell.github.io/rehab-ai/'
    qrcode -o "$DESK\安装包\康复AI-APK下载二维码.png" -w 640 "https://github.com/xushengqin666-cell/rehab-ai/releases/latest/download/RehabAI-v$VER.apk"
    Copy-Item "$DESK\安装包\康复AI-APK下载二维码.png" "$DESK\康复AI上架提交包\康复AI-APK下载二维码.png" -Force
    Write-Host '二维码已更新'
  } catch { Write-Host 'qrcode 命令不可用 → 二维码未更新（不影响发版）' }
}

if ($From -le 8) {
  Step '8/8' '刷新上架提交包 + 线上冒烟验证'
  $zip = "$DESK\康复AI上架提交包.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path "$DESK\康复AI上架提交包\*" -DestinationPath $zip -Force
  Write-Host "上架包已刷新：$zip"
  if (Wait-Cdp 3) {
    node tests/live-smoke.mjs | Select-Object -Last 8
  } else {
    Write-Host '跳过线上冒烟：无头 Chrome(9228) 不在线。手动跑：node tests/live-smoke.mjs（需先启动 Chrome CDP）'
  }
}

Write-Host ''
Write-Host "全部完成：v$VER 已发布"
Write-Host "  网页版：https://xushengqin666-cell.github.io/rehab-ai/"
Write-Host "  Release：https://github.com/xushengqin666-cell/rehab-ai/releases/tag/v$VER"
