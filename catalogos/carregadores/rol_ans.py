"""Carregador do rol de procedimentos e eventos em saúde da agência reguladora dos planos (08-SGO linha 103, C2-122):
a cobertura obrigatória por segmentação, usada nas críticas da autorização de guias (regras do rol e diretrizes).

Fonte: a planilha oficial "Correlação TUSS x Rol" do Anexo I do rol vigente (RN 465/2021 e atualizações), publicada
pela ANS no portal gov.br (Acesso à informação > Participação da sociedade > Atualização do rol). O endereço muda a
cada atualização, por isso a fonte é de registro manual: `python3 -I catalogos/baixar.py --registrar rol_ans
<planilha.xlsx> <versão, ex.: rn465-2026-10>`, gravada com o SHA-256 em catalogos/cache/registro.tsv. Nada é
transcrito aqui: o carregador acha a linha de cabeçalho pelos nomes das colunas (código TUSS, procedimento, vigência,
OD, AMB, HCO, HSO, REF, PAC, DUT) e recusa a planilha fora da forma.

Segmentações: OD odontológica, AMB ambulatorial, HCO hospitalar com obstetrícia (hospitalar e obstetrícia), HSO
hospitalar sem obstetrícia, REF referência, PAC alta complexidade. A coluna DUT traz o número da diretriz de
utilização do Anexo II (PDF): a diretriz entra com o número e a ligação ao procedimento; os critérios clínicos ficam
como referência ao Anexo II da versão, sem transcrição (o texto do PDF não é lido por máquina com segurança).

Destino: rol_procedimento_ans (chave única código TUSS + início da vigência) e diretriz_utilizacao_ans (chave única
número + versão). Idempotente: INSERT ... ON DUPLICATE KEY UPDATE. O procedimento que sai do rol não é apagado (a
autorização antiga continua legível): a nova versão encerra a vigência dele na véspera; o mesmo vale para as
diretrizes de versões anteriores. Sem a planilha registrada a carga não falha: fica o aviso e as regras do rol já
cadastradas seguem valendo.
"""
import datetime
import re
import subprocess
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PASTA = RAIZ / "catalogos/cache/rol_ans"
REGISTRO = RAIZ / "catalogos/cache/registro.tsv"
FONTE = "rol_ans"
MINIMO = 1000  # o rol vigente correlaciona mais de 3 mil códigos TUSS; abaixo disso a planilha mudou de forma
VIGENCIA_RN465 = "2021-04-01"  # início da vigência da RN 465/2021, para linha sem a data própria
AVISOS = []
_M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_EXCEL_ZERO = datetime.date(1899, 12, 30)
SEGMENTOS = ("od", "amb", "hco", "hso", "ref", "pac")


def _sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower().strip()


def _data(v):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return (_EXCEL_ZERO + datetime.timedelta(days=int(float(v)))).isoformat()
    except (ValueError, OverflowError):
        pass
    try:
        return datetime.datetime.strptime(v[:10], "%d/%m/%Y").date().isoformat()
    except ValueError:
        return None


