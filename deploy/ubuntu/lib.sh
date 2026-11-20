#!/usr/bin/env bash
# Funções comuns dos scripts de instalação do Sante SGH no Ubuntu Server 24.04 (M60, etapa 2).
# Uso: source "$(dirname "$0")/lib.sh". Nenhuma função imprime segredo; nenhuma toca o banco.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=gerado/layout.env
source "$AQUI/gerado/layout.env"
REGISTRO="$SANTE_VAR_LOG/instalacao.log"

msg() { printf '[sante-sgh] %s\n' "$*" >&2; [ -d "$SANTE_VAR_LOG" ] && printf '%s %s\n' "$(date -Is)" "$*" >>"$REGISTRO" || true; }
falha() { msg "ERRO: $*"; exit 1; }

exigir_root() { [ "$(id -u)" -eq 0 ] || falha "rode como root (sudo)."; }

exigir_ubuntu_2404() {
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] && [ "${VERSION_ID:-}" = "24.04" ] || falha "este pacote é para o Ubuntu Server 24.04 LTS (achado: ${PRETTY_NAME:-desconhecido})."
}

# Confere o artefato pelo .sha256 ao lado (formato do sha256sum).
conferir_artefato() {
  local art="$1"
  [ -f "$art" ] || falha "artefato não encontrado: $art"
  [ -f "$art.sha256" ] || falha "falta o $art.sha256 ao lado do artefato."
  (cd "$(dirname "$art")" && sha256sum --quiet -c "$(basename "$art").sha256") || falha "o hash do artefato não confere."
  case "$(basename "$art")" in
    sante-sgh-*.tar.gz) ;;
    *) falha "nome de artefato fora do formato sante-sgh-<versão>[-<commit>].tar.gz." ;;
  esac
}

pasta_da_versao() { basename "$1" .tar.gz; }

# Desempacota a versão (idempotente: se a pasta já existe e confere com o manifesto, reaproveita).
desempacotar() {
  local art="$1" pasta destino
  pasta="$(pasta_da_versao "$art")"
  destino="$SANTE_VERSOES/$pasta"
  if [ -d "$destino" ] && conferir_manifesto "$destino" >/dev/null 2>&1; then
    msg "versão $pasta já desempacotada e conferida."
  else
    rm -rf "$destino.tmp"
    mkdir -p "$destino.tmp"
    tar -xzf "$art" -C "$destino.tmp" --no-same-owner
    conferir_manifesto "$destino.tmp" >&2 || { rm -rf "$destino.tmp"; falha "a árvore desempacotada não confere com o manifesto."; }
    rm -rf "$destino"
    mv "$destino.tmp" "$destino"
    chown -R root:root "$destino"
    chmod -R go-w "$destino"
    msg "versão $pasta desempacotada e conferida."
  fi
  printf '%s\n' "$destino"
}

conferir_manifesto() {
  local raiz="$1"
  [ -x "$raiz/node/bin/node" ] || falha "o pacote não traz o Node em node/bin/node."
  (cd "$raiz" && ./node/bin/node tools/instalacao/src/conferir-pacote.ts .)
}

conferir_ambiente() {
  local raiz="$1" uid
  uid="$(id -u "$SANTE_USUARIO")"
  (cd "$raiz" && ./node/bin/node tools/instalacao/src/conferir-ambiente.ts "$SANTE_AMBIENTE" --uid="$uid")
}

identificacao_do_pacote() {
  local raiz="$1"
  (cd "$raiz" && ./node/bin/node -e 'const m=JSON.parse(require("fs").readFileSync("manifesto.json","utf8"));process.stdout.write(m.resumo.identificacao)')
}

# Drop-in com a versão que o pacote promete (a sonda e a conferência comparam com a instalada).
gravar_versao_esperada() {
  local raiz="$1" id u
  id="$(identificacao_do_pacote "$raiz")"
  for u in api worker; do
    mkdir -p "/etc/systemd/system/$SANTE_UNIT-$u.service.d"
    printf '[Service]\nEnvironment=SONDA_VERSAO_ESPERADA=%s\n' "$id" >"/etc/systemd/system/$SANTE_UNIT-$u.service.d/versao.conf"
  done
}

instalar_units() {
  local raiz="$1"
  install -m 0644 "$raiz/deploy/ubuntu/gerado/systemd/$SANTE_UNIT-api.service" /etc/systemd/system/
  install -m 0644 "$raiz/deploy/ubuntu/gerado/systemd/$SANTE_UNIT-worker.service" /etc/systemd/system/
  install -m 0644 "$raiz/deploy/ubuntu/gerado/systemd/$SANTE_UNIT.target" /etc/systemd/system/
  gravar_versao_esperada "$raiz"
  systemctl daemon-reload
}

# Espera a API responder em /api/saude (até 90 s).
esperar_saude() {
  local i
  for i in $(seq 1 45); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$SANTE_PORTA_API/api/saude" >/dev/null 2>&1; then
      msg "API respondendo."
      return 0
    fi
    sleep 2
  done
  return 1
}

reiniciar_servicos() {
  systemctl enable "$SANTE_UNIT.target" "$SANTE_UNIT-api.service" "$SANTE_UNIT-worker.service" >/dev/null
  systemctl restart "$SANTE_UNIT-api.service" "$SANTE_UNIT-worker.service"
}

# Troca o link "atual". O "anterior" passa a ser a versão que estava em uso (para a volta de versão).
trocar_link() {
  local destino="$1"
  if [ -L "$SANTE_ATUAL" ]; then
    local atual
    atual="$(readlink -f "$SANTE_ATUAL")"
    [ "$atual" != "$destino" ] && ln -sfn "$atual" "$SANTE_OPT/anterior"
  fi
  ln -sfn "$destino" "$SANTE_ATUAL.novo"
  mv -T "$SANTE_ATUAL.novo" "$SANTE_ATUAL"
}

