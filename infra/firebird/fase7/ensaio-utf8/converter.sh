#!/usr/bin/env bash
# Ensaio da conversão para UTF-8 (M58-F3; ficha do M58, seção 5, passos 3 a 5; ADR 0032, D-METODO-F3-58).
# Trabalha só no servidor de ensaio do Firebird 5 (sgh-ensaio-fb5-<h>, 127.0.0.1:3355, de ../ensaio-firebird5): lê a
# base (pc.fdb, a restaurada da F2, em NONE, que NÃO é alterada) e cria ao lado o convertido (pc-utf8.fdb, UTF8).
# Não toca as cópias de dev (3351/3352) nem a produção; a trava é a do próprio ensaio (.ensaio/<h>/trava/utf8.lock).
# Uso: infra/firebird/fase7/ensaio-utf8/converter.sh <passo> [hospital]
# Passos (cada um grava o tempo em .ensaio/<h>/utf8/tempos.env, fora do git):
#   extrair    isql -x da base (só o catálogo) → .ensaio/<h>/utf8/extracao.sql (bytes como estão)
#   preparar   [PAGINA=8192] a peça Node decodifica a extração e grava estrutura.sql e restante.sql (UTF-8)
#   criar      cria o convertido com a estrutura (geradores, domínios e tabelas, sem chave primária) em UTF8
#   ajustar    as colunas antigas com menos caracteres que bytes recebem, no convertido vazio, o tamanho em bytes
#   bombear    [PARALELO=4] copia os dados da base para o convertido (horas; retoma de onde parou)
#   completar  geradores, e o restante do script (funções, procedures, índices, visões, restrições, gatilhos,
#              permissões e comentários); os comandos recusados vão contados para completar.log
#   verificar  gfix -v -full no convertido
#   completo   extrair, preparar, criar, ajustar, bombear, completar e verificar; feito para rodar destacado (setsid nohup)
#   estado     tamanhos, tempos e o resumo da carga
#   apagar     apaga o convertido (o espaço da máquina é compartilhado)
# Nunca imprime a senha (lida do ambiente do container) nem dado de linha.
set -euo pipefail

passo=${1:?informe o passo: extrair, preparar, criar, bombear, completar, verificar, completo, estado, apagar}
h=${2:-pc}
case "$h" in pc) ;; *) echo "só o estabelecimento pc por ora (HS-1)" >&2; exit 2 ;; esac

aqui=$(cd "$(dirname "$0")" && pwd)
raiz=$(cd "$aqui/../../../.." && pwd)
estado="$raiz/.ensaio/$h/utf8"
mkdir -p "$estado" "$raiz/.ensaio/$h/trava"
tempos="$estado/tempos.env"
touch "$tempos"
log="$estado/ensaio.log"
fb5="sgh-ensaio-fb5-$h"
dados=/var/lib/firebird/data
base="$dados/$h.fdb"
conv="$dados/$h-utf8.fdb"

registrar() { grep -v "^$1=" "$tempos" > "$tempos.novo" || true; echo "$1=$2" >> "$tempos.novo"; mv "$tempos.novo" "$tempos"; }
diz() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$log"; }
agora() { date +%s; }
isql_fb5() { docker exec -i "$fb5" sh -c "/opt/firebird/bin/isql -q -user SYSDBA -password \"\$FIREBIRD_ROOT_PASSWORD\" $*"; }
node_ensaio() { (cd "$raiz" && ./pnpm -s ensaio:utf8:converter -- "$@" --hospital="$h"); }

docker ps --format '{{.Names}}' | grep -qx "$fb5" || { echo "o servidor de ensaio $fb5 não está no ar (ensaio-firebird5/ensaiar.sh subir)" >&2; exit 1; }

# Um passo por vez no servidor de ensaio (exceto estado).
if [ "$passo" != estado ] && [ -z "${ENSAIO_UTF8_TRAVADO:-}" ]; then
  exec env ENSAIO_UTF8_TRAVADO=1 flock -n "$raiz/.ensaio/$h/trava/utf8.lock" "$0" "$@"
fi

case "$passo" in
extrair)
  t0=$(agora)
  docker exec "$fb5" sh -c "/opt/firebird/bin/isql -x -user SYSDBA -password \"\$FIREBIRD_ROOT_PASSWORD\" localhost:$base -o /tmp/extracao-$h.sql"
  docker cp "$fb5:/tmp/extracao-$h.sql" "$estado/extracao.sql" >/dev/null
  docker exec "$fb5" rm -f "/tmp/extracao-$h.sql"
  registrar EXTRAIR_S $(($(agora) - t0))
  diz "extração do catálogo da base: $(wc -l < "$estado/extracao.sql") linhas em $(($(agora) - t0)) s"
  ;;
