#!/usr/bin/env bash
# Empacota a versão do commit atual (M60, etapa 2): build de release com o lock congelado num contêiner Ubuntu 24.04
# DESCARTÁVEL (POL-4: nada global na máquina), com o Node fixado do binário oficial conferido pelo SHASUMS256.
# Exige a árvore sem alteração (o pacote é o commit, rastreável).
#
# Uso: deploy/ubuntu/empacotar.sh <pasta de saída>
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
SAIDA="$(mkdir -p "${1:?informe a pasta de saída}" && cd "$1" && pwd)"
[ -z "$(git -C "$RAIZ" status --porcelain)" ] || { echo "árvore com alteração: faça o commit antes de empacotar." >&2; exit 1; }
NODE_VERSAO="$(sed -n "s/^export const NODE_VERSAO = '\(.*\)';/\1/p" "$RAIZ/tools/instalacao/src/pacote.ts")"
PNPM_VERSAO="$(sed -n 's/^PNPM_VERSAO="\(.*\)"/\1/p' "$RAIZ/pnpm")"
ENTRADA="$(mktemp -d)"
trap 'rm -rf "$ENTRADA"' EXIT
git -C "$RAIZ" bundle create "$ENTRADA/fonte.bundle" HEAD 2>/dev/null
docker run --rm \
  -e NODE_VERSAO="$NODE_VERSAO" -e PNPM_VERSAO="$PNPM_VERSAO" \
  -v "$ENTRADA:/entrada:ro" -v "$SAIDA:/saida" \
  -v "$RAIZ/deploy/ubuntu/construir-no-conteiner.sh:/construir.sh:ro" \
  ubuntu:24.04 bash /construir.sh
ls -1 "$SAIDA"/sante-sgh-*.tar.gz*
