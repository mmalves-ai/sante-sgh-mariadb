#!/usr/bin/env bash
# Prova do L1 sobre um arquivo REAL da pasta autorizada (ferramenta interna). Só metadados e contagens.
#   conector/provar-l1-real.sh <relativo.fdb> [modo]
# 1) sha256 e mtime do original antes; 2) abre (snapshot), conta cada tabela em transação READ ONLY e confronta
# com o gstat; 3) sha256 e mtime depois; 4) resumo agregado (nenhum nome de pessoa, nenhum valor de linha).
# O registro por tabela (nome e contagem) fica em CONECTOR_SAIDA_DIR, fora do git.
set -euo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
REL=${1:?relativo.fdb}; MODO=${2:-snapshot}
source <(sed -n '/^origens_padrao()/,/^}/p' "$AQUI/conector.sh"); RAIZ=$(cd "$AQUI/.." && pwd)
ORIGENS=${CONECTOR_ORIGENS_DIR:-$(origens_padrao)}
F="$ORIGENS/$REL"
export CONECTOR_SAIDA_DIR=${CONECTOR_SAIDA_DIR:-$RAIZ/.tmp/conector}
mkdir -p "$CONECTOR_SAIDA_DIR"
SAI="$CONECTOR_SAIDA_DIR/registro-$(basename "$REL" .fdb).json"
assinatura() { echo "$(stat -c '%Y.%y %s' "$F" | awk '{print $1"|"$NF}')|$(sha256sum "$F" | cut -d' ' -f1)"; }
T0=$(date +%s)
ANTES=$(assinatura)
"$AQUI/conector.sh" registrar "$REL" --modo "$MODO" --saida "/saida/$(basename "$SAI")" 2> "$CONECTOR_SAIDA_DIR/registro.stderr"
DEPOIS=$(assinatura)
SIDECAR=""; [ -r "$F.sha256" ] && SIDECAR=$(cut -d' ' -f1 "$F.sha256")
python3 -I - "$SAI" "$ANTES" "$DEPOIS" "$SIDECAR" "$RAIZ/docs/analise/origem-fb/volume-pc-20261019.tsv" "$(( $(date +%s) - T0 ))" <<'PY'
import csv, json, os, sys
sai, antes, depois, sidecar, tsv, seg = sys.argv[1:]
r = json.load(open(sai))
ref = {}
if os.path.exists(tsv) and os.path.basename(r["arquivo"]).startswith("pc-20261019"):
    ref = {l["tabela"]: int(l["registros"]) for l in csv.DictReader(open(tsv), delimiter="\t")}
c = r["contagens"]
iguais_ref = sum(1 for t, n in c.items() if ref.get(t) == n)
print(json.dumps({
  "sha256_igual": antes.split("|")[2] == depois.split("|")[2],
  "mtime_e_tamanho_iguais": antes.split("|")[:2] == depois.split("|")[:2],
  "sha256_confere_arquivo_lateral": (antes.split("|")[2] == sidecar) if sidecar else None,
  "modo": r["abertura"]["modo"], "cow_usado_bytes": r["abertura"].get("cow_usado_bytes"),
  "cow_limite_bytes": r["abertura"].get("cow_limite_bytes"),
  "somente_leitura_na_abertura": r["somente_leitura_na_abertura"],
  "ods": r["ods"], "pagina": r["pagina"], "tamanho": r["tamanho"],
  "tabelas": r["tabelas"], "registros_total": r["registros_total"], "generators": r["generators"],
  "gstat_tabelas": r["gstat"]["tabelas"], "gstat_registros_total": r["gstat"]["registros_total"],
  "gstat_divergentes": r["gstat"]["divergentes"],
  "tsv_medicao_tabelas": len(ref), "tsv_iguais": iguais_ref,
  "segundos_contagem": r["segundos_contagem"], "segundos_gstat": r["gstat"]["segundos"],
  "segundos_registro": r["segundos_total"], "segundos_prova": int(seg)}, indent=1))
PY
