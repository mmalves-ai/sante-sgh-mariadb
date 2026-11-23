#!/usr/bin/env bash
# Despejo diário do que não se recria por script: o banco de controle `plataforma`, o `espelho` padrão da base e os
# usuários do MariaDB. Vai para sante-sgh-dados/backup/ (fora do volume do MariaDB e fora do git), guardando 7 dias.
# Motivo: incidente de 23/11/2026 (VM congelada pelo host; dicionário do InnoDB corrompido).
# Uso: tools/obra/despejar-base.sh            (uma vez)
#      tools/obra/despejar-base.sh --laco     (a cada 24 h, em segundo plano)
set -u
AQUI="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$AQUI/../sante-sgh-dados/backup"
LOG="$AQUI/../sante-sgh-dados/obra/logs/despejar-base.log"
mkdir -p "$DEST" "$(dirname "$LOG")"

despejar() {
  set -a; . "$AQUI/.env"; set +a
  local d; d=$(date +%Y%m%d-%H%M) ok=1
  for b in plataforma espelho; do
    docker exec -e MYSQL_PWD="$MARIADB_SENHA" sante-sgh-mariadb mariadb-dump -uroot --single-transaction \
      --routines --triggers --databases "$b" 2>>"$LOG" | gzip > "$DEST/$b-$d.sql.gz.part"
    if [ "${PIPESTATUS[0]}" = 0 ]; then mv "$DEST/$b-$d.sql.gz.part" "$DEST/$b-$d.sql.gz"
    else rm -f "$DEST/$b-$d.sql.gz.part"; ok=0; fi
  done
  docker exec -e MYSQL_PWD="$MARIADB_SENHA" sante-sgh-mariadb mariadb -uroot -N -e \
    "SELECT CONCAT('SHOW CREATE USER ',QUOTE(user),'@',QUOTE(host),'; SHOW GRANTS FOR ',QUOTE(user),'@',QUOTE(host),';')
     FROM mysql.user WHERE user NOT IN ('mariadb.sys','root','healthcheck') AND user NOT LIKE 'sscon\\_%'" 2>>"$LOG" |
    docker exec -i -e MYSQL_PWD="$MARIADB_SENHA" sante-sgh-mariadb mariadb -uroot -N 2>>"$LOG" | sed 's/$/;/' \
    > "$DEST/usuarios-$d.sql"
  chmod 600 "$DEST/usuarios-$d.sql"
  find "$DEST" -maxdepth 1 -name '*-20??????-????.sql*' -mtime +7 -delete
  echo "$(date '+%d/%m %H:%M') despejo $d: $([ $ok = 1 ] && echo ok || echo FALHOU)" >> "$LOG"
}

if [ "${1:-}" = "--laco" ]; then
  while true; do despejar; sleep 86400; done
else
  despejar
fi
