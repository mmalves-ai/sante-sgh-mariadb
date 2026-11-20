"""Carregador do catálogo IBGE: unidades federativas e municípios (F1.4).

Fontes (API de localidades do IBGE, já baixadas por catalogos/baixar.py):
  - cache/ibge_uf/estados.json                      -> unidade_federativa
  - cache/ibge_municipios/municipios.json (nivelado) -> municipio_ibge

Idempotente: INSERT ... ON DUPLICATE KEY UPDATE sobre codigo_ibge.
O país de referência das UFs é o Brasil (ISO 3166-1: BR / BRA / 076); se ainda não existir em
pais_referencia, é criado só com os códigos ISO, sem sobrescrever o que outro carregador gravar.
"""
import json
import subprocess
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
CACHE = RAIZ / "catalogos/cache"
LOTE = 1000


def _sql(banco, entrada=None, *args):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco] + list(args),
                       input=entrada, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"erro no SQL ({banco}): {r.stderr.strip()[:2000]}")
    return r.stdout


def _txt(v):
    if v is None:
        return "NULL"
    s = str(v).replace("\\", "\\\\").replace("'", "''").replace("\0", "")
    return f"'{s}'"


def _versoes():
    vers = {}
    for linha in (CACHE / "registro.tsv").read_text(encoding="utf-8").splitlines():
        c = linha.split("\t")
        if len(c) >= 7:
            vers[c[0]] = c[6].strip()[:30] or None
    return vers


def _lotes(linhas):
    for i in range(0, len(linhas), LOTE):
        yield linhas[i:i + LOTE]


def carregar(banco: str) -> dict:
    vers = _versoes()
    v_uf, v_mun = vers.get("ibge_uf"), vers.get("ibge_municipios")
    estados = json.loads((CACHE / "ibge_uf/estados.json").read_text(encoding="utf-8"))
    municipios = json.loads((CACHE / "ibge_municipios/municipios.json").read_text(encoding="utf-8"))

    partes = ["SET NAMES utf8mb4;",
              # País de referência: Brasil (ISO 3166-1). Não sobrescreve um registro já existente.
              "INSERT INTO pais_referencia (codigo_iso, codigo_iso_alfa3, codigo_iso_numerico, descricao,"
              " criado_em, versao) VALUES ('BR', 'BRA', '076', 'Brasil', UTC_TIMESTAMP(3), 1)"
              " ON DUPLICATE KEY UPDATE id = id;",
              "SET @pais_br = (SELECT id FROM pais_referencia WHERE codigo_iso = 'BR');"]

    ufs = sorted(estados, key=lambda e: e["id"])
    vals = [f"({_txt(str(e['id']).zfill(2))}, {_txt(e['sigla'])}, {_txt(e['nome'])}, @pais_br, TRUE,"
            f" {_txt(v_uf)}, UTC_TIMESTAMP(3), 1)" for e in ufs]
    partes.append(
        "INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, ativo,"
        " versao_fonte, criado_em, versao) VALUES\n" + ",\n".join(vals) +
        "\nON DUPLICATE KEY UPDATE sigla = VALUES(sigla), descricao = VALUES(descricao),"
        " pais_referencia_id = VALUES(pais_referencia_id), ativo = TRUE,"
        " versao_fonte = VALUES(versao_fonte);")

    muns = sorted(municipios, key=lambda m: m["municipio-id"])
    linhas = [(_txt(str(m['municipio-id']).zfill(7)), _txt(m['municipio-nome']),
               _txt(str(m['UF-id']).zfill(2))) for m in muns]
    for lote in _lotes(linhas):
        cod, nome, uf = lote[0]
        sel = [f"SELECT {cod} AS codigo, {nome} AS nome, {uf} AS uf"]
        sel += [f"SELECT {c}, {n}, {u}" for c, n, u in lote[1:]]
        partes.append(
            "INSERT INTO municipio_ibge (codigo_ibge, nome, unidade_federativa_id, ativo, versao_fonte,"
            f" criado_em, versao)\nSELECT t.codigo, t.nome, uf.id, TRUE, {_txt(v_mun)}, UTC_TIMESTAMP(3), 1 FROM (\n"
            + "\nUNION ALL ".join(sel) +
            "\n) AS t JOIN unidade_federativa uf ON uf.codigo_ibge = t.uf\n"
            "ON DUPLICATE KEY UPDATE nome = VALUES(nome), unidade_federativa_id = VALUES(unidade_federativa_id),"
            " ativo = TRUE, versao_fonte = VALUES(versao_fonte);")

    _sql(banco, "\n".join(partes) + "\n")

    saida = _sql(banco, None, "-N", "-e",
                 "SELECT 'unidade_federativa', COUNT(*) FROM unidade_federativa"
                 " UNION ALL SELECT 'municipio_ibge', COUNT(*) FROM municipio_ibge")
    res = {}
    for linha in saida.splitlines():
        t, n = linha.split("\t")
        res[t] = int(n)
    return res
