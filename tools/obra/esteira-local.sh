#!/usr/bin/env bash
# Esteira local: roda, numa árvore limpa do commit (git worktree), cada passo de .github/workflows/ci.yml que dá
# para rodar nesta VM, com um log por passo e o resumo "passo: verde|vermelho".
#
# Por que numa worktree e não na pasta de trabalho:
#   - é o que o CI vê (checkout do commit: sem .env, sem arquivo não versionado de outra trilha);
#   - o `nx run-many -t build` do verificar:tudo grava apps/*/dist da worktree, nunca o dist servido pelo painel
#     desta pasta (api na 3310, vite preview na 5310);
#   - o E2E sobe api e web em portas próprias (E2E_PORTAS), sem encostar nos processos da 3310/5310.
#
# Uso: tools/obra/esteira-local.sh [--commit <ref>] [--saida <pasta>] [--manter] [--so <passo>[,<passo>...]]
#   --commit  ref a conferir (padrão HEAD; o que não está commitado não entra, como no CI)
#   --saida   pasta dos logs (padrão ../sante-sgh-dados/obra/esteira/<data-hora>)
#   --manter  não remove a worktree no fim (para depurar um passo vermelho)
#   --so      só os passos citados (ids: instalar,verificar-tudo,fronteiras,ambiente,e2e,seguranca)
# Saída: 0 só se todos os passos rodados ficaram verdes.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REF=HEAD
SAIDA=""
MANTER=0
SO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) REF="$2"; shift 2 ;;
    --saida) SAIDA="$2"; shift 2 ;;
    --manter) MANTER=1; shift ;;
    --so) SO=",$2,"; shift 2 ;;
    *) echo "argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done
SAIDA="${SAIDA:-$RAIZ/../sante-sgh-dados/obra/esteira/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$SAIDA"
SAIDA="$(cd "$SAIDA" && pwd)"
WT="$SAIDA/arvore"

# Node da .nvmrc (o CI usa setup-node com node-version-file).
NODE_VER="$(tr -d ' \nv' < "$RAIZ/.nvmrc")"
if [[ -d "$HOME/.nvm/versions/node/v$NODE_VER/bin" ]]; then
  export PATH="$HOME/.nvm/versions/node/v$NODE_VER/bin:$PATH"
fi

# Mesmo env do job do ci.yml.
export CI=true NX_LOAD_DOT_ENV_FILES=false NX_NO_CLOUD=true NX_DAEMON=false SGH_NUCLEO_SEM_BANCO=1
# Portas do E2E fora das do painel (5310/3310) e das padrão do dev (5300/3300).
export E2E_PORTAS="${E2E_PORTAS:-5391:3391}"

SHA="$(git -C "$RAIZ" rev-parse --verify "$REF^{commit}")" || { echo "ref inválida: $REF" >&2; exit 2; }
echo "esteira local: commit ${SHA:0:8}, logs em $SAIDA"

remover_arvore() {
  if git -C "$RAIZ" worktree list --porcelain | grep -qx "worktree $WT"; then
    git -C "$RAIZ" worktree remove --force "$WT" >/dev/null 2>&1 || true
  fi
  git -C "$RAIZ" worktree prune >/dev/null 2>&1 || true
}
remover_arvore
git -C "$RAIZ" worktree add --detach "$WT" "$SHA" >"$SAIDA/00-checkout.log" 2>&1 || {
  echo "checkout: vermelho (ver $SAIDA/00-checkout.log)"; exit 1; }
[[ $MANTER -eq 1 ]] || trap remover_arvore EXIT

declare -a RESUMO=()
TUDO_OK=1
passo() { # passo <n> <id> <nome> <comando...>
  local n="$1" id="$2" nome="$3"; shift 3
  if [[ -n "$SO" && "$SO" != *",$id,"* ]]; then return 0; fi
  local log="$SAIDA/$n-$id.log" ini fim st
  ini=$(date +%s)
  echo "▶ $nome"
  (cd "$WT" && "$@") >"$log" 2>&1
  st=$?
  fim=$(date +%s)
  if [[ $st -eq 0 ]]; then
    RESUMO+=("$nome: verde ($((fim - ini))s)")
  else
    RESUMO+=("$nome: vermelho (saída $st, $((fim - ini))s; log $log)")
    TUDO_OK=0
  fi
  echo "  ${RESUMO[-1]}"
}

# A store do pnpm da pasta de trabalho é reaproveitada (mesmo disco: hardlinks), sem baixar tudo de novo.
passo 01 instalar 'Instalar (lockfile congelado)' ./pnpm install --frozen-lockfile --store-dir "$RAIZ/.pnpm-store"
passo 02 verificar-tudo 'Verificar tudo (pnpm verificar:tudo)' ./pnpm verificar:tudo
passo 03 fronteiras 'Prova das fronteiras' ./pnpm fronteiras:provar
passo 04 ambiente 'Trava de saídas (ambiente:verificar)' ./pnpm ambiente:verificar
passo 05 e2e 'E2E do marco e das jornadas (@M00|@jornada)' ./pnpm e2e -- --grep "@M00|@jornada"
passo 06 seguranca 'Segurança (gitleaks, Semgrep, OSV, Trivy, SBOM)' ./pnpm seguranca:verificar

{
  echo "══ Esteira local, commit ${SHA:0:8}, $(date '+%Y-%m-%d %H:%M') ══"
  for r in "${RESUMO[@]}"; do echo "$r"; done
  [[ $TUDO_OK -eq 1 ]] && echo "Resultado: verde" || echo "Resultado: VERMELHO"
} | tee "$SAIDA/resumo.txt"
[[ $TUDO_OK -eq 1 ]]
