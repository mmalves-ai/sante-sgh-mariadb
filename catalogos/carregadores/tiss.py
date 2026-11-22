"""Carregador das terminologias do padrão TISS (ANS, componente de Representação de Conceitos em Saúde: planilha
"TUSS - Demais terminologias - VERSÃO AAAAMM.xlsx", tabelas de domínio 23 a 87). Fonte PÚBLICA e oficial: nunca a
cópia do cliente.

Fonte: catalogos/cache/tiss/<arquivo .xlsx>, registrada por `python3 -I catalogos/baixar.py --registrar tiss <xlsx>
<AAAAMM>`. A planilha vem dentro do pacote "Padrao_TISS_Representacao_de_Conceitos_em_Saude_AAAAMM.zip" da página do
padrão TISS na ANS (o pacote tem cerca de 400 MB e o endereço muda a cada versão; só a planilha das demais
terminologias, menos de 1 MB, é guardada).

Destino (idempotente; rodar de novo não duplica):
- terminologia (uma por tabela, codigo tiss_<n>, tipo dominio_tiss) + terminologia_edicao (uma por versão) e
  termo_terminologia (todos os termos de cada tabela, com a vigência da planilha);
- carater_atendimento_tiss (tabela 23: caráter do atendimento; código 2 é urgência/emergência);
- conselho_classe (tabela 26: conselho profissional; a sigla é a que a ANS põe entre parênteses no termo; "Outros
  Conselhos", sem sigla oficial, fica com a sigla OUTROS).
Linha sem código ou sem termo fica de fora (aviso com o número da linha); vigência com fim antes do início fica sem fim
(aviso). Lida só com a biblioteca padrão (zipfile + XML).
"""
import datetime
import hashlib
import re
import subprocess
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
REGISTRO = RAIZ / "catalogos/cache/registro.tsv"
FONTE = "tiss"
URL = "https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss"
ORGAO = "Agência Nacional de Saúde Suplementar (ANS), padrão TISS"
LOTE = 500
AVISOS = []
_M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_EXCEL_ZERO = datetime.date(1899, 12, 30)
SIGLA_SEM_OFICIAL = {"10": "OUTROS"}


def _col(ref):
    return re.match(r"[A-Z]+", ref).group(0)


def _data(v):
    """Data da planilha: número serial do Excel ou texto DD/MM/AAAA; vazio ou inválido: None."""
    v = (v or "").strip()
    if not v:
        return None
    try:
        return (_EXCEL_ZERO + datetime.timedelta(days=int(float(v)))).isoformat()
    except (ValueError, OverflowError):
        pass
    try:
        return datetime.datetime.strptime(v, "%d/%m/%Y").date().isoformat()
    except ValueError:
        return None


def _sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def _planilhas(arquivo):
    """{nome da aba: [linhas como {coluna: texto}]}."""
    z = zipfile.ZipFile(arquivo)
    nomes = set(z.namelist())
    textos = []
    if "xl/sharedStrings.xml" in nomes:
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(_M + "si"):
            textos.append("".join(t.text or "" for t in si.iter(_M + "t")))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")).iter(_REL + "Relationship")}
    abas = {}
    for s in ET.fromstring(z.read("xl/workbook.xml")).iter(_M + "sheet"):
        alvo = rels[s.get(_R + "id")].lstrip("/")
        alvo = alvo if alvo.startswith("xl/") else "xl/" + alvo
        linhas = []
        for row in ET.fromstring(z.read(alvo)).iter(_M + "row"):
            celulas = {}
            for c in row.findall(_M + "c"):
                v, inl = c.find(_M + "v"), c.find(_M + "is")
                if c.get("t") == "s" and v is not None:
                    x = textos[int(v.text)]
                elif inl is not None:
                    x = "".join(t.text or "" for t in inl.iter(_M + "t"))
                else:
                    x = v.text if v is not None else ""
                celulas[_col(c.get("r"))] = (x or "").strip()
            linhas.append(celulas)
        abas[s.get("name")] = linhas
    return abas


