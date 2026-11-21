"""Fatia L8-04 (faturamento e restantes, módulo FAT): tabelas da origem com a forma do dicionário, dados 100% falsos
e as anomalias da fatia (rodada de cobertura total).

Carregadas (10): tipo de prestador do repasse, tipo de serviço contratado, grupo de ato, tipo de lançamento (duas
origens), função da equipe na cobrança, prestador terceiro (tipo de pessoa PRESUMIDO, CNPJ pela regra), subgrupo de
despesa (subgrupo da natureza financeira, grupo pela referência), preço do procedimento na tabela de honorários (com
o complemento do item faturável do procedimento) e a fórmula de pagamento por via de acesso (vigência da carga).
Fora da carga (13, 2 linhas cada só para presença): 12 descartes com motivo de produto em declarado/sem_carga.tsv e
TBPERTHM (regra faltante no motor: desdobrar no destino principal, pedido em saida/L8-04.json).
PAIS_EXTERNOS: tabela de honorários (TBCTRTHM), grupo de despesa (TBGRUDES), procedimento da tabela (TBPROCTO),
centro de custo (TBCENCUS) e fornecedor (TBFORNEC), registrados como já carregados (ids 1 a 7 pela ordem alfabética da tabela: TBCENCUS 1, TBCTRTHM 2,
TBFORNEC 3, TBGRUDES 4, TBPROCTO 5 a 7); a via de
acesso (TBTISSVIAACES) fica de fora de propósito: nada a carrega ainda e a fórmula mostra a recusa real; PREPARO_DESTINO cria o
estabelecimento único e os itens faturáveis dos procedimentos (ids 5 a 7) que o preço completa.
Anomalias: nome vazio (1048), S/N, 0/1 e sexo fora do domínio, códigos que só diferem pela caixa, pai inexistente
(nulo com pendência, NOT NULL recusa, complemento sem pai recusa), pai recusado (pai_pendente), percentual fora da
faixa, ordem 0 elevada a 1, documento em ponto flutuante (documento_invalido até o pedido 1 e CHECK do documento).
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

CARREGADAS = ('TBGRAUPARTPROC', 'TBRPATPREPASSE', 'TBSRVCON', 'TBTABATO', 'TBTIPO_PROCEDIMENTO', 'TBTPLANC',
              'TBPRESER', 'TBSUBDES', 'TBTABTHM', 'TBFORMULAPAGTO')
DESCARTADAS = ('TBREFMEMTUSS', 'TBREFUNI', 'TBSTATUSPROCESSA', 'TBTPFASEUNIBH', 'TBTIPCOPART', 'TBTISSEMIEXP',
               'TBTISSFORMAENVPAD', 'TBTISSGERSPSADTPS', 'TBTISSPARDEF', 'TBTISSTPGUIA_TBTISSPARDEF', 'TBTISSPOSPROF',
               'TBTIPPRO')
SEM_MECANISMO = ('TBPERTHM',)
BLOQUEADAS = DESCARTADAS + SEM_MECANISMO  # fora do plano de carga (nome mantido para os testes)
# linhas recusadas por pai_inexistente no complemento (não é restrição do destino)
RECUSADAS_SEM_PAI = {"TBTABTHM": 1}

# TBTISSVIAACES NÃO entra: nenhum lote carrega via_acesso_cirurgico (pedido 4), e a fórmula prova a recusa real
PAIS_EXTERNOS = {"TBCTRTHM": ["7"], "TBGRUDES": ["3"], "TBPROCTO": ["501", "502", "503"], "TBCENCUS": ["40"],
                 "TBFORNEC": ["900"]}
PREPARO_DESTINO = (
    "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
    " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
    " INSERT INTO item_faturavel (id, codigo, descricao, tipo_item, grupo_faturamento_id, origem, criado_em) VALUES"
    " (5, 'p501', 'Procedimento exemplo um', 'procedimento', 1, 'migracao', UTC_TIMESTAMP(3)),"
    " (6, 'p502', 'Procedimento exemplo dois', 'procedimento', 1, 'migracao', UTC_TIMESTAMP(3)),"
    " (7, 'p503', 'Procedimento exemplo tres', 'procedimento', 1, 'migracao', UTC_TIMESTAMP(3));")

FORMAS_FORA = {
    'TBPERTHM': ('SMALLINT', 'SMALLINT', 'INTEGER', 'DATE', 'VARCHAR', 'NUMERIC', 'NUMERIC', 'NUMERIC', 'NUMERIC', 'VARCHAR', 'NUMERIC', 'NUMERIC'),
    'TBREFMEMTUSS': ('INTEGER', 'SMALLINT', 'BIGINT', 'SMALLINT', 'INTEGER', 'CHAR', 'DATE', 'DATE'),
    'TBREFUNI': ('SMALLINT', 'INTEGER', 'SMALLINT', 'BIGINT', 'NUMERIC', 'SMALLINT', 'INTEGER', 'INTEGER', 'VARCHAR'),
    'TBSTATUSPROCESSA': ('SMALLINT', 'VARCHAR'),
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

COLS_PRESER = ("ID ATO COD MODULO NOME VINCULO REP_FILME CUSTO CGC_CPF CDC REPASSE PANEST SITUACAO FORN SEM_CESSAO CRM "
               "CNES REP_SOBRE EQV_SGP ENDERECO BAIRRO CIDADE NUMERO CEP UF FONE CBO_ANS ID_TBCBOPRO ID_TBRPATPREPASSE "
               "ID_CDCREDENCIADO ID_TBTPDOCUMENTO").split()
COLS_THM = ("ID_TBPROCTO TAB COD NOME CH AUX FILME COPE INC PROCMED TIPOATO STAND REPASSE DTHPACOTE SEXO PACOTE EVENTO "
            "PMEDICO PPORTE TAB_REF PROC_REF BILATERAL ATOSIP TITULO PERCSANT TIPO_DESP EQUIV_TISS REVISAO INAMPS "
            "QTDE_MAX_GUIA PERC_PROC_ANT PERCSANT_SFILME SITUACAO TAB_REF_TUSS PROC_REF_TUSS ALTA_COMPLEXIDADE "
            "EXIGE_AUTORIZACAO QTDE_MAX_GUIA_EXT LAN_HORA_FINAL DATA_HORA_INCLUSAO DATA_HORA_ULTIMA_ATUALIZACAO "
            "EXPORTAR_TEMPRO FORMA_ENVIO APELIDO_PROCEDIMENTO ID_TBSEXO BLOQUEIO PANE").split()

D = decimal.Decimal


def _dv(base, pesos_lista):
    d = [int(x) for x in base]
    for pesos in pesos_lista:
        r = sum(x * p for x, p in zip(d, pesos)) % 11
        d.append(0 if r < 2 else 11 - r)
    return "".join(map(str, d))


def cnpj_falso(base12):
    return _dv("%012d" % base12, [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]])


def cpf_falso(base9):
    return _dv("%09d" % base9, [list(range(10, 1, -1)), list(range(11, 1, -1))])


def _valor(forma, i, k):
    """Valor falso para a forma da coluna (só presença na imagem)."""
    if forma in ("SMALLINT", "INTEGER", "BIGINT"):
        return i + k
    if forma == "NUMERIC":
        return D("%d.%02d" % (i + k, k))
    if forma == "DATE":
        return datetime.date(2025, 1 + i % 12, 1 + k % 28)
    return "S"  # CHAR/VARCHAR: cabe em qualquer tamanho da fatia


def _linha(cols, **v):
    assert not set(v) - set(cols), set(v) - set(cols)
    return [v.get(c) for c in cols]


def linhas(r, ins):
    # --- fora da carga: duas linhas por tabela (só presença)
    for t, formas in FORMAS_FORA.items():
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

    # --- prestador terceiro: tipo de pessoa presumido (3); CNPJ e CPF vêm em ponto flutuante (documento_invalido até o
    # pedido 1) e sem documento: as três caem no CHECK do documento (4025)
    base = dict(ATO=1, COD=1, MODULO="F", SITUACAO="A", REP_FILME="N", CUSTO="S", PANEST="N", SEM_CESSAO="N",
                REPASSE=D("30.00"), ENDERECO="Rua Exemplo", NUMERO=10, BAIRRO="Centro", CEP=1310100, FONE="1130000000",
                CNES=1234567, ID_TBRPATPREPASSE=1, CDC=40)
    # base do repasse: C, R e Z (fora do domínio); fornecedor 900 externo e 901 inexistente; centro de custo 41
    # inexistente na terceira
    for i, doc, sobre, forn, cdc in [(1, float(cnpj_falso(112223330001)), "C", 900, 40),
                                     (2, float(cpf_falso(529982247)), "R", None, 40), (3, None, "Z", 901, 41)]:
        ins("TBPRESER", _linha(COLS_PRESER, **dict(base, ID=i, NOME="Prestador  exemplo %d" % i, CGC_CPF=doc,
                                                   REP_SOBRE=sobre, FORN=forn, CDC=cdc)))
    # --- subgrupo de despesa: grupo 3 externo; 3 sem nome (1048); grupo 77 inexistente (pai_inexistente + 1048);
    # classificação presumida em toda linha
    for x in [(3, 1, "Material  de escritório", "3.1.01", 40, "S"), (3, 2, "Limpeza", None, 41, "N"),
              (3, 3, None, None, None, None), (77, 1, "Sem grupo", None, None, None)]:
        ins("TBSUBDES", list(x))
    # --- preço do procedimento na tabela 7 (externa) e complemento do item do procedimento (501 a 503 externos)
    ts = datetime.datetime(2025, 3, 1, 8, 30)
    thm = [dict(ID_TBPROCTO=501, TAB=7, COD=10101012, NOME="Consulta  em consultório", CH=100.0, AUX=0, SEXO="A", SITUACAO="A",
                EXIGE_AUTORIZACAO=0, BILATERAL="N", ALTA_COMPLEXIDADE="N", TIPOATO=1, APELIDO_PROCEDIMENTO="Consulta",
                QTDE_MAX_GUIA=0),
           # grupo de ato 9 inexistente: NULL com pai_inexistente (linha gravada)
           dict(ID_TBPROCTO=502, TAB=7, COD=30101010, NOME="Cirurgia exemplo", CH=250.5, AUX=2, FILME=0.5, INC=1, SITUACAO="I",
                SEXO="F", EXIGE_AUTORIZACAO=1, BILATERAL="S", ALTA_COMPLEXIDADE="S", TIPOATO=9, QTDE_MAX_GUIA=2),
           # autorização 5 e sexo X fora do domínio: o item fica com o que tinha (2 valor_fora_do_dominio)
           dict(ID_TBPROCTO=503, TAB=7, COD=40301010, NOME="Exame exemplo", CH=None, EXIGE_AUTORIZACAO=5, SEXO="X",
                SITUACAO="Q"),
           # tabela 8 inexistente: pai_inexistente e NOT NULL (1048)
           dict(ID_TBPROCTO=501, TAB=8, COD=1, NOME="Sem tabela", CH=1.0),
           # procedimento 999 inexistente: o complemento recusa a linha (pai_inexistente)
           dict(ID_TBPROCTO=999, TAB=7, COD=50000001, NOME="Sem procedimento", CH=1.0)]
    for x in thm:
        ins("TBTABTHM", _linha(COLS_THM, DATA_HORA_INCLUSAO=ts, DATA_HORA_ULTIMA_ATUALIZACAO=ts, **x))
    # --- fórmula de pagamento: via 9 inexistente (pai_inexistente + 1048); percentual 1500 fora da faixa (NULL + 1048);
    # ordem 0 elevada a 1 e ativo X fora do domínio (gravada); tipo de lançamento 3 recusado (pai_pendente)
    for x in [(1, "Via única principal", 1, 1, D("100.00"), 0, 1, "S"), (2, "Mesma via demais", 1, 2, D("50.00"), 0, 2, "S"),
              (3, "Via inexistente", 1, 9, D("70.00"), 0, 1, "S"), (4, "Percentual alto", 2, 1, D("1500.00"), 0, 1, "N"),
              (5, "Ordem zero", 2, 2, D("70.00"), 0, 0, "X"), (6, "Tipo recusado", 3, 1, D("100.00"), 0, 3, "S")]:
        ins("TBFORMULAPAGTO", list(x))

    return {
        "TBRPATPREPASSE": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "TBSRVCON": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
        "TBTABATO": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "TBTIPO_PROCEDIMENTO": {"gravados": 2, "pendencias": {"codigo_colisao_caixa": 2, "valor_fora_do_dominio": 2,
                                                              "restricao_destino_1048": 1}},
        "TBTPLANC": {"gravados": 3, "pendencias": {"valor_presumido": 8, "restricao_destino_1048": 1}},
        "TBGRAUPARTPROC": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
        "TBPRESER": {"gravados": 0, "pendencias": {"valor_presumido": 3, "documento_invalido": 2,
                                                   "pai_inexistente": 2, "valor_fora_do_dominio": 1,
                                                   "restricao_destino_4025": 3}},
        "TBSUBDES": {"gravados": 2, "pendencias": {"valor_presumido": 4, "pai_inexistente": 2,
                                                   "restricao_destino_1048": 2}},
        "TBTABTHM": {"gravados": 3, "pendencias": {"pai_inexistente": 3, "valor_fora_do_dominio": 3,
                                                   "restricao_destino_1048": 1}},
        # sem via de acesso carregada (pedido 4) toda fórmula é recusada: 5 pai_inexistente + 1048, 1 pai_pendente
        "TBFORMULAPAGTO": {"gravados": 0, "pendencias": {"vigencia_sem_fonte": 5, "valor_presumido": 5,
                                                         "pai_inexistente": 5, "restricao_destino_1048": 5,
                                                         "valor_fora_do_dominio": 2, "valor_elevado_ao_minimo": 1,
                                                         "pai_pendente": 1}},
    }
