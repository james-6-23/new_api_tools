#!/usr/bin/env bash
set -euo pipefail

#######################################
# NewAPI Middleware Tool - 快速安装脚本
#
# 用法:
#   bash <(curl -sSL https://raw.githubusercontent.com/james-6-23/new_api_tools/main/install.sh)
#
# 功能:
#   1. 自动检测 NewAPI 安装目录
#   2. 检测是否已安装，提供更新/重新安装选项
#   3. Clone 项目到 NewAPI 同级目录
#   4. 自动运行部署脚本
#######################################

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die() { log_error "$*"; exit 1; }

REPO_URL="https://github.com/james-6-23/new_api_tools.git"
PROJECT_NAME="new_api_tools"
REINSTALL=false

#######################################
# 检查必要命令
#######################################
check_requirements() {
  local missing=()

  command -v git >/dev/null 2>&1 || missing+=("git")
  command -v docker >/dev/null 2>&1 || missing+=("docker")

  # 检查 docker-compose 或 docker compose
  if command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
  elif docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
  else
    missing+=("docker-compose 或 docker compose")
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    die "缺少必要命令: ${missing[*]}"
  fi

  log_success "环境检查通过 (使用 $DOCKER_COMPOSE)"
}

#######################################
# 检测 NewAPI 容器和目录
#######################################
detect_newapi_location() {
  log_info "正在检测 NewAPI 安装位置..."

  # 查找 new-api 容器
  local container_id
  container_id=$(docker ps --format '{{.ID}}\t{{.Names}}' | awk '$2=="new-api"{print $1; exit}')

  if [[ -z "$container_id" ]]; then
    container_id=$(docker ps -q --filter 'label=com.docker.compose.service=new-api' | head -n 1)
  fi

  if [[ -z "$container_id" ]]; then
    container_id=$(docker ps --format '{{.ID}}\t{{.Image}}' | awk 'tolower($2) ~ /(^|\/)new-api(:|$)/ {print $1; exit}')
  fi

  if [[ -z "$container_id" ]]; then
    log_warn "未找到运行中的 NewAPI 容器"
    log_info "将安装到当前目录: $(pwd)"
    INSTALL_DIR="$(pwd)"
    return 0
  fi

  log_success "找到 NewAPI 容器: $container_id"

  # 尝试获取 compose 文件路径
  local compose_file
  compose_file=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$container_id" 2>/dev/null || true)

  if [[ -n "$compose_file" ]]; then
    # 提取第一个配置文件路径
    compose_file=$(echo "$compose_file" | sed 's/,.*$//')
    if [[ -f "$compose_file" ]]; then
      INSTALL_DIR=$(dirname "$compose_file")
      log_success "检测到 NewAPI 目录: $INSTALL_DIR"
      return 0
    fi
  fi

  # 尝试从 working_dir 获取
  local working_dir
  working_dir=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$container_id" 2>/dev/null || true)

  if [[ -n "$working_dir" && -d "$working_dir" ]]; then
    INSTALL_DIR="$working_dir"
    log_success "检测到 NewAPI 目录: $INSTALL_DIR"
    return 0
  fi

  # 默认使用当前目录
  log_warn "无法自动检测 NewAPI 目录位置"
  log_info "将安装到当前目录: $(pwd)"
  INSTALL_DIR="$(pwd)"
}

#######################################
# 检测是否已安装服务
#######################################
check_existing_installation() {
  local target_dir="${INSTALL_DIR}/${PROJECT_NAME}"
  
  # 检查项目目录是否存在
  if [[ ! -d "$target_dir" ]]; then
    log_info "未检测到已安装的服务，将进行全新安装"
    return 0
  fi

  log_info "检测到已安装的服务: $target_dir"
  
  # 检查相关容器是否运行
  local running_containers
  running_containers=$(docker ps --format '{{.Names}}' | grep -E '^(newapi-tools-backend|newapi-tools-frontend)$' 2>/dev/null || true)
  
  if [[ -n "$running_containers" ]]; then
    log_info "检测到运行中的容器:"
    echo "$running_containers" | while read -r name; do
      echo "  - $name"
    done
  fi

  echo ""
  echo -e "${YELLOW}========================================${NC}"
  echo -e "${YELLOW}  检测到已安装的服务${NC}"
  echo -e "${YELLOW}========================================${NC}"
  echo ""
  echo "请选择操作:"
  echo "  [回车] 更新 - 保留数据，仅更新代码和重建容器"
  echo "  [y]   重新安装 - 删除所有相关文件、容器和镜像，全新安装"
  echo "  [n]   取消 - 退出安装"
  echo ""
  read -r -p "请输入选择 [回车/y/n]: " choice

  case "$choice" in
    "")
      log_info "选择: 更新安装"
      REINSTALL=false
      ;;
    [yY]|[yY][eE][sS])
      log_warn "选择: 重新安装 (将删除所有相关数据)"
      echo ""
      read -r -p "确认要删除所有数据并重新安装吗? [y/N]: " confirm
      if [[ "$confirm" =~ ^[yY]$ ]]; then
        REINSTALL=true
        perform_cleanup "$target_dir"
      else
        log_info "已取消重新安装"
        REINSTALL=false
      fi
      ;;
    [nN]|[nN][oO])
      log_info "已取消安装"
      exit 0
      ;;
    *)
      log_warn "无效输入，默认执行更新"
      REINSTALL=false
      ;;
  esac
}

