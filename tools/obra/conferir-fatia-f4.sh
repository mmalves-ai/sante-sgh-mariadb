#!/usr/bin/env bash
# Autoconferência de UMA fatia dos lotes L5 a L8 do conector (F4), num comando. Devolve "ok" ou a lista de erros.
#   tools/obra/conferir-fatia-f4.sh <fatia>        (ex.: L5-01; "exemplo" confere o próprio mecanismo)
# Passos (logs longos em /tmp/claude-1000/conferir-fatia-f4/<fatia>/, nunca no chat):
#   1. verificador do mapa (python3 -I conector/verificar_mapa.py), com colunas.d e conflito entre arquivos;
#   2. conferência das fatias (python3 -I tools/obra/fatiar_conector.py --conferir);
#   3. declarações da fatia em conector/mapa/declarado/colunas.d/<fatia>.tsv;
#   4. testes da fatia: conector/testes/test_<fatia>.py (ex.: test_l5_01.py), no container;
#   5. conciliação da fatia na imagem SINTÉTICA: conector/sante_conector/sintetica_d/<fatia>.py, carregada pelo mapa
#      duas vezes num banco descartável (conector.sh conferir-fatia <fatia>).
# O validador global (suíte inteira: conector/conector.sh testes) roda à parte, sobre tudo.
set -uo pipefail
[ $# -eq 1 ] || { sed -n 2,3p "$0"; exit 2; }
F=$1
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
cd "$RAIZ"
MOD=$(echo "$F" | tr 'A-Z-' 'a-z_')
LOG=/tmp/claude-1000/conferir-fatia-f4/$F
mkdir -p "$LOG"
ERROS=()

python3 -I conector/verificar_mapa.py > "$LOG/verificador.log" 2>&1 \
  || ERROS+=("verificador do mapa: $(grep -c '^  - ' "$LOG/verificador.log") erro(s); $(grep '^  - ' "$LOG/verificador.log" | head -5 | sed 's/^  - //' | paste -sd ';' -)")
python3 -I tools/obra/fatiar_conector.py --conferir > "$LOG/fatiar.log" 2>&1 \
  || ERROS+=("fatiar_conector --conferir: $(tail -3 "$LOG/fatiar.log" | paste -sd ';' -)")

if [ "${MOD#exemplo}" != "$MOD" ]; then  # exemplo, exemplo_l5: provas do próprio motor
  TESTE=test_carga_mapa${MOD#exemplo}.py
else
  TESTE=test_$MOD.py
  [ -f "conector/mapa/declarado/colunas.d/$F.tsv" ] || ERROS+=("sem declarações: conector/mapa/declarado/colunas.d/$F.tsv")
fi
if [ -f "conector/testes/$TESTE" ]; then
  conector/conector.sh testes --padrao "$TESTE" > "$LOG/testes.log" 2>&1 \
    || ERROS+=("testes da fatia ($TESTE): $(grep -E '^(FAIL|ERROR):' "$LOG/testes.log" | head -8 | paste -sd ';' -) $(tail -1 "$LOG/testes.log")")
else
  ERROS+=("sem testes da fatia: conector/testes/$TESTE")
fi
if [ -f "conector/sante_conector/sintetica_d/$MOD.py" ]; then
  conector/conector.sh conferir-fatia "$F" > "$LOG/conferencia.json" 2> "$LOG/conferencia.err"
  RES=$(python3 -I - "$LOG/conferencia.json" "$LOG/conferencia.err" <<'PY'
import json, sys
try:
    r = json.load(open(sys.argv[1]))
except Exception:
    print("conciliação na imagem sintética não rodou: " + " ".join(open(sys.argv[2]).read().split()[-25:])); sys.exit()
for e in r.get("erros", []):
    print("conciliação: " + e)
PY
)
  while IFS= read -r l; do [ -n "$l" ] && ERROS+=("$l"); done <<< "$RES"
else
  ERROS+=("sem imagem sintética da fatia: conector/sante_conector/sintetica_d/$MOD.py")
fi

if [ ${#ERROS[@]} -eq 0 ]; then
  echo "ok"
  exit 0
fi
echo "erros (${#ERROS[@]}):"
for e in "${ERROS[@]}"; do echo "  - $e"; done
exit 1
