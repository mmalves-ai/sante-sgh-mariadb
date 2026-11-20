#!/usr/bin/env bash
# Instala o Sante SGH num Ubuntu Server 24.04 LTS limpo (M60, etapa 2). Idempotente: rodar de novo não estraga nada
# (regra 7); cada passo confere antes de fazer. Não toca o banco: a migração (objetos SGH_) é um passo à parte do
# manual, com backup verificado antes e autorização registrada.
#
# Uso (como root, na pasta onde estão o artefato e o .sha256):
#   ./instalar.sh <sante-sgh-<versão>-<commit>.tar.gz> --dominio=<nome> \
#       ( --certificado=<arquivo.pem> --chave=<arquivo.key> | --acme=<e-mail> )
#
# Na primeira vez, sem /etc/sante-sgh/sante.env, o instalador copia o modelo comentado para lá (0600) e para: preencha
# o arquivo e rode o mesmo comando de novo.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

ARTEFATO="" DOMINIO="" CERT="" CHAVE="" ACME=""
for a in "$@"; do
  case "$a" in
    --dominio=*) DOMINIO="${a#*=}" ;;
    --certificado=*) CERT="${a#*=}" ;;
    --chave=*) CHAVE="${a#*=}" ;;
    --acme=*) ACME="${a#*=}" ;;
    -*) falha "opção desconhecida: $a" ;;
    *) ARTEFATO="$a" ;;
  esac
done
[ -n "$ARTEFATO" ] || falha "informe o artefato (sante-sgh-<versão>-<commit>.tar.gz)."
[ -n "$DOMINIO" ] || falha "informe --dominio=<nome do servidor no DNS>."
[[ "$DOMINIO" =~ ^[a-z0-9.-]+( [a-z0-9.-]+)*$ ]] || falha "--dominio: só letras minúsculas, dígitos, ponto e hífen (vários separados por espaço)."
if [ -z "$ACME" ] && { [ -z "$CERT" ] || [ -z "$CHAVE" ]; }; then
  falha "informe o certificado próprio (--certificado e --chave) ou --acme=<e-mail> para o certificado automático."
fi
ARTEFATO="$(readlink -f "$ARTEFATO")"

exigir_root
exigir_ubuntu_2404

msg "1/9 pacotes do sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx libfbclient2 firebird3.0-common logrotate ufw curl ca-certificates tar gzip >/dev/null
# Valkey quando o repositório do Ubuntu o tiver; senão o redis-server do 24.04 (mesmo protocolo; D-VALKEY-60.2).
if apt-cache show valkey-server >/dev/null 2>&1; then
  apt-get install -y -qq valkey-server >/dev/null && FILA=valkey-server
else
  apt-get install -y -qq redis-server >/dev/null && FILA=redis-server
fi
if [ -n "$ACME" ]; then apt-get install -y -qq certbot >/dev/null; fi
dpkg-query -W -f='${Version}' libfbclient2 | grep -q '^3\.0\.' || falha "a libfbclient2 instalada não é a do Firebird 3.0."
# A fila só escuta no loopback.
for c in /etc/valkey/valkey.conf /etc/redis/redis.conf; do
  if [ -f "$c" ] && ! grep -q '^bind 127\.0\.0\.1' "$c"; then sed -i 's/^bind .*/bind 127.0.0.1 -::1/' "$c"; fi
done
systemctl enable --now "$FILA" >/dev/null

msg "2/9 usuário do serviço e diretórios"
id -u "$SANTE_USUARIO" >/dev/null 2>&1 ||
  useradd --system --home-dir "$SANTE_VAR_LIB" --shell /usr/sbin/nologin --user-group "$SANTE_USUARIO"
install -d -m 0755 -o root -g root "$SANTE_OPT" "$SANTE_VERSOES"
install -d -m 0750 -o root -g "$SANTE_USUARIO" "$SANTE_ETC" "$SANTE_FIREBIRD"
install -d -m 0700 -o root -g root "$SANTE_TLS"
install -d -m 0700 -o "$SANTE_USUARIO" -g "$SANTE_USUARIO" "$SANTE_VAR_LIB" "$SANTE_VAR_LIB/cofre"
install -d -m 0750 -o "$SANTE_USUARIO" -g adm "$SANTE_VAR_LOG"
install -d -m 0755 /var/www/letsencrypt

msg "3/9 artefato"
conferir_artefato "$ARTEFATO"
VERSAO="$(desempacotar "$ARTEFATO")"

