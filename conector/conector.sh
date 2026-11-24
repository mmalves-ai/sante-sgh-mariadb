#!/usr/bin/env bash
# Ferramenta INTERNA de teste do motor do conector (F4). O fluxo do dono é o painel da plataforma.
#   conector/conector.sh [--construir] <comando> [args]     (comandos: ver sante_conector/cli.py)
# - roda tudo no container sante-sgh-conector; --network none, salvo os comandos da fila/motor (abaixo);
# - --privileged só para os comandos que abrem o arquivo (registrar, ler-faixa, testes, worker);
# - worker: separado em dois processos (sante_conector/separado.py): o abridor privilegiado roda numa rede vazia
#   (unshare --net) e sem credencial; o motor roda sem privilégio (uid do usuário, sem capacidades, no_new_privs),
#   é o único com a rede interna e usa a conta restrita sscon_motor_<ficha>, nunca a root. A conta é criada/renovada
#   antes, num container SEM privilégio (conta-motor), com senha aleatória nova a cada partida;
# - a pasta autorizada (CONECTOR_ORIGENS_DIR, padrão: banco-dev/backups da área de trabalho) entra só leitura;
# - o diretório de trabalho (COW ou cópia do plano B) é um volume Docker da execução, apagado no fim;
# - saídas em CONECTOR_SAIDA_DIR (padrão .tmp/conector, fora do git);
# - comandos da fila/motor (vincular, enfileirar, cancelar, execucao, fila, worker, testes) entram só na rede
#   Docker interna sante-sgh-conector-int (--internal: sem saída), à qual o MariaDB do projeto é ligado; a senha
#   do MariaDB vai por variável de ambiente herdada (nunca na linha de comando nem impressa);
# - conferir-fatia <fatia>: carga da fatia na imagem sintética (privilegiado, rede interna; DDL do modelo em
#   /app/db/migracoes, só leitura). Autoconferência por fatia: tools/obra/conferir-fatia-f4.sh <fatia>.
# - servico subir|parar|estado (obra carga-painel): o serviço SEMPRE LIGADO da leitura direta do servidor Firebird
#   (ADR 0010). Container nomeado sante-sgh-conector-servico, --restart unless-stopped, no laço `worker`, sem
#   privilégio, sem abridor e sem a senha root do MariaDB (conta restrita do motor); só retira da fila execuções de
#   origem firebird_servidor (CONECTOR_ORIGEM_TIPOS). Rede: a interna sante-sgh-conector-int (dev: o servidor
#   simulado e o MariaDB) e, em produção, também CONECTOR_REDE_ORIGEM (a que alcança o servidor do hospital). Sobrevive
#   à tela e à API; a queda é tratada pelo recuperar_orfas. O worker separado continua para a origem de arquivo.
# - logs de execução (worker e servico): CONECTOR_LOG_DIR (padrão sante-sgh-dados/conector-logs), montado em /logs;
#   o cofre de arquivo (COFRE_DIR, quando definido) entra só leitura; PLATAFORMA_CHAVE_MESTRA é herdada, nunca impressa.
set -euo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/.." && pwd)
# reconstrói quando pedido ou quando o Dockerfile mudou (rótulo com o resumo dele); a etiqueta leva o resumo, para
# duas cópias do repositório (worktrees) com Dockerfiles diferentes não se reconstruírem uma à outra
FICHA=$(sha256sum "$AQUI/Dockerfile" | cut -c1-16)
IMG=sante-sgh-conector:dev-$FICHA
if [ "${1:-}" = "--construir" ] || [ "$(docker image inspect "$IMG" --format '{{index .Config.Labels "sante.dockerfile"}}' 2>/dev/null)" != "$FICHA" ]; then
  [ "${1:-}" = "--construir" ] && shift
  docker build -q --label "sante.dockerfile=$FICHA" -t "$IMG" "$AQUI" >/dev/null
