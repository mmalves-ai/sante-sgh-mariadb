#!/usr/bin/env bash
# Testes pós-implantação (M60, etapa 3; seção 8 do manual): roda o `implantacao:verificar` da versão em uso. Só lê.
# Sem --relatorio, o relatório vai para /var/log/sante-sgh/verificacao-<data>.md. Saída 0 sem falha (alerta não
# reprova), 1 com falha, 2 erro de uso.
#
# Uso (como root, porque lê o sante.env 0600): ./verificar.sh [--hospital=<código>] [--endereco=https://<domínio>]
#   [--relatorio=<arquivo.md>] [--ca=<certificado.pem> | --sem-ca] [--json]
set -euo pipefail
source "$(dirname "$0")/lib.sh"

exigir_root
[ -L "$SANTE_ATUAL" ] || falha "não há instalação: use o instalar.sh."
EXTRA=()
case " $* " in
  *" --relatorio="*) ;;
  *) EXTRA+=("--relatorio=$SANTE_VAR_LOG/verificacao-$(date -u +%Y%m%dT%H%M%SZ).md") ;;
esac
cd "$SANTE_ATUAL"
exec env TZ=UTC NODE_ENV=production ./node/bin/node --import ./tools/verificadores/src/caminhos-sgh.ts \
  tools/instalacao/src/verificar-implantacao.ts "$@" "${EXTRA[@]}"
