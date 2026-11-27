#!/usr/bin/env bash
# Uso: tools/obra/e2e-vm.sh [--commit ref] [--banco] -- <spec>. Sem --banco, fonte sintética e nenhum banco (como o ci.yml).
# --banco: cliente descartável cliente_e2e_<sha8> (e plataforma_e2e_<sha8>) criado pelo criar_cliente.py da árvore, com
#   as contas sintéticas semeadas; a API do worktree sobe contra ele (núcleo real) e os dois bancos são apagados no fim.
# E2E de um marco na VM, num comando só, sem encostar no painel do dono.
#
#   tools/obra/e2e-vm.sh [--commit <ref>] [--portas <web>:<api>] [--remover] [--banco] [--] <argumentos do playwright>
#   ex.: tools/obra/e2e-vm.sh --grep @M00
#        tools/obra/e2e-vm.sh prontuario.spec.ts -g "médico: Ctrl.K"
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
# Topologia do ci.yml: api, web e o worker COMPLETO (E2E_WORKER=completo; o ci.yml sobe o `pnpm dev`). Na árvore própria
#   nenhum worker do dono disputa as filas (prefixo próprio) e, sem núcleo, nenhum lê banco. Diferença que resta: o
#   worker sobe como processo à parte (outro webServer), não dentro do mesmo nx run-many.
# Execução pesada: pega o pesado.lock (uma de cada vez), espera MIN_GB livres (padrão 10) antes de subir e, durante a
#   rodada, um vigia encerra o E2E (o grupo de processos dele, nunca a carga) se o livre cair abaixo de PARAR_GB
#   (padrão 5; o vigia da carga real derruba a carga abaixo de 2,5 GB, e o E2E tem de sair antes). O teto de heap
#   (NODE_HEAP_MB, padrão 2048) vale para cada processo Node da árvore (nx, api, web, worker, builds, playwright).
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
BANCO=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) REF="$2"; shift 2 ;;
    --portas) PORTAS="$2"; shift 2 ;;
    --remover) REMOVER=1; shift ;;
    --banco) BANCO=1; shift ;;
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
# Chamado já debaixo de `flock pesado.lock` (algum ancestral segura a trava): não pega de novo, senão o processo
# espera o próprio pai para sempre (impasse de 24/11 18h).
ja_travado() {
  local p=$PPID
  while [[ "$p" -gt 1 ]]; do
    if tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q "^flock [^ ]*pesado\.lock "; then return 0; fi
    p=$(awk '{print $4}' "/proc/$p/stat" 2>/dev/null || echo 1)
  done
  return 1
}
if ! ja_travado; then
  exec 9>"$DADOS/pesado.lock"
  flock 9
fi
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
# --banco: o cliente descartável (só cliente_e2e_<sha8> e plataforma_e2e_<sha8>; o e2e_banco.py confere o prefixo antes
# do DROP). A senha vai por arquivo 600 fora da árvore (SGH_ARQUIVO_AMBIENTE), nunca na linha de comando.
SUF="${SHA:0:8}"
AMB_BANCO="$BASE/ambiente-banco-$SUF.env"
apagar_banco() {
  python3 -I "$RAIZ/tools/obra/e2e_banco.py" apagar "$RAIZ" "$SUF" || echo "e2e-vm: ATENÇÃO, banco descartável não apagado" >&2
  rm -f "$AMB_BANCO"
}
limpar() {
  [[ $BANCO -eq 0 ]] || apagar_banco
  [[ $REMOVER -eq 0 ]] || remover  # padrão: a árvore fica para a próxima rodada (instalação rápida)
}
trap limpar EXIT
trap 'exit 130' INT TERM
if [[ $BANCO -eq 1 ]]; then
  MSENHA="$(grep '^MARIADB_SENHA=' "$RAIZ/.env" | cut -d= -f2-)"
  [[ -n "$MSENHA" ]] || { echo "e2e-vm: --banco sem MARIADB_SENHA no .env" >&2; exit 2; }
  ( umask 077; printf 'MARIADB_SENHA=%s\n' "$MSENHA" > "$AMB_BANCO" )
fi  # o cliente é criado na rodada, depois da instalação (o catálogo de ações roda o gerador em Node da árvore)

