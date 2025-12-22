#!/usr/bin/env bash
set -euo pipefail

#######################################
# NewAPI Middleware Tool - 一键部署脚本
# 
# 功能:
#   1. 自动检测 NewAPI 容器和数据库配置
#   2. 交互式配置前端密码和 API Key
#   3. 生成 .env 配置文件
#   4. 启动 Docker Compose 服务
#
# 使用方法:
#   ./deploy.sh              # 交互式部署
#   ./deploy.sh --uninstall  # 卸载服务
#   ./deploy.sh --status     # 查看状态
#######################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die() { log_error "$*"; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少必要命令: $1"
}

trim() { sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

first_csv() {
  echo "${1}" | sed 's/,.*$//'
}

#######################################
# Docker 环境检测函数 (来自 newapi_detect.sh)
#######################################

extract_dsn_engine() {
  local dsn="${1:-}"
  if [[ -z "$dsn" ]]; then return 0; fi
  if [[ "$dsn" =~ ^postgres(ql)?:// ]]; then
    echo "postgres"
  elif [[ "$dsn" =~ ^mysql:// ]]; then
    echo "mysql"
  fi
}

extract_dsn_host() {
  local dsn="${1:-}"
  if [[ -z "$dsn" ]]; then return 0; fi
  local host
  host="$(echo "$dsn" | sed -nE 's#^[a-zA-Z0-9+.-]+://[^@/]*@([^:/]+).*#\1#p')"
  if [[ -n "$host" ]]; then echo "$host"; return 0; fi
  host="$(echo "$dsn" | sed -nE 's#^[a-zA-Z0-9+.-]+://([^:/]+).*#\1#p')"
  echo "$host"
}

detect_newapi_container() {
  local found=""
  found="$(docker ps --format '{{.Names}}' | awk '$0=="new-api"{print; exit}')"
  if [[ -n "$found" ]]; then echo "$found"; return 0; fi

  found="$(docker ps -q --filter 'label=com.docker.compose.service=new-api' | head -n 1 || true)"
  if [[ -n "$found" ]]; then echo "$found"; return 0; fi

  found="$(docker ps --format '{{.ID}}\t{{.Image}}' | awk 'tolower($2) ~ /(^|\/)new-api(:|$)/ {print $1; exit}')"
  if [[ -n "$found" ]]; then echo "$found"; return 0; fi

  return 1
}

docker_inspect_label() {
  local container="$1" key="$2"
  docker inspect -f "{{ index .Config.Labels \"$key\" }}" "$container" 2>/dev/null || true
}

docker_inspect_env_value() {
  local container="$1" var_name="$2"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null | awk -F= -v k="$var_name" '$1==k{print $2; exit}'
}

detect_networks_for_container() {
  local container="$1"
  docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$container" 2>/dev/null || true
}

container_is_on_network() {
  local container="$1" network="$2"
  docker inspect -f "{{ if (index .NetworkSettings.Networks \"$network\") }}yes{{ end }}" "$container" 2>/dev/null | grep -q '^yes$'
}

detect_db_container_by_compose_service() {
  local project="$1" service="$2"
  docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service" | head -n 1 || true
}

detect_db_container_by_exposed_port() {
  local network="$1" port_tcp="$2"
  local cid
  while IFS= read -r cid; do
    [[ -z "$cid" ]] && continue
    if docker inspect -f '{{json .Config.ExposedPorts}}' "$cid" 2>/dev/null | grep -q "\"$port_tcp\""; then
      echo "$cid"
      return 0
    fi
  done < <(docker ps -q --filter "network=$network" || true)
  return 0
}

#######################################
# 检测 NewAPI 环境
#######################################
detect_environment() {
  log_info "正在检测 NewAPI 环境..."

  # 检测 NewAPI 容器
  NEWAPI_CONTAINER="${NEWAPI_CONTAINER:-}"
  if [[ -z "$NEWAPI_CONTAINER" ]]; then
    NEWAPI_CONTAINER="$(detect_newapi_container)" || die "找不到运行中的 NewAPI 容器 (期望容器名为 'new-api')"
  fi
  log_success "找到 NewAPI 容器: $NEWAPI_CONTAINER"

  # 获取 compose 项目信息
  local compose_project compose_files user_compose_file
  compose_project="$(docker_inspect_label "$NEWAPI_CONTAINER" 'com.docker.compose.project' | trim)"
  compose_files="$(docker_inspect_label "$NEWAPI_CONTAINER" 'com.docker.compose.project.config_files' | trim)"

  user_compose_file="${COMPOSE_FILE_OVERRIDE:-}"
  if [[ -z "$user_compose_file" && -n "$compose_files" ]]; then
    user_compose_file="$(first_csv "$compose_files" | trim)"
  fi
  if [[ -n "$user_compose_file" && ! -r "$user_compose_file" ]]; then
    user_compose_file=""
  fi

  # 检测网络
  local networks
  networks="$(detect_networks_for_container "$NEWAPI_CONTAINER" | trim || true)"
  NEWAPI_NETWORK="${NEWAPI_NETWORK:-}"
  if [[ -z "$NEWAPI_NETWORK" ]]; then
    NEWAPI_NETWORK="$(echo "$networks" | head -n 1 | trim)"
  fi
  [[ -n "$NEWAPI_NETWORK" ]] || die "无法确定 NewAPI 容器的 Docker 网络"
  container_is_on_network "$NEWAPI_CONTAINER" "$NEWAPI_NETWORK" || die "容器 '$NEWAPI_CONTAINER' 未连接到网络 '$NEWAPI_NETWORK'"
  log_success "检测到网络: $NEWAPI_NETWORK"

  # 检测数据库 DSN
  local detected_dsn=""
  detected_dsn="$(docker_inspect_env_value "$NEWAPI_CONTAINER" 'SQL_DSN' || true)"
  [[ -z "$detected_dsn" ]] && detected_dsn="$(docker_inspect_env_value "$NEWAPI_CONTAINER" 'DATABASE_URL' || true)"
  [[ -z "$detected_dsn" ]] && detected_dsn="$(docker_inspect_env_value "$NEWAPI_CONTAINER" 'DB_DSN' || true)"

  DB_ENGINE="$(extract_dsn_engine "$detected_dsn" || true)"
  DB_DNS="$(extract_dsn_host "$detected_dsn" || true)"

  # 检测数据库容器
  local db_container="" db_service=""
  if [[ -n "$compose_project" ]]; then
    local pg_cid mysql_cid
    pg_cid="$(detect_db_container_by_compose_service "$compose_project" 'postgres')"
    mysql_cid="$(detect_db_container_by_compose_service "$compose_project" 'mysql')"
    if [[ -n "$pg_cid" && -z "$mysql_cid" ]]; then
      DB_ENGINE="${DB_ENGINE:-postgres}"
      db_container="$pg_cid"
      db_service="postgres"
    elif [[ -n "$mysql_cid" && -z "$pg_cid" ]]; then
      DB_ENGINE="${DB_ENGINE:-mysql}"
      db_container="$mysql_cid"
      db_service="mysql"
    fi
  fi

  # 通过端口检测
  if [[ -z "$db_container" ]]; then
    local pg_cid mysql_cid
    pg_cid="$(detect_db_container_by_exposed_port "$NEWAPI_NETWORK" '5432/tcp' || true)"
    mysql_cid="$(detect_db_container_by_exposed_port "$NEWAPI_NETWORK" '3306/tcp' || true)"
    if [[ -n "$pg_cid" && -z "$mysql_cid" ]]; then
      DB_ENGINE="${DB_ENGINE:-postgres}"
      db_container="$pg_cid"
    elif [[ -n "$mysql_cid" && -z "$pg_cid" ]]; then
      DB_ENGINE="${DB_ENGINE:-mysql}"
      db_container="$mysql_cid"
    fi
  fi

  DB_ENGINE="${DB_ENGINE:-postgres}"

  # 尝试常见容器名
  if [[ -z "$db_container" ]]; then
    if docker ps -q --filter "network=$NEWAPI_NETWORK" --filter "name=^/postgres$" | head -n 1 | grep -q .; then
      db_container="postgres"
      DB_ENGINE="postgres"
      db_service="postgres"
    elif docker ps -q --filter "network=$NEWAPI_NETWORK" --filter "name=^/mysql$" | head -n 1 | grep -q .; then
      db_container="mysql"
      DB_ENGINE="mysql"
      db_service="mysql"
    fi
  fi

  [[ -n "$db_container" ]] || die "在网络 '$NEWAPI_NETWORK' 上找不到数据库容器"
  DB_CONTAINER="$db_container"

  # 设置 DB_DNS
  if [[ -n "$db_service" ]]; then
    DB_DNS="${DB_DNS:-$db_service}"
  else
    db_service="$(docker_inspect_label "$db_container" 'com.docker.compose.service' | trim)"
    if [[ -n "$db_service" ]]; then
      DB_DNS="${DB_DNS:-$db_service}"
    else
      DB_DNS="${DB_DNS:-$db_container}"
    fi
  fi

  # 获取数据库凭证
  if [[ "$DB_ENGINE" == "postgres" ]]; then
    DB_PORT="5432"
    DB_USER="$(docker_inspect_env_value "$db_container" 'POSTGRES_USER' || true)"
    DB_NAME="$(docker_inspect_env_value "$db_container" 'POSTGRES_DB' || true)"
    DB_PASSWORD="$(docker_inspect_env_value "$db_container" 'POSTGRES_PASSWORD' || true)"
    DB_USER="${DB_USER:-postgres}"
    DB_NAME="${DB_NAME:-new-api}"
  elif [[ "$DB_ENGINE" == "mysql" ]]; then
    DB_PORT="3306"
    DB_USER="$(docker_inspect_env_value "$db_container" 'MYSQL_USER' || true)"
    DB_NAME="$(docker_inspect_env_value "$db_container" 'MYSQL_DATABASE' || true)"
    DB_PASSWORD="$(docker_inspect_env_value "$db_container" 'MYSQL_PASSWORD' || true)"
    [[ -z "$DB_PASSWORD" ]] && DB_PASSWORD="$(docker_inspect_env_value "$db_container" 'MYSQL_ROOT_PASSWORD' || true)"
    DB_USER="${DB_USER:-root}"
    DB_NAME="${DB_NAME:-new-api}"
  else
    die "不支持的数据库引擎: $DB_ENGINE"
  fi

  log_success "检测到数据库: $DB_ENGINE @ $DB_DNS:$DB_PORT/$DB_NAME"
}

#######################################
# 交互式配置
#######################################
interactive_config() {
  log_info "开始配置..."
  echo ""

  # 前端访问密码
  if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
    echo -e "${YELLOW}请设置前端访问密码:${NC}"
    read -sp "密码: " ADMIN_PASSWORD
    echo ""
    if [[ -z "$ADMIN_PASSWORD" ]]; then
      die "密码不能为空"
    fi
    read -sp "确认密码: " ADMIN_PASSWORD_CONFIRM
    echo ""
    if [[ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]]; then
      die "两次输入的密码不一致"
    fi
  fi
  log_success "前端密码已设置"

  # API Key 自动生成
  API_KEY="${API_KEY:-$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p | tr -d '\n' | head -c 64)}"

  # 前端端口默认 1145
  FRONTEND_PORT="${FRONTEND_PORT:-1145}"

  echo ""
}

#######################################
# 生成 .env 文件
#######################################
generate_env_file() {
  log_info "生成配置文件: $ENV_FILE"

  cat > "$ENV_FILE" <<EOF
# NewAPI Middleware Tool 配置文件
# 由 deploy.sh 自动生成于 $(date '+%Y-%m-%d %H:%M:%S')

# NewAPI 环境
NEWAPI_CONTAINER=${NEWAPI_CONTAINER}
NEWAPI_NETWORK=${NEWAPI_NETWORK}

# 数据库配置
DB_ENGINE=${DB_ENGINE}
DB_DNS=${DB_DNS}
DB_PORT=${DB_PORT}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}

# 认证配置
ADMIN_PASSWORD=${ADMIN_PASSWORD}
API_KEY=${API_KEY}

# 服务配置
FRONTEND_PORT=${FRONTEND_PORT}

# JWT 配置
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p | tr -d '\n' | head -c 64)
JWT_EXPIRE_HOURS=24
EOF

  chmod 600 "$ENV_FILE"
  log_success "配置文件已生成"
}

#######################################
# 检查 docker-compose.yml 是否存在
#######################################
check_compose_file() {
  if [[ ! -f "$COMPOSE_FILE" ]]; then
    die "找不到 docker-compose.yml 文件，请确保在项目根目录运行此脚本"
  fi
  log_success "找到 Docker Compose 配置文件"
}

#######################################
# 启动服务
#######################################
start_services() {
  log_info "启动服务..."

  # 检查是否有旧容器
  if docker ps -a --format '{{.Names}}' | grep -q '^newapi-tools-'; then
    log_warn "发现已存在的服务容器，正在停止..."
    docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down 2>/dev/null || true
  fi

  # 拉取最新镜像
  log_info "拉取最新镜像..."
  docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull

  # 启动服务
  docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

  log_success "服务已启动!"
  
  # 获取服务器 IP
  local server_ip
  server_ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || server_ip="$(ip route get 1 2>/dev/null | awk '{print $7; exit}')" || server_ip="localhost"
  
  echo ""
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}  NewAPI Middleware Tool 部署成功!${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  echo -e "前端访问地址: ${BLUE}http://${server_ip}:${FRONTEND_PORT}${NC}"
  echo -e "API 地址: ${BLUE}http://${server_ip}:${FRONTEND_PORT}/api${NC}"
  echo ""
  echo -e "配置文件: ${ENV_FILE}"
  echo -e "Compose 文件: ${COMPOSE_FILE}"
  echo ""
}

#######################################
# 卸载服务
#######################################
uninstall() {
  log_warn "正在卸载 NewAPI Middleware Tool..."

  if [[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" ]]; then
    docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down -v 2>/dev/null || true
    log_success "容器已停止并移除"
  fi

  if [[ -f "$ENV_FILE" ]]; then
    rm -f "$ENV_FILE"
    log_success "配置文件已删除"
  fi

  log_success "卸载完成"
}

#######################################
# 查看状态
#######################################
show_status() {
  log_info "服务状态:"
  echo ""

  if [[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" ]]; then
    docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
  else
    log_warn "未找到配置文件，服务可能未部署"
  fi
}

#######################################
# 显示帮助
#######################################
show_help() {
  cat <<EOF
NewAPI Middleware Tool - 一键部署脚本

用法:
  ./deploy.sh              交互式部署
  ./deploy.sh --uninstall  卸载服务
  ./deploy.sh --status     查看服务状态
  ./deploy.sh --help       显示帮助

环境变量:
  NEWAPI_CONTAINER   指定 NewAPI 容器名 (默认: 自动检测)
  NEWAPI_NETWORK     指定 Docker 网络名 (默认: 自动检测)
  ADMIN_PASSWORD     前端访问密码 (默认: 交互式输入)
  API_KEY            后端 API Key (默认: 交互式输入或自动生成)
  FRONTEND_PORT      前端端口 (默认: 8080)

示例:
  # 基本部署
  ./deploy.sh

  # 指定容器名部署
  NEWAPI_CONTAINER=my-newapi ./deploy.sh

  # 非交互式部署
  ADMIN_PASSWORD=mypass API_KEY=mykey ./deploy.sh
EOF
}

#######################################
# 主函数
#######################################
main() {
  need_cmd docker
  need_cmd docker-compose

  local mode="${1:-}"

  case "$mode" in
    --help|-h)
      show_help
      exit 0
      ;;
    --uninstall)
      uninstall
      exit 0
      ;;
    --status)
      show_status
      exit 0
      ;;
    "")
      # 正常部署流程
      echo ""
      echo -e "${BLUE}========================================${NC}"
      echo -e "${BLUE}  NewAPI Middleware Tool 部署脚本${NC}"
      echo -e "${BLUE}========================================${NC}"
      echo ""

      detect_environment
      interactive_config
      generate_env_file
      check_compose_file
      start_services
      ;;
    *)
      die "未知参数: $mode (使用 --help 查看帮助)"
      ;;
  esac
}

main "$@"
