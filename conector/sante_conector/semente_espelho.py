"""Semente do ESPELHO PADRÃO DA BASE a partir da cópia da origem (ADR 0006, item 3, opção b do dono; F4 rodada 5).

O catálogo licenciado padrão (Brasíndice, Simpro, CBHPM, CEP) nunca vem pelo conector para o cliente: vive no espelho
(banco da plataforma, versionado por edição) e chega a todo cliente pelo "criar cliente". Esta ferramenta faz a
SEMENTE inicial UMA vez, lendo as edições guardadas na cópia da origem; as edições seguintes vêm do arquivo do
fornecedor (`catalogos/licenciados/carregar.py`). Garantias:

- grava SÓ no espelho (recusa banco sem as tabelas de controle `edicao_espelho` e `tabela_espelho`);
- uma vez por edição: edição já registrada em `edicao_espelho` (catálogo e edição) não é regravada (idempotente);
- mesma normalização e mesmo SQL do carregador por arquivo (`licenciados/carregar.py`: NORMALIZAR e GERAR), nada de
  regra própria; a linha inválida não entra e é contada por motivo (nunca o conteúdo);
- conferência por CONTAGEM POR EDIÇÃO: linhas válidas da origem = linhas da edição no espelho.

Declaração (`conector/mapa/declarado/semente_espelho.tsv`: catalogo, tabela, coluna, campo, motivo): cada campo do
formato do fornecedor (FORMATO.md: codigo, descricao, preco_fabrica...) pela coluna da origem; `#edicao` (coluna da
edição ou literal `=<edição>`), `#vigencia` (coluna de data: a mais antiga da edição; ou literal `=AAAA-MM-DD`) e o
filtro opcional `#so_se` (condição `COL=v1,v2`, como na via). A coluna pode vir do pai pela chave: `COL>TABELA>COLUNA`
(ex.: a edição pela versão da publicação; a descrição pelo cadastro do item). Só contagens saem daqui.
"""
import datetime
import importlib.util
import os
from pathlib import Path

from . import mapa
from .continuidade import data_valida

DECLARACAO = "declarado/semente_espelho.tsv"
TABELAS = {"matmed": ["fonte_referencia_matmed", "edicao_referencia_matmed", "item_referencia_matmed",
                      "preco_referencia_matmed"],
           "cbhpm": ["tabela_referencia_procedimento", "tabela_referencia_procedimento_item"],
           "cep": ["bairro", "logradouro_cep"]}
CAMPOS = ["catalogo", "tabela", "coluna", "campo", "motivo"]
DIR_LICENCIADOS = ("/app/licenciados", str(Path(__file__).resolve().parents[2] / "catalogos/licenciados"))


def licenciados():
    """Módulo do carregador por arquivo (montado em /app/licenciados no container)."""
    for d in [os.environ.get("CONECTOR_LICENCIADOS_DIR")] + list(DIR_LICENCIADOS):
        if d and (Path(d) / "carregar.py").exists():
            spec = importlib.util.spec_from_file_location("licenciados_carregar", Path(d) / "carregar.py")
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise RuntimeError("carregador de licenciados ausente (catalogos/licenciados/carregar.py)")


def ler_declaracao(d=None):
    d = Path(d or os.environ.get("CONECTOR_MAPA_DIR") or mapa.DIR_PACOTE)
    f = d / DECLARACAO
    por = {}
    for r in (mapa.ler_tsv(f) if f.exists() else []):
        por.setdefault(r["catalogo"], {"tabela": r["tabela"], "campos": {}})["campos"][r["campo"]] = r["coluna"]
    return por


