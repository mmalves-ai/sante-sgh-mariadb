"""Carregador da tabela unificada de procedimentos do SUS a partir do pacote oficial do DATASUS (F1.4).

Fonte: catalogos/cache/sigtap/TabelaUnificada_<AAAAMM>_v<AAMMDDhhmm>.zip (o mais recente), arquivos de posição
fixa em cp1252 (superconjunto do latin-1: travessão e aspas curvas em 0x80-0x9F; byte sem
mapeamento no cp1252 cai para latin-1 só nele). Versão: a competência AAAAMM do registro.tsv (igual à do nome do pacote).

Grava (vigência = primeiro dia da competência do pacote; versao_fonte = competência):
- competencia_sigtap (uma por pacote; marca a carregada como vigente);
- dominio_sigtap: modalidade, complexidade, financiamento, instrumento_registro, tipo_leito, rubrica,
  regra_condicionada;
- grupo_sigtap (grupo, subgrupo, forma de organização), habilitacao_sigtap (habilitação e grupo),
  servico_classificacao_sigtap, ocupacao_cbo;
- procedimento_sigtap (com a descrição detalhada) e as relações: valor, registro, atributo (modalidade e
  regra condicionada), cbo, cid (CID-10 já carregada em termo_terminologia), habilitação, incremento,
  serviço, compatibilidade e OPM.

Regras de leitura (documentadas no pacote ou no leiaute do DATASUS):
- valores (VL_SH, VL_SA, VL_SP) e percentuais de incremento têm 2 casas decimais implícitas;
- idade mínima e máxima em meses; 9999 = não se aplica (LEIA_ME e leiaute) e vira nulo; permanência e quantidade
  máxima 9999 também (nada de sentinela no modelo);
- sexo: M masculino, F feminino, I ambos, N não se aplica;
- complexidade: 0 não se aplica, 1 atenção básica, 2 média, 3 alta (o pacote não traz tabela própria);
- CID: ST_PRINCIPAL S = principal, N = secundário;
- TP_COMPATIBILIDADE: o leiaute oficial documenta só 1 compatível, 2 incompatível/excludente e 3 concomitante;
  4 e 5 não são gravados até haver fonte oficial (pendência em AVISOS).
Troca de competência: as linhas de vigência aberta de competências anteriores ganham vigencia_fim = véspera da
nova; procedimento ausente do pacote fica ativo = FALSE; vigencia_inicio de procedimento existente é preservada;
a competência anterior fica 'substituida'.
O que não tem destino no modelo fica fora e é devolvido em AVISOS (ver carregar()).
"""
import codecs
import re
import subprocess
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PASTA = RAIZ / "catalogos/cache/sigtap"
LOTE = 1000
AVISOS = []

# Só os tipos documentados no leiaute oficial do pacote; 4 e 5 ficam pendentes de fonte oficial.
TIPO_COMPAT = {"1": "compativel", "2": "incompativel", "3": "concomitante"}
_FORA_CP1252 = [0]


def _resto_latin1(e):
    _FORA_CP1252[0] += e.end - e.start
    return e.object[e.start:e.end].decode("latin-1"), e.end


codecs.register_error("sigtap_latin1", _resto_latin1)
SEXO = {"M": "masculino", "F": "feminino", "I": "ambos", "N": "nao_se_aplica"}
COMPLEXIDADE = [("0", "NA", "Não se aplica"), ("1", "AB", "Atenção básica"),
                ("2", "MC", "Média complexidade"), ("3", "AC", "Alta complexidade")]

