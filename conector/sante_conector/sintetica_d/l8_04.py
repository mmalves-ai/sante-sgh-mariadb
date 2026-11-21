"""Fatia L8-04 (faturamento e restantes, módulo FAT): tabelas da origem com a forma do dicionário, dados 100% falsos
e as anomalias da fatia.

Carregadas (6): tipo de prestador do repasse (categoria PRESUMIDA 'outro'), tipo de serviço contratado (categoria
PRESUMIDA), grupo de ato (filme e alta complexidade S/N), tipo de lançamento vindo de duas origens (código de 2
letras com natureza e repasse pelo de-para do código; id da outra com natureza e repasse PRESUMIDOS) e função da equipe na cobrança (tipo PRESUMIDO).
Fora da carga (17, entram com 2 linhas cada só para provar que nada é gravado): motivos em colunas.d/L8-04.tsv e
pedidos em saida/L8-04.json (catálogo TUSS e terminologia TISS oficiais, fonte pagadora ou contrato NOT NULL sem
origem, documento CPF/CNPJ num só campo, desdobrar percentuais em linhas, domínios enumerados sem linha própria).
Anomalias: nome vazio ou só espaços em destino NOT NULL (1048), S/N fora do domínio (padrão com pendência), códigos
que só diferem pela caixa (codigo_colisao_caixa: o grupo todo recusado), código de natureza fora do domínio (recusado), nome com espaços repetidos.
"""
import datetime
import decimal

