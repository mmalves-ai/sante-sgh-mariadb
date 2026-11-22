"""Gerador da imagem sintética do "cliente de exemplo": um .fdb Firebird 3 (ODS 12, charset NONE, CP1252)
com as formas que a origem real tem, e dados 100% falsos e determinísticos (semente fixa).

Formas cobertas (o L3 em diante acrescenta tabelas com o DDL do mapa, nesta mesma especificação):
- PK inteira crescente com lacunas (faixas), PK composta, tabela sem PK, FK;
- texto CP1252 com todos os bytes 0x80-0x9F e CHAR com preenchimento;
- BLOB binário e BLOB de texto; datas sentinela (1899-12-30, 1900-01-01); hora HHMM inteira; S/N;
- generator.

Fatias dos lotes L5 a L8 (em paralelo): cada fatia acrescenta as suas tabelas e anomalias num módulo próprio em
`sintetica_d/<fatia>.py` (ex.: `sintetica_d/l5_01.py` para a fatia L5-01), sem editar este arquivo. O módulo define:
- `DDL`: CREATE TABLE das tabelas da origem da fatia (mesmos nomes e tipos do dicionário; dados 100% falsos);
- `linhas(r, ins)`: insere as linhas (`ins(tabela, [valores Python])`, com `r` = random.Random determinístico) e
  devolve o esperado no destino: {tabela: {"gravados": n, "pendencias": {regra: n}}} (pendências por regra da
  tabela, inclusive as de recusa: `pai_pendente`, `restricao_destino_<código>`...);
- opcionais: `REQUER` (outras fatias cujas tabelas entram juntas), `PAIS_EXTERNOS` ({tabela: [chaves]}: pais de
  fora da fatia, registrados como já carregados), `PREPARO_DESTINO` (SQL no banco de destino depois do DDL, ex.: os
  códigos de catálogo oficial que as linhas usam), `MAPA_TESTE` e `DDL_DESTINO` (só para a fatia `exemplo`, que
  prova o mecanismo com mapa e destino próprios).
`gerar(..., fatias=[...])` junta as fatias (e as que elas requerem) e o manifesto traz `fatias` (esperado por fatia)
e `pais_externos`. A conferência por fatia é `conferencia.conferir` (`conector.sh conferir-fatia <fatia>`).
"""
import importlib
import json
import os
import pkgutil
import random
import re
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

# Tabelas com a forma da origem que o mapa do L3 lê (subconjunto das colunas reais, mesmos nomes e tipos; dados
# 100% falsos). As colunas de credencial (SENHA, SALT, SENHA_PROXY) existem para provar que o mapa nunca as lê.
DDL_MAPA = """
CREATE TABLE TBTPEMP (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(25));
CREATE TABLE TBHOSPIT (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50), NOME_HOT CHAR(50), CGC DOUBLE PRECISION,
  CNES INTEGER, ENDERECO VARCHAR(40), NUMERO INTEGER, COMPL VARCHAR(15), BAI VARCHAR(25), CEP INTEGER, FONE VARCHAR(15),
  EMAIL VARCHAR(50), DTINI TIMESTAMP, SENHA_PROXY VARCHAR(15));
CREATE TABLE TBUSERS (NOME VARCHAR(31) NOT NULL PRIMARY KEY, ID_TBUSERS SMALLINT NOT NULL, STATUS VARCHAR(1),
  CPF BIGINT, E_MAIL VARCHAR(100), BLOQUEADO CHAR(1), DT_NASC DATE, NOMEC VARCHAR(70), SENHA VARCHAR(100),
  SALT VARCHAR(100));
CREATE TABLE RICADPAC (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(70), NASC DATE, SEXO VARCHAR(1),
  CPF DOUBLE PRECISION, CNS VARCHAR(20), MAE VARCHAR(70), PAI VARCHAR(70), PRONT INTEGER NOT NULL, ENDERECO VARCHAR(40),
  NUMERO INTEGER, COMPL VARCHAR(15), BAIRRO VARCHAR(30), CEP INTEGER, IBGE INTEGER, FONE VARCHAR(15),
  CELULAR VARCHAR(15), IDENT VARCHAR(15), ATIVO CHAR(1), DTOBITO DATE, DATA_HORA_ULTIMA_ATUALIZACAO TIMESTAMP);
CREATE TABLE ATCABECATEND (ID BIGINT NOT NULL PRIMARY KEY, COD_ATENDIMENTO INTEGER NOT NULL,
  ID_RICADPAC INTEGER NOT NULL, DATA_HORA_ENTRADA TIMESTAMP NOT NULL, DATA_HORA_SAIDA_EFETIVA TIMESTAMP,
  DATA_HORA_ALTA_MEDICA TIMESTAMP, TP_ATENDIMENTO CHAR(1) NOT NULL, CARATER_ATEND SMALLINT,
  ID_TBCONVEN SMALLINT NOT NULL, ID_TBCBOPRO_ATENDIMENTO INTEGER, ATIVO CHAR(1), DATA_HORA_ULTIMA_ATUALIZACAO TIMESTAMP);
CREATE TABLE RECADATE (REG INTEGER NOT NULL PRIMARY KEY, ID_ATCABECATEND BIGINT NOT NULL, DT_ATE DATE,
  CONV SMALLINT NOT NULL, ATEND SMALLINT NOT NULL);
CREATE TABLE REALTA (ID_RECADATE INTEGER NOT NULL PRIMARY KEY, DATA_HORA TIMESTAMP NOT NULL,
  ID_TBMOTALT SMALLINT NOT NULL);
"""


