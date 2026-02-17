# NewAPI Middleware Tool - All-in-One Dockerfile (Go Backend)
# 前端 + Go 后端合并到单个镜像
#
# 构建缓存说明:
#   - npm 依赖缓存: /root/.npm
#   - Go 模块缓存: /go/pkg/mod
#   - Go 编译缓存: /root/.cache/go-build
#   使用 docker buildx build 或 DOCKER_BUILDKIT=1 启用缓存挂载

# syntax=docker/dockerfile:1

# Stage 1: 构建前端
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: 构建 Go 后端
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS backend-builder
ARG TARGETARCH
WORKDIR /build
RUN apk add --no-cache git ca-certificates tzdata

# 先复制依赖文件，利用层缓存
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

# 复制源码并编译，挂载 Go 编译缓存
COPY backend/ .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build \
    -ldflags="-s -w" \
    -o /build/server \
    ./cmd/server

# Stage 3: 最终镜像 (Nginx + Go binary)
FROM alpine:3.19
WORKDIR /app

# 安装 Nginx 和运行时依赖
RUN apk add --no-cache \
    nginx \
    supervisor \
    curl \
    ca-certificates \
    tzdata

# 复制 Go 二进制
COPY --from=backend-builder /build/server /app/server

# 创建数据目录
RUN mkdir -p /app/data && chmod 755 /app/data

# 复制前端构建产物
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# 复制 Nginx 配置
COPY frontend/nginx.conf /etc/nginx/http.d/default.conf

# 修改 Nginx 配置，代理到本地 Go 后端
RUN sed -i 's|http://backend:8000|http://127.0.0.1:8000|g' /etc/nginx/http.d/default.conf

# Supervisor 配置 - 同时运行 Nginx 和 Go 后端
RUN mkdir -p /etc/supervisor.d && \
    echo -e '[supervisord]\nnodaemon=true\nuser=root\n\n\
[program:nginx]\ncommand=/usr/sbin/nginx -g "daemon off;"\nautostart=true\nautorestart=true\n\
stdout_logfile=/dev/stdout\nstdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\nstderr_logfile_maxbytes=0\n\n\
[program:backend]\ncommand=/app/server\ndirectory=/app\nautostart=true\nautorestart=true\n\
stdout_logfile=/dev/stdout\nstdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\nstderr_logfile_maxbytes=0\n' > /etc/supervisord.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost/api/health || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
