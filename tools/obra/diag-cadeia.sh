#!/usr/bin/env bash
# DIAGNÓSTICO DA CADEIA PRINCIPAL na cópia real: o recorte tools/obra/recorte-nucleo.tsv (estabelecimento, usuário,
# profissional, fonte pagadora, agenda, atendimento, conta, preço e repasse, com pai e filho preservados) carregado
# num cliente e numa plataforma de teste PRÓPRIOS (nucleo_d), na ordem real: carga própria L3, mapa, preco_origem
# (conector/sante_conector/diag_cadeia.py). Só contagens e agregados (regra 5).
#   flock .../sante-sgh-dados/obra/pesado.lock env CONECTOR_GRAVADORES=2 tools/obra/diag-cadeia.sh
#   DIAG_MANTER=1 mantém os bancos de teste no fim (padrão: apaga cliente, controle e plataforma de teste).
# Saída em sante-sgh-dados/obra/lib/diag-cadeia/: recorte.tsv, resultado.json e diag.log.
set -euo pipefail
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
cd "$RAIZ"
D=${DIAG_SAIDA:-$(cd "$RAIZ/.." && pwd)/sante-sgh-dados/obra/lib/diag-cadeia}
ORIGEM=${DIAG_ORIGEM:-pc-20261019.fdb}
COD=nucleo_d
PLAT=nucleo_d_plataforma
mkdir -p "$D"
LOG=$D/diag.log
: > "$LOG"
limpar() {
  [ -n "${DIAG_MANTER:-}" ] && return 0
  tools/db/sql.sh -e "DROP DATABASE IF EXISTS cliente_$COD; DROP DATABASE IF EXISTS conector_ctl_$COD;
                      DROP DATABASE IF EXISTS $PLAT" >> "$LOG" 2>&1 || echo "AVISO: limpeza falhou" >&2
}
trap limpar EXIT
cp tools/obra/recorte-nucleo.tsv "$D/recorte.tsv"
limpar
PLATAFORMA_BANCO=$PLAT python3 -I tools/db/criar_cliente.py "$COD" "Diagnostico da cadeia" --origem conector_spdata \
  --plataforma "$PLAT" --json >> "$LOG" 2>&1 || { echo "criar cliente de teste falhou (ver $LOG)" >&2; exit 1; }
echo "cliente de teste criado; diagnóstico em andamento ($(date +%H:%M))" | tee -a "$LOG"
CONECTOR_SAIDA_DIR=$D CONECTOR_PLATAFORMA_BANCO=$PLAT CONECTOR_GRAVADORES=${CONECTOR_GRAVADORES:-2} \
  conector/conector.sh medir-carga "$ORIGEM" --cliente "$COD" --recorte /saida/recorte.tsv --tabelas - \
  --saida /saida/resultado.json >> "$LOG" 2>&1 || { echo "medir-carga falhou (ver tail $LOG)" >&2; exit 1; }
echo "fim $(date +%H:%M): $D/resultado.json" | tee -a "$LOG"
