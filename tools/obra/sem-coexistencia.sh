#!/usr/bin/env bash
# Verificador "sem coexistência" (ADR 0003, itens 5 e 9; lote 02-07 da F2.2): este produto nunca teve convivência com
# o sistema de origem. Cada cliente tem o seu banco, e a passagem de um hospital é inteira, pelo painel do conector.
# O código herdado do modelo base (módulos `coexistencia` e `onda0`, telas "só consulta" por etapa, liberação por
# setor, chamado "em que sistema aconteceu", verificação de convivência da fumaça) foi apagado; este verificador
# impede que volte em cópias futuras.
#
# Falha quando aparece, no código do produto (apps, packages, tools e conector; não em docs/ nem em referencias/):
#   - pasta ou arquivo de módulo de convivência (modulos/coexistencia, modulos/onda0, *coexistencia*, *onda0*);
#   - texto ou rota de convivência: "coexist", "onda0"/"onda 0", "sistema antigo", "outro sistema",
#     "liberação por setor"/"ligar o setor"/"LIGAR_SETOR".
#
# Pendências conhecidas: tools/obra/sem-coexistencia.pendentes, uma linha "caminho contagem" por arquivo que ainda tem
# texto de convivência (linha de base gravada no lote 02-07; a remoção é da onda 5 da F2.2, ADR 0003 item 9). É uma
# catraca: arquivo fora da lista, ou com mais ocorrências do que a linha de base, falha; arquivo que baixou ou zerou
# sai como aviso para baixar a linha. Com --estrito (fechamento da F2.2), qualquer pendência também falha.
# Uso: tools/obra/sem-coexistencia.sh [--estrito] [--detalhe] [--gravar-base]
# Saída: "ok", "ok (N ocorrências pendentes em M arquivos)" ou a lista do que é novo, só caminho e contagem.
set -euo pipefail
raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$raiz"
estrito=0; detalhe=0; gravar=0
for a in "$@"; do
  case "$a" in
    --estrito) estrito=1 ;;
    --detalhe) detalhe=1 ;;
    --gravar-base) gravar=1 ;;
    *) echo "uso: $0 [--estrito] [--detalhe] [--gravar-base]" >&2; exit 2 ;;
  esac
done
pendentes_arq="tools/obra/sem-coexistencia.pendentes"
padrao='coexist|onda0|onda[ _-]0\b|sistema antigo|no outro sistema|libera(ção|cao) por setor|ligar o setor|LIGAR_SETOR'
# No conector/ (o único lugar que fala da origem, regra 1 do AGENTS.md), "sistema antigo" descreve a coluna ou a regra
# de origem no mapa e nos testes: não é convivência. Os demais padrões valem também lá.
padrao_conector='coexist|onda0|onda[ _-]0\b|no outro sistema|libera(ção|cao) por setor|ligar o setor|LIGAR_SETOR'
alvos=(apps packages tools conector)
proprios='^(tools/obra/sem-coexistencia\.(sh|pendentes)|tools/obra/fatiar_f22\.py|tools/obra/conferir-lote-f22\.sh)$'
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# Arquivos rastreados ou novos (não ignorados): contagem de linhas que casam, mais 1 se o próprio caminho casa.
git ls-files -z --cached --others --exclude-standard -- "${alvos[@]}" \
  | tr '\0' '\n' | grep -Ev '(^|/)(node_modules|dist|coverage|__pycache__)/' | grep -Ev "$proprios" \
  | while IFS= read -r f; do [ -f "$f" ] && printf '%s\0' "$f"; done > "$tmp/lista"
# (a menção ao próprio verificador, "sem-coexistencia", não conta)
{ tr '\0' '\n' < "$tmp/lista" | grep -v '^conector/' | tr '\n' '\0' | xargs -0 -r grep -EiH -- "$padrao" 2>/dev/null || true
  tr '\0' '\n' < "$tmp/lista" | grep '^conector/' | tr '\n' '\0' | xargs -0 -r grep -EiH -- "$padrao_conector" 2>/dev/null || true
} | grep -vi 'sem-coexistencia' \
  | awk '{i=index($0,":"); c[substr($0,1,i-1)]++} END{for(f in c) print f" "c[f]}' > "$tmp/conteudo"
tr '\0' '\n' < "$tmp/lista" | grep -Ei 'coexist|onda0' | awk '{print $0" 1"}' > "$tmp/caminho" || true
cat "$tmp/conteudo" "$tmp/caminho" | awk '{n=$NF; $NF=""; sub(/ $/,""); t[$0]+=n} END{for(f in t) print f" "t[f]}' | sort > "$tmp/atual"

if [ "$gravar" = 1 ]; then
  { echo "# Linha de base do tools/obra/sem-coexistencia.sh (lote 02-07, $(date +%F)): caminho e ocorrências de texto de"
    echo "# convivência que ainda restam. Sai na onda 5 da F2.2 (ADR 0003, item 9). Só se baixa ou se apaga linha."
    cat "$tmp/atual"; } > "$pendentes_arq"
  echo "base gravada: $(grep -vc '^#' "$pendentes_arq") arquivos"; exit 0
fi
grep -v '^\s*#' "$pendentes_arq" 2>/dev/null | awk 'NF' | sort > "$tmp/base" || true

# novos: fora da base ou acima da contagem da base; baixados: abaixo (ou zerados).
awk 'FILENAME==ARGV[1]{b[$1]=$2; next} {if(!($1 in b)) print "  "$1" ("$2", fora da linha de base)"; else if($2>b[$1]) print "  "$1" ("$2" > "b[$1]" da linha de base)"}' "$tmp/base" "$tmp/atual" > "$tmp/novos"
awk 'FILENAME==ARGV[1]{a[$1]=$2; next} {if(!($1 in a)) print "  "$1" (zerou; tire a linha)"; else if(a[$1]<$2) print "  "$1" ("a[$1]" < "$2"; baixe a linha)"}' "$tmp/atual" "$tmp/base" > "$tmp/baixados"

if [ -s "$tmp/novos" ]; then
  echo "ERRO: convivência com o sistema de origem fora da linha de base (ADR 0003, itens 5 e 9):"
  cat "$tmp/novos"; exit 1
fi
[ "$detalhe" = 1 ] && [ -s "$tmp/baixados" ] && { echo "aviso: linha de base acima do atual:"; cat "$tmp/baixados"; }
total=$(awk '{s+=$2} END{print s+0}' "$tmp/atual"); arqs=$(grep -c . "$tmp/atual" || true)
if [ "$total" -gt 0 ]; then
  if [ "$estrito" = 1 ]; then echo "ERRO (--estrito): $total ocorrências pendentes em $arqs arquivos ($pendentes_arq)"; exit 1; fi
  echo "ok ($total ocorrências pendentes em $arqs arquivos; ver $pendentes_arq)"
else
  echo "ok"
fi
