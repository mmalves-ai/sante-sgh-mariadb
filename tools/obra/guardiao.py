"""Guardião da orquestração (hook PreToolUse do Claude Code). Plano obrigatório:
docs/obra/plano-orquestracao.md (AGENTS.md, seção "Orquestração com orçamento").

Lê o JSON do hook na entrada padrão. Para recusar, sai com código 2 e põe o motivo na saída de erro, que o
Claude Code devolve ao modelo.

Regras:
- Workflow:
  - G1: o script declara `// ORCAMENTO: <id>`, e docs/obra/orcamentos/<id>.md tem as linhas `estimativa_M: <n>` e
    `teto_M: <n>`. O orçamento é a análise do orquestrador (o dono não aprova orçamento, decisão de 2026-11-21).
  - G2: todo `agent(` começa o prompt por `PREFIXO` (prefixo idêntico, para o cache entre os subagentes).
  - G3: o script define `LIMITE_AGENTES` e chama os subagentes só pelo invólucro `chamar(` (que conta os agentes
    e para no limite). Nenhum `agent(` direto fora do invólucro.
  - G4: o PREFIXO cita docs/obra/fatias/<tarefa>/brief.md ou traz o texto "ECONOMIA (regras".
- Agent (subagente avulso):
  - G5: o prompt traz `ORCAMENTO: <id>` válido.
  - Exceções: os tipos Explore, claude-code-guide e web-fetch, que são só de leitura.

Teste: echo '<json>' | python3 -I tools/obra/guardiao.py ; echo $?
"""
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ORC = os.path.join(RAIZ, "docs/obra/orcamentos")
LEITURA = {"Explore", "claude-code-guide", "web-fetch"}


def recusar(msg):
    sys.stderr.write("GUARDIÃO (docs/obra/plano-orquestracao.md): " + msg + "\n")
    sys.exit(2)


def orcamento_ok(oid):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,60}", oid or ""):
        return "id de orçamento inválido"
    p = os.path.join(ORC, oid + ".md")
    if not os.path.exists(p):
        return f"orçamento {oid} não existe em docs/obra/orcamentos/"
    t = open(p, encoding="utf-8").read()
    if not re.search(r"^estimativa_M:\s*\d+(\.\d+)?\s*$", t, re.M):
        return f"orçamento {oid} sem 'estimativa_M: <milhões equivalentes>'"
    if not re.search(r"^teto_M:\s*\d+(\.\d+)?\s*$", t, re.M):
        return f"orçamento {oid} sem 'teto_M: <milhões equivalentes>'"
    return None


def conferir_workflow(ti):
    s = ti.get("script")
    if not s and ti.get("scriptPath"):
        try:
            s = open(ti["scriptPath"], encoding="utf-8").read()
        except OSError:
            recusar("scriptPath ilegível")
    if not s:
        recusar("Workflow por nome salvo não é permitido; use script com orçamento")
    m = re.search(r"//\s*ORCAMENTO:\s*([a-z0-9-]+)", s)
    if not m:
        recusar("G1: script sem '// ORCAMENTO: <id>'")
    erro = orcamento_ok(m.group(1))
    if erro:
        recusar("G1: " + erro)
    if "LIMITE_AGENTES" not in s or "chamar(" not in s:
        recusar("G3: script sem LIMITE_AGENTES e o invólucro chamar(...)")
    corpo = re.sub(r"async function chamar\(.*?\n}\n", "", s, flags=re.S)
    if re.search(r"(?<![\w.])agent\(", corpo):
        recusar("G3: agent( direto fora do invólucro chamar(...)")
    for c in re.finditer(r"chamar\(\s*([^,\s][^,]*)", corpo):
        if not c.group(1).strip().startswith("PREFIXO"):
            recusar("G2: chamar( sem o PREFIXO no começo do prompt: " + c.group(1)[:60])
    p = re.search(r"const PREFIXO\s*=\s*`(.*?)`", s, re.S)
    if not p or not ("brief.md" in p.group(1) or "ECONOMIA (regras" in p.group(1)):
        recusar("G4: PREFIXO deve citar o brief da tarefa ou as regras de ECONOMIA")


def main():
    try:
        d = json.load(sys.stdin)
    except ValueError:
        sys.exit(0)
    tool = d.get("tool_name", "")
    ti = d.get("tool_input") or {}
    if tool == "Workflow":
        conferir_workflow(ti)
    elif tool == "Agent":
        if ti.get("subagent_type") in LEITURA:
            sys.exit(0)
        m = re.search(r"ORCAMENTO:\s*([a-z0-9-]+)", ti.get("prompt", ""))
        if not m:
            recusar("G5: subagente sem 'ORCAMENTO: <id>' no prompt")
        erro = orcamento_ok(m.group(1))
        if erro:
            recusar("G5: " + erro)
    sys.exit(0)


if __name__ == "__main__":
    main()
