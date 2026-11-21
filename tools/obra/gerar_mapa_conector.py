"""Gera o mapa declarativo do conector (F4 L4, itens 1, 2, 4 e 5). Determinístico: mesma entrada, mesma saída.

uso: python3 -I tools/obra/gerar_mapa_conector.py [--dicionario CAMINHO] [--propor-ciclos] [--propor-catalogos]

Entradas: docs/analise/rodada2/final/mapa-spdata.tsv (destinos), docs/analise/origem-fb/volume-pc-20261019.tsv
(chave, volume, dependências) e o dicionário de colunas da origem (só nomes e tipos; fora do git, uso local).
Saídas em conector/mapa/: tabelas.tsv, dependencias.tsv e colunas.tsv. Os arquivos de declarado/ são revisados à
mão; --propor-ciclos e --propor-catalogos só os criam quando faltam (ponto de partida da revisão).
Nenhum dado de linha é lido: só metadado.
"""
import argparse
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "conector"))

from sante_conector import mapa, sentinela  # noqa: E402

DIR = RAIZ / mapa.DIR
# colunas de código que usam catálogo oficial direto pelo nome (o lote confirma; ID_<tabela> vai pela referência)
DEPARA_NOME = [
    ("cid10", re.compile(r"^(COD_?)?CID(10)?(_[A-Z0-9]+)?$|_CID(10)?$|^CID(10)?[0-9]?$"), (14, 37), (3, 8)),
    ("sigtap", re.compile(r"SIGTAP|PROC_?SUS|PROCSUS"), (8, 16, 14, 37), (8, 12)),
    ("cbo", re.compile(r"(^|_)CBO(_|$)|^CBO"), (8, 14, 37), (4, 10)),
    ("ibge_municipio", re.compile(r"IBGE"), (8, 14, 37), (4, 8)),
    ("ibge_uf", re.compile(r"^(UF|SIGLA_UF)(_[A-Z0-9]+)?$|_UF$"), (14, 37), (2, 2)),
    ("banco", re.compile(r"^(COD_?|N_|NRO_)?(BANCO|BCO)(_[A-Z0-9]+)?$"), (7, 8, 14, 37), (2, 5)),
]
# tabelas da origem que são catálogo oficial e a coluna que traz o código (proposta revisada à mão)
CATALOGO_FONTE = {
    "TBCID10": ("cid10", "COD", ""), "TBPROSUS": ("sigtap", "COD", ""),
    "HTPROSUS": ("sigtap", "ID_TBPROSUS", "histórico da SIGTAP: código pela linha de TBPROSUS referenciada"),
    "TBCBOSUS": ("cbo", "COD", ""), "FPCBO": ("cbo", "COD_CBO", ""),
    "RICBOFMRPUSP": ("cbo", "COD_CBOFMRPUSP", "código numérico: casa só com 6 dígitos; o resto vira pendência"),
    "TBOCUPAC": ("cbo", "", "código próprio de 2 dígitos, sem código oficial: referências viram pendência"),
    "TBMUIBGE": ("ibge_municipio", "COD", "município pelos 6 dígitos (o verificador fica em DIGITO)"),
    "TBUF": ("ibge_uf", "UF", ""), "TBTABBCO": ("banco", "COD", ""),
    "TBBANCOS": ("banco", "CODBCOCENTRAL", "conta bancária do cliente: só o banco é catálogo oficial"),
    "TBPAISES": ("pais", "", "código da origem não é o ISO do carregador: de-para pelo nome a declarar no L5"),
}


def ler_dicionario(p):
    cols = {}
    for linha in open(p, encoding="utf-8", errors="replace"):
        partes = linha.rstrip("\n").split("|")
        if len(partes) < 6:
            continue
        t, c, tipo, tam, esc, nn = partes[:6]
        cols.setdefault(t, []).append((c, int(tipo), int(tam), int(esc), nn.strip() == "1"))
    return cols


def referencia(nome, tabelas_origem, tabela):
    if not nome.startswith("ID_"):
        return ""
    alvo = nome[3:]
    while alvo:
        if alvo in tabelas_origem and alvo != tabela:
            return alvo
        if "_" not in alvo:
            return ""
        alvo = alvo.rsplit("_", 1)[0]
    return ""


