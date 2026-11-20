"""Integra a rodada 2 (determinístico): catálogo único + tabelas novas + ajustes + correções -> arquivos finais,
e confere a cobertura.

uso: python3 -I tools/obra/integrar_rodada2.py <raiz_sante_sgh> <raiz_new_sgh>

Entradas em docs/analise/rodada2/:
  catalogo-unico.tsv          tabela modulo tipo fase descricao evidencia [grupo_dono]
  mapa/*.tsv                  esquema tabela destino_tipo destino nova modulo fase motivo
  novas/*.tsv                 tabela modulo tipo fase descricao evidencia
  ajustes/*.tsv               tabela_nova acao(ACEITA|FUNDIR) destino_final modulo tipo fase descricao
  correcoes/*.tsv (opcional)  esquema tabela destino_tipo destino modulo fase motivo   (substitui a linha do mapa)
Saídas em docs/analise/rodada2/final/: catalogo.tsv, mapa-mv.tsv, mapa-spdata.tsv, cobertura.md
Sai com código 1 se a cobertura falhar.
"""
import csv
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

RAIZ = Path(sys.argv[1]).resolve()
NEW = Path(sys.argv[2]).resolve()
R2 = RAIZ / "docs/analise/rodada2"
FINAL = R2 / "final"
FINAL.mkdir(parents=True, exist_ok=True)

MODULOS = "ADM SIS REL CAD REC AGE PEP INT CC HOT SADT SUP FAT SUS FIN RH SGO INTG QUA".split()
TIPOS = "principal item dominio vinculo historico configuracao catalogo_publico".split()
FASES = {"F3", "F7", "F8"}
MECANISMOS = re.compile(r"^(trilha_auditoria|historico_entidade:[a-z0-9_]+|parametro|integracao|datamart|"
                        r"catalogo_publico:[a-z0-9_]+|framework|arquivo)$")
NOME = re.compile(r"^[a-z][a-z0-9_]{1,62}$")
PROIBIDO = re.compile(r"(^|_)(mv|soul|spdata|tb|pw)(_|$)")


def ler(p: Path) -> list[dict]:
    with open(p, encoding="utf-8", errors="replace") as f:
        return [{k.strip(): (v or "").strip() for k, v in r.items() if k} for r in csv.DictReader(f, delimiter="\t")]


