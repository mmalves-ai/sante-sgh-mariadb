"""Fatia L8-11 (financeiro: bancos, borderô, centro de custo, cliente, tipos de ajuste e títulos, módulo FIN): tabelas
da origem com a forma do dicionário e dados 100% falsos.

Carregadas (CARREGADAS), com as anomalias:
- TBAGEBAN (agência): banco pelo código de compensação guardado na tabela de bancos da origem (TBBANCOS, só lida);
  banco sem código e banco fora do catálogo (o NOT NULL recusa), a mesma agência em outra empresa (adotada), CEP zero
  e com 9 dígitos (NULL com pendência);
- TBCTABAN (conta): tipo e situação pelo de-para; sem descrição (recusa), agência recusada (pai_pendente), limite,
  último cheque e sequência negativos (NULL ou padrão), situação fora do de-para (padrão), conta de outra empresa
  na agência adotada; o número interno ID_CTABAN DIFERENTE do ID (como na origem real);
- MFBORDER (borderô): conta recusada (pai_pendente), conta nunca vista (pai_inexistente e recusa), pagamento
  sentinela, faixa invertida (CHECK), número repetido (chave única), valor negativo (padrão 0), situação presumida;
- MFCTAUSU (permissão de conta): usuário pela chave alternativa ID_TBUSERS e conta pela chave alternativa ID_CTABAN;
  conta recusada, usuário inexistente, número de conta inexistente; movimento presumido;
- TBCENCUS (centro de custo): ID diferente do COD (as filhas usam o ID), vigência da carga (vigencia_sem_fonte), sem
  nome (recusa), situação fora de A/I, unidade de mensuração inexistente (pai_inexistente), código da apuração;
- TBCLIENT (cliente): CPF ou CNPJ pelo tipo; o outro documento vira NULL com documento_invalido; documento que não
  casa com o tipo (CHECK); município pelo código IBGE (ausente no catálogo: catalogo_codigo_inexistente);
- MFREFDES (tipo de ajuste): natureza pelo de-para de TIPO (desconto, acréscimo, retenção sem tributo recusada pela
  CHECK, código sem par recusado), lados pagar/receber presumidos, o mesmo código em outra empresa (chave única
  recusa), sem descrição, natureza financeira pelo item do plano (composta; inexistente: pai_inexistente);
- TBGRUDES (grupo da natureza): tipo pelo de-para, centro de custo pela origem (recusado: pai_pendente; inexistente:
  pai_inexistente), sem nome, classificação e situação fora do domínio.
Não carregadas (NAO_CARREGADAS, sem coluna com destino): títulos a pagar e a receber, adiantamentos, lançamentos,
compensações, ajustes, dados fiscais e saldos: falta mecanismo genérico do motor (pedidos em
docs/obra/fatias/f4/saida/L8-11.json; saldos com declaração pronta e comentada).
TBBANCOS e TBUSERS entram só como origem lida pelas referências (de outras fatias; nenhuma coluna declarada aqui).
"""
import datetime
import decimal
import re

