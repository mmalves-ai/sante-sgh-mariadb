#!/usr/bin/env bash
# Simula a esteira do GitHub (.github/workflows/ci.yml) num worktree limpo do commit pedido: sem .env, sem certs,
# ambiente mínimo igual ao do runner. Uso (sob o flock do pesado.lock): tools/obra/ci-sim.sh <commit>; RESULTADO na
# última linha. Regra 9 do AGENTS.md (dono, 2026-11-23): todo push só depois de RESULTADO: VERDE.
set -u
C=${1:?commit}
R=/home/mmalves/workspace/redesante/sante-sgh
W=/home/mmalves/workspace/redesante/sante-sgh-wt/ci-sim
N=$HOME/.nvm/versions/node/v24.22.0/bin
cd "$R"
git worktree remove --force "$W" 2>/dev/null; rm -rf "$W"
git worktree add --detach "$W" "$C" >/dev/null 2>&1 || { echo "RESULTADO: worktree falhou"; exit 1; }
cd "$W"
E=(env -i PATH="$N:/usr/local/bin:/usr/bin:/bin" HOME="$HOME" CI=true NX_LOAD_DOT_ENV_FILES=false NX_NO_CLOUD=true
   NX_DAEMON=false SGH_NUCLEO_SEM_BANCO=1 GOTENBERG_URL=http://127.0.0.1:3318 TERM=dumb)
passo() { local nome=$1; shift; echo "=== PASSO: $nome"; if "$@"; then echo "=== OK: $nome"; else echo "=== FALHOU: $nome"; echo "RESULTADO: FALHOU em $nome"; exit 1; fi; }
passo instalar "${E[@]}" ./pnpm install --frozen-lockfile
passo verificar-tudo "${E[@]}" ./pnpm verificar:tudo
passo fronteiras "${E[@]}" ./pnpm fronteiras:provar
passo trava "${E[@]}" ./pnpm ambiente:verificar
passo e2e "${E[@]}" AMBIENTE=ci ./pnpm e2e -- --grep @M00
passo seguranca "${E[@]}" ./pnpm seguranca:verificar
echo "RESULTADO: VERDE ($C)"
