#!/usr/bin/env bash
# Para o Firebird simulado (o container fica, com --restart unless-stopped desarmado pelo stop).
# Com --remover, remove o container; o volume com a cópia da base NUNCA é removido por este script.
set -euo pipefail
CT=sante-sgh-fb-prontocardio
docker container inspect "$CT" >/dev/null 2>&1 || { echo "ok: $CT não existe"; exit 0; }
docker stop "$CT" >/dev/null && echo "ok: $CT parado"
if [ "${1:-}" = --remover ]; then docker rm "$CT" >/dev/null && echo "ok: $CT removido (volume mantido)"; fi
