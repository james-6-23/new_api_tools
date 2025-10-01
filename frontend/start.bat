@echo off
chcp 65001 >nul
cls

echo ========================================
echo NewAPI 前端 - 快速启动
echo ========================================
echo.

REM 检查 node_modules
if not exist "node_modules" (
    echo ⚠️  未找到 node_modules
    echo 📦 正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo ❌ 安装失败
        pause
        exit /b 1
    )
    echo ✅ 安装完成
    echo.
)

echo 🚀 启动开发服务器...
echo    地址: http://localhost:3000
echo.
echo 按 Ctrl+C 停止服务
echo ========================================
echo.

REM 使用 node 直接运行 vite（避免路径问题）
node node_modules\vite\bin\vite.js --host