fi
[ $# -ge 1 ] || { sed -n 2,8p "$0"; exit 2; }

DADOS=${CONECTOR_DADOS_DIR:-/home/mmalves/workspace/redesante/sante-sgh-dados}
LOGS=${CONECTOR_LOG_DIR:-$DADOS/conector-logs}
REDE_INT=sante-sgh-conector-int
MARIADB_CT=${CONECTOR_MARIADB_CONTAINER:-sante-sgh-mariadb}

# lê VAR do ambiente ou do .env da raiz, sem imprimir
herdar() {
  local VAR=$1 VALOR
  if [ -z "${!VAR:-}" ] && [ -f "$RAIZ/.env" ]; then
    VALOR=$(grep "^$VAR=" "$RAIZ/.env" | cut -d= -f2- || true)
    [ -n "$VALOR" ] && export "$VAR=$VALOR"
  fi
  return 0
}

rede_interna() {
  docker network inspect "$REDE_INT" >/dev/null 2>&1 || docker network create --internal "$REDE_INT" >/dev/null
  if ! docker inspect "$MARIADB_CT" --format '{{json .NetworkSettings.Networks}}' | grep -q "\"$REDE_INT\""; then
    docker network connect --alias mariadb "$REDE_INT" "$MARIADB_CT"
  fi
}

# senha da conta restrita do motor: com a pasta de segredos, uma só (0600) para o worker e o serviço (a renovação a
# cada partida de um derrubaria o outro); sem ela, aleatória a cada partida, como antes. Nunca impressa.
senha_motor() {
  local ARQ=${CONECTOR_MOTOR_SENHA_ARQ:-$DADOS/segredos/conector-motor.senha}
  if [ -d "$(dirname "$ARQ")" ]; then
    if [ ! -s "$ARQ" ]; then
      (umask 077; head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-32 > "$ARQ")
    fi
    cat "$ARQ"
  else
    head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-32
  fi
}

if [ "$1" = servico ]; then
  NOME=sante-sgh-conector-servico
  case "${2:-estado}" in
    estado)
      docker ps -a --filter "name=^/${NOME}$" --format '{{.Names}} {{.Status}}' | grep . || echo "$NOME: não existe"
      exit 0 ;;
    parar)
      docker rm -f "$NOME" >/dev/null 2>&1 || true
      echo "$NOME: parado e removido"; exit 0 ;;
    subir) ;;
    *) echo "uso: conector.sh servico subir|parar|estado" >&2; exit 2 ;;
  esac
  rede_interna
  mkdir -p "$LOGS"
  LOGS=$(cd "$LOGS" && pwd -P)
  CONECTOR_MARIADB_SENHA=$(grep '^MARIADB_SENHA=' "$RAIZ/.env" | cut -d= -f2-)
  CONECTOR_MOTOR_SENHA=$(senha_motor)
  export CONECTOR_MARIADB_SENHA CONECTOR_MOTOR_SENHA
  SUBREDE=$(docker network inspect "$REDE_INT" -f '{{(index .IPAM.Config 0).Subnet}}')
  CONTA=$(docker run --rm --user 0:0 --network "$REDE_INT" -v "$AQUI/sante_conector:/app/sante_conector:ro" \
    -e CONECTOR_MARIADB_SENHA -e CONECTOR_MOTOR_SENHA \
    -e CONECTOR_PLATAFORMA_BANCO="${CONECTOR_PLATAFORMA_BANCO:-plataforma}" "$IMG" conta-motor --rede "$SUBREDE" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["conta"])')
  unset CONECTOR_MARIADB_SENHA          # o serviço nunca recebe a senha root
  for VAR in ARQUIVOS_RAIZ PLATAFORMA_CHAVE_MESTRA COFRE_DIR AMBIENTE; do herdar "$VAR"; done
  EXTRA=()
  if [ -n "${ARQUIVOS_RAIZ:-}" ] && [ -d "$ARQUIVOS_RAIZ" ]; then EXTRA+=(-v "$ARQUIVOS_RAIZ:$ARQUIVOS_RAIZ" -e ARQUIVOS_RAIZ); fi
  if [ -n "${COFRE_DIR:-}" ] && [ -d "$COFRE_DIR" ]; then EXTRA+=(-v "$COFRE_DIR:$COFRE_DIR:ro" -e COFRE_DIR); fi
  # dev: a senha do leitor do servidor simulado por variável (referência env:NOME, só fora de produção)
  SIM=$DADOS/segredos/fb-prontocardio.env
  if [ "${AMBIENTE:-dev}" != producao ] && [ -f "$SIM" ]; then
    FB_SIM_LEITOR_SENHA=$(grep '^FB_SIM_LEITOR_SENHA=' "$SIM" | cut -d= -f2-)
    export FB_SIM_LEITOR_SENHA
    EXTRA+=(-e FB_SIM_LEITOR_SENHA)
  fi
  docker rm -f "$NOME" >/dev/null 2>&1 || true
  docker create --name "$NOME" --restart unless-stopped --user "$(id -u):$(id -g)" --network "$REDE_INT" \
    --cap-drop ALL --security-opt no-new-privileges --memory "${CONECTOR_SERVICO_MEMORIA:-24g}" \
    -v "$AQUI/sante_conector:/app/sante_conector:ro" -v "$AQUI/mapa:/app/mapa:ro" \
    -v "$RAIZ/db/migracoes:/app/db/migracoes:ro" -v "$RAIZ/catalogos/licenciados:/app/licenciados:ro" \
    -v "$RAIZ/db/espelho:/app/db/espelho:ro" -v "$LOGS:/logs" "${EXTRA[@]}" \
    -e CONECTOR_LOG_DIR=/logs -e HOME=/tmp -e FIREBIRD_LOCK=/tmp -e CONECTOR_TRABALHO_DIR=/tmp \
    -e CONECTOR_DISCO_DIR=/logs -e CONECTOR_ORIGEM_TIPOS=firebird_servidor -e PLATAFORMA_CHAVE_MESTRA \
    -e AMBIENTE="${AMBIENTE:-dev}" -e CONECTOR_MARIADB_USUARIO="$CONTA" -e CONECTOR_MARIADB_SENHA="$CONECTOR_MOTOR_SENHA" \
    -e CONECTOR_PLATAFORMA_BANCO="${CONECTOR_PLATAFORMA_BANCO:-plataforma}" \
    -e CONECTOR_MAX_PARALELO="${CONECTOR_MAX_PARALELO:-1}" -e CONECTOR_GRAVADORES="${CONECTOR_GRAVADORES:-6}" \
    -e CONECTOR_ADIAR="${CONECTOR_ADIAR:-}" -e CONECTOR_RESERVA_GB="${CONECTOR_RESERVA_GB:-100}" \
    "$IMG" worker --espera 5 >/dev/null
  if [ -n "${CONECTOR_REDE_ORIGEM:-}" ] && [ "$CONECTOR_REDE_ORIGEM" != "$REDE_INT" ]; then
    docker network connect "$CONECTOR_REDE_ORIGEM" "$NOME"
  fi
  docker start "$NOME" >/dev/null
  echo "$NOME: no ar (conta restrita, origem firebird_servidor, logs em $LOGS)"
  exit 0
