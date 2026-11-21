"""Fatia L8-09 (faturamento e restantes, módulo FIN): tabelas da origem com as colunas de
`conector/mapa/declarado/colunas.d/L8-09.tsv`, dados 100% falsos e as anomalias da fatia.

Carregadas (5): períodos de escrituração (forma PRESUMIDA 'mensal'), origens de lançamento contábil (módulo
PRESUMIDO 'manual'), contas de receita do custeio (grupo PRESUMIDO 'outro'), tipos de dado estatístico (unidade
PRESUMIDA), e grupos de exportação de custos (destino PRESUMIDO, ativo A/I).
Recibos: bloqueados (data de emissão DATE em DATETIME, regra pedida), mas já com 13 linhas e as anomalias da
declaração prevista (tipo e extenso presumidos, CPF, situação por de-para, usuário pelo login): PREVISTO_FCRECIBO.
Fora da carga (17, entram na imagem só para provar que nada é gravado): catálogos oficiais (nunca gravados),
domínios de CHECK, parâmetros em colunas, competência ANO+MES e destinos a rever (motivos em colunas.d e pedidos
em saida/L8-09.json).
Anomalias: descrição vazia em destino NOT NULL (1048), data sentinela (data_sentinela + 1048), vigência invertida e
valor zero (CHECK 4025), recibo cancelado sem data e motivo (CHECK 4025), número repetido (1062), CNPJ e CPF com
dígito errado na coluna de CPF (documento_invalido), login sem usuário (pai_inexistente), situação e ativo fora do
domínio (padrão com valor_fora_do_dominio), ordem não numérica (padrão com valor_fora_do_dominio).
"""
import datetime
import decimal

