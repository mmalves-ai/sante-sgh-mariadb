"""Verificador da dívida da migração (F2.4 da fila da RETOMADA): conta o que ainda falta, por arquivo e módulo.

uso: python3 -I tools/obra/divida_f24.py [--tsv SAIDA] [--modulo M] [--falhar-se-pendente]

Tipos de dívida contados (só código de produção; specs e utilitários de teste ficam de fora):
- modelo-pendente: recusa ou leitura que aguarda estrutura no modelo do banco ('modelo-pendente');
- vocab-antigo: vocabulário do legado em contrato, API ou web (HHMM, enum S/N, destino 'legado');
- nome-origem: nome de tabela do sistema de origem (lista: conector/mapa/tabelas.tsv) fora de conector/,
  docs/analise/ e referencias/ (regra de ouro 1 do AGENTS.md).

A prova da F2.4 é este verificador chegar a 0 com --falhar-se-pendente. Só lê código; não imprime dados.
"""
import collections
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PASTAS = ["apps/api/src", "apps/worker/src", "apps/web/src", "packages"]
EXT = {".ts", ".tsx"}
TESTE = re.compile(r"\.(spec|int\.spec|spec-util|test)\.tsx?$|/(testes?|__tests__|fixtures)/")
VOCAB = re.compile(r"HHMM|destino:\s*'legado'|z\.enum\(\[\s*'S',\s*'N'\s*\]\)|'S'\s*\|\s*'N'")
PENDENTE = re.compile(r"modelo-pendente")


def nomes_origem():
    tsv = RAIZ / "conector/mapa/tabelas.tsv"
    nomes = set()
    for i, linha in enumerate(tsv.read_text(encoding="utf-8").splitlines()):
        if i and linha.strip():
            n = linha.split("\t", 1)[0].strip()
            if len(n) >= 6 and n.isupper():  # nomes curtos/genéricos geram falso positivo
                nomes.add(n)
    return re.compile(r"\b(" + "|".join(sorted(map(re.escape, nomes), key=len, reverse=True)) + r")\b") if nomes else None


def modulo(rel: str) -> str:
    p = rel.split("/")
    if rel.startswith("apps/api/src/modulos/") or rel.startswith("apps/web/src/modulos/"):
        return f"{p[1]}/{p[4]}"
    if rel.startswith("packages/"):
        return f"packages/{p[1]}" + (f"/{p[3]}" if len(p) > 4 and p[2] == "src" else "")
    return "/".join(p[:3])


def main():
    arg = sys.argv[1:]
    saida = arg[arg.index("--tsv") + 1] if "--tsv" in arg else None
    filtro = arg[arg.index("--modulo") + 1] if "--modulo" in arg else None
    origem = nomes_origem()
    linhas, por_tipo, por_mod = [], collections.Counter(), collections.Counter()
    for pasta in PASTAS:
        for arq in sorted((RAIZ / pasta).rglob("*")):
            if arq.suffix not in EXT or "node_modules" in arq.parts or not arq.is_file():
                continue
            rel = str(arq.relative_to(RAIZ))
            if TESTE.search(rel) or (filtro and not modulo(rel).startswith(filtro)):
                continue
            texto = arq.read_text(encoding="utf-8", errors="replace")
            achado = {}
            for tipo, rx in (("modelo-pendente", PENDENTE), ("vocab-antigo", VOCAB), ("nome-origem", origem)):
                if rx is None:
                    continue
                nums = [str(i) for i, l in enumerate(texto.splitlines(), 1) if rx.search(l)]
                if nums:
                    achado[tipo] = nums
            for tipo, nums in achado.items():
                linhas.append((rel, modulo(rel), tipo, len(nums), ",".join(nums[:20])))
                por_tipo[tipo] += 1
                por_mod[modulo(rel)] += 1
    arquivos = len({l[0] for l in linhas})
    print(f"dívida F2.4: {arquivos} arquivos; por tipo (arquivos): "
          + ", ".join(f"{t} {n}" for t, n in sorted(por_tipo.items())))
    print("módulos com mais dívida: " + ", ".join(f"{m} {n}" for m, n in por_mod.most_common(12)))
    if saida:
        Path(saida).parent.mkdir(parents=True, exist_ok=True)
        with open(saida, "w", encoding="utf-8") as f:
            f.write("arquivo\tmodulo\ttipo\tocorrencias\tlinhas\n")
            for l in linhas:
                f.write("\t".join(map(str, l)) + "\n")
        print(f"tsv: {saida} ({len(linhas)} linhas)")
    if "--falhar-se-pendente" in arg and linhas:
        sys.exit(1)


if __name__ == "__main__":
    main()
