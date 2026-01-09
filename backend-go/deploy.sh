#!/bin/bash

set -e

echo "=========================================="
echo "NewAPI Tools (Golang) 部署脚本"
echo "=========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}错误: 未安装 Docker${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}错误: 未安装 Docker Compose${NC}"
    exit 1
fi

# 检查 .env 文件
if [ ! -f .env ]; then
    echo -e "${YELLOW}警告: 未找到 .env 文件，正在从 .env.example 复制...${NC}"
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${GREEN}已创建 .env 文件，请编辑配置后重新运行${NC}"
        exit 0
    else
        echo -e "${RED}错误: 未找到 .env.example 文件${NC}"
        exit 1
    fi
fi

# 检查必需的环境变量
source .env

if [ -z "$ADMIN_PASSWORD" ]; then
    echo -e "${RED}错误: 未设置 ADMIN_PASSWORD${NC}"
    exit 1
fi

# 创建数据目录
mkdir -p data

echo -e "${GREEN}开始构建镜像...${NC}"

# 构建镜像
if docker compose version &> /dev/null; then
    docker compose build --no-cache
else
    docker-compose build --no-cache
fi

echo -e "${GREEN}镜像构建完成！${NC}"

# 停止旧容器
echo -e "${YELLOW}停止旧容器...${NC}"
if docker compose version &> /dev/null; then
    docker compose down
else
    docker-compose down
fi

# 启动新容器
echo -e "${GREEN}启动新容器...${NC}"
if docker compose version &> /dev/null; then
    docker compose up -d
else
    docker-compose up -d
fi

# 等待服务启动
echo -e "${YELLOW}等待服务启动...${NC}"
sleep 5

# 检查服务状态
if docker compose version &> /dev/null; then
    docker compose ps
else
    docker-compose ps
fi

# 检查健康状态
echo -e "${YELLOW}检查服务健康状态...${NC}"
for i in {1..30}; do
    if curl -f http://localhost:${FRONTEND_PORT:-1145}/health &> /dev/null; then
        echo -e "${GREEN}服务启动成功！${NC}"
        echo ""
        echo "=========================================="
        echo -e "${GREEN}部署完成！${NC}"
        echo "=========================================="
        echo ""
        echo "访问地址: http://localhost:${FRONTEND_PORT:-1145}"
        echo "管理员账号: admin"
        echo "管理员密码: ${ADMIN_PASSWORD}"
        echo ""
        echo "查看日志: docker compose logs -f newapi-tools-go"
        echo "停止服务: docker compose down"
        echo ""
        exit 0
    fi
    echo -n "."
    sleep 2
done

echo -e "${RED}服务启动超时，请检查日志${NC}"
if docker compose version &> /dev/null; then
    docker compose logs --tail=50 newapi-tools-go
else
    docker-compose logs --tail=50 newapi-tools-go
fi
exit 1