# leiautes (início, fim) 1-based, da fatia
LEI = {
    "tb_grupo": {"grupo": (1, 2), "nome": (3, 102), "comp": (103, 108)},
    "tb_sub_grupo": {"grupo": (1, 2), "sub": (3, 4), "nome": (5, 104), "comp": (105, 110)},
    "tb_forma_organizacao": {"grupo": (1, 2), "sub": (3, 4), "forma": (5, 6), "nome": (7, 106), "comp": (107, 112)},
    "tb_modalidade": {"cod": (1, 2), "nome": (3, 102), "comp": (103, 108)},
    "tb_financiamento": {"cod": (1, 2), "nome": (3, 102), "comp": (103, 108)},
    "tb_registro": {"cod": (1, 2), "nome": (3, 52), "comp": (53, 58)},
    "tb_tipo_leito": {"cod": (1, 2), "nome": (3, 62), "comp": (63, 68)},
    "tb_rubrica": {"cod": (1, 6), "nome": (7, 106), "comp": (107, 112)},
    "tb_regra_condicionada": {"cod": (1, 4), "nome": (5, 154), "desc": (155, 4154)},
    "tb_habilitacao": {"cod": (1, 4), "nome": (5, 154), "comp": (155, 160)},
    "tb_grupo_habilitacao": {"cod": (1, 4), "nome": (5, 24), "desc": (25, 274)},
    "tb_servico": {"cod": (1, 3), "nome": (4, 123), "comp": (124, 129)},
    "tb_servico_classificacao": {"serv": (1, 3), "cla": (4, 6), "nome": (7, 156), "comp": (157, 162)},
    "tb_ocupacao": {"cod": (1, 6), "nome": (7, 156)},
    "tb_descricao": {"proc": (1, 10), "desc": (11, 4010), "comp": (4011, 4016)},
    "tb_procedimento": {"proc": (1, 10), "nome": (11, 260), "cplx": (261, 261), "sexo": (262, 262),
                        "qt": (263, 266), "perm": (267, 270), "pontos": (271, 274), "idmin": (275, 278),
                        "idmax": (279, 282), "sh": (283, 294), "sa": (295, 306), "sp": (307, 318),
                        "fin": (319, 320), "rub": (321, 326), "tempo": (327, 330), "comp": (331, 336)},
    "rl_procedimento_registro": {"proc": (1, 10), "reg": (11, 12), "comp": (13, 18)},
    "rl_procedimento_modalidade": {"proc": (1, 10), "mod": (11, 12), "comp": (13, 18)},
    "rl_procedimento_regra_cond": {"proc": (1, 10), "regra": (11, 14)},
    "rl_procedimento_ocupacao": {"proc": (1, 10), "cbo": (11, 16), "comp": (17, 22)},
    "rl_procedimento_cid": {"proc": (1, 10), "cid": (11, 14), "st": (15, 15), "comp": (16, 21)},
    "rl_procedimento_habilitacao": {"proc": (1, 10), "hab": (11, 14), "grp": (15, 18), "comp": (19, 24)},
    "rl_procedimento_incremento": {"proc": (1, 10), "hab": (11, 14), "sh": (15, 21), "sa": (22, 28),
                                   "sp": (29, 35), "comp": (36, 41)},
    "rl_procedimento_servico": {"proc": (1, 10), "serv": (11, 13), "cla": (14, 16), "comp": (17, 22)},
    "rl_procedimento_compativel": {"pri": (1, 10), "rpri": (11, 12), "com": (13, 22), "rcom": (23, 24),
                                   "tp": (25, 25), "qt": (26, 29), "comp": (30, 35)},
}

SEM_DESTINO = {
    "rl_excecao_compatibilidade": "exceção de compatibilidade (procedimento que nega um par compatível) sem tabela no modelo",
    "rl_procedimento_detalhe": "detalhe do procedimento: a lista 'detalhe' não existe no CHECK de dominio_sigtap.lista",
    "tb_detalhe": "idem (lista de detalhes)",
    "tb_descricao_detalhe": "idem (texto dos detalhes)",
    "rl_procedimento_leito": "especialidade_leito (tabela do cadastro de estabelecimentos, fora da fatia) está vazia; "
                             "tipos de leito carregados só em dominio_sigtap",
    "rl_procedimento_origem": "procedimento de origem: valor seria outro procedimento, não um domínio",
    "rl_procedimento_sia_sih": "de-para com a tabela antiga SIA/SIH sem tabela no modelo",
    "tb_sia_sih": "idem",
    "rl_procedimento_renases": "RENASES sem tabela no modelo",
    "tb_renases": "idem",
    "rl_procedimento_comp_rede": "componente de rede de atenção sem tabela no modelo",
    "tb_componente_rede": "idem",
    "tb_rede_atencao": "idem",
    "rl_procedimento_tuss": "arquivo vazio no pacote; TUSS vem da fonte própria",
    "tb_tuss": "TUSS vem da fonte oficial própria, não do pacote do SUS",
    "tb_cid": "CID-10 já carregada pelo carregador cid10 em termo_terminologia",
}


def _sql(banco, entrada, *args):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco] + list(args),
                       input=entrada, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"sigtap: erro no SQL: {r.stderr.strip()[:500]}")
    return r.stdout