#######################################
# 执行清理操作 (重新安装时)
#######################################
perform_cleanup() {
  local target_dir="$1"
  
  log_info "开始清理已安装的服务..."

  # 1. 停止并删除容器
  log_info "停止并删除相关容器..."
  
  # 尝试使用 docker-compose 停止
  if [[ -f "${target_dir}/docker-compose.yml" ]]; then
    cd "$target_dir"
    $DOCKER_COMPOSE down --remove-orphans 2>/dev/null || true
    cd - >/dev/null
  fi

  # 强制删除可能残留的容器
  local containers
  containers=$(docker ps -a --format '{{.Names}}' | grep -E '^(newapi-tools-backend|newapi-tools-frontend)$' 2>/dev/null || true)
  if [[ -n "$containers" ]]; then
    echo "$containers" | xargs -r docker rm -f 2>/dev/null || true
    log_success "已删除相关容器"
  fi

  # 2. 删除相关镜像
  log_info "删除相关镜像..."
  local images
  images=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^(newapi-tools-backend|newapi-tools-frontend|new_api_tools)' 2>/dev/null || true)
  if [[ -n "$images" ]]; then
    echo "$images" | xargs -r docker rmi -f 2>/dev/null || true
    log_success "已删除相关镜像"
  fi

  # 也尝试删除可能的 compose 项目镜像
  images=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E 'new_api_tools' 2>/dev/null || true)
  if [[ -n "$images" ]]; then
    echo "$images" | xargs -r docker rmi -f 2>/dev/null || true
  fi

  # 3. 删除相关网络 (如果存在)
  log_info "清理相关网络..."
  docker network rm new_api_tools_default 2>/dev/null || true

  # 4. 删除项目目录
  log_info "删除项目目录: $target_dir"
  if [[ -d "$target_dir" ]]; then
    rm -rf "$target_dir"
    log_success "已删除项目目录"
  fi

  # 5. 清理未使用的 Docker 资源
  log_info "清理未使用的 Docker 资源..."
  docker system prune -f 2>/dev/null || true

  log_success "清理完成，准备全新安装"
  echo ""
}

#######################################
# Clone 或更新项目
#######################################
clone_or_update_project() {
  local target_dir="${INSTALL_DIR}/${PROJECT_NAME}"

  if [[ -d "$target_dir" ]]; then
    log_info "项目已存在，正在更新..."
    cd "$target_dir"
    git fetch origin
    git reset --hard origin/main
    log_success "项目已更新到最新版本"
  else
    log_info "正在克隆项目到: $target_dir"
    git clone "$REPO_URL" "$target_dir"
    log_success "项目克隆完成"
    cd "$target_dir"
  fi

  PROJECT_DIR="$target_dir"
}

#######################################
# 快速更新服务 (保留配置)
#######################################
quick_update() {
  log_info "执行快速更新..."
  
  local env_file="${PROJECT_DIR}/.env"
  local compose_file="${PROJECT_DIR}/docker-compose.yml"
  
  if [[ ! -f "$env_file" ]]; then
    log_warn "未找到 .env 配置文件，将执行完整部署流程"
    return 1
  fi
  
  if [[ ! -f "$compose_file" ]]; then
    die "找不到 docker-compose.yml 文件"
  fi
  
  cd "$PROJECT_DIR"
  
  log_info "拉取最新镜像..."
  $DOCKER_COMPOSE -f "$compose_file" --env-file "$env_file" pull
  
  log_info "重启服务..."
  $DOCKER_COMPOSE -f "$compose_file" --env-file "$env_file" down
  $DOCKER_COMPOSE -f "$compose_file" --env-file "$env_file" up -d
  
  # 获取前端端口
  local frontend_port
  frontend_port=$(grep -E '^FRONTEND_PORT=' "$env_file" | cut -d'=' -f2 || echo "1145")
  
  # 获取服务器 IP
  local server_ip
  server_ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || server_ip="$(ip route get 1 2>/dev/null | awk '{print $7; exit}')" || server_ip="localhost"
  
  echo ""
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}  更新完成!${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  echo -e "前端访问地址: ${BLUE}http://${server_ip}:${frontend_port}${NC}"
  echo ""
  
  return 0
}

#######################################
# 运行部署脚本
#######################################
run_deploy() {
  # 如果不是重新安装且已有配置，执行快速更新
  if [[ "$REINSTALL" == "false" && -f "${PROJECT_DIR}/.env" ]]; then
    if quick_update; then
      exit 0
    fi
  fi
  
  log_info "正在启动部署脚本..."

  if [[ ! -f "${PROJECT_DIR}/deploy.sh" ]]; then
    die "找不到部署脚本: ${PROJECT_DIR}/deploy.sh"
  fi

  chmod +x "${PROJECT_DIR}/deploy.sh"

  # 运行部署脚本
  exec "${PROJECT_DIR}/deploy.sh"
}

#######################################
# 主函数
#######################################
main() {
  echo ""
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}  NewAPI Middleware Tool 快速安装${NC}"
  echo -e "${BLUE}========================================${NC}"
  echo ""

  check_requirements
  detect_newapi_location
  check_existing_installation
  clone_or_update_project
  run_deploy
}

main "$@"