def _cpf_falso(r):
    """CPF de teste com dígitos verificadores corretos (gerado; não pertence a ninguém conhecido)."""
    while True:
        n = [r.randint(0, 9) for _ in range(9)]
        if len(set(n)) > 1:
            break
    for t in (10, 11):
        s = sum(d * p for d, p in zip(n, range(t, 1, -1)))
        n.append(0 if s % 11 < 2 else 11 - s % 11)
    return int("".join(map(str, n)))


def _cnpj_falso(base):
    n = [int(c) for c in "%012d" % base]
    p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    for pesos in (p1, [6] + p1):
        s = sum(d * p for d, p in zip(n, pesos))
        n.append(0 if s % 11 < 2 else 11 - s % 11)
    return int("".join(map(str, n)))


def _q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bytes):
        return _hex(v)
    if isinstance(v, str):
        return _hex(v.encode("cp1252"))
    if isinstance(v, (datetime.datetime, datetime.date)):
        return "'%s'" % v.strftime("%Y-%m-%d %H:%M:%S" if isinstance(v, datetime.datetime) else "%Y-%m-%d")
    return str(v)


def _gerar_mapa(r, ins):
    """Linhas falsas das tabelas do mapa, com as anomalias que a carga tem de tratar. Devolve o esperado no destino
    (contagens por entidade e por regra de recusa), anotado aqui na hora de injetar cada anomalia."""
    esp = {"estabelecimento": 0, "usuario": 0, "paciente": 0, "atendimento": 0, "ficha": 0, "alta": 0,
           "recusas": {}}

    def recusa(regra):
        esp["recusas"][regra] = esp["recusas"].get(regra, 0) + 1

    def q(tab, vals):
        ins(tab, [_q(v) for v in vals])
    q("TBTPEMP", [1, "MATRIZ"]); q("TBTPEMP", [2, "FILIAL"])
    q("TBHOSPIT", [1, "Hospital Exemplo Sociedade Simples", "Hospital Exemplo".ljust(50), float(_cnpj_falso(11222333)),
                   1234567, "Rua das Flores", 100, "Bloco A", "Centro", 1310100, "(11) 3000-0000",
                   "contato@exemplo.invalid", datetime.datetime(2001, 3, 1), "naoler"])
    q("TBHOSPIT", [2, "Ambulatório Exemplo", None, 0.0, 0, None, None, None, None, None, None, None,
                   datetime.datetime(1899, 12, 30), None])
    # unidade com o mesmo CNES da 1 (índice único no destino): entra sem CNES, com pendência cnes_duplicado
    q("TBHOSPIT", [3, "Unidade Exemplo Norte", None, 0.0, 1234567, None, None, None, None, None, None, None,
                   datetime.datetime(2010, 5, 1), None])
    esp["estabelecimento"] = 3
    # usuários: 14 linhas; 'Joao Silva' colide no login com 'JOAO SILVA' (recusado); sem CPF, CPF repetido,
    # bloqueado, inativo, login com ':' e espaço
    cpfs_u = [_cpf_falso(r) for _ in range(14)]
    # 'JOÃO SILVA' difere de 'joao.silva' só no acento: a collation do índice único do destino iguala os dois
    nomes = ["ADMIN", "ANA.PAULA", "BRUNO", "CARLA", "DIEGO", "ELISA", "FABIO", "GABI", "HUGO", "IARA", "JOAO SILVA",
             "Joao Silva", "REC:01", "ZECA", "JOÃO SILVA"]
    for i, nome in enumerate(nomes, 1):
        c = cpfs_u[i - 1] if i <= len(cpfs_u) else None
        if nome == "DIEGO":
            c = None
        if nome == "ELISA":
            c = cpfs_u[3]  # repete o CPF de CARLA: entra sem CPF, com pendência
        q("TBUSERS", [nome, i, "I" if nome == "FABIO" else "A", c, "%s@exemplo.invalid" % nome.lower()[:5],
                      "S" if nome == "GABI" else "N", datetime.date(1980, 1, 1) + datetime.timedelta(days=i * 97),
                      "Usuário %s de exemplo" % nome.title(), "naoler", "naoler"])
    esp["usuario"] = len(nomes) - 2
    recusa("login_duplicado"); recusa("login_duplicado")
    # pacientes: 320 linhas (IDs com lacunas); um prontuário repetido (recusado), sem nome (recusado), CPF com dígito
    # errado, CPF repetido, nascimento sentinela, óbito, inativo, telefones bons e ruins, endereço sem CEP
    ids = [i for i in range(1, 400) if i % 5]  # 320 ids
    pront_de = {}
    for n, i in enumerate(ids):
        pront = 5000 + n
        if n == 40:
            pront = pront_de[ids[10]]               # prontuário repetido
        pront_de[i] = pront
        nome = (_nome(r) + b" " + _nome(r)).decode("cp1252") if n != 41 else None
        nasc = datetime.date(1930, 1, 1) + datetime.timedelta(days=r.randint(0, 30000))
        if n % 50 == 7:
            nasc = datetime.date(1899, 12, 30)
        c = float(_cpf_falso(r)) if n % 3 else None
        if n == 60:
            c = 12345678900.0                       # dígito verificador errado
        if n == 61:
            c = None
        if n == 62:
            c = None
        sexo = "MFI"[n % 3] if n % 17 else None
        obito = nasc + datetime.timedelta(days=20000) if n in (70, 71) and nasc.year > 1900 else None
        fone = "(11) 3%03d-%04d" % (n % 1000, n) if n % 4 else ("xx" if n % 8 == 0 else None)
        cel = "119%08d" % (90000000 + n) if n % 2 else None
        cep = 1310100 + n if n % 9 else None
        q("RICADPAC", [i, nome, nasc, sexo, c, ("7%014d" % n) if n % 6 == 0 else ("123" if n == 6 * 7 + 1 else None),
                       "Mae de exemplo %d" % n, None, pront, "Rua Exemplo %d" % n, n if n % 7 else None, None,
                       "Bairro %d" % (n % 9), cep, 3550308, fone, cel, "RG%07d" % n if n % 2 == 0 else None,
                       "N" if n == 80 else "S", obito, datetime.datetime(2026, 1, 1, 8, 0)])
    esp["paciente"] = len(ids) - 2
    recusa("prontuario_duplicado"); recusa("nome_ausente")
    # atendimentos: 520 linhas; órfão (paciente inexistente), filho de paciente recusado, número repetido,
    # categoria desconhecida, caráter vazio (C1: aceito com caráter estimado e pendência), cancelado, saída antes da
    # entrada; fichas e altas
    aceitos = [i for n, i in enumerate(ids) if n not in (40, 41)]
    recusado_pac = ids[40]
    base = datetime.datetime(2025, 6, 1, 7, 0)
    fichas, reg = [], 70000
    numeros = set()
    for n in range(520):
        aid = 900000 + n * 3
        cod = 100000 + n if n != 30 else 100000 + 29   # número repetido
        pac = r.choice(aceitos)
        if n == 31:
            pac = 999999                            # paciente inexistente
        if n == 32:
            pac = recusado_pac                      # paciente recusado (pai pendente)
        tp = "AIEU"[n % 4] if n != 33 else "Z"
        car = 1 + n % 2 if n != 34 else None       # vazio: estimado pela categoria (carater_estimado), não recusa
        entrada = base + datetime.timedelta(minutes=37 * n, microseconds=123456)
        saida = entrada + datetime.timedelta(hours=1 + n % 30) if n % 5 else None
        if n == 35:
            saida = entrada - datetime.timedelta(hours=2)
        alta = saida - datetime.timedelta(minutes=30) if saida and n % 10 == 1 else None
        ativo = "N" if n == 36 else "S"
        if n == 37:
            entrada = datetime.datetime(1899, 12, 30)  # entrada sentinela: recusada com pendência, sem derrubar nada
        q("ATCABECATEND", [aid, cod, pac, entrada, saida, alta, tp, car, 1 + n % 4,
                           None if n % 11 == 0 else 7000 + n % 6, ativo, entrada])
        recusado = n in (30, 31, 32, 33, 37)
        if not recusado:
            esp["atendimento"] += 1
        reg += 1
        q("RECADATE", [reg, aid, entrada.date(), 1 + n % 4, 1])
        if not recusado:
            esp["ficha"] += 1
        if saida and n % 3 == 0 and n != 35:
            q("REALTA", [reg, saida - datetime.timedelta(minutes=10), 1 + n % 3])
            if not recusado:
                esp["alta"] += 1
            else:
                recusa("alta_de_atendimento_recusado")
        if recusado:
            recusa("ficha_de_atendimento_recusado")
    for n in range(2):                              # fichas órfãs
        reg += 1
        q("RECADATE", [reg, 1, None, 1, 1])
        recusa("ficha_de_atendimento_inexistente")
    for x in ("numero_duplicado", "paciente_inexistente", "pai_pendente", "categoria_desconhecida",
              "entrada_sentinela"):
        recusa(x)
    return esp


