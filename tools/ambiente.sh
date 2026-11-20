# Ambiente do projeto (POL-4): caches, estado, travas e temporários sempre dentro do repositório.
# Lido pelo wrapper ./pnpm. Para qualquer npm, npx ou node avulso (sondas, consultas ao registro):
#   source tools/ambiente.sh   (ou prefira ./pnpm view <pacote>, ./pnpm exec <ferramenta>)
# shellcheck shell=bash
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Caches e estado do npm/npx, do pnpm e das ferramentas sempre dentro do repositório.
export npm_config_cache="$RAIZ/.npm-cache"
export npm_config_logs_dir="$RAIZ/.npm-cache/_logs"
export npm_config_update_notifier=false
export pnpm_config_state_dir="$RAIZ/.pnpm-state"
export XDG_CACHE_HOME="$RAIZ/.cache-local"
# Dados, estado e travas de execução (o pnpm 12 grava travas do store em $XDG_RUNTIME_DIR) no projeto.
export XDG_DATA_HOME="$RAIZ/.cache-local/data"
export XDG_STATE_HOME="$RAIZ/.cache-local/state"
export XDG_RUNTIME_DIR="$RAIZ/.tmp/run"
export TMPDIR="$RAIZ/.tmp"
# Nx: sem daemon, sem nuvem, sem plugins isolados (que abrem sockets em /tmp/.nx), caches no projeto.
export NX_DAEMON=false
export NX_NO_CLOUD=true
export NX_ISOLATE_PLUGINS=false
export NX_TUI=false
export NX_CACHE_DIRECTORY="$RAIZ/.nx/cache"
export NX_WORKSPACE_DATA_DIRECTORY="$RAIZ/.nx/workspace-data"
export NX_NATIVE_FILE_CACHE_DIRECTORY="$RAIZ/.nx/native"
export NX_DAEMON_SOCKET_DIR="$RAIZ/.nx/socket"
# O Nx nunca carrega o .env da raiz (é do legado; regra 1.8).
export NX_LOAD_DOT_ENV_FILES=false
export NODE_COMPILE_CACHE="$RAIZ/.nx/node-compile-cache"
# node-gyp (addon nativo do driver Firebird, M02): cabeçalhos do Node e build dentro do repositório.
export npm_config_devdir="$RAIZ/.cache-local/node-gyp"
# Fuso do processo (API, worker, ferramentas, testes): UTC. O driver Firebird monta a Date com os
# componentes locais; num fuso com horário de verão a meia-noite do dia de início não existe e o TIMESTAMP
# do legado mudaria uma hora sem erro (o núcleo recusa a partida fora de fuso fixo). Data e hora "de
# calendário" para exibir vêm do banco ou de Intl com America/Sao_Paulo explícito, nunca do fuso do processo.
export TZ=UTC
# Playwright usa o Google Chrome da VM (channel 'chrome'); nada de baixar navegador.
export PLAYWRIGHT_BROWSERS_PATH=0
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

mkdir -p "$npm_config_cache" "$npm_config_logs_dir" "$pnpm_config_state_dir" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" \
  "$XDG_STATE_HOME" "$XDG_RUNTIME_DIR" "$TMPDIR" \
  "$NX_CACHE_DIRECTORY" "$NX_NATIVE_FILE_CACHE_DIRECTORY" "$NODE_COMPILE_CACHE" "$NX_DAEMON_SOCKET_DIR" \
  "$npm_config_devdir"
chmod 700 "$XDG_RUNTIME_DIR"
