#!/usr/bin/env bash
# Ensaio da instalação num Ubuntu 24.04 DESCARTÁVEL na máquina da obra (M60, etapa 2; ficha, seção 6; POL-4: nada
# global, tudo em contêiner e apagado no fim). Não é parte do pacote do hospital: é o roteiro de teste dos scripts
# deploy/ubuntu/*.sh, seguido na ordem do manual.
#
#   banco      cópia descartável do banco (matriz de ../banco-dev, porta 127.0.0.1:3362, rede própria), com as três
#              contas técnicas (aplicação, scripts e leitura) criadas SÓ nesta cópia, com senhas aleatórias
#   migrar     aplica os scripts SGH_ do commit atual na cópia descartável (trava própria do ensaio)
#   servidor   sobe o Ubuntu 24.04 com systemd (contêiner privilegiado com cgroup próprio, rede só do ensaio) e copia
#              o artefato
#   instalar   <artefato>  primeira instalação (para no modelo do sante.env), preenche o sante.env e instala de novo;
#              confere serviços, HTTPS, cabeçalhos e a conferência da instalação
#   reinstalar <artefato>  idempotência: o mesmo comando de novo
#   atualizar  <artefato>  atualização de versão (e a volta automática quando a versão nova não sobe)
#   voltar     volta para a versão anterior
#   desinstalar            remove a aplicação do servidor (o banco não é tocado)
#   apagar     apaga o servidor, a cópia, a rede e a imagem do ensaio
# M60, etapa 3 (testes pós-implantação, seguindo o manual de implantação ao pé da letra):
#   anexo-c [arquivo]      manual §7.4 sem o servidor: o Anexo C do worktree (ou o arquivo dado) na cópia, como
#                          administrador do banco
#   gatilhos-papel         pela conta da aplicação COM o papel SGH_APLICACAO (nunca o SYSDBA), gravações que disparam
#                          os gatilhos que chamam procedimentos do sistema anterior (o retrato do atendimento, as
#                          pendências do eSocial); mostra só contagens e erros e termina em ROLLBACK
#   migrar-servidor        manual §7: simulação (conta de leitura) e aplicação com o aplicador DO PACOTE instalado,
#                          pela conta de scripts; depois reinicia os serviços (§7.4)
#   sonda      manual §6.4: a conta técnica de sonda (sintética, só nesta cópia) no sante.env e reinício
#   verificar  [nome]      manual §8: deploy/ubuntu/verificar.sh no servidor; o relatório vem para a pasta do ensaio
#   fumaca-e2e             o E2E de fumaça (login e consulta ao vivo) contra a instância instalada
#                          (apps/web/playwright.instalado.config.ts)
#
# Segredos: gerados aqui e guardados só no arquivo de ENSAIO_SEGREDOS (0600, fora do repositório); nenhum é impresso
# nem vai na linha de comando do docker (variáveis -e NOME sem valor).
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
E=sgh-ensaio-m602
REDE=$E FB=$E-fb VOL=$E-fb-dados SRV=$E-srv IMG=$E-ubuntu:24.04
PORTA_FB=3362 PORTA_HTTPS=5461
IMG_FB=firebirdsql/firebird:3.0.14-jammy
MATRIZ=pc-20261019.fdb
BANCO=/var/lib/firebird/data/pc.fdb
# Fora de produção a trava de saídas só aceita loopback (endereços) e o contêiner da cópia (banco): o ensaio usa
# o nome localhost e, na rede própria do ensaio, o apelido do contêiner da cópia aponta para a cópia DESCARTÁVEL.
DOMINIO=localhost
APELIDO_BANCO=redesante-fb-pc
SEGREDOS="${ENSAIO_SEGREDOS:?defina ENSAIO_SEGREDOS=<arquivo fora do repositório>}"
PASTA="${ENSAIO_PASTA:-$(dirname "$SEGREDOS")}"
BANCO_DEV=""
for c in "$RAIZ/../banco-dev" "$RAIZ/../../banco-dev"; do [ -d "$c/backups" ] && BANCO_DEV="$(cd "$c" && pwd)" && break; done

