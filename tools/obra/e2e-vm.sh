#!/usr/bin/env bash
# E2E de um marco na VM, num comando só, sem encostar no painel do dono.
#
#   tools/obra/e2e-vm.sh [--commit <ref>] [--portas <web>:<api>] [--remover] [--] <argumentos do playwright>
#   ex.: tools/obra/e2e-vm.sh --grep @M00
#        tools/obra/e2e-vm.sh prontuario.spec.ts -g "médico: Ctrl+K"
#
# Por que assim (causa do "E2E @M00 vermelho" de 22/11, docs/obra/ci-verde.md):
#   - a API do E2E saía com "AMBIENTE ausente" (sem .env na árvore limpa) e o Playwright esperava os 240 s do
#     webServer pelo /api/saude que nunca respondia (corrigido no playwright.config em a36d5e7c: AMBIENTE=ci);
#   - na pasta de trabalho o E2E não pode rodar: o `api:serve` depende do `api:build`, que esvazia e regrava
#     apps/api/dist, de onde a API do painel (3310) carrega os módulos sob demanda; e o .env da pasta seria lido pela
#     API do E2E (cópia de dev). Por isso: árvore própria do commit (git worktree, sem .env, como o CI), reaproveitada
#     entre rodadas, e api/web em portas livres de teste (nunca 3300/5300 do dev nem 3310/5310 do painel);
#   - a fonte é a sintética (ACESSO_FONTE_DEV=sintetica, SGH_NUCLEO_SEM_BANCO=1), igual ao ci.yml: o E2E não lê nem
#     grava o banco 'plataforma' nem um cliente da VM. Valkey (63718), Mailpit (1325) e Gotenberg (3318) são os
#     serviços de loopback do Compose; as filas levam o prefixo próprio sgh-e2e<porta> (E2E_PORTAS).
# Execução pesada: pega o pesado.lock (uma de cada vez) e espera MIN_GB livres (padrão 10) antes de subir.
# O que não está commitado não entra (como no CI). Saída: o código do Playwright; log em
# ../sante-sgh-dados/obra/e2e-vm/ultimo.log.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DADOS="$RAIZ/../sante-sgh-dados/obra"
BASE="$DADOS/e2e-vm"
WT="$BASE/arvore"
REF=HEAD
PORTAS=""
REMOVER=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) REF="$2"; shift 2 ;;
    --portas) PORTAS="$2"; shift 2 ;;
    --remover) REMOVER=1; shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done
[[ $# -gt 0 ]] || { echo "uso: tools/obra/e2e-vm.sh [--commit ref] [--portas web:api] -- --grep @Mnn" >&2; exit 2; }
mkdir -p "$BASE"

livre() { ! ss -Hltn "sport = :$1" 2>/dev/null | grep -q .; }
if [[ -z "$PORTAS" ]]; then
  for n in 91 92 93 94 95 96 97 98; do
    if livre "53$n" && livre "33$n"; then PORTAS="53$n:33$n"; break; fi
  done
fi
[[ "$PORTAS" =~ ^([0-9]{4,5}):([0-9]{4,5})$ ]] || { echo "e2e-vm: sem par de portas livre (53xx:33xx)" >&2; exit 2; }
for p in "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"; do
  case "$p" in 3300|5300|3310|5310) echo "e2e-vm: porta $p é do dev ou do painel" >&2; exit 2 ;; esac
  livre "$p" || { echo "e2e-vm: porta $p ocupada" >&2; exit 2; }
done

NODE_VER="$(tr -d ' \nv' < "$RAIZ/.nvmrc")"
NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v"$NODE_VER"*/bin 2>/dev/null | tail -1)"
[[ -n "$NODE_BIN" ]] || { echo "e2e-vm: Node $NODE_VER ausente no nvm" >&2; exit 2; }

SHA="$(git -C "$RAIZ" rev-parse --verify "$REF^{commit}")" || { echo "e2e-vm: ref inválida: $REF" >&2; exit 2; }

# Uma execução pesada de cada vez (VM caiu por memória em 22/11) e folga de memória antes de subir.
exec 9>"$DADOS/pesado.lock"
flock 9
MIN_GB="${MIN_GB:-10}"
while :; do
  a=$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo)
  [[ "$a" -ge "$MIN_GB" ]] && break
  echo "e2e-vm: livre=${a}G < ${MIN_GB}G, esperando 30s" >&2; sleep 30
done

# Árvore própria do commit, reaproveitada (só troca o commit e reinstala pelo lockfile, com a store da pasta).
if git -C "$RAIZ" worktree list --porcelain | grep -qx "worktree $WT"; then
  git -C "$WT" checkout --quiet --detach --force "$SHA" && git -C "$WT" clean -fdq -e node_modules -e .tmp \
    || { echo "e2e-vm: não consegui trocar a árvore para ${SHA:0:8}" >&2; exit 1; }
else
  rm -rf "$WT"; git -C "$RAIZ" worktree prune
  git -C "$RAIZ" worktree add --detach "$WT" "$SHA" >/dev/null 2>&1 || { echo "e2e-vm: worktree falhou" >&2; exit 1; }
fi
[[ ! -e "$WT/.env" ]] || { echo "e2e-vm: a árvore do E2E não pode ter .env" >&2; exit 1; }
remover() { git -C "$RAIZ" worktree remove --force "$WT" >/dev/null 2>&1; git -C "$RAIZ" worktree prune; }
[[ $REMOVER -eq 0 ]] || trap remover EXIT  # padrão: a árvore fica para a próxima rodada (instalação rápida)

# Ambiente mínimo, o mesmo do job do ci.yml (sem .env; nada herdado da sessão).
E=(env -i PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin" HOME="$HOME" CI=true TERM=dumb
   NX_LOAD_DOT_ENV_FILES=false NX_NO_CLOUD=true NX_DAEMON=false SGH_NUCLEO_SEM_BANCO=1
   GOTENBERG_URL=http://127.0.0.1:3318 AMBIENTE=ci E2E_PORTAS="$PORTAS"
   NODE_OPTIONS=--max-old-space-size=3072)
LOG="$BASE/ultimo.log"
{
  echo "e2e-vm: commit ${SHA:0:8}, portas web:api $PORTAS, argumentos: $*"
  cd "$WT" && "${E[@]}" ./pnpm install --frozen-lockfile --prefer-offline --store-dir "$RAIZ/.pnpm-store" >"$BASE/instalar.log" 2>&1 \
    || { echo "e2e-vm: instalar falhou (ver $BASE/instalar.log)"; exit 1; }
  "${E[@]}" nice -n 10 ./node_modules/.bin/playwright test -c apps/web/playwright.config.ts "$@"
} 2>&1 | tee "$LOG"
st=${PIPESTATUS[0]}
echo "e2e-vm: resultado $([[ $st -eq 0 ]] && echo VERDE || echo "VERMELHO (saída $st)"); log $LOG"
exit "$st"