def _consulta(banco, q):
    saida = _sql(banco, q, "-N", "-B")
    return [ln.split("\t") for ln in saida.splitlines() if ln]


class _Raw:
    def __init__(self, s):
        self.s = s


AGORA = _Raw("UTC_TIMESTAMP(3)")


def _q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, _Raw):
        return v.s
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def _upsert(banco, tabela, colunas, linhas, atualizar, antes=()):
    if not linhas:
        return
    upd = ", ".join(list(antes) + [f"{c} = VALUES({c})" for c in atualizar]) + ", alterado_em = UTC_TIMESTAMP(3)"
    partes = []
    for i in range(0, len(linhas), LOTE):
        vals = ",\n".join("(" + ", ".join(_q(v) for v in ln) + ")" for ln in linhas[i:i + LOTE])
        partes.append(f"INSERT INTO {tabela} ({', '.join(colunas)}) VALUES\n{vals}\n"
                      f"ON DUPLICATE KEY UPDATE {upd};")
    _sql(banco, "SET NAMES utf8mb4;\n" + "\n".join(partes))


def _pacote():
    zips = sorted(PASTA.glob("TabelaUnificada_*.zip"))
    if not zips:
        raise RuntimeError("sigtap: nenhum pacote em catalogos/cache/sigtap/")
    z = zips[-1]
    m = re.match(r"TabelaUnificada_(\d{6})_v(\d{2})(\d{2})(\d{2})", z.name)
    if not m:
        raise RuntimeError(f"sigtap: nome de pacote inesperado: {z.name}")
    comp = m.group(1)
    for ln in (RAIZ / "catalogos/cache/registro.tsv").read_text(encoding="utf-8").splitlines():
        c = ln.split("\t")
        if c and c[0] == "sigtap" and c[2].endswith(z.name) and c[6] != comp:
            raise RuntimeError("sigtap: competência do registro.tsv difere da do pacote")
    publicado = f"20{m.group(2)}-{m.group(3)}-{m.group(4)}"
    return z, comp, publicado


def _ler(zf, nome):
    """Lê um arquivo de posição fixa e devolve dicionários com os campos do leiaute (texto aparado)."""
    lei = LEI[nome]
    texto = zf.read(nome + ".txt").decode("cp1252", errors="sigtap_latin1")
    saida = []
    for ln in texto.split("\n"):
        ln = ln.rstrip("\r")
        if not ln.strip():
            continue
        saida.append({k: ln[a - 1:b].strip() for k, (a, b) in lei.items()})
    return saida


def _int(s, nulo9999=False):
    if not s:
        return None
    v = int(s)
    return None if nulo9999 and v == 9999 else v


def _dec(s):
    return round(int(s or "0") / 100, 2)


def _ids(banco, q):
    return {tuple(r[:-1]) if len(r) > 2 else r[0]: int(r[-1]) for r in _consulta(banco, q)}


