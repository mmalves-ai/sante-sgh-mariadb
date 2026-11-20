#!/usr/bin/env bash
# Volta para a versão anterior (M60, etapa 2): troca o link "atual" pela "anterior" (ou pela pasta informada) e
# reinicia; o site do nginx, o cliente do banco e o logrotate voltam com a versão. A volta não desfaz objetos SGH_
# do banco: os scripts só ACRESCENTAM e a versão anterior ignora o que não conhece (seção 10 do manual).
#
# Uso (como root): ./voltar-versao.sh [pasta da versão em /opt/sante-sgh/versoes]
set -euo pipefail
source "$(dirname "$0")/lib.sh"

exigir_root
if [ $# -eq 1 ]; then
  ALVO="$SANTE_VERSOES/$(basename "$1")"
else
  [ -L "$SANTE_OPT/anterior" ] || falha "não há versão anterior registrada; informe a pasta (ls $SANTE_VERSOES)."
  ALVO="$(readlink -f "$SANTE_OPT/anterior")"
fi
[ -d "$ALVO" ] || falha "versão não encontrada: $ALVO"
conferir_manifesto "$ALVO" >/dev/null || falha "a versão $(basename "$ALVO") não confere com o manifesto."
conferir_ambiente "$ALVO" || falha "o arquivo de ambiente não passa na conferência da versão $(basename "$ALVO")."
ATUAL="$(readlink -f "$SANTE_ATUAL")"
[ "$ALVO" != "$ATUAL" ] || { msg "a versão $(basename "$ALVO") já está em uso."; exit 0; }

trocar_link "$ALVO"
instalar_units "$ALVO"
instalar_configuracao_da_versao "$ALVO"
reiniciar_servicos
esperar_saude || falha "a versão $(basename "$ALVO") não respondeu: veja journalctl -u $SANTE_UNIT-api."
regerar_site "$ALVO"
msg "em uso: $(basename "$ALVO"); a que saiu fica em $SANTE_OPT/anterior."
