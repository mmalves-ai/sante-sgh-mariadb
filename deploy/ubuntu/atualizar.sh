#!/usr/bin/env bash
# Atualiza o Sante SGH para uma nova versão (M60, etapa 2). A versão nova é desempacotada ao lado, conferida pelo
# manifesto, o arquivo de ambiente é conferido de novo e só então o link "atual" muda. Se a API não responder, a
# versão anterior volta sozinha. Scripts SGH_ novos do pacote: rode a migração ANTES (seção 7 do manual); a
# conferência da instalação mostra os pendentes.
#
# Uso (como root): ./atualizar.sh <sante-sgh-<versão>-<commit>.tar.gz>
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[ $# -eq 1 ] || falha "uso: ./atualizar.sh <artefato.tar.gz>"
ARTEFATO="$(readlink -f "$1")"
exigir_root
exigir_ubuntu_2404
[ -L "$SANTE_ATUAL" ] || falha "não há instalação: use o instalar.sh."

ANTES="$(readlink -f "$SANTE_ATUAL")"
# O "anterior" de antes da troca: a volta automática o repõe (nunca fica apontando para a versão que falhou).
ANTERIOR_ANTES="$(readlink -f "$SANTE_OPT/anterior" 2>/dev/null || true)"
conferir_artefato "$ARTEFATO"
VERSAO="$(desempacotar "$ARTEFATO")"
[ "$VERSAO" != "$ANTES" ] || { msg "a versão $(basename "$VERSAO") já está em uso."; exit 0; }
conferir_ambiente "$VERSAO" || falha "o arquivo de ambiente não passa na conferência da versão nova (nada mudou)."

msg "trocando para $(basename "$VERSAO")"
trocar_link "$VERSAO"
instalar_units "$VERSAO"
instalar_configuracao_da_versao "$VERSAO"
reiniciar_servicos
if ! esperar_saude; then
  msg "a versão nova não respondeu: voltando para $(basename "$ANTES")."
  trocar_link "$ANTES"
  restaurar_anterior "$ANTERIOR_ANTES"
  instalar_units "$ANTES"
  instalar_configuracao_da_versao "$ANTES"
  reiniciar_servicos
  esperar_saude || falha "a versão anterior também não respondeu: veja journalctl -u $SANTE_UNIT-api."
  falha "atualização desfeita; a versão $(basename "$ANTES") segue em uso."
fi
regerar_site "$VERSAO"
podar_versoes 3
msg "atualizado para $(basename "$VERSAO"); a anterior fica em $SANTE_OPT/anterior para a volta de versão."
