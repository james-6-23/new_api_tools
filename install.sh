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
# 根据 .env 中的 NEWAPI_NETWORK 检测 host 模式，
# 设置 COMPOSE_FILE 让所有后续 docker compose 调用自动叠加 host overlay。
# 在任何 $DOCKER_COMPOSE 调用前先调用本函数（通常 cd 到 project_dir 之后）。
#######################################
setup_compose_files() {
  local project_dir="${1:-.}"
  local env_file="${project_dir}/.env"
  local base="${project_dir}/docker-compose.yml"
  local host_overlay="${project_dir}/docker-compose.host.yml"

  unset COMPOSE_FILE

  [[ -f "$env_file" ]] || return 0

  # 必须显式存在 NEWAPI_NETWORK 行才判断；行缺失视为老版 .env，让 base compose 走默认 fallback
  # 注意：set -e + pipefail 下，grep 无匹配会让 pipe 退出码为 1 → 整个脚本死掉，必须 || true 兜底。
  local nw_line
  nw_line=$(grep -E '^NEWAPI_NETWORK=' "$env_file" 2>/dev/null | head -n1 || true)
  [[ -n "$nw_line" ]] || return 0

  local nw
  nw=$(echo "$nw_line" | cut -d'=' -f2- | tr -d '\r\n')

  # NEWAPI_NETWORK= （空值）→ deploy.sh 在 host 模式下生成的标记
  if [[ -z "$nw" && -f "$host_overlay" ]]; then
    export COMPOSE_FILE="${base}:${host_overlay}"
  fi
}

#######################################
# 只清理本项目命名的 Docker 残留资源。
# 注意：不要调用 docker system prune，它会全局删除其他项目的已停止容器、
# 未使用网络、悬空镜像和构建缓存。
#######################################
cleanup_project_docker_resources() {
  log_info "清理 newapi-tools 残留 Docker 资源..."

  docker ps -a --format '{{.Names}}' \
    | grep -E '^(newapi-tools|newapi-tools-redis|newapi-tools-backend|newapi-tools-frontend)$' \
    | xargs -r docker rm -f 2>/dev/null || true

  docker images --format '{{.Repository}}:{{.Tag}}' \
    | grep -E '^(ghcr\.io/james-6-23/new_api_tools|new_api_tools|newapi-tools|newapi-tools-backend|newapi-tools-frontend)(:|$)' \
    | xargs -r docker rmi -f 2>/dev/null || true

  docker network rm newapi-tools-network new_api_tools_default 2>/dev/null || true
}

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
# 查找运行中的 NewAPI 容器，输出容器名（找不到则输出空并返回 1）。
# 兼容自定义命名 / fork 镜像：容器名或镜像名包含 new-api 词元即可
#   （例如 new-api-master、ghcr.io/xxx/new-api-my:latest）。
# 注意不会误伤本项目自身容器 newapi-tools（无连字符，不含 new-api 子串）。
# 可用环境变量 NEWAPI_CONTAINER=<容器名或ID> 强制指定，跳过自动检测。
#######################################
find_newapi_container() {
  # 1) 环境变量显式指定，优先级最高
  if [[ -n "${NEWAPI_CONTAINER:-}" ]]; then
    echo "$NEWAPI_CONTAINER"
    return 0
  fi

  local found=""

  # 2) 按容器名匹配：new-api / new-api-master / new-api-my ...
  found=$(docker ps --format '{{.Names}}' | awk 'tolower($0) ~ /(^|[-_])new-api([-_]|$)/ {print; exit}')
  [[ -n "$found" ]] && { echo "$found"; return 0; }

  # 3) 按 compose service 标签匹配
  found=$(docker ps --filter 'label=com.docker.compose.service=new-api' --format '{{.Names}}' | head -n 1)
  [[ -n "$found" ]] && { echo "$found"; return 0; }

  # 4) 按镜像名匹配：允许 fork 后缀（new-api-my:latest 也能命中）
  found=$(docker ps --format '{{.Names}}\t{{.Image}}' | awk -F'\t' 'tolower($2) ~ /(^|\/)new-api([-_:]|$)/ {print $1; exit}')
  [[ -n "$found" ]] && { echo "$found"; return 0; }

  return 1
}

#######################################
# 检测 NewAPI 容器和目录
#######################################
detect_newapi_location() {
  log_info "正在检测 NewAPI 安装位置..."

  # 查找 new-api 容器（兼容自定义命名 / fork 镜像，详见 find_newapi_container）
  local container_id
  container_id=$(find_newapi_container || true)

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
# 显示初始安装环境检测
#######################################
show_initial_env_detection() {
  echo ""
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}                    环境检测结果${NC}"
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
  echo ""

  # 检测 NewAPI 容器信息（兼容自定义命名 / fork 镜像，详见 find_newapi_container）
  local newapi_container=""
  newapi_container=$(find_newapi_container || true)

  if [[ -n "$newapi_container" ]]; then
    echo -e "  ${GREEN}✓${NC} NewAPI 容器: ${GREEN}${newapi_container}${NC}"

    # 检测网络
    local networks network_mode
    networks=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$newapi_container" 2>/dev/null | head -n 1)
    network_mode=$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$newapi_container" 2>/dev/null || true)

    if [[ "$network_mode" == "host" ]]; then
      echo -e "  ${YELLOW}!${NC} 网络模式: ${YELLOW}Host 模式${NC}"
      echo -e "    ${YELLOW}→ NewAPI 与宿主机共享网络栈${NC}"
      echo -e "    ${YELLOW}→ newapi-tools 将通过 host.docker.internal 访问数据库${NC}"
      echo -e "    ${YELLOW}→ 启动时会附加 docker-compose.host.yml overlay${NC}"
    elif [[ "$networks" == "bridge" ]]; then
      echo -e "  ${YELLOW}!${NC} 网络模式: ${YELLOW}Bridge 模式${NC}"
      echo -e "    ${YELLOW}→ NewAPI 使用默认 bridge 网络${NC}"
      echo -e "    ${YELLOW}→ 将使用 IPv4 地址连接数据库${NC}"
    else
      echo -e "  ${GREEN}✓${NC} 网络模式: ${GREEN}正常模式${NC}"
      echo -e "    → 网络名称: ${GREEN}${networks}${NC}"
    fi

    # 检测数据库类型
    local sql_dsn
    sql_dsn=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$newapi_container" 2>/dev/null | awk -F= '$1=="SQL_DSN"{print $2; exit}')

    if [[ -n "$sql_dsn" ]]; then
      if [[ "$sql_dsn" =~ ^postgres ]]; then
        echo -e "  ${GREEN}✓${NC} 数据库类型: ${GREEN}PostgreSQL${NC}"
      elif [[ "$sql_dsn" =~ ^mysql ]]; then
        echo -e "  ${GREEN}✓${NC} 数据库类型: ${GREEN}MySQL${NC}"
      fi
    fi
  else
    echo -e "  ${RED}✗${NC} NewAPI 容器: ${RED}未找到${NC}"
    echo -e "    ${YELLOW}请确保 NewAPI 容器正在运行${NC}"
  fi

  echo ""
  echo -e "  安装目录: ${YELLOW}${INSTALL_DIR}/${PROJECT_NAME}${NC}"
  echo ""
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
  echo ""

  if [[ -z "$newapi_container" ]]; then
    echo -e "${YELLOW}警告: 未检测到 NewAPI 容器，部署可能会失败${NC}"
    echo ""
    read -r -p "是否继续安装? [y/N]: " confirm
    if [[ ! "$confirm" =~ ^[yY]$ ]]; then
      log_info "已取消安装"
      exit 0
    fi
  else
    read -r -p "按回车键开始安装，或输入 n 取消: " confirm
    if [[ "$confirm" =~ ^[nN]$ ]]; then
      log_info "已取消安装"
      exit 0
    fi
  fi
}

