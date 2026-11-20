#!/usr/bin/env bash
# Ensaio do Firebird 5 na cópia (M58-F2; ficha do M58, seção 5, passos 1 e 2; regras 4, 5 e 12).
# Rode SEMPRE sob a trava da cópia, que escolhe a cópia livre e passa FB_PC_PORTA:
#   /home/mmalves/workspace/redesante/obra-sgh/travas/com-copia.sh infra/firebird/fase7/ensaio-firebird5/ensaiar.sh <passo> [hospital]
# Passos (nesta ordem; cada um grava o tempo em .ensaio/<h>/tempos.env, fora do git):
#   subir      extrai a biblioteca ib_udf da imagem 3.0.14, sobe o servidor de ensaio (127.0.0.1:3355) e cria nele o
#              banco externo falso dos 4 gatilhos com ON EXTERNAL (o mesmo do banco-dev: só CPDIGITAL e CDDIGITAL)
#   backup     gbak -b no Firebird 3 da cópia (só leitura do banco; -g: sem coleta de lixo) → .fbk no volume de ensaio
#   restaurar  gbak -c do .fbk no Firebird 5 (ODS nova; gatilhos e procedures recompilados) e gfix -v -full
#   volta      restaura o mesmo .fbk num Firebird 3.0.14 descartável e verifica (regra 12), e o apaga em seguida
#   completo   backup, volta e restaurar, nesta ordem (a volta antes da restauração no 5: o pico de disco fica no
#              .fbk mais um banco); feito para rodar destacado (setsid nohup) e sobreviver à sessão que o iniciou
#   isolada    SBIS-13: backup da restaurada no 5 direto para outro servidor 5 sem rede e com volume próprio, gfix -v
#              -full, e o servidor e o volume isolados apagados em seguida (precisa de espaço para mais um banco)
#   anotar     <h> CARGA_RC|ASSINATURAS_PASTA|ASSINATURAS_REPETICAO|ASSINATURAS_BASE3|ASSINATURAS_GATILHOS <valor>: o
#              resultado de um comando de fora, para o pnpm ensaio:firebird5
#   estado     mostra só tamanhos, tempos e o estado dos containers
#   descer     para o servidor de ensaio (o volume fica)
#   limpar     apaga o .fbk (o espaço da máquina é compartilhado)
# Nunca imprime a senha (lida do ambiente do container da cópia) nem dado de linha. Não toca o banco de dev além de
# ler: o backup não grava no banco, e nada roda contra a produção (a IA nunca conecta à produção).
set -euo pipefail

passo=${1:?informe o passo: subir, backup, restaurar, volta, completo, isolada, anotar, estado, descer, limpar}
h=${2:-pc}
case "$h" in pc) ;; *) echo "só o estabelecimento pc por ora (HS-1)" >&2; exit 2 ;; esac

aqui=$(cd "$(dirname "$0")" && pwd)
raiz=$(cd "$aqui/../../../.." && pwd)
estado="$raiz/.ensaio/$h"
mkdir -p "$estado/udf"
tempos="$estado/tempos.env"
touch "$tempos"
log="$estado/ensaio.log"

# anotar: o resultado de um comando que roda fora deste script (só estas chaves), sem pedir a trava da cópia.
if [ "$passo" = anotar ]; then
  chave=${3:?anotar <hospital> <CHAVE> <valor>}
  valor=${4:?anotar <hospital> <CHAVE> <valor>}
  case "$chave" in
    CARGA_RC) [[ "$valor" =~ ^[0-9]+$ ]] || { echo "CARGA_RC: número" >&2; exit 2; } ;;
    ASSINATURAS_PASTA | ASSINATURAS_REPETICAO | ASSINATURAS_BASE3) [[ "$valor" =~ ^\.ensaio/[a-z0-9]+/[A-Za-z0-9/_.-]+$ ]] || { echo "$chave: dentro de .ensaio/" >&2; exit 2; } ;;
    ASSINATURAS_GATILHOS) [[ "$valor" =~ ^[A-Z][A-Z0-9_$]{0,62}(,[A-Z][A-Z0-9_$]{0,62})*$ ]] || { echo "ASSINATURAS_GATILHOS: nomes de gatilho separados por vírgula" >&2; exit 2; } ;;
    *) echo "chave não anotável: $chave" >&2; exit 2 ;;
  esac
  grep -v "^$chave=" "$tempos" > "$tempos.novo" || true
  echo "$chave=$valor" >> "$tempos.novo"
  mv "$tempos.novo" "$tempos"
  echo "[$(date +%H:%M:%S)] anotado $chave=$valor" | tee -a "$log"
  exit 0
