#!/bin/sh
# Autoconferência de um lote da F2.2/F2.3 (fatias em docs/obra/fatias/f22, geradas por tools/obra/fatiar_f22.py).
# Uso: tools/obra/conferir-lote-f22.sh <onda-lote> [--sem-testes|--estrito]   ex.: tools/obra/conferir-lote-f22.sh 01-02
#   Lotes da mesma onda andam em paralelo: por padrão, legado e erro de tsc em arquivo de OUTRO lote da mesma onda só
#   viram aviso (contagem). --estrito (fim da onda) trata tudo como erro.
# Saída: "ok" (código 0) ou a lista de erros (código 1). Só lê código e roda tsc/vitest; não imprime .env.
# Confere, sobre os arquivos do lote (a .lista) e os arquivos novos não rastreados nas pastas do lote:
#   1. nenhum import de @sgh/legado;
#   2. fecho de imports sem legado (tools/obra/fecho-imports.py);
#   3. cada arquivo no tsconfig.migrado.json do app (apps/api ou apps/worker), ou no tsconfig.login.json;
#   4. tsc do tsconfig.migrado.json com 0 erros (packages/testes: o tsconfig do pacote);
#   5. vitest dos specs do lote (unidade e integração) verde, por tools/obra/vitest-lote.config.ts;
#   6. módulos pedidos em "# registrar:" com modulo.ts e entrada em apps/api/src/modulos/registro.ts.
set -u
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
cd "$RAIZ" || exit 2
ID=${1:-}
LISTA="docs/obra/fatias/f22/$ID.lista"
[ -n "$ID" ] && [ -f "$LISTA" ] || { echo "uso: $0 <onda-lote> (lista inexistente: $LISTA)"; exit 2; }
OPCAO=${2:-}
SEM_TESTES=$OPCAO
ERROS=$(mktemp)
TMP=$(mktemp)
OUTROS=$(mktemp)
trap 'rm -f "$ERROS" "$TMP" "$OUTROS"' EXIT
AVISOS=0
ONDA=${ID%%-*}
for l in docs/obra/fatias/f22/"$ONDA"-*.lista; do [ "$l" = "$LISTA" ] || grep -v '^#' "$l"; done | sort -u >"$OUTROS"
[ "$OPCAO" = "--estrito" ] && : >"$OUTROS"
err() { printf '%s\n' "$*" >>"$ERROS"; }
PADRAO="from '@sgh/legado|import\\('@sgh/legado|from \"@sgh/legado"

REG=$(sed -n 's/^# registrar: //p' "$LISTA" | sed 's/^-$//')
PASTAS=$(sed -n 's/^# pastas: //p' "$LISTA")
# shellcheck disable=SC2086
{ grep -v '^#' "$LISTA"; git ls-files --others --exclude-standard -- $PASTAS 2>/dev/null | grep -E '\.tsx?$'; } |
  sort -u | while read -r f; do [ -f "$f" ] && echo "$f"; done >"$TMP"
