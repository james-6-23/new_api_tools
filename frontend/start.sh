#!/bin/bash

echo "========================================"
echo "NewAPI 前端 - 快速启动"
echo "========================================"
echo ""

# 检查 node_modules
if [ ! -d "node_modules" ]; then
    echo "⚠️  未找到 node_modules"
    echo "📦 正在安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 安装失败"
        exit 1
    fi
    echo "✅ 安装完成"
    echo ""
fi

echo "🚀 启动开发服务器..."
echo "   地址: http://localhost:3000"
echo ""
echo "按 Ctrl+C 停止服务"
echo "========================================"
echo ""

# 使用 node 直接运行 vite（避免路径问题）
node node_modules/vite/bin/vite.js --host