#######################################
# 检测是否已安装服务
#######################################
check_existing_installation() {
  local target_dir="${INSTALL_DIR}/${PROJECT_NAME}"

  # 检查项目目录是否存在
  if [[ ! -d "$target_dir" ]]; then
    # 显示初始安装环境检测
    show_initial_env_detection
    log_info "开始全新安装..."
    return 0
  fi

  # 设置 PROJECT_DIR 供后续函数使用
  PROJECT_DIR="$target_dir"

  log_info "检测到已安装的服务: $target_dir"

  # 检查服务状态
  local service_status="未知"
  local container_status
  container_status=$(docker ps --format '{{.Names}}' | grep -E '^newapi-tools$' 2>/dev/null || true)

  if [[ -n "$container_status" ]]; then
    service_status="${GREEN}运行中${NC}"
  else
    container_status=$(docker ps -a --format '{{.Names}}' | grep -E '^newapi-tools$' 2>/dev/null || true)
    if [[ -n "$container_status" ]]; then
      service_status="${YELLOW}已停止${NC}"
    else
      service_status="${RED}未运行${NC}"
    fi
  fi

  # 显示交互式菜单
  show_management_menu "$target_dir" "$service_status"
}

#######################################
# 检测环境详情
#######################################
detect_env_details() {
  local target_dir="$1"

  # 读取 .env 文件获取配置信息
  local env_file="${target_dir}/.env"

  if [[ -f "$env_file" ]]; then
    ENV_NEWAPI_NETWORK=$(grep -E '^NEWAPI_NETWORK=' "$env_file" 2>/dev/null | cut -d'=' -f2 || echo "未知")
    ENV_DB_ENGINE=$(grep -E '^DB_ENGINE=' "$env_file" 2>/dev/null | cut -d'=' -f2 || echo "未知")
    ENV_DB_DNS=$(grep -E '^DB_DNS=' "$env_file" 2>/dev/null | cut -d'=' -f2 || echo "未知")
    ENV_DB_PORT=$(grep -E '^DB_PORT=' "$env_file" 2>/dev/null | cut -d'=' -f2 || echo "未知")
    ENV_DB_NAME=$(grep -E '^DB_NAME=' "$env_file" 2>/dev/null | cut -d'=' -f2 || echo "未知")
    ENV_FRONTEND_PORT=$(grep -E '^FRONTEND_PORT=' "$env_file" 2>/dev/null | cut -d'=' -f2 || echo "1145")
    ENV_ADMIN_PASSWORD=$(grep -E '^ADMIN_PASSWORD=' "$env_file" 2>/dev/null | cut -d'=' -f2- || echo "")
    # SERVER_HOST 读取 .env 中显式声明的最后一行（处理用户多次写入的情况）；缺失视为默认 127.0.0.1
    local _sh_raw
    _sh_raw=$(grep -E '^SERVER_HOST=' "$env_file" 2>/dev/null | tail -n1 | cut -d'=' -f2- || true)
    _sh_raw="${_sh_raw//[\"\'\ $'\r'$'\n'$'\t']/}"
    ENV_SERVER_HOST="${_sh_raw:-127.0.0.1}"
    # FRONTEND_BIND 控制 1145 端口对外暴露（0.0.0.0 公开 / 127.0.0.1 仅本机）
    local _fb_raw
    _fb_raw=$(grep -E '^FRONTEND_BIND=' "$env_file" 2>/dev/null | tail -n1 | cut -d'=' -f2- || true)
    _fb_raw="${_fb_raw//[\"\'\ $'\r'$'\n'$'\t']/}"
    ENV_FRONTEND_BIND="${_fb_raw:-0.0.0.0}"
  else
    ENV_NEWAPI_NETWORK="未配置"
    ENV_DB_ENGINE="未配置"
    ENV_DB_DNS="未配置"
    ENV_DB_PORT="未配置"
    ENV_DB_NAME="未配置"
    ENV_SERVER_HOST="未配置"
    ENV_FRONTEND_BIND="未配置"
    ENV_FRONTEND_PORT="1145"
    ENV_ADMIN_PASSWORD=""
  fi

  # 判断网络模式
  if [[ "$ENV_NEWAPI_NETWORK" == "newapi-tools-network" ]]; then
    NETWORK_MODE="Bridge 模式"
    NETWORK_MODE_COLOR="${YELLOW}Bridge 模式${NC} (使用 IPv4 地址连接数据库)"
  elif [[ "$ENV_NEWAPI_NETWORK" == "未配置" || "$ENV_NEWAPI_NETWORK" == "未知" ]]; then
    NETWORK_MODE="未配置"
    NETWORK_MODE_COLOR="${RED}未配置${NC}"
  else
    NETWORK_MODE="正常模式"
    NETWORK_MODE_COLOR="${GREEN}正常模式${NC} (使用 Docker 网络服务发现)"
  fi

  # 判断后端绑定模式（影响 8000 端口的暴露范围）
  if [[ "$ENV_SERVER_HOST" == "0.0.0.0" || "$ENV_SERVER_HOST" == "::" ]]; then
    BIND_MODE="不安全"
    BIND_MODE_COLOR="${RED}${ENV_SERVER_HOST}${NC} (8000 端口对外暴露，不推荐)"
  elif [[ "$ENV_SERVER_HOST" == "127.0.0.1" || "$ENV_SERVER_HOST" == "localhost" || "$ENV_SERVER_HOST" == "::1" ]]; then
    BIND_MODE="安全"
    BIND_MODE_COLOR="${GREEN}${ENV_SERVER_HOST}${NC} (仅容器内 Nginx 反代访问)"
  else
    BIND_MODE="自定义"
    BIND_MODE_COLOR="${YELLOW}${ENV_SERVER_HOST}${NC}"
  fi

  # 判断前端端口暴露范围（FRONTEND_BIND 控制 1145 是否对外）
  if [[ "$ENV_FRONTEND_BIND" == "127.0.0.1" || "$ENV_FRONTEND_BIND" == "localhost" || "$ENV_FRONTEND_BIND" == "::1" ]]; then
    FRONTEND_BIND_MODE="仅本机"
    FRONTEND_BIND_COLOR="${GREEN}${ENV_FRONTEND_BIND}:${ENV_FRONTEND_PORT}${NC} (仅本机访问，需配 nginx 反代)"
  elif [[ "$ENV_FRONTEND_BIND" == "0.0.0.0" || "$ENV_FRONTEND_BIND" == "::" || "$ENV_FRONTEND_BIND" == "未配置" ]]; then
    FRONTEND_BIND_MODE="公网"
    FRONTEND_BIND_COLOR="${YELLOW}0.0.0.0:${ENV_FRONTEND_PORT}${NC} (任意 IP 可达)"
  else
    FRONTEND_BIND_MODE="自定义"
    FRONTEND_BIND_COLOR="${YELLOW}${ENV_FRONTEND_BIND}:${ENV_FRONTEND_PORT}${NC}"
  fi
}