DDL = """
CREATE TABLE TBAGEBAN ("EMPRESA" INTEGER NOT NULL, "BANCO" INTEGER NOT NULL, "COD" INTEGER NOT NULL, "DESCRICAO"
  VARCHAR(30), "ENDERECO" VARCHAR(30), "MOD_CHEQUE" SMALLINT, "BAIRRO" VARCHAR(30), "CIDADE" VARCHAR(30), "UF"
  VARCHAR(2), "FONE" VARCHAR(15), "CEP" INTEGER, "DV_AGENCIA" VARCHAR(2), PRIMARY KEY ("EMPRESA", "BANCO", "COD"));
CREATE TABLE TBCENCUS ("COD" INTEGER NOT NULL, "NOME" VARCHAR(50), "SIGLA" VARCHAR(8), "LOCCON" SMALLINT, "ENDERECO"
  VARCHAR(45), "BAIRRO" VARCHAR(30), "CIDADE" VARCHAR(30), "UF" VARCHAR(2), "FONE" VARCHAR(15), "CEP" INTEGER, "INSCR"
  VARCHAR(15), "PERC_MEDC" DOUBLE PRECISION, "PERC_MEDO" DOUBLE PRECISION, "RC_INI" INTEGER, "RC_FIN" INTEGER,
  "REF_CONT" VARCHAR(10), "GRUPO" SMALLINT, "FORMULA" SMALLINT, "CLASSIF" SMALLINT, "SITUACAO" VARCHAR(1), "PRODUTIVO"
  VARCHAR(1), "UNIDADE" SMALLINT, "CGC" BIGINT, "REP_MAT" NUMERIC(9,2), "REP_MED" NUMERIC(9,2), "CONTABIL" BIGINT,
  "TIP_PRECO" VARCHAR(1), "UNIMEN" SMALLINT, "MOVIMENTACAO" VARCHAR(1), "LUCRO_ESP" NUMERIC(9,2), "INVEST"
  NUMERIC(9,2), "RISCOS" NUMERIC(9,2), "LOCARM" SMALLINT, "COB_PERC" VARCHAR(1), "ID" INTEGER NOT NULL,
  "DATA_HORA_GRAV" TIMESTAMP, "CUSTO_VAR_COMPOE_ITEM_PROD" CHAR(1), "ID_CHCRITICIDADE" SMALLINT,
  "PERMITIR_EVOLUCAO_GRUPO_PEP" CHAR(1), "COD_APURASUS" BIGINT, "INDICADOR_PRODUCAO" INTEGER,
  "CODIGO_EXTERNO_ITEM_PRODUCAO" BIGINT, PRIMARY KEY ("COD"));
CREATE TABLE TBCLIENT ("COD" INTEGER NOT NULL, "NOME" VARCHAR(70), "EMAIL" VARCHAR(30), "ENDERECO" VARCHAR(35),
  "BAIRRO" VARCHAR(20), "CIDADE" VARCHAR(20), "UF" VARCHAR(2), "CONTATO" VARCHAR(25), "FONE" VARCHAR(15), "FAX"
  VARCHAR(15), "CEP" INTEGER, "PESSOA" VARCHAR(1), "CPFCGC" BIGINT NOT NULL, "NUM_ENDERECO" INTEGER, "COMPL_ENDERECO"
  VARCHAR(15), "ID_TBMUIBGE" INTEGER, PRIMARY KEY ("COD"));
CREATE TABLE TBCTABAN ("ID" INTEGER NOT NULL, "COD" BIGINT NOT NULL, "BANCO" INTEGER NOT NULL, "AGENCIA" INTEGER NOT
  NULL, "EMPRESA" INTEGER NOT NULL, "DESCRICAO" VARCHAR(30), "TP_CONTA" CHAR(1), "CHE_ESP" NUMERIC(18,2), "ID_CTABAN"
  SMALLINT NOT NULL, "ULTIMO_CHEQUE" INTEGER, "DIGITO" VARCHAR(2), "SITUACAO" VARCHAR(1), "INTEGRAR_CONTABILIDADE"
  CHAR(1), "CONTA_RESTRICAO" CHAR(1), "NUMERO_SEQ_REMESSA_COBRANCA" INTEGER NOT NULL, "DIG_VERIFICADOR_AGENCIA_CONTA"
  SMALLINT, "NUMERO_SEQ_REMESSA_FOLHA" INTEGER, "NUMERO_SEQ_ENVIO_COBRANCA" INTEGER, PRIMARY KEY ("ID"));
CREATE TABLE MFBORDER ("ID" INTEGER NOT NULL, "EMPRESA" SMALLINT NOT NULL, "BORDERO" INTEGER NOT NULL, "BANCO"
  SMALLINT NOT NULL, "AGENCIA" INTEGER NOT NULL, "CONTA" BIGINT NOT NULL, "DATA" DATE, "VALOR" NUMERIC(18,2) NOT NULL,
  "HORA" CHAR(6), "USUARIO" VARCHAR(31), "EMISSAO" DATE, "VENC_I" DATE, "VENC_F" DATE, "HIST_COD" SMALLINT, "REFER"
  SMALLINT, "ID_TBCTABAN" INTEGER NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE MFCONPAG ("ID" INTEGER NOT NULL, "EMPRESA" SMALLINT NOT NULL, "FORN" INTEGER NOT NULL, "DOC" INTEGER NOT
  NULL, "PARC" SMALLINT NOT NULL, "TIPO" VARCHAR(1) NOT NULL, "SERIE" VARCHAR(3) NOT NULL, "VENC" DATE, "DT_PGTO"
  DATE, "DOC_EST" INTEGER, "VALOR" NUMERIC(18,2), "PAGO" NUMERIC(18,2), "ACRESCIMO" NUMERIC(18,2), "DOC_USADO"
  VARCHAR(15), "EMISSAO" DATE, "REFERENTE" VARCHAR(60), "PERC" NUMERIC(4,2), "DESCONTO" NUMERIC(18,2), "CONSOL"
  VARCHAR(1), "ONDE" VARCHAR(1), "EMI_NF" DATE, "DATADO" DATE, "OBS" VARCHAR(100), "BANCO" SMALLINT, "CHEQUE" INTEGER,
  "STATUS" SMALLINT, "PAGO_COM" VARCHAR(1), "USUARIO" VARCHAR(31), "FAVORECIDO" CHAR(1), "TP_PGTO" SMALLINT, "CONV"
  SMALLINT, "GLOSAS" NUMERIC(18,2), "HIST_CONT" SMALLINT, "TP_FORNPRES" CHAR(1), "SEQ_AP" INTEGER, "MES_CONT"
  SMALLINT, "ANO_CONT" SMALLINT, "DOC_CONT" INTEGER, "ANO_CONTB" SMALLINT, "MES_CONTB" SMALLINT, "DOC_CONTB" INTEGER,
  "AGENCIA" INTEGER, "CONTA" BIGINT, "VLR_DOC_TOT" NUMERIC(18,2), "NF" INTEGER NOT NULL, "BORDERO" INTEGER NOT NULL,
  "OBS_RPA" VARCHAR(100), "OLD_AUTORIZADO" CHAR(1), "TP_DOCTO" CHAR(1), "DOC_CONT_CHE" INTEGER, "HIST_CONTB" SMALLINT,
  "VLR_GLOSAS" NUMERIC(18,2), "EMPENHO" INTEGER, "SUBEMPENHO" INTEGER, "PROCESSO" INTEGER, "ANO_PROCESSO" SMALLINT,
  "PARC_DIF" CHAR(1), "ID_MFCONPAG" INTEGER NOT NULL, "NUMERO_RPA" INTEGER, "ID_RPRPA" INTEGER, "OLD_ID_TBCBOPRO"
  INTEGER, "PARC_ORIG" SMALLINT NOT NULL, "ID_MFPAGADF" INTEGER, "ENTRADA" DATE, "DATA_HORA_INCLUSAO" TIMESTAMP,
  "DATA_HORA_ULTIMA_ATUALIZACAO" TIMESTAMP, "DATA_PREVISTA_PGTO" DATE, "OLD_VLR_PREVISTO_PGTO" NUMERIC(18,2),
  "ID_MFCABECLANC" INTEGER NOT NULL, "ID_MFTIPOLANC" SMALLINT NOT NULL, "AUTORIZADO_PGTO_PARA" DATE,
  "ID_MFCABECRENEGO" INTEGER, "ID_FPESOCFECEVT" INTEGER, "DATA_HORA_INC_ULT_ALT_ESOC" TIMESTAMP,
  "ID_ESHSTFECREABREINF" INTEGER, "CODIGO_BARRA_BOLETO" VARCHAR(44), "ID_MFREMESSA" INTEGER, "BANCO_NOSSO_NUMERO"
  VARCHAR(15), "BANCO_NUM_DOC" INTEGER, "FLUXO" INTEGER NOT NULL, "RENDIMENTO_SEM_RENTENCAO" CHAR(1), "EMISSAO_NF"
  DATE, "SERIE_NF" VARCHAR(5), "COMPOSICAO_BASE" VARCHAR(1), "PERAPUR" VARCHAR(7), "ID_TBCTABAN" INTEGER, PRIMARY KEY
  ("ID"));
CREATE TABLE MFCONPAG_TBCBOPRO ("ID_MFCONPAG" INTEGER NOT NULL, "ID_TBCBOPRO" INTEGER NOT NULL, PRIMARY KEY
  ("ID_MFCONPAG"));
CREATE TABLE MFCTAREC ("ID" INTEGER NOT NULL, "EMPRESA" SMALLINT NOT NULL, "DEV" CHAR(1) NOT NULL, "COD" BIGINT NOT
  NULL, "APRES" DATE NOT NULL, "DOC" INTEGER NOT NULL, "PARC" SMALLINT NOT NULL, "VENC" DATE, "PGTO" DATE, "BCO_CLI"
  VARCHAR(15), "AGE_CLI" VARCHAR(15), "CTA_CLI" VARCHAR(15), "CHEQUE" INTEGER, "PAGO_A" VARCHAR(30), "VLR_DOC_TOT"
  NUMERIC(18,2), "VALOR" NUMERIC(18,2), "VLR_PAG" NUMERIC(18,2), "VLR_GLO" NUMERIC(18,2), "JUROS" NUMERIC(18,2),
  "PER_PAG" NUMERIC(9,2), "COBRANCA" CHAR(1), "MESREF" SMALLINT, "ANOREF" SMALLINT, "REMESSA" VARCHAR(3), "NOTA"
  VARCHAR(10), "BANCO" SMALLINT, "REPASSE" NUMERIC(9,2), "ATE" CHAR(1), "PAGTOS" SMALLINT, "NOME" VARCHAR(70), "SALDO"
  NUMERIC(18,2), "TIPO_SALDO" CHAR(1), "GLOSA_ACEITA" NUMERIC(18,2), "TIPO_PARC" VARCHAR(1), "USUARIO" VARCHAR(31),
  "REFERENTE" VARCHAR(50), "OBS" VARCHAR(100), "CONV" SMALLINT, "ORIGEM" VARCHAR(1), "HIST_CONT" SMALLINT,
  "DT_CHE_PRE" DATE, "ANO_CONT" SMALLINT, "MES_CONT" SMALLINT, "DOC_CONT" INTEGER, "ANO_CONTB" SMALLINT, "MES_CONTB"
  SMALLINT, "DOC_CONTB" INTEGER, "AGE_BAN" INTEGER, "CTA_BAN" BIGINT, "DIG_BCO_CLI" CHAR(1), "CDC_DEB" INTEGER,
  "VLR_INSS" NUMERIC(18,2), "COD_OPE_INSS" INTEGER, "HIST_CONTB" SMALLINT, "DESCONTO" NUMERIC(18,2), "COD_OPE_DESC"
  INTEGER, "TP_PGTO" SMALLINT, "ACRESCIMO" NUMERIC(18,2), "PARC_VINC" INTEGER, "TP_COD" SMALLINT, "SERIE" VARCHAR(3)
  NOT NULL, "TIPO_DOC" VARCHAR(1), "RECIBO" INTEGER NOT NULL, "ID_MFCTAREC" INTEGER NOT NULL, "CONSOL" CHAR(1),
  "BAIXOU_MANUT" CHAR(1), "ORIGEMBAIXA" CHAR(1), "DATA_HORA_INCLUSAO" TIMESTAMP, "DATA_HORA_ULTIMA_ATUALIZACAO"
  TIMESTAMP, "DATA_PREVISTA_PGTO" DATE, "VLR_PREVISTO_PGTO" NUMERIC(18,2), "ID_MFCABECLANC" INTEGER NOT NULL,
  "ID_MFTIPOLANC" SMALLINT NOT NULL, "FLUXO" INTEGER NOT NULL, "ID_TBCTABAN" INTEGER, PRIMARY KEY ("ID"));
CREATE TABLE MFLANCTO ("ID" INTEGER NOT NULL, "EMPRESA" SMALLINT NOT NULL, "DATA" DATE NOT NULL, "DOC" INTEGER NOT
  NULL, "BCO_CRE" SMALLINT, "BCO_DEV" SMALLINT, "HIST" VARCHAR(100), "VALOR" NUMERIC(18,2), "GRUPO" SMALLINT,
  "SUBGRUPO" SMALLINT, "ITEM" SMALLINT, "TIPO_TRF" CHAR(1), "EMITIDO" CHAR(1), "USUARIO" VARCHAR(31), "ANO_CONT"
  SMALLINT, "MES_CONT" SMALLINT, "DOC_CONT" INTEGER, "AGE_CRE" INTEGER, "CTA_CRE" BIGINT, "AGE_DEV" INTEGER, "CTA_DEV"
  BIGINT, "HIST_CONT" SMALLINT, "CDC_DEB" INTEGER, "CDC_CRE" INTEGER, "CDC_GSI" INTEGER, "DATA_HORA_INCLUSAO"
  TIMESTAMP, "DATA_HORA_ULTIMA_ATUALIZACAO" TIMESTAMP, "ID_MFCABECLANC" INTEGER NOT NULL, "ID_MFCHEQUE" INTEGER,
  "ID_TBCTABAN_CRE" INTEGER, "ID_TBCTABAN_DEV" INTEGER, PRIMARY KEY ("ID"));
CREATE TABLE MFPAGADF ("ID_MFADIFOR" INTEGER NOT NULL, "ID_MFCONPAG" INTEGER NOT NULL, "PARC_MFCONPAG" SMALLINT NOT
  NULL, "VLR_UTIL" NUMERIC(18,2) NOT NULL, "HIST" SMALLINT, "DATA_COMP" DATE, "ID_MFPAGADF" INTEGER NOT NULL, PRIMARY
  KEY ("ID_MFADIFOR", "ID_MFCONPAG", "PARC_MFCONPAG"));
CREATE TABLE MFSALATU ("ID" INTEGER NOT NULL, "EMPRESA" INTEGER NOT NULL, "BANCO" SMALLINT NOT NULL, "AGENCIA" INTEGER
  NOT NULL, "CONTA" BIGINT NOT NULL, "SALDO" NUMERIC(18,2), "ID_TBCTABAN" INTEGER, PRIMARY KEY ("ID"));
CREATE TABLE MFSALDOS ("ID" INTEGER NOT NULL, "EMPRESA" INTEGER NOT NULL, "BANCO" SMALLINT NOT NULL, "AGENCIA" INTEGER
  NOT NULL, "CONTA" BIGINT NOT NULL, "DATA" DATE NOT NULL, "SALDO" NUMERIC(18,2), "ID_TBCTABAN" INTEGER, "DIGITO"
  VARCHAR(2), PRIMARY KEY ("ID"));
CREATE TABLE SDMFCONPAG ("ID_MFCONPAG" INTEGER NOT NULL, "ID_SDNATCREDITO" SMALLINT, "ID_SDCSTCOFINS" SMALLINT,
  "ID_SDCSTPIS" SMALLINT, "ID_SDTIPODOCTO" SMALLINT, "ID_SDITEMSERVICO" SMALLINT, "CHAVE_NFE" VARCHAR(60), PRIMARY KEY
  ("ID_MFCONPAG"));
CREATE TABLE TBFINCODRECOL ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(200) NOT NULL, "ESPECIFICACAO" VARCHAR(254),
  "ATIVO" CHAR(1), PRIMARY KEY ("ID"));
CREATE TABLE MFREFDES ("EMPRESA" SMALLINT NOT NULL, "COD" INTEGER NOT NULL, "DESCRICAO" VARCHAR(40), "CDC" INTEGER,
  "HISTPR" SMALLINT, "TIPO" INTEGER NOT NULL, "GRUPO" INTEGER, "SUBGRUPO" INTEGER, "ITEM" INTEGER, "SITUACAO" CHAR(1)
  NOT NULL, "INTEGRAR_IMPOSTO_CTA_PAG" SMALLINT, "INTEGRAR_IMPOSTO_CTA_REC" SMALLINT, "ID_TBFINCODRECOL" SMALLINT,
  "FATO_GERADOR_PAGAR" SMALLINT, "FATO_GERADOR_RECEBER" SMALLINT, PRIMARY KEY ("EMPRESA", "COD"));
CREATE TABLE MFDESACR ("ID" INTEGER NOT NULL, "EMPRESA" INTEGER NOT NULL, "COD" BIGINT NOT NULL, "TIPO" CHAR(1) NOT
  NULL, "DOC" INTEGER NOT NULL, "TP_LAN" SMALLINT NOT NULL, "SEQ" SMALLINT NOT NULL, "TPDES_ACR" SMALLINT NOT NULL,
  "CONTA" INTEGER, "VALOR" NUMERIC(18,2), "PARC" INTEGER NOT NULL, "DATA" DATE NOT NULL, "SERIE" VARCHAR(3) NOT NULL,
  "ID_MFCONPAG_DARF" INTEGER, "TP_ACRESCIMO_GER_EMI_DARF" SMALLINT, "COMPOSICAO_BASE" CHAR(1), PRIMARY KEY ("ID"));
CREATE TABLE TBGRUDES ("COD" INTEGER NOT NULL, "NOME" VARCHAR(40), "CODCONT" VARCHAR(15), "CDC" INTEGER, "CUSTO"
  CHAR(1), "TIPODESP" SMALLINT, "REFCDC" INTEGER, "SITUACAO" VARCHAR(1), "UNIMEN" SMALLINT, "CLASSIF" VARCHAR(1),
  PRIMARY KEY ("COD"));
CREATE TABLE TBINDNIF ("ID" SMALLINT NOT NULL, "DESCRICAO" VARCHAR(50) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBBANCOS ("EMPRESA" INTEGER NOT NULL, "COD" SMALLINT NOT NULL, "NOME" VARCHAR(40), "CODBCOCENTRAL"
  VARCHAR(4), PRIMARY KEY ("EMPRESA", "COD"));
CREATE TABLE TBUSERS ("NOME" VARCHAR(31) NOT NULL, "ID_TBUSERS" SMALLINT NOT NULL, PRIMARY KEY ("NOME"));
CREATE TABLE MFCTAUSU ("ID_TBUSERS" SMALLINT NOT NULL, "ID_TBCTABAN" SMALLINT NOT NULL, PRIMARY KEY ("ID_TBUSERS",
  "ID_TBCTABAN"));
CREATE TABLE MFADIFOR ("ID_MFADIFOR" INTEGER NOT NULL, "EMPRESA" SMALLINT NOT NULL, "COD" INTEGER NOT NULL,
  "TIPO_CREDOR" CHAR(1) NOT NULL, "DOC" INTEGER NOT NULL, "EMISSAO" DATE, "VENC" DATE, "DT_PGTO" DATE, "VLR_DOC_TOT"
  NUMERIC(18,2) NOT NULL, "PAGO" NUMERIC(18,2) NOT NULL, "REFERENTE" VARCHAR(60), "ID_TBCTABAN" SMALLINT, "CHEQUE"
  INTEGER NOT NULL, "TP_PGTO" SMALLINT, "HIST" SMALLINT, "ID_MFCABECLANC" INTEGER NOT NULL, "ID_MFTIPOLANC" SMALLINT
  NOT NULL, "DATA_PREVISTA_PGTO" DATE, "AUTORIZADO_PGTO_PARA" DATE, PRIMARY KEY ("ID_MFADIFOR"));
CREATE TABLE MFADIFOR_TBCBOPRO ("ID_MFADIFOR" INTEGER NOT NULL, "ID_TBCBOPRO" INTEGER NOT NULL, PRIMARY KEY
  ("ID_MFADIFOR"));
"""
CARREGADAS = ("TBAGEBAN", "TBCTABAN", "MFBORDER", "MFCTAUSU", "TBCENCUS", "TBCLIENT", "MFREFDES", "TBGRUDES")
NAO_CARREGADAS = ("MFADIFOR", "MFADIFOR_TBCBOPRO", "MFCONPAG", "MFCONPAG_TBCBOPRO", "MFCTAREC", "MFLANCTO", "MFPAGADF",
                  "MFSALATU", "MFSALDOS", "SDMFCONPAG", "MFDESACR", "TBFINCODRECOL", "TBINDNIF")
