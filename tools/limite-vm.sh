# Limite de CPU e memória na VM compartilhada (dono, 18/11/2026: o excesso derrubava a IDE e o Claude).
# Lido pelo wrapper ./pnpm. Só age quando existe a pasta de travas da obra nesta VM (fora dela, em CI ou em outra
# máquina, não faz nada). Cada ./pnpm (menos o "dev", que é o servidor de longa duração e já sobe no seu escopo):
#  - espera uma das SGH_VAGAS vagas (padrão 3) de comando pesado na VM inteira (todos os worktrees);
#  - roda num escopo systemd próprio, com teto de memória: se estourar, o sistema mata só esse comando,
#    nunca a IDE nem o Claude (antes, tudo rodava no escopo da IDE e o OOM levava a IDE junto);
#  - roda com prioridade baixa de CPU e de disco, no máximo 4 núcleos e 1 GB de swap por comando, e com o Nx
#    limitado a 2 tarefas em paralelo.
# Chamadas aninhadas (./pnpm dentro de ./pnpm) não pegam outra vaga (SGH_PESADO).
# shellcheck shell=bash
SGH_TRAVAS_VM="${SGH_TRAVAS_VM:-$HOME/workspace/redesante/obra-sgh/travas}"
if [ -z "${SGH_PESADO:-}" ] && [ "${1:-}" != "dev" ] && [ -d "$SGH_TRAVAS_VM" ] && command -v systemd-run >/dev/null 2>&1; then
  export SGH_PESADO=1
  export NX_PARALLEL="${NX_PARALLEL:-2}"
  # Dentro do escopo o Node calcula o heap pelo cgroup e cai para ~2 GB (fora dele, ~4 GB): o tsc do legado estourava.
  # Devolve o heap de antes (4 GB por processo, abaixo do teto de memória do escopo); quem já pediu outro valor manda.
  case "${NODE_OPTIONS:-}" in
    *max-old-space-size*) ;;
    *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=${SGH_NODE_HEAP_MB:-4096}" ;;
  esac
  _vagas="${SGH_VAGAS:-3}"
  _limite=$((SECONDS + ${SGH_ESPERA_VAGA:-540}))
  _avisou=""
  while :; do
    for _i in $(seq 1 "$_vagas"); do
      exec 9>"$SGH_TRAVAS_VM/pesado-$_i.lock"
      if flock -n 9; then break 2; fi
      exec 9>&-
    done
    if [ "$SECONDS" -ge "$_limite" ]; then
      echo "[limite-vm] VM ocupada: as $_vagas vagas de comando pesado seguem tomadas; rode de novo em instantes." >&2
      exit 75
    fi
    [ -z "$_avisou" ] && echo "[limite-vm] aguardando vaga de comando pesado (máx. $_vagas na VM)..." >&2 && _avisou=1
    sleep 5
  done
  # O ambiente.sh põe XDG_RUNTIME_DIR no repositório; o systemd-run precisa do real (barramento do usuário), e o
  # comando dentro do escopo volta a usar o do projeto.
  SGH_LIMITE_PREFIXO=(env XDG_RUNTIME_DIR="/run/user/$(id -u)" systemd-run --user --scope --quiet --collect --unit="sgh-pesado-$$-$RANDOM"
    -p MemoryHigh="${SGH_MEM_ALTA:-9G}" -p MemoryMax="${SGH_MEM_MAX:-12G}" -p CPUWeight=40 -p IOWeight=40 -p CPUQuota="${SGH_CPU_MAX:-400%}" -p MemorySwapMax="${SGH_SWAP_MAX:-1G}"
    env XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" nice -n 10)
else
  SGH_LIMITE_PREFIXO=()
fi