log() { printf '[ensaio %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
falha() { log "ERRO: $*"; exit 1; }
existe() { docker inspect "$1" >/dev/null 2>&1; }
no_srv() { docker exec "$SRV" bash -c "$1"; }

segredos() {
  umask 077
  touch "$SEGREDOS"
  local x
  # Cada segredo é gerado uma vez e reaproveitado (as senhas das contas já estão na cópia).
  for x in SENHA_SYSDBA SENHA_APP SENHA_SCRIPTS SENHA_LEITURA SONDA_TOKEN SENHA_SONDA; do
    grep -q "^ENSAIO_$x=" "$SEGREDOS" || printf 'ENSAIO_%s=%s\n' "$x" "$(openssl rand -hex 16)" >>"$SEGREDOS"
  done
  for x in CHAVE_PLATAFORMA CHAVE_CPF; do
    grep -q "^ENSAIO_$x=" "$SEGREDOS" || printf 'ENSAIO_%s=%s\n' "$x" "$(openssl rand -base64 32)" >>"$SEGREDOS"
  done
  set -a
  # shellcheck disable=SC1090
  . "$SEGREDOS"
  set +a
}

isql_fb() { # SQL pela entrada padrão, como SYSDBA, dentro do contêiner da cópia
  docker exec -i -e ENSAIO_SENHA_SYSDBA "$FB" sh -c \
    "/opt/firebird/bin/isql -q -user SYSDBA -password \"\$ENSAIO_SENHA_SYSDBA\" localhost:$BANCO"
}

cmd_banco() {
  segredos
  existe "$FB" && falha "a cópia do ensaio já existe (use apagar antes)."
  local livre tamanho
  livre=$(df --output=avail -B1 /var/lib/docker 2>/dev/null | tail -1 || df --output=avail -B1 / | tail -1)
  [ -n "$BANCO_DEV" ] || falha "pasta banco-dev (com backups/) não encontrada ao lado do repositório."
  tamanho=$(stat -c %s "$BANCO_DEV/backups/$MATRIZ")
  [ "$livre" -gt $((tamanho + 20 * 1024 * 1024 * 1024)) ] || falha "espaço insuficiente para a cópia (matriz + 20 GB)."
  existe "$REDE" || docker network create "$REDE" >/dev/null
  docker volume create "$VOL" >/dev/null
  log "copiando a matriz $MATRIZ para o volume do ensaio (leva minutos)"
  docker run --rm -v "$BANCO_DEV/backups:/bk:ro" -v "$VOL:/destino" "$IMG_FB" bash -c \
    "set -e; cp /bk/$MATRIZ /destino/pc.fdb; chown firebird:firebird /destino/pc.fdb; chmod 660 /destino/pc.fdb"
  log "subindo o Firebird 3 da cópia (porta 127.0.0.1:$PORTA_FB, rede $REDE)"
  FIREBIRD_ROOT_PASSWORD="$ENSAIO_SENHA_SYSDBA" docker run -d --name "$FB" --network "$REDE" \
    --network-alias "$APELIDO_BANCO" -e FIREBIRD_ROOT_PASSWORD -e TZ=America/Sao_Paulo \
    -p "127.0.0.1:$PORTA_FB:3050" -v "$VOL:/var/lib/firebird/data" "$IMG_FB" >/dev/null
  for _ in $(seq 1 120); do (echo >/dev/tcp/127.0.0.1/$PORTA_FB) 2>/dev/null && break; sleep 1; done
  sleep 3
  log "manual §6.2: contas técnicas desta cópia (Srp) SGH_APP, SGH_SCRIPTS (com os privilégios de criação), SGH_LEITURA"
  docker exec -i -e ENSAIO_SENHA_SYSDBA -e ENSAIO_SENHA_APP -e ENSAIO_SENHA_SCRIPTS -e ENSAIO_SENHA_LEITURA "$FB" sh -c '
    cat > /tmp/contas.sql <<SQL
CREATE OR ALTER USER SGH_APP PASSWORD '"'"'$ENSAIO_SENHA_APP'"'"' USING PLUGIN Srp;
CREATE OR ALTER USER SGH_SCRIPTS PASSWORD '"'"'$ENSAIO_SENHA_SCRIPTS'"'"' USING PLUGIN Srp;
CREATE OR ALTER USER SGH_LEITURA PASSWORD '"'"'$ENSAIO_SENHA_LEITURA'"'"' USING PLUGIN Srp;
COMMIT;
GRANT CREATE TABLE TO USER SGH_SCRIPTS;
GRANT CREATE SEQUENCE TO USER SGH_SCRIPTS;
GRANT CREATE VIEW TO USER SGH_SCRIPTS;
GRANT CREATE ROLE TO USER SGH_SCRIPTS;
COMMIT;
SQL
    /opt/firebird/bin/isql -q -user SYSDBA -password "$ENSAIO_SENHA_SYSDBA" localhost:'"$BANCO"' < /tmp/contas.sql
    rm -f /tmp/contas.sql'
  # Leitura das tabelas e visões do sistema anterior às contas da aplicação e de leitura (o mesmo escopo do
  # infra/firebird/conta-dev.sql). Só nesta cópia descartável.
  isql_fb <<'SQL'
SET TERM ^ ;
EXECUTE BLOCK AS
  DECLARE VARIABLE t VARCHAR(63);
BEGIN
  FOR SELECT TRIM(r.RDB$RELATION_NAME) FROM RDB$RELATIONS r
       WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0 AND r.RDB$RELATION_NAME NOT STARTING WITH 'SGH_'
       INTO :t
  DO
  BEGIN
    EXECUTE STATEMENT 'GRANT SELECT ON "' || :t || '" TO USER SGH_APP';
    EXECUTE STATEMENT 'GRANT SELECT ON "' || :t || '" TO USER SGH_LEITURA';
  END
END^
SET TERM ; ^
COMMIT;
SQL
  log "cópia pronta"
}

ambiente_local() { # arquivo de ambiente do worktree para o sgh:aplicar contra a cópia descartável
  segredos
  umask 077
  cat >"$PASTA/ensaio.env" <<EOF
AMBIENTE=dev
REDE_PADRAO=rede-sante
PRODUTO_NOME=Sante SGH
ESTABELECIMENTOS=pc
FB_PC_NOME=ProntoCardio
FB_PC_HOST=127.0.0.1
FB_PC_PORTA=$PORTA_FB
FB_PC_BANCO=$BANCO
FB_PC_USUARIO=SGH_APP
FB_PC_SCRIPTS_USUARIO=SYSDBA
SGH_DEV_PERMITIR_SYSDBA=sim
EOF
  # As senhas entram pelo printf (nome da chave montado), nunca escritas no texto deste arquivo.
  printf 'FB_PC_%s=%s\nFB_PC_SCRIPTS_%s=%s\n' SENHA "$ENSAIO_SENHA_APP" SENHA "$ENSAIO_SENHA_SYSDBA" >>"$PASTA/ensaio.env"
}

cmd_migrar() {
  ambiente_local
  log "aplicando os scripts SGH_ do commit atual na cópia descartável"
  (cd "$RAIZ" && flock "$PASTA/copia.lock" env -u FB_PC_PORTA SGH_ARQUIVO_AMBIENTE="$PASTA/ensaio.env" \
    SGH_DEV_PERMITIR_SYSDBA=sim ./pnpm -s sgh:aplicar -- --hospital=pc --ambiente=dev) || {
    # O aplicador só concede o papel à conta da aplicação no fim; parado no meio (achado do ensaio: o 0950 depende
    # de uma tabela do 0959 numa cópia limpa), a conta fica sem papel. No ensaio, o mesmo GRANT do aplicador.
    log "AVISO: a aplicação parou no meio; concedendo o papel SGH_APLICACAO à conta da aplicação (como o aplicador)"
    segredos
    printf 'GRANT SGH_APLICACAO TO USER SGH_APP;\nCOMMIT;\n' | isql_fb
    return 1
  }
}

cmd_servidor() {
  existe "$SRV" && falha "o servidor do ensaio já existe (use apagar antes)."
  existe "$IMG" || docker build -q -t "$IMG" "$AQUI" >/dev/null
  log "subindo o Ubuntu 24.04 descartável com systemd (HTTPS em 127.0.0.1:$PORTA_HTTPS)"
  docker run -d -t --name "$SRV" --hostname servidor-ensaio --network "$REDE" -e container=docker \
    --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock \
    -p "127.0.0.1:$PORTA_HTTPS:443" "$IMG" >/dev/null
  for _ in $(seq 1 30); do
    [ "$(docker exec "$SRV" systemctl is-system-running 2>/dev/null || true)" = running ] && break
    sleep 1
  done
  no_srv '. /etc/os-release; echo "$PRETTY_NAME; systemd $(systemctl --version | head -1 | cut -d" " -f2)"'
}

copiar_artefato() {
  local art="$1"
  [ -f "$art" ] && [ -f "$art.sha256" ] || falha "artefato ou .sha256 ausente: $art"
  no_srv 'mkdir -p /root/entrega'
  docker cp "$art" "$SRV:/root/entrega/" && docker cp "$art.sha256" "$SRV:/root/entrega/"
  # O instalador vem dentro do artefato (deploy/ubuntu): a TI extrai só essa pasta (manual, seção 4).
  no_srv "cd /root/entrega && rm -rf instalador && mkdir instalador && \
    tar -xzf $(basename "$art") -C instalador ./deploy/ubuntu && ls instalador/deploy/ubuntu/instalar.sh >/dev/null"
  sobrepor_instalador
}

sobrepor_instalador() { # ENSAIO_INSTALADOR_LOCAL=1: os scripts do worktree por cima dos do artefato (só para iterar
  # numa correção sem refazer o artefato; o ensaio de aceite roda sem isso)
  [ "${ENSAIO_INSTALADOR_LOCAL:-}" = 1 ] || return 0
  log "AVISO: scripts do instalador sobrepostos pelos do worktree (ENSAIO_INSTALADOR_LOCAL=1)"
  for f in "$RAIZ"/deploy/ubuntu/*.sh; do docker cp "$f" "$SRV:/root/entrega/instalador/deploy/ubuntu/"; done
}

preencher_ambiente() { # as chaves que a TI preenche (manual, seção 5), com os valores do ensaio
  segredos
  docker exec -i -e ENSAIO_SENHA_APP -e ENSAIO_SENHA_SCRIPTS -e ENSAIO_SENHA_LEITURA -e ENSAIO_CHAVE_PLATAFORMA \
    -e ENSAIO_CHAVE_CPF -e ENSAIO_SONDA_TOKEN "$SRV" bash -s <<'EOF'
set -euo pipefail
f=/etc/sante-sgh/sante.env
put() { # chave valor: troca a linha (comentada ou não) ou acrescenta
  local k="$1" v="$2"
  if grep -qE "^#? ?$k=" "$f"; then
    awk -v k="$k" -v v="$v" 'BEGIN{d=0} { if (!d && $0 ~ "^#? ?" k "=") { print k "=" v; d=1 } else print }' "$f" >"$f.n"
    cat "$f.n" >"$f" && rm -f "$f.n"
  else
    printf '%s=%s\n' "$k" "$v" >>"$f"
  fi
}
# AMBIENTE=producao: fora de produção a trava de saídas exige o Docker e a cópia neutralizada da obra (o processo não
# sobe num servidor). O banco continua sendo a cópia DESCARTÁVEL; e-mail, armazenamento e sondas apontam para o nada.
put AMBIENTE producao
put TZ UTC
put PRODUTO_NOME 'Sante SGH'
put REDE_PADRAO rede-sante
put ESTABELECIMENTOS pc
put FB_PC_NOME ProntoCardio
put FB_PC_HOST redesante-fb-pc
put FB_PC_PORTA 3050
put FB_PC_BANCO /var/lib/firebird/data/pc.fdb
put FB_PC_USUARIO SGH_APP
put FB_PC_SENHA "$ENSAIO_SENHA_APP"
put FB_PC_SCRIPTS_USUARIO SGH_SCRIPTS
put FB_PC_SCRIPTS_SENHA "$ENSAIO_SENHA_SCRIPTS"
put FB_PC_LEITURA_USUARIO SGH_LEITURA
put FB_PC_LEITURA_SENHA "$ENSAIO_SENHA_LEITURA"
put EMAIL_REMETENTE 'nao-responda@localhost'
put PLATAFORMA_CHAVE_MESTRA "$ENSAIO_CHAVE_PLATAFORMA"
put PESSOAS_CHAVE_CPF "$ENSAIO_CHAVE_CPF"
put SONDA_TOKEN "$ENSAIO_SONDA_TOKEN"
# Combinação de senha do login: no ensaio, uma das aceitas (o login de contas reais não é exercitado aqui).
put ACESSO_COMBINACAO_SENHA sha1-senha
put MARCA rede-sante
put DOMINIO_BASE localhost
# Manual §5.1: o nome do servidor (o --dominio) ligado à rede.
put REDE_ENDERECOS localhost=rede-sante
put WEB_ENDERECO https://localhost
put DOCUMENTO_URL_VALIDACAO https://localhost/validar
# Sem servidor de e-mail no ensaio: a porta do dublê de e-mail em loopback (nada escuta; nada sai do contêiner).
put SMTP_URL smtp://127.0.0.1:1325
for k in AVISO_TI_EMAIL AVISO_RT_EMAIL AUDITORIA_EMAIL ENCARREGADO_EMAIL PLANTAO_EMAIL; do put "$k" ti@localhost; done
# Arquivos no disco da máquina (ADR 0004): a pasta da instalação, do usuário do serviço e com modo 0750.
install -d -m 0750 /srv/sante-sgh/arquivos
if id sante-sgh >/dev/null 2>&1; then chown sante-sgh:sante-sgh /srv/sante-sgh/arquivos; fi
put ARQUIVOS_RAIZ /srv/sante-sgh/arquivos
# A conta técnica de sonda entra no sante.env pelo subcomando sonda (manual §6.4), depois da migração. Na primeira instalação as duas
# linhas ficam comentadas (manual §5.6: a conta só existe depois da instalação).
for k in SONDA_LOGIN SONDA_SENHA; do sed -i -E "s/^$k=.*/# $k=/" "$f"; done
EOF
}

certificado() { # "certificado próprio do hospital": no ensaio, autoassinado
  no_srv "cd /root/entrega && [ -f servidor.crt ] || openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
    -subj /CN=$DOMINIO -addext subjectAltName=DNS:$DOMINIO -keyout servidor.key -out servidor.crt 2>/dev/null"
}

instalar_cmd() {
  local art
  art="$(basename "$1")"
  no_srv "cd /root/entrega && ./instalador/deploy/ubuntu/instalar.sh $art --dominio=$DOMINIO \
    --certificado=servidor.crt --chave=servidor.key"
}

conferir() {
  log "serviços"
  no_srv 'for u in sante-sgh-api sante-sgh-worker nginx valkey-server redis-server; do
    systemctl list-unit-files "$u.service" >/dev/null 2>&1 && printf "  %-18s %s\n" "$u" "$(systemctl is-active "$u" || true)"; done; true'
  no_srv 'printf "  sante.env: %s\n" "$(stat -c "%a %U" /etc/sante-sgh/sante.env)"; printf "  versão em uso: %s\n" "$(basename "$(readlink -f /opt/sante-sgh/atual)")"'
  no_srv 'ufw status | head -1 | sed "s/^/  /"'
  log "HTTPS pelo nginx (cabeçalhos de segurança)"
  curl -sk -D - -o /dev/null --resolve "$DOMINIO:$PORTA_HTTPS:127.0.0.1" "https://$DOMINIO:$PORTA_HTTPS/" |
    grep -iE '^(HTTP/|strict-transport|content-security|x-content-type|x-frame|referrer-policy)' | sed 's/^/  /' | tr -d '\r'
  log "API pelo nginx"
  curl -sk --resolve "$DOMINIO:$PORTA_HTTPS:127.0.0.1" "https://$DOMINIO:$PORTA_HTTPS/api/saude" | head -c 300
  echo
  curl -sk --resolve "$DOMINIO:$PORTA_HTTPS:127.0.0.1" "https://$DOMINIO:$PORTA_HTTPS/api/versao" | head -c 300
  echo
  log "conferência da instalação (a sonda, com o segredo das sondas num arquivo de cabeçalho 0600)"
  segredos
  (umask 077 && printf 'x-sonda-token: %s\n' "$ENSAIO_SONDA_TOKEN" >"$PASTA/cabecalho-sonda")
  curl -sk -H @"$PASTA/cabecalho-sonda" --resolve "$DOMINIO:$PORTA_HTTPS:127.0.0.1" \
    "https://$DOMINIO:$PORTA_HTTPS/api/sistema/sonda/instalacao" >"$PASTA/conferencia.json" || true
  rm -f "$PASTA/cabecalho-sonda"
  python3 -I - "$PASTA/conferencia.json" <<'PY' || true
import json, sys
try:
    c = json.load(open(sys.argv[1]))
except Exception as e:
    print('  conferência ilegível:', type(e).__name__); sys.exit(0)
if 'itens' not in c:
    print('  conferência recusada:', c.get('status'), c.get('title')); sys.exit(0)
print(f"  situação geral: {c['situacao']} (ambiente {c['ambiente']}, versão {c['versao']['identificacao']})")
for i in c['itens']:
    print(f"  {i['situacao']:<6} {i['codigo']:<16} {i['detalhe'][:150]}")
s = c['scripts']
print(f"  scripts: {s['noPacote']} no pacote, {s['aplicados']} aplicados, {s['pendentesTotal']} pendentes, "
      f"{len(s['divergentes'])} divergentes, {len(s['desconhecidos'])} desconhecidos")
PY
}

cmd_instalar() {
  local art="${1:?informe o artefato}" rc=0
  copiar_artefato "$art"
  certificado
  if no_srv 'test -f /etc/sante-sgh/sante.env'; then
    log "o sante.env já existe neste servidor: a primeira execução (parada no modelo) já foi feita"
  else
    log "primeira execução do instalar.sh (espera-se a parada no modelo do sante.env, código 3)"
    instalar_cmd "$art" || rc=$?
    [ "$rc" -eq 3 ] || falha "instalar.sh saiu com $rc na primeira execução (esperado 3)."
  fi
  preencher_ambiente
  log "segunda execução do instalar.sh, com o sante.env preenchido"
  instalar_cmd "$art"
  conferir
}

cmd_reinstalar() {
  local art="${1:?informe o artefato}"
  log "idempotência: o mesmo instalar.sh de novo"
  instalar_cmd "$art"
  conferir
}

cmd_atualizar() {
  local art="${1:?informe o artefato}"
  copiar_artefato "$art"
  log "atualizar.sh"
  no_srv "cd /root/entrega && ./instalador/deploy/ubuntu/atualizar.sh $(basename "$art")"
  conferir
}

cmd_voltar() {
  log "voltar-versao.sh"
  no_srv '/opt/sante-sgh/atual/deploy/ubuntu/voltar-versao.sh'
  conferir
}

cmd_desinstalar() {
  log "desinstalar.sh"
  no_srv '/root/entrega/instalador/deploy/ubuntu/desinstalar.sh'
  no_srv 'ls /opt/sante-sgh 2>&1 | head -3; systemctl is-active sante-sgh-api 2>&1 || true'
}

# ── M60, etapa 3 ──────────────────────────────────────────────────────────────────────────────────────────────────

# Manual §7.2 e §7.4. A simulação e a conferência de 0 pendentes são as do manual, no servidor, sem mudança (produção:
# só leitura, sem autorização). A APLICAÇÃO em AMBIENTE=producao exige a linha de autorização do dono no registro do
# projeto, que o ensaio NUNCA cria, e fora de produção o aplicador só aceita a cópia em loopback (nunca um banco pela
# rede): a aplicação roda na máquina da obra, com o aplicador do MESMO commit do pacote, a MESMA conta de scripts
# (SGH_SCRIPTS, dona dos objetos SGH_) e a conta de leitura, contra a cópia DESCARTÁVEL (D-ENSAIO-MIGRAR-60.3).
ambiente_scripts() { # arquivo de ambiente do aplicador com as contas do manual (§6.2), contra a cópia descartável
  segredos
  umask 077
  cat >"$PASTA/ensaio-scripts.env" <<EOF
AMBIENTE=dev
REDE_PADRAO=rede-sante
PRODUTO_NOME=Sante SGH
ESTABELECIMENTOS=pc
FB_PC_NOME=ProntoCardio
FB_PC_HOST=127.0.0.1
FB_PC_PORTA=$PORTA_FB
FB_PC_BANCO=$BANCO
FB_PC_USUARIO=SGH_APP
FB_PC_SCRIPTS_USUARIO=SGH_SCRIPTS
FB_PC_LEITURA_USUARIO=SGH_LEITURA
EOF
  printf 'FB_PC_%s=%s\nFB_PC_SCRIPTS_%s=%s\nFB_PC_LEITURA_%s=%s\n' SENHA "$ENSAIO_SENHA_APP" SENHA \
    "$ENSAIO_SENHA_SCRIPTS" SENHA "$ENSAIO_SENHA_LEITURA" >>"$PASTA/ensaio-scripts.env"
}

cmd_migrar_servidor() {
  log "manual §7.2: simulação no servidor (conta de leitura)"
  no_srv '/opt/sante-sgh/atual/deploy/ubuntu/migrar.sh --hospital=pc --ambiente=producao --simular' 2>&1 |
    tail -3 | sed 's/^/  /'
  log "manual §7.4: aplicação pela conta de scripts (aplicador do commit do pacote, cópia descartável)"
  ambiente_scripts
  local rc=0
  (cd "$RAIZ" && flock "$PASTA/copia.lock" env -u FB_PC_PORTA SGH_ARQUIVO_AMBIENTE="$PASTA/ensaio-scripts.env" \
    ./pnpm -s sgh:aplicar -- --hospital=pc --ambiente=dev --relatorio="$PASTA/migracao-aplicar.md") \
    >"$PASTA/migracao-aplicar.log" 2>&1 || rc=$?
  tail -4 "$PASTA/migracao-aplicar.log" | sed 's/^/  /'
  rm -f "$PASTA/ensaio-scripts.env"
  [ "$rc" -eq 0 ] || falha "a aplicação saiu com $rc (log em $PASTA/migracao-aplicar.log)."
  log "manual §7.4: Anexo C (privilégios do papel) do pacote instalado, como administrador do banco"
  segredos
  no_srv 'cat /opt/sante-sgh/atual/docs/implantacao/anexos/privilegios-papel.sql' | isql_fb >"$PASTA/privilegios.log" 2>&1
  [ ! -s "$PASTA/privilegios.log" ] || falha "o Anexo C deu erro (log em $PASTA/privilegios.log)."
  cmd_gatilhos_papel
  log "manual §7.5: simulação de novo (espera 0 pendentes)"
  no_srv '/opt/sante-sgh/atual/deploy/ubuntu/migrar.sh --hospital=pc --ambiente=producao --simular' 2>&1 |
    tail -4 | sed 's/^/  /'
  log "manual §7.4: reinício dos serviços para a API reler a estrutura"
  no_srv 'systemctl restart sante-sgh.target && sleep 8 && systemctl is-active sante-sgh-api sante-sgh-worker | tr "\n" " "; echo'
}

# Manual §6.4: a conta técnica de sonda é uma conta de pessoa com senha definida, sem grupo e sem nenhuma opção. No
# ensaio não há pessoa nem administrador real: a conta é SINTÉTICA, incluída só nesta cópia descartável pelo SYSDBA,
# com a senha no formato da combinação do ensaio (sha1-senha, a mesma do ACESSO_COMBINACAO_SENHA do sante.env do
# ensaio). Nenhum objeto do banco é alterado; a cópia é apagada no fim.
SONDA_LOGIN_ENSAIO=SGH.SONDA.ENSAIO
cmd_sonda() {
  segredos
  local hash
  hash=$(printf '%s' "$ENSAIO_SENHA_SONDA" | sha1sum | cut -d' ' -f1 | tr a-f A-F)
  log "conta técnica de sonda $SONDA_LOGIN_ENSAIO (sintética, só nesta cópia)"
  isql_fb >/dev/null <<SQL
UPDATE OR INSERT INTO TBUSERS (ID_TBUSERS, NOME, NOMEC, SENHA, SALT, SENHA_CRIPTOGRAFADA, STATUS, BLOQUEADO)
  VALUES (0, '$SONDA_LOGIN_ENSAIO', 'CONTA TECNICA DE SONDA (ENSAIO SINTETICO)', '$hash', 'ENSAIO', 'T', 'T', 'F')
  MATCHING (NOME);
COMMIT;
SQL
  log "manual §6.4: SONDA_LOGIN e SONDA_SENHA no sante.env e reinício"
  docker exec -i -e ENSAIO_SENHA_SONDA "$SRV" bash -s "$SONDA_LOGIN_ENSAIO" <<'FIM'
set -euo pipefail
f=/etc/sante-sgh/sante.env
for k in SONDA_LOGIN SONDA_SENHA; do sed -i -E "/^#? ?$k=/d" "$f"; done
printf 'SONDA_LOGIN=%s\nSONDA_SENHA=%s\n' "$1" "$ENSAIO_SENHA_SONDA" >>"$f"
systemctl restart sante-sgh.target
sleep 8
FIM
}

# Manual §8, ao pé da letra: o atalho do pacote, como root, com os padrões do servidor.
cmd_verificar() {
  local rc=0 nome="${1:-verificacao}"
  log "manual §8: /opt/sante-sgh/atual/deploy/ubuntu/verificar.sh"
  no_srv '/opt/sante-sgh/atual/deploy/ubuntu/verificar.sh --relatorio=/var/log/sante-sgh/verificacao-ensaio.md' || rc=$?
  docker cp "$SRV:/var/log/sante-sgh/verificacao-ensaio.md" "$PASTA/$nome.md" 2>/dev/null || true
  log "verificar.sh saiu com $rc (relatório em $PASTA/$nome.md)"
  return "$rc"
}

# A fumaça E2E contra a instância instalada, do lado de fora (como o navegador de uma estação), pelo HTTPS publicado.
cmd_fumaca_e2e() {
  segredos
  local versao
  versao=$(curl -sk --resolve "$DOMINIO:$PORTA_HTTPS:127.0.0.1" "https://$DOMINIO:$PORTA_HTTPS/api/versao" |
    python3 -I -c 'import json,sys; print(json.load(sys.stdin).get("identificacao",""))' 2>/dev/null || true)
  log "E2E de fumaça contra https://$DOMINIO:$PORTA_HTTPS (versão ${versao:-não lida})"
  (cd "$RAIZ" && E2E_INSTALADO_URL="https://$DOMINIO:$PORTA_HTTPS" E2E_VERSAO_ESPERADA="$versao" \
    E2E_SONDA_LOGIN="$SONDA_LOGIN_ENSAIO" E2E_SONDA_SENHA="$ENSAIO_SENHA_SONDA" E2E_SONDA_TOKEN="$ENSAIO_SONDA_TOKEN" \
    ./pnpm exec playwright test -c apps/web/playwright.instalado.config.ts)
}

cmd_anexo_c() {
  segredos
  local arq="${1:-$RAIZ/docs/implantacao/anexos/privilegios-papel.sql}"
  log "manual §7.4: Anexo C ($(basename "$arq")) na cópia, como administrador do banco"
  isql_fb <"$arq" >"$PASTA/anexo-c.log" 2>&1 || true
  [ ! -s "$PASTA/anexo-c.log" ] || falha "o Anexo C deu erro (log em $PASTA/anexo-c.log)."
  log "Anexo C sem erro"
}

# D-PRIVILEGIOS-PSQL-60.3: a gravação que dispara o gatilho com procedimento, conectada como a aplicação em produção
# (conta SGH_APP com o papel), não como SYSDBA. Cada gravação reescreve a própria linha (coluna = coluna), a de
# maior ID, e a sessão termina em ROLLBACK: nada fica gravado. Só contagens.
cmd_gatilhos_papel() {
  segredos
  log "gravações pelo papel SGH_APLICACAO que disparam gatilhos com procedimento (ROLLBACK no fim)"
  docker exec -i -e ENSAIO_SENHA_APP "$FB" sh -c \
    "/opt/firebird/bin/isql -q -user SGH_APP -password \"\$ENSAIO_SENHA_APP\" -role SGH_APLICACAO localhost:$BANCO" \
    >"$PASTA/gatilhos-papel.log" 2>&1 <<'SQL' || true
SET HEADING OFF;
SELECT 'papel em uso: ' || TRIM(CURRENT_ROLE) FROM RDB$DATABASE;
SELECT 'retratos antes: ' || COUNT(*) FROM HTATENDIMENTO;
UPDATE ATCABECATEND SET ID = ID WHERE ID = (SELECT MAX(ID) FROM ATCABECATEND);
SELECT 'retratos depois do atendimento (SPHISTATENDIMENTO): ' || COUNT(*) FROM HTATENDIMENTO;
UPDATE RECADATE SET REG = REG WHERE REG = (SELECT MAX(REG) FROM RECADATE);
SELECT 'retratos depois do cadastro do atendimento: ' || COUNT(*) FROM HTATENDIMENTO;
UPDATE RICADINT SET REG = REG WHERE REG = (SELECT MAX(REG) FROM RICADINT);
SELECT 'retratos depois do cadastro da internação: ' || COUNT(*) FROM HTATENDIMENTO;
SELECT 'pendências do eSocial antes: ' || COUNT(*) FROM FPESOCPEND;
UPDATE FPEVENTO SET ID_EVENTO = ID_EVENTO WHERE ID_EVENTO = (SELECT MAX(ID_EVENTO) FROM FPEVENTO);
SELECT 'pendências do eSocial depois do evento (SP_ESOC_INC_ALT_PEND_EVENTO): ' || COUNT(*) FROM FPESOCPEND;
ROLLBACK;
QUIT;
SQL
  sed 's/^/  /' "$PASTA/gatilhos-papel.log" | awk 'NF'
  # Recusa por regra de negócio do gatilho (exceção do sistema anterior com a mensagem dela) é resultado válido; falta
  # de permissão ou comando que não chegou ao fim (sem a linha "depois") não é.
  if grep -q -i 'no permission' "$PASTA/gatilhos-papel.log" ||
    [ "$(grep -c 'depois d' "$PASTA/gatilhos-papel.log")" -ne 4 ]; then
    falha "uma gravação pelo papel foi recusada por permissão (log em $PASTA/gatilhos-papel.log)."
  fi
  log "gravações pelo papel aceitas (desfeitas)"
}

cmd_apagar() {
  for c in "$SRV" "$FB"; do existe "$c" && docker rm -f "$c" >/dev/null && log "apagado $c"; done
  docker volume rm -f "$VOL" >/dev/null 2>&1 && log "apagado $VOL" || true
  existe "$REDE" && docker network rm "$REDE" >/dev/null && log "apagada a rede $REDE"
  docker image rm "$IMG" >/dev/null 2>&1 && log "apagada a imagem $IMG" || true
  rm -f "$PASTA/ensaio.env"
}

sub="${1:-}"
shift || true
case "$sub" in
  banco | migrar | servidor | instalar | reinstalar | atualizar | voltar | desinstalar | apagar | sonda | verificar)
    "cmd_$sub" "$@" ;;
  migrar-servidor) cmd_migrar_servidor "$@" ;;
  anexo-c) cmd_anexo_c "$@" ;;
  gatilhos-papel) cmd_gatilhos_papel "$@" ;;
  fumaca-e2e) cmd_fumaca_e2e "$@" ;;
  *) sed -n '2,33p' "$0"; exit 2 ;;
esac
