@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo   康复AI · 一键部署准备
echo ============================================================
echo.
echo  [1/2] 初始化 Git 仓库并提交（本地操作，安全）
where git >nul 2>nul
if %errorlevel%==0 (
    if not exist ".git" git init >nul
    git add -A
    git commit -m "康复AI v2：火柴人分析 + 自定义动作 + 数据采集闭环"
    echo  ✅ 已提交到本地 git
) else (
    echo  ⚠️ 未找到 git，跳过（不影响 Netlify 方式）
)
echo.
echo  [2/2] 选择一种方式上线（手机即可用摄像头）：
echo.
echo  方式A（最快，推荐）：打开 https://app.netlify.com/drop
echo       把本文件夹整个拖进网页，等几秒得到 https://xxx.netlify.app
echo       手机和电脑用同一个网址 = 端手互通
echo.
echo  方式B（GitHub Pages）：
echo       1. 打开 GitHub Desktop → File → Add local repository → 选本文件夹
echo       2. Publish repository（Public）
echo       3. 网页上进仓库 Settings → Pages → Source 选 main 分支 → Save
echo       4. 得到 https://用户名.github.io/仓库名/
echo.
pause