fi

case "${FB_PC_PORTA:-}" in
  3351) copia="redesante-fb-$h" ;;
  3352) copia="redesante-fb-${h}2" ;;
  *) echo "rode sob com-copia.sh (FB_PC_PORTA 3351 ou 3352)" >&2; exit 2 ;;
esac
fb5="sgh-ensaio-fb5-$h"
dados=/var/lib/firebird/data
fbk="$dados/$h-fb3.fbk"

registrar() { # chave valor: grava em tempos.env (substitui a chave)
  grep -v "^$1=" "$tempos" > "$tempos.novo" || true
  echo "$1=$2" >> "$tempos.novo"
  mv "$tempos.novo" "$tempos"
}
diz() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$log"; }
agora() { date +%s; }

senha_da_copia() { docker exec "$copia" printenv FIREBIRD_ROOT_PASSWORD; }
compose() {
  FB_PC_SENHA=$(senha_da_copia) ENSAIO_HOSPITAL=$h ENSAIO_UDF_DIR="$estado/udf" \
    docker compose -f "$aqui/docker-compose.yml" "$@"
}

# Enquanto um passo longo roda, escreve o tamanho do arquivo de destino a cada minuto (o processo nunca fica mudo).
vigiar() { # container caminho
  while sleep 60; do
    t=$(docker exec "$1" sh -c "stat -c %s '$2' 2>/dev/null || echo 0")
    diz "  ... $(($t / 1048576)) MiB em $2"
  done
}

case "$passo" in
subir)
  docker ps --format '{{.Names}}' | grep -qx "$copia" || { echo "a cópia $copia não está no ar" >&2; exit 1; }
  if [ ! -s "$estado/udf/ib_udf.so" ]; then
    tmp=$(docker create firebirdsql/firebird:3.0.14-jammy)
    docker cp -L "$tmp:/opt/firebird/UDF/ib_udf.so" "$estado/udf/ib_udf.so" >/dev/null
    docker cp -L "$tmp:/lib/x86_64-linux-gnu/libncurses.so.5" "$estado/udf/libncurses.so.5" >/dev/null
    docker cp -L "$tmp:/lib/x86_64-linux-gnu/libtinfo.so.5" "$estado/udf/libtinfo.so.5" >/dev/null
    docker rm "$tmp" >/dev/null
  fi
  compose up -d --wait >>"$log" 2>&1
  docker exec -i "$fb5" bash -s <<'NO_CONTAINER'
set -eu
ext=/var/lib/firebird/data/externo-falso.fdb
if [ ! -e "$ext" ]; then
  /opt/firebird/bin/isql -q -user SYSDBA -password "$FIREBIRD_ROOT_PASSWORD" <<SQL
CREATE DATABASE 'localhost:$ext' PAGE_SIZE 8192 DEFAULT CHARACTER SET NONE;
CREATE TABLE CPDIGITAL (PRONTUARIO INTEGER, TIPOPAC VARCHAR(1), OTMU VARCHAR(1));
CREATE TABLE CDDIGITAL (ID_CDBENEFICAD BIGINT);
COMMIT;
SQL
  chown firebird:firebird "$ext"
fi
NO_CONTAINER
  diz "servidor de ensaio $fb5 no ar (127.0.0.1:${ENSAIO_FB5_PORTA:-3355}); origem $copia"
  ;;
