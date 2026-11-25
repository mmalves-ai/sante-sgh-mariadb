"""Carregador da CID-10 e da CID-O (morfologia) a partir do arquivo oficial do DATASUS (F1.4).

Fonte: catalogos/cache/cid10/CID10CSV.zip (CSV ';', latin-1). Versão: a do registro.tsv (edição 2008).

Grava:
- terminologia 'cid10' e 'cid_o' + terminologia_edicao (uma por edição) + edição vigente;
- termo_terminologia da CID-10 em 4 níveis: 1 capítulo (número romano), 2 agrupamento (faixa A00-A09),
  3 categoria (A00), 4 subcategoria (A000, sem ponto, como na fonte); superior = nível de cima;
- termo_terminologia da CID-O: 1 grupo (M800), 2 morfologia (M8000/0);
- capitulo_cid10 e agrupamento_cid10 (grupos aninhados viram 'subgrupo' com pai = faixa mais estreita);
- correspondencia_cid_morfologia: coluna REFER da CID-O (C71.- vira C71; D16.4 vira D164).
- topografia_tumor (09-AREA L69): a topografia da CID-O-3 deriva das categorias C00-C80 da CID-10 (a CID-O-3 usa os
  mesmos códigos, com ponto: C50.4), sem as que a CID-O-3 não tem como sítio (C43 melanoma e C46 Kaposi, que lá viram
  pele e partes moles pela morfologia; C45 mesotelioma; C78-C79 secundárias; C81-C97 hematológicas) e com o sítio
  hematopoético C42.0-C42.4 da própria CID-O-3. Categoria sem subcategoria vira o .9 (SOE), como na CID-O-3.
  PENDÊNCIA (C2-073): a lista é DERIVADA da CID-10, não a tabela oficial de topografia da CID-O-3 (o arquivo do
  DATASUS só traz a morfologia). Por isso versao_fonte = 'derivada CID-10 <edição>' e não 'CID-O-3'. Os sítios que a
  CID-10 descreve como secundários (C77 linfonodos) e o C80 levam o texto da CID-O-3 (SITIOS_CIDO3). Trocar pela
  tabela oficial de topografia (INCA/OMS) quando ela entrar no cache por carregador versionado.
"""
import io
import json
import re
import subprocess
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
ZIP = RAIZ / "catalogos/cache/cid10/CID10CSV.zip"
LOTE = 1000
VIGENCIA = "2008-01-01"  # início da edição 2008 da CID-10 distribuída pelo DATASUS (ver observação)
ROMANOS = re.compile(r"^Cap[ií]tulo\s+([IVXL]+)\s*-\s*(.*)$")


def _sql(banco, entrada, *args):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco] + list(args),
                       input=entrada, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"cid10: erro no SQL: {r.stderr.strip()[:500]}")
    return r.stdout


def _consulta(banco, q):
    saida = _sql(banco, q, "-N", "-B")
    return [ln.split("\t") for ln in saida.splitlines() if ln]


def _q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, _Raw):
        return v.s
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


class _Raw:
    def __init__(self, s):
        self.s = s


def _upsert(banco, tabela, colunas, linhas, atualizar):
    if not linhas:
        return
    upd = ", ".join(f"{c} = VALUES({c})" for c in atualizar) + ", alterado_em = UTC_TIMESTAMP(3)"
    partes = []
    for i in range(0, len(linhas), LOTE):
        vals = ",\n".join("(" + ", ".join(_q(v) for v in ln) + ")" for ln in linhas[i:i + LOTE])
        partes.append(f"INSERT INTO {tabela} ({', '.join(colunas)}) VALUES\n{vals}\n"
                      f"ON DUPLICATE KEY UPDATE {upd};")
    _sql(banco, "SET NAMES utf8mb4;\n" + "\n".join(partes))


def _ler(zf, nome):
    texto = zf.read(nome).decode("latin-1")
    linhas = [ln.rstrip("\r") for ln in texto.split("\n")][1:]
    return [[c.strip() for c in ln.split(";")] for ln in linhas if ln.strip()]


def _versao():
    for ln in (RAIZ / "catalogos/cache/registro.tsv").read_text(encoding="utf-8").splitlines():
        c = ln.split("\t")
        if c and c[0] == "cid10":
            return c[1], c[4], c[6]
    raise RuntimeError("cid10: fonte ausente do registro.tsv")