preparar)
  node_ensaio preparar --pagina="${PAGINA:-8192}" | tee -a "$log"
  ;;
criar)
  docker exec "$fb5" test ! -e "$conv" || { echo "o convertido já existe: rode apagar antes" >&2; exit 1; }
  t0=$(agora)
  docker cp "$estado/estrutura.sql" "$fb5:/tmp/estrutura-$h.sql" >/dev/null
  # O isql acrescenta ao -o que já existe: o log de uma rodada interrompida não pode entrar na contagem.
  docker exec "$fb5" rm -f "/tmp/estrutura-$h.log"
  rc=0
  docker exec "$fb5" sh -c "/opt/firebird/bin/isql -q -ch UTF8 -user SYSDBA -password \"\$FIREBIRD_ROOT_PASSWORD\" \
    -i /tmp/estrutura-$h.sql -m -o /tmp/estrutura-$h.log; chown firebird:firebird $conv" || rc=$?
  docker cp "$fb5:/tmp/estrutura-$h.log" "$estado/criar.log" >/dev/null || true
  docker exec "$fb5" rm -f "/tmp/estrutura-$h.sql" "/tmp/estrutura-$h.log"
  falhas=$(grep -c '^Statement failed' "$estado/criar.log" || true)
  registrar CRIAR_S $(($(agora) - t0))
  registrar CRIAR_FALHAS "$falhas"
  diz "estrutura criada em $(($(agora) - t0)) s; comandos recusados: $falhas (criar.log)"
  ;;
ajustar)
  node_ensaio ajustar | tee -a "$log"
  ;;
bombear)
  t0=$(agora)
  rc=0
  node_ensaio bombear --paralelo="${PARALELO:-4}" >>"$log" 2>&1 || rc=$?
  registrar BOMBEAR_S $(($(agora) - t0))
  registrar BOMBEAR_RC $rc
  diz "bombeamento em $(($(agora) - t0)) s (rc=$rc)"
  [ $rc -eq 0 ]
  ;;
completar)
  t0=$(agora)
  node_ensaio geradores | tee -a "$log"
  docker cp "$estado/restante.sql" "$fb5:/tmp/restante-$h.sql" >/dev/null
  docker exec "$fb5" rm -f "/tmp/restante-$h.log"
  docker exec "$fb5" sh -c "/opt/firebird/bin/isql -q -ch UTF8 -user SYSDBA -password \"\$FIREBIRD_ROOT_PASSWORD\" \
    localhost:$conv -i /tmp/restante-$h.sql -m -o /tmp/restante-$h.log" || true
  docker cp "$fb5:/tmp/restante-$h.log" "$estado/completar.log" >/dev/null || true
  docker exec "$fb5" rm -f "/tmp/restante-$h.sql" "/tmp/restante-$h.log"
  falhas=$(grep -c '^Statement failed' "$estado/completar.log" || true)
  registrar COMPLETAR_S $(($(agora) - t0))
  registrar COMPLETAR_FALHAS "$falhas"
  diz "restante aplicado em $(($(agora) - t0)) s; comandos recusados: $falhas (completar.log)"
  ;;
verificar)
  t0=$(agora)
  docker exec "$fb5" sh -c "/opt/firebird/bin/gfix -v -full -n -user SYSDBA -password \"\$FIREBIRD_ROOT_PASSWORD\" \
    localhost:$conv" >>"$log" 2>&1 && registrar INTEGRIDADE ok || registrar INTEGRIDADE falhou
  registrar VERIFICACAO_S $(($(agora) - t0))
  diz "verificação do convertido em $(($(agora) - t0)) s"
  ;;
completo)
  "$0" extrair "$h" && "$0" preparar "$h" && "$0" criar "$h" && "$0" ajustar "$h" && "$0" bombear "$h" && "$0" completar "$h" \
    && "$0" verificar "$h"
  diz "completo: extração, estrutura, carga, restante e verificação feitos"
  ;;
estado)
  docker exec "$fb5" sh -c "ls -la $dados | awk '{print \$5, \$9}'" 2>/dev/null || true
  cat "$tempos"
  [ -s "$estado/carga.json" ] && node -e '
    const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const v = Object.values(e);
    const c = (s) => v.filter((x) => x.situacao === s).length;
    console.log(`carga: ${c("feita")} feitas, ${c("iniciada")} iniciadas, ${c("falhou")} falharam; ${v.reduce((t, x) => t + (x.linhas || 0), 0)} linhas`);' "$estado/carga.json"
  ;;
apagar)
  docker exec "$fb5" rm -f "$conv"
  diz "o convertido foi apagado"
  ;;
*)
  echo "passo desconhecido: $passo" >&2
  exit 2
  ;;
esac
