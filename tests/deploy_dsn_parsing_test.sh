#!/usr/bin/env bash
set -euo pipefail

# 验证 deploy.sh 的 DSN 解析函数支持 NewAPI 的三种 SQL_DSN 格式：
#   URL:        mysql://user:pass@host:port/db, postgresql://...
#   Go 原生:    user:pass@tcp(host:port)/db?params  (MySQL 最常见)
#   PG keyword: host=... user=... password=... dbname=... port=...
# 以及情形 (a2) 宿主机回环数据库的 socat 代理地址改写。

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DEPLOY="$(mktemp)"
trap 'rm -f "$TMP_DEPLOY"' EXIT

sed '/^main "\$@"$/d' "$ROOT_DIR/deploy.sh" > "$TMP_DEPLOY"
source "$TMP_DEPLOY"

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL %s: expected <%s>, got <%s>\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
}

# ===== MySQL Go 原生 DSN =====
mysql_dsn='newapi:secret@tcp(127.0.0.1:3306)/new-api?charset=utf8mb4&parseTime=True'

assert_eq "mysql" "$(extract_dsn_engine "$mysql_dsn")" "mysql engine"
assert_eq "127.0.0.1" "$(extract_dsn_host "$mysql_dsn")" "mysql host"
assert_eq "newapi" "$(extract_dsn_user "$mysql_dsn")" "mysql user"
assert_eq "secret" "$(extract_dsn_password "$mysql_dsn")" "mysql password"
assert_eq "3306" "$(extract_dsn_port "$mysql_dsn")" "mysql port"
assert_eq "new-api" "$(extract_dsn_dbname "$mysql_dsn")" "mysql database"

# ===== MySQL URL DSN =====
mysql_url='mysql://root:pw@db-host:3307/newapi?foo=bar'

assert_eq "mysql" "$(extract_dsn_engine "$mysql_url")" "mysql url engine"
assert_eq "db-host" "$(extract_dsn_host "$mysql_url")" "mysql url host"
assert_eq "root" "$(extract_dsn_user "$mysql_url")" "mysql url user"
assert_eq "pw" "$(extract_dsn_password "$mysql_url")" "mysql url password"
assert_eq "3307" "$(extract_dsn_port "$mysql_url")" "mysql url port"
assert_eq "newapi" "$(extract_dsn_dbname "$mysql_url")" "mysql url database"

# ===== PostgreSQL URL DSN =====
pg_url='postgresql://postgres:pgpw@10.0.0.5:5432/new-api'

assert_eq "postgres" "$(extract_dsn_engine "$pg_url")" "pg url engine"
assert_eq "10.0.0.5" "$(extract_dsn_host "$pg_url")" "pg url host"
assert_eq "postgres" "$(extract_dsn_user "$pg_url")" "pg url user"
assert_eq "pgpw" "$(extract_dsn_password "$pg_url")" "pg url password"
assert_eq "5432" "$(extract_dsn_port "$pg_url")" "pg url port"
assert_eq "new-api" "$(extract_dsn_dbname "$pg_url")" "pg url database"

# ===== PostgreSQL keyword DSN =====
pg_kw='host=127.0.0.1 user=postgres password=pgpw dbname=new-api port=5433 sslmode=disable'

assert_eq "postgres" "$(extract_dsn_engine "$pg_kw")" "pg keyword engine"
assert_eq "127.0.0.1" "$(extract_dsn_host "$pg_kw")" "pg keyword host"
assert_eq "postgres" "$(extract_dsn_user "$pg_kw")" "pg keyword user"
assert_eq "pgpw" "$(extract_dsn_password "$pg_kw")" "pg keyword password"
assert_eq "5433" "$(extract_dsn_port "$pg_kw")" "pg keyword port"
assert_eq "new-api" "$(extract_dsn_dbname "$pg_kw")" "pg keyword database"

# ===== 情形 (a2)：宿主机回环数据库 → socat 代理地址改写 =====
DB_ENGINE="mysql"
DB_DNS="127.0.0.1"
DB_PORT="3306"
HOST_DB_PORT=""
HOST_DB_PROXY_PORT=""

configure_host_loopback_proxy

assert_eq "host.docker.internal" "$DB_DNS" "loopback proxy host"
assert_eq "13306" "$DB_PORT" "loopback proxy port"
assert_eq "3306" "$HOST_DB_PORT" "loopback source port"
assert_eq "13306" "$HOST_DB_PROXY_PORT" "loopback published proxy port"

DB_ENGINE="postgres"
DB_DNS="localhost"
DB_PORT="5432"
HOST_DB_PORT=""
HOST_DB_PROXY_PORT=""

configure_host_loopback_proxy

assert_eq "host.docker.internal" "$DB_DNS" "pg loopback proxy host"
assert_eq "15432" "$DB_PORT" "pg loopback proxy port"
assert_eq "5432" "$HOST_DB_PORT" "pg loopback source port"

echo "deploy DSN parsing tests passed"