DDL = """
CREATE TABLE CDTPCONTRCAIXA (ID SMALLINT NOT NULL, NOME VARCHAR(30) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE CONIRE (ID_TBUF VARCHAR(2) NOT NULL, COD_NIRE SMALLINT NOT NULL, DATA_VIGENCIA_INICIAL DATE,
  DATA_VIGENCIA_FINAL DATE, PRIMARY KEY (ID_TBUF,COD_NIRE));
CREATE TABLE COPARAM (EMPRESA SMALLINT NOT NULL, USUARIO VARCHAR(31) NOT NULL, ANO SMALLINT, MES SMALLINT,
  PERLANC_INI DATE, PERLANC_FIM DATE, CDC_LANC VARCHAR(1), MASC_CODREF VARCHAR(30), LOTE_LANC VARCHAR(1), ID_PLANO
  VARCHAR(1), DCIGUAL VARCHAR(1), CDC_LANC_DEB VARCHAR(1), CDC_LANC_CRE VARCHAR(1), INTEGRA VARCHAR(1), CDC_IGUAL
  VARCHAR(1), SUGLANC VARCHAR(1), PESQCODOPE VARCHAR(1), DUPLIC_CONTAS VARCHAR(1), OPCOES VARCHAR(20) NOT NULL,
  INTEGRACAO VARCHAR(20) NOT NULL, REFFOL VARCHAR(20), REFFOLHIST SMALLINT, MENSPLS CHAR(1), EMPPART CHAR(1),
  UTILIZAR_GRUPO_REC_DESP_CUSTO CHAR(1), MANTER_FILTROS_ULTIMA_PESQUISA CHAR(1), OLD_CARGO_PROF_CONTABIL
  VARCHAR(25), CAMINHO_VALIDADOR_SPED_CONT VARCHAR(150), EXIBIRVOCESABIASPED VARCHAR(5), PRIMARY KEY
  (EMPRESA,USUARIO));
CREATE TABLE COPERIODESCRIT (ID SMALLINT NOT NULL, NOME VARCHAR(80), DATA_VIGENCIA_INICIAL DATE, DATA_VIGENCIA_FINAL
  DATE, PRIMARY KEY (ID));
CREATE TABLE COSPEDHSTSEMP (ID_COSPEDSITEMP SMALLINT NOT NULL, DATA_VIGENCIA_INICIAL DATE NOT NULL,
  DATA_VIGENCIA_FINAL DATE, PRIMARY KEY (ID_COSPEDSITEMP,DATA_VIGENCIA_INICIAL));
CREATE TABLE COSPEDSITEMP (ID SMALLINT NOT NULL, CODIGO SMALLINT NOT NULL, NOME VARCHAR(25) NOT NULL, PRIMARY KEY
  (ID));
CREATE TABLE COTIPOSOLICITACAOSENHA (ID SMALLINT NOT NULL, NOME VARCHAR(40) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE COTPSUBSTECD (ID CHAR(3) NOT NULL, NOME VARCHAR(100) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE COTP_ORIGEM_LANCAMENTO (ID INTEGER NOT NULL, DESCRICAO VARCHAR(50), PRIMARY KEY (ID));
CREATE TABLE CTCTARECEITANCI (ID INTEGER NOT NULL, NOME VARCHAR(60) NOT NULL, GRUPO CHAR(1) NOT NULL, ORDEM
  VARCHAR(4) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE CTPARAM (MES SMALLINT, ANO SMALLINT, RECCOMP VARCHAR(1), USUARIO VARCHAR(31) NOT NULL, TAB_OCUP
  CHAR(1), ANO_MES INTEGER, REC_NAO_OPER CHAR(1), PRIMARY KEY (USUARIO));
CREATE TABLE CTTIPODADO (ID SMALLINT NOT NULL, NOME VARCHAR(50), PRIMARY KEY (ID));
CREATE TABLE CTWGRUPOEXPORTACAO (ID INTEGER NOT NULL, NOME VARCHAR(30) NOT NULL, STATUS VARCHAR(1) NOT NULL, PRIMARY
  KEY (ID));
CREATE TABLE CTWTPREGRA (ID SMALLINT NOT NULL, NOME VARCHAR(30) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE DMCADLEIAUTE (ANO_REFERENCIA_LEIAUTE SMALLINT NOT NULL, COD_IDENT_ESTRUTURA_LEIAUTE VARCHAR(6) NOT
  NULL, PRIMARY KEY (ANO_REFERENCIA_LEIAUTE));
CREATE TABLE ESTPCODAJUSTE (ID SMALLINT NOT NULL, NOME VARCHAR(255) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE FCRECIBO (ID INTEGER NOT NULL, REC INTEGER NOT NULL, TIPO_CTA VARCHAR(1) NOT NULL, CONTA INTEGER NOT
  NULL, REF SMALLINT NOT NULL, PAGADOR VARCHAR(70), PACIENTE VARCHAR(70), DESC_REF BLOB SUB_TYPE 1, CRM INTEGER,
  DATA DATE, VALOR NUMERIC(18,2), MESPRO SMALLINT, ANOPRO SMALLINT, HORA VARCHAR(4), PROCTO INTEGER, USUARIO
  VARCHAR(31), CONV SMALLINT, CGC_CPF BIGINT, CANCELADO VARCHAR(1), BANCO SMALLINT, AGENCIA INTEGER, C_CORRENTE
  BIGINT, CHEQUE INTEGER, DT_CHEQUE DATE, OBSERVACOES BLOB SUB_TYPE 1, VALIDADO_DMED CHAR(1), ID_TBMOTEXC SMALLINT,
  EMITIDO CHAR(1), TIPO_PRESTADOR SMALLINT, ID_TBCBOPRO INTEGER, PRIMARY KEY (ID));
CREATE TABLE FPFORMATRIBRENDEXT (ID INTEGER NOT NULL, CODIGO INTEGER, DESCRICAO BLOB SUB_TYPE 1, PRIMARY KEY (ID));
CREATE TABLE FPINFOBENEFRENDEXT (ID INTEGER NOT NULL, CODIGO INTEGER, DESCRICAO BLOB SUB_TYPE 1, PRIMARY KEY (ID));
CREATE TABLE FPPARAM_USUARIO (USUARIO VARCHAR(31) NOT NULL, COD_EMP SMALLINT NOT NULL, MES INTEGER NOT NULL, ANO
  INTEGER NOT NULL, ID_REMESSA INTEGER NOT NULL, EXI_INF_INI VARCHAR(1), ALERTAR_FERIAS_A_VENCER_ENT_MOD CHAR(1),
  ALERTAR_CONTR_EXP_ENT_MOD CHAR(1), ALERTAR_PREV_RET_AFAST_ENT_MOD CHAR(1), ALERTAR_VENC_CNH_ENT_MOD CHAR(1),
  ALERTAR_VENC_REG_CLASSE_ENT_MOD CHAR(1), ALERTAR_CONT_PRAZO_DET_ENT_MOD CHAR(1), ALERTAR_PER_FIM_ESTAGIO_ENT_MOD
  CHAR(1), PRIMARY KEY (USUARIO,COD_EMP));
CREATE TABLE FPTP_SERV_NF_TO (COD_TP_SERV INTEGER NOT NULL, DESCRICAO VARCHAR(50), PRIMARY KEY (COD_TP_SERV));
CREATE TABLE GPCOEFICIENTE_DEPREC (ID INTEGER NOT NULL, DESCRICAO VARCHAR(60) NOT NULL, PERCENTUAL NUMERIC(9,2),
  PRIMARY KEY (ID));
"""