DDL = """
CREATE TABLE TBREFMEMTUSS (ID INTEGER NOT NULL, TAB_FCREFUND SMALLINT NOT NULL, COD_FCREFUND BIGINT NOT NULL,
  CLASSIF_FCREFUND SMALLINT NOT NULL, COD_TUSS INTEGER NOT NULL, OLD_ATIVO CHAR(1), DATA_VIGENCIA_INICIAL DATE,
  DATA_VIGENCIA_FINAL DATE, PRIMARY KEY (ID));
CREATE TABLE TBREFUNI (TAB SMALLINT NOT NULL, COD INTEGER NOT NULL, CLASSIF SMALLINT, CODREF BIGINT, CONDIA
  NUMERIC(9,2), CLASSIFREF SMALLINT, ID_TBMATMED INTEGER NOT NULL, OLD_ID_TBREFMEMTUSS INTEGER, COD_ALFAREF
  VARCHAR(4), PRIMARY KEY (TAB,COD));
CREATE TABLE TBRPATPREPASSE (ID SMALLINT NOT NULL, NOME VARCHAR(10), PRIMARY KEY (ID));
CREATE TABLE TBPRESER (ID INTEGER NOT NULL, ATO SMALLINT NOT NULL, COD SMALLINT NOT NULL, MODULO CHAR(1) NOT NULL,
  NOME VARCHAR(70), VINCULO SMALLINT, REP_FILME VARCHAR(1), CUSTO VARCHAR(1), CGC_CPF DOUBLE PRECISION, CDC INTEGER,
  REPASSE NUMERIC(9,2), PANEST VARCHAR(1), SITUACAO VARCHAR(1), FORN INTEGER, SEM_CESSAO VARCHAR(1), CRM INTEGER,
  CNES INTEGER, REP_SOBRE VARCHAR(1), EQV_SGP INTEGER, ENDERECO VARCHAR(45), BAIRRO VARCHAR(30), CIDADE VARCHAR(30),
  NUMERO INTEGER, CEP INTEGER, UF VARCHAR(2), FONE VARCHAR(15), CBO_ANS INTEGER, ID_TBCBOPRO INTEGER,
  ID_TBRPATPREPASSE SMALLINT, ID_CDCREDENCIADO INTEGER, ID_TBTPDOCUMENTO SMALLINT, PRIMARY KEY (ID));
CREATE TABLE TBSRVCON (COD INTEGER NOT NULL, NOME VARCHAR(60), PRIMARY KEY (COD));
CREATE TABLE TBSTATUSPROCESSA (ID SMALLINT NOT NULL, NOME VARCHAR(40) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE TBSUBDES (GRUPO INTEGER NOT NULL, SUBGRUPO INTEGER NOT NULL, NOME VARCHAR(40), CODCONT VARCHAR(15), CDC
  INTEGER, DESCONTO VARCHAR(1), PRIMARY KEY (GRUPO,SUBGRUPO));
CREATE TABLE TBTABATO (COD SMALLINT NOT NULL, NOME VARCHAR(50), FILME VARCHAR(1), ALTA_COMPLEXIDADE VARCHAR(1),
  PRIMARY KEY (COD));
CREATE TABLE TBTABTHM (ID_TBPROCTO INTEGER NOT NULL, TAB SMALLINT NOT NULL, COD INTEGER NOT NULL, NOME VARCHAR(60),
  CH DOUBLE PRECISION, AUX SMALLINT, FILME DOUBLE PRECISION, COPE DOUBLE PRECISION, INC SMALLINT, PROCMED
  VARCHAR(1), TIPOATO SMALLINT, STAND VARCHAR(1), REPASSE SMALLINT, DTHPACOTE INTEGER, SEXO VARCHAR(1), PACOTE
  VARCHAR(1), EVENTO SMALLINT, PMEDICO VARCHAR(3), PPORTE NUMERIC(9,2), TAB_REF SMALLINT, PROC_REF BIGINT, BILATERAL
  VARCHAR(1), ATOSIP SMALLINT, TITULO VARCHAR(1), PERCSANT NUMERIC(9,2), TIPO_DESP SMALLINT, EQUIV_TISS SMALLINT,
  REVISAO VARCHAR(1), INAMPS INTEGER, QTDE_MAX_GUIA SMALLINT, PERC_PROC_ANT NUMERIC(9,2), PERCSANT_SFILME
  VARCHAR(1), SITUACAO VARCHAR(1), TAB_REF_TUSS SMALLINT, PROC_REF_TUSS INTEGER, ALTA_COMPLEXIDADE VARCHAR(1),
  EXIGE_AUTORIZACAO SMALLINT, QTDE_MAX_GUIA_EXT SMALLINT, LAN_HORA_FINAL VARCHAR(1), DATA_HORA_INCLUSAO TIMESTAMP,
  DATA_HORA_ULTIMA_ATUALIZACAO TIMESTAMP, EXPORTAR_TEMPRO SMALLINT, FORMA_ENVIO CHAR(1), APELIDO_PROCEDIMENTO
  VARCHAR(40), ID_TBSEXO INTEGER, BLOQUEIO CHAR(1), PANE VARCHAR(2), PRIMARY KEY (TAB,COD));
CREATE TABLE TBPERTHM (CONV SMALLINT NOT NULL, TAB SMALLINT NOT NULL, PROCTO INTEGER NOT NULL, DATA DATE NOT NULL,
  TIPO_PAC VARCHAR(1) NOT NULL, PERC_CH NUMERIC(9,2), PERC_COPE NUMERIC(9,2), PERC_ANEST NUMERIC(9,2), PERC_N_CRED
  NUMERIC(9,2), CH_VALOR_CRED VARCHAR(1), PERC_FILME NUMERIC(9,2), PERC_APOS_HORARIO NUMERIC(9,2), PRIMARY KEY
  (CONV,TAB,PROCTO,DATA,TIPO_PAC));
CREATE TABLE TBTIPCOPART (ID SMALLINT NOT NULL, NOME VARCHAR(10) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE TBTIPO_PROCEDIMENTO (ID SMALLINT NOT NULL, CODIGO VARCHAR(2) NOT NULL, DESCRICAO VARCHAR(40) NOT NULL,
  PRIMARY KEY (ID));
CREATE TABLE TBTIPPRO (PROCTO INTEGER NOT NULL, TIPO SMALLINT NOT NULL, PRIMARY KEY (PROCTO,TIPO));
CREATE TABLE TBTISSEMIEXP (ID SMALLINT NOT NULL, NOME VARCHAR(15) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE TBTISSFORMAENVPAD (ID SMALLINT NOT NULL, NOME VARCHAR(20) NOT NULL, DATA_VIGENCIA_INICIAL DATE,
  DATA_VIGENCIA_FINAL DATE, PRIMARY KEY (ID));
CREATE TABLE TBTISSGERSPSADTPS (ID SMALLINT NOT NULL, NOME VARCHAR(60) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE TBTISSPARDEF (ID SMALLINT NOT NULL, NOME VARCHAR(100) NOT NULL, ID_TBTISSEMIEXP SMALLINT NOT NULL,
  PRIMARY KEY (ID));
CREATE TABLE TBTISSPOSPROF (ID SMALLINT NOT NULL, NOME VARCHAR(50), PRIMARY KEY (ID));
CREATE TABLE TBGRAUPARTPROC (ID SMALLINT NOT NULL, NOME VARCHAR(45) NOT NULL, ID_TBTISSPOSPROF SMALLINT, PRIMARY KEY
  (ID));
CREATE TABLE TBTISSTPGUIA_TBTISSPARDEF (ID_TBTISSTPGUIA SMALLINT NOT NULL, ID_TBTISSPARDEF SMALLINT NOT NULL,
  PRIMARY KEY (ID_TBTISSTPGUIA,ID_TBTISSPARDEF));
CREATE TABLE TBTPFASEUNIBH (ID SMALLINT NOT NULL, NOME VARCHAR(40) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE TBTPLANC (ID SMALLINT NOT NULL, NOME VARCHAR(25) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE TBFORMULAPAGTO (ID SMALLINT NOT NULL, NOME VARCHAR(30) NOT NULL, ID_TBTPLANC SMALLINT NOT NULL,
  ID_TBTISSVIAACES SMALLINT NOT NULL, PERCENTUAL NUMERIC(9,2), CONSIDERAR SMALLINT, ORDEM SMALLINT, ATIVO CHAR(1),
  PRIMARY KEY (ID));
"""

