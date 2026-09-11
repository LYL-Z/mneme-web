@echo off
rem ============================================================
rem ΜΝΗΜΗ · 一键数据同步（vault 更新后跑这个）
rem 步骤：只读重扫描知识库 -> 构建前端 -> 打包 deploy 目录
rem 完成后在 WorkBuddy 说「同步网站」即可触发云端重部署。
rem 安全：全程只读 vault，私密层零提取（ingest 内建规则）。
rem ============================================================
setlocal
cd /d "%~dp0"

echo [1/3] 重扫描知识库（只读）...
node --experimental-sqlite ingest\ingest.mjs
if errorlevel 1 goto :err

echo [2/3] 构建前端...
pushd web
call npm run build
if errorlevel 1 popd & goto :err
popd

echo [3/3] 打包 deploy 目录...
copy /y ingest\mneme.db deploy\mneme.db >nul
copy /y server\*.mjs deploy\server\ >nul
copy /y server\package.json deploy\server\ >nul
if exist web\dist\index.html (
  rmdir /s /q deploy\web-dist
  xcopy /e /i /q web\dist deploy\web-dist >nul
) else goto :err

echo.
echo ✅ 同步完成。数据与前端已就绪于 deploy\ 。
echo    在 WorkBuddy 说「同步网站」触发云端重部署；或按 docs\部署手册.md 手动部署。
goto :eof

:err
echo ❌ 同步失败，请查看上方报错。
exit /b 1