fi

origens_padrao() {
  local d="$RAIZ"
  for _ in 1 2 3 4; do
    d=$(dirname "$d")
    if [ -d "$d/banco-dev/backups" ]; then echo "$d/banco-dev/backups"; return; fi
  done
  echo ""
}
ORIGENS=${CONECTOR_ORIGENS_DIR:-$(origens_padrao)}
[ -n "$ORIGENS" ] && [ -d "$ORIGENS" ] || { echo "pasta autorizada não encontrada (CONECTOR_ORIGENS_DIR)" >&2; exit 2; }
ORIGENS=$(cd "$ORIGENS" && pwd -P)
SAIDA=${CONECTOR_SAIDA_DIR:-$RAIZ/.tmp/conector}
mkdir -p "$SAIDA"
SAIDA=$(cd "$SAIDA" && pwd -P)

# O usuário padrão da imagem não é root (DS-0002). Toda execução daqui pede root, como antes: os comandos que abrem o
# arquivo (dm-snapshot) precisam dele junto do --privileged, e os demais gravam nas pastas e volumes montados.
COMO_ROOT=(--user 0:0)
PRIV=()
case "$1" in registrar|ler-faixa|medir-adr9|medir-carga|dicionario|testes|conferir-fatia|worker|semear-espelho) PRIV=(--privileged) ;; esac
REDE=(--network none)
case "$1" in
  vincular|enfileirar|cancelar|execucao|fila|worker|testes|conferir-fatia|semear-espelho|medir-carga|migrar-controle|descartar-pendencias-copiadas)
    rede_interna
    REDE=(--network "$REDE_INT")
    CONECTOR_MARIADB_SENHA=$(grep '^MARIADB_SENHA=' "$RAIZ/.env" | cut -d= -f2-)
    export CONECTOR_MARIADB_SENHA
    ;;
esac
if [ "$1" = worker ]; then
  SUBREDE=$(docker network inspect "$REDE_INT" -f '{{(index .IPAM.Config 0).Subnet}}')
  CONECTOR_MOTOR_SENHA=$(senha_motor)
  export CONECTOR_MOTOR_SENHA
  docker run --rm "${COMO_ROOT[@]}" --network "$REDE_INT" -v "$AQUI/sante_conector:/app/sante_conector:ro" \
    -e CONECTOR_MARIADB_SENHA -e CONECTOR_MOTOR_SENHA \
    -e CONECTOR_PLATAFORMA_BANCO="${CONECTOR_PLATAFORMA_BANCO:-plataforma}" "$IMG" conta-motor --rede "$SUBREDE" >/dev/null
  unset CONECTOR_MARIADB_SENHA          # o worker nunca recebe a senha root
  shift
  set -- worker-separado "$@"