#######################################
# 显示管理菜单
#######################################
show_management_menu() {
  local target_dir="$1"
  local service_status="$2"

  # 检测环境详情
  detect_env_details "$target_dir"

  # 获取服务器 IP
  local server_ip
  server_ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || server_ip="localhost"

  while true; do
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}              NewAPI Middleware Tool 管理面板${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${GREEN}【环境检测】${NC}"
    echo -e "  项目目录: ${YELLOW}$target_dir${NC}"
    echo -e "  服务状态: $service_status"
    echo -e "  访问地址: ${BLUE}http://${server_ip}:${ENV_FRONTEND_PORT}${NC}"
    echo ""
    echo -e "${GREEN}【登录凭证】${NC}"
    if [[ -n "$ENV_ADMIN_PASSWORD" ]]; then
      echo -e "  登录密码: ${YELLOW}${ENV_ADMIN_PASSWORD}${NC}"
    else
      echo -e "  登录密码: ${RED}未在 .env 中找到${NC}"
    fi
    echo ""
    echo -e "${GREEN}【网络模式】${NC}"
    echo -e "  运行模式: $NETWORK_MODE_COLOR"
    echo -e "  网络名称: ${YELLOW}${ENV_NEWAPI_NETWORK}${NC}"
    echo ""
    echo -e "${GREEN}【数据库配置】${NC}"
    echo -e "  数据库类型: ${YELLOW}${ENV_DB_ENGINE}${NC}"
    echo -e "  数据库地址: ${YELLOW}${ENV_DB_DNS}:${ENV_DB_PORT}${NC}"
    echo -e "  数据库名称: ${YELLOW}${ENV_DB_NAME}${NC}"
    echo ""
    echo -e "${GREEN}【后端绑定】${NC}"
    echo -e "  SERVER_HOST: $BIND_MODE_COLOR"
    echo -e "  对外端口:    $FRONTEND_BIND_COLOR"
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}【操作菜单】${NC}"
    echo ""
    echo "  1) 更新服务   (拉取最新代码和镜像，重启容器)"
    echo "  2) 查看状态   (显示容器运行状态和资源占用)"
    echo "  3) 查看日志   (实时查看容器日志，Ctrl+C 退出)"
    echo "  4) 重启服务   (重启所有容器，不更新镜像)"
    echo ""
    echo "  5) 停止服务   (停止所有容器，保留数据)"
    echo "  6) 启动服务   (启动已停止的容器)"
    echo ""
    echo "  7) 重新配置   (备份当前配置，重新运行部署向导)"
    echo "  8) 重新安装   (删除容器和配置，保留数据，全新部署)"
    echo "  9) 完全卸载   (删除所有内容，包括数据，需确认)"
    echo " 10) 完全重装   (完全卸载后重新安装，需确认)"
    echo ""
    if [[ "$BIND_MODE" == "不安全" || "$FRONTEND_BIND_MODE" == "公网" ]]; then
      echo -e " 11) ${GREEN}安全设置${NC}     (切换 SERVER_HOST / 切换前端端口暴露范围)"
    else
      echo " 11) 安全设置     (切换 SERVER_HOST / 切换前端端口暴露范围)"
    fi
    echo ""
    echo "  0) 退出"
    echo ""
    read -r -p "请选择操作 [0-11]: " choice

    case "$choice" in
      1)
        do_update_interactive "$target_dir"
        exit 0
        ;;
      2)
        do_status_interactive "$target_dir"
        echo ""
        read -r -p "按回车键继续..."
        ;;
      3)
        do_logs_interactive "$target_dir"
        ;;
      4)
        do_restart_interactive "$target_dir"
        echo ""
        read -r -p "按回车键继续..."
        service_status="${GREEN}运行中${NC}"
        ;;
      5)
        do_stop_interactive "$target_dir"
        echo ""
        read -r -p "按回车键继续..."
        service_status="${YELLOW}已停止${NC}"
        ;;
      6)
        do_start_interactive "$target_dir"
        echo ""
        read -r -p "按回车键继续..."
        service_status="${GREEN}运行中${NC}"
        ;;
      7)
        do_reconfigure_interactive "$target_dir"
        exit 0
        ;;
      8)
        echo ""
        echo -e "${YELLOW}重新安装将：${NC}"
        echo "  • 删除现有 newapi-tools 容器和 .env 配置"
        echo "  • 保留 data 目录（GeoIP / 本地存储）"
        echo "  • 重新运行部署向导"
        echo ""
        echo -e "${GREEN}NewAPI 自身的数据库 / 用户数据完全不受影响${NC}"
        echo ""
        read -r -p "确认重新安装? [y/N]: " confirm
        if [[ "$confirm" =~ ^[yY]$ ]]; then
          REINSTALL=true
          perform_cleanup "$target_dir"
          return 0
        fi
        ;;
      9)
        do_purge_interactive "$target_dir"
        exit 0
        ;;
      10)
        do_full_reinstall_interactive "$target_dir"
        ;;
      11)
        do_security_settings_interactive "$target_dir"
        echo ""
        read -r -p "按回车键继续..."
        # 重新读取以刷新菜单上的状态
        detect_env_details "$target_dir"
        ;;
      0|"")
        log_info "退出"
        exit 0
        ;;
      *)
        log_warn "无效选择，请重新输入"
        ;;
    esac
  done
}

