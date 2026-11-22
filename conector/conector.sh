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

PRIV=()
case "$1" in registrar|ler-faixa|medir-adr9|medir-carga|dicionario|testes|conferir-fatia|worker|semear-espelho) PRIV=(--privileged) ;; esac
REDE=(--network none)
MARIADB_CT=${CONECTOR_MARIADB_CONTAINER:-sante-sgh-mariadb}
REDE_INT=sante-sgh-conector-int
case "$1" in
  vincular|enfileirar|cancelar|execucao|fila|worker|testes|conferir-fatia|semear-espelho|medir-carga)
    docker network inspect "$REDE_INT" >/dev/null 2>&1 || docker network create --internal "$REDE_INT" >/dev/null
    if ! docker inspect "$MARIADB_CT" --format '{{json .NetworkSettings.Networks}}' | grep -q "\"$REDE_INT\""; then
      docker network connect --alias mariadb "$REDE_INT" "$MARIADB_CT"
    fi
    REDE=(--network "$REDE_INT")
    CONECTOR_MARIADB_SENHA=$(grep '^MARIADB_SENHA=' "$RAIZ/.env" | cut -d= -f2-)
    export CONECTOR_MARIADB_SENHA
    ;;
esac
if [ "$1" = worker ]; then
  SUBREDE=$(docker network inspect "$REDE_INT" -f '{{(index .IPAM.Config 0).Subnet}}')
  CONECTOR_MOTOR_SENHA=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-32)
  export CONECTOR_MOTOR_SENHA
  docker run --rm --network "$REDE_INT" -v "$AQUI/sante_conector:/app/sante_conector:ro" \
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
elif [ "$1" != worker-separado ]; then
  unset PLATAFORMA_CHAVE_MESTRA ARQUIVOS_RAIZ
fi

docker run --rm "${REDE[@]}" "${PRIV[@]}" "${ARQ[@]}" \
  -v "$ORIGENS:/origens:ro" -v "$VOL:/trabalho" -v "$SAIDA:/saida" \
  -v "$AQUI/sante_conector:/app/sante_conector:ro" -v "$AQUI/testes:/app/testes:ro" -v "$AQUI/mapa:/app/mapa:ro" \
  -v "$RAIZ/db/plataforma:/db-plataforma:ro" -v "$RAIZ/db/migracoes:/app/db/migracoes:ro" \
  -v "$RAIZ/catalogos/licenciados:/app/licenciados:ro" -v "$RAIZ/db/espelho:/app/db/espelho:ro" -e PLATAFORMA_CHAVE_MESTRA \
  -e CONECTOR_MARIADB_SENHA -e CONECTOR_MOTOR_SENHA -e CONECTOR_PLATAFORMA_BANCO="${CONECTOR_PLATAFORMA_BANCO:-plataforma}" \
  -e CONECTOR_MAX_PARALELO="${CONECTOR_MAX_PARALELO:-1}" \
  -e CONECTOR_GRAVADORES="${CONECTOR_GRAVADORES:-6}" -e CONECTOR_SEM_LOTE="${CONECTOR_SEM_LOTE:-}" \
  -e CONECTOR_FAIXA="${CONECTOR_FAIXA:-}" -e CONECTOR_FAIXA_MIN="${CONECTOR_FAIXA_MIN:-}" \
  -e CONECTOR_UID="$(id -u)" -e CONECTOR_GID="$(id -g)" \
  -e CONECTOR_PLANO_B_AUTORIZADO="${CONECTOR_PLANO_B_AUTORIZADO:-}" \
  -e CONECTOR_COW_MB="${CONECTOR_COW_MB:-2048}" -e CONECTOR_RESERVA_GB="${CONECTOR_RESERVA_GB:-100}" \
  "$IMG" "$@"
