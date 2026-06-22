#!/usr/bin/env bash
set -euo pipefail

#######################################
# NewAPI Middleware Tool - 日志分库（LOG_SQL_DSN）兼容脚本
#
# 背景：
#   NewAPI 的部分 fork 支持 LOG_SQL_DSN，把 logs 表整张分离到
#   独立数据库。此时主库的 logs 表会被冻结、不再更新，本工具若只连主库就读不到
#   实时日志（dashboard 流量分析、使用日志、模型监控、风控/IP 分析全为 0）。
#
#   本脚本「只」负责日志库这一特例，刻意不动通用 deploy.sh：
#     1. 从 NewAPI 容器读取 LOG_SQL_DSN
#     2. 解析它，并对「数据库是容器、端口只发布在宿主机回环」「数据库是某条
#        bridge 网络上容器的 IP」等情形做容器名/网络改写（与 deploy.sh 同款逻辑）
#     3. 把改写后的 LOG_SQL_DSN 写进本工具的 .env，必要时把工具容器接入日志库网络
#     4. 重建本工具容器使其生效
#
# 用法：
#   ./setup-log-db.sh            # 交互式：检测 + 写入 .env + 重建
#   ./setup-log-db.sh --print    # 只检测并打印将写入的 LOG_SQL_DSN，不改任何东西
#   ./setup-log-db.sh --no-restart  # 写入 .env 但不自动重建容器
#
# 环境变量：
#   NEWAPI_CONTAINER   指定 NewAPI 容器名（默认自动检测）
#   LOG_SQL_DSN        直接指定日志库 DSN（跳过从 NewAPI 容器读取）
#######################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
TOOLS_CONTAINER="newapi-tools"
# ENV_FILE / COMPOSE_FILE 在 resolve_project_dir() 中确定（支持 curl 直跑）
ENV_FILE=""
COMPOSE_FILE=""

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()         { log_error "$*"; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "缺少必要命令: $1"; }

detect_docker_compose() {
  if docker compose version >/dev/null 2>&1; then DOCKER_COMPOSE="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then DOCKER_COMPOSE="docker-compose"
  else die "缺少 docker compose / docker-compose"; fi
}

#######################################
# 定位本工具的项目目录（含 .env 与 docker-compose.yml）。
# 支持三种运行方式：
#   1. 在项目目录里直接 ./setup-log-db.sh        → 用脚本所在目录
#   2. bash <(curl ...) 一键运行（无文件路径）   → 从运行中的 newapi-tools 容器
#      的 compose 工作目录标签反查，或扫描常见路径
#######################################
resolve_project_dir() {
  local candidates=()

  # (a) 脚本自身所在目录（普通 clone 后执行）
  if [[ -n "$SCRIPT_DIR" && -f "${SCRIPT_DIR}/docker-compose.yml" ]]; then
    candidates+=("$SCRIPT_DIR")
  fi

  # (b) 从运行中的 newapi-tools 容器读取 compose 工作目录标签
  local wd
  wd="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$TOOLS_CONTAINER" 2>/dev/null || true)"
  [[ -n "$wd" && -f "${wd}/docker-compose.yml" ]] && candidates+=("$wd")

  # (c) 当前工作目录
  [[ -f "./docker-compose.yml" ]] && candidates+=("$(pwd)")

  # (d) 常见安装路径
  local guess
  for guess in "$HOME/new_api_tools" "/root/new-api/new_api_tools" "/opt/new_api_tools" "./new_api_tools"; do
    [[ -f "${guess}/docker-compose.yml" ]] && candidates+=("$guess")
  done

  local dir
  for dir in "${candidates[@]}"; do
    if [[ -f "${dir}/.env" ]]; then
      PROJECT_DIR="$dir"; ENV_FILE="${dir}/.env"; COMPOSE_FILE="${dir}/docker-compose.yml"
      return 0
    fi
  done
  # 没找到带 .env 的；退而取第一个有 compose 的目录（.env 可能尚未生成）
  if [[ ${#candidates[@]} -gt 0 ]]; then
    PROJECT_DIR="${candidates[0]}"; ENV_FILE="${PROJECT_DIR}/.env"; COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
    return 0
  fi
  die "找不到 NewAPI-Tool 项目目录（含 docker-compose.yml/.env）。请 cd 到该目录后再运行本脚本。"
}

#######################################
# DSN 解析（兼容 URL 形式与 keyword 形式）
#   URL    : postgresql://user:pass@host:port/db
#   keyword: host=h port=p user=u password=pw dbname=db sslmode=disable
#######################################
dsn_field() {
  # $1=dsn  $2=field(host|port|user|password|dbname)
  local dsn="$1" field="$2"
  if [[ "$dsn" == *"://"* ]]; then
    case "$field" in
      host)     echo "$dsn" | sed -nE 's#^[a-zA-Z0-9+.-]+://[^@]*@([^:/?]+).*#\1#p' ;;
      port)     echo "$dsn" | sed -nE 's#^[a-zA-Z0-9+.-]+://[^@]*@[^:/?]+:([0-9]+).*#\1#p' ;;
      user)     echo "$dsn" | sed -nE 's#^[a-zA-Z0-9+.-]+://([^:@/?]+).*#\1#p' ;;
      password) echo "$dsn" | sed -nE 's#^[a-zA-Z0-9+.-]+://[^:@/?]+:([^@]*)@.*#\1#p' ;;
      dbname)   echo "$dsn" | sed -nE 's#^[a-zA-Z0-9+.-]+://[^@]*@[^/]+/([^?]+).*#\1#p' ;;
    esac
  else
    # keyword 形式：用空格分隔的 key=value
    echo "$dsn" | tr ' ' '\n' | sed -nE "s/^${field}=(.*)$/\1/p" | head -n1
  fi
}