def ler(arquivo):
    """({número da tabela: {"nome": ..., "termos": [(codigo, termo, vigencia_inicio, vigencia_fim)]}}, avisos)."""
    tabelas, avisos = {}, []
    for aba, linhas in _planilhas(arquivo).items():
        m = re.fullmatch(r"Tab\s*(\d+)", aba.strip())
        if not m:
            continue
        num = str(int(m.group(1)))
        nome, cab, termos, vistos = None, None, [], set()
        for n, cel in enumerate(linhas, 1):
            a = cel.get("A", "")
            if nome is None and re.match(r"Tabela\s+\d+", a):
                nome = re.sub(r"^Tabela\s+\d+\s*[-–]\s*", "", a).strip()
                continue
            if cab is None:
                if _sem_acento(a).startswith("codigo do termo"):
                    cab = {_sem_acento(v): k for k, v in cel.items() if v}
                continue
            col_termo = cab.get("termo") or next((k for h, k in cab.items() if h.startswith("termo")
                                                  or h.startswith("descricao")), "B")
            col_ini = next((k for h, k in cab.items() if "inicio de vigencia" in h), None)
            col_fim = next((k for h, k in cab.items() if "fim de vigencia" in h), None)
            cod, termo = a.strip(), re.sub(r"\s+", " ", cel.get(col_termo, "")).strip()
            if not cod and not termo:
                continue
            if not cod or not termo:
                avisos.append(f"tabela {num}, linha {n}: sem código ou sem termo, fora")
                continue
            if cod in vistos:
                avisos.append(f"tabela {num}, linha {n}: código repetido, vale o primeiro")
                continue
            vistos.add(cod)
            ini, fim = _data(cel.get(col_ini, "") if col_ini else ""), _data(cel.get(col_fim, "") if col_fim else "")
            if ini and fim and fim < ini:
                avisos.append(f"tabela {num}, linha {n}: fim de vigência antes do início, fica sem fim")
                fim = None
            termos.append((cod[:40], termo[:500], ini, fim))
        if cab is None or not termos:
            avisos.append(f"aba {aba}: sem cabeçalho 'Código do Termo' ou sem termos, fora")
            continue
        tabelas[num] = {"nome": (nome or f"Tabela {num} do padrão TISS")[:150], "termos": termos}
    return tabelas, avisos


def sigla_conselho(codigo, termo):
    """Sigla do conselho (tabela 26): a que vem entre parênteses no termo, em maiúsculas (CHECK [A-Z]{2,10})."""
    m = re.search(r"\(([A-Za-z]{2,10})\)\s*$", termo)
    s = m.group(1).upper() if m else SIGLA_SEM_OFICIAL.get(codigo)
    return s if s and re.fullmatch(r"[A-Z]{2,10}", s) else None


def _sql(banco, entrada, *args):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco, *args], input=entrada, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"erro no SQL do carregador tiss: {r.stderr.strip()[:500]}")
    return r.stdout


def _q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''").replace("\0", "") + "'"


def _registro():
    """(arquivo, versão) da última linha da fonte no registro do baixar.py."""
    ultimo = None
    for linha in REGISTRO.read_text(encoding="utf-8").splitlines() if REGISTRO.exists() else []:
        c = linha.split("\t")
        if c and c[0] == FONTE and len(c) > 6:
            ultimo = (RAIZ / "catalogos" / c[2], c[6].strip())
    return ultimo


