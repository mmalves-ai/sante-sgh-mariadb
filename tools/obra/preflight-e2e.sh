#!/usr/bin/env bash
# Conferência antes do E2E em lote (25/11): num comando só, monta o commit do E2E (commit-e2e.py), instala, faz o build de
# api e web, sobe a API e espera /api/saude, e lista os specs (playwright --list). Imprime "PREFLIGHT OK <sha>" ou o
# primeiro erro. Evita as rodadas de E2E que caíram sem rodar teste (build, API na partida, spec com erro de sintaxe).
# Uso: tools/obra/preflight-e2e.sh [arquivos de e2e...]   (sem arquivos: lista todos)
set -uo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
D="$RAIZ/../sante-sgh-dados/obra"; WT="$D/e2e-vm/arvore"; L="$D/logs"; mkdir -p "$L"
SHA=$(cd "$RAIZ" && python3 -I tools/obra/commit-e2e.py | tail -1) || { echo "PREFLIGHT ERRO commit-e2e"; exit 1; }
exec 9>"$D/pesado.lock"; flock 9
cd "$WT" && git checkout -q --detach --force "$SHA" && git clean -fdq -e node_modules -e .tmp || { echo "PREFLIGHT ERRO árvore"; exit 1; }
NB=$(dirname "$(ls -d "$HOME"/.nvm/versions/node/v"$(tr -d ' \nv' < .nvmrc)"*/bin/node | tail -1)")
E=(env -i PATH="$NB:/usr/bin:/bin" HOME="$HOME" CI=true NX_DAEMON=false NX_NO_CLOUD=true NX_LOAD_DOT_ENV_FILES=false
   AMBIENTE=ci SGH_NUCLEO_SEM_BANCO=1 SGH_TRAVAS_VM=/nonexistent GOTENBERG_URL=http://127.0.0.1:3318
   NODE_OPTIONS=--max-old-space-size=4096)
"${E[@]}" ./pnpm install --frozen-lockfile --prefer-offline --store-dir "$RAIZ/.pnpm-store" > "$L/preflight-install.log" 2>&1 \
  || { echo "PREFLIGHT ERRO install (ver $L/preflight-install.log)"; exit 1; }
"${E[@]}" ./node_modules/.bin/nx run-many -t build -p api web --output-style=static > "$L/preflight-build.log" 2>&1 \
  || { echo "PREFLIGHT ERRO build"; sed 's/\x1b\[[0-9;]*m//g' "$L/preflight-build.log" | grep -A2 -E '^\[(MISSING|AMBIG|UNRES)|error' | head -12; exit 1; }
"${E[@]}" API_PORTA=3397 API_MODULOS=todos node apps/api/dist/main.js > "$L/preflight-api.log" 2>&1 & P=$!
ok=0; for _ in $(seq 1 60); do curl -sf http://127.0.0.1:3397/api/saude >/dev/null && { ok=1; break; }; kill -0 $P 2>/dev/null || break; sleep 2; done
kill $P 2>/dev/null; wait $P 2>/dev/null
[[ $ok = 1 ]] || { echo "PREFLIGHT ERRO api não sobe"; grep -E 'Error|erro' "$L/preflight-api.log" | head -5; exit 1; }
cd apps/web && "${E[@]}" ../../node_modules/.bin/playwright test -c playwright.config.ts --list "$@" > "$L/preflight-list.log" 2>&1
grep -q '^Total:' "$L/preflight-list.log" || { echo "PREFLIGHT ERRO specs"; grep -E 'Error' "$L/preflight-list.log" | head -5; exit 1; }
echo "PREFLIGHT OK $SHA ($(grep '^Total:' "$L/preflight-list.log"))"
