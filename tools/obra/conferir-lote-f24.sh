#!/bin/sh
# Autoconferência de um lote da F2.4 (dívida da migração; fatias em docs/obra/fatias/f24, geradas por fatiar_f24.py).
# Uso: tools/obra/conferir-lote-f24.sh <id> [--sem-testes|--estrito]     ex.: tools/obra/conferir-lote-f24.sh 07-acesso
# Saída: "ok" (código 0) ou a lista de erros (código 1). Só lê código e roda tsc/vitest; não imprime .env.
# Confere, sobre os arquivos do lote (a .lista; arquivo apagado conta como resolvido):
#   1. dívida zero nos arquivos do lote (divida_f24.py: modelo-pendente, vocabulário antigo, nome de origem);
#   2. tsc 0 erros nos projetos tocados (api, worker, web, contratos); erro em arquivo de OUTRO lote vira aviso,
#      salvo com --estrito;
#   3. vitest dos specs vizinhos aos arquivos do lote (mesma pasta), no cliente de teste PRÓPRIO do lote
#      (SGH_CLIENTE_TESTE, linha "# cliente_teste:" da .lista), criado por tools/db/criar_cliente.py se faltar.
set -u
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
cd "$RAIZ" || exit 2
ID=${1:-}
LISTA="docs/obra/fatias/f24/$ID.lista"
[ -n "$ID" ] && [ -f "$LISTA" ] || { echo "uso: $0 <id> (lista inexistente: $LISTA)"; exit 2; }
OPCAO=${2:-}
ERROS=$(mktemp); TMP=$(mktemp); OUTROS=$(mktemp)
trap 'rm -f "$ERROS" "$TMP" "$OUTROS" "$TMP".*' EXIT
err() { printf '%s\n' "$*" >>"$ERROS"; }
AVISOS=0
grep -v '^#' "$LISTA" | while read -r f; do [ -f "$f" ] && echo "$f"; done | sort -u >"$TMP"
for l in docs/obra/fatias/f24/*.lista; do [ "$l" = "$LISTA" ] || grep -v '^#' "$l"; done | sort -u >"$OUTROS"
[ "$OPCAO" = "--estrito" ] && : >"$OUTROS"
CLIENTE=$(sed -n 's/^# cliente_teste: //p' "$LISTA")

# 1. dívida
python3 -I tools/obra/divida_f24.py --tsv "$TMP.div" >/dev/null 2>&1
awk -F'\t' 'NR>1{print $1"\t"$3"\t"$5}' "$TMP.div" | while IFS="$(printf '\t')" read -r arq tipo linhas; do
  grep -qxF "$arq" "$TMP" && err "dívida: $arq: $tipo nas linhas $linhas"
done

# 2. tsc
for proj in apps/api:apps/api/tsconfig.json apps/worker:apps/worker/tsconfig.json apps/web:apps/web/tsconfig.json \
  packages/contratos:packages/contratos/tsconfig.json; do
  pasta=${proj%%:*}; cfg=${proj#*:}
  [ -f "$cfg" ] || continue
  if ! grep -q "^$pasta/" "$TMP" && ! grep -q "^packages/" "$TMP"; then continue; fi
  timeout 900 ./pnpm exec tsc -p "$cfg" --noEmit >"$TMP.tsc" 2>&1
  : >"$TMP.tse"
  grep 'error TS' "$TMP.tsc" | while IFS= read -r linha; do
    arq=${linha%%(*}
    case "$arq" in /*) ;; *) arq="$pasta/$arq" ;; esac
    arq=$(python3 -I -c "import os,sys; print(os.path.relpath(os.path.normpath(sys.argv[1]), '$RAIZ'))" "$arq" 2>/dev/null || echo "$arq")
    if grep -qxF "$arq" "$OUTROS"; then echo aviso >>"$TMP.av"; else echo "$linha" >>"$TMP.tse"; fi
  done
  if [ -s "$TMP.tse" ]; then
    err "tsc $cfg: $(wc -l <"$TMP.tse") erros fora dos outros lotes (primeiros):"
    head -15 "$TMP.tse" >>"$ERROS"
  fi
done
[ -f "$TMP.av" ] && AVISOS=$(wc -l <"$TMP.av")

# 3. vitest dos specs vizinhos, no cliente de teste próprio
if [ "$OPCAO" != "--sem-testes" ]; then
  if [ -n "$CLIENTE" ] && ! python3 -I tools/db/criar_cliente.py --listar 2>/dev/null | grep -qw "$CLIENTE"; then
    python3 -I tools/db/criar_cliente.py "$CLIENTE" "Teste $ID" >/dev/null 2>"$TMP.cc" || {
      err "cliente de teste $CLIENTE não foi criado:"; head -5 "$TMP.cc" >>"$ERROS"; }
  fi
  for raiz in apps/api apps/worker; do
    specs=$(grep "^$raiz/" "$TMP" | xargs -r -n1 dirname | sort -u | while read -r d; do
      ls "$d"/*.spec.ts 2>/dev/null; done | sort -u | sed "s#^$raiz/##" | tr '\n' ',' | sed 's/,$//')
    [ -n "$specs" ] || continue
    if ! SGH_CLIENTE_TESTE="$CLIENTE" LOTE_RAIZ="$raiz" LOTE_SPECS="$specs" timeout 1800 ./pnpm exec vitest run \
      --config tools/obra/vitest-lote.config.ts >"$TMP.vt" 2>&1; then
      err "vitest $raiz falhou (cliente $CLIENTE):"
      grep -E '^ *(FAIL|×|✗)|Test Files|Tests ' "$TMP.vt" | head -20 >>"$ERROS"
    fi
  done
fi

if [ -s "$ERROS" ]; then cat "$ERROS"; [ "$AVISOS" -gt 0 ] && echo "($AVISOS avisos de tsc em arquivos de outros lotes)"; exit 1; fi
echo "ok${AVISOS:+ ($AVISOS avisos de tsc em arquivos de outros lotes)}"
