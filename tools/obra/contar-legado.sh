#!/bin/sh
# Conta os imports restantes do pacote antigo (@sgh/legado) no código (F2-L, lote 5). Meta: 0 na F2.3.
# Saída compacta: total de linhas e de arquivos; por pasta de primeiro nível; e quantos estão no fecho do login
# (apps/api/tsconfig.login.json), que tem de ser 0 desde a F2-L.
# uso: tools/obra/contar-legado.sh [--exigir-zero]   (com a opção, sai 1 se sobrar algum import)
set -eu
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
cd "$RAIZ"
PADRAO="from '@sgh/legado|import\\('@sgh/legado|from \"@sgh/legado"
LISTA=$(grep -rlE "$PADRAO" apps packages tools --include='*.ts' --include='*.tsx' \
  --exclude-dir=node_modules --exclude-dir=dist 2>/dev/null | grep -v '^tools/obra/contar-legado' || true)
ARQS=$(printf '%s\n' "$LISTA" | grep -c . || true)
LINHAS=0
[ -n "$LISTA" ] && LINHAS=$(printf '%s\n' "$LISTA" | xargs grep -hcE "$PADRAO" | awk '{s+=$1} END {print s+0}')
FECHO=$(python3 -I -c '
import json,sys
d=json.load(open("apps/api/tsconfig.login.json"))
print("\n".join("apps/api/"+f for f in d["files"]))')
NO_FECHO=0
for f in $FECHO; do
  [ -f "$f" ] && grep -qE "$PADRAO" "$f" && NO_FECHO=$((NO_FECHO + 1))
done
echo "legado: $LINHAS imports em $ARQS arquivos; no fecho do login: $NO_FECHO"
[ -n "$LISTA" ] && printf '%s\n' "$LISTA" | awk -F/ '{print $1"/"$2}' | sort | uniq -c | sort -rn | head -15
if [ "${1:-}" = "--exigir-zero" ] && [ "$ARQS" -gt 0 ]; then exit 1; fi
exit 0
