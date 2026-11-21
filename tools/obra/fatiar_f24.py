"""Fatiador da F2.4 (dívida da migração): agrupa a saída de divida_f24.py em lotes por assunto (domínio), para que
dois lotes nunca editem o mesmo arquivo, e gera a fatia autossuficiente de cada lote.

uso: python3 -I tools/obra/fatiar_f24.py [--max-codigo 15] [--max-comentario 45]

Entrada: docs/obra/fatias/f24/divida.tsv (gere antes: divida_f24.py --tsv ...).
Saída em docs/obra/fatias/f24/:
- <id>.lista: um arquivo por linha, mais "# assunto:" e "# cliente_teste: f24_<id>";
- <id>.md: a fatia, com cada arquivo, os tipos de dívida e as linhas exatas (trechos de até 2 linhas por
  ocorrência), para o agente não precisar buscar;
- indice.tsv: id, assunto, arquivos, peso.
Peso: arquivo com código a mudar (modelo-pendente, vocabulário ou nome de origem fora de comentário) = 1; arquivo
só com nome de origem em comentário = 1/3. O lote fecha em --max-codigo de peso "código" ou --max-comentario
arquivos só de comentário.
"""
import collections
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
DIR = RAIZ / "docs/obra/fatias/f24"
COMENT = re.compile(r"^\s*(//|\*|/\*)")


def assunto(rel: str) -> str:
    p = rel.split("/")
    if rel.startswith(("apps/api/src/modulos/", "apps/web/src/modulos/")):
        return p[4]
    if rel.startswith("packages/contratos/src/") and len(p) > 4:
        return p[3]
    if rel.startswith("packages/dominio-"):
        return p[1][len("dominio-"):]
    if rel.startswith("packages/"):
        return "pacote-" + p[1]
    return "raiz-" + p[1]


def main():
    arg = sys.argv[1:]
    maxc = int(arg[arg.index("--max-codigo") + 1]) if "--max-codigo" in arg else 15
    maxm = int(arg[arg.index("--max-comentario") + 1]) if "--max-comentario" in arg else 45
    por_arq = collections.OrderedDict()
    for linha in (DIR / "divida.tsv").read_text(encoding="utf-8").splitlines()[1:]:
        arq, _mod, tipo, _n, linhas = linha.split("\t")
        por_arq.setdefault(arq, []).append((tipo, [int(x) for x in linhas.split(",") if x]))
    grupos = collections.defaultdict(list)
    for arq, itens in por_arq.items():
        texto = (RAIZ / arq).read_text(encoding="utf-8", errors="replace").splitlines()
        so_coment = all(t == "nome-origem" for t, _ in itens) and all(
            COMENT.match(texto[i - 1]) for _t, ls in itens for i in ls if i <= len(texto))
        grupos[assunto(arq)].append((arq, itens, so_coment, texto))
    for velho in DIR.glob("[0-9][0-9]-*.*"):
        velho.unlink()
    indice, n, brutos = [], 0, []
    for nome in sorted(grupos, key=lambda g: -len(grupos[g])):
        lotes, atual, pc, pm = [], [], 0, 0
        for item in sorted(grupos[nome], key=lambda x: x[0]):
            c, m = (0, 1) if item[2] else (1, 0)
            if atual and (pc + c > maxc or pm + m > maxm):
                lotes.append(atual)
                atual, pc, pm = [], 0, 0
            atual.append(item)
            pc, pm = pc + c, pm + m
        if atual:
            lotes.append(atual)
        for k, lote in enumerate(lotes, 1):
            brutos.append((nome + (f"-{k}" if len(lotes) > 1 else ""), lote))
    # Empacota os lotes pequenos (assuntos diferentes nunca dividem arquivo) até o mesmo teto de peso.
    peso = lambda lt: sum(1 / 3 if x[2] else 1 for x in lt)
    grandes = [b for b in brutos if peso(b[1]) >= maxc / 2]
    pequenos = sorted([b for b in brutos if peso(b[1]) < maxc / 2], key=lambda b: -peso(b[1]))
    caixas = []
    for nome_b, lt in pequenos:
        alvo = next((c for c in caixas if peso(c[1]) + peso(lt) <= maxc and len(c[1]) + len(lt) <= maxm), None)
        if alvo:
            alvo[0].append(nome_b)
            alvo[1].extend(lt)
        else:
            caixas.append([[nome_b], list(lt)])
    for nome_b, lt in grandes + [("+".join(c[0]), c[1]) for c in caixas]:
        if True:
            lote = lt
            n += 1
            nome = nome_b
            lid = f"{n:02d}-" + (nome_b if "+" not in nome_b else "misto-" + nome_b.split("+")[0])
            cliente = "f24_" + re.sub(r"[^a-z0-9]", "", lid.replace("-", ""))[:20]
            (DIR / f"{lid}.lista").write_text(
                f"# assunto: {nome}\n# cliente_teste: {cliente}\n" + "".join(a + "\n" for a, *_ in lote), encoding="utf-8")
            md = [f"# Fatia F2.4 {lid} (assunto: {nome}; cliente de teste próprio: {cliente})", ""]
            for arq, itens, so_coment, texto in lote:
                md.append(f"## {arq}" + ("  (só comentário)" if so_coment else ""))
                for tipo, ls in itens:
                    md.append(f"- {tipo}: linhas {','.join(map(str, ls))}")
                    for i in ls[:12]:
                        if i <= len(texto):
                            md.append(f"    {i}: {texto[i - 1].strip()[:200]}")
                md.append("")
            (DIR / f"{lid}.md").write_text("\n".join(md), encoding="utf-8")
            peso = sum(0.34 if x[2] else 1 for x in lote)
            indice.append((lid, nome, len(lote), round(peso, 1)))
    with open(DIR / "indice.tsv", "w", encoding="utf-8") as f:
        f.write("id\tassunto\tarquivos\tpeso\n")
        for l in indice:
            f.write("\t".join(map(str, l)) + "\n")
    print(f"lotes: {len(indice)}; arquivos: {sum(l[2] for l in indice)}; peso total: {round(sum(l[3] for l in indice), 1)}")
    print("maiores: " + ", ".join(f"{l[0]} ({l[2]} arq, peso {l[3]})" for l in sorted(indice, key=lambda x: -x[3])[:6]))


if __name__ == "__main__":
    main()