CARREGADAS = ('TBGRAUPARTPROC', 'TBRPATPREPASSE', 'TBSRVCON', 'TBTABATO', 'TBTIPO_PROCEDIMENTO', 'TBTPLANC')
FORMAS_BLOQUEADAS = {
    'TBFORMULAPAGTO': ('SMALLINT', 'VARCHAR', 'SMALLINT', 'SMALLINT', 'NUMERIC', 'SMALLINT', 'SMALLINT', 'CHAR'),
    'TBPERTHM': ('SMALLINT', 'SMALLINT', 'INTEGER', 'DATE', 'VARCHAR', 'NUMERIC', 'NUMERIC', 'NUMERIC', 'NUMERIC', 'VARCHAR', 'NUMERIC', 'NUMERIC'),
    'TBPRESER': ('INTEGER', 'SMALLINT', 'SMALLINT', 'CHAR', 'VARCHAR', 'SMALLINT', 'VARCHAR', 'VARCHAR', 'NUMERIC', 'INTEGER', 'NUMERIC', 'VARCHAR', 'VARCHAR', 'INTEGER', 'VARCHAR', 'INTEGER', 'INTEGER', 'VARCHAR', 'INTEGER', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'INTEGER', 'INTEGER', 'VARCHAR', 'VARCHAR', 'INTEGER', 'INTEGER', 'SMALLINT', 'INTEGER', 'SMALLINT'),
    'TBREFMEMTUSS': ('INTEGER', 'SMALLINT', 'BIGINT', 'SMALLINT', 'INTEGER', 'CHAR', 'DATE', 'DATE'),
    'TBREFUNI': ('SMALLINT', 'INTEGER', 'SMALLINT', 'BIGINT', 'NUMERIC', 'SMALLINT', 'INTEGER', 'INTEGER', 'VARCHAR'),
    'TBSTATUSPROCESSA': ('SMALLINT', 'VARCHAR'),
    'TBSUBDES': ('INTEGER', 'INTEGER', 'VARCHAR', 'VARCHAR', 'INTEGER', 'VARCHAR'),
    'TBTABTHM': ('INTEGER', 'SMALLINT', 'INTEGER', 'VARCHAR', 'NUMERIC', 'SMALLINT', 'NUMERIC', 'NUMERIC', 'SMALLINT', 'VARCHAR', 'SMALLINT', 'VARCHAR', 'SMALLINT', 'INTEGER', 'VARCHAR', 'VARCHAR', 'SMALLINT', 'VARCHAR', 'NUMERIC', 'SMALLINT', 'BIGINT', 'VARCHAR', 'SMALLINT', 'VARCHAR', 'NUMERIC', 'SMALLINT', 'SMALLINT', 'VARCHAR', 'INTEGER', 'SMALLINT', 'NUMERIC', 'VARCHAR', 'VARCHAR', 'SMALLINT', 'INTEGER', 'VARCHAR', 'SMALLINT', 'SMALLINT', 'VARCHAR', 'TIMESTAMP', 'TIMESTAMP', 'SMALLINT', 'CHAR', 'VARCHAR', 'INTEGER', 'CHAR', 'VARCHAR'),
    'TBTIPCOPART': ('SMALLINT', 'VARCHAR'),
    'TBTIPPRO': ('INTEGER', 'SMALLINT'),
    'TBTISSEMIEXP': ('SMALLINT', 'VARCHAR'),
    'TBTISSFORMAENVPAD': ('SMALLINT', 'VARCHAR', 'DATE', 'DATE'),
    'TBTISSGERSPSADTPS': ('SMALLINT', 'VARCHAR'),
    'TBTISSPARDEF': ('SMALLINT', 'VARCHAR', 'SMALLINT'),
    'TBTISSPOSPROF': ('SMALLINT', 'VARCHAR'),
    'TBTISSTPGUIA_TBTISSPARDEF': ('SMALLINT', 'SMALLINT'),
    'TBTPFASEUNIBH': ('SMALLINT', 'VARCHAR'),
}
BLOQUEADAS = tuple(FORMAS_BLOQUEADAS)