SO_ORIGEM = ("TBBANCOS", "TBUSERS")
PROPRIAS = ("MFSALDOS",)
PAIS_EXTERNOS = {"TBUSERS": ["usr.um", "usr.dois"], "TBITEDES": ["1|1|1"]}
PREPARO_DESTINO = """
CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(40) NOT NULL);
INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');
INSERT INTO municipio_ibge (codigo_ibge, nome, unidade_federativa_id, criado_em) VALUES
  ('3550308', 'Municipio exemplo', 1, UTC_TIMESTAMP(3));
INSERT INTO banco (codigo_compensacao, codigo_ispb, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES
  ('001', '00000001', 'Banco ficticio um', '2020-01-01', 'exemplo', UTC_TIMESTAMP(3)),
  ('104', '00000104', 'Banco ficticio dois', '2020-01-01', 'exemplo', UTC_TIMESTAMP(3)),
  ('237', '00000237', 'Banco ficticio tres', '2020-01-01', 'exemplo', UTC_TIMESTAMP(3)),
  ('341', '00000341', 'Banco ficticio quatro', '2020-01-01', 'exemplo', UTC_TIMESTAMP(3));
"""


def documento_falso(base, n):
    """CPF (n=11, base de 9 dígitos) ou CNPJ (n=14, base de 12) inventado, com os dígitos verificadores calculados."""
    d = [int(x) for x in "%0*d" % (n - 2, base)]
    for _ in range(2):
        pesos = range(len(d) + 1, 1, -1) if n == 11 else ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] if len(d) == 12
                                                         else [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
        r = sum(x * p for x, p in zip(d, pesos)) % 11
        d.append(0 if r < 2 else 11 - r)
    return int("".join(map(str, d)))


def formas():
    """{tabela: [(coluna, tipo, not_null)]} lido do próprio DDL."""
    out = {}
    for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\);", " ".join(DDL.split()), re.S):
        out[m.group(1)] = [(c, t.strip(), bool(nn)) for c, t, nn in
                           re.findall(r'"(\w+)" ([A-Z]+(?:\(\d+(?:,\d+)?\))?(?: PRECISION| SUB_TYPE \d)?)( NOT NULL)?', m.group(2))]
    return out


