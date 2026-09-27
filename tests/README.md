# QA 自动化测试（CDP · Chrome DevTools Protocol）

这些脚本用无头 Chrome 驱动线上/本地 App 做端到端测试，全部通过后即可放心发布。
（也是 NCEA / 竞赛的测试证据材料。）

## 环境要求
- Node.js ≥ 18（自带 fetch / WebSocket）
- Chrome（Windows 默认路径 `C:\Program Files\Google\Chrome\Application\chrome.exe`）
- Python（本机 `python -m http.server 8000`，在仓库根目录运行）
- 本机**没有 PowerShell 7**，只有 Windows PowerShell 5.1 —— 改脚本前请先读下面「编码红线」

## 一键发版（推荐）
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\项目文件夹\rehab-app\tests\finish-release.ps1"
```
会依次：启动测试环境 → 跑 `preflight.mjs` → 跑全量验收（`full.mjs`）→ 提交推送网页版 →
构建 APK/AAB（走 `.rehab-cap\build-apk.ps1`）→ 归档产物 → 建/更新 GitHub Release →
刷 CDN 缓存与二维码 → 刷新上架提交包 → 线上冒烟。
**验收不过会立即中止**，不会提交、不会构建、不会发版。
版本号只有一个来源：`latest.json`（脚本自动读它，并自动写入安卓 versionName/versionCode）。

## 启动测试环境
```powershell
powershell -ExecutionPolicy Bypass -File tests\start-servers.ps1   # 8000 静态 + 8555 mock-supabase
```
脚本会轮询等待真正就绪（等 30 秒），未就绪时以退出码 1 结束。要单独用 Chrome：
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --no-first-run `
  --use-fake-device-for-media-stream --use-fake-ui-for-media-stream `
  --remote-debugging-port=9228 --remote-allow-origins=* `
  --user-data-dir="$env:TEMP\rh-cdp" about:blank
```

## 运行测试
```powershell
$env:RH_CDP_PORT = '9228'
node tests/preflight.mjs # 发版前置检查：乱码 / .ps1 缺 BOM / 版本号三处不一致（快，先跑这个）
node tests/full.mjs      # ⭐ 上市级验收：36 节 258 项断言（需 mock-supabase 在 8555）
node tests/keycheck.mjs  # i18n 键覆盖检查
node tests/smoke.mjs     # 双语全功能回归（中文+英文+自测+模型）
node tests/system.mjs    # 完整系统（统计/成就/计划/资料/提醒/云配置）
node tests/synctest.mjs  # 二维码同步编解码（gzip 往返 + 二维码像素往返 + 合并）
node tests/live-smoke.mjs # 线上冒烟（GitHub Pages 实际地址）
node tests/mock-supabase.mjs   # 模拟 Supabase 服务器（另开一个终端，监听 8555）
```
`full.mjs` 的全量日志落在 `tests/_last-run.txt`（已 gitignore），最后一行是
`PASS n / FAIL m / 总计 n+m`，发版脚本就是靠这行判断成败。

脚本也可以自检（确认检查本身真的能抓到问题，而不是永远返回通过）：
```powershell
node tests/preflight.mjs --selftest
```

## ⚠️ 编码红线（这个项目踩过两次）
1. **不要用 PowerShell 读写带中文的源码文件**。`Get-Content -Raw | Set-Content -Encoding UTF8`
   在 5.1 下会「按 ANSI 读 → 按 UTF-8 写」，中文变成双重编码乱码（v2.42.1 的界面乱码事故）。
   改 JS/HTML/CSS 请用编辑器/`read`+`edit` 这类明确的 UTF-8 读写。
2. **含中文的 `.ps1` 必须带 UTF-8 BOM**。本机只有 5.1，无 BOM 时它按 ANSI 解码，
   脚本里的中文路径会变乱码、脚本直接跑不起来（`finish-release.ps1` 上一版就是这么坏的）。
   自查：`node tests/preflight.mjs`。
3. 版本号改一处不算改完：`latest.json` / `app.js` 的 `APP_VERSION` / `sw.js` 的 `CACHE`
   必须同时改，`preflight.mjs` 会校验；漏改会让「关于页显示的版本」和「更新检查拿到的版本」对不上。

## 页面内置自测
- `index.html#selftest` — 9 项动作引擎自测
- `index.html?modeltest=1` — AI 模型加载自检
- `index.html?synctest=1` — 同步编解码/合并自检
- `camtest.html` — 摄像头硬件体检页

全部输出 `RESULT: PASS` 且 `CONSOLE_ERRORS: none` 即为健康。