#######################################
# 安全设置子菜单
# 提供 SERVER_HOST / FRONTEND_BIND 两个开关
#######################################
do_security_settings_interactive() {
  local project_dir="$1"
  while true; do
    detect_env_details "$project_dir"
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  安全设置${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  当前 SERVER_HOST     : $BIND_MODE_COLOR"
    echo -e "  当前对外端口绑定     : $FRONTEND_BIND_COLOR"
    echo ""
    echo "  1) 切换 SERVER_HOST（Go 后端 8000 端口绑定地址）"
    echo "  2) 切换前端端口绑定（${ENV_FRONTEND_PORT} 端口是否对公网开放）"
    echo ""
    echo "  0) 返回上级菜单"
    echo ""
    read -r -p "请选择 [0-2]: " choice
    case "$choice" in
      1) do_toggle_bind_mode_interactive "$project_dir" ;;
      2) do_toggle_frontend_bind_interactive "$project_dir" ;;
      0|"") return 0 ;;
      *) log_warn "无效选择" ;;
    esac
  done
}

#######################################
# 切换前端端口绑定（FRONTEND_BIND）
#######################################
do_toggle_frontend_bind_interactive() {
  local project_dir="$1"
  local env_file="${project_dir}/.env"
  [[ -f "$env_file" ]] || { log_error "未找到 .env"; return 1; }
  cd "$project_dir"

  local current
  current=$(grep -E '^FRONTEND_BIND=' "$env_file" 2>/dev/null | tail -n1 | cut -d'=' -f2- || true)
  current="${current//[\"\'\ $'\r'$'\n'$'\t']/}"
  current="${current:-0.0.0.0}"

  echo ""
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  切换前端端口（${ENV_FRONTEND_PORT}）暴露范围${NC}"
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  当前: ${YELLOW}${current}:${ENV_FRONTEND_PORT}${NC}"
  echo ""
  echo -e "  ${YELLOW}1) 公网可达${NC}    FRONTEND_BIND=0.0.0.0"
  echo -e "                  浏览器可直接 http://server-ip:${ENV_FRONTEND_PORT} 访问"
  echo -e "                  适合内网部署 / 域名解析未就绪 / 需要快速访问的场景"
  echo ""
  echo -e "  ${GREEN}2) 仅本机${NC}      FRONTEND_BIND=127.0.0.1"
  echo -e "                  外部直连不通，需配宿主机 nginx 反代到 https://your-domain"
  echo -e "                  ${GREEN}推荐${NC}：HTTPS、域名、隔离公网攻击面"
  echo ""
  echo "  0) 取消"
  echo ""
  read -r -p "请选择 [0-2]: " choice
  local target=""
  case "$choice" in
    1) target="0.0.0.0" ;;
    2)
      echo ""
      log_warn "切换后将无法用 IP:${ENV_FRONTEND_PORT} 直接访问，必须先在宿主机配好 nginx 反代"
      log_warn "示例 nginx 配置:"
      cat <<NGINX
   server {
     listen 443 ssl http2;
     server_name your-domain.com;
     ssl_certificate     /path/to/fullchain.pem;
     ssl_certificate_key /path/to/privkey.pem;
     location / {
       proxy_pass http://127.0.0.1:${ENV_FRONTEND_PORT};
       proxy_set_header Host \$host;
       proxy_set_header X-Real-IP \$remote_addr;
       proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto \$scheme;
     }
   }
NGINX
      echo ""
      read -r -p "确认切换? [y/N]: " confirm
      [[ "$confirm" =~ ^[yY]$ ]] || { log_info "已取消"; return 0; }
      target="127.0.0.1"
      ;;
    0|"") log_info "已取消"; return 0 ;;
    *) log_warn "无效选择"; return 1 ;;
  esac

  if [[ "$current" == "$target" ]]; then
    log_info "当前已是 ${target}，无需切换"
    return 0
  fi

  sed -i.bak 's|^FRONTEND_BIND=|# Disabled by install.sh: FRONTEND_BIND=|g' "$env_file" 2>/dev/null && rm -f "${env_file}.bak"
  echo "FRONTEND_BIND=${target}" >> "$env_file"
  log_success "已写入 FRONTEND_BIND=${target}"

  setup_compose_files "$project_dir"
  log_info "重启服务以应用新绑定..."
  $DOCKER_COMPOSE down 2>&1 | tail -5
  $DOCKER_COMPOSE up -d 2>&1 | tail -5
  log_success "服务已重启"
}