PAIS_EXTERNOS = {"TBUSERS": ["caixa.exemplo", "fin.exemplo"]}
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento)")

CARREGADAS = ("COPERIODESCRIT", "COTP_ORIGEM_LANCAMENTO", "CTCTARECEITANCI", "CTTIPODADO", "CTWGRUPOEXPORTACAO")
_TODAS = {
    'CDTPCONTRCAIXA': ('SMALLINT', 'VARCHAR(30)'),
    'CONIRE': ('VARCHAR(2)', 'SMALLINT', 'DATE', 'DATE'),
    'COPARAM': ('SMALLINT', 'VARCHAR(31)', 'SMALLINT', 'SMALLINT', 'DATE', 'DATE', 'VARCHAR(1)', 'VARCHAR(30)',
        'VARCHAR(1)', 'VARCHAR(1)', 'VARCHAR(1)', 'VARCHAR(1)', 'VARCHAR(1)', 'VARCHAR(1)', 'VARCHAR(1)',
        'VARCHAR(1)', 'VARCHAR(1)', 'VARCHAR(1)', 'VARCHAR(20)', 'VARCHAR(20)', 'VARCHAR(20)', 'SMALLINT',
        'CHAR(1)', 'CHAR(1)', 'CHAR(1)', 'CHAR(1)', 'VARCHAR(25)', 'VARCHAR(150)', 'VARCHAR(5)'),
    'COPERIODESCRIT': ('SMALLINT', 'VARCHAR(80)', 'DATE', 'DATE'),
    'COSPEDHSTSEMP': ('SMALLINT', 'DATE', 'DATE'),
    'COSPEDSITEMP': ('SMALLINT', 'SMALLINT', 'VARCHAR(25)'),
    'COTIPOSOLICITACAOSENHA': ('SMALLINT', 'VARCHAR(40)'),
    'COTPSUBSTECD': ('CHAR(3)', 'VARCHAR(100)'),
    'COTP_ORIGEM_LANCAMENTO': ('INTEGER', 'VARCHAR(50)'),
    'CTCTARECEITANCI': ('INTEGER', 'VARCHAR(60)', 'CHAR(1)', 'VARCHAR(4)'),
    'CTPARAM': ('SMALLINT', 'SMALLINT', 'VARCHAR(1)', 'VARCHAR(31)', 'CHAR(1)', 'INTEGER', 'CHAR(1)'),
    'CTTIPODADO': ('SMALLINT', 'VARCHAR(50)'),
    'CTWGRUPOEXPORTACAO': ('INTEGER', 'VARCHAR(30)', 'VARCHAR(1)'),
    'CTWTPREGRA': ('SMALLINT', 'VARCHAR(30)'),
    'DMCADLEIAUTE': ('SMALLINT', 'VARCHAR(6)'),
    'ESTPCODAJUSTE': ('SMALLINT', 'VARCHAR(255)'),
    'FCRECIBO': ('INTEGER', 'INTEGER', 'VARCHAR(1)', 'INTEGER', 'SMALLINT', 'VARCHAR(70)', 'VARCHAR(70)',
        'BLOB SUB_TYPE 1', 'INTEGER', 'DATE', 'NUMERIC(18,2)', 'SMALLINT', 'SMALLINT', 'VARCHAR(4)', 'INTEGER',
        'VARCHAR(31)', 'SMALLINT', 'BIGINT', 'VARCHAR(1)', 'SMALLINT', 'INTEGER', 'BIGINT', 'INTEGER', 'DATE',
        'BLOB SUB_TYPE 1', 'CHAR(1)', 'SMALLINT', 'CHAR(1)', 'SMALLINT', 'INTEGER'),
    'FPFORMATRIBRENDEXT': ('INTEGER', 'INTEGER', 'BLOB SUB_TYPE 1'),
    'FPINFOBENEFRENDEXT': ('INTEGER', 'INTEGER', 'BLOB SUB_TYPE 1'),
    'FPPARAM_USUARIO': ('VARCHAR(31)', 'SMALLINT', 'INTEGER', 'INTEGER', 'INTEGER', 'VARCHAR(1)', 'CHAR(1)',
        'CHAR(1)', 'CHAR(1)', 'CHAR(1)', 'CHAR(1)', 'CHAR(1)', 'CHAR(1)'),
    'FPTP_SERV_NF_TO': ('INTEGER', 'VARCHAR(50)'),
    'GPCOEFICIENTE_DEPREC': ('INTEGER', 'VARCHAR(60)', 'NUMERIC(9,2)'),
}
# recibo: bloqueado (DATE em DATETIME diverge a soma até a regra pedida), mas já com as 13 linhas e as anomalias da
# declaração prevista (saida/L8-09.json); o esperado delas fica em PREVISTO_FCRECIBO
FORMAS_FORA = {t: f for t, f in _TODAS.items() if t not in CARREGADAS and t != "FCRECIBO"}
BLOQUEADAS = tuple(FORMAS_FORA) + ("FCRECIBO",)
PREVISTO_FCRECIBO = {"gravados": 6, "pendencias": {"valor_presumido": 26, "restricao_destino_4025": 2,
                                                   "restricao_destino_1048": 4, "restricao_destino_1062": 1,
                                                   "documento_invalido": 2, "pai_inexistente": 1,
                                                   "valor_fora_do_dominio": 1, "data_sentinela": 1}}