def _terminologia(banco, codigo, nome, sigla, url, versao, sha, total):
    _sql(banco, "SET NAMES utf8mb4;\n"
         f"INSERT INTO terminologia (codigo, nome, sigla, tipo, orgao_responsavel, url_fonte, idioma, origem, "
         f"criado_em, versao) VALUES ({_q(codigo)}, {_q(nome)}, {_q(sigla)}, 'diagnostico', "
         f"{_q('Organização Mundial da Saúde; distribuição em português pelo DATASUS/Ministério da Saúde')}, "
         f"{_q(url)}, 'pt-BR', 'sistema', UTC_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome), "
         f"sigla = VALUES(sigla), tipo = VALUES(tipo), orgao_responsavel = VALUES(orgao_responsavel), "
         f"url_fonte = VALUES(url_fonte), alterado_em = UTC_TIMESTAMP(3);")
    tid = int(_consulta(banco, f"SELECT id FROM terminologia WHERE codigo = {_q(codigo)}")[0][0])
    antes = int(_consulta(banco, f"SELECT COUNT(*) FROM termo_terminologia WHERE terminologia_id = {tid}")[0][0])
    _sql(banco, "SET NAMES utf8mb4;\n"
         f"INSERT INTO terminologia_edicao (terminologia_id, operacao, ocorrido_em, versao_edicao, vigencia_inicio, "
         f"situacao_carga, hash_sha256, total_termos, criado_em, versao) VALUES ({tid}, 'inclusao', "
         f"UTC_TIMESTAMP(3), {_q(versao)}, {_q(VIGENCIA)}, 'carregando', {_q(sha)}, {total}, UTC_TIMESTAMP(3), 1) "
         f"ON DUPLICATE KEY UPDATE situacao_carga = 'carregando', hash_sha256 = VALUES(hash_sha256), "
         f"total_termos = VALUES(total_termos), alterado_em = UTC_TIMESTAMP(3);")
    eid = int(_consulta(banco, f"SELECT id FROM terminologia_edicao WHERE terminologia_id = {tid} "
                               f"AND versao_edicao = {_q(versao)}")[0][0])
    return tid, eid, antes


def _fechar(banco, tid, eid, antes, extra):
    depois = int(_consulta(banco, f"SELECT COUNT(*) FROM termo_terminologia WHERE terminologia_id = {tid}")[0][0])
    dados = json.dumps(dict(extra, termos_no_banco=depois), ensure_ascii=False)
    _sql(banco, "SET NAMES utf8mb4;\n"
         f"UPDATE terminologia_edicao SET situacao_carga = 'carregada', carregada_em = UTC_TIMESTAMP(3), "
         f"termos_incluidos = {depois - antes}, dados = {_q(dados)}, alterado_em = UTC_TIMESTAMP(3) "
         f"WHERE id = {eid};\n"
         f"UPDATE terminologia SET edicao_vigente_terminologia_edicao_id = {eid}, alterado_em = UTC_TIMESTAMP(3) "
         f"WHERE id = {tid} AND NOT (edicao_vigente_terminologia_edicao_id <=> {eid});")


def _ids(banco, tid):
    return {c: int(i) for c, i in _consulta(
        banco, f"SELECT codigo_termo, id FROM termo_terminologia WHERE terminologia_id = {tid}")}


COLS_TERMO = ["terminologia_id", "codigo_termo", "descricao", "termo_superior_id", "nivel", "sexo_id",
              "terminologia_edicao_id", "ativo", "vigencia_inicio", "versao_fonte", "criado_em", "versao"]
UPD_TERMO = ["descricao", "termo_superior_id", "nivel", "sexo_id", "terminologia_edicao_id", "ativo",
             "vigencia_inicio", "versao_fonte"]
AGORA = _Raw("UTC_TIMESTAMP(3)")
SEXO = {"F": _Raw("(SELECT id FROM sexo WHERE sigla = 'F')"), "M": _Raw("(SELECT id FROM sexo WHERE sigla = 'M')")}


def _termo(tid, eid, ver, codigo, desc, sup, nivel, sexo=None):
    return [tid, codigo, desc[:500], sup, nivel, sexo, eid, 1, VIGENCIA, ver, AGORA, 1]


def _contem(faixa, cod):
    return faixa[0] <= cod[:3] <= faixa[1]