#######################################
# 切换 Go 后端绑定地址（安全 ⇄ 暴露）
# 用法：菜单选项 11
#######################################
do_toggle_bind_mode_interactive() {
  local project_dir="$1"
  local env_file="${project_dir}/.env"

  if [[ ! -f "$env_file" ]]; then
    log_error "未找到 .env 文件: $env_file"
    return 1
  fi

  cd "$project_dir"

  # 读取当前值（与 detect_env_details 一致的解析规则）
  local current
  current=$(grep -E '^SERVER_HOST=' "$env_file" 2>/dev/null | tail -n1 | cut -d'=' -f2- || true)
  current="${current//[\"\'\ $'\r'$'\n'$'\t']/}"
  current="${current:-127.0.0.1}"

  echo ""
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  Go 后端绑定模式切换${NC}"
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  当前: ${YELLOW}SERVER_HOST=${current}${NC}"
  echo ""
  echo -e "  ${GREEN}1) 安全模式${NC}    SERVER_HOST=127.0.0.1"
  echo -e "                  Go 后端只监听容器内 loopback，由 Nginx 反代到 ${ENV_FRONTEND_PORT} 端口对外。"
  echo -e "                  这是${GREEN}推荐${NC}配置。"
  echo ""
  echo -e "  ${RED}2) 暴露模式${NC}    SERVER_HOST=0.0.0.0"
  echo -e "                  Go 后端 8000 端口监听容器所有接口。"
  echo -e "                  ${RED}host 网络模式下会直接暴露到宿主机外网，有安全风险。${NC}"
  echo -e "                  仅在调试或自定义反代时使用。"
  echo ""
  echo "  0) 取消"
  echo ""
  read -r -p "请选择 [0-2]: " choice

  local target=""
  case "$choice" in
    1) target="127.0.0.1" ;;
    2)
      echo ""
      log_warn "你即将把 Go 后端 8000 端口暴露到容器虚拟网卡所有接口"
      log_warn "请确认你了解此操作的安全影响"
      read -r -p "继续? [y/N]: " confirm
      [[ "$confirm" =~ ^[yY]$ ]] || { log_info "已取消"; return 0; }
      target="0.0.0.0"
      ;;
    0|"") log_info "已取消"; return 0 ;;
    *) log_warn "无效选择"; return 1 ;;
  esac

  if [[ "$current" == "$target" ]]; then
    log_info "当前已是 ${target}，无需切换"
    return 0
  fi

  # 注释掉所有旧的 SERVER_HOST 行（保留追溯），追加新值到末尾
  sed -i.bak 's|^SERVER_HOST=|# Disabled by install.sh: SERVER_HOST=|g' "$env_file" 2>/dev/null && rm -f "${env_file}.bak"
  echo "SERVER_HOST=${target}" >> "$env_file"
  log_success "已写入 SERVER_HOST=${target}"

  # 重启容器使配置生效（环境变量只在容器启动时读取）
  setup_compose_files "$project_dir"
  log_info "重启服务以应用新绑定..."
  $DOCKER_COMPOSE down 2>&1 | tail -5
  $DOCKER_COMPOSE up -d 2>&1 | tail -5
  log_success "服务已用新绑定重启"
}

#######################################
# 交互式更新
#######################################
do_update_interactive() {
  local project_dir="$1"
  cd "$project_dir"

  # 更新代码
  if [[ -d ".git" ]]; then
    log_info "更新代码..."
    git fetch origin 2>/dev/null || true
    git reset --hard origin/main 2>/dev/null || log_warn "代码更新跳过"
  fi

  # 下载 GeoIP 数据库
  PROJECT_DIR="$project_dir"
  download_geoip_database

  # 迁移旧版 .env（补充 Go 版本所需字段）
  migrate_env_file "$project_dir"

  # 安全检查：SERVER_HOST 是否绑定到不安全的 0.0.0.0
  check_server_host_security "$project_dir"

  # 根据 .env 自动选择 compose 文件（host 模式叠加 overlay）
  setup_compose_files "$project_dir"

  # 拉取最新镜像并重启
  log_info "拉取最新镜像..."
  $DOCKER_COMPOSE pull

  log_info "重启服务..."
  $DOCKER_COMPOSE down
  $DOCKER_COMPOSE up -d

  log_success "更新完成!"
  echo ""
  $DOCKER_COMPOSE ps

  # 显示访问地址
  local frontend_port
  frontend_port=$(grep -E '^FRONTEND_PORT=' .env 2>/dev/null | cut -d'=' -f2 || echo "1145")
  local server_ip
  server_ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || server_ip="localhost"
  echo ""
  echo -e "访问地址: ${GREEN}http://${server_ip}:${frontend_port}${NC}"
}

#######################################
# 交互式查看状态
#######################################
do_status_interactive() {
  local project_dir="$1"
  cd "$project_dir"
  setup_compose_files "$project_dir"

  echo ""
  echo -e "${BLUE}--- 容器状态 ---${NC}"
  $DOCKER_COMPOSE ps

  echo ""
  echo -e "${BLUE}--- 资源使用 ---${NC}"
  docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}" $($DOCKER_COMPOSE ps -q 2>/dev/null) 2>/dev/null || echo "无法获取资源使用情况"

  echo ""
  echo -e "${BLUE}--- 访问信息 ---${NC}"
  local frontend_port
  frontend_port=$(grep -E '^FRONTEND_PORT=' .env 2>/dev/null | cut -d'=' -f2 || echo "1145")
  local server_ip
  server_ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || server_ip="localhost"
  echo -e "访问地址: ${GREEN}http://${server_ip}:${frontend_port}${NC}"

  echo ""
  echo -e "${BLUE}--- 配置信息 ---${NC}"
  echo "数据库类型: $(grep -E '^DB_ENGINE=' .env 2>/dev/null | cut -d'=' -f2 || echo '未知')"
  echo "数据库地址: $(grep -E '^DB_DNS=' .env 2>/dev/null | cut -d'=' -f2 || echo '未知')"
  echo "网络: $(grep -E '^NEWAPI_NETWORK=' .env 2>/dev/null | cut -d'=' -f2 || echo '未知')"
}