def _planilhas(arquivo):
    """[linhas de cada aba como {coluna: texto}] (leitura do xlsx pela biblioteca padrão)."""
    z = zipfile.ZipFile(arquivo)
    textos = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(_M + "si"):
            textos.append("".join(t.text or "" for t in si.iter(_M + "t")))
    rels = {r.get("Id"): r.get("Target")
            for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")).iter(_REL + "Relationship")}
    abas = []
    for s in ET.fromstring(z.read("xl/workbook.xml")).iter(_M + "sheet"):
        alvo = rels[s.get(_R + "id")].lstrip("/")
        alvo = alvo if alvo.startswith("xl/") else "xl/" + alvo
        linhas = []
        for row in ET.fromstring(z.read(alvo)).iter(_M + "row"):
            cel = {}
            for c in row.findall(_M + "c"):
                v, inl = c.find(_M + "v"), c.find(_M + "is")
                if c.get("t") == "s" and v is not None:
                    x = textos[int(v.text)]
                elif inl is not None:
                    x = "".join(t.text or "" for t in inl.iter(_M + "t"))
                else:
                    x = v.text if v is not None else ""
                cel[re.match(r"[A-Z]+", c.get("r")).group(0)] = " ".join((x or "").split())
            linhas.append(cel)
        abas.append(linhas)
    return abas


def _cabecalho(linha):
    """{campo: coluna} se a linha é o cabeçalho da correlação; senão None."""
    m = {}
    for col, txt in linha.items():
        t = _sem_acento(txt)
        if t in SEGMENTOS:
            m[t] = col
        elif t == "dut":
            m["dut"] = col
        elif t.startswith("codigo") and "codigo" not in m:
            m["codigo"] = col
        elif t.startswith("terminologia") or t.startswith("descricao"):
            m.setdefault("termo", col)
        elif t.startswith("correlacao"):
            m["correlacao"] = col
        elif t.startswith("procedimento"):
            m.setdefault("procedimento", col)
        elif t.startswith("resolucao") or t == "rn" or t.startswith("rn "):
            m["norma"] = col
        elif t.startswith("vigencia"):
            m["vigencia"] = col
    return m if {"codigo", "procedimento", "amb", "hco", "hso", "od"} <= m.keys() else None


def ler_linhas(linhas):
    """[(código TUSS, descrição, ambulatorial, hospitalar, obstetrícia, odontológica, referência, alta complexidade,
    diretriz ou None, norma ou None, início da vigência)] em ordem de código. Só as linhas com correlação SIM (quando a
    coluna existe). O mesmo código em mais de uma linha soma as segmentações e fica com a vigência mais antiga. Recusa
    planilha sem cabeçalho, código fora de 8 dígitos, linha sem descrição ou menos códigos que o mínimo."""
    cab, itens = None, {}
    for n, ln in enumerate(linhas, 1):
        if cab is None:
            cab = _cabecalho(ln)
            continue
        cod = re.sub(r"\D", "", ln.get(cab["codigo"], ""))
        if not cod and not ln.get(cab["procedimento"]):
            continue
        if "correlacao" in cab and _sem_acento(ln.get(cab["correlacao"], "")) not in ("sim", "s"):
            continue
        if not re.fullmatch(r"\d{8}", cod):
            raise RuntimeError(f"rol_ans: linha {n} com código TUSS fora de 8 dígitos")
        desc = ln.get(cab.get("termo", ""), "") or ln.get(cab["procedimento"], "")
        if not desc:
            raise RuntimeError(f"rol_ans: linha {n} sem descrição do procedimento")
        marca = {s: bool(ln.get(cab.get(s, ""), "").strip()) for s in SEGMENTOS}
        dut = re.sub(r"[^\d.]", "", ln.get(cab.get("dut", ""), "")).strip(".") or None
        norma = (ln.get(cab.get("norma", ""), "") or None)
        vig = _data(ln.get(cab.get("vigencia", ""), "")) or VIGENCIA_RN465
        novo = (desc[:1000], marca["amb"], marca["hco"] or marca["hso"], marca["hco"], marca["od"], marca["ref"],
                marca["pac"], dut, norma[:60] if norma else None, vig)
        ant = itens.get(cod)
        if ant:
            novo = (ant[0], *(a or b for a, b in zip(ant[1:7], novo[1:7])), ant[7] or dut, ant[8] or novo[8],
                    min(ant[9], vig))
        itens[cod] = novo
    if cab is None:
        raise RuntimeError("rol_ans: a planilha não traz o cabeçalho da correlação TUSS x rol (código, procedimento, "
                           "OD, AMB, HCO, HSO)")
    if len(itens) < MINIMO:
        raise RuntimeError(f"rol_ans: só {len(itens)} códigos (mínimo {MINIMO}); planilha incompleta?")
    return [(c, *v) for c, v in sorted(itens.items())]


def ler(arquivo: Path):
    erros = []
    for linhas in _planilhas(arquivo):
        try:
            return ler_linhas(linhas)
        except RuntimeError as e:
            erros.append(str(e))
    raise RuntimeError("; ".join(erros) or "rol_ans: planilha vazia")


def registro():
    """(arquivo, versão) da última linha da fonte no registro do cache, ou None."""
    ult = None
    if REGISTRO.exists():
        for ln in REGISTRO.read_text(encoding="utf-8").splitlines():
            c = ln.split("\t")
            if c[0] == FONTE and len(c) > 6 and c[6]:
                ult = (RAIZ / "catalogos" / c[2], c[6][:30])
    return ult


def _txt(v):
    return "NULL" if v is None else "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def _b(v):
    return "TRUE" if v else "FALSE"


def _sql(banco, entrada):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco], input=entrada, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"erro no SQL ({banco}): {r.stderr.strip()[:2000]}")
    return r.stdout


