"""Carregador do catálogo de CFOP (Código Fiscal de Operações e Prestações; Convênio SINIEF s/n.º de 1970, anexo, com
os ajustes SINIEF; a mesma tabela é publicada nas tabelas externas do SPED). Fonte PÚBLICA: nunca a cópia do cliente.

Fonte: catalogos/cache/cfop/<arquivo> (a tabela oficial em texto, registrada por `baixar.py --registrar cfop <arq>`
quando a publicação não tem endereço fixo para download). Formato aceito, uma linha por código: o código com ou sem
ponto ("1.102" ou "1102"), separado da descrição por '|', ';', tabulação ou ' - ', e opcionalmente o início e o fim
da vigência (DDMMAAAA, DD/MM/AAAA ou AAAA-MM-DD). Cabeçalho, linha sem código e os títulos de grupo (x.000, x.100...
terminados em 00 com descrição em maiúsculas) ficam de fora. Código repetido: vale o primeiro (aviso).

Destino: tabela cfop (uq_cfop_codigo_cfop, idempotente). Sentido e abrangência saem do 1.º dígito do código, como
define o próprio convênio: 1, 2, 3 entrada; 5, 6, 7 saída; 1 e 5 estadual, 2 e 6 interestadual, 3 e 7 exterior.
"""
import re
import subprocess
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PASTA = RAIZ / "catalogos/cache/cfop"
REGISTRO = RAIZ / "catalogos/cache/registro.tsv"
FONTE = "cfop"
LOTE = 500
AVISOS = []

_LINHA = re.compile(r"^\s*([1-7])\.?([0-9]{3})\s*(?:\||;|\t|\s-\s|\s–\s)\s*(.*)$")
_SENTIDO = {"1": ("entrada", "estadual"), "2": ("entrada", "interestadual"), "3": ("entrada", "exterior"),
            "5": ("saida", "estadual"), "6": ("saida", "interestadual"), "7": ("saida", "exterior")}


def _data(v):
    v = (v or "").strip()
    for fmt in ("%d%m%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def _titulo_de_grupo(codigo, descricao):
    """x.000 e x.y00 em maiúsculas são títulos de grupo do anexo, não códigos de operação."""
    return codigo.endswith("00") and descricao == descricao.upper()


def ler(arquivo):
    """(linhas, avisos) da tabela oficial em texto; cada linha: codigo, descricao, sentido, abrangencia,
    vigencia_inicio, vigencia_fim."""
    linhas, avisos, vistos = [], [], set()
    for n, bruta in enumerate(Path(arquivo).read_text(encoding="utf-8-sig").splitlines(), 1):
        m = _LINHA.match(bruta)
        if not m:
            if bruta.strip() and not re.match(r"^\s*(cfop|c[oó]digo)\b", bruta, re.I):
                avisos.append("linha %d sem código de CFOP: ignorada" % n)
            continue
        codigo = m.group(1) + m.group(2)
        partes = [p.strip() for p in re.split(r"\||;|\t", m.group(3))]
        descricao = partes[0][:500]
        if not descricao or m.group(1) in "4" or _titulo_de_grupo(codigo, descricao):
            continue
        if codigo in vistos:
            avisos.append("linha %d: CFOP %s repetido, vale o primeiro" % (n, codigo))
            continue
        vistos.add(codigo)
        sentido, abrangencia = _SENTIDO[m.group(1)]
        linhas.append({"codigo": codigo, "descricao": descricao, "sentido": sentido, "abrangencia": abrangencia,
                       "vigencia_inicio": _data(partes[1] if len(partes) > 1 else ""),
                       "vigencia_fim": _data(partes[2] if len(partes) > 2 else "")})
    return linhas, avisos


def _sql(banco, entrada, *args):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco, *args], input=entrada, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"erro no SQL do carregador cfop: {r.stderr.strip()[:500]}")
    return r.stdout


def _txt(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''").replace("\0", "") + "'"


def _registro():
    """(arquivo, versão) da última linha da fonte no registro do baixar.py."""
    ultimo = None
    for linha in REGISTRO.read_text(encoding="utf-8").splitlines() if REGISTRO.exists() else []:
        campos = linha.split("\t")
        if campos and campos[0] == FONTE:
            ultimo = (RAIZ / "catalogos" / campos[2], campos[6].strip())
    return ultimo


def carregar(banco: str) -> dict:
    reg = _registro()
    if not reg:
        # sem a tabela oficial registrada, nada é carregado (nunca de outra fonte): o aviso fica no evento do cliente
        # e o de-para do conector deixa cada CFOP como pendência catalogo_codigo_inexistente, visível no painel
        AVISOS.append(f"fonte {FONTE} não registrada: registre a tabela oficial com "
                      f"`python3 -I catalogos/baixar.py --registrar cfop <arquivo>` e rode de novo")
        return {"cfop": 0}
    arquivo, versao = reg
    linhas, avisos = ler(arquivo)
    AVISOS.extend(avisos)
    if not linhas:
        raise RuntimeError(f"{arquivo}: nenhum CFOP lido")
    cols = ("codigo_cfop, descricao, sentido, abrangencia, vigencia_inicio, vigencia_fim, versao_fonte, criado_em, "
            "versao")
    upd = ("descricao=VALUES(descricao), sentido=VALUES(sentido), abrangencia=VALUES(abrangencia), "
           "vigencia_inicio=VALUES(vigencia_inicio), vigencia_fim=VALUES(vigencia_fim), "
           "alterado_em=IF(versao_fonte<>VALUES(versao_fonte), UTC_TIMESTAMP(3), alterado_em), "
           "versao_fonte=VALUES(versao_fonte)")
    partes = ["SET NAMES utf8mb4;", "START TRANSACTION;"]
    for i in range(0, len(linhas), LOTE):
        vals = ",\n".join(
            f"({_txt(x['codigo'])}, {_txt(x['descricao'])}, {_txt(x['sentido'])}, {_txt(x['abrangencia'])}, "
            f"{_txt(x['vigencia_inicio'])}, {_txt(x['vigencia_fim'])}, {_txt(versao)}, UTC_TIMESTAMP(3), 1)"
            for x in linhas[i:i + LOTE])
        partes.append(f"INSERT INTO cfop ({cols}) VALUES\n{vals}\nON DUPLICATE KEY UPDATE {upd};")
    partes.append("COMMIT;")
    _sql(banco, "\n".join(partes))
    total = _sql(banco, None, "-N", "-e", "SELECT COUNT(*) FROM cfop").strip()
    return {"cfop": int(total)}