def carregar(banco: str) -> dict:
    url, sha, ver = _versao()
    with zipfile.ZipFile(ZIP) as zf:
        caps = _ler(zf, "CID-10-CAPITULOS.CSV")
        grps = _ler(zf, "CID-10-GRUPOS.CSV")
        cats = _ler(zf, "CID-10-CATEGORIAS.CSV")
        subs = _ler(zf, "CID-10-SUBCATEGORIAS.CSV")
        ogrp = _ler(zf, "CID-O-GRUPOS.CSV")
        ocat = _ler(zf, "CID-O-CATEGORIAS.CSV")

    capitulos, faixas, pai_grp, prof = hierarquia(caps, grps)
    cap_de = lambda cod: capitulo_de(capitulos, cod)
    grp_de = lambda cod: grupo_de(faixas, cod)

    cod_faixa = lambda f: f"{f[0]}-{f[1]}"

    # sexo das categorias sem subdivisão vem do arquivo de subcategorias (linhas de 3 caracteres)
    sexo_cat = {s[0]: s[2] for s in subs if len(s[0]) == 3 and s[2]}
    subs4 = [s for s in subs if len(s[0]) == 4]

    total_cid = len(capitulos) + len(faixas) + len(cats) + len(subs4)
    tid, eid, antes = _terminologia(
        banco, "cid10", "Classificação Estatística Internacional de Doenças e Problemas Relacionados à Saúde, "
        "10ª revisão", "CID-10", url, ver, sha, total_cid)

    # tabelas próprias: capitulo_cid10 e agrupamento_cid10
    _upsert(banco, "capitulo_cid10",
            ["codigo_cid10", "numero", "codigo_inicial", "codigo_final", "descricao", "descricao_abreviada",
             "vigencia_inicio", "versao_fonte", "criado_em", "versao"],
            [[r, n, i, f, d[:300], (a or "")[:150] or None, VIGENCIA, ver, AGORA, 1]
             for r, n, i, f, d, _, a in capitulos],
            ["numero", "codigo_inicial", "codigo_final", "descricao", "descricao_abreviada", "vigencia_inicio",
             "versao_fonte"])
    cap_id = {c: int(i) for c, i in _consulta(banco, "SELECT codigo_cid10, id FROM capitulo_cid10")}
    for p in sorted(set(prof.values())):
        nivel = [g for g in faixas if prof[g[:2]] == p]
        ag_id = {c: int(i) for c, i in _consulta(banco, "SELECT codigo_cid10, id FROM agrupamento_cid10")}
        _upsert(banco, "agrupamento_cid10",
                ["capitulo_cid10_id", "pai_agrupamento_cid10_id", "nivel", "codigo_cid10", "codigo_inicial",  # gitleaks:allow (lista de nomes de coluna, não é segredo)
                 "codigo_final", "descricao", "descricao_abreviada", "vigencia_inicio", "versao_fonte",
                 "criado_em", "versao"],
                [[cap_id[cap_de(g[0])[0]], ag_id[cod_faixa(pai_grp[g[:2]])] if pai_grp[g[:2]] else None,
                  nivel_agrupamento(pai_grp, g), cod_faixa(g), g[0], g[1], g[2][:300],
                  (g[3] or "")[:150] or None, VIGENCIA, ver, AGORA, 1] for g in nivel],
                ["capitulo_cid10_id", "pai_agrupamento_cid10_id", "nivel", "codigo_inicial", "codigo_final",  # gitleaks:allow (lista de nomes de coluna, não é segredo)
                 "descricao", "descricao_abreviada", "vigencia_inicio", "versao_fonte"])

    # termos da CID-10, de cima para baixo
    _upsert(banco, "termo_terminologia", COLS_TERMO,
            [_termo(tid, eid, ver, r, dc, None, 1) for r, _, _, _, _, dc, _ in capitulos], UPD_TERMO)
    for p in sorted(set(prof.values())):
        ids = _ids(banco, tid)
        _upsert(banco, "termo_terminologia", COLS_TERMO,
                [_termo(tid, eid, ver, cod_faixa(g), g[2],
                        ids[cod_faixa(pai_grp[g[:2]])] if pai_grp[g[:2]] else ids[cap_de(g[0])[0]], 2)
                 for g in faixas if prof[g[:2]] == p], UPD_TERMO)
    ids = _ids(banco, tid)
    _upsert(banco, "termo_terminologia", COLS_TERMO,
            [_termo(tid, eid, ver, c[0], c[2],
                    ids[cod_faixa(grp_de(c[0]))] if grp_de(c[0]) else ids[cap_de(c[0])[0]], 3,
                    SEXO.get(sexo_cat.get(c[0]))) for c in cats], UPD_TERMO)
    ids = _ids(banco, tid)
    _upsert(banco, "termo_terminologia", COLS_TERMO,
            [_termo(tid, eid, ver, s[0], s[4], ids[s[0][:3]], 4, SEXO.get(s[2])) for s in subs4], UPD_TERMO)
    _fechar(banco, tid, eid, antes, {"capitulos": len(capitulos), "agrupamentos": len(faixas),
                                     "categorias": len(cats), "subcategorias": len(subs4)})
    ids_cid = _ids(banco, tid)

    # ---------- CID-O (morfologia) ----------
    # grupos com o mesmo código: a 1ª linha é cabeçalho de seção; fica a última (o grupo propriamente dito)
    og = {}
    for g in ogrp:
        og[g[0]] = g[2]
    codigos_g = sorted(og)
    total_o = len(og) + len(ocat)
    oid, oeid, oantes = _terminologia(
        banco, "cid_o", "Classificação Internacional de Doenças para Oncologia, morfologia", "CID-O",
        url, ver, sha, total_o)
    _upsert(banco, "termo_terminologia", COLS_TERMO,
            [_termo(oid, oeid, ver, c, d, None, 1) for c, d in og.items()], UPD_TERMO)
    ids_o = _ids(banco, oid)

    def grupo_o(cod):
        ant = [g for g in codigos_g if g <= cod[:4]]
        return ids_o[ant[-1]] if ant else None

    _upsert(banco, "termo_terminologia", COLS_TERMO,
            [_termo(oid, oeid, ver, c[0], c[1], grupo_o(c[0]), 2) for c in ocat], UPD_TERMO)
    _fechar(banco, oid, oeid, oantes, {"grupos": len(og), "morfologias": len(ocat),
                                       "cabecalhos_descartados": len(ogrp) - len(og)})
    ids_o = _ids(banco, oid)

    corr = {}
    for c in ocat:
        for ref in filter(None, (x.strip() for x in c[2].split(","))):
            cid = ref.replace(".-", "").replace(".", "")
            corr[(cid, c[0])] = [cid, c[0], ids_cid.get(cid), ids_o[c[0]], c[1][:250], VIGENCIA, None, ver,
                                 AGORA, 1]
    _upsert(banco, "correspondencia_cid_morfologia",
            ["codigo_cid", "codigo_morfologia", "cid_termo_terminologia_id", "morfologia_termo_terminologia_id",
             "descricao", "vigencia_inicio", "vigencia_fim", "versao_fonte", "criado_em", "versao"],
            list(corr.values()),
            ["cid_termo_terminologia_id", "morfologia_termo_terminologia_id", "descricao", "vigencia_inicio",
             "versao_fonte"])

    _upsert(banco, "topografia_tumor",
            ["codigo_cid_o", "descricao", "categoria", "ativo", "vigencia_inicio", "versao_fonte", "criado_em",
             "versao"],
            [[c, d, cat, 1, VIGENCIA, versao_topografia(ver), AGORA, 1] for c, d, cat in topografias(cats, subs4)],
            ["descricao", "categoria", "vigencia_inicio", "versao_fonte"])

    cont = _consulta(banco, f"""
        SELECT 'terminologia', COUNT(*) FROM terminologia WHERE codigo IN ('cid10','cid_o')
        UNION ALL SELECT 'terminologia_edicao', COUNT(*) FROM terminologia_edicao WHERE terminologia_id IN ({tid},{oid})
        UNION ALL SELECT 'termo_terminologia', COUNT(*) FROM termo_terminologia WHERE terminologia_id IN ({tid},{oid})
        UNION ALL SELECT 'capitulo_cid10', COUNT(*) FROM capitulo_cid10
        UNION ALL SELECT 'agrupamento_cid10', COUNT(*) FROM agrupamento_cid10
        UNION ALL SELECT 'topografia_tumor', COUNT(*) FROM topografia_tumor
        UNION ALL SELECT 'correspondencia_cid_morfologia', COUNT(*) FROM correspondencia_cid_morfologia""")
    return {t: int(n) for t, n in cont}


