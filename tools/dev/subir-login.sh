#!/usr/bin/env bash
# F2-L: sobe a API (127.0.0.1:API_PORTA) e o web (WEB_ESCUTA:WEB_PORTA, https) em segundo plano, com logs em arquivo.
# Idempotente: para o que este script subiu antes (pelos PIDs gravados) e sobe de novo.
#
# uso: tools/dev/subir-login.sh [subir|parar|estado]     (padrão: subir)
#   SEM_BUILD=1  pula os builds (usa apps/api/dist/main.js e apps/web/dist existentes)
#   WEB_MODO=dev  web pelo servidor de desenvolvimento (fs restrito fora do loopback); padrão: preview do bundle
#
# Lê do .env da raiz só as chaves de rede do web (WEB_ESCUTA, WEB_PORTA, WEB_HTTPS_CERT, WEB_HTTPS_CHAVE) e API_PORTA,
# sem imprimir valor nenhum. A API carrega o .env sozinha (aplicarArquivoAmbiente). O certificado fica em certs/
# (ignorado pelo git), cópia de obra-sgh/certs com SAN 192.168.0.104, 127.0.0.1 e localhost.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ESTADO="$RAIZ/.tmp/subir-login"
LOGS="${SUBIR_LOGIN_LOGS:-/tmp/claude-$(id -u)/subir-login}"
mkdir -p "$ESTADO" "$LOGS"
cd "$RAIZ"

ler_env() { # ler_env CHAVE PADRAO — valor do processo, senão do .env, senão o padrão (nunca impresso)
  local k="$1" padrao="${2:-}" v="${!1:-}"
  if [[ -z "$v" && -f "$RAIZ/.env" ]]; then v="$(grep -E "^${k}=" "$RAIZ/.env" | tail -1 | cut -d= -f2- || true)"; fi
  printf '%s' "${v:-$padrao}"
}

API_PORTA="$(ler_env API_PORTA 3310)"
WEB_PORTA="$(ler_env WEB_PORTA 5310)"
WEB_ESCUTA="$(ler_env WEB_ESCUTA 0.0.0.0)"
WEB_HTTPS_CERT="$(ler_env WEB_HTTPS_CERT "$RAIZ/certs/dev.crt")"
WEB_HTTPS_CHAVE="$(ler_env WEB_HTTPS_CHAVE "$RAIZ/certs/dev.key")"
IP_EXTERNO="${IP_EXTERNO:-192.168.0.104}"
WEB_MODO="${WEB_MODO:-preview}"   # preview (bundle construído; padrão) ou dev (servidor de desenvolvimento)

vivo() { [[ -f "$ESTADO/$1.pid" ]] && kill -0 "$(cat "$ESTADO/$1.pid")" 2>/dev/null; }
porta_ocupada() { ss -ltnH "sport = :$1" | grep -q .; }

parar_um() {
  local nome="$1"
  if vivo "$nome"; then
    local pid; pid="$(cat "$ESTADO/$nome.pid")"
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    echo "parado: $nome"
  fi
  rm -f "$ESTADO/$nome.pid"
}

esperar_porta() { # esperar_porta PORTA NOME SEGUNDOS
  for _ in $(seq 1 $(( $3 * 5 ))); do
    porta_ocupada "$1" && return 0
    vivo "$2" || { echo "ERRO: $2 saiu antes de abrir a porta $1; veja $LOGS/$2.log" >&2; tail -20 "$LOGS/$2.log" >&2; return 1; }
    sleep 0.2
  done
  echo "ERRO: $2 não abriu a porta $1 em $3 s; veja $LOGS/$2.log" >&2; return 1
}

parar() { parar_um web; parar_um api; }

estado() {
  for n in api web; do if vivo "$n"; then echo "$n: no ar (pid $(cat "$ESTADO/$n.pid"))"; else echo "$n: parado"; fi; done
}

subir() {
  parar
  for p in "$API_PORTA" "$WEB_PORTA"; do
    if porta_ocupada "$p"; then echo "ERRO: porta $p ocupada por outro processo (ss -ltnp 'sport = :$p')" >&2; exit 1; fi
  done
  [[ -r "$WEB_HTTPS_CERT" && -r "$WEB_HTTPS_CHAVE" ]] || { echo "ERRO: certificado do web ausente (WEB_HTTPS_CERT/WEB_HTTPS_CHAVE)" >&2; exit 1; }

  if [[ "${SEM_BUILD:-}" != 1 ]]; then
    echo "build da API (log: $LOGS/build-api.log)"
    node_modules/.bin/vite build --config apps/api/vite.config.ts > "$LOGS/build-api.log" 2>&1 \
      || { echo "ERRO: build da API falhou" >&2; tail -20 "$LOGS/build-api.log" >&2; exit 1; }
  fi

  # API: só loopback (main.ts), atrás do proxy do web. setsid: grupo próprio, para parar tudo de uma vez.
  API_PORTA="$API_PORTA" setsid node --enable-source-maps apps/api/dist/main.js > "$LOGS/api.log" 2>&1 < /dev/null &
  echo $! > "$ESTADO/api.pid"
  esperar_porta "$API_PORTA" api 60

  # Web: pela rede, o bundle construído (vite preview: só o dist, nada do repositório). O modo de desenvolvimento
  # (WEB_MODO=dev) com a escuta fora do loopback fica restrito pelo fs.allow/fs.deny do vite.config.ts.
  local modo_web=preview
  [[ "$WEB_MODO" == dev ]] && modo_web=dev
  if [[ "$modo_web" == preview && "${SEM_BUILD:-}" != 1 ]]; then
    echo "build do web (log: $LOGS/build-web.log)"
    WEB_ESCUTA="$WEB_ESCUTA" node_modules/.bin/vite build --config apps/web/vite.config.ts > "$LOGS/build-web.log" 2>&1 \
      || { echo "ERRO: build do web falhou" >&2; tail -20 "$LOGS/build-web.log" >&2; exit 1; }
  fi
  local cmd_web=(node_modules/.bin/vite --config apps/web/vite.config.ts)
  [[ "$modo_web" == preview ]] && cmd_web=(node_modules/.bin/vite preview --config apps/web/vite.config.ts)
  WEB_ESCUTA="$WEB_ESCUTA" WEB_PORTA="$WEB_PORTA" API_PORTA="$API_PORTA" \
    WEB_HTTPS_CERT="$WEB_HTTPS_CERT" WEB_HTTPS_CHAVE="$WEB_HTTPS_CHAVE" \
    setsid "${cmd_web[@]}" > "$LOGS/web.log" 2>&1 < /dev/null &
  echo $! > "$ESTADO/web.pid"
  esperar_porta "$WEB_PORTA" web 60

  echo "no ar:"
  echo "  web ($modo_web): https://$IP_EXTERNO:$WEB_PORTA  (e https://127.0.0.1:$WEB_PORTA)"
  echo "  api: http://127.0.0.1:$API_PORTA (só loopback; de fora, pelo /api do web)"
  echo "  logs: $LOGS/api.log e $LOGS/web.log"
  echo "  parar: tools/dev/subir-login.sh parar"
}

case "${1:-subir}" in
  subir) subir ;;
  parar) parar ;;
  estado) estado ;;
  *) echo "uso: $0 [subir|parar|estado]" >&2; exit 2 ;;
esac