# bytes de teste: 0x80..0x9F inteiros, mais 'ção' em CP1252
BYTES_C1 = bytes(range(0x80, 0xA0))
BYTES_ACENTO = "ação".encode("cp1252")


def _hex(b):
    return "x'%s'" % b.hex() if b else "''"


def _nome(r):
    s = "".join(r.choice(SILABAS) for _ in range(r.randint(2, 4)))
    return s.capitalize().encode("cp1252")


def nome_modulo(fatia):
    return fatia.lower().replace("-", "_")


def fatias_disponiveis():
    from . import sintetica_d
    return sorted(m.name for m in pkgutil.iter_modules(sintetica_d.__path__) if not m.name.startswith("_"))


def modulo_fatia(fatia):
    nome = nome_modulo(fatia)
    if nome not in fatias_disponiveis():
        raise KeyError("fatia sem imagem sintética: sintetica_d/%s.py" % nome)
    return importlib.import_module("sante_conector.sintetica_d." + nome)


def resolver_fatias(fatias):
    """Fatias pedidas mais as que elas requerem (`REQUER`), requeridas antes, sem repetição."""
    saida = []

    def visitar(f, pilha=()):
        n = nome_modulo(f)
        if n in saida:
            return
        if n in pilha:
            raise ValueError("REQUER circular entre fatias: %s" % ",".join(pilha + (n,)))
        for x in getattr(modulo_fatia(n), "REQUER", []):
            visitar(x, pilha + (n,))
        saida.append(n)
    for f in fatias:
        visitar(f)
    return saida