def erros_declaracao(decl, lic):
    erros = []
    for cat, x in decl.items():
        if cat not in lic.FONTES:
            erros.append("semente: catálogo desconhecido: %s" % cat)
            continue
        lay = lic.LAYOUTS[lic.FONTES[cat][0]]
        faltam = [c for c in lay["obrigatorias"] if c not in x["campos"]]
        fora = [c for c in x["campos"] if not c.startswith("#") and c not in lay["obrigatorias"] + lay["opcionais"]]
        if faltam or fora or "#edicao" not in x["campos"] or "#vigencia" not in x["campos"]:
            erros.append("semente %s: faltam %s, fora do formato %s (exige #edicao e #vigencia)" % (cat, faltam, fora))
    return erros


def _txt(v):
    if v is None:
        return ""
    if isinstance(v, (bytes, bytearray)):
        v = bytes(v).decode("cp1252", "replace")
    if isinstance(v, datetime.datetime):
        v = v.date()
    return v.isoformat() if isinstance(v, datetime.date) else str(v).strip()


def _cond(spec, linha):
    cd = mapa.condicao(spec)
    if not cd:
        raise RuntimeError("semente: #so_se mal formado: %s" % spec)
    v = _txt(linha.get(cd["coluna"]))
    return bool(v) if cd["valores"] is None else v in cd["valores"]


def _contar(cur, layout, fonte, edicao):
    if layout == "matmed":
        cur.execute("SELECT COUNT(*) FROM preco_referencia_matmed p JOIN edicao_referencia_matmed e ON"
                    " e.id=p.edicao_referencia_matmed_id JOIN fonte_referencia_matmed f ON"
                    " f.id=e.fonte_referencia_matmed_id WHERE f.codigo=%s AND e.numero_edicao=%s", (fonte, edicao))
    elif layout == "cbhpm":
        cur.execute("SELECT COUNT(*) FROM tabela_referencia_procedimento_item it JOIN tabela_referencia_procedimento t"
                    " ON t.id=it.tabela_referencia_procedimento_id WHERE t.codigo_tabela=%s AND t.edicao=%s",
                    (fonte, edicao))
    else:
        cur.execute("SELECT COUNT(*) FROM logradouro_cep WHERE versao_fonte=%s", (edicao,))
    return int(cur.fetchone()[0])