def gerar_sql(tabelas, versao, sha):
    """Script SQL idempotente da carga (sem acesso ao banco: testável)."""
    vig = f"{versao[:4]}-{versao[4:6]}-01" if re.fullmatch(r"\d{6}", versao) else None
    p = ["SET NAMES utf8mb4;", "START TRANSACTION;"]
    for num, t in sorted(tabelas.items(), key=lambda x: int(x[0])):
        p.append(
            "INSERT INTO terminologia (codigo, nome, tipo, numero_tabela_tiss, orgao_responsavel, url_fonte, idioma, "
            f"emitir_em_guia, origem, criado_em, versao) VALUES ({_q('tiss_' + num)}, {_q(t['nome'])}, 'dominio_tiss', "
            f"{_q(num)}, {_q(ORGAO)}, {_q(URL)}, 'pt-BR', TRUE, 'sistema', UTC_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE "
            "nome = VALUES(nome), tipo = VALUES(tipo), orgao_responsavel = VALUES(orgao_responsavel), "
            "url_fonte = VALUES(url_fonte), alterado_em = UTC_TIMESTAMP(3);")
        p.append(f"SET @t = (SELECT id FROM terminologia WHERE numero_tabela_tiss = {_q(num)});")
        p.append(
            "INSERT INTO terminologia_edicao (terminologia_id, operacao, ocorrido_em, versao_edicao, vigencia_inicio, "
            "situacao_carga, hash_sha256, total_termos, carregada_em, criado_em, versao) VALUES (@t, 'inclusao', "
            f"UTC_TIMESTAMP(3), {_q(versao)}, {_q(vig or datetime.date.today().isoformat())}, 'carregada', {_q(sha)}, "
            f"{len(t['termos'])}, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE "
            "situacao_carga = 'carregada', hash_sha256 = VALUES(hash_sha256), total_termos = VALUES(total_termos), "
            "carregada_em = VALUES(carregada_em), alterado_em = UTC_TIMESTAMP(3);")
        p.append(f"SET @e = (SELECT id FROM terminologia_edicao WHERE terminologia_id = @t AND versao_edicao = {_q(versao)});")
        p.append("UPDATE terminologia SET edicao_vigente_terminologia_edicao_id = @e WHERE id = @t "
                 "AND NOT (edicao_vigente_terminologia_edicao_id <=> @e);")
        for i in range(0, len(t["termos"]), LOTE):
            vals = ",\n".join(f"(@t, {_q(c)}, {_q(d)}, @e, {_q(not f)}, {_q(a)}, {_q(f)}, {_q(versao)}, "
                              "UTC_TIMESTAMP(3), 1)" for c, d, a, f in t["termos"][i:i + LOTE])
            p.append("INSERT INTO termo_terminologia (terminologia_id, codigo_termo, descricao, terminologia_edicao_id, "
                     f"ativo, vigencia_inicio, vigencia_fim, versao_fonte, criado_em, versao) VALUES\n{vals}\n"
                     "ON DUPLICATE KEY UPDATE descricao = VALUES(descricao), ativo = VALUES(ativo), "
                     "vigencia_inicio = VALUES(vigencia_inicio), vigencia_fim = VALUES(vigencia_fim), "
                     "alterado_em = IF(versao_fonte <=> VALUES(versao_fonte), alterado_em, UTC_TIMESTAMP(3)), "
                     "terminologia_edicao_id = VALUES(terminologia_edicao_id), versao_fonte = VALUES(versao_fonte);")
    if "23" in tabelas:
        vals = ",\n".join(f"({_q(c)}, {_q(d[:150])}, {_q(a)}, {_q(f)}, {_q(versao)}, {_q('urg' in d.lower())}, "
                          "UTC_TIMESTAMP(3), 1)" for c, d, a, f in tabelas["23"]["termos"])
        p.append("INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, vigencia_inicio, vigencia_fim, "
                 f"versao_fonte, urgencia, criado_em, versao) VALUES\n{vals}\nON DUPLICATE KEY UPDATE "
                 "descricao = VALUES(descricao), vigencia_inicio = VALUES(vigencia_inicio), "
                 "vigencia_fim = VALUES(vigencia_fim), urgencia = VALUES(urgencia), "
                 "alterado_em = IF(versao_fonte <=> VALUES(versao_fonte), alterado_em, UTC_TIMESTAMP(3)), "
                 "versao_fonte = VALUES(versao_fonte);")
    if "26" in tabelas:
        linhas = []
        for c, d, a, f in tabelas["26"]["termos"]:
            s = sigla_conselho(c, d)
            if not s or len(c) > 2:
                AVISOS.append(f"tabela 26, código {c}: sem sigla válida, fora de conselho_classe")
                continue
            linhas.append(f"({_q(c)}, {_q(s)}, {_q(d[:150])}, {_q(not f)}, {_q(a)}, {_q(f)}, {_q(versao)}, "
                          "UTC_TIMESTAMP(3), 1)")
        if linhas:
            p.append("INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, ativo, vigencia_inicio, vigencia_fim, "
                     f"versao_fonte, criado_em, versao) VALUES\n" + ",\n".join(linhas) + "\nON DUPLICATE KEY UPDATE "
                     "descricao = VALUES(descricao), ativo = VALUES(ativo), vigencia_inicio = VALUES(vigencia_inicio), "
                     "vigencia_fim = VALUES(vigencia_fim), "
                     "alterado_em = IF(versao_fonte <=> VALUES(versao_fonte), alterado_em, UTC_TIMESTAMP(3)), "
                     "versao_fonte = VALUES(versao_fonte);")
    p.append("COMMIT;")
    return "\n".join(p)


def carregar(banco: str) -> dict:
    reg = _registro()
    if not reg:
        # sem a planilha oficial registrada, nada é carregado (nunca de outra fonte); o conector deixa a pendência
        # catalogo_oficial_ausente_* visível no painel
        AVISOS.append(f"fonte {FONTE} não registrada: registre a planilha oficial com "
                      f"`python3 -I catalogos/baixar.py --registrar tiss <xlsx> <AAAAMM>` e rode de novo")
        return {"termo_terminologia": 0, "carater_atendimento_tiss": 0, "conselho_classe": 0}
    arquivo, versao = reg
    tabelas, avisos = ler(arquivo)
    AVISOS.extend(avisos)
    if "23" not in tabelas or "26" not in tabelas:
        raise RuntimeError(f"{arquivo}: sem as tabelas 23 e 26 do padrão TISS")
    sha = hashlib.sha256(Path(arquivo).read_bytes()).hexdigest()
    _sql(banco, gerar_sql(tabelas, versao[:30], sha))
    cont = _sql(banco, None, "-N", "-e",
                "SELECT (SELECT COUNT(*) FROM termo_terminologia tt JOIN terminologia t ON t.id = tt.terminologia_id "
                "WHERE t.tipo = 'dominio_tiss'), (SELECT COUNT(*) FROM carater_atendimento_tiss), "
                "(SELECT COUNT(*) FROM conselho_classe), (SELECT COUNT(*) FROM terminologia WHERE tipo = 'dominio_tiss')"
                ).split()
    return {"termo_terminologia": int(cont[0]), "carater_atendimento_tiss": int(cont[1]),
            "conselho_classe": int(cont[2]), "terminologia": int(cont[3])}
