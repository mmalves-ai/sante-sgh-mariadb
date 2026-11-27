#!/bin/sh
# Executa SQL no MariaDB do projeto (container sante-sgh-mariadb) sem expor a senha.
# uso: tools/db/sql.sh [banco] < arquivo.sql      |  tools/db/sql.sh [banco] -e "select 1"
# Opções extras do cliente mariadb podem vir depois do banco (ex.: --force).
set -eu
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
# MARIADB_SENHA no ambiente vale sobre o .env (a árvore do E2E com banco não tem .env: tools/obra/e2e-vm.sh --banco).
SENHA=${MARIADB_SENHA:-$(grep '^MARIADB_SENHA=' "$RAIZ/.env" | cut -d= -f2-)}
BANCO=${1:-}; [ $# -gt 0 ] && shift
exec docker exec -i -e MYSQL_PWD="$SENHA" sante-sgh-mariadb mariadb -uroot --default-character-set=utf8mb4 ${BANCO:+"$BANCO"} "$@"