def estado(banco: str):
    """(o banco tem as tabelas do rol?, procedimentos vigentes)."""
    saida = _sql(banco, """SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()
  AND table_name IN ('rol_procedimento_ans', 'diretriz_utilizacao_ans')),
 (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'rol_procedimento_ans');
""")
    tabelas, tem_rol = (int(x) for x in saida.strip().splitlines()[-1].split())
    if tabelas < 2 or not tem_rol:
        return False, 0
    vig = _sql(banco, "SELECT COUNT(*) FROM rol_procedimento_ans WHERE vigencia_fim IS NULL OR vigencia_fim >= UTC_DATE();")
    return True, int(vig.strip().splitlines()[-1])


def montar_script(itens, v: str) -> str:
    vals = ",\n".join(
        f"({_txt(c)}, {_txt(d)}, {_b(a)}, {_b(h)}, {_b(o)}, {_b(od)}, {_b(r)}, {_b(p)}, {_txt(dut)}, {_txt(n)}, "
        f"{_txt(vi)})" for c, d, a, h, o, od, r, p, dut, n, vi in itens)
    v = _txt(v)
    return f"""SET NAMES utf8mb4;
START TRANSACTION;
CREATE TEMPORARY TABLE tmp_rol_ans (codigo VARCHAR(10) NOT NULL, descricao VARCHAR(1000) NOT NULL,
  amb BOOLEAN NOT NULL, hosp BOOLEAN NOT NULL, obst BOOLEAN NOT NULL, odonto BOOLEAN NOT NULL, ref BOOLEAN NOT NULL,
  pac BOOLEAN NOT NULL, dut VARCHAR(30) NULL, norma VARCHAR(60) NULL, vigencia DATE NOT NULL, PRIMARY KEY (codigo));
INSERT INTO tmp_rol_ans VALUES
{vals};
INSERT INTO diretriz_utilizacao_ans (codigo_rol, tipo, titulo, descricao, vigencia_inicio, versao_fonte, criado_em, versao)
SELECT t.dut, 'diretriz_utilizacao', CONCAT('Diretriz de utilização nº ', t.dut),
       CONCAT('Critérios clínicos no Anexo II (Diretrizes de Utilização) do rol, versão ', {v}, '.'),
       MIN(t.vigencia), {v}, UTC_TIMESTAMP(3), 1
  FROM tmp_rol_ans t WHERE t.dut IS NOT NULL GROUP BY t.dut
ON DUPLICATE KEY UPDATE vigencia_fim = NULL;
UPDATE diretriz_utilizacao_ans
   SET vigencia_fim = GREATEST(vigencia_inicio, DATE_SUB(UTC_DATE(), INTERVAL 1 DAY)), alterado_em = UTC_TIMESTAMP(3),
       versao = versao + 1
 WHERE versao_fonte <> {v} AND vigencia_fim IS NULL;
INSERT INTO rol_procedimento_ans (codigo_tuss, descricao, procedimento_termo_terminologia_id, cobertura_ambulatorial,
  cobertura_hospitalar, cobertura_obstetricia, cobertura_odontologica, cobertura_referencia, alta_complexidade,
  diretriz_utilizacao_ans_id, norma_origem, vigencia_inicio, versao_fonte, criado_em, versao)
SELECT t.codigo, t.descricao,
       (SELECT MIN(tt.id) FROM termo_terminologia tt JOIN terminologia te ON te.id = tt.terminologia_id
         WHERE te.numero_tabela_tiss = '22' AND tt.codigo_termo = t.codigo),
       t.amb, t.hosp, t.obst, t.odonto, t.ref, t.pac,
       (SELECT d.id FROM diretriz_utilizacao_ans d WHERE d.codigo_rol = t.dut AND d.versao_fonte = {v}),
       t.norma, t.vigencia, {v}, UTC_TIMESTAMP(3), 1
  FROM tmp_rol_ans t
ON DUPLICATE KEY UPDATE
  alterado_em = IF(rol_procedimento_ans.versao_fonte <> VALUES(versao_fonte), UTC_TIMESTAMP(3), rol_procedimento_ans.alterado_em),
  versao = IF(rol_procedimento_ans.versao_fonte <> VALUES(versao_fonte), rol_procedimento_ans.versao + 1, rol_procedimento_ans.versao),
  descricao = VALUES(descricao), procedimento_termo_terminologia_id = VALUES(procedimento_termo_terminologia_id),
  cobertura_ambulatorial = VALUES(cobertura_ambulatorial), cobertura_hospitalar = VALUES(cobertura_hospitalar),
  cobertura_obstetricia = VALUES(cobertura_obstetricia), cobertura_odontologica = VALUES(cobertura_odontologica),
  cobertura_referencia = VALUES(cobertura_referencia), alta_complexidade = VALUES(alta_complexidade),
  diretriz_utilizacao_ans_id = VALUES(diretriz_utilizacao_ans_id), norma_origem = VALUES(norma_origem),
  vigencia_fim = NULL, versao_fonte = VALUES(versao_fonte);
UPDATE diretriz_utilizacao_ans d
   SET d.rol_procedimento_ans_id = (SELECT MIN(r.id) FROM rol_procedimento_ans r
                                     WHERE r.diretriz_utilizacao_ans_id = d.id)
 WHERE d.versao_fonte = {v};
UPDATE rol_procedimento_ans r
   SET r.vigencia_fim = DATE_SUB(UTC_DATE(), INTERVAL 1 DAY), r.alterado_em = UTC_TIMESTAMP(3), r.versao = r.versao + 1
 WHERE r.versao_fonte <> {v} AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= UTC_DATE())
   AND r.vigencia_inicio < UTC_DATE();
COMMIT;
SELECT COUNT(*) FROM rol_procedimento_ans WHERE vigencia_fim IS NULL AND versao_fonte = {v};
"""


def carregar(banco: str) -> dict:
    tem, vigentes = estado(banco)
    if not tem:
        AVISOS.append(f"rol_ans: o banco {banco} não tem as tabelas do rol (módulo da operadora); nada carregado")
        return {"rol_procedimento_ans": 0}
    reg = registro()
    if not reg or not reg[0].exists():
        AVISOS.append(f"fonte {FONTE} não registrada: baixe a planilha 'Correlação TUSS x Rol' do Anexo I no portal da "
                      f"ANS e rode `python3 -I catalogos/baixar.py --registrar {FONTE} <planilha.xlsx> <versão>`; "
                      f"mantidos os {vigentes} procedimentos já carregados")
        return {"rol_procedimento_ans": vigentes}
    itens = ler(reg[0])
    total = int(_sql(banco, montar_script(itens, reg[1])).strip().splitlines()[-1])
    if total != len(itens):
        raise RuntimeError(f"rol_procedimento_ans: esperava {len(itens)} procedimentos vigentes, ficaram {total}")
    return {"rol_procedimento_ans": total}