EXCLUIDAS_TOPOGRAFIA = {"C43", "C45", "C46", "C78", "C79"}
# Sítio hematopoético e reticuloendotelial: só existe na CID-O-3 (a CID-10 o classifica pela morfologia, C81-C96).
TOPOGRAFIA_HEMATOPOETICA = [
    ("C42.0", "Sangue"),
    ("C42.1", "Medula óssea"),
    ("C42.2", "Baço"),
    ("C42.3", "Sistema reticuloendotelial, SOE"),
    ("C42.4", "Sistema hematopoético, SOE"),
]
# Sítios cujo texto da CID-10 não serve de topografia (a CID-10 os descreve como secundários ou sem sítio).
SITIOS_CIDO3 = {
    "C77.0": "Linfonodos da cabeça, face e pescoço",
    "C77.1": "Linfonodos intratorácicos",
    "C77.2": "Linfonodos intra-abdominais",
    "C77.3": "Linfonodos da axila ou do membro superior",
    "C77.4": "Linfonodos da região inguinal ou do membro inferior",
    "C77.5": "Linfonodos intrapélvicos",
    "C77.8": "Linfonodos de múltiplas regiões",
    "C77.9": "Linfonodo, SOE",
    "C80.9": "Localização primária desconhecida",
}


def versao_topografia(ver):
    """Rótulo da fonte da topografia: derivada da CID-10 (não é a tabela oficial da CID-O-3; ver a pendência)."""
    return f"derivada CID-10 {ver}"[:30]