def semear(lt, conexao, decl=None, lic=None):
    """Lê as edições do catálogo licenciado na cópia da origem (`lt`, só leitura) e grava no espelho (`conexao`,
    com várias instruções por chamada). Devolve {catalogo: {edicao: {origem, validas, recusadas, espelho, conferido,
    situacao}}}; só contagens."""
    lic = lic or licenciados()
    decl = decl if decl is not None else ler_declaracao()
    erros = erros_declaracao(decl, lic)
    if erros:
        raise RuntimeError("; ".join(erros))
    res = {}
    with conexao.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND"
                    " table_name IN ('edicao_espelho','tabela_espelho')")
        if int(cur.fetchone()[0]) != 2:
            raise RuntimeError("o banco não é um espelho: a semente grava só no espelho padrão da base (ADR 0006)")
        presentes = set(lt.tabelas())
        for cat, x in sorted(decl.items()):
            layout, nome = lic.FONTES[cat]
            campos, tab = x["campos"], x["tabela"]
            if tab not in presentes:
                res[cat] = {"situacao": "tabela_ausente_na_origem"}
                continue
            cols = sorted({c.split(">")[0] for c in campos.values() if not c.startswith("=")} |
                          ({mapa.condicao(campos["#so_se"])["coluna"]} if "#so_se" in campos else set()))
            pais = {}
            for c in campos.values():  # coluna do pai pela chave: `COL>TABELA>COLUNA` (ex.: a edição pela versão)
                if ">" in c and not c.startswith("="):
                    _, tp, cp = c.split(">")
                    pk = lt.chave_primaria(tp)
                    ns, ip = lt.ler_tudo(tp, colunas=pk + [cp])
                    pais[c] = {_txt(x[0]) if len(pk) == 1 else "|".join(_txt(y) for y in x[:len(pk)]): x[-1]
                               for x in ip}
            nomes, it = lt.ler_tudo(tab, colunas=cols)
            edicoes = {}
            for bruta in it:
                linha = dict(zip(nomes, bruta))
                for c, m in pais.items():
                    linha[c] = m.get(_txt(linha.get(c.split(">")[0])))
                if "#so_se" in campos and not _cond(campos["#so_se"], linha):
                    continue
                ce, cv = campos["#edicao"], campos["#vigencia"]
                ed = ce[1:] if ce.startswith("=") else _txt(linha.get(ce))
                if not ed:
                    continue
                e = edicoes.setdefault(ed, {"linhas": [], "vig": None})
                v = datetime.date.fromisoformat(cv[1:]) if cv.startswith("=") else data_valida(linha.get(cv))
                if v and (e["vig"] is None or v < e["vig"]):
                    e["vig"] = v
                e["linhas"].append({k: _txt(linha.get(c)) if not c.startswith("=") else c[1:]
                                    for k, c in campos.items() if not k.startswith("#")})
            res[cat] = {}
            for ed, e in sorted(edicoes.items()):
                validas, recusadas, vistos = [], {}, set()
                for r in e["linhas"]:
                    try:
                        n = lic.NORMALIZAR[layout](r)
                        if n["_chave"] in vistos:
                            raise lic.LinhaInvalida("codigo_repetido")
                        vistos.add(n["_chave"])
                        validas.append(n)
                    except lic.LinhaInvalida as err:
                        recusadas[str(err)] = recusadas.get(str(err), 0) + 1
                cur.execute("SELECT situacao FROM edicao_espelho WHERE catalogo=%s AND edicao=%s", (cat, ed))
                ja = cur.fetchone()
                r = {"origem": len(e["linhas"]), "validas": len(validas), "recusadas": recusadas}
                if ja and ja[0] == "carregada":  # uma vez: a edição já está no espelho
                    r["situacao"] = "ja_semeada"
                elif not e["vig"]:
                    r["situacao"] = "sem_vigencia"
                else:
                    corpo, _ = lic.GERAR[layout](cat, nome, ed, e["vig"].isoformat(), None, validas, False)
                    cur.execute("DROP TEMPORARY TABLE IF EXISTS tmp_item_licenciado, tmp_cep_licenciado")
                    # em blocos de comandos inteiros: a edição inteira num pacote passa do max_allowed_packet (16 MB)
                    for bloco in lic.blocos(getattr(corpo, "comandos", [corpo])):
                        cur.execute(bloco)
                        while cur.nextset():
                            pass
                    r["situacao"] = "semeada"
                r["espelho"] = _contar(cur, layout, cat, ed)
                r["conferido"] = r["espelho"] == len(validas)
                if r["situacao"] == "semeada":
                    for tb in TABELAS[layout]:  # manifesto do espelho: as tabelas que ele leva ao cliente
                        cur.execute("INSERT IGNORE INTO tabela_espelho (tabela, catalogo, tipo, criado_em) VALUES"
                                    " (%s,%s,'licenciado',UTC_TIMESTAMP(3))", (tb, cat))
                    cur.execute(
                        "INSERT INTO edicao_espelho (catalogo, tipo, edicao, vigencia_inicio, arquivo_nome, linhas,"
                        " avisos, situacao, carregada_em, criado_em) VALUES (%s,'licenciado',%s,%s,%s,%s,%s,%s,"
                        "UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE linhas=VALUES(linhas),"
                        " avisos=VALUES(avisos), situacao=VALUES(situacao), carregada_em=VALUES(carregada_em),"
                        " alterado_em=UTC_TIMESTAMP(3), versao=versao+1",
                        (cat, ed, e["vig"], "semente_da_origem", '{"linhas": %d}' % r["espelho"],
                         '["recusadas: %d"]' % sum(recusadas.values()),
                         "carregada" if r["conferido"] else "falha"))
                res[cat][ed] = r
            conexao.commit()
    return res
