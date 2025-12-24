# NewAPI Middleware Tool - All-in-One Dockerfile
# 前端 + 后端合并到单个镜像

# Stage 1: 构建前端
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: 构建后端依赖
FROM python:3.11-slim AS backend-builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv pip install --system --no-cache -r pyproject.toml

# Stage 3: 最终镜像
FROM python:3.11-slim
WORKDIR /app

# 安装 Nginx 和运行时依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    libpq5 \
    supervisor \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制 Python 依赖
COPY --from=backend-builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=backend-builder /usr/local/bin/uvicorn /usr/local/bin/uvicorn

# 复制后端代码
COPY backend/app ./app

# 创建数据目录（用于持久化 SQLite 数据库）
RUN mkdir -p /app/data && chmod 755 /app/data

# 复制前端构建产物
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# 复制 Nginx 配置
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# 删除默认 Nginx 配置
RUN rm -f /etc/nginx/sites-enabled/default

# Supervisor 配置 - 同时运行 Nginx 和 Uvicorn
RUN echo '[supervisord]\n\
nodaemon=true\n\
user=root\n\
\n\
[program:nginx]\n\
command=/usr/sbin/nginx -g "daemon off;"\n\
autostart=true\n\
autorestart=true\n\
stdout_logfile=/dev/stdout\n\
stdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\n\
stderr_logfile_maxbytes=0\n\
\n\
[program:uvicorn]\n\
command=/usr/local/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log\n\
directory=/app\n\
autostart=true\n\
autorestart=true\n\
stdout_logfile=/dev/stdout\n\
stdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\n\
stderr_logfile_maxbytes=0\n' > /etc/supervisor/conf.d/app.conf

# 修改 Nginx 配置，代理到本地后端
RUN sed -i 's|http://backend:8000|http://127.0.0.1:8000|g' /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost/api/health || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
