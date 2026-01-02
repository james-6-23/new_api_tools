# NewAPI Middleware Tool - All-in-One Dockerfile
# 前端 + Go 后端合并到单个镜像

# Stage 1: 构建前端
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: 构建 Go 后端
FROM golang:1.21-alpine AS backend-builder
WORKDIR /app

# 安装构建依赖
RUN apk add --no-cache gcc musl-dev

# 复制 go.mod 和 go.sum
COPY backend-go/go.mod backend-go/go.sum ./
RUN go mod download

# 复制源代码并构建
COPY backend-go/ ./
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server

# Stage 3: 最终镜像
FROM alpine:3.19
WORKDIR /app

# 安装运行时依赖
RUN apk add --no-cache \
    nginx \
    supervisor \
    curl \
    ca-certificates \
    tzdata

# 复制 Go 后端二进制
COPY --from=backend-builder /app/server /app/server

# 创建数据目录
RUN mkdir -p /app/data && chmod 755 /app/data

# 复制前端构建产物
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Nginx 配置
RUN mkdir -p /etc/nginx/conf.d && rm -f /etc/nginx/http.d/default.conf
COPY frontend/nginx.conf /etc/nginx/http.d/default.conf

# 修改 Nginx 配置，代理到本地 Go 后端
RUN sed -i 's|http://backend:8000|http://127.0.0.1:8000|g' /etc/nginx/http.d/default.conf

# Supervisor 配置
RUN mkdir -p /etc/supervisor.d
RUN echo '[supervisord]' > /etc/supervisord.conf && \
    echo 'nodaemon=true' >> /etc/supervisord.conf && \
    echo 'user=root' >> /etc/supervisord.conf && \
    echo '' >> /etc/supervisord.conf && \
    echo '[include]' >> /etc/supervisord.conf && \
    echo 'files = /etc/supervisor.d/*.ini' >> /etc/supervisord.conf

RUN echo '[program:nginx]' > /etc/supervisor.d/nginx.ini && \
    echo 'command=/usr/sbin/nginx -g "daemon off;"' >> /etc/supervisor.d/nginx.ini && \
    echo 'autostart=true' >> /etc/supervisor.d/nginx.ini && \
    echo 'autorestart=true' >> /etc/supervisor.d/nginx.ini && \
    echo 'stdout_logfile=/dev/stdout' >> /etc/supervisor.d/nginx.ini && \
    echo 'stdout_logfile_maxbytes=0' >> /etc/supervisor.d/nginx.ini && \
    echo 'stderr_logfile=/dev/stderr' >> /etc/supervisor.d/nginx.ini && \
    echo 'stderr_logfile_maxbytes=0' >> /etc/supervisor.d/nginx.ini

RUN echo '[program:backend]' > /etc/supervisor.d/backend.ini && \
    echo 'command=/app/server' >> /etc/supervisor.d/backend.ini && \
    echo 'directory=/app' >> /etc/supervisor.d/backend.ini && \
    echo 'autostart=true' >> /etc/supervisor.d/backend.ini && \
    echo 'autorestart=true' >> /etc/supervisor.d/backend.ini && \
    echo 'stdout_logfile=/dev/stdout' >> /etc/supervisor.d/backend.ini && \
    echo 'stdout_logfile_maxbytes=0' >> /etc/supervisor.d/backend.ini && \
    echo 'stderr_logfile=/dev/stderr' >> /etc/supervisor.d/backend.ini && \
    echo 'stderr_logfile_maxbytes=0' >> /etc/supervisor.d/backend.ini

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost/api/health || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