backup)
  diz "backup: gbak -b no Firebird 3 de $copia → $fbk"
  vigiar "$fb5" "$fbk" & v=$!
  t0=$(agora)
  rc=0
  # Pelo gerenciador de serviços (-se): o próprio servidor lê o banco e manda o backup pelo canal; pelo protocolo
  # comum o mesmo backup levou mais de 1 h para 9 GB na VM compartilhada (ensaio de 2026-10-26).
  docker exec "$copia" sh -c "/opt/firebird/bin/gbak -b -g -se localhost:service_mgr -user SYSDBA \
    -password \"\$FIREBIRD_ROOT_PASSWORD\" $dados/$h.fdb stdout" 2>>"$log" \
    | docker exec -i "$fb5" sh -c "cat > '$fbk' && chown firebird:firebird '$fbk'" || rc=$?
  kill $v 2>/dev/null || true
  [ $rc -eq 0 ] || { diz "backup falhou (rc=$rc)"; exit $rc; }
  registrar BACKUP_S $(($(agora) - t0))
  registrar BACKUP_BYTES "$(docker exec "$fb5" stat -c %s "$fbk")"
  diz "backup feito em $(($(agora) - t0)) s"
  ;;
restaurar)
  docker exec "$fb5" test -s "$fbk" || { echo "sem o .fbk: rode o backup antes" >&2; exit 1; }
  diz "restauração: gbak -c no Firebird 5 ($fbk → $dados/$h.fdb)"
  docker exec "$fb5" sh -c "rm -f '$dados/$h.fdb'"
  vigiar "$fb5" "$dados/$h.fdb" & v=$!
  t0=$(agora)
  docker exec "$fb5" sh -c "/opt/firebird/bin/gbak -c -se localhost:service_mgr -user SYSDBA \
    -password \"\$FIREBIRD_ROOT_PASSWORD\" '$fbk' $dados/$h.fdb" >>"$log" 2>&1 || { kill $v 2>/dev/null; diz "restauração falhou"; exit 1; }
  kill $v 2>/dev/null || true
  registrar RESTAURACAO_S $(($(agora) - t0))
  diz "restauração feita em $(($(agora) - t0)) s; verificação de integridade (gfix -v -full -n)"
  t0=$(agora)
  docker exec "$fb5" sh -c "/opt/firebird/bin/gfix -v -full -n -user SYSDBA -password \"\$FIREBIRD_ROOT_PASSWORD\" \
    localhost:$dados/$h.fdb" >>"$log" 2>&1 && registrar INTEGRIDADE ok || registrar INTEGRIDADE falhou
  registrar VERIFICACAO_S $(($(agora) - t0))
  diz "verificação em $(($(agora) - t0)) s"
  ;;
volta)
  docker exec "$fb5" test -s "$fbk" || { echo "sem o .fbk: rode o backup antes" >&2; exit 1; }
  ctr3="sgh-ensaio-fb3-volta-$h"
  docker rm -f "$ctr3" >/dev/null 2>&1 || true
  # A senha vai pelo ambiente do docker (nunca na linha de comando).
  FIREBIRD_ROOT_PASSWORD=$(senha_da_copia) docker run -d --name "$ctr3" -e FIREBIRD_ROOT_PASSWORD \
    --volumes-from "$fb5" firebirdsql/firebird:3.0.14-jammy >/dev/null
  sleep 15
  diz "volta atrás: o .fbk restaurado num Firebird 3.0.14 descartável ($ctr3)"
  vigiar "$ctr3" "$dados/$h-volta.fdb" & v=$!
  t0=$(agora)
  docker exec "$ctr3" sh -c "/opt/firebird/bin/gbak -c -se localhost:service_mgr -user SYSDBA \
    -password \"\$FIREBIRD_ROOT_PASSWORD\" '$fbk' $dados/$h-volta.fdb && /opt/firebird/bin/gfix -v -full -n \
    -user SYSDBA -password \"\$FIREBIRD_ROOT_PASSWORD\" localhost:$dados/$h-volta.fdb" >>"$log" 2>&1 \
    && registrar VOLTA_S $(($(agora) - t0)) || registrar VOLTA_S falhou
  kill $v 2>/dev/null || true
  docker exec "$ctr3" rm -f "$dados/$h-volta.fdb"
  docker rm -f "$ctr3" >/dev/null
  diz "volta atrás em $(($(agora) - t0)) s (o banco de volta foi apagado; o espaço é compartilhado)"
  ;;
