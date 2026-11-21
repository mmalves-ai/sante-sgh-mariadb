"""Gerador da imagem sintética do "cliente de exemplo": um .fdb Firebird 3 (ODS 12, charset NONE, CP1252)
com as formas que a origem real tem, e dados 100% falsos e determinísticos (semente fixa).

Formas cobertas (o L3 em diante acrescenta tabelas com o DDL do mapa, nesta mesma especificação):
- PK inteira crescente com lacunas (faixas), PK composta, tabela sem PK, FK;
- texto CP1252 com todos os bytes 0x80-0x9F e CHAR com preenchimento;
- BLOB binário e BLOB de texto; datas sentinela (1899-12-30, 1900-01-01); hora HHMM inteira; S/N;
- generator.
"""
import json
import os
import random
import subprocess
import datetime

ISQL = "/opt/firebird/bin/isql"
SEMENTE = 20261121
SILABAS = ["ma", "ri", "jo", "ão", "pe", "dro", "lu", "ci", "a", "na", "be", "ça", "fá", "bio", "lú", "cia", "ter", "sa"]

DDL = """
CREATE TABLE EX_ESTAB (ID INTEGER NOT NULL PRIMARY KEY, NOME CHAR(40), ATIVO CHAR(1));
CREATE TABLE EX_PESSOA (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(60), NASC DATE, SEXO CHAR(1),
  ESTAB INTEGER REFERENCES EX_ESTAB(ID), ALTERADO_EM TIMESTAMP);
CREATE TABLE EX_ITEM_COMP (PEDIDO INTEGER NOT NULL, SEQ SMALLINT NOT NULL, DESCR VARCHAR(30),
  VALOR NUMERIC(12,2), CONSTRAINT PK_EX_ITEM_COMP PRIMARY KEY (PEDIDO, SEQ));
CREATE TABLE EX_TRILHA (QUANDO TIMESTAMP, TEXTO VARCHAR(40));
CREATE TABLE EX_TEXTO_CP1252 (ID INTEGER NOT NULL PRIMARY KEY, BRUTO VARCHAR(40), FIXO CHAR(10));
CREATE TABLE EX_ANEXO (ID INTEGER NOT NULL PRIMARY KEY, CONTEUDO BLOB SUB_TYPE 0, NOTA BLOB SUB_TYPE 1);
CREATE TABLE EX_SENTINELA (ID INTEGER NOT NULL PRIMARY KEY, DT DATE, HHMM INTEGER, FLAG CHAR(1));
CREATE GENERATOR EX_GEN_PESSOA;
"""

# bytes de teste: 0x80..0x9F inteiros, mais 'ção' em CP1252
BYTES_C1 = bytes(range(0x80, 0xA0))
BYTES_ACENTO = "ação".encode("cp1252")


def _hex(b):
    return "x'%s'" % b.hex() if b else "''"


def _nome(r):
    s = "".join(r.choice(SILABAS) for _ in range(r.randint(2, 4)))
    return s.capitalize().encode("cp1252")


def gerar(destino, versao=1):
    """Cria `destino` (não pode existir). Devolve o manifesto (contagens e bytes esperados)."""
    if os.path.exists(destino):
        raise FileExistsError(destino)
    r = random.Random(SEMENTE + versao)
    linhas = ["SET NAMES NONE;", "CREATE DATABASE '%s' PAGE_SIZE 8192 DEFAULT CHARACTER SET NONE;" % destino,
              DDL, "COMMIT;"]
    cont = {}

    def ins(tab, vals):
        linhas.append("INSERT INTO %s VALUES (%s);" % (tab, ", ".join(vals)))
        cont[tab] = cont.get(tab, 0) + 1

    for i in range(1, 4):
        ins("EX_ESTAB", [str(i), _hex(b"Unidade exemplo %d" % i), "'S'" if i < 3 else "'N'"])
    base = datetime.datetime(2026, 1, 1)
    ids = [i for i in range(1, 2801) if i % 13]  # lacunas na PK
    for i in ids:
        nasc = datetime.date(1940, 1, 1) + datetime.timedelta(days=r.randint(0, 30000))
        alt = base + datetime.timedelta(minutes=r.randint(0, 400000))
        ins("EX_PESSOA", [str(i), _hex(_nome(r) + b" " + _nome(r)), "'%s'" % nasc, "'%s'" % r.choice("MF"),
                          str(r.randint(1, 3)), "'%s'" % alt.strftime("%Y-%m-%d %H:%M:%S")])
    for p in range(1, 201):
        for s in range(1, r.randint(2, 5)):
            ins("EX_ITEM_COMP", [str(p), str(s), _hex(b"item %d/%d" % (p, s)), "%d.%02d" % (r.randint(0, 999), r.randint(0, 99))])
    for i in range(150):
        q = base + datetime.timedelta(seconds=i * 37)
        ins("EX_TRILHA", ["'%s'" % q.strftime("%Y-%m-%d %H:%M:%S"), _hex(b"evento %d" % (i % 7))])
    ins("EX_TEXTO_CP1252", ["1", _hex(BYTES_C1), _hex(b"abc")])
    ins("EX_TEXTO_CP1252", ["2", _hex(BYTES_ACENTO), _hex(BYTES_ACENTO)])
    ins("EX_TEXTO_CP1252", ["3", "NULL", "NULL"])
    anexos = {}
    for i in range(1, 21):
        b = bytes(r.getrandbits(8) for _ in range(r.randint(10, 3000)))
        anexos[i] = len(b)
        ins("EX_ANEXO", [str(i), _hex(b), _hex(BYTES_ACENTO + b" nota %d" % i)])
    sent = ["'1899-12-30'", "'1900-01-01'", "'2026-03-15'", "NULL"]
    for i in range(1, 41):
        ins("EX_SENTINELA", [str(i), sent[i % 4], str(r.choice([0, 730, 1259, 2359])), "'%s'" % "SN"[i % 2]])
    linhas.append("SET GENERATOR EX_GEN_PESSOA TO %d;" % max(ids))
    linhas.append("COMMIT;")
    script = "\n".join(linhas) + "\n"
    p = subprocess.run([ISQL, "-q", "-ch", "NONE", "-u", os.environ.get("ISC_USER", "SYSDBA")],
                       input=script.encode("latin-1"), capture_output=True)
    if p.returncode != 0 or b"Statement failed" in p.stdout + p.stderr:
        raise RuntimeError("isql falhou: %s" % (p.stdout + p.stderr).decode("latin-1")[-500:])
    os.chmod(destino, 0o600)
    uid = os.environ.get("CONECTOR_UID")
    if uid:
        os.chown(destino, int(uid), int(os.environ.get("CONECTOR_GID", uid)))
    manifesto = {
        "versao": versao, "semente": SEMENTE + versao, "contagens": cont,
        "registros_total": sum(cont.values()), "pk_pessoa_max": max(ids),
        "bytes_c1_hex": BYTES_C1.hex(), "bytes_acento_hex": BYTES_ACENTO.hex(), "anexo_tamanhos": anexos,
    }
    with open(destino[:-4] + ".manifesto.json", "w") as f:
        json.dump(manifesto, f, indent=1, sort_keys=True)
    return manifesto
