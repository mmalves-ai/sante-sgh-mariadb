#!/usr/bin/env bash
# Desinstala o Sante SGH do servidor de aplicação (M60, etapa 2). NUNCA toca o banco: os objetos SGH_ ficam (o
# recolhimento é da migração, com autorização própria). Sem opção, mantém a configuração (/etc/sante-sgh) e os dados
# (/var/lib/sante-sgh, /var/log/sante-sgh); com --remover-tudo, apaga também esses e o usuário do serviço.
#
# Uso (como root): ./desinstalar.sh [--remover-tudo]
set -euo pipefail
source "$(dirname "$0")/lib.sh"

exigir_root
TUDO=nao
[ "${1:-}" = "--remover-tudo" ] && TUDO=sim

for u in "$SANTE_UNIT-api.service" "$SANTE_UNIT-worker.service" "$SANTE_UNIT.target"; do
  systemctl disable --now "$u" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$u"
  rm -rf "/etc/systemd/system/$u.d"
done
systemctl daemon-reload
rm -f /etc/nginx/sites-enabled/sante-sgh.conf /etc/nginx/sites-available/sante-sgh.conf
if command -v nginx >/dev/null && nginx -t -q 2>/dev/null; then systemctl reload nginx 2>/dev/null || true; fi
rm -f /etc/logrotate.d/sante-sgh /etc/letsencrypt/renewal-hooks/deploy/sante-sgh.sh
rm -rf "$SANTE_OPT"
if [ "$TUDO" = sim ]; then
  rm -rf "$SANTE_ETC" "$SANTE_VAR_LIB" "$SANTE_VAR_LOG"
  id -u "$SANTE_USUARIO" >/dev/null 2>&1 && userdel "$SANTE_USUARIO"
  msg "removido, inclusive configuração, dados e o usuário do serviço."
else
  msg "removido; ficaram $SANTE_ETC, $SANTE_VAR_LIB e $SANTE_VAR_LOG (use --remover-tudo para apagá-los)."
fi
msg "pacotes do sistema (nginx, fila, cliente do banco) e as regras do firewall ficam: remova-os à parte se quiser."
