#!/usr/bin/env bash
set -euo pipefail

#######################################
# NewAPI Middleware Tool - 日志分库（LOG_SQL_DSN）兼容脚本
#
# 背景：
#   NewAPI 的部分 fork（如 new-api-my）支持 LOG_SQL_DSN，把 logs 表整张分离到
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
TOOLS_CONTAINER="newapi-tools"

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

  # 5) 接入网络（如需）
  [[ -n "$need_network" ]] && ensure_tool_on_network "$need_network"

  if [[ "$MODE" == "--no-restart" ]]; then
    log_info "--no-restart：已写入 .env，未重建容器。稍后请手动："
    echo "    cd $SCRIPT_DIR && $DOCKER_COMPOSE --env-file .env up -d --force-recreate $TOOLS_CONTAINER"
    exit 0
  fi

  # 6) 重建工具容器使其生效
  log_info "重建 $TOOLS_CONTAINER 以加载新配置..."
  ( cd "$SCRIPT_DIR" && $DOCKER_COMPOSE --env-file .env up -d --force-recreate "$TOOLS_CONTAINER" )
  # 重建会重置网络连接，需重新接入
  [[ -n "$need_network" ]] && ensure_tool_on_network "$need_network"

  echo ""
  log_success "完成！日志类查询（仪表盘流量、使用日志、模型监控、风控/IP 分析）现在会读取日志库。"
  log_info "验证： $DOCKER_COMPOSE logs --tail=20 $TOOLS_CONTAINER  并刷新前端仪表盘。"
}

main "$@"
