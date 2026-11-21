#!/usr/bin/env bash
# Ferramenta INTERNA de teste do motor do conector (F4). O fluxo do dono é o painel da plataforma.
#   conector/conector.sh [--construir] <comando> [args]     (comandos: ver sante_conector/cli.py)
# - roda tudo no container sante-sgh-conector, sempre --network none;
# - --privileged só para os comandos que abrem o arquivo (registrar, ler-faixa, testes);
# - a pasta autorizada (CONECTOR_ORIGENS_DIR, padrão: banco-dev/backups da área de trabalho) entra só leitura;
# - o diretório de trabalho (COW ou cópia do plano B) é um volume Docker da execução, apagado no fim;
# - saídas em CONECTOR_SAIDA_DIR (padrão .tmp/conector, fora do git).
set -euo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/.." && pwd)
IMG=sante-sgh-conector:dev

if [ "${1:-}" = "--construir" ] || ! docker image inspect "$IMG" >/dev/null 2>&1; then
  [ "${1:-}" = "--construir" ] && shift
  docker build -q -t "$IMG" "$AQUI" >/dev/null
fi
[ $# -ge 1 ] || { sed -n 2,8p "$0"; exit 2; }

origens_padrao() {
  local d="$RAIZ"
  for _ in 1 2 3 4; do
    d=$(dirname "$d")
    if [ -d "$d/banco-dev/backups" ]; then echo "$d/banco-dev/backups"; return; fi
  done
  echo ""
}
ORIGENS=${CONECTOR_ORIGENS_DIR:-$(origens_padrao)}
[ -n "$ORIGENS" ] && [ -d "$ORIGENS" ] || { echo "pasta autorizada não encontrada (CONECTOR_ORIGENS_DIR)" >&2; exit 2; }
ORIGENS=$(cd "$ORIGENS" && pwd -P)
SAIDA=${CONECTOR_SAIDA_DIR:-$RAIZ/.tmp/conector}
mkdir -p "$SAIDA"
SAIDA=$(cd "$SAIDA" && pwd -P)

PRIV=()
case "$1" in registrar|ler-faixa|testes) PRIV=(--privileged) ;; esac
VOL=sante-sgh-conector-trab-$$-$RANDOM
docker volume create "$VOL" >/dev/null
trap 'docker volume rm -f "$VOL" >/dev/null 2>&1 || true' EXIT

docker run --rm --network none "${PRIV[@]}" \
  -v "$ORIGENS:/origens:ro" -v "$VOL:/trabalho" -v "$SAIDA:/saida" \
  -v "$AQUI/sante_conector:/app/sante_conector:ro" -v "$AQUI/testes:/app/testes:ro" \
  -e CONECTOR_UID="$(id -u)" -e CONECTOR_GID="$(id -g)" \
  -e CONECTOR_COW_MB="${CONECTOR_COW_MB:-2048}" -e CONECTOR_RESERVA_GB="${CONECTOR_RESERVA_GB:-100}" \
  "$IMG" "$@"
