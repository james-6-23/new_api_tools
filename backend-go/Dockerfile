# 多阶段构建 Dockerfile

# 阶段 1: 构建前端
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# 复制前端代码
COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# 阶段 2: 构建 Go 后端
FROM golang:1.21-alpine AS backend-builder

WORKDIR /app

# 安装构建依赖
RUN apk add --no-cache git gcc musl-dev

# 复制 go.mod 和 go.sum
COPY backend-go/go.mod backend-go/go.sum ./
RUN go mod download

# 复制后端代码
COPY backend-go/ ./

# 构建二进制文件
RUN CGO_ENABLED=1 GOOS=linux go build -a -installsuffix cgo -ldflags="-w -s" -o /app/server ./cmd/server

# 阶段 3: 最终镜像
FROM alpine:latest

WORKDIR /app

# 安装运行时依赖
RUN apk --no-cache add ca-certificates tzdata nginx supervisor && \
    mkdir -p /app/data /run/nginx /var/log/supervisor

# 设置时区
ENV TZ=Asia/Shanghai

# 从构建阶段复制文件
COPY --from=backend-builder /app/server /app/server
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# 复制 Nginx 配置
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/default.conf /etc/nginx/http.d/default.conf

# 复制 Supervisor 配置
COPY docker/supervisord.conf /etc/supervisord.conf

# 创建数据目录
RUN mkdir -p /app/data && chmod 777 /app/data

# 暴露端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

# 启动 Supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
