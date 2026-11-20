#!/usr/bin/env bash
# Constrói o artefato de release DENTRO de um contêiner Ubuntu 24.04 descartável (chamado pelo empacotar.sh; POL-4:
# nada é instalado na máquina que empacota). Entrada: /entrada/fonte.bundle (git bundle do commit) e as versões
# fixadas abaixo; saída: /saida/sante-sgh-<versão>-<commit>.tar.gz e o .sha256 ao lado.
set -euo pipefail
NODE_VERSAO="${NODE_VERSAO:?}"
PNPM_VERSAO="${PNPM_VERSAO:?}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl xz-utils git python3 make g++ >/dev/null

cd /tmp
NODE_TAR="node-v$NODE_VERSAO-linux-x64.tar.xz"
curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSAO/$NODE_TAR"
curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSAO/SHASUMS256.txt"
grep " $NODE_TAR\$" SHASUMS256.txt | sha256sum -c --quiet
mkdir -p /construcao/node
tar -xJf "$NODE_TAR" -C /construcao/node --strip-components=1
export PATH="/construcao/node/bin:$PATH"

git clone -q /entrada/fonte.bundle /construcao/fonte
cd /construcao/fonte
COMMIT="$(git rev-parse --short=12 HEAD)"
VERSAO="$(node -p 'require("./package.json").version')"
PNPM="npx --yes --loglevel=error pnpm@$PNPM_VERSAO"
$PNPM install --frozen-lockfile --reporter=silent
$PNPM exec nx run-many -t build -p api worker web --outputStyle=static
# Só as dependências de produção no pacote (a construção usou as de desenvolvimento).
$PNPM install --frozen-lockfile --prod --reporter=silent

NOME="sante-sgh-$VERSAO-$COMMIT"
P="/construcao/$NOME"
mkdir -p "$P"
LISTA="$(node --input-type=module -e "import('./tools/instalacao/src/pacote.ts').then(m=>console.log(m.CONTEUDO_PACOTE.join('\n')))")"
while read -r item; do
  [ "$item" = node ] && continue
  [ -e "$item" ] || { echo "falta no build: $item" >&2; exit 1; }
  mkdir -p "$P/$(dirname "$item")"
  cp -a "$item" "$P/$item"
done <<<"$LISTA"
# Testes e fixtures não vão ao servidor (o manifesto recusa), nem o ensaio da obra (deploy/ubuntu/ensaio).
rm -rf "$P/deploy/ubuntu/ensaio"
find "$P" -path "$P/node_modules" -prune -o \( -name '*.spec.ts' -o -name '*.spec-util.ts' -o -name e2e -o -name __fixtures__ \) -print0 |
  xargs -0 rm -rf
cp -a /construcao/node "$P/node"
printf '{"produto":"sante-sgh","versao":"%s","commit":"%s","construidoEm":"%s","identificacao":"%s+%s"}\n' \
  "$VERSAO" "$COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$VERSAO" "$COMMIT" >"$P/versao.json"
node --import ./tools/verificadores/src/caminhos-sgh.ts tools/instalacao/src/empacotar.ts "$P"
tar -czf "/saida/$NOME.tar.gz" -C "$P" .
(cd /saida && sha256sum "$NOME.tar.gz" >"$NOME.tar.gz.sha256")
echo "artefato: /saida/$NOME.tar.gz"