#######################################
# 交互式查看日志
#######################################
do_logs_interactive() {
  local project_dir="$1"
  cd "$project_dir"
  setup_compose_files "$project_dir"
  log_info "显示实时日志 (Ctrl+C 返回菜单)..."
  echo ""
  $DOCKER_COMPOSE logs -f --tail=100 || true
}

#######################################
# 交互式重启
#######################################
do_restart_interactive() {
  local project_dir="$1"
  cd "$project_dir"
  setup_compose_files "$project_dir"
  log_info "重启服务..."
  $DOCKER_COMPOSE restart
  log_success "服务已重启"
  echo ""
  $DOCKER_COMPOSE ps
}

#######################################
# 交互式停止
#######################################
do_stop_interactive() {
  local project_dir="$1"
  cd "$project_dir"
  setup_compose_files "$project_dir"
  log_info "停止服务..."
  $DOCKER_COMPOSE stop
  log_success "服务已停止"
}

#######################################
# 交互式启动
#######################################
do_start_interactive() {
  local project_dir="$1"
  cd "$project_dir"
  setup_compose_files "$project_dir"
  log_info "启动服务..."
  $DOCKER_COMPOSE start
  log_success "服务已启动"
  echo ""
  $DOCKER_COMPOSE ps
}

#######################################
# 交互式重新配置
#######################################
do_reconfigure_interactive() {
  local project_dir="$1"
  cd "$project_dir"
  log_info "重新配置服务..."

  # 备份旧配置
  if [[ -f ".env" ]]; then
    cp .env ".env.backup.$(date +%Y%m%d_%H%M%S)"
    log_info "已备份旧配置文件"
  fi

  # 删除旧配置以触发重新配置
  rm -f .env

  # 运行部署脚本
  exec ./deploy.sh
}

#######################################
# 交互式完全卸载
#######################################
do_purge_interactive() {
  local project_dir="$1"
  cd "$project_dir"

  echo ""
  echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}  警告: 完全卸载${NC}"
  echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${YELLOW}将永久删除以下 newapi-tools 自身的数据：${NC}"
  echo "  • 容器: newapi-tools / newapi-tools-redis"
  echo "  • 镜像: ghcr.io/james-6-23/new_api_tools:*"
  echo "  • Redis 缓存卷 (仪表盘 / 模型状态 / 等缓存)"
  echo "  • Docker 网络: newapi-tools-network (若存在)"
  echo "  • 配置文件 .env (含登录密码)"
  echo "  • 项目目录: ${project_dir}"
  echo ""
  echo -e "${GREEN}NewAPI 本身完全不受影响：${NC}"
  echo "  ✓ NewAPI 容器、数据库、Redis、用户充值/Token/日志 → 全部保留"
  echo "  ✓ 本项目仅以只读方式访问 NewAPI 数据库，从不写入"
  echo ""
  echo -e "${YELLOW}卸载后想再用，重新跑 install.sh 一键部署即可${NC}"
  echo ""
  read -r -p "输入 'DELETE' 确认完全卸载: " confirm

  if [[ "$confirm" != "DELETE" ]]; then
    log_info "已取消"
    return 0
  fi

  log_warn "正在完全卸载..."

  # 停止并删除容器和 volumes
  $DOCKER_COMPOSE down -v 2>/dev/null || true

  # 删除相关镜像
  log_info "删除相关镜像..."
  docker images --format '{{.Repository}}:{{.Tag}}' | grep -E 'new_api_tools|newapi-tools' | xargs -r docker rmi -f 2>/dev/null || true

  # 删除网络
  docker network rm newapi-tools-network 2>/dev/null || true

  # 记录目录位置
  local dir_to_remove="$project_dir"

  # 切换到上级目录
  cd ..

  # 删除项目目录
  log_info "删除项目目录..."
  rm -rf "$dir_to_remove"

  log_success "完全卸载完成"
}