completo)
  "$0" backup "$h" && "$0" volta "$h" && "$0" restaurar "$h"
  diz "completo: backup, volta e restauração feitos"
  ;;
isolada)
  # SBIS-13 (para o M59): o backup feito NO Firebird 5 restaurado num servidor 5 à parte, sem rede e com volume próprio,
  # e verificado. O backup vai direto para a restauração (sem .fbk intermediário: o disco da máquina é compartilhado).
  docker exec "$fb5" test -s "$dados/$h.fdb" || { echo "sem a restaurada: rode restaurar antes" >&2; exit 1; }
  ctri="sgh-ensaio-fb5-isolada-$h"
  voli="sgh-ensaio-fb5-isolada-$h-dados"
  imagem=$(docker inspect -f '{{.Config.Image}}' "$fb5")
  docker rm -f "$ctri" >/dev/null 2>&1 || true
  docker volume rm "$voli" >/dev/null 2>&1 || true
  FIREBIRD_ROOT_PASSWORD=$(senha_da_copia) docker run -d --name "$ctri" --network none -e FIREBIRD_ROOT_PASSWORD \
    -v "$voli:$dados" "$imagem" >/dev/null
  sleep 15
  diz "restauração isolada: backup no Firebird 5 ($fb5) restaurado em $ctri (sem rede, volume próprio)"
  vigiar "$ctri" "$dados/$h-isolada.fdb" & v=$!
  t0=$(agora)
  rc=0
  docker exec "$fb5" sh -c "/opt/firebird/bin/gbak -b -g -se localhost:service_mgr -user SYSDBA \
    -password \"\$FIREBIRD_ROOT_PASSWORD\" $dados/$h.fdb stdout" 2>>"$log" \
    | docker exec -i "$ctri" sh -c "/opt/firebird/bin/gbak -c -user SYSDBA stdin $dados/$h-isolada.fdb \
      && chown firebird:firebird $dados/$h-isolada.fdb" >>"$log" 2>&1 || rc=$?
  kill $v 2>/dev/null || true
  if [ $rc -eq 0 ]; then
    registrar ISOLADA_S $(($(agora) - t0))
    docker exec "$ctri" sh -c "/opt/firebird/bin/gfix -v -full -n -user SYSDBA -password \"\$FIREBIRD_ROOT_PASSWORD\" \
      localhost:$dados/$h-isolada.fdb" >>"$log" 2>&1 && registrar ISOLADA_INTEGRIDADE ok || registrar ISOLADA_INTEGRIDADE falhou
  else
    registrar ISOLADA_INTEGRIDADE falhou
  fi
  docker rm -f "$ctri" >/dev/null
  docker volume rm "$voli" >/dev/null
  diz "restauração isolada em $(($(agora) - t0)) s (rc=$rc; o servidor e o volume isolados foram apagados)"
  ;;
estado)
  docker ps -a --filter "name=sgh-ensaio-fb" --format '{{.Names}} {{.Status}} {{.Ports}}'
  docker exec "$fb5" sh -c "ls -la $dados | awk '{print \$5, \$9}'" 2>/dev/null || true
  cat "$tempos"
  ;;
descer)
  compose stop >>"$log" 2>&1
  diz "servidor de ensaio parado (o volume fica)"
  ;;
limpar)
  docker exec "$fb5" rm -f "$fbk"
  diz "o .fbk foi apagado"
  ;;
*)
  echo "passo desconhecido: $passo" >&2
  exit 2
  ;;
esac