def gerar_colunas(tabelas, dicionario, tabelas_origem, catalogo_de):
    saida = []
    for r in tabelas:
        if not r["tabelas_destino"]:
            continue
        t = r["tabela"]
        for nome, tipo, tam, esc, nn in dicionario.get(t, []):
            regra = sentinela.classificar(nome, tipo, tam, esc)
            ref = referencia(nome, tabelas_origem, t) if regra == "chave_origem" else ""
            dp = catalogo_de.get(ref, "") if ref else ""
            if not ref:
                for cat, rx, tipos, (mn, mx) in DEPARA_NOME:
                    if tipo in tipos and rx.search(nome) and (tipo not in (14, 37) or mn <= tam <= mx):
                        dp = cat
                        break
            saida.append({"tabela": t, "coluna": nome, "forma": sentinela.forma(tipo, tam, esc),
                          "obrigatoria": "S" if nn else "N", "regra": regra, "referencia": ref, "depara": dp})
    return saida


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dicionario", default=None)
    ap.add_argument("--propor-ciclos", action="store_true")
    ap.add_argument("--propor-catalogos", action="store_true")
    a = ap.parse_args()
    analise = mapa.ler_tsv(RAIZ / mapa.MAPA_ANALISE)
    volume = mapa.ler_tsv(RAIZ / mapa.VOLUME)
    arq_ciclos = DIR / "declarado/ciclos.tsv"
    ciclos_decl = mapa.ler_tsv(arq_ciclos) if arq_ciclos.exists() else []
    tab, deps, ciclos, arestas = mapa.montar(analise, volume, ciclos_decl)
    if ciclos and a.propor_ciclos and not ciclos_decl:
        prop = mapa.propor_quebras(ciclos, arestas, tab)
        mapa.escrever_tsv(arq_ciclos, ["tabela", "depende_de", "tratamento", "motivo"], prop)
        ciclos_decl = prop
        tab, deps, ciclos, arestas = mapa.montar(analise, volume, ciclos_decl)
    if ciclos:
        print("ciclos não declarados (%d): rode com --propor-ciclos ou declare em %s" % (len(ciclos), arq_ciclos))
        for c in ciclos[:20]:
            print("  " + ",".join(c))
    mapa.escrever_tsv(DIR / "tabelas.tsv", mapa.CAMPOS_TABELAS, tab)
    mapa.escrever_tsv(DIR / "dependencias.tsv", ["tabela", "depende_de", "quebra"], deps)
    arq_cat = DIR / "declarado/catalogos.tsv"
    if a.propor_catalogos and not arq_cat.exists():
        prop = []
        for r in tab:
            fonte = CATALOGO_FONTE.get(r["tabela"])
            if fonte:
                prop.append({"tabela": r["tabela"], "catalogo": fonte[0], "coluna_codigo": fonte[1],
                             "motivo": fonte[2]})
            elif r["estrategia"] == "depara_catalogo_oficial":
                ds = r["destinos"].split(";")
                cat = "sigtap_auxiliar" if any(d.endswith("_sigtap") for d in ds) else "tiss_ans"
                prop.append({"tabela": r["tabela"], "catalogo": cat, "coluna_codigo": "",
                             "motivo": "tabela auxiliar da SIGTAP: o carregador oficial a preenche; a origem só dá "
                                       "de-para pelo código" if cat == "sigtap_auxiliar" else
                             "terminologia da ANS/TISS: carregador oficial pendente; referências viram pendência "
                             "até ele existir"})
        mapa.escrever_tsv(arq_cat, ["tabela", "catalogo", "coluna_codigo", "motivo"], prop)
    dic = Path(a.dicionario) if a.dicionario else RAIZ / "referencias/spdata-colunas-raw.txt"
    if not dic.exists():
        print("dicionário da origem ausente (%s): colunas.tsv mantido como está" % dic.name)
        return 1 if ciclos else 0
    catalogo_de = {c["tabela"]: c["catalogo"] for c in (mapa.ler_tsv(arq_cat) if arq_cat.exists() else [])
                   if c["catalogo"] in mapa.depara.CATALOGOS}
    cols = gerar_colunas(tab, ler_dicionario(dic), {v["tabela"] for v in volume}, catalogo_de)
    mapa.escrever_tsv(DIR / "colunas.tsv", mapa.CAMPOS_COLUNAS, cols)
    sem = sorted({r["tabela"] for r in tab if r["tabelas_destino"]} - {c["tabela"] for c in cols})
    print("tabelas %d, dependências %d, colunas %d, tabelas sem colunas no dicionário %d, ciclos abertos %d" % (
        len(tab), len(deps), len(cols), len(sem), len(ciclos)))
    return 1 if ciclos else 0


if __name__ == "__main__":
    sys.exit(main())