_PREFIXO_NEOPLASIA = re.compile(
    r"^Neoplasia(s)? maligna(s)?( secundária e não especificada| secundária)?( d[aoe]s?| de)?\s+", re.I)


def topografias(cats, subs4):
    """Linhas (codigo_cid_o, descricao, categoria) da topografia da CID-O-3 a partir das categorias e subcategorias da
    CID-10 (puro: o teste usa amostra sintética)."""
    def sitio(cod):
        return re.fullmatch(r"C([0-7]\d|80)", cod) and cod not in EXCLUIDAS_TOPOGRAFIA

    desc_cat = {c[0]: c[2] for c in cats if sitio(c[0])}
    com_sub = set()
    linhas = {}
    for s in subs4:
        cat = s[0][:3]
        if not sitio(cat):
            continue
        com_sub.add(cat)
        d = _PREFIXO_NEOPLASIA.sub("", s[4]).strip()
        linhas[f"{cat}.{s[0][3]}"] = ((d[:1].upper() + d[1:])[:150], cat)
    for cat, d in desc_cat.items():
        if cat not in com_sub:
            d = _PREFIXO_NEOPLASIA.sub("", d).strip()
            linhas[f"{cat}.9"] = ((d[:1].upper() + d[1:])[:150], cat)
    for cod, d in TOPOGRAFIA_HEMATOPOETICA:
        linhas[cod] = (d, "C42")
    for cod, d in SITIOS_CIDO3.items():
        if cod[:3] in desc_cat:
            linhas[cod] = (d, cod[:3])
    return sorted((c, d, cat) for c, (d, cat) in linhas.items())


def _largura(f):
    """Tamanho da faixa (A00-B99 vale 199), para escolher a faixa mais estreita que contém um código."""
    def n(c):
        return (ord(c[0]) - 65) * 100 + int(c[1:3])
    return n(f[1]) - n(f[0])


def hierarquia(caps, grps):
    """Capítulos e agrupamentos da fonte oficial, com o pai de cada agrupamento (a faixa mais estreita que o contém)
    e a profundidade (0 = grupo; 1 ou mais = subgrupo). Puro: o teste usa uma amostra sintética.
    Devolve (capitulos, faixas, pai_grp, prof); capitulo = (romano, numero, ini, fim, descricao, completa, abrev)."""
    capitulos = []
    for c in caps:
        m = ROMANOS.match(c[3])
        if not m:
            raise RuntimeError(f"cid10: capítulo sem número romano na descrição (linha {c[0]})")
        capitulos.append((m.group(1), int(c[0]), c[1], c[2], m.group(2).strip(), c[3], c[4] or None))
    faixas = [(g[0], g[1], g[2], g[3] or None) for g in grps]
    pai_grp, prof = {}, {}
    for g in faixas:
        cont = [h for h in faixas if h is not g and h[0] <= g[0] and g[1] <= h[1]]
        pai_grp[g[:2]] = min(cont, key=_largura)[:2] if cont else None
        prof[g[:2]] = len(cont)
    for g in faixas:
        cap_ini, cap_fim = capitulo_de(capitulos, g[0])[2:4], capitulo_de(capitulos, g[1])[2:4]
        if cap_ini != cap_fim:
            raise RuntimeError(f"cid10: agrupamento {g[0]}-{g[1]} atravessa capítulos")
    return capitulos, faixas, pai_grp, prof


def capitulo_de(capitulos, cod):
    """O capítulo cuja faixa contém a categoria (3 primeiros caracteres) do código."""
    for cp in capitulos:
        if cp[2] <= cod[:3] <= cp[3]:
            return cp
    raise RuntimeError(f"cid10: código {cod} fora de capítulo")


def grupo_de(faixas, cod):
    """A faixa mais estreita (grupo ou subgrupo) que contém o código, ou None."""
    cont = [g for g in faixas if _contem(g, cod)]
    return min(cont, key=_largura)[:2] if cont else None


def nivel_agrupamento(pai_grp, faixa):
    """'subgrupo' quando a faixa está dentro de outra; senão 'grupo' (CHECK ck_agrupamento_cid10_nivel)."""
    return "subgrupo" if pai_grp[faixa[:2]] else "grupo"
