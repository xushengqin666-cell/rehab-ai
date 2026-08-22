# QA 自动化测试（CDP · Chrome DevTools Protocol）

这些脚本用无头 Chrome 驱动线上/本地 App 做端到端测试，全部通过后即可放心发布。
（也是 NCEA / 竞赛的测试证据材料。）

## 环境要求
- Node.js ≥ 18（自带 fetch / WebSocket）
- Chrome（Windows 默认路径 `C:\Program Files\Google\Chrome\Application\chrome.exe`）
- 本地静态服务器：`python -m http.server 8000`（在本仓库根目录运行）

## 启动测试用 Chrome（带假摄像头）
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --no-first-run `
  --use-fake-device-for-media-stream --use-fake-ui-for-media-stream `
  --remote-debugging-port=9228 --remote-allow-origins=* `
  --user-data-dir="$env:TEMP\rh-cdp" about:blank
```

## 运行测试
```powershell
$env:RH_CDP_PORT = '9228'
node tests/full.mjs      # ⭐ 上市级验收：36 项全功能（推荐，需 mock-supabase 在 8555 运行）
node tests/smoke.mjs     # 双语全功能回归（中文+英文+自测+模型）
node tests/system.mjs    # 完整系统（统计/成就/计划/资料/提醒/云配置）
node tests/synctest.mjs  # 二维码同步编解码（gzip 往返 + 二维码像素往返 + 合并）
node tests/mock-supabase.mjs   # 模拟 Supabase 服务器（另开一个终端，端口 8555）
```

## 页面内置自测
- `index.html#selftest` — 9 项动作引擎自测
- `index.html?modeltest=1` — AI 模型加载自检
- `index.html?synctest=1` — 同步编解码/合并自检
- `camtest.html` — 摄像头硬件体检页

全部输出 `RESULT: PASS` 且 `CONSOLE_ERRORS: none` 即为健康。
