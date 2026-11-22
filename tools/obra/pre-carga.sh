#!/usr/bin/env bash
# PRÉ-CARGA por área: amostra de cada tabela do plano da cópia real, carregada num cliente e numa plataforma de teste
# PRÓPRIOS (precarga), na ordem real (carga própria L3, mapa, preço particular/repasse), para achar recusas antes da
# carga completa. Só contagens e agregados (regra 5).
#   tools/obra/pre-carga.sh [AREA ...]       (ex.: FAT RH SUP; sem área = todas)
#   PRECARGA_MANTER=1 mantém o cliente de teste no fim (padrão: apaga cliente, controle e plataforma de teste).
# Amostra: tools/obra/pre_carga.py recorte (folha 1.000 linhas, pai 5.000; filho de pai truncado filtrado pelo pai).
# Saída em sante-sgh-dados/obra/precarga/: recorte.tsv, resultado.json, precarga.tsv (uma linha por tabela da origem:
# área, fatia, tabela, destino, registros, amostra, gravados, recusados, recusas por regra) e precarga.log.
set -euo pipefail
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
cd "$RAIZ"
D=${PRECARGA_SAIDA:-$(cd "$RAIZ/.." && pwd)/sante-sgh-dados/obra/precarga}
ORIGEM=${PRECARGA_ORIGEM:-pc-20261019.fdb}
COD=precarga
PLAT=precarga_plataforma
mkdir -p "$D"
LOG=$D/precarga.log
: > "$LOG"

limpar() {
  [ -n "${PRECARGA_MANTER:-}" ] && return 0
  tools/db/sql.sh -e "DROP DATABASE IF EXISTS cliente_$COD; DROP DATABASE IF EXISTS conector_ctl_$COD;
                      DROP DATABASE IF EXISTS $PLAT" >> "$LOG" 2>&1 || echo "AVISO: limpeza falhou" >&2
}
trap limpar EXIT

python3 -I tools/obra/pre_carga.py recorte "$D/recorte.tsv" "$@" | tee -a "$LOG"
limpar
PLATAFORMA_BANCO=$PLAT python3 -I tools/db/criar_cliente.py "$COD" "Pre-carga de teste" --origem conector_spdata \
  --plataforma "$PLAT" --json >> "$LOG" 2>&1 || { echo "criar cliente de teste falhou (ver $LOG)" >&2; exit 1; }
echo "cliente de teste criado; carga da amostra em andamento ($(date +%H:%M))" | tee -a "$LOG"
CONECTOR_SAIDA_DIR=$D CONECTOR_PLATAFORMA_BANCO=$PLAT \
  conector/conector.sh medir-carga "$ORIGEM" --cliente "$COD" --recorte /saida/recorte.tsv --tabelas - \
  --saida /saida/resultado.json >> "$LOG" 2>&1 || { echo "medir-carga falhou (ver tail $LOG)" >&2; exit 1; }
python3 -I tools/obra/pre_carga.py tsv "$D/resultado.json" "$D/recorte.tsv" "$D/precarga.tsv" | tee -a "$LOG"
echo "fim $(date +%H:%M): $D/precarga.tsv" | tee -a "$LOG"