def _tabelas_ddl(ddl):
    return [t.upper() for t in re.findall(r'CREATE\s+TABLE\s+"?(\w+)"?', ddl, re.I)]


def _colunas_create(st):
    """{COLUNA: tipo} de um CREATE TABLE (sem NOT NULL nem PRIMARY KEY), na ordem."""
    m = re.search(r"\((.*)\)\s*$", st.strip(), re.S)
    if not m:
        return {}
    partes, nivel, atual = [], 0, ""
    for ch in m.group(1):
        nivel += (ch == "(") - (ch == ")")
        if ch == "," and nivel == 0:
            partes.append(atual)
            atual = ""
        else:
            atual += ch
    partes.append(atual)
    saida = {}
    for x in partes:
        x = " ".join(x.split())
        if not x or re.match(r"(PRIMARY|CONSTRAINT|UNIQUE|FOREIGN|CHECK)\b", x, re.I):
            continue
        nome, _, tipo = x.partition(" ")
        tipo = re.sub(r"\b(NOT NULL|PRIMARY KEY|UNIQUE)\b", "", tipo, flags=re.I).strip()
        saida[nome.strip('"').upper()] = tipo
    return saida


def _sem_tabelas(ddl, criadas, alteracoes):
    """DDL sem os CREATE TABLE de tabelas já criadas (`criadas`: {TABELA: {COLUNA: tipo}}); a coluna que a fatia
    declara e a primeira não tem entra por ALTER (anulável), em `alteracoes`, depois das linhas (os INSERT não
    listam as colunas). Devolve (ddl, nomes omitidos)."""
    saida, omit = [], set()
    for st in ddl.split(";"):
        n = _tabelas_ddl(st)
        if n and n[0] in criadas:
            omit.add(n[0])
            for c, tipo in _colunas_create(st).items():
                if c not in criadas[n[0]] and tipo:
                    criadas[n[0]][c] = tipo
                    alteracoes.append('ALTER TABLE %s ADD "%s" %s;' % (n[0], c, tipo))
            continue
        if n:
            criadas[n[0]] = _colunas_create(st)
        saida.append(st)
    return ";".join(saida), omit