def carregar(banco: str) -> dict:
    AVISOS.clear()
    _FORA_CP1252[0] = 0
    z, comp, publicado = _pacote()
    vig = f"{comp[:4]}-{comp[4:]}-01"
    ver = comp
    mais_nova = _consulta(banco, f"SELECT MAX(codigo_competencia) FROM competencia_sigtap "
                                 f"WHERE situacao_carga IN ('carregada', 'substituida') AND codigo_competencia > '{comp}'")
    if mais_nova and mais_nova[0][0] not in (None, "NULL"):
        raise RuntimeError(f"sigtap: competência {mais_nova[0][0]} já carregada é mais nova que a do pacote ({comp})")
    with zipfile.ZipFile(z) as zf:
        nomes = {n[:-4] for n in zf.namelist() if n.endswith(".txt") and not n.endswith("_layout.txt")}
        d = {n: _ler(zf, n) for n in LEI}
    if _FORA_CP1252[0]:
        AVISOS.append(f"{_FORA_CP1252[0]} bytes sem mapeamento no cp1252 lidos como latin-1")
    for n in sorted(nomes - set(LEI)):
        if n in SEM_DESTINO:
            AVISOS.append(f"{n}: não carregado — {SEM_DESTINO[n]}")
        elif n not in ("LEIA_ME", "layout"):
            AVISOS.append(f"{n}: arquivo sem destino definido no carregador")
    outras = sorted({r["comp"] for n, rs in d.items() for r in rs if "comp" in r and r["comp"]} - {comp})
    if outras:
        AVISOS.append(f"linhas com competência diferente da do pacote ({', '.join(outras)}): gravadas com a do pacote")

    # ---------- competência ----------
    _upsert(banco, "competencia_sigtap",
            ["codigo_competencia", "descricao", "data_publicacao", "vigencia_inicio", "versao_fonte",
             "situacao_carga", "vigente", "criado_em", "versao"],
            [[comp, f"Tabela unificada, competência {comp[4:]}/{comp[:4]} ({z.name})", publicado, vig, ver,
              "carregando", False, AGORA, 1]],
            ["descricao", "data_publicacao", "versao_fonte", "situacao_carga"])

    # ---------- domínios ----------
    dom = []
    cols_dom = ["lista", "codigo_sigtap", "sigla", "descricao", "detalhe", "vigencia_inicio", "versao_fonte",
                "criado_em", "versao"]
    for lista, arq in [("modalidade", "tb_modalidade"), ("financiamento", "tb_financiamento"),
                       ("instrumento_registro", "tb_registro"), ("tipo_leito", "tb_tipo_leito"),
                       ("rubrica", "tb_rubrica")]:
        dom += [[lista, r["cod"], None, r["nome"], None, vig, ver, AGORA, 1] for r in d[arq]]
    dom += [["regra_condicionada", r["cod"], None, r["nome"], r["desc"] or None, vig, ver, AGORA, 1]
            for r in d["tb_regra_condicionada"]]
    dom += [["complexidade", c, s, n, None, vig, ver, AGORA, 1] for c, s, n in COMPLEXIDADE]
    _upsert(banco, "dominio_sigtap", cols_dom, dom, ["sigla", "descricao", "detalhe", "versao_fonte"])
    did = _ids(banco, f"SELECT lista, codigo_sigtap, id FROM dominio_sigtap WHERE vigencia_inicio = '{vig}'")

    # ---------- grupos (grupo > subgrupo > forma) ----------
    cols_g = ["nivel", "codigo_sigtap", "pai_grupo_sigtap_id", "descricao", "vigencia_inicio", "versao_fonte",
              "criado_em", "versao"]
    upd_g = ["nivel", "pai_grupo_sigtap_id", "descricao", "versao_fonte"]
    q_g = f"SELECT codigo_sigtap, id FROM grupo_sigtap WHERE vigencia_inicio = '{vig}'"
    _upsert(banco, "grupo_sigtap", cols_g,
            [["grupo", r["grupo"], None, r["nome"], vig, ver, AGORA, 1] for r in d["tb_grupo"]], upd_g)
    gid = _ids(banco, q_g)
    _upsert(banco, "grupo_sigtap", cols_g,
            [["subgrupo", r["grupo"] + r["sub"], gid[r["grupo"]], r["nome"], vig, ver, AGORA, 1]
             for r in d["tb_sub_grupo"]], upd_g)
    gid = _ids(banco, q_g)
    _upsert(banco, "grupo_sigtap", cols_g,
            [["forma_organizacao", r["grupo"] + r["sub"] + r["forma"], gid[r["grupo"] + r["sub"]], r["nome"],
              vig, ver, AGORA, 1] for r in d["tb_forma_organizacao"]], upd_g)
    gid = _ids(banco, q_g)

    # ---------- habilitações ----------
    cols_h = ["tipo", "codigo_habilitacao", "descricao", "detalhe", "vigencia_inicio", "versao_fonte",
              "criado_em", "versao"]
    hab = [["habilitacao", r["cod"], r["nome"], None, vig, ver, AGORA, 1] for r in d["tb_habilitacao"]]
    hab += [["grupo_habilitacao", r["cod"], r["desc"] or r["nome"], r["nome"] if r["desc"] else None,
             vig, ver, AGORA, 1] for r in d["tb_grupo_habilitacao"]]
    _upsert(banco, "habilitacao_sigtap", cols_h, hab, ["descricao", "detalhe", "versao_fonte"])
    hid = _ids(banco, f"SELECT codigo_habilitacao, id FROM habilitacao_sigtap "
                      f"WHERE tipo = 'habilitacao' AND vigencia_inicio = '{vig}'")

    # ---------- serviço / classificação ----------
    nserv = {r["cod"]: r["nome"] for r in d["tb_servico"]}
    _upsert(banco, "servico_classificacao_sigtap",
            ["codigo_sigtap_servico", "descricao_servico", "codigo_sigtap_classificacao", "descricao",
             "vigencia_inicio", "versao_fonte", "criado_em", "versao"],
            [[r["serv"], nserv.get(r["serv"]) or r["serv"], r["cla"], r["nome"], vig, ver, AGORA, 1]
             for r in d["tb_servico_classificacao"]],
            ["descricao_servico", "descricao", "versao_fonte"])
    sid = _ids(banco, f"SELECT codigo_sigtap_servico, codigo_sigtap_classificacao, id "
                      f"FROM servico_classificacao_sigtap WHERE vigencia_inicio = '{vig}'")

    # ---------- ocupações (CBO) ----------
    cbo_uso = {r["cbo"] for r in d["rl_procedimento_ocupacao"]}
    _upsert(banco, "ocupacao_cbo",
            ["codigo_cbo", "descricao", "familia_cbo", "area_saude", "versao_fonte", "criado_em", "versao"],
            [[r["cod"], r["nome"], r["cod"][:4], r["cod"] in cbo_uso, ver, AGORA, 1] for r in d["tb_ocupacao"]],
            ["descricao", "familia_cbo", "area_saude", "versao_fonte"])
    oid = _ids(banco, "SELECT codigo_cbo, id FROM ocupacao_cbo")

    # ---------- procedimentos ----------
    desc_det = {r["proc"]: r["desc"] for r in d["tb_descricao"] if r["desc"]}
    procs = []
    for r in d["tb_procedimento"]:
        c = r["proc"]
        procs.append([c, r["nome"], desc_det.get(c), gid[c[:6]], SEXO[r["sexo"]],
                      _int(r["idmin"], True), _int(r["idmax"], True), _int(r["qt"], True), _int(r["perm"], True),
                      _int(r["pontos"]), did[("complexidade", r["cplx"])],
                      did[("financiamento", r["fin"])] if r["fin"] else None,
                      did[("rubrica", r["rub"])] if r["rub"] else None,
                      c.startswith("07"), vig, ver, True, AGORA, 1])
    _upsert(banco, "procedimento_sigtap",
            ["codigo_sigtap", "descricao", "descricao_detalhada", "grupo_sigtap_id", "sexo", "idade_minima_meses",
             "idade_maxima_meses", "quantidade_maxima", "permanencia_dias", "pontos",
             "complexidade_dominio_sigtap_id", "financiamento_dominio_sigtap_id", "rubrica_dominio_sigtap_id",
             "ortese_protese", "vigencia_inicio", "versao_fonte", "ativo", "criado_em", "versao"],
            procs,
            ["descricao", "descricao_detalhada", "grupo_sigtap_id", "sexo", "idade_minima_meses",
             "idade_maxima_meses", "quantidade_maxima", "permanencia_dias", "pontos",
             "complexidade_dominio_sigtap_id", "financiamento_dominio_sigtap_id", "rubrica_dominio_sigtap_id",
             "ortese_protese", "versao_fonte", "ativo"],
            # vigencia_inicio só muda na reativação de um procedimento que tinha saído do pacote
            antes=["vigencia_inicio = IF(ativo, vigencia_inicio, VALUES(vigencia_inicio))",
                   "vigencia_fim = IF(ativo, vigencia_fim, NULL)"])
    pid = _ids(banco, "SELECT codigo_sigtap, id FROM procedimento_sigtap")
    AVISOS.append("procedimento_sigtap: subtipo de financiamento e ato anestésico não vêm no pacote; "
                  "QT_TEMPO_PERMANENCIA sem coluna; idade, permanência e quantidade máxima 9999 = nulo; "
                  "ortese_protese = grupo 07")

    falta = {}

    def p(c, onde):
        if c not in pid:
            falta[onde] = falta.get(onde, 0) + 1
            return None
        return pid[c]

    tail = [vig, ver, AGORA, 1]
    base = ["vigencia_inicio", "versao_fonte", "criado_em", "versao"]

    # valores
    val = []
    for r in d["tb_procedimento"]:
        sh, sa, sp = _dec(r["sh"]), _dec(r["sa"]), _dec(r["sp"])
        val.append([pid[r["proc"]], sh, sp, sa, round(sh + sp, 2), sa] + tail)
    _upsert(banco, "procedimento_sigtap_valor",
            ["procedimento_sigtap_id", "valor_servico_hospitalar", "valor_servico_profissional",
             "valor_servico_ambulatorial", "valor_total_hospitalar", "valor_total_ambulatorial"] + base, val,
            ["valor_servico_hospitalar", "valor_servico_profissional", "valor_servico_ambulatorial",
             "valor_total_hospitalar", "valor_total_ambulatorial", "versao_fonte"])

    # instrumentos de registro
    reg = {}
    for r in d["rl_procedimento_registro"]:
        i = p(r["proc"], "registro")
        if i:
            reg[(i, did[("instrumento_registro", r["reg"])])] = None
    _upsert(banco, "procedimento_sigtap_registro",
            ["procedimento_sigtap_id", "instrumento_dominio_sigtap_id", "complementar"] + base,
            [[a, b, False] + tail for a, b in reg], ["versao_fonte"])

    # atributos: modalidade e regra condicionada
    atr = {}
    for r in d["rl_procedimento_modalidade"]:
        i = p(r["proc"], "modalidade")
        if i:
            atr[(i, "modalidade", did[("modalidade", r["mod"])])] = None
    for r in d["rl_procedimento_regra_cond"]:
        i = p(r["proc"], "regra_condicionada")
        if i:
            atr[(i, "regra_condicionada", did[("regra_condicionada", r["regra"])])] = None
    _upsert(banco, "procedimento_sigtap_atributo",
            ["procedimento_sigtap_id", "tipo_atributo", "valor_dominio_sigtap_id"] + base,
            [list(k) + tail for k in atr], ["versao_fonte"])

    # CBO
    cbo, sem_cbo = {}, 0
    for r in d["rl_procedimento_ocupacao"]:
        i = p(r["proc"], "cbo")
        if i and r["cbo"] in oid:
            cbo[(i, oid[r["cbo"]])] = None
        elif i:
            sem_cbo += 1
    _upsert(banco, "procedimento_sigtap_cbo", ["procedimento_sigtap_id", "ocupacao_cbo_id"] + base,
            [list(k) + tail for k in cbo], ["versao_fonte"])
    if sem_cbo:
        AVISOS.append(f"procedimento_sigtap_cbo: {sem_cbo} vínculos com CBO ausente de tb_ocupacao ignorados")

    # CID (CID-10 da terminologia 'cid10')
    cid = _ids(banco, "SELECT tt.codigo_termo, MIN(tt.id) FROM termo_terminologia tt "
                      "JOIN terminologia t ON t.id = tt.terminologia_id WHERE t.codigo = 'cid10' "
                      "GROUP BY tt.codigo_termo")
    if not cid:
        raise RuntimeError("sigtap: CID-10 ausente de termo_terminologia; rode o carregador cid10 antes")
    pc, sem_cid, perdidos_cid = {}, set(), 0
    for r in d["rl_procedimento_cid"]:
        i = p(r["proc"], "cid")
        if not i:
            continue
        if r["cid"] not in cid:
            sem_cid.add(r["cid"])
            perdidos_cid += 1
            continue
        k = (i, cid[r["cid"]])
        pri, sec = pc.get(k, (False, False))
        pc[k] = (pri or r["st"] == "S", sec or r["st"] != "S")
    _upsert(banco, "procedimento_sigtap_cid",
            ["procedimento_sigtap_id", "cid_termo_terminologia_id", "principal", "secundario", "padrao"] + base,
            [[a, b, pr, se, False] + tail for (a, b), (pr, se) in pc.items()],
            ["principal", "secundario", "versao_fonte"])
    if sem_cid:
        AVISOS.append(f"procedimento_sigtap_cid: {perdidos_cid} vínculos ignorados por {len(sem_cid)} códigos CID "
                      f"ausentes da CID-10 carregada ({', '.join(sorted(sem_cid))}); levar ao carregador cid10 "
                      f"(atualizações da OMS posteriores a 2016, como N18.x)")

    # habilitações exigidas
    ph, rep = {}, 0
    for r in d["rl_procedimento_habilitacao"]:
        i = p(r["proc"], "habilitacao")
        if i:
            k = (i, hid[r["hab"]])
            if k in ph:
                rep += 1
                ph[k] = ph[k] or r["grp"] or None
            else:
                ph[k] = r["grp"] or None
    if rep:
        AVISOS.append(f"procedimento_sigtap_habilitacao: {rep} linhas repetem (procedimento, habilitação) em outro "
                      f"grupo de habilitação; a chave única do modelo guarda um só grupo por par")
    _upsert(banco, "procedimento_sigtap_habilitacao",
            ["procedimento_sigtap_id", "habilitacao_sigtap_id", "grupo_habilitacao"] + base,
            [[a, b, g] + tail for (a, b), g in ph.items()], ["grupo_habilitacao", "versao_fonte"])

    # incremento por habilitação
    inc = {}
    for r in d["rl_procedimento_incremento"]:
        i = p(r["proc"], "incremento")
        if i:
            inc[(i, hid[r["hab"]])] = (_dec(r["sh"]), _dec(r["sp"]), _dec(r["sa"]))
    _upsert(banco, "procedimento_sigtap_incremento",
            ["procedimento_sigtap_id", "habilitacao_sigtap_id", "percentual_servico_hospitalar",
             "percentual_servico_profissional", "percentual_servico_ambulatorial"] + base,
            [[a, b, sh, sp, sa] + tail for (a, b), (sh, sp, sa) in inc.items()],
            ["percentual_servico_hospitalar", "percentual_servico_profissional",
             "percentual_servico_ambulatorial", "versao_fonte"])

    # serviço / classificação exigidos
    ps = {}
    for r in d["rl_procedimento_servico"]:
        i = p(r["proc"], "servico")
        if i:
            ps[(i, sid[(r["serv"], r["cla"])])] = None
    _upsert(banco, "procedimento_sigtap_servico",
            ["procedimento_sigtap_id", "servico_classificacao_sigtap_id"] + base,
            [list(k) + tail for k in ps], ["versao_fonte"])

    # compatibilidades e OPM
    cp, opm, auto, sem_tipo = {}, {}, 0, {}
    for r in d["rl_procedimento_compativel"]:
        if r["tp"] not in TIPO_COMPAT:
            sem_tipo[r["tp"]] = sem_tipo.get(r["tp"], 0) + 1
            continue
        a, b = p(r["pri"], "compatibilidade"), p(r["com"], "compatibilidade")
        if not (a and b):
            continue
        if a == b:
            auto += 1
            continue
        tp = TIPO_COMPAT[r["tp"]]
        ia, ib = did[("instrumento_registro", r["rpri"])], did[("instrumento_registro", r["rcom"])]
        qt = _int(r["qt"])
        cp[(a, b, tp, ia, ib)] = qt
        if r["com"].startswith("07") and tp in ("compativel", "incompativel", "concomitante"):
            o = opm.get((a, b))
            if o is None:
                opm[(a, b)] = [qt, ia, ib, tp]
            else:
                qs = [x for x in (o[0], qt) if x is not None]
                o[0] = max(qs) if qs else None
                o[1] = o[1] if o[1] == ia else None
                o[2] = o[2] if o[2] == ib else None
                o[3] = o[3] if o[3] == tp else "compativel"
    _upsert(banco, "compatibilidade_sigtap",
            ["principal_procedimento_sigtap_id", "compativel_procedimento_sigtap_id", "tipo_compatibilidade",
             "principal_instrumento_dominio_sigtap_id", "compativel_instrumento_dominio_sigtap_id",
             "quantidade_maxima"] + base,
            [list(k) + [q] + tail for k, q in cp.items()], ["quantidade_maxima", "versao_fonte"])
    _upsert(banco, "procedimento_sigtap_opm",
            ["procedimento_sigtap_id", "opm_procedimento_sigtap_id", "quantidade_maxima",
             "instrumento_procedimento_dominio_sigtap_id", "instrumento_opm_dominio_sigtap_id",
             "tipo_compatibilidade"] + base,
            [[a, b] + o + tail for (a, b), o in opm.items()],
            ["quantidade_maxima", "instrumento_procedimento_dominio_sigtap_id", "instrumento_opm_dominio_sigtap_id",
             "tipo_compatibilidade", "versao_fonte"])
    # tipos sem significado oficial gravados por cargas anteriores saem desta competência
    _sql(banco, f"DELETE FROM compatibilidade_sigtap WHERE vigencia_inicio = '{vig}' "
                f"AND tipo_compatibilidade NOT IN ('compativel', 'incompativel', 'concomitante');")
    if sem_tipo:
        AVISOS.append("compatibilidade_sigtap: PENDENTE — TP_COMPATIBILIDADE sem significado no leiaute oficial "
                      "(só 1 compatível, 2 incompatível/excludente, 3 concomitante), linhas não gravadas: "
                      + ", ".join(f"tipo {t} = {n}" for t, n in sorted(sem_tipo.items()))
                      + "; confirmar em fonte oficial do DATASUS ou decisão do dono")
    AVISOS.append("compatibilidade_sigtap: TP_COMPATIBILIDADE 1..3 conforme o leiaute oficial; procedimento_sigtap_opm = pares cujo secundário é do grupo 07 (quantidade máxima "
                  "= maior entre instrumentos; instrumento nulo quando varia)")
    if auto:
        AVISOS.append(f"compatibilidade_sigtap: {auto} pares do procedimento com ele mesmo ignorados (CHECK distintos)")
    AVISOS.append("procedimento_sigtap_leito e equivalencia_sigtap_item: sem carga (leito depende de "
                  "especialidade_leito; equivalência é de-para do hospital, não catálogo)")
    for onde, n in sorted(falta.items()):
        AVISOS.append(f"{onde}: {n} linhas com procedimento ausente de tb_procedimento ignoradas")

    # ---------- fecha a vigência da competência anterior ----------
    vespera = f"DATE_SUB('{vig}', INTERVAL 1 DAY)"
    com_vig = ["dominio_sigtap", "grupo_sigtap", "habilitacao_sigtap", "servico_classificacao_sigtap",
               "procedimento_sigtap_valor", "procedimento_sigtap_registro", "procedimento_sigtap_atributo",
               "procedimento_sigtap_cbo", "procedimento_sigtap_cid", "procedimento_sigtap_habilitacao",
               "procedimento_sigtap_incremento", "procedimento_sigtap_servico", "compatibilidade_sigtap",
               "procedimento_sigtap_opm"]
    _sql(banco, "\n".join(f"UPDATE {t} SET vigencia_fim = {vespera}, alterado_em = UTC_TIMESTAMP(3) "
                          f"WHERE vigencia_fim IS NULL AND vigencia_inicio < '{vig}';" for t in com_vig)
         + f"\nUPDATE procedimento_sigtap SET ativo = FALSE, vigencia_fim = {vespera}, alterado_em = UTC_TIMESTAMP(3) "
           f"WHERE ativo AND NOT item_hospital AND versao_fonte <> '{ver}';"
         + f"\nUPDATE competencia_sigtap SET situacao_carga = 'substituida', vigencia_fim = {vespera}, "
           f"alterado_em = UTC_TIMESTAMP(3) WHERE codigo_competencia < '{comp}' AND situacao_carga = 'carregada';")
    inativos = _consulta(banco, f"SELECT COUNT(*) FROM procedimento_sigtap WHERE NOT ativo AND versao_fonte <> '{ver}'")
    if inativos and int(inativos[0][0]):
        AVISOS.append(f"procedimento_sigtap: {inativos[0][0]} procedimentos ausentes do pacote {comp} inativos")

    # ---------- fecha a competência ----------
    _sql(banco, f"UPDATE competencia_sigtap SET situacao_carga = 'carregada', carregada_em = UTC_TIMESTAMP(3), "
                f"quantidade_procedimentos = {len(procs)}, alterado_em = UTC_TIMESTAMP(3) "
                f"WHERE codigo_competencia = '{comp}';\n"
                f"UPDATE competencia_sigtap SET vigente = (codigo_competencia = '{comp}') "
                f"WHERE vigente <> (codigo_competencia = '{comp}');")

    tabelas = ["competencia_sigtap", "dominio_sigtap", "grupo_sigtap", "habilitacao_sigtap",
               "servico_classificacao_sigtap", "ocupacao_cbo", "procedimento_sigtap", "procedimento_sigtap_valor",
               "procedimento_sigtap_registro", "procedimento_sigtap_atributo", "procedimento_sigtap_cbo",
               "procedimento_sigtap_cid", "procedimento_sigtap_habilitacao", "procedimento_sigtap_incremento",
               "procedimento_sigtap_servico", "compatibilidade_sigtap", "procedimento_sigtap_opm",
               "procedimento_sigtap_leito", "equivalencia_sigtap_item"]
    q = " UNION ALL ".join(f"SELECT '{t}', COUNT(*) FROM {t}" for t in tabelas)
    return {t: int(n) for t, n in _consulta(banco, q)}