D = decimal.Decimal


def _valor(forma, i, k):
    """Valor falso para a forma da coluna (só presença na imagem)."""
    if forma in ("SMALLINT", "INTEGER", "BIGINT"):
        return i + k
    if forma == "NUMERIC":
        return D("%d.%02d" % (i + k, k))
    if forma == "DATE":
        return datetime.date(2025, 1 + i % 12, 1 + k % 28)
    if forma == "TIMESTAMP":
        return datetime.datetime(2025, 1 + i % 12, 1 + k % 28, 8, 30)
    return "S"  # CHAR/VARCHAR: cabe em qualquer tamanho da fatia


def linhas(r, ins):
    # --- fora da carga: duas linhas por tabela (só presença)
    for t, formas in FORMAS_BLOQUEADAS.items():
        for i in (1, 2):
            ins(t, [_valor(f, i, k) for k, f in enumerate(formas)])

    # --- tipo de prestador do repasse: 3 sem nome (1048); categoria presumida em toda linha lida
    for x in [(1, "Médico"), (2, "Pessoa  PJ"), (3, None)]:
        ins("TBRPATPREPASSE", list(x))
    # --- tipo de serviço contratado: 3 só espaços (1048); categoria presumida
    for x in [(1, "Internação"), (2, "Laboratório   clínico"), (3, "   "), (4, "Imagem")]:
        ins("TBSRVCON", list(x))
    # --- grupo de ato: 3 com S/N fora do domínio (padrão FALSE + valor_fora_do_dominio), 4 sem nome (1048)
    for x in [(1, "Patologia  clínica", "N", "N"), (2, "Radiologia", "S", None), (3, "Cardiologia", "X", "S"),
              (4, None, "N", "N")]:
        ins("TBTABATO", list(x))
    # --- tipo de lançamento (origem 1): natureza e repasse pelo código (de-para de valores); 'MM' e 'mm' só diferem
    # pela caixa (os dois recusados antes de gravar); 'XX' fora do domínio (valor_fora_do_dominio na natureza e no
    # repasse, recusa 1048)
    for x in [(1, "SH", "Serviço hospitalar"), (2, "SP", "Serviço profissional"), (3, "MM", "Materiais e medicamentos"),
              (4, "mm", "Serviço exemplo"), (5, "XX", "Código fora do domínio")]:
        ins("TBTIPO_PROCEDIMENTO", list(x))
    # --- tipo de lançamento (origem 2): natureza e repasse presumidos (nome livre: 2 valor_presumido por linha); 3 só espaços (1048)
    for x in [(1, "Cirurgia"), (2, "Honorário   médico"), (3, "  "), (4, "Taxas")]:
        ins("TBTPLANC", list(x))
    # --- função da equipe na cobrança: 3 nome vazio (1048); grau TISS não aproveitado; tipo presumido
    for x in [(1, "Cirurgião", 1), (2, "Primeiro  auxiliar", 2), (3, "", None), (4, "Anestesista", 6)]:
        ins("TBGRAUPARTPROC", list(x))

    return {
        "TBRPATPREPASSE": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "TBSRVCON": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
        "TBTABATO": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "TBTIPO_PROCEDIMENTO": {"gravados": 2, "pendencias": {"codigo_colisao_caixa": 2, "valor_fora_do_dominio": 2,
                                                              "restricao_destino_1048": 1}},
        "TBTPLANC": {"gravados": 3, "pendencias": {"valor_presumido": 8, "restricao_destino_1048": 1}},
        "TBGRAUPARTPROC": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
    }