# 重新组装成 Go pgx/mysql 可用的 keyword DSN（统一输出形式，便于本工具消费）
build_pg_keyword_dsn() {
  local host="$1" port="$2" user="$3" pass="$4" db="$5"
  echo "host=${host} port=${port:-5432} user=${user} password=${pass} dbname=${db} sslmode=disable"
}

#######################################
# Docker 探测（与 deploy.sh 同款思路）
#######################################
detect_newapi_container() {
  local found=""
  found="$(docker ps --format '{{.Names}}' | awk 'tolower($0) ~ /(^|[-_])new-api([-_]|$)/ {print; exit}')"
  [[ -n "$found" ]] && { echo "$found"; return 0; }
  found="$(docker ps --format '{{.ID}}\t{{.Image}}' | awk 'tolower($2) ~ /(^|\/)new-api([-_:]|$)/ {print $1; exit}')"
  [[ -n "$found" ]] && { echo "$found"; return 0; }
  return 1
}

docker_inspect_env_value() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null \
    | awk -F= -v k="$2" '$1==k{print $2; exit}'
}

is_ipv4_literal() { [[ "${1:-}" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; }

# 找「把指定宿主机端口发布到回环/0.0.0.0」的容器 → "网络<TAB>容器名<TAB>容器内端口"
find_container_by_published_port() {
  local target_port="${1:-}"; [[ -z "$target_port" ]] && return 0
  local cid name net cport
  while IFS= read -r cid; do
    [[ -z "$cid" ]] && continue
    cport="$(docker port "$cid" 2>/dev/null | awk -F' -> ' -v p="$target_port" '
      { n=split($2,h,":"); if (h[n]==p) { split($1,c,"/"); print c[1]; exit } }')"
    [[ -z "$cport" ]] && continue
    name="$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's#^/##')"
    while IFS= read -r net; do
      [[ -z "$net" ]] && continue
      case "$net" in bridge|host|none) continue ;; esac
      printf '%s\t%s\t%s\n' "$net" "$name" "$cport"; return 0
    done < <(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$cid" 2>/dev/null)
  done < <(docker ps -q)
  return 0
}

# 给定 IP，反查持有它的容器 → "网络<TAB>容器名"
find_container_by_network_ip() {
  local target_ip="${1:-}"; [[ -z "$target_ip" ]] && return 0
  local cid name net ip
  while IFS= read -r cid; do
    [[ -z "$cid" ]] && continue
    name="$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's#^/##')"
    while IFS=$'\t' read -r net ip; do
      [[ -z "$net" ]] && continue
      [[ "$ip" == "$target_ip" ]] && { printf '%s\t%s\n' "$net" "$name"; return 0; }
    done < <(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\t"}}{{$v.IPAddress}}{{"\n"}}{{end}}' "$cid" 2>/dev/null)
  done < <(docker ps -q)
  return 0
}

# 把工具容器接入指定网络（幂等）
ensure_tool_on_network() {
  local net="$1"
  docker network inspect "$net" >/dev/null 2>&1 || die "网络 '$net' 不存在"
  if docker ps -a --format '{{.Names}}' | grep -qx "$TOOLS_CONTAINER"; then
    docker network connect "$net" "$TOOLS_CONTAINER" 2>/dev/null \
      && log_success "已把 $TOOLS_CONTAINER 接入网络 $net" \
      || log_info "$TOOLS_CONTAINER 已在网络 $net 上"
  fi
}

# 读取 .env 里某 key 的值（无则空）
read_env_value() {
  [[ -f "$ENV_FILE" ]] || { echo ""; return 0; }
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d'=' -f2- || echo ""
}

# 写 docker-compose.override.yml，把日志库网络固化进工具服务。
# docker compose 默认会自动叠加 override 文件，使「纯 docker compose up」重建后
# 网络依然挂着（setup-log-db.sh 自己用纯 compose 重建，故能吃到它）。
# 注意：deploy.sh / install.sh 用显式 -f / COMPOSE_FILE，不会加载 override —— 那种
# 情况下网络会掉，但后端已做降级（不再崩），重跑本脚本即可恢复。
LOG_OVERRIDE_NET_NAME="log-db-network"
write_log_network_override() {
  local net="$1"
  local override="${PROJECT_DIR}/docker-compose.override.yml"
  local main_net; main_net="$(read_env_value NEWAPI_NETWORK)"

  # 日志库网络与主库网络相同 → 工具已经在上面，无需 override（避免重复挂同一网络报错）
  if [[ -n "$main_net" && "$net" == "$main_net" ]]; then
    log_info "日志库与主库同在网络 '$net'，无需额外网络配置"
    [[ -f "$override" ]] && grep -q "$LOG_OVERRIDE_NET_NAME" "$override" 2>/dev/null && \
      log_warn "检测到旧的 $override 仍引用日志库网络，如不再需要可手动删除"
    return 0
  fi

  cat > "$override" <<EOF
# 由 setup-log-db.sh 自动生成：把 newapi-tools 接入日志库所在的 docker 网络，
# 使「docker compose up」重建后日志库连接依然可用。请勿手改；重跑 setup-log-db.sh 会覆盖。
services:
  ${TOOLS_CONTAINER}:
    networks:
      - ${LOG_OVERRIDE_NET_NAME}
networks:
  ${LOG_OVERRIDE_NET_NAME}:
    external: true
    name: ${net}
EOF
  log_success "已写入 $override（固化日志库网络 '${net}'）"
}

# 把 KEY=VALUE 写入 .env（已存在则替换该行）
upsert_env() {
  local key="$1" value="$2"
  [[ -f "$ENV_FILE" ]] || die "未找到 $ENV_FILE，请先用 deploy.sh / install.sh 完成基础部署"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # 用 | 作分隔符；value 里若含 | 会出问题，但 DSN 不含 |
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

#######################################
# 主流程
#######################################
MODE="${1:-}"

main() {
  need_cmd docker
  detect_docker_compose
  resolve_project_dir

  echo ""
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}  NewAPI-Tool 日志分库（LOG_SQL_DSN）兼容${NC}"
  echo -e "${BLUE}========================================${NC}"
  echo ""

  # 1) 取 LOG_SQL_DSN
  local raw_dsn="${LOG_SQL_DSN:-}"
  if [[ -z "$raw_dsn" ]]; then
    local newapi="${NEWAPI_CONTAINER:-}"
    [[ -z "$newapi" ]] && newapi="$(detect_newapi_container || true)"
    [[ -n "$newapi" ]] || die "找不到 NewAPI 容器（可用 NEWAPI_CONTAINER=<名字> 指定，或用 LOG_SQL_DSN=<dsn> 直接给）"
    log_success "NewAPI 容器: $newapi"
    raw_dsn="$(docker_inspect_env_value "$newapi" 'LOG_SQL_DSN' || true)"
    if [[ -z "$raw_dsn" ]]; then
      log_warn "NewAPI 容器未设置 LOG_SQL_DSN —— 该实例没有把日志分库，无需本脚本。"
      log_info  "（本工具直接连主库即可读到 logs；当前日志为空多半是另有原因。）"
      exit 0
    fi
  fi
  log_success "检测到 LOG_SQL_DSN（原始）: ${raw_dsn}"

  # 2) 解析
  local host port user pass db
  host="$(dsn_field "$raw_dsn" host)"
  port="$(dsn_field "$raw_dsn" port)"; port="${port:-5432}"
  user="$(dsn_field "$raw_dsn" user)"
  pass="$(dsn_field "$raw_dsn" password)"
  db="$(dsn_field "$raw_dsn" dbname)"
  [[ -n "$host" && -n "$db" ]] || die "无法解析 LOG_SQL_DSN（host/dbname 缺失）: $raw_dsn"

  # 3) 决定工具怎么连到日志库（与 deploy.sh 主库逻辑同款）
  local need_network=""
  if [[ "$host" == "127.0.0.1" || "$host" == "localhost" || "$host" == "::1" ]]; then
    local hit hnet hname hport
    hit="$(find_container_by_published_port "$port")"
    hnet="$(printf '%s' "$hit" | cut -f1)"
    hname="$(printf '%s' "$hit" | cut -f2)"
    hport="$(printf '%s' "$hit" | cut -f3)"
    if [[ -n "$hnet" && -n "$hname" ]]; then
      log_warn "日志库 127.0.0.1:${port} 实为容器 '${hname}'（端口仅发布在宿主机回环，网关不可达）"
      log_info "将把 $TOOLS_CONTAINER 接入网络 '${hnet}'，用容器名 '${hname}:${hport}' 直连"
      host="$hname"; port="$hport"; need_network="$hnet"
    else
      host="host.docker.internal"
      log_info "日志库在宿主机回环上，改写为 host.docker.internal"
    fi
  elif is_ipv4_literal "$host"; then
    local hit hnet hname
    hit="$(find_container_by_network_ip "$host")"
    hnet="$(printf '%s' "$hit" | cut -f1)"
    hname="$(printf '%s' "$hit" | cut -f2)"
    if [[ -n "$hnet" && -n "$hname" ]]; then
      log_warn "日志库 ${host} 是容器 '${hname}' 在网络 '${hnet}' 上的 IP"
      log_info "将把 $TOOLS_CONTAINER 接入网络 '${hnet}'，用容器名直连"
      host="$hname"; need_network="$hnet"
    else
      log_info "日志库地址 ${host} 是 IP 但不属于已知 docker 网络容器，按外部地址原样使用"
    fi
  else
    log_info "日志库地址为主机名/外部地址，原样使用: ${host}"
  fi

  local final_dsn
  final_dsn="$(build_pg_keyword_dsn "$host" "$port" "$user" "$pass" "$db")"

  echo ""
  log_success "最终写入的 LOG_SQL_DSN:"
  echo -e "    ${GREEN}${final_dsn}${NC}"
  [[ -n "$need_network" ]] && echo -e "    需接入网络: ${GREEN}${need_network}${NC}"
  echo ""

  if [[ "$MODE" == "--print" ]]; then
    log_info "--print 模式：不修改任何文件 / 容器。"
    exit 0
  fi

  # 4) 写入 .env
  upsert_env "LOG_SQL_DSN" "$final_dsn"
  log_success "已写入 $ENV_FILE"

  # 5) 固化网络：写 override（持久）+ 立即接入（当前生效）
  if [[ -n "$need_network" ]]; then
    write_log_network_override "$need_network"
    ensure_tool_on_network "$need_network"
  fi

  if [[ "$MODE" == "--no-restart" ]]; then
    log_info "--no-restart：已写入 .env，未重建容器。稍后请手动："
    echo "    cd $PROJECT_DIR && $DOCKER_COMPOSE --env-file .env up -d --force-recreate $TOOLS_CONTAINER"
    exit 0
  fi

  # 6) 重建工具容器使其生效（纯 compose，会自动叠加 override，网络随之挂上）
  log_info "重建 $TOOLS_CONTAINER 以加载新配置..."
  ( cd "$PROJECT_DIR" && $DOCKER_COMPOSE --env-file .env up -d --force-recreate "$TOOLS_CONTAINER" )
  # 兜底：override 未生效时（极少数）也把网络补上
  [[ -n "$need_network" ]] && ensure_tool_on_network "$need_network"

  echo ""
  log_success "完成！日志类查询（仪表盘流量、使用日志、模型监控、风控/IP 分析）现在会读取日志库。"
  log_info "验证： $DOCKER_COMPOSE logs --tail=20 $TOOLS_CONTAINER  并刷新前端仪表盘。"
}

main "$@"
