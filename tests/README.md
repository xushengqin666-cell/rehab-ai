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
node tests/design-system.mjs  # 设计系统验收：DESIGN.md 的 token 是否真的落到运行时（18 项）
node tests/design-measure.mjs # 设计成熟度实测：改造前后各跑一次出数据（不判定，只报告）
node tests/smoke.mjs     # 双语全功能回归（中文+英文+自测+模型）
node tests/system.mjs    # 完整系统（统计/成就/计划/资料/提醒/云配置）
node tests/synctest.mjs  # 二维码同步编解码（gzip 往返 + 二维码像素往返 + 合并）
node tests/live-smoke.mjs # 线上冒烟（GitHub Pages 实际地址）
node tests/mock-supabase.mjs   # 模拟 Supabase 服务器（另开一个终端，监听 8555）
```
`full.mjs` 的全量日志落在 `tests/_last-run.txt`（已 gitignore），最后一行是
`PASS n / FAIL m / 总计 n+m`，发版脚本就是靠这行判断成败。

## 设计系统（DESIGN.md 开放格式）
视觉的唯一真源是仓库根目录的 `DESIGN.md`（Google Labs 格式：YAML token + 八节理由说明）。
改视觉的顺序：**先改 DESIGN.md → 再改运行时**，不要反过来。

```powershell
npx -y -p "@google/design.md" designmd lint DESIGN.md                 # 结构 / 断链 / WCAG 对比度
npx -y -p "@google/design.md" designmd export --format css-tailwind DESIGN.md  # → CSS token（@theme 需转 :root）
node tests/design-tokens-build.mjs        # ⚙️ 由 DESIGN.md 的 token + style.css 生成覆盖层
node tests/design-tokens-build.mjs --check  # 只报告会吸附多少处，不写文件
```
- `rehab-design-system.css` 是**生成物**（顶部有生成时间），不要手改；改完 `style.css` 或
  DESIGN.md 后重跑生成器。
- 覆盖层是纯新增层（加载在 `style.css` 之后）：定义 token、把旧变量指向 token、把散落的
  字号/圆角吸附到音阶、统一动效节奏与阴影、补焦点环与触控热区。**不动 DOM 与交互逻辑**。
- 生成器会跳过 `@keyframes` 与 `@media` 内部规则——关键帧选择器不是真规则，媒体查询内的
  取值属于分场景覆盖，强改会破坏动画与响应式。
- 未覆盖的已知项：`border-radius: 50%`（正圆）、`0px`（无圆角）按设计保留。

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
