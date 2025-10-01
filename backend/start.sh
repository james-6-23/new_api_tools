#!/bin/bash

echo "========================================"
echo "NewAPI 统计工具 - 快速启动"
echo "========================================"
echo ""

# 检查 .env 文件
if [ ! -f ".env" ]; then
    echo "⚠️  未找到 .env 文件"
    echo "📝 正在复制 .env.example..."
    cp .env.example .env
    echo "✅ 已创建 .env 文件"
    echo ""
    echo "❗ 请编辑 .env 文件，填入您的 NEWAPI_SESSION"
    echo "   从浏览器 Cookie 中复制 session 值"
    echo ""
    read -p "按 Enter 键继续..."
fi

# 检查依赖
echo "📦 检查依赖..."
if ! python -c "import fastapi" 2>/dev/null; then
    echo "⚠️  未找到 fastapi，正在安装依赖..."
    pip install -r requirements.txt
else
    echo "✅ 依赖已安装"
fi

echo ""
echo "🚀 启动服务..."
echo "   地址: http://localhost:8000"
echo "   API 文档: http://localhost:8000/api/docs"
echo ""
echo "按 Ctrl+C 停止服务"
echo "========================================"
echo ""

uvicorn app.main:app --reload --port 8000