def _linha(forma, vals, r=None):
    """Lista na ordem do DDL: os valores dados; o resto nulo, ou 1/'x' (e S/N sorteado) nas obrigatórias."""
    v = []
    for c, t, nn in forma:
        if c in vals:
            v.append(vals[c])
        elif r is not None and t in ("CHAR(1)", "VARCHAR(1)"):
            v.append(r.choice("SN"))
        elif nn:
            v.append(1 if t in ("SMALLINT", "INTEGER", "BIGINT") else
                     datetime.date(2026, 1, 2) if t == "DATE" else decimal.Decimal("1.00") if t.startswith("NUMERIC")
                     else "x")
        else:
            v.append(None)
    return v


def linhas(r, ins):
    f = formas()
    D, M = datetime.date, decimal.Decimal

    def put(t, **vals):
        ins(t, _linha(f[t], vals))

    # bancos da origem (só lidos pela referência): (empresa, código interno, código de compensação)
    for e, c, cc in [(1, 1, "001"), (1, 237, "237"), (2, 237, "237"), (1, 104, "104"), (1, 341, "341"),
                     (1, 999, None), (1, 500, "777")]:
        put("TBBANCOS", EMPRESA=e, COD=c, NOME="Banco inventado %d" % c, CODBCOCENTRAL=cc)
    for nome, i in [("usr.um", 1), ("usr.dois", 2), ("usr.tres", 3)]:  # usr.tres nunca carregado
        put("TBUSERS", NOME=nome, ID_TBUSERS=i)
    # agências: (empresa, banco, código, nome, cep)
    for e, b, c, n, cep in [(1, 1, 1234, "Agência  Centro", 1234567), (1, 237, 55, "Agência Norte", 80000000),
                            (2, 237, 55, "Agência Norte da filial", 80000000), (1, 999, 10, "Agência sem banco", None),
                            (1, 104, 20, "Agência Sul", 0), (1, 341, 30, "Agência Leste", 123456789),
                            (1, 500, 40, "Agência banco fora do catálogo", 1000000)]:
        put("TBAGEBAN", EMPRESA=e, BANCO=b, COD=c, DESCRICAO=n, ENDERECO="Rua Inventada %d" % c, BAIRRO="Bairro falso",
            CIDADE="Cidade falsa", UF="SP", FONE="1100000000", CEP=cep, DV_AGENCIA="0", MOD_CHEQUE=1)
    # contas: (id, empresa, banco, agência, conta, descrição, tipo, limite, situação)
    for i, e, b, a, c, n, tp, lim, s in [(1, 1, 1, 1234, 11111, "Conta movimento", "C", M("1000.00"), "A"),
                                         (2, 1, 237, 55, 22222, "Conta  cobrança", "C", None, "I"),
                                         (3, 1, 1, 1234, 33333, None, "C", None, "A"),
                                         (4, 1, 999, 10, 44444, "Conta banco desconhecido", "C", None, "A"),
                                         (5, 1, 104, 20, 55555, "Conta limite negativo", "C", M("-50.00"), "A"),
                                         (6, 1, 341, 30, 66666, "Conta situação estranha", "C", None, "X"),
                                         (7, 1, 341, 30, 77777, "Conta aplicação", "A", M("0.00"), "A"),
                                         (8, 1, 1, 1234, 88888, "Conta folha", "C", None, None),
                                         (9, 2, 237, 55, 99999, "Conta da filial", "C", None, "A")]:
        put("TBCTABAN", ID=i, COD=c, BANCO=b, AGENCIA=a, EMPRESA=e, DESCRICAO=n, TP_CONTA=tp, CHE_ESP=lim,
            ID_CTABAN=40 + i, ULTIMO_CHEQUE=-1 if i == 7 else 100 + i, DIGITO=str(i % 10), SITUACAO=s,
            NUMERO_SEQ_REMESSA_COBRANCA=-3 if i == 8 else i * 3)
    # borderôs: (id, número, conta, pagamento, emissão, venc. início, venc. fim, valor)
    for i, n, cta, pg, em, vi, vf, v in [
            (1, 101, 1, D(2026, 2, 10), D(2026, 2, 9), D(2026, 2, 1), D(2026, 2, 28), M("1500.00")),
            (2, 102, 2, D(2026, 2, 11), D(2026, 2, 10), None, None, M("0.00")),
            (3, 103, 3, D(2026, 2, 12), D(2026, 2, 11), None, None, M("10.00")),
            (4, 104, 99, D(2026, 2, 12), D(2026, 2, 11), None, None, M("10.00")),
            (5, 105, 1, D(1899, 12, 30), D(2026, 2, 11), None, None, M("10.00")),
            (6, 106, 1, D(2026, 2, 13), D(2026, 2, 12), D(2026, 3, 1), D(2026, 2, 1), M("10.00")),
            (7, 101, 2, D(2026, 2, 14), D(2026, 2, 13), None, None, M("20.00")),
            (8, 108, 7, D(2026, 2, 15), D(2026, 2, 14), None, None, M("-1.00")),
            (9, 109, 7, D(2026, 2, 16), D(2026, 2, 15), None, None, M("99999.99")),
            (10, 110, 8, D(2026, 2, 17), D(2026, 2, 16), D(2026, 2, 17), D(2026, 2, 17), M("12.34"))]:
        put("MFBORDER", ID=i, EMPRESA=1, BORDERO=n, BANCO=1, AGENCIA=1234, CONTA=11111, DATA=pg, VALOR=v,
            HORA="0830  ", USUARIO="usuario.falso", EMISSAO=em, VENC_I=vi, VENC_F=vf, HIST_COD=1, REFER=0,
            ID_TBCTABAN=cta)
    # permissões: (usuário, número interno da conta = 40 + id): 43 é a conta recusada; 3 é o usuário nunca carregado;
    # 9 não existe na origem; 99 não é número de conta
    for u, c in [(1, 41), (2, 41), (1, 42), (1, 43), (3, 41), (9, 42), (2, 99)]:
        put("MFCTAUSU", ID_TBUSERS=u, ID_TBCTABAN=c)
    # centros de custo: (código, nome, situação, unidade de mensuração, código da apuração); ID interno != COD
    for c, n, s, um, ap in [(11, "Centro  Administrativo", "A", 7, 0), (12, "Centro Cirúrgico", "I", 0, 1234567),
                            (13, None, "A", 0, None), (14, "Centro Lavanderia", "X", 0, None)]:
        put("TBCENCUS", COD=c, NOME=n, SIGLA="C%d" % c, SITUACAO=s, ID=500 + c, UNIMEN=um, COD_APURASUS=ap)
    # clientes: (código, nome, pessoa, documento, município IBGE da origem: 999999 fora do catálogo)
    for c, n, p, doc, mu in [(1, "Cliente Pessoa Inventada", "F", documento_falso(123456789, 11), 355030),
                             (2, "Empresa Cliente Inventada", "J", documento_falso(112223330001, 14), 999999),
                             (3, "Cliente Documento Trocado", "F", documento_falso(445556660001, 14), None)]:
        put("TBCLIENT", COD=c, NOME=n, EMAIL="cliente%d@exemplo.invalid" % c, ENDERECO="Rua Falsa %d" % c,
            BAIRRO="Bairro", CIDADE="Cidade", UF="SP", CONTATO="Contato  Falso", FONE="1100000000", CEP=1310100,
            PESSOA=p, CPFCGC=doc, NUM_ENDERECO=10 + c, COMPL_ENDERECO="sala %d" % c, ID_TBMUIBGE=mu)
    # tipos de ajuste: (empresa, código, descrição, TIPO, situação, código de receita, item do plano)
    for e, c, n, tp, s, rec, it in [(1, 1, "Desconto pontualidade", 0, "A", None, 1),
                                    (2, 1, "Desconto pontualidade filial", 0, "A", None, None),
                                    (1, 2, None, 0, "A", None, None), (1, 3, "Acréscimo por atraso", 1, "I", None, 9),
                                    (1, 4, "Retenção de imposto inventado", 2, "A", 1708, None),
                                    (1, 5, "Tipo sem par", 16, "A", None, None)]:
        put("MFREFDES", EMPRESA=e, COD=c, DESCRICAO=n, TIPO=tp, SITUACAO=s, ID_TBFINCODRECOL=rec, GRUPO=it,
            SUBGRUPO=it, ITEM=it, CDC=11)
    # saldos (não carregada: data do saldo em coluna de data e hora, pedido): (id, conta, dia, saldo)
    for i, cta, d, s in [(1, 1, D(2026, 1, 31), M("100.00")), (2, 1, D(2026, 2, 1), M("150.50")),
                         (3, 2, D(2026, 1, 31), M("0.00")), (4, None, D(2026, 1, 31), M("5.00")),
                         (5, 1, D(2026, 1, 31), M("100.00")), (6, 4, D(2026, 1, 31), M("7.00")),
                         (7, 7, D(2026, 1, 31), M("-320.10"))]:
        put("MFSALDOS", ID=i, EMPRESA=1, BANCO=1, AGENCIA=1234, CONTA=11111, DATA=d, SALDO=s, ID_TBCTABAN=cta,
            DIGITO="1")
    # grupos: (código, nome, classificação D/R, situação A/I); centro de custo 10 + código
    for c, n, cl, s in [(1, "Despesas  com pessoal", "D", "A"), (2, "Receitas de serviços", "R", "A"),
                        (3, None, "D", "A"), (4, "Materiais", "X", "A"), (5, "Serviços de terceiros", "D", "Z"),
                        (6, "Grupo desativado", "R", "I")]:
        put("TBGRUDES", COD=c, NOME=n, CODCONT="1.1.%d" % c, CDC=10 + c, CUSTO="D", TIPODESP=1, REFCDC=None,
            SITUACAO=s, UNIMEN=1, CLASSIF=cl)
    # não carregadas: formas da origem só para a imagem
    for t in NAO_CARREGADAS:
        if t in PROPRIAS:
            continue
        for k in (1, 2):
            ins(t, _linha(f[t], {f[t][0][0]: k}, r))
    return {t: {"gravados": e["gravados"], "pendencias": dict(e["pendencias"])} for t, e in ESPERADO.items()}


