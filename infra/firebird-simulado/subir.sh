#!/usr/bin/env bash
# Sobe o Firebird que simula, em dev, o servidor vivo de um hospital (ADR 0010).
# Idempotente: pode rodar quantas vezes quiser.
# - container sante-sgh-fb-prontocardio (Firebird 3.0.14), volume sante-sgh-fb-prontocardio-data
#   (a cópia da base já está lá: este script nunca copia nem apaga a base);
# - rede interna sante-sgh-conector-int (alias fb-prontocardio:3050) e loopback 127.0.0.1:3354;
# - sem gfix read_only: simula o servidor em uso; a proteção é do usuário e da transação;
# - usuário só leitura (FB_SIM_LEITOR_USUARIO) com a role LEITURA (só SELECT em toda tabela e view de usuário).
#   No Firebird 3 não há role padrão (GRANT DEFAULT é do 4): o cliente conecta com role LEITURA. Sem a role, o
#   leitor não lê tabela de usuário. DDL já é recusado pelo próprio servidor ("no privilege"), sem gatilho.
# Segredos: lidos do arquivo abaixo e passados por variável herdada; nunca aparecem na linha de comando.
set -euo pipefail

AQUI=$(cd "$(dirname "$0")" && pwd)
CT=sante-sgh-fb-prontocardio
IMG=firebirdsql/firebird:3.0.14-jammy
VOL=sante-sgh-fb-prontocardio-data
REDE=sante-sgh-conector-int
REDE_LO=sante-sgh-fb-loopback
DADOS=${SANTE_SGH_DADOS:-/home/mmalves/workspace/redesante/sante-sgh-dados}
SEGREDOS=${FB_SIM_SEGREDOS:-$DADOS/segredos/fb-prontocardio.env}
# O container é permanente (--restart unless-stopped): o databases.conf montado precisa morar num lugar estável,
# fora de qualquer worktree. Este script copia o da pasta para lá (cp mantém o inode do bind) e monta a cópia.
CONF_DIR=$DADOS/firebird-simulado
CONF=$CONF_DIR/databases.conf

[ -r "$SEGREDOS" ] || { echo "ERRO: arquivo de segredos ausente: $SEGREDOS" >&2; exit 1; }
set -a; . "$SEGREDOS"; set +a
: "${FB_SIM_SYSDBA_SENHA:?}" "${FB_SIM_LEITOR_USUARIO:?}" "${FB_SIM_LEITOR_SENHA:?}"

docker volume inspect "$VOL" >/dev/null 2>&1 || { echo "ERRO: volume $VOL não existe (a cópia da base não foi feita)" >&2; exit 1; }
docker run --rm --network none -v "$VOL:/d:ro" --entrypoint test "$IMG" -s /d/prontocardio.fdb \
  || { echo "ERRO: /prontocardio.fdb ausente ou vazio no volume $VOL; não copio: relate ao orquestrador" >&2; exit 1; }

mkdir -p "$CONF_DIR"
cmp -s "$AQUI/databases.conf" "$CONF" || cp "$AQUI/databases.conf" "$CONF"

docker network inspect "$REDE" >/dev/null 2>&1 || docker network create --internal "$REDE" >/dev/null
# Rede --internal não publica porta. Para o loopback do host, uma segunda rede sem mascaramento (sem NAT de
# saída: o container não alcança fora da VM) e só com a porta em 127.0.0.1.
docker network inspect "$REDE_LO" >/dev/null 2>&1 || docker network create \
  -o com.docker.network.bridge.enable_ip_masquerade=false "$REDE_LO" >/dev/null

# Container antigo com o databases.conf montado de outro lugar (ex.: de um worktree): recria. O volume da base
# fica; usuário, role e GRANTs são refeitos logo abaixo.
if docker container inspect "$CT" >/dev/null 2>&1; then
  ORIGEM=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/opt/firebird/databases.conf"}}{{.Source}}{{end}}{{end}}' "$CT")
  if [ "$ORIGEM" != "$CONF" ]; then
    docker rm -f "$CT" >/dev/null
    echo "container $CT recriado: databases.conf montado de $CONF (antes: ${ORIGEM:-nenhum})"
  fi
fi
if ! docker container inspect "$CT" >/dev/null 2>&1; then
  export FIREBIRD_ROOT_PASSWORD="$FB_SIM_SYSDBA_SENHA"
  docker create --name "$CT" --restart unless-stopped \
    --network "$REDE" --network-alias fb-prontocardio \
    -p 127.0.0.1:3354:3050 \
    -e FIREBIRD_ROOT_PASSWORD \
    -v "$VOL:/var/lib/firebird/data" \
    -v "$CONF:/opt/firebird/databases.conf:ro" \
    --health-cmd 'bash -c "</dev/tcp/127.0.0.1/3050"' --health-interval 15s --health-timeout 5s --health-retries 5 \
    "$IMG" firebird >/dev/null
  unset FIREBIRD_ROOT_PASSWORD
  echo "container $CT criado"
fi
docker inspect -f '{{json .NetworkSettings.Networks}}' "$CT" | grep -q "\"$REDE_LO\"" \
  || docker network connect "$REDE_LO" "$CT"
[ "$(docker inspect -f '{{.State.Running}}' "$CT")" = true ] || docker start "$CT" >/dev/null

for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$CT")" = healthy ] && break; sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$CT")" = healthy ] || { echo "ERRO: $CT não ficou saudável" >&2; exit 1; }

# Usuário, role e GRANTs: tudo como SYSDBA, por stdin (a senha não vai para argumentos).
esc() { printf "%s" "$1" | sed "s/'/''/g"; }
U=$(printf "%s" "$FB_SIM_LEITOR_USUARIO" | tr '[:lower:]' '[:upper:]')
export ISC_USER=SYSDBA ISC_PASSWORD="$FB_SIM_SYSDBA_SENHA"
docker exec -i -e ISC_USER -e ISC_PASSWORD "$CT" /opt/firebird/bin/isql -b -q localhost:prontocardio <<SQL
SET TERM ^ ;
CREATE OR ALTER USER $U PASSWORD '$(esc "$FB_SIM_LEITOR_SENHA")' USING PLUGIN Srp^
COMMIT^
EXECUTE BLOCK AS
  DECLARE n CHAR(63);
BEGIN
  IF (NOT EXISTS (SELECT 1 FROM RDB\$ROLES WHERE RDB\$ROLE_NAME = 'LEITURA')) THEN
    EXECUTE STATEMENT 'CREATE ROLE LEITURA';
END^
COMMIT^
EXECUTE BLOCK AS
  DECLARE n CHAR(63);
BEGIN
  FOR SELECT RDB\$RELATION_NAME FROM RDB\$RELATIONS WHERE COALESCE(RDB\$SYSTEM_FLAG, 0) = 0 INTO :n DO
    EXECUTE STATEMENT 'GRANT SELECT ON "' || TRIM(n) || '" TO ROLE LEITURA';
  EXECUTE STATEMENT 'GRANT LEITURA TO $U';
END^
COMMIT^
SET TERM ; ^
SQL
unset ISC_PASSWORD
echo "ok: $CT saudável; leitor e role LEITURA conferidos"