#######################################
# 交互式完全重装 (卸载后重新安装)
#######################################
do_full_reinstall_interactive() {
  local project_dir="$1"

  echo ""
  echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}  警告: 完全重新安装${NC}"
  echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${YELLOW}将执行：${NC}"
  echo "  1. 删除现有 newapi-tools 容器 / 镜像 / 缓存卷 / 项目目录"
  echo "  2. 重新克隆项目代码"
  echo "  3. 重新运行部署向导（会再次询问密码 / 端口绑定等）"
  echo ""
  echo -e "${YELLOW}影响范围：${NC}"
  echo "  • newapi-tools 自身数据丢失（密码、缓存、配置）"
  echo "  • 重新部署后需重新设置登录密码"
  echo ""
  echo -e "${GREEN}不影响：${NC}"
  echo "  ✓ NewAPI 容器、数据库、用户业务数据 → 全部保留"
  echo ""
  read -r -p "输入 'REINSTALL' 确认完全重装: " confirm

  if [[ "$confirm" != "REINSTALL" ]]; then
    log_info "已取消"
    return 0
  fi

  log_warn "正在执行完全重装..."

  cd "$project_dir"

  # 停止并删除容器和 volumes
  log_info "停止并删除容器..."
  $DOCKER_COMPOSE down -v 2>/dev/null || true

  cleanup_project_docker_resources

  # 记录安装目录（项目目录的父目录）
  local install_dir
  install_dir=$(dirname "$project_dir")

  # 切换到上级目录
  cd "$install_dir"

  # 删除项目目录
  log_info "删除项目目录..."
  rm -rf "$project_dir"

  log_success "卸载完成，开始重新安装..."
  echo ""

  # 重新设置安装目录并执行安装
  INSTALL_DIR="$install_dir"
  REINSTALL=true

  # 重新检测 NewAPI 环境并显示
  detect_newapi_location
  show_initial_env_detection

  # 克隆项目
  clone_or_update_project

  # 运行部署脚本
  run_deploy
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

  # 2. 删除本项目残留 Docker 资源
  cleanup_project_docker_resources

  # 3. 删除项目目录
  log_info "删除项目目录: $target_dir"
  if [[ -d "$target_dir" ]]; then
    rm -rf "$target_dir"
    log_success "已删除项目目录"
  fi

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
# 下载 GeoIP 数据库
#######################################
download_geoip_database() {
  local geoip_dir="${PROJECT_DIR}/data/geoip"
  local city_db="${geoip_dir}/GeoLite2-City.mmdb"
  local asn_db="${geoip_dir}/GeoLite2-ASN.mmdb"

  # 如果数据库已存在，跳过下载
  if [[ -f "$city_db" && -f "$asn_db" ]]; then
    log_success "GeoIP 数据库已存在"
    return 0
  fi

  log_info "下载 GeoIP 数据库..."
  mkdir -p "$geoip_dir"

  local base_url="https://raw.githubusercontent.com/adysec/IP_database/main/geolite"
  local fallback_url="https://raw.gitmirror.com/adysec/IP_database/main/geolite"

  if [[ ! -f "$city_db" ]]; then
    curl -sL --connect-timeout 15 -o "$city_db" "${base_url}/GeoLite2-City.mmdb" 2>/dev/null || \
    curl -sL --connect-timeout 30 -o "$city_db" "${fallback_url}/GeoLite2-City.mmdb" 2>/dev/null || \
    log_warn "GeoLite2-City.mmdb 下载失败"
  fi

  if [[ ! -f "$asn_db" ]]; then
    curl -sL --connect-timeout 15 -o "$asn_db" "${base_url}/GeoLite2-ASN.mmdb" 2>/dev/null || \
    curl -sL --connect-timeout 30 -o "$asn_db" "${fallback_url}/GeoLite2-ASN.mmdb" 2>/dev/null || \
    log_warn "GeoLite2-ASN.mmdb 下载失败"
  fi

  [[ -f "$city_db" && -f "$asn_db" ]] && log_success "GeoIP 数据库就绪"
}

#######################################
# 检查并更新配置文件
#######################################
check_and_update_configs() {
  local compose_file="${PROJECT_DIR}/docker-compose.yml"
  local env_file="${PROJECT_DIR}/.env"
  local updated=false

  # 检查 docker-compose.yml 是否包含 geoip 挂载
  if ! grep -q "data/geoip" "$compose_file" 2>/dev/null; then
    log_info "检测到旧版配置，更新 docker-compose.yml..."
    # 使用 git 更新后的文件已包含 geoip 配置，无需手动修改
    updated=true
  fi

  # 检查 geoip 目录是否存在
  if [[ ! -d "${PROJECT_DIR}/data/geoip" ]]; then
    log_info "创建 GeoIP 数据目录..."
    mkdir -p "${PROJECT_DIR}/data/geoip"
    updated=true
  fi

  if [[ "$updated" == "true" ]]; then
    log_success "配置已更新，将下载 GeoIP 数据库"
  fi
}

#######################################
# 迁移旧版 .env 文件 (从 Python 版升级到 Go 版)
# 为旧用户自动补充 Go 版本所需的新字段
#######################################
migrate_env_file() {
  local project_dir="$1"
  local env_file="${project_dir}/.env"

  [[ -f "$env_file" ]] || return 0

  local migrated=false

  # 补充 SQL_DSN（从分离字段构建）
  if ! grep -q '^SQL_DSN=' "$env_file" 2>/dev/null; then
    local db_engine db_dns db_port db_user db_password db_name sql_dsn=""
    db_engine=$(grep -E '^DB_ENGINE=' "$env_file" | cut -d'=' -f2)
    db_dns=$(grep -E '^DB_DNS=' "$env_file" | cut -d'=' -f2)
    db_port=$(grep -E '^DB_PORT=' "$env_file" | cut -d'=' -f2)
    db_user=$(grep -E '^DB_USER=' "$env_file" | cut -d'=' -f2)
    db_password=$(grep -E '^DB_PASSWORD=' "$env_file" | cut -d'=' -f2)
    db_name=$(grep -E '^DB_NAME=' "$env_file" | cut -d'=' -f2)

    if [[ -n "$db_dns" ]]; then
      if [[ "$db_engine" == "postgres" || "$db_engine" == "postgresql" ]]; then
        sql_dsn="host=${db_dns} port=${db_port:-5432} user=${db_user} password=${db_password} dbname=${db_name} sslmode=disable"
      else
        sql_dsn="${db_user}:${db_password}@tcp(${db_dns}:${db_port:-3306})/${db_name}?charset=utf8mb4&parseTime=True"
      fi
    fi

    # 在数据库配置段后插入 SQL_DSN
    sed -i "/^DB_ENGINE=/i SQL_DSN=${sql_dsn}" "$env_file" 2>/dev/null || \
      echo "SQL_DSN=${sql_dsn}" >> "$env_file"
    migrated=true
    log_info "已补充 SQL_DSN 配置"
  fi

  # 补充 TIMEZONE
  if ! grep -q '^TIMEZONE=' "$env_file" 2>/dev/null; then
    echo "TIMEZONE=Asia/Shanghai" >> "$env_file"
    migrated=true
  fi

  # 补充 LOG_LEVEL
  if ! grep -q '^LOG_LEVEL=' "$env_file" 2>/dev/null; then
    echo "LOG_LEVEL=info" >> "$env_file"
    migrated=true
  fi

  # 补充 REDIS_PASSWORD（避免 compose WARN）
  if ! grep -q '^REDIS_PASSWORD=' "$env_file" 2>/dev/null; then
    echo "REDIS_PASSWORD=" >> "$env_file"
    migrated=true
  fi

  if [[ "$migrated" == "true" ]]; then
    log_success "已自动补充 Go 版本所需的配置字段"
  fi
}