D = decimal.Decimal


def _valor(forma, i, k):
    """Valor falso para a forma da coluna (só presença na imagem)."""
    if forma in ("SMALLINT", "INTEGER", "BIGINT"):
        return i + k
    if forma.startswith("NUMERIC"):
        return D("%d.%02d" % (i + k, k))
    if forma == "DATE":
        return datetime.date(2025, 1 + i % 12, 1 + k % 28)
    if forma.startswith("BLOB"):
        return ("Texto exemplo %d\r\n  linha dois" % i).encode("cp1252")
    n = int(forma.split("(")[1].rstrip(")"))
    return ("E%d" % i) if n >= 2 else "S"


def linhas(r, ins):
    # --- fora da carga: duas linhas por tabela (só presença)
    for t, formas in FORMAS_FORA.items():
        for i in (1, 2):
            ins(t, [_valor(f, i, k) for k, f in enumerate(formas)])

    dt = datetime.date
    # --- períodos de escrituração: 3 sem descrição (1048), 4 fim antes do início (4025), 5 sem início (1048),
    # 6 início repetido no estabelecimento (1062), 7 início sentinela (data_sentinela + 1048)
    for x in [(1, "Mensal  exemplo", dt(2020, 1, 1), None), (2, "Anual exemplo", dt(2021, 1, 1), dt(2021, 12, 31)),
              (3, None, dt(2022, 1, 1), None), (4, "Vigência invertida", dt(2023, 6, 1), dt(2023, 1, 1)),
              (5, "Sem início", None, None), (6, "Repetida", dt(2020, 1, 1), None),
              (7, "Sentinela", dt(1899, 12, 30), None)]:
        ins("COPERIODESCRIT", list(x))
    # --- origens de lançamento: 3 sem descrição (1048); 2 com espaços nas pontas
    for x in [(1, "Financeiro"), (2, "  Faturamento  "), (3, None), (4, "Folha")]:
        ins("COTP_ORIGEM_LANCAMENTO", list(x))
    # --- contas de receita do custeio: 3 nome só espaços (1048), 4 ordem não numérica (padrão 0 + fora do domínio)
    for x in [(1, "Diárias", "D", "1"), (2, "Taxas  e serviços", "T", "0002"), (3, "   ", "T", "3"),
              (4, "Honorários", "H", "A1")]:
        ins("CTCTARECEITANCI", list(x))
    # --- tipos de dado estatístico: 2 sem nome (1048)
    for x in [(1, "Área em m2"), (2, None), (3, "Pacientes  dia")]:
        ins("CTTIPODADO", list(x))
    # --- grupos de exportação: 2 inativo, 3 situação fora do domínio (padrão ativo), 4 nome só espaços (1048)
    for x in [(1, "Exportação própria", "A"), (2, "Federação exemplo", "I"), (3, "Outro grupo", "X"), (4, "   ", "A")]:
        ins("CTWGRUPOEXPORTACAO", list(x))

    # --- recibos (ID, REC, TIPO_CTA, CONTA, REF, PAGADOR, PACIENTE, DESC_REF, CRM, DATA, VALOR, MESPRO, ANOPRO,
    # HORA, PROCTO, USUARIO, CONV, CGC_CPF, CANCELADO, BANCO, AGENCIA, C_CORRENTE, CHEQUE, DT_CHEQUE, OBSERVACOES,
    # VALIDADO_DMED, ID_TBMOTEXC, EMITIDO, TIPO_PRESTADOR, ID_TBCBOPRO)
    ref = "Referente a serviços  hospitalares\r\n  exemplo".encode("cp1252")
    obs = "Observação exemplo".encode("cp1252")
    cpf_ok, cnpj, cpf_dv = 52998224725, 11222333000181, 12345678900  # fictícios (dígito certo, CNPJ, dígito errado)

    def rec(i, numero, pagador="Pagador  Exemplo", desc=ref, data=dt(2025, 3, 10), valor=D("150.00"), usuario=None,
            doc=None, cancelado="N", dmed="S"):
        ins("FCRECIBO", [i, numero, "I", 100 + i, 1, pagador, "Paciente Exemplo", desc, None, data, valor, 3, 2025,
                         "0930", None, usuario, None, doc, cancelado, None, None, None, None, None, obs, dmed, None,
                         "S", None, None])
    rec(1, 1001, usuario="caixa.exemplo", doc=cpf_ok)              # válido
    rec(2, 1002, cancelado=None, dmed=None)                         # válido: situação e DMED pelo padrão
    rec(3, 1003, cancelado="S")                                     # cancelado sem data e motivo: 4025
    rec(4, 1004, valor=D("0.00"))                                   # valor zero: 4025
    rec(5, 1005, pagador=None)                                      # sem pagador: 1048
    rec(6, 1006, desc=None)                                         # sem referente: 1048
    rec(7, 1007, data=None)                                         # sem data: 1048
    rec(8, 1001, usuario="fin.exemplo")                             # número repetido: 1062
    rec(9, 1009, doc=cnpj)                                          # CNPJ na coluna de CPF: documento_invalido
    rec(10, 1010, doc=cpf_dv)                                       # CPF com dígito errado: documento_invalido
    rec(11, 1011, usuario="usuario.inexistente")                    # login sem usuário: NULL + pai_inexistente
    rec(12, 1012, cancelado="X")                                    # situação fora do domínio: padrão emitido
    rec(13, 1013, data=dt(1899, 12, 30))                            # data sentinela: data_sentinela + 1048

    return {
        "COPERIODESCRIT": {"gravados": 2, "pendencias": {"valor_presumido": 7, "restricao_destino_1048": 3,
                                                         "restricao_destino_4025": 1, "restricao_destino_1062": 1,
                                                         "data_sentinela": 1}},
        "COTP_ORIGEM_LANCAMENTO": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
        "CTCTARECEITANCI": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1,
                                                          "valor_fora_do_dominio": 1}},
        "CTTIPODADO": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "CTWGRUPOEXPORTACAO": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1,
                                                             "valor_fora_do_dominio": 1}},
    }