msg "4/9 arquivo de ambiente"
if [ ! -f "$SANTE_AMBIENTE" ]; then
  install -m 0600 -o "$SANTE_USUARIO" -g "$SANTE_USUARIO" "$VERSAO/deploy/ubuntu/sante.env.modelo" "$SANTE_AMBIENTE"
  msg "modelo copiado para $SANTE_AMBIENTE: preencha (seção 5 do manual) e rode o mesmo comando de novo."
  exit 3
fi
chown "$SANTE_USUARIO:$SANTE_USUARIO" "$SANTE_AMBIENTE"
chmod 0600 "$SANTE_AMBIENTE"
conferir_ambiente "$VERSAO" || falha "corrija o arquivo de ambiente (as chaves acima) e rode de novo."

msg "5/9 cliente do banco (Srp e canal cifrado)"
install -m 0644 "$VERSAO/deploy/ubuntu/gerado/firebird/firebird.conf" "$SANTE_FIREBIRD/firebird.conf"
# A libfbclient procura as mensagens na mesma raiz (FIREBIRD): o link evita erro sem texto.
MSG_FB="$(dpkg -L libfbclient2 2>/dev/null | grep -m1 '/firebird.msg$' || true)"
[ -n "$MSG_FB" ] && ln -sfn "$MSG_FB" "$SANTE_FIREBIRD/firebird.msg"

msg "6/9 versão em uso e serviços"
trocar_link "$VERSAO"
instalar_units "$VERSAO"
reiniciar_servicos
esperar_saude || falha "a API não respondeu: veja journalctl -u $SANTE_UNIT-api (seção 11 do manual)."

msg "7/9 nginx e certificado"
if [ -n "$ACME" ]; then
  VIVO="/etc/letsencrypt/live/${DOMINIO%% *}"
  if [ ! -f "$VIVO/fullchain.pem" ]; then
    # Certificado provisório só para o nginx subir e atender o desafio ACME na porta 80.
    [ -f "$SANTE_TLS/provisorio.crt" ] || openssl req -x509 -nodes -newkey rsa:2048 -days 2 -subj "/CN=${DOMINIO%% *}" \
      -keyout "$SANTE_TLS/provisorio.key" -out "$SANTE_TLS/provisorio.crt" 2>/dev/null
    CERT_USO="$SANTE_TLS/provisorio.crt" CHAVE_USO="$SANTE_TLS/provisorio.key"
  else
    CERT_USO="$VIVO/fullchain.pem" CHAVE_USO="$VIVO/privkey.pem"
  fi
else
  install -m 0644 "$CERT" "$SANTE_TLS/servidor.crt"
  install -m 0600 "$CHAVE" "$SANTE_TLS/servidor.key"
  CERT_USO="$SANTE_TLS/servidor.crt" CHAVE_USO="$SANTE_TLS/servidor.key"
fi
gerar_site "$VERSAO" "$DOMINIO" "$CERT_USO" "$CHAVE_USO"
if [ -n "$ACME" ] && [ "$CERT_USO" = "$SANTE_TLS/provisorio.crt" ]; then
  # shellcheck disable=SC2086
  certbot certonly --webroot -w /var/www/letsencrypt --non-interactive --agree-tos -m "$ACME" \
    $(printf -- '-d %s ' $DOMINIO) || falha "o certificado ACME não saiu (DNS e porta 80 abertos? seção 11)."
  CERT_USO="$VIVO/fullchain.pem" CHAVE_USO="$VIVO/privkey.pem"
  gerar_site "$VERSAO" "$DOMINIO" "$CERT_USO" "$CHAVE_USO"
  printf '#!/bin/sh\nsystemctl reload nginx\n' >/etc/letsencrypt/renewal-hooks/deploy/sante-sgh.sh
  chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/sante-sgh.sh
fi
gravar_estado_instalacao "$DOMINIO" "$CERT_USO" "$CHAVE_USO"

msg "8/9 logrotate e firewall"
install -m 0644 "$VERSAO/deploy/ubuntu/gerado/logrotate/sante-sgh" /etc/logrotate.d/sante-sgh
# O acesso remoto nunca fica de fora ao ligar o firewall: libera toda porta do sshd e a da sessão atual (portas_ssh).
PORTAS_SSH="$(portas_ssh)"
for p in $PORTAS_SSH; do ufw allow "$p/tcp" >/dev/null; done
msg "firewall: SSH liberado em $(printf '%s ' $PORTAS_SSH)"
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

msg "9/9 conferência final"
curl -fsS --max-time 5 --resolve "${DOMINIO%% *}:443:127.0.0.1" -k "https://${DOMINIO%% *}/api/saude" >/dev/null ||
  falha "o site HTTPS não respondeu pelo nginx."
podar_versoes 3
msg "instalado: $(basename "$VERSAO"). Próximo passo: a migração (seção 7 do manual) e os testes pós-implantação (seção 8)."
