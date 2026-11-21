#!/usr/bin/env bash
# pnpm seguranca:verificar (ficha do M00): gitleaks (histórico inteiro e árvore de trabalho), Semgrep,
# OSV-Scanner, Trivy em modo arquivo e Syft (SBOM SPDX fora do git).
# Tudo por imagem Docker com tag fixa (TEC-1) e digest (sem troca silenciosa no registro), sem instalar
# nada na VM (POL-4). O repositório entra só leitura; o .env da raiz e os .env.* locais entram mascarados (vazios) e nunca são lidos (regra 1.8);
# pastas pesadas e caches entram vazias. Caches dos bancos de vulnerabilidade e saídas ficam em .seguranca/.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SAIDA="$RAIZ/.seguranca/saida"
CACHE="$RAIZ/.seguranca/cache"
DIR_SEG="tools/verificadores/seguranca"
mkdir -p "$SAIDA" "$CACHE/trivy" "$CACHE/osv"
rm -f "$SAIDA"/*.json

IMG_GITLEAKS="ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"
IMG_SEMGREP="semgrep/semgrep:1.181.0-nonroot@sha256:4c37ae86cb02b5536f8c9ff6aabbc991944117e4678609e14e0f19a2bd7ea879"
IMG_OSV="ghcr.io/google/osv-scanner:v2.7.0@sha256:4f3b7e2c64b9d38a5febc5a7e4a3dfef1d1362f726dea7a2ef4762b46469fcd0"
IMG_TRIVY="aquasec/trivy:0.76.0@sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222"
IMG_SYFT="anchore/syft:v1.54.1@sha256:3eb5379ba7b409c3f4069b686110527af0c47df993fa5c10d13e7cf34f49b1aa"

USUARIO="$(id -u):$(id -g)"
MONTAGEM=(-v "$RAIZ:/src:ro" -v "$SAIDA:/saida")
# Em worktree (M02), o .git da pasta é um arquivo que aponta por caminho absoluto para o .git comum:
# monta o .git comum no mesmo caminho, só leitura (sem isso o gitleaks do histórico não lê nada).
COMUM="$(cd "$(git -C "$RAIZ" rev-parse --git-common-dir)" && pwd)"
case "$COMUM" in "$RAIZ"/*) ;; *) MONTAGEM+=(-v "$COMUM:$COMUM:ro") ;; esac
for arq in "$RAIZ"/.env "$RAIZ"/.env.*; do
  nome="$(basename "$arq")"
  [[ -f "$arq" && "$nome" != ".env.example" ]] && MONTAGEM+=(-v "/dev/null:/src/$nome:ro")
done
# dump/ (dump do MV com dados reais de pessoas, regra 5: nem o scanner lê) e certs/ (certificado local de dev) são
# ignorados pelo git e nunca versionados: entram vazios (docs/obra/ci-verde.md).
for d in dump certs node_modules .pnpm-store .pnpm-cache .pnpm-state .npm-cache .cache-local .tmp .nx .seguranca .claude \
  apps/api/dist apps/web/dist apps/worker/dist apps/web/test-results apps/web/playwright-report; do
  [[ -d "$RAIZ/$d" ]] && MONTAGEM+=(--mount "type=tmpfs,destination=/src/$d")
done
for d in "$RAIZ"/packages/*/dist; do
  [[ -d "$d" ]] && MONTAGEM+=(--mount "type=tmpfs,destination=/src/${d#"$RAIZ"/}")
done

rodar() { # nome rede imagem [opções do docker...] -- [argumentos da ferramenta...]
  local nome=$1 rede=$2 imagem=$3
  shift 3
  local opcoes=()
  while (($#)) && [[ $1 != "--" ]]; do opcoes+=("$1"); shift; done
  shift
  docker run --rm --name "sgh-seg-$nome-$$" --network "$rede" --user "$USUARIO" -e HOME=/tmp \
    "${MONTAGEM[@]}" "${opcoes[@]}" "$imagem" "$@"
}
declare -A RES

echo "▶ gitleaks: histórico inteiro do git"
rodar gitleaks-hist none "$IMG_GITLEAKS" -w /src -- git /src --config "/src/$DIR_SEG/gitleaks.toml" --redact \
  --no-banner --log-level warn --report-format json --report-path /saida/gitleaks-historico.json --exit-code 1
RES[gitleaks_historico]=$?

echo "▶ gitleaks: árvore de trabalho (inclui arquivos ainda não versionados)"
rodar gitleaks-dir none "$IMG_GITLEAKS" -w /src -- dir /src --config "/src/$DIR_SEG/gitleaks.toml" --redact \
  --no-banner --log-level warn --report-format json --report-path /saida/gitleaks-arvore.json --exit-code 1
RES[gitleaks_arvore]=$?

echo "▶ Semgrep (regras versionadas em $DIR_SEG/semgrep, sem registro remoto)"
rodar semgrep none "$IMG_SEMGREP" -w /src -- semgrep scan --config "/src/$DIR_SEG/semgrep" --metrics off \
  --disable-version-check --quiet --json --output /saida/semgrep.json /src
RES[semgrep_exec]=$?

echo "▶ OSV-Scanner (lockfile, base offline baixada para .seguranca/cache/osv)"
rodar osv bridge "$IMG_OSV" -v "$CACHE/osv:/cache" -e OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=/cache -- \
  scan source --lockfile /src/pnpm-lock.yaml --offline-vulnerabilities --download-offline-databases \
  --format json --output-file /saida/osv.json
RES[osv_exec]=$?

echo "▶ Trivy fs (vulnerabilidades e configuração; ALTA e CRÍTICA)"
rodar trivy bridge "$IMG_TRIVY" -v "$CACHE/trivy:/cache" -- fs --cache-dir /cache --quiet \
  --scanners vuln,misconfig --severity HIGH,CRITICAL --ignorefile "/src/$DIR_SEG/trivyignore" \
  --format json --output /saida/trivy.json --exit-code 0 /src
RES[trivy]=$?

echo "▶ Syft: SBOM SPDX (fora do git, em .seguranca/saida)"
rodar syft none "$IMG_SYFT" -e SYFT_CHECK_FOR_APP_UPDATE=false -- scan dir:/src --quiet \
  -o spdx-json=/saida/sbom.spdx.json
RES[syft]=$?

# Avaliação: Semgrep conta achados ERROR (alto); OSV conta severidade >= 7.0 ou sem nota (alta/crítica) sem exceção;
# Trivy bloqueia ALTA/CRÍTICA em todo o repositório (marketing/ inclusive); exceção só no trivyignore, aprovada.
node "$RAIZ/$DIR_SEG/avaliar.ts" "$SAIDA" "$RAIZ/$DIR_SEG/excecoes.json" \
  "${RES[gitleaks_historico]}" "${RES[gitleaks_arvore]}" "${RES[semgrep_exec]}" "${RES[osv_exec]}" \
  "${RES[trivy]}" "${RES[syft]}"
