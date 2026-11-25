#!/usr/bin/env bash
# Vaga para teste de integração (24/11): até N testes de integração ao mesmo tempo, em vez de um só pela pesado.lock
# (com 40 GB livres a trava única virou gargalo: 19 provas na fila). Espera folga de memória (com-memoria.sh) e pega a
# primeira das N travas livres; o E2E e as cargas continuam na pesado.lock (exclusiva).
# Uso: tools/obra/vaga-teste.sh <comando...>   (VAGAS=3 por padrão; MIN_GB=6 por padrão)
set -euo pipefail
DADOS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/../sante-sgh-dados/obra"
[[ -d "$DADOS" ]] || DADOS=/home/mmalves/workspace/redesante/sante-sgh-dados/obra
VAGAS="${VAGAS:-3}"
export MIN_GB="${MIN_GB:-6}"
[[ $# -gt 0 ]] || { echo "uso: vaga-teste.sh <comando...>" >&2; exit 2; }
while :; do
  for i in $(seq 1 "$VAGAS"); do
    exec {fd}>"$DADOS/vaga-teste-$i.lock"
    if flock -n "$fd"; then
      "$DADOS/com-memoria.sh" "$@"
      exit $?
    fi
    exec {fd}>&-
  done
  sleep 5
done