# Repõe o link "anterior" como estava (vazio: remove). Usado pela volta automática do atualizar.sh, para que o
# "anterior" nunca fique apontando para a versão que acabou de falhar.
restaurar_anterior() {
  if [ -n "${1:-}" ]; then ln -sfn "$1" "$SANTE_OPT/anterior"; else rm -f "$SANTE_OPT/anterior"; fi
}

# Arquivos de configuração do sistema que vêm da versão (cliente do banco e logrotate).
instalar_configuracao_da_versao() {
  local raiz="$1"
  install -m 0644 "$raiz/deploy/ubuntu/gerado/firebird/firebird.conf" "$SANTE_FIREBIRD/firebird.conf"
  install -m 0644 "$raiz/deploy/ubuntu/gerado/logrotate/sante-sgh" /etc/logrotate.d/sante-sgh
}

# Site do nginx. O domínio e o certificado em uso ficam em $ESTADO_INSTALACAO (gravado pelo instalar.sh), para que o
# atualizar.sh e o voltar-versao.sh regerem o site da versão alvo (CSP, cabeçalhos e proxy vêm do pacote).
SITE_NGINX=/etc/nginx/sites-available/sante-sgh.conf
ESTADO_INSTALACAO="$SANTE_ETC/instalacao.env"

gravar_estado_instalacao() {
  local dominio="$1" cert="$2" chave="$3"
  printf '# Gravado pelo instalar.sh; lido pelo atualizar.sh e pelo voltar-versao.sh. Sem segredo.\nSITE_DOMINIO=%q\nSITE_CERT=%q\nSITE_CHAVE=%q\n' \
    "$dominio" "$cert" "$chave" >"$ESTADO_INSTALACAO.novo"
  chmod 0644 "$ESTADO_INSTALACAO.novo"
  mv -f "$ESTADO_INSTALACAO.novo" "$ESTADO_INSTALACAO"
}

# gerar_site <raiz da versão> <domínio> <certificado> <chave>: grava o site, confere com nginx -t (se não passar,
# repõe o site de antes) e recarrega o nginx.
gerar_site() {
  local raiz="$1" dominio="$2" cert="$3" chave="$4"
  [ -f "$SITE_NGINX" ] && cp -p "$SITE_NGINX" "$SITE_NGINX.antes"
  sed -e "s#__DOMINIO__#$dominio#g" -e "s#__CERT__#$cert#g" -e "s#__CHAVE__#$chave#g" \
    "$raiz/deploy/ubuntu/gerado/nginx/sante-sgh.conf" >"$SITE_NGINX"
  ln -sfn "$SITE_NGINX" /etc/nginx/sites-enabled/sante-sgh.conf
  rm -f /etc/nginx/sites-enabled/default
  if ! nginx -t -q; then
    [ -f "$SITE_NGINX.antes" ] && mv -f "$SITE_NGINX.antes" "$SITE_NGINX"
    falha "a configuração do nginx da versão $(basename "$raiz") não passou no nginx -t (o site de antes foi reposto)."
  fi
  rm -f "$SITE_NGINX.antes"
  systemctl enable nginx >/dev/null
  systemctl reload nginx 2>/dev/null || systemctl restart nginx
}

# Regera o site a partir do estado gravado pelo instalar.sh. Sem o estado (instalação anterior a este pacote), avisa
# e mantém o site como está: rode o instalar.sh com o mesmo domínio e certificado uma vez para gravá-lo.
regerar_site() {
  local raiz="$1" SITE_DOMINIO="" SITE_CERT="" SITE_CHAVE=""
  if [ ! -f "$ESTADO_INSTALACAO" ]; then
    msg "AVISO: falta $ESTADO_INSTALACAO; o site do nginx não foi regerado (rode o instalar.sh uma vez para gravá-lo)."
    return 0
  fi
  # shellcheck disable=SC1090
  source "$ESTADO_INSTALACAO"
  [ -n "$SITE_DOMINIO" ] && [ -n "$SITE_CERT" ] && [ -n "$SITE_CHAVE" ] || falha "$ESTADO_INSTALACAO incompleto."
  gerar_site "$raiz" "$SITE_DOMINIO" "$SITE_CERT" "$SITE_CHAVE"
}

# Portas em que o sshd escuta (uma por linha), mais a da sessão SSH atual: o firewall libera todas antes de ligar,
# para nunca trancar o acesso remoto quando o SSH não está na 22.
portas_ssh() {
  {
    sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }' || true
    ss -ltnpH 2>/dev/null | awk '/"sshd"/ { n = split($4, a, ":"); print a[n] }' || true
    if [ -n "${SSH_CONNECTION:-}" ]; then printf '%s\n' "$SSH_CONNECTION" | awk '{ print $4 }'; fi
  } | { grep -E '^[0-9]+$' || true; } | sort -un | { grep . || echo 22; }
}

# Mantém as N versões mais recentes, nunca a atual nem a anterior.
podar_versoes() {
  local manter="${1:-3}" atual anterior
  atual="$(readlink -f "$SANTE_ATUAL" 2>/dev/null || true)"
  anterior="$(readlink -f "$SANTE_OPT/anterior" 2>/dev/null || true)"
  # shellcheck disable=SC2012
  ls -1dt "$SANTE_VERSOES"/sante-sgh-* 2>/dev/null | tail -n +"$((manter + 1))" | while read -r v; do
    [ "$v" = "$atual" ] || [ "$v" = "$anterior" ] || { rm -rf "$v"; msg "versão antiga removida: $(basename "$v")"; }
  done
}