# Lote só de remoção (ADR 0003): vale quando cada arquivo da lista que não existe mais está registrado na
# "remocao-registrada" de saida/<lote>.json; senão, "nenhum arquivo do lote existe" continua erro.
if [ ! -s "$TMP" ]; then
  FALTA=$(grep -v '^#' "$LISTA" | python3 -I -c "
import json, os, sys
try:
    d = json.load(open('docs/obra/fatias/f22/saida/$ID.json'))
except Exception:
    print('sem saida/$ID.json'); sys.exit()
reg = set()
for p in d.get('pedidos', []):
    if p.get('tipo') == 'remocao-registrada':
        a = p.get('arquivos', {})
        reg.update(os.path.basename(x) for x in (a if isinstance(a, (dict, list)) else []))
for f in (l.strip() for l in sys.stdin):
    if f and os.path.basename(f) not in reg:
        print(f)
")
  if [ -z "$FALTA" ]; then
    echo "lote só de remoção: todos os arquivos apagados constam da remocao-registrada"
  else
    err "nenhum arquivo do lote existe (sem registro de remoção: $(echo "$FALTA" | head -3 | tr '\n' ' '))"
  fi
fi

# 1. legado
while read -r f; do grep -qE "$PADRAO" "$f" && err "legado: $f"; done <"$TMP"

# 2. fecho de imports, por raiz
for raiz in apps/api/src apps/worker/src packages/testes/src; do
  rel=$(grep "^$raiz/" "$TMP" | sed "s#^$raiz/##" | tr '\n' ' ')
  [ -n "$rel" ] || continue
  # shellcheck disable=SC2086
  saida=$(python3 -I tools/obra/fecho-imports.py "$raiz" $rel 2>&1) || printf '%s\n' "$saida" | grep -E 'legado:|inexistente' |
    while read -r rot arq; do
      if [ "$rot" = "legado:" ] && grep -qxF "$raiz/$arq" "$OUTROS"; then echo "aviso" >>"$ERROS.av"
      else echo "fecho: $rot $arq" >>"$ERROS"; fi
    done
done

# 3 e 4. tsconfig cumulativo e tsc
for app in apps/api apps/worker; do
  grep -q "^$app/" "$TMP" || continue
  cfg="$app/tsconfig.migrado.json"
  if [ ! -f "$cfg" ]; then err "falta $cfg (crie-o como diz o brief)"; continue; fi
  python3 -I - "$app" "$TMP" >>"$ERROS" <<'PY'
import json, os, sys
app, lista = sys.argv[1], sys.argv[2]
def arquivos(c):
    if not os.path.exists(c):
        return set()
    d = json.load(open(c, encoding='utf-8'))
    return set(d.get('files', []))
dentro = arquivos(os.path.join(app, 'tsconfig.migrado.json')) | arquivos(os.path.join(app, 'tsconfig.login.json'))
for f in open(lista, encoding='utf-8').read().split():
    if f.startswith(app + '/') and f[len(app) + 1:] not in dentro:
        print('fora do tsconfig.migrado.json: ' + f)
PY
  timeout 900 ./pnpm exec tsc -p "$cfg" --noEmit >"$TMP.tsc" 2>&1
  grep 'error TS' "$TMP.tsc" | while IFS= read -r linha; do
    arq=${linha%%(*}
    if grep -qxF "$arq" "$OUTROS"; then echo "aviso" >>"$ERROS.av"; else echo "$linha" >>"$TMP.tse"; fi
  done
  if [ -s "$TMP.tse" ]; then
    err "tsc $cfg: $(wc -l <"$TMP.tse") erros fora dos lotes em andamento da onda (primeiros):"
    head -15 "$TMP.tse" >>"$ERROS"
  fi
  rm -f "$TMP.tsc" "$TMP.tse"
done
if grep -q '^packages/testes/' "$TMP"; then
  n=$(timeout 900 ./pnpm exec tsc -p packages/testes/tsconfig.json --noEmit 2>&1 | grep -c 'error TS')
  [ "$n" -gt 0 ] && err "tsc packages/testes: $n erros"
fi

# 5. vitest dos specs do lote
if [ "$SEM_TESTES" != "--sem-testes" ]; then
  for raiz in apps/api apps/worker packages/testes tools; do
    specs=$(grep "^$raiz/.*\.spec\.ts$" "$TMP" | sed "s#^$raiz/##" | tr '\n' ',' | sed 's/,$//')
    [ -n "$specs" ] || continue
    if ! LOTE_RAIZ="$raiz" LOTE_SPECS="$specs" timeout 1800 ./pnpm exec vitest run --config tools/obra/vitest-lote.config.ts \
      >"$TMP.vt" 2>&1; then
      err "vitest $raiz falhou:"
      grep -E '^ *(FAIL|×|✗)|Test Files|Tests ' "$TMP.vt" | head -20 >>"$ERROS"
    fi
    rm -f "$TMP.vt"
  done
fi

# 6. registro dos módulos
for m in $REG; do
  [ -f "apps/api/src/modulos/$m/modulo.ts" ] || err "registro: falta apps/api/src/modulos/$m/modulo.ts"
  grep -qE "^[[:space:]]*'?$m'?[[:space:]]*:[[:space:]]*\(\)[[:space:]]*=>[[:space:]]*import\('\./$m/modulo\.js'\)" \
    apps/api/src/modulos/registro.ts || err "registro: '$m' não está em REGISTRO_MODULOS"
done

[ -f "$ERROS.av" ] && AVISOS=$(wc -l <"$ERROS.av") && rm -f "$ERROS.av"
[ "$AVISOS" -gt 0 ] && echo "aviso: $AVISOS pendências em outros lotes da onda $ONDA (rode com --estrito ao fechar a onda)"
if [ -s "$ERROS" ]; then cat "$ERROS"; exit 1; fi
echo ok
