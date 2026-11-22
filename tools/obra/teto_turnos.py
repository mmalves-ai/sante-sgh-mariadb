"""Guardião, regra G6 (dono, 2026-11-21): teto de ferramentas por subagente. Hook PreToolUse com matcher "*".

Por quê: agentes de 120 a 140 turnos custaram de 2 a 3 vezes o previsto, porque cada turno relê o contexto acumulado.
O teto escrito no texto do prompt não segurou: esta é a trava técnica.

Como funciona (só para subagente: o hook só traz `agent_id` quando quem chama a ferramenta é um subagente; o
orquestrador nunca é contado nem bloqueado):
- conta cada chamada de ferramenta do subagente (arquivo por `agent_id`, com trava de arquivo);
- AVISO na chamada número AVISO (60): recusa essa chamada, uma vez só, com a instrução de fechar: gravar o que fez,
  terminar a edição em curso e devolver ok=false com a lista exata do que falta. As chamadas seguintes passam;
- BLOQUEIO a partir de BLOQUEIO (80): recusa tudo, menos a ferramenta de devolver o resultado (StructuredOutput) e
  as de mensagem final, para o trabalho feito nunca se perder. O que falta vai para um agente novo (contexto limpo);
- tipos só de leitura (Explore, claude-code-guide, web-fetch) não são contados.

Os limites podem ser trocados para teste em /tmp/claude-1000/teto/limites.json ({"aviso": 3, "bloqueio": 5}).
Teste: echo '<json>' | python3 -I tools/obra/teto_turnos.py ; echo $?
"""
import fcntl
import json
import os
import re
import sys

DIR = "/tmp/claude-1000/teto"
AVISO, BLOQUEIO = 60, 80
LIVRES = {"StructuredOutput", "SubagentHandback"}
LEITURA = {"Explore", "claude-code-guide", "web-fetch"}


def limites():
    try:
        d = json.load(open(os.path.join(DIR, "limites.json")))
        return int(d.get("aviso", AVISO)), int(d.get("bloqueio", BLOQUEIO))
    except (OSError, ValueError):
        return AVISO, BLOQUEIO


def recusar(msg):
    sys.stderr.write("GUARDIÃO G6 (teto de ferramentas por subagente, docs/obra/plano-orquestracao.md): " + msg + "\n")
    sys.exit(2)


def main():
    try:
        d = json.load(sys.stdin)
    except ValueError:
        sys.exit(0)
    agente = d.get("agent_id")
    if not agente or d.get("agent_type") in LEITURA:
        sys.exit(0)
    tool = d.get("tool_name", "")
    os.makedirs(DIR, exist_ok=True)
    caminho = os.path.join(DIR, re.sub(r"[^A-Za-z0-9_-]", "_", str(agente))[:80])
    with open(caminho, "a+") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        fh.seek(0)
        n = int(fh.read().strip() or 0) + 1
        fh.seek(0)
        fh.truncate()
        fh.write(str(n))
    aviso, bloqueio = limites()
    if tool in LIVRES:
        sys.exit(0)
    if n == aviso:
        recusar(f"você chegou a {aviso} ferramentas. FECHE AGORA: termine só a edição em curso (sem deixar arquivo "
                f"pela metade), grave o que fez no arquivo de saída da tarefa e devolva o resultado com ok=false e a "
                f"lista EXATA do que falta (arquivo, linha, o quê). Um agente novo continua. Você tem até "
                f"{bloqueio - aviso} ferramentas antes do bloqueio. Repita esta chamada se ela for necessária.")
    if n >= bloqueio:
        recusar(f"teto de {bloqueio} ferramentas atingido: só a devolução do resultado está liberada. Devolva agora "
                f"ok=false com o que fez e a lista exata do que falta.")
    sys.exit(0)


if __name__ == "__main__":
    main()
