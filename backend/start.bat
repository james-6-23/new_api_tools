@echo off
chcp 65001 >nul
cls

echo ========================================
echo NewAPI 统计工具 - 快速启动
echo ========================================
echo.

REM 检查 .env 文件
if not exist ".env" (
    echo ⚠️  未找到 .env 文件
    echo 📝 正在复制 .env.example...
    copy .env.example .env >nul
    echo ✅ 已创建 .env 文件
    echo.
    echo ❗ 请编辑 .env 文件，填入您的 NEWAPI_SESSION
    echo    从浏览器 Cookie 中复制 session 值
    echo.
    pause
)

REM 检查依赖
echo 📦 检查依赖...
python -c "import fastapi" 2>nul
if errorlevel 1 (
    echo ⚠️  未找到 fastapi，正在安装依赖...
    pip install -r requirements.txt
) else (
    echo ✅ 依赖已安装
)

echo.
echo 🚀 启动服务...
echo    地址: http://localhost:8000
echo    API 文档: http://localhost:8000/api/docs
echo.
echo 按 Ctrl+C 停止服务
echo ========================================
echo.

uvicorn app.main:app --reload --port 8000

