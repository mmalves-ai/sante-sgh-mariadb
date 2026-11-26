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
filtro opcional `#so_se` (condição `COL[>T>X]=v1,v2`, como na via). A coluna pode vir do pai pela chave: `COL>TABELA>COLUNA`
(ex.: a edição pela versão da publicação; a descrição pelo cadastro do item). Campo com `;se:<condição>` (M13, R16): a
coluna vale só quando a condição vale (ex.: `VALOR;se:PFB=T` em preco_fabrica). Destino: o espelho padrão da base ou,
pelo ADR 0011, o espelho do CLIENTE (ver `semear`). Só contagens saem daqui.
"""
import datetime
import importlib.util
import json
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


def _cadeia(spec):
    """`COL[>T>X[>U>Y...]]` -> (COL, [(T, X), (U, Y)]): a coluna desta linha e os saltos pela chave do pai."""
    ps = spec.split(">")
    if len(ps) % 2 == 0 or not all(ps):
        raise RuntimeError("semente: encadeada mal formada: %s" % spec)
    return ps[0], list(zip(ps[1::2], ps[2::2]))


def _base(spec):
    """Coluna desta linha que a declaração lê (`COL`, `COL>T>X`, `COL;se:C=v`)."""
    return _cadeia(spec.partition(";se:")[0].split("=", 1)[0])[0]


def _valor(lt, pais, linha, spec):
    """Valor da coluna desta linha ou, pela encadeada, o do pai (cada salto pela chave primária do pai; o mapa do pai
    é lido uma vez e guardado em `pais`)."""
    col, passos = _cadeia(spec)
    v = linha.get(col)
    for t, x in passos:
        if v is None:
            return None
        m = pais.get((t, x))
        if m is None:
            pk = lt.chave_primaria(t)
            _ns, ip = lt.ler_tudo(t, colunas=pk + [x])
            m = pais[(t, x)] = {_txt(r[0]) if len(pk) == 1 else "|".join(_txt(y) for y in r[:len(pk)]): r[-1]
                                for r in ip}
        v = m.get(_txt(v))
    return v


def _cond(spec, linha, lt=None, pais=None):
    """Condição `COL[>T>X..][=v1,v2]` (como a do `so_se:` da via; valor vazio na lista casa o nulo). M13 (R16): a
    encadeada lê a marca da tabela do preço pelo cadastro dela (`TAB>TBCTRMEM>REF_SIMP=S,T`)."""
    cd = mapa.condicao(spec)
    if not cd or cd["cod"] or cd["regra"]:
        raise RuntimeError("semente: condição mal formada: %s" % spec)
    v = _txt(_valor(lt, {} if pais is None else pais, linha, spec.split("=", 1)[0]))
    return bool(v) if cd["valores"] is None else v in cd["valores"]


def _campo(lt, pais, linha, spec):
    """Valor de um campo da declaração: literal `=x`, coluna (ou encadeada) e, com `;se:<condição>`, só quando a
    condição vale (senão vazio; ex.: VALOR é preço de fábrica só com PFB=T)."""
    if spec.startswith("="):
        return spec[1:]
    col, _, se = spec.partition(";se:")
    if se and not _cond(se, linha, lt, pais):
        return ""
    return _txt(_valor(lt, pais, linha, col))


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


CLIENTE_MATMED = ("fonte_referencia_matmed", "edicao_referencia_matmed", "item_referencia_matmed",
                  "preco_referencia_matmed")
ORIGEM_CLIENTE = "base_do_cliente"  # marca da edição gravada no espelho do cliente pela semente (ADR 0011)


def _modo(cur):
    """'espelho' (espelho padrão da base, com o controle de edições) ou 'cliente' (ADR 0011: banco do cliente com as
    tabelas do espelho de mat/med); outro banco é recusado."""
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN"
                " (%s)" % ",".join(["%s"] * (2 + len(CLIENTE_MATMED))), ("edicao_espelho", "tabela_espelho")
                + CLIENTE_MATMED)
    ts = {r[0] for r in cur.fetchall()}
    if {"edicao_espelho", "tabela_espelho"} <= ts:
        return "espelho"
    if set(CLIENTE_MATMED) <= ts:
        return "cliente"
    raise RuntimeError("o banco não é o espelho padrão da base nem um cliente com as tabelas do espelho de mat/med:"
                       " a semente grava só no espelho (ADR 0006 e 0011)")


def _ressemear(ress):
    """{'brasindice', ('brasindice', '0')}: catálogo inteiro ou `catalogo:edicao` a apagar e semear de novo."""
    out = set()
    for x in ress or ():
        cat, _, ed = str(x).partition(":")
        out.add((cat, ed) if ed else cat)
    return out


def _gravar(cur, lic, layout, cat, nome, ed, vig, validas):
    corpo, _ = lic.GERAR[layout](cat, nome, ed, vig.isoformat(), None, validas, False)
    cur.execute("DROP TEMPORARY TABLE IF EXISTS tmp_item_licenciado, tmp_cep_licenciado")
    # em blocos de comandos inteiros: a edição inteira num pacote passa do max_allowed_packet (16 MB)
    for bloco in lic.blocos(getattr(corpo, "comandos", [corpo])):
        cur.execute(bloco)
        while cur.nextset():
            pass


def semear(lt, conexao, decl=None, lic=None, ressemear=()):
    """Lê as edições do catálogo licenciado na cópia da origem (`lt`, só leitura) e grava no espelho (`conexao`,
    com várias instruções por chamada). Devolve {catalogo: {edicao: {origem, validas, recusadas, espelho, conferido,
    situacao}}}; só contagens.

    Destinos (M13, ADR 0011):
    - espelho padrão da base (com `edicao_espelho`): como sempre, uma vez por edição, registrada no controle;
    - banco do CLIENTE (tabelas do espelho de mat/med, sem o controle): só os catálogos de mat/med. Uma vez por
      edição pelo par (catálogo, edição) em `edicao_referencia_matmed`: com a mesma contagem fica `ja_semeada`; com
      contagem diferente, a edição gravada por esta semente (marca `base_do_cliente` em `dados`) é apagada e semeada
      de novo (`ressemeada`: a semente mudou, ex.: o filtro da marca da tabela); a que veio do espelho padrão da base
      é adotada sem mudança (`adotada_do_espelho_padrao`, conferido falso: visível), salvo se pedida em `ressemear`
      (`catalogo` ou `catalogo:edicao`). Só os PREÇOS da edição são apagados; o item do espelho, que o hospital
      referencia, fica (contagem dos itens que ficaram sem preço em `_itens_sem_preco`)."""
    lic = lic or licenciados()
    decl = decl if decl is not None else ler_declaracao()
    erros = erros_declaracao(decl, lic)
    if erros:
        raise RuntimeError("; ".join(erros))
    ress = _ressemear(ressemear)
    res = {}
    with conexao.cursor() as cur:
        modo = _modo(cur)
        presentes = set(lt.tabelas())
        for cat, x in sorted(decl.items()):
            layout, nome = lic.FONTES[cat]
            campos, tab = x["campos"], x["tabela"]
            if tab not in presentes:
                res[cat] = {"situacao": "tabela_ausente_na_origem"}
                continue
            if modo == "cliente" and layout != "matmed":
                res[cat] = {"situacao": "fora_do_espelho_do_cliente"}
                continue
            cols = sorted({_base(c) for c in campos.values() if not c.startswith("=")}
                          | {_base(c.partition(";se:")[2]) for c in campos.values() if ";se:" in c})
            pais = {}
            nomes, it = lt.ler_tudo(tab, colunas=cols)
            edicoes = {}
            for bruta in it:
                linha = dict(zip(nomes, bruta))
                if "#so_se" in campos and not _cond(campos["#so_se"], linha, lt, pais):
                    continue
                ce, cv = campos["#edicao"], campos["#vigencia"]
                ed = ce[1:] if ce.startswith("=") else _txt(_valor(lt, pais, linha, ce))
                if not ed:
                    continue
                e = edicoes.setdefault(ed, {"linhas": [], "vig": None})
                v = datetime.date.fromisoformat(cv[1:]) if cv.startswith("=") else data_valida(
                    _valor(lt, pais, linha, cv))
                if v and (e["vig"] is None or v < e["vig"]):
                    e["vig"] = v
                e["linhas"].append({k: _campo(lt, pais, linha, c) for k, c in campos.items() if not k.startswith("#")})
            res[cat] = {}
            apagou = False
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
                r = {"origem": len(e["linhas"]), "validas": len(validas), "recusadas": recusadas}
                if modo == "espelho":
                    cur.execute("SELECT situacao FROM edicao_espelho WHERE catalogo=%s AND edicao=%s", (cat, ed))
                    ja = cur.fetchone()
                    if ja and ja[0] == "carregada":  # uma vez: a edição já está no espelho
                        r["situacao"] = "ja_semeada"
                    elif not e["vig"]:
                        r["situacao"] = "sem_vigencia"
                    else:
                        _gravar(cur, lic, layout, cat, nome, ed, e["vig"], validas)
                        r["situacao"] = "semeada"
                else:
                    cur.execute("SELECT e.id, e.dados FROM edicao_referencia_matmed e JOIN fonte_referencia_matmed f"
                                " ON f.id=e.fonte_referencia_matmed_id WHERE f.codigo=%s AND e.numero_edicao=%s",
                                (cat, ed))
                    ja = cur.fetchone()
                    propria = bool(ja) and ORIGEM_CLIENTE in str(ja[1] or "")
                    if ja and _contar(cur, layout, cat, ed) == len(validas):
                        r["situacao"] = "ja_semeada"
                    elif ja and not (propria or cat in ress or (cat, ed) in ress):
                        r["situacao"] = "adotada_do_espelho_padrao"
                    elif not e["vig"]:
                        r["situacao"] = "sem_vigencia"
                    else:
                        if ja:
                            cur.execute("DELETE FROM preco_referencia_matmed WHERE edicao_referencia_matmed_id=%s",
                                        (ja[0],))
                            r["precos_apagados"], apagou = int(cur.rowcount or 0), True
                        _gravar(cur, lic, layout, cat, nome, ed, e["vig"], validas)
                        r["situacao"] = "ressemeada" if ja else "semeada"
                r["espelho"] = _contar(cur, layout, cat, ed)
                r["conferido"] = r["espelho"] == len(validas)
                if r["situacao"] in ("semeada", "ressemeada") and modo == "espelho":
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
                elif r["situacao"] in ("semeada", "ressemeada"):
                    # registro da edição no espelho do cliente: origem do conteúdo, data da carga e contagem (ADR 0011)
                    cur.execute("UPDATE edicao_referencia_matmed e JOIN fonte_referencia_matmed f ON"
                                " f.id=e.fonte_referencia_matmed_id SET e.dados=%s, e.situacao=IF(%s, e.situacao,"
                                " 'falha') WHERE f.codigo=%s AND e.numero_edicao=%s",
                                (json.dumps({"origem_conteudo": ORIGEM_CLIENTE,
                                             "carregada_em": datetime.datetime.now(datetime.timezone.utc)
                                             .strftime("%Y-%m-%dT%H:%M:%SZ"), "linhas": r["espelho"],
                                             "recusadas": sum(recusadas.values())}), r["conferido"], cat, ed))
                res[cat][ed] = r
            if apagou:
                cur.execute("SELECT COUNT(*) FROM item_referencia_matmed i WHERE i.fonte_referencia=%s AND NOT EXISTS"
                            " (SELECT 1 FROM preco_referencia_matmed p WHERE p.item_referencia_matmed_id=i.id)", (cat,))
                res.setdefault("_itens_sem_preco", {})[cat] = int(cur.fetchone()[0])
            conexao.commit()
    return res


def semear_no_cliente(lt, banco_cliente, usuario=None, senha=None, ressemear=()):
    """M13 (ADR 0011): o passo da execução que semeia o espelho do cliente pela origem, ANTES do L8-03 (TBMATMED,
    `ligar_espelho:`) e do L8-05 (`espelho:`). Conexão própria com várias instruções por chamada."""
    from . import banco
    cx = banco.conectar(banco.nome_seguro(banco_cliente), usuario=usuario, senha=senha, autocommit=False, multi=True)
    try:
        return semear(lt, cx, ressemear=ressemear)
    finally:
        cx.close()