def gerar(destino, versao=1, mapa=False, fatias=()):
    """Cria `destino` (não pode existir). Devolve o manifesto (contagens e bytes esperados). `mapa=True` acrescenta as
    tabelas com a forma da origem que o mapa do L3 carrega, e o manifesto traz o esperado no destino."""
    if os.path.exists(destino):
        raise FileExistsError(destino)
    r = random.Random(SEMENTE + versao)
    mods = [(f, modulo_fatia(f)) for f in resolver_fatias(fatias)]
    # tabela da origem criada por mais de uma fatia (ou já criada pelo L3): vale a PRIMEIRA (L3, depois a ordem das
    # fatias); nas seguintes, o CREATE e as linhas dela são omitidos (imagem `lotes`: as fatias se juntam num arquivo)
    criadas, alteracoes = {}, []
    _sem_tabelas(DDL + (DDL_MAPA if mapa else ""), criadas, alteracoes)
    omitidas = {}
    ddl_fatias = []
    for f, m in mods:
        ddl_m, om = _sem_tabelas(m.DDL, criadas, alteracoes)
        omitidas[f] = om
        ddl_fatias.append(ddl_m)
    linhas = ["SET NAMES NONE;", "CREATE DATABASE '%s' PAGE_SIZE 8192 DEFAULT CHARACTER SET NONE;" % destino,
              DDL + (DDL_MAPA if mapa else "") + "".join(ddl_fatias), "COMMIT;"]
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
    esperado = _gerar_mapa(random.Random(SEMENTE + versao + 77), ins) if mapa else None
    esp_fatias, externos = {}, {}
    for f, m in mods:
        semente = SEMENTE + versao + sum(ord(c) for c in f)
        esp_fatias[f] = m.linhas(random.Random(semente),
                                 lambda tab, vals, om=omitidas[f]: None if tab.strip('"').upper() in om
                                 else ins(tab, [_q(v) for v in vals]))
        for t, ks in getattr(m, "PAIS_EXTERNOS", {}).items():
            externos.setdefault(t, [])
            externos[t] += [str(k) for k in ks if str(k) not in externos[t]]
    linhas.append("SET GENERATOR EX_GEN_PESSOA TO %d;" % max(ids))
    if alteracoes:
        linhas += ["COMMIT;"] + alteracoes
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
        "esperado_destino": esperado, "fatias": esp_fatias, "pais_externos": externos, "bytes_c1_hex": BYTES_C1.hex(), "bytes_acento_hex": BYTES_ACENTO.hex(), "anexo_tamanhos": anexos,
    }
    with open(destino[:-4] + ".manifesto.json", "w") as f:
        json.dump(manifesto, f, indent=1, sort_keys=True)
    return manifesto