# Ambiente mínimo do job do ci.yml (sem .env; nada herdado da sessão). As diferenças para o ci.yml são só as da VM:
# E2E_PORTAS (portas de teste, filas com prefixo próprio), E2E_WORKER=completo (o mesmo worker do `pnpm dev`) e o teto
# de heap por processo.
PARAR_GB="${PARAR_GB:-5}"
NODE_HEAP_MB="${NODE_HEAP_MB:-2048}"
E=(env -i PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin" HOME="$HOME" CI=true TERM=dumb
   NX_LOAD_DOT_ENV_FILES=false NX_NO_CLOUD=true NX_DAEMON=false
   GOTENBERG_URL=http://127.0.0.1:3318 AMBIENTE=ci E2E_PORTAS="$PORTAS" E2E_WORKER=completo
   NODE_OPTIONS=--max-old-space-size="$NODE_HEAP_MB"
   SGH_TRAVAS_VM=/nonexistent/e2e-vm-ja-tem-pesado-lock)
if [[ $BANCO -eq 1 ]]; then
  E+=(SGH_ARQUIVO_AMBIENTE="$AMB_BANCO" CLIENTE_PADRAO="e2e_$SUF" SGH_BANCO_PLATAFORMA="plataforma_e2e_$SUF")
else
  E+=(SGH_NUCLEO_SEM_BANCO=1)
fi
# Sem as vagas do limite-vm (25/11): o E2E já roda sozinho na pesado.lock com vigia de memória próprio (MIN_GB/PARAR_GB);
# api, web e worker do webServer disputavam as 3 vagas com os construtores e o Playwright desistia em 240 s.
LOG="$BASE/ultimo.log"
MARCA="$BASE/memoria-baixa"
rm -f "$MARCA"
rodada() {
  echo "e2e-vm: commit ${SHA:0:8}, portas web:api $PORTAS, banco: $([[ $BANCO -eq 1 ]] && echo "cliente_e2e_$SUF" || echo nenhum), argumentos: $*"
  cd "$WT" && "${E[@]}" ./pnpm install --frozen-lockfile --prefer-offline --store-dir "$RAIZ/.pnpm-store" >"$BASE/instalar.log" 2>&1 \
    || { echo "e2e-vm: instalar falhou (ver $BASE/instalar.log)"; exit 1; }
  if [[ $BANCO -eq 1 ]]; then
    "${E[@]}" python3 -I "$RAIZ/tools/obra/e2e_banco.py" criar "$WT" "$SUF" || { echo "e2e-vm: criar o cliente descartável falhou"; exit 1; }
  fi
  # Build antes do Playwright (25/11): o webServer tem 240 s e o build passava esse tempo esperando vaga do limite-vm
  # (máx. 3 comandos pesados na VM, disputados com os construtores). Com o build pronto, o api:serve só reaproveita o cache.
  "${E[@]}" ./pnpm exec nx run-many -t build -p api web --output-style=static >"$BASE/build.log" 2>&1 \
    || { echo "e2e-vm: build falhou (ver $BASE/build.log)"; grep -E 'MISSING_EXPORT|AMBIGUOUS|UNRESOLVED|error' "$BASE/build.log" | head -5; exit 1; }
  exec "${E[@]}" nice -n 10 ./node_modules/.bin/playwright test -c apps/web/playwright.config.ts "$@"
}
# A rodada num grupo de processos próprio (setsid): o vigia encerra o grupo inteiro (playwright, nx, api, web, worker).
setsid bash -c "$(declare -f rodada); $(declare -p E SHA PORTAS WT BASE RAIZ BANCO SUF); rodada \"\$@\"" rodada "$@" > >(tee "$LOG") 2>&1 &
PID=$!
vigia() {
  while kill -0 "$PID" 2>/dev/null; do
    a=$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo)
    if [[ "$a" -lt "$PARAR_GB" ]]; then
      echo "e2e-vm: livre=${a}G < ${PARAR_GB}G durante a rodada: encerrando o E2E (a carga segue)" | tee -a "$LOG" >&2
      : >"$MARCA"
      kill -TERM -- "-$PID" 2>/dev/null; sleep 10; kill -KILL -- "-$PID" 2>/dev/null
      return
    fi
    sleep 3
  done
}
vigia &
VIGIA=$!
wait "$PID"; st=$?
kill "$VIGIA" 2>/dev/null; wait "$VIGIA" 2>/dev/null
if [[ -e "$MARCA" ]]; then
  rm -f "$MARCA"
  echo "e2e-vm: resultado VERMELHO (encerrado por memória abaixo de ${PARAR_GB}G; nada provado); log $LOG"
  exit 3
fi
echo "e2e-vm: resultado $([[ $st -eq 0 ]] && echo VERDE || echo "VERMELHO (saída $st)"); log $LOG"
exit "$st"
