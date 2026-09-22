# 康复AI 一键收尾（版本号自动读 latest.json）：跑验收 → 通过才提交/构建/发版/刷新产物
# 用法（任选其一）：
#   pwsh -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\项目文件夹\rehab-app\tests\finish-release.ps1"
# 说明：验收不过会立即中止，不会提交、不会构建、不会发版。
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { Write-Warning '本脚本含中文路径，请用 pwsh (PowerShell 7) 运行，避免 5.1 无 BOM 读取导致乱码' }
$ROOT = 'C:\Users\User\Desktop\项目文件夹\rehab-app'
$VER  = (Get-Content "$ROOT\latest.json" -Raw | ConvertFrom-Json).version   # 版本号唯一来源
$CAP  = 'C:\Users\User\rehab-cap'
$DESK = 'C:\Users\User\Desktop'
$env:JAVA_HOME = 'C:\jdk-21.0.12.1+1'
$env:ANDROID_HOME = 'C:\android-sdk'
$env:PATH = "$env:JAVA_HOME\bin;C:\android-sdk\platform-tools;$env:PATH"
function Step($n, $t) { Write-Host ''; Write-Host "=== $n $t ===" }

Set-Location $ROOT

Step '1/8' '启动测试环境（8000 静态 + 8555 mock-supabase + 9228 无头 Chrome）'
& powershell.exe -ExecutionPolicy Bypass -File "$ROOT\tests\start-servers.ps1"
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (netstat -ano | Select-String ':9228\s+.*LISTENING')) {
  Start-Process -FilePath $chrome -ArgumentList '--headless=new','--disable-gpu','--no-first-run','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--remote-debugging-port=9228','--remote-allow-origins=*',"--user-data-dir=$env:TEMP\rh-cdp",'about:blank'
  Start-Sleep -Seconds 4
}
$env:RH_CDP_PORT = '9228'

Step '2/8' '跑全量验收（全量日志：tests\_last-run.txt）'
node tests/full.mjs | Out-Null
$log = "$ROOT\tests\_last-run.txt"
$sum = (Select-String -Path $log -Pattern 'PASS \d+ / FAIL \d+ / ' | Select-Object -Last 1).Line
Write-Host $sum
if ((-not $sum) -or ($sum -notmatch 'FAIL 0 /')) {
  Select-String -Path $log -Pattern '^FAIL ' | ForEach-Object { Write-Host $_.Line }
  throw '验收未通过或没跑完 → 已中止（未提交、未构建、未发布）'
}
node tests/keycheck.mjs | Select-Object -Last 1

Step '3/8' '提交并推送网页版（GitHub Pages + jsDelivr 双源）'
git add -A
git commit -m "v$VER: 全模块逐个精细化·第 9 模块「设置」+ 第 10 模块「全局」收官（键盘/无障碍/焦点/回顶/动效偏好）"
if ($LASTEXITCODE -ne 0) { Write-Host '（无改动可提交，继续）' }
git push
if ($LASTEXITCODE -ne 0) { throw 'git push 失败' }

Step '4/8' '构建 APK/AAB（Capacitor 同步 + 签名）'
& powershell.exe -ExecutionPolicy Bypass -File 'C:\Users\User\.rehab-cap\build-apk.ps1'
Set-Location "$CAP\android"
.\gradlew.bat bundleRelease --no-daemon
if ($LASTEXITCODE -ne 0) { throw 'gradlew bundleRelease 失败' }

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
Get-ChildItem "$DESK\康复AI上架提交包\1-安装包" -Include '*.apk','*.aab' -File | Where-Object { $_.Name -notlike "*v$VER*" } | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem "$DESK\安装包" -Filter '康复AI-v2.21.8*.apk' -File | Remove-Item -Force -ErrorAction SilentlyContinue
Set-Location $ROOT
git add -A
git commit -m "dist: v$VER APK/AAB（设置 + 全局两模块精细化）- CDN mirrors"
git push
if ($LASTEXITCODE -ne 0) { throw 'dist 推送失败' }

Step '6/8' '创建 GitHub Release（附 APK/AAB）'
$gh = Join-Path $env:TEMP 'gh-cli\bin\gh.exe'
$notes = (Get-Content "$ROOT\latest.json" -Raw | ConvertFrom-Json).notes
& $gh release create "v$VER" "$ROOT\downloads\RehabAI-v$VER.apk" "$ROOT\downloads\RehabAI-v$VER.aab" --title "康复AI v$VER" --notes $notes

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

Step '8/8' '刷新上架提交包 + 线上冒烟验证'
$zip = "$DESK\康复AI上架提交包.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$DESK\康复AI上架提交包\*" -DestinationPath $zip -Force
Write-Host "上架包已刷新：$zip"
node tests/live-smoke.mjs | Select-Object -Last 8

Write-Host ''
Write-Host "全部完成：v$VER 已发布"
Write-Host "  网页版：https://xushengqin666-cell.github.io/rehab-ai/"
Write-Host "  Release：https://github.com/xushengqin666-cell/rehab-ai/releases/tag/v$VER"
