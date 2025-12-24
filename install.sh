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
#   2. Clone 项目到 NewAPI 同级目录
#   3. 自动运行部署脚本
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
# 运行部署脚本
#######################################
run_deploy() {
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
  clone_or_update_project
  run_deploy
}

main "$@"
