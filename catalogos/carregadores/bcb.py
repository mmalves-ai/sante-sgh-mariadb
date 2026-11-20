"""Carregador do catálogo de instituições financeiras (lista oficial de participantes do STR, Banco Central).

Fonte: catalogos/cache/bcb_bancos/ParticipantesSTR.csv (UTF-8 com BOM). Destino: tabela banco.
Chave de idempotência: codigo_ispb (uq_banco_codigo_ispb).
"""
import csv
import subprocess
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
ARQUIVO = RAIZ / "catalogos/cache/bcb_bancos/ParticipantesSTR.csv"
REGISTRO = RAIZ / "catalogos/cache/registro.tsv"
FONTE = "bcb_bancos"
LOTE = 1000


def _sql(banco, entrada, *args):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco, *args], input=entrada,
                       capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"erro no SQL do carregador bcb: {r.stderr.strip()[:500]}")
    return r.stdout


def _txt(v):
    if v is None:
        return "NULL"
    return "'" + v.replace("\\", "\\\\").replace("'", "''").replace("\0", "") + "'"


def _versao():
    for linha in REGISTRO.read_text(encoding="utf-8").splitlines():
        campos = linha.split("\t")
        if campos and campos[0] == FONTE:
            return campos[6].strip()
    raise RuntimeError(f"fonte {FONTE} ausente de {REGISTRO}")


def _codigo_compe(v):
    v = v.strip()
    # A lista usa 'n/a' e '0' para participante sem código de compensação: fica nulo.
    if len(v) == 3 and v.isdigit():
        return v
    return None


def _linhas():
    with open(ARQUIVO, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            ispb = r["ISPB"].strip().zfill(8)
            yield (
                _codigo_compe(r["Número_Código"]),
                ispb,
                (r["Nome_Extenso"].strip() or r["Nome_Reduzido"].strip())[:150],
                (r["Nome_Reduzido"].strip() or None) and r["Nome_Reduzido"].strip()[:60],
                r["Participa_da_Compe"].strip().lower() == "sim",
                datetime.strptime(r["Início_da_Operação"].strip(), "%d/%m/%Y").date().isoformat(),
            )


def carregar(banco: str) -> dict:
    versao = _versao()
    linhas = list(_linhas())
    cols = ("codigo_compensacao, codigo_ispb, descricao, nome_curto, participa_compe, vigencia_inicio, "
            "versao_fonte, criado_em, versao")
    upd = ("codigo_compensacao=VALUES(codigo_compensacao), descricao=VALUES(descricao), "
           "nome_curto=VALUES(nome_curto), participa_compe=VALUES(participa_compe), "
           "vigencia_inicio=VALUES(vigencia_inicio), versao_fonte=VALUES(versao_fonte), "
           "alterado_em=IF(versao_fonte<>VALUES(versao_fonte), UTC_TIMESTAMP(3), alterado_em)")
    partes = ["SET NAMES utf8mb4;", "START TRANSACTION;"]
    for i in range(0, len(linhas), LOTE):
        vals = ",\n".join(
            f"({_txt(c)}, {_txt(isp)}, {_txt(d)}, {_txt(n)}, {'TRUE' if p else 'FALSE'}, {_txt(v)}, "
            f"{_txt(versao)}, UTC_TIMESTAMP(3), 1)"
            for c, isp, d, n, p, v in linhas[i:i + LOTE])
        partes.append(f"INSERT INTO banco ({cols}) VALUES\n{vals}\nON DUPLICATE KEY UPDATE {upd};")
    partes.append("COMMIT;")
    _sql(banco, "\n".join(partes))
    total = _sql(banco, None, "-N", "-e", "SELECT COUNT(*) FROM banco").strip()
    return {"banco": int(total)}
