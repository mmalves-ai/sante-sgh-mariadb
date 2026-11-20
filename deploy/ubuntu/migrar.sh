#!/usr/bin/env bash
# Migração do banco de um estabelecimento (M60, etapa 3; seção 7 do manual): roda o `sgh:aplicar` da versão em uso,
# como o usuário do serviço, com o mesmo arquivo de ambiente e o mesmo cliente do banco (Srp e canal cifrado) da API.
# Só cria objetos SGH_; nada do sistema anterior é alterado. Produção só com a autorização registrada no pacote.
# Sem --relatorio, o relatório vai para /var/lib/sante-sgh/migracao/<hospital>-<modo>-<data>.md.
#
# Uso (como root):
#   ./migrar.sh --hospital=<código> --ambiente=<o AMBIENTE do sante.env> --simular     (plano, conta de leitura)
#   ./migrar.sh --hospital=<código> --ambiente=<o AMBIENTE do sante.env>               (aplicação)
#   ./migrar.sh --hospital=<código> --ambiente=<o AMBIENTE do sante.env> --recolher    (só com autorização própria)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

exigir_root
[ -L "$SANTE_ATUAL" ] || falha "não há instalação: use o instalar.sh."
[ -f "$SANTE_AMBIENTE" ] || falha "falta o $SANTE_AMBIENTE (seção 5 do manual)."
HOSPITAL="" MODO=aplicar RELATORIO=""
for a in "$@"; do
  case "$a" in
    --hospital=*) HOSPITAL="${a#*=}" ;;
    --simular) MODO=simular ;;
    --recolher) MODO=recolher ;;
    --relatorio=*) RELATORIO="${a#*=}" ;;
  esac
done
[[ "$HOSPITAL" =~ ^[a-z0-9]+$ ]] || falha "informe --hospital=<código do estabelecimento> (letras minúsculas e dígitos)."
PASTA="$SANTE_VAR_LIB/migracao"
install -d -m 0750 -o "$SANTE_USUARIO" -g "$SANTE_USUARIO" "$PASTA"
EXTRA=()
if [ -z "$RELATORIO" ]; then
  RELATORIO="$PASTA/$HOSPITAL-$MODO-$(date -u +%Y%m%dT%H%M%SZ).md"
  EXTRA+=("--relatorio=$RELATORIO")
fi
msg "migração ($MODO) do estabelecimento $HOSPITAL com a versão $(basename "$(readlink -f "$SANTE_ATUAL")")"
cd "$SANTE_ATUAL"
set +e
runuser -u "$SANTE_USUARIO" -- env SGH_ARQUIVO_AMBIENTE="$SANTE_AMBIENTE" FIREBIRD="$SANTE_FIREBIRD" TZ=UTC \
  NODE_ENV=production ./node/bin/node --import ./tools/verificadores/src/caminhos-sgh.ts \
  tools/schema-check/src/sgh-aplicar.ts "$@" "${EXTRA[@]}"
RC=$?
set -e
msg "migração ($MODO) terminou com código $RC; relatório: $RELATORIO"
exit "$RC"