#######################################
# 检查 SERVER_HOST 安全性
# 默认 Go 后端绑定 127.0.0.1，仅 Nginx 反代访问
# 若用户显式配了 0.0.0.0，给出告警并询问是否改回（保留兼容旧配置的用户）
#######################################
check_server_host_security() {
  local env_file="${1}/.env"
  [[ -f "$env_file" ]] || return 0

  local host_line
  # set -e + pipefail 下，grep 无匹配会让 pipe 退出码为 1 → 必须 || true 兜底，否则脚本静默退出。
  host_line=$(grep -E '^SERVER_HOST=' "$env_file" 2>/dev/null | head -n1 || true)
  [[ -z "$host_line" ]] && return 0

  local host_value
  host_value=$(echo "$host_line" | cut -d'=' -f2-)
  # 去掉所有引号、空白、回车
  host_value="${host_value//[\"\'\ $'\r'$'\n'$'\t']/}"

  if [[ "$host_value" == "0.0.0.0" || "$host_value" == "::" ]]; then
    echo ""
    log_warn "⚠ 检测到 .env 中 SERVER_HOST=${host_value}"
    log_warn "   Go 后端 (8000 端口) 会暴露到容器虚拟网卡所有接口"
    log_warn "   若是 host 网络模式部署，会直接暴露到宿主机外部，有安全风险"
    echo ""
    read -r -p "是否改为安全默认值 SERVER_HOST=127.0.0.1（推荐）? [Y/n]: " confirm
    if [[ ! "$confirm" =~ ^[nN]$ ]]; then
      # 注释掉旧行，追加新行
      sed -i.bak 's|^SERVER_HOST=|# Disabled by install.sh (insecure): SERVER_HOST=|' "$env_file" 2>/dev/null && rm -f "${env_file}.bak"
      echo "SERVER_HOST=127.0.0.1" >> "$env_file"
      log_success "已改为 SERVER_HOST=127.0.0.1"
    else
      log_info "保留 SERVER_HOST=${host_value}（确认你了解风险）"
    fi
  fi
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

  # 检查并更新配置（为老用户添加 GeoIP 支持）
  check_and_update_configs

  # 迁移旧版 .env（补充 Go 版本所需字段）
  migrate_env_file "$PROJECT_DIR"

  # 安全检查：SERVER_HOST 是否绑定到不安全的 0.0.0.0
  check_server_host_security "$PROJECT_DIR"

  # 下载 GeoIP 数据库
  download_geoip_database

  # 根据 .env 自动选择 compose 文件（host 模式叠加 overlay）
  setup_compose_files "$PROJECT_DIR"
  local -a compose_args=(--env-file "$env_file")
  if [[ -z "${COMPOSE_FILE:-}" ]]; then
    compose_args+=(-f "$compose_file")
  fi

  # 拉取最新镜像
  log_info "拉取最新镜像..."
  $DOCKER_COMPOSE "${compose_args[@]}" pull

  log_info "重启服务..."
  $DOCKER_COMPOSE "${compose_args[@]}" down
  $DOCKER_COMPOSE "${compose_args[@]}" up -d

  # 确保容器连接到 NewAPI 网络（host 模式下 NEWAPI_NETWORK 为空，跳过）
  local newapi_network
  newapi_network=$(grep -E '^NEWAPI_NETWORK=' "$env_file" | cut -d'=' -f2 || true)
  if [[ -n "$newapi_network" ]]; then
    log_info "连接到 NewAPI 网络: $newapi_network"
    docker network connect "$newapi_network" newapi-tools 2>/dev/null || log_warn "网络已连接"
  fi

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
  echo -e "查看日志: ${YELLOW}cd ${PROJECT_DIR} && docker compose logs -f${NC}"
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
# 查找已安装的项目目录
#######################################
find_installed_dir() {
  # 优先检查环境变量
  if [[ -n "${PROJECT_DIR:-}" && -d "$PROJECT_DIR" ]]; then
    echo "$PROJECT_DIR"
    return 0
  fi

  # 检查当前目录
  if [[ -f "./docker-compose.yml" && -f "./.env" ]]; then
    echo "$(pwd)"
    return 0
  fi

  # 检查常见安装位置
  local possible_dirs=(
    "/opt/new_api_tools"
    "/root/new_api_tools"
    "$HOME/new_api_tools"
    "$(pwd)/new_api_tools"
  )

  for dir in "${possible_dirs[@]}"; do
    if [[ -f "$dir/docker-compose.yml" && -f "$dir/.env" ]]; then
      echo "$dir"
      return 0
    fi
  done

  # 尝试通过容器查找
  local container_dir
  container_dir=$(docker inspect newapi-tools 2>/dev/null | grep -oP '"Source": "\K[^"]+(?=/data")' | head -1 || true)
  if [[ -n "$container_dir" ]]; then
    local parent_dir=$(dirname "$container_dir")
    if [[ -f "$parent_dir/docker-compose.yml" ]]; then
      echo "$parent_dir"
      return 0
    fi
  fi

  return 1
}

#######################################
# 显示帮助信息
#######################################
show_help() {
  cat <<EOF
NewAPI Middleware Tool - 安装管理脚本

用法:
  install.sh [选项]

选项:
  (无参数)        交互式安装和管理
  --help          显示此帮助信息

环境变量:
  PROJECT_DIR      指定项目目录（默认: 自动检测）
  NEWAPI_CONTAINER 指定 NewAPI 容器名（默认: 自动检测）

更多信息: https://github.com/james-6-23/new_api_tools
EOF
}

#######################################
# 主函数
#######################################
main() {
  local action="${1:-}"

  # 只处理 --help 选项
  if [[ "$action" == "--help" || "$action" == "-h" ]]; then
    show_help
    exit 0
  fi

  # 如果有其他参数，显示错误
  if [[ -n "$action" ]]; then
    log_error "未知选项: $action"
    echo "使用 --help 查看帮助"
    exit 1
  fi

  # 交互式安装/管理
  echo ""
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}  NewAPI Middleware Tool 安装管理${NC}"
  echo -e "${BLUE}========================================${NC}"
  echo ""

  check_requirements
  detect_newapi_location
  check_existing_installation
  clone_or_update_project
  run_deploy
}

main "$@"
