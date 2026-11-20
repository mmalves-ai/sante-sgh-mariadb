#!/bin/sh
# Vigia de disco (pedido do dono, 2026-11-20): termina e avisa quando o espaço livre em / cai abaixo do limite.
# uso: tools/obra/vigia-disco.sh [limite_gb=130] [intervalo_s=60]
LIM=${1:-130}; INT=${2:-60}
while :; do
  LIVRE=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
  if [ "$LIVRE" -lt "$LIM" ]; then
    echo "ALERTA $(date '+%F %T'): livre ${LIVRE} GB < ${LIM} GB"
    du -sh /home/mmalves/workspace/redesante/sante-sgh/dump 2>/dev/null
    docker system df 2>/dev/null | head -5
    exit 0
  fi
  sleep "$INT"
done