fi
VOL=sante-sgh-conector-trab-$$-$RANDOM
docker volume create "$VOL" >/dev/null
trap 'docker volume rm -f "$VOL" >/dev/null 2>&1 || true' EXIT

# ADR 0004 e decisão 17 (ADR 0007): a pasta de arquivos da instalação e a chave mestra do cofre vêm do ambiente ou
# do .env (nunca impressas). A pasta entra no MESMO caminho do host, para a API servir o que a carga gravou.
# Só no processo que executa a fila (worker): testes e conferência de fatia usam pasta e cofre descartáveis próprios.
ARQ=()
[ "$1" = worker-separado ] && for VAR in ARQUIVOS_RAIZ PLATAFORMA_CHAVE_MESTRA; do
  if [ -z "${!VAR:-}" ] && [ -f "$RAIZ/.env" ]; then
    VALOR=$(grep "^$VAR=" "$RAIZ/.env" | cut -d= -f2-)
    [ -n "$VALOR" ] && export "$VAR=$VALOR"
  fi
done
if [ "$1" = worker-separado ] && [ -n "${ARQUIVOS_RAIZ:-}" ] && [ -d "$ARQUIVOS_RAIZ" ]; then
  ARQ=(-v "$ARQUIVOS_RAIZ:$ARQUIVOS_RAIZ" -e ARQUIVOS_RAIZ)
fi
if [ "$1" = worker-separado ]; then  # log por execução (registro_log.py), gravado pelo motor (uid do usuário)
  mkdir -p "$LOGS" && LOGS=$(cd "$LOGS" && pwd -P)
  ARQ+=(-v "$LOGS:/logs" -e CONECTOR_LOG_DIR=/logs)
  herdar COFRE_DIR
  if [ -n "${COFRE_DIR:-}" ] && [ -d "$COFRE_DIR" ]; then ARQ+=(-v "$COFRE_DIR:$COFRE_DIR:ro" -e COFRE_DIR); fi
elif [ "$1" != worker-separado ]; then
  unset PLATAFORMA_CHAVE_MESTRA ARQUIVOS_RAIZ
fi

docker run --rm "${COMO_ROOT[@]}" "${REDE[@]}" "${PRIV[@]}" "${ARQ[@]}" \
  -v "$ORIGENS:/origens:ro" -v "$VOL:/trabalho" -v "$SAIDA:/saida" \
  -v "$AQUI/sante_conector:/app/sante_conector:ro" -v "$AQUI/testes:/app/testes:ro" -v "$AQUI/mapa:/app/mapa:ro" \
  -v "$RAIZ/db/plataforma:/db-plataforma:ro" -v "$RAIZ/db/migracoes:/app/db/migracoes:ro" \
  -v "$RAIZ/catalogos/licenciados:/app/licenciados:ro" -v "$RAIZ/db/espelho:/app/db/espelho:ro" -e PLATAFORMA_CHAVE_MESTRA \
  -e CONECTOR_MARIADB_SENHA -e CONECTOR_MOTOR_SENHA -e CONECTOR_PLATAFORMA_BANCO="${CONECTOR_PLATAFORMA_BANCO:-plataforma}" \
  -e CONECTOR_MAX_PARALELO="${CONECTOR_MAX_PARALELO:-1}" \
  -e CONECTOR_GRAVADORES="${CONECTOR_GRAVADORES:-6}" -e CONECTOR_ADIAR="${CONECTOR_ADIAR:-}" -e CONECTOR_SO="${CONECTOR_SO:-}" -e CONECTOR_REPROCESSAR_RECUSADAS="${CONECTOR_REPROCESSAR_RECUSADAS:-}" -e CONECTOR_SEM_LOTE="${CONECTOR_SEM_LOTE:-}" -e DIAG_SO_L3="${DIAG_SO_L3:-}" \
  -e CONECTOR_FAIXA="${CONECTOR_FAIXA:-}" -e CONECTOR_FAIXA_MIN="${CONECTOR_FAIXA_MIN:-}" \
  -e CONECTOR_UID="$(id -u)" -e CONECTOR_GID="$(id -g)" \
  -e CONECTOR_PLANO_B_AUTORIZADO="${CONECTOR_PLANO_B_AUTORIZADO:-}" \
  -e CONECTOR_COW_MB="${CONECTOR_COW_MB:-2048}" -e CONECTOR_RESERVA_GB="${CONECTOR_RESERVA_GB:-100}" \
  "$IMG" "$@"
