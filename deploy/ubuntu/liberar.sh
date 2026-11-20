#!/usr/bin/env bash
# Liberação full na instalação (M61, ADR 0034; seção 9 do manual): roda o `liberacao:ligar-tudo` da versão em uso, como
# o usuário do serviço, com o mesmo arquivo de ambiente e o mesmo cliente do banco (Srp e canal cifrado) da API. Liga no
# estabelecimento inteiro todas as chaves de liberação, menos as exceções versionadas, e registra os pré-requisitos; os
# níveis de acesso por login não mudam. Em produção, exige a linha de autorização do dono. O relatório (só chaves e
# contagens) vai para /var/lib/sante-sgh/liberacao/liberacao-<data>.txt.
#
# Uso (como root):
#   ./liberar.sh --so-listar                                            (o plano, sem gravar)
#   ./liberar.sh --referencia="<linha de ESTADO.md › Autorizações>"     (todos os estabelecimentos)
#   ./liberar.sh --referencia="..." --hospital=<código> [--incluir=<chave,chave>]
#   ./liberar.sh --reverter --referencia="..."                          (desfaz os lotes da liberação full)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

exigir_root
[ -L "$SANTE_ATUAL" ] || falha "não há instalação: use o instalar.sh."
[ -f "$SANTE_AMBIENTE" ] || falha "falta o $SANTE_AMBIENTE (seção 5 do manual)."
PASTA="$SANTE_VAR_LIB/liberacao"
install -d -m 0750 -o "$SANTE_USUARIO" -g "$SANTE_USUARIO" "$PASTA"
RELATORIO="$PASTA/liberacao-$(date -u +%Y%m%dT%H%M%SZ).txt"
msg "liberação full com a versão $(basename "$(readlink -f "$SANTE_ATUAL")")"
cd "$SANTE_ATUAL"
set +e
runuser -u "$SANTE_USUARIO" -- env SGH_ARQUIVO_AMBIENTE="$SANTE_AMBIENTE" FIREBIRD="$SANTE_FIREBIRD" TZ=UTC \
  NODE_ENV=production ./node/bin/node --import ./tools/verificadores/src/caminhos-sgh.ts \
  tools/instalacao/src/liberacao-ligar-tudo.ts "$@" 2>&1 | tee "$RELATORIO"
RC=${PIPESTATUS[0]}
set -e
msg "liberação terminou com código $RC; relatório: $RELATORIO"
exit "$RC"
