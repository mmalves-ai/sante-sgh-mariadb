#!/usr/bin/env bash
# Passos do ensaio do UTF-8 depois da conversão (M58-F3; ficha do M58, seções 5, 9 a 12; ADR 0032). O convertido sai do
# converter.sh desta pasta; aqui ficam o que prepara e registra os testes sobre ele, no mesmo servidor de ensaio.
# Uso: infra/firebird/fase7/ensaio-utf8/ensaio.sh <passo> [hospital] [...]
#   parametro  grava no convertido `legado.charset` = UTF8 do estabelecimento (SGH_CFG_PARAMETRO): a partida do adaptador
#              confere o parâmetro com o charset do banco (regra 6; sem ele o estabelecimento sai do ar)
#   base       gfix -v -full na base (pc.fdb, NONE, intocada): a volta atrás da conversão é continuar nela (regra 12)
#   anotar     <h> CARGA_RC|ASSINATURAS_PASTA|ASSINATURAS_BASE|ASSINATURAS_FUNCOES <valor>: o resultado de um comando de fora, para o
#              pnpm ensaio:utf8
# Não toca as cópias de dev nem a produção; nunca imprime a senha (lida do ambiente do container) nem dado de linha.
set -euo pipefail

passo=${1:?informe o passo: parametro, base, anotar}
h=${2:-pc}
case "$h" in pc) ;; *) echo "só o estabelecimento pc por ora (HS-1)" >&2; exit 2 ;; esac

aqui=$(cd "$(dirname "$0")" && pwd)
raiz=$(cd "$aqui/../../../.." && pwd)
estado="$raiz/.ensaio/$h/utf8"
mkdir -p "$estado"
tempos="$estado/tempos.env"
touch "$tempos"
log="$estado/ensaio.log"
fb5="sgh-ensaio-fb5-$h"
dados=/var/lib/firebird/data

registrar() { grep -v "^$1=" "$tempos" > "$tempos.novo" || true; echo "$1=$2" >> "$tempos.novo"; mv "$tempos.novo" "$tempos"; }
diz() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$log"; }
agora() { date +%s; }

case "$passo" in
anotar)
  chave=${3:?anotar <hospital> <CHAVE> <valor>}
  valor=${4:?anotar <hospital> <CHAVE> <valor>}
  case "$chave" in
    CARGA_RC) [[ "$valor" =~ ^[0-9]+$ ]] || { echo "CARGA_RC: número" >&2; exit 2; } ;;
    ASSINATURAS_PASTA | ASSINATURAS_BASE) [[ "$valor" =~ ^\.ensaio/[a-z0-9]+/[A-Za-z0-9/_.-]+$ ]] || { echo "$chave: dentro de .ensaio/" >&2; exit 2; } ;;
    ASSINATURAS_FUNCOES) [[ "$valor" =~ ^[A-Z][A-Z0-9_$]{0,62}(,[A-Z][A-Z0-9_$]{0,62})*$ ]] || { echo "ASSINATURAS_FUNCOES: nomes separados por vírgula" >&2; exit 2; } ;;
    *) echo "chave não anotável: $chave" >&2; exit 2 ;;
  esac
  registrar "$chave" "$valor"
  diz "anotado $chave=$valor"
  ;;
parametro)
  docker exec -i "$fb5" sh -c "/opt/firebird/bin/isql -q -ch UTF8 -user SYSDBA -password \"\$FIREBIRD_ROOT_PASSWORD\" \
    localhost:$dados/$h-utf8.fdb" <<SQL
SET HEADING OFF;
UPDATE SGH_CFG_PARAMETRO SET VIGENTE_ATE = LOCALTIMESTAMP
 WHERE HOSPITAL = '$h' AND CHAVE = 'legado.charset' AND NIVEL = 'estabelecimento' AND VIGENTE_ATE IS NULL;
INSERT INTO SGH_CFG_PARAMETRO (ID, CHAVE, NIVEL, ALVO, REDE, HOSPITAL, VALOR, VIGENTE_DESDE, JUSTIFICATIVA, AUTOR)
VALUES (NEXT VALUE FOR SGH_GEN_CFG_PARAMETRO, 'legado.charset', 'estabelecimento', '$h', 'rede-sante', '$h', '"UTF8"',
        LOCALTIMESTAMP, 'Ensaio do UTF-8 (M58-F3): banco convertido no servidor de ensaio', 'ensaio-m58');
COMMIT;
SELECT 'legado.charset vigente: ' || TRIM(VALOR) FROM SGH_CFG_PARAMETRO
 WHERE HOSPITAL = '$h' AND CHAVE = 'legado.charset' AND VIGENTE_ATE IS NULL;
SQL
  diz "parâmetro legado.charset = UTF8 gravado no convertido ($h-utf8.fdb)"
  ;;
base)
  t0=$(agora)
  docker exec "$fb5" sh -c "/opt/firebird/bin/gfix -v -full -n -user SYSDBA -password \"\$FIREBIRD_ROOT_PASSWORD\" \
    localhost:$dados/$h.fdb" >>"$log" 2>&1 && registrar INTEGRIDADE_BASE ok || registrar INTEGRIDADE_BASE falhou
  registrar VERIFICACAO_BASE_S $(($(agora) - t0))
  diz "base verificada em $(($(agora) - t0)) s ($(grep '^INTEGRIDADE_BASE=' "$tempos" | cut -d= -f2))"
  ;;
*)
  echo "passo desconhecido: $passo" >&2
  exit 2
  ;;
esac