ESPERADO = {
    "TBAGEBAN": {"gravados": 5, "pendencias": {"adotado_existente": 1, "catalogo_codigo_inexistente": 1,
                                               "restricao_destino_1048": 2, "valor_fora_do_dominio": 2}},
    "TBCTABAN": {"gravados": 7, "pendencias": {"pai_pendente": 1, "restricao_destino_1048": 1,
                                               "valor_fora_do_dominio": 4}},
    "MFBORDER": {"gravados": 5, "pendencias": {"data_sentinela": 1, "pai_inexistente": 1, "pai_pendente": 1,
                                               "restricao_destino_1048": 2, "restricao_destino_1062": 1,
                                               "restricao_destino_4025": 1, "valor_fora_do_dominio": 1,
                                               "valor_presumido": 9}},
    "MFCTAUSU": {"gravados": 3, "pendencias": {"pai_inexistente": 3, "pai_pendente": 1, "restricao_destino_1048": 3,
                                               "valor_presumido": 6}},
    "TBCENCUS": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1,
                                               "valor_fora_do_dominio": 1, "vigencia_sem_fonte": 4}},
    "TBCLIENT": {"gravados": 2, "pendencias": {"catalogo_codigo_inexistente": 1, "documento_invalido": 3,
                                               "restricao_destino_4025": 1}},
    "MFREFDES": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 2,
                                               "restricao_destino_1062": 1, "restricao_destino_4025": 1,
                                               "valor_fora_do_dominio": 1, "valor_presumido": 12}},
    "TBGRUDES": {"gravados": 4, "pendencias": {"pai_inexistente": 2, "pai_pendente": 1, "restricao_destino_1048": 1,
                                               "valor_fora_do_dominio": 2}},
}