def escrever(p: Path, cab: list[str], rows) -> None:
    with open(p, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow(cab)
        for r in rows:
            w.writerow([r.get(c, "") for c in cab])


def main() -> int:
    erros, avisos = [], []
    cat = {}
    for r in ler(R2 / "catalogo-unico.tsv"):
        cat[r["tabela"]] = r
    # ajustes das tabelas novas
    renome = {}
    for p in sorted((R2 / "ajustes").glob("*.tsv")):
        for r in ler(p):
            n, acao, dest = r.get("tabela_nova", ""), r.get("acao", "").upper(), r.get("destino_final", "")
            if not n:
                continue
            verif = p.stem.startswith("verif-")
            if acao == "ACEITA":
                nome = dest or n
                if nome != n:
                    renome[n] = nome
                    # renome de tabela que já está no catálogo: move a entrada (sem deixar o nome velho órfão)
                    if n in cat and nome not in cat:
                        cat[nome] = {**cat.pop(n), "tabela": nome}
                    elif n in cat:
                        cat.pop(n)
                if verif and nome in cat:
                    # a verificação adversarial é a palavra final: corrige módulo, tipo, fase e descrição
                    for c in ("modulo", "tipo", "fase", "descricao"):
                        if r.get(c):
                            cat[nome][c] = r[c]
                if nome not in cat:
                    cat[nome] = {"tabela": nome, "modulo": r.get("modulo", ""), "tipo": r.get("tipo", ""),
                                 "fase": r.get("fase", ""), "descricao": r.get("descricao", ""),
                                 "evidencia": "rodada2:nova", "grupo_dono": p.stem}
            elif acao == "FUNDIR":
                if dest and dest != n:
                    renome[n] = dest
                    if n in cat and dest in cat:
                        cat.pop(n)  # fundida numa tabela que já existe: o nome velho sai do catálogo
            else:
                erros.append(f"ajuste com ação inválida em {p.name}: {n} -> {acao}")
    # novas não tratadas por nenhum ajuste: entram como estão (aviso)
    for p in sorted((R2 / "novas").glob("*.tsv")):
        for r in ler(p):
            n = r.get("tabela", "")
            if n and n not in cat and n not in renome:
                cat[n] = {**r, "grupo_dono": "sem-ajuste"}
                avisos.append(f"nova sem ajuste entrou direto: {n} ({p.name})")

    def resolve(nome: str) -> str:
        vistos = set()
        while nome in renome and nome not in vistos:
            vistos.add(nome); nome = renome[nome]
        return nome

    # evidências que citam (em minúsculas, ex.: "dep: x") uma tabela renomeada passam a citar o nome final
    if renome:
        velho = re.compile(r"\b(" + "|".join(sorted(map(re.escape, renome), key=len, reverse=True)) + r")\b")
        for r in cat.values():
            if r.get("evidencia"):
                r["evidencia"] = velho.sub(lambda m: resolve(m.group(1)), r["evidencia"])

    # mapas
    corr = {}
    for p in sorted((R2 / "correcoes").glob("*.tsv")) if (R2 / "correcoes").exists() else []:
        for r in ler(p):
            corr[(r["esquema"], r["tabela"])] = r
    mv, sp = {}, {}
    for p in sorted((R2 / "mapa").glob("*.tsv")):
        for r in ler(p):
            k = (r.get("esquema", ""), r.get("tabela", ""))
            if not k[1]:
                continue
            if k in corr:
                # a correção substitui a linha, mas herda as colunas que ela não traz (ex.: `nova`)
                r = {**r, **{c: v for c, v in corr[k].items() if v or c in ("destino", "motivo")}}
            if r.get("destino_tipo", "").upper() == "TABELA":
                r["destino"] = ";".join(dict.fromkeys(resolve(x.strip()) for x in r.get("destino", "").split(";") if x.strip()))
            elif r.get("destino", "").startswith("historico_entidade:"):
                r["destino"] = "historico_entidade:" + resolve(r["destino"].split(":", 1)[1])
            alvo = sp if k[0] == "SPDATA" else mv
            if k in alvo:
                erros.append(f"origem mapeada duas vezes: {k[0]}.{k[1]} ({p.name})")
            alvo[k] = r

    # cobertura: MV
    origem_mv = {(r["esquema"], r["tabela"]) for r in ler(RAIZ / "referencias/mv-tabelas.tsv")}
    falta_mv = sorted(origem_mv - set(mv))
    sobra_mv = sorted(set(mv) - origem_mv)
    # cobertura: SPDATA
    origem_sp = {("SPDATA", r["tabela"]) for r in ler(NEW / "planejamento/referencias/matriz-cobertura-1503-tabelas.tsv")}
    falta_sp = sorted(origem_sp - set(sp))
    sobra_sp = sorted(set(sp) - origem_sp)
    if falta_mv: erros.append(f"MV sem destino: {len(falta_mv)} (ex.: {', '.join(a + '.' + b for a, b in falta_mv[:8])})")
    if falta_sp: erros.append(f"SPDATA sem destino: {len(falta_sp)} (ex.: {', '.join(b for _, b in falta_sp[:8])})")
    if sobra_mv: avisos.append(f"MV mapeadas que não estão na origem: {len(sobra_mv)} (ex.: {sobra_mv[:5]})")
    if sobra_sp: avisos.append(f"SPDATA mapeadas que não estão na origem: {len(sobra_sp)} (ex.: {sobra_sp[:5]})")

    # validação das linhas de mapa
    usadas = Counter()
    for (e, t), r in list(mv.items()) + list(sp.items()):
        dt = r.get("destino_tipo", "").upper()
        if dt == "TABELA":
            for d in r["destino"].split(";"):
                if d not in cat:
                    erros.append(f"{e}.{t} aponta para tabela fora do catálogo: {d}")
                usadas[d] += 1
        elif dt == "MECANISMO":
            if not MECANISMOS.match(r.get("destino", "")):
                erros.append(f"{e}.{t} mecanismo inválido: {r.get('destino')}")
            m = re.match(r"historico_entidade:(.+)", r.get("destino", ""))
            if m and resolve(m.group(1)) not in cat:
                avisos.append(f"{e}.{t} histórico de tabela fora do catálogo: {m.group(1)}")
        elif dt == "NAO":
            if not r.get("motivo"):
                erros.append(f"{e}.{t} NAO sem motivo")
        else:
            erros.append(f"{e}.{t} destino_tipo inválido: {dt}")

    # validação do catálogo
    for n, r in cat.items():
        if not NOME.match(n): erros.append(f"nome inválido no catálogo: {n}")
        if PROIBIDO.search(n): erros.append(f"nome com termo proibido: {n}")
        if r.get("modulo") not in MODULOS: erros.append(f"{n}: módulo inválido {r.get('modulo')}")
        if r.get("tipo") not in TIPOS: erros.append(f"{n}: tipo inválido {r.get('tipo')}")
        if r.get("fase") not in FASES: erros.append(f"{n}: fase inválida {r.get('fase')}")
        if re.search(r"\b(mv|soul|spdata)\b", r.get("descricao", ""), re.I):
            erros.append(f"{n}: descrição cita origem proibida")
    sem_origem = sorted(n for n in cat if usadas[n] == 0)

    # regra de paridade estrutural (conferência do orquestrador, 2026-11-20): toda tabela própria que recebe
    # dado migrado do SPDATA (destino_matriz diferente de "descartar") tem de existir na virada -> fase F3.
    # A funcionalidade (tela) pode continuar F7/F8; a estrutura é F3.
    matriz = {r["tabela"]: r for r in ler(NEW / "planejamento/referencias/matriz-cobertura-1503-tabelas.tsv")}
    promovidas = set()
    for (_, t), r in sp.items():
        if r.get("destino_tipo", "").upper() != "TABELA" or matriz.get(t, {}).get("destino") == "descartar":
            continue
        for d in r["destino"].split(";"):
            if d in cat and cat[d].get("fase") != "F3":
                cat[d]["evidencia"] = (cat[d].get("evidencia", "") + f"; paridade estrutural: era {cat[d]['fase']}").strip("; ")
                cat[d]["fase"] = "F3"
                promovidas.add(d)
        r["fase"] = "F3"
    if promovidas:
        avisos.append(f"paridade estrutural: {len(promovidas)} tabelas promovidas a F3 por receberem dado do SPDATA")

    # saídas
    cab_cat = ["tabela", "modulo", "tipo", "fase", "descricao", "evidencia", "grupo_dono", "origens"]
    for n in cat: cat[n]["origens"] = str(usadas[n])
    escrever(FINAL / "catalogo.tsv", cab_cat, sorted(cat.values(), key=lambda r: (r.get("modulo", ""), r["tabela"])))
    cab_m = ["esquema", "tabela", "destino_tipo", "destino", "nova", "modulo", "fase", "motivo"]
    escrever(FINAL / "mapa-mv.tsv", cab_m, [mv[k] for k in sorted(mv)])
    escrever(FINAL / "mapa-spdata.tsv", cab_m, [sp[k] for k in sorted(sp)])

    # relatório
    por_mod = defaultdict(Counter)
    for r in cat.values():
        por_mod[r.get("modulo", "?")][r.get("tipo", "?")] += 1
        por_mod[r.get("modulo", "?")]["fase_" + r.get("fase", "?")] += 1
    dt_mv = Counter(r.get("destino_tipo", "").upper() for r in mv.values())
    dt_sp = Counter(r.get("destino_tipo", "").upper() for r in sp.values())
    mec = Counter(r.get("destino", "").split(":")[0] for r in mv.values() if r.get("destino_tipo", "").upper() == "MECANISMO")
    L = ["# Rodada 2: cobertura e catálogo final", "",
         f"- Tabelas próprias no catálogo: **{len(cat)}**",
         f"- MV: {len(origem_mv)} tabelas de origem; mapeadas {len(set(mv) & origem_mv)}; "
         f"TABELA {dt_mv['TABELA']}, MECANISMO {dt_mv['MECANISMO']}, NAO {dt_mv['NAO']}",
         f"- SPDATA: {len(origem_sp)} tabelas com dados; mapeadas {len(set(sp) & origem_sp)}; "
         f"TABELA {dt_sp['TABELA']}, MECANISMO {dt_sp['MECANISMO']}, NAO {dt_sp['NAO']}",
         f"- Mecanismos usados (MV): " + ", ".join(f"{k} {v}" for k, v in mec.most_common()),
         f"- Tabelas próprias sem nenhuma origem (só do desenho, ex.: F8 novas ou exigência legal): {len(sem_origem)}",
         f"- Erros: **{len(erros)}**; avisos: {len(avisos)}", "",
         "## Tabelas próprias por módulo", "",
         "| Módulo | Total | " + " | ".join(TIPOS) + " | F3 | F7 | F8 |",
         "|---|---:|" + "---:|" * (len(TIPOS) + 3)]
    for m in MODULOS:
        c = por_mod.get(m, Counter())
        tot = sum(c[t] for t in TIPOS)
        L.append(f"| {m} | {tot} | " + " | ".join(str(c[t]) for t in TIPOS) +
                 f" | {c['fase_F3']} | {c['fase_F7']} | {c['fase_F8']} |")
    L += ["", "## Erros", ""] + [f"- {e}" for e in erros[:300]] + (["- (mais)"] if len(erros) > 300 else [])
    L += ["", "## Avisos", ""] + [f"- {a}" for a in avisos[:200]] + (["- (mais)"] if len(avisos) > 200 else [])
    (FINAL / "cobertura.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L[:12]))
    print(f"erros={len(erros)} avisos={len(avisos)}")
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(main())
