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
- MFSALDOS, MFSALATU (saldo diário da conta; o atual no dia da carga): conta nula (NOT NULL recusa), conta recusada
  (pai_pendente), dia repetido na conta (chave única), saldo negativo aceito;
- MFADIFOR (adiantamento): credor fornecedor pelo COD e profissional pela inscrição ligada (MFADIFOR_TBCBOPRO, só
  lida); sem a regra condicional, o lado que não se aplica fica NULL com pai_inexistente e o código de profissional
  que coincide com um fornecedor é recusado pela CHECK do credor; tipo E sem par (recusa), conta recusada
  (pai_pendente) ou inexistente (pai_inexistente), valor zero e vencimento antes da emissão (CHECK), sem emissão
  (NOT NULL), pago negativo (padrão 0);
- MFLANCTO (lançamento bancário): um movimento por lado (crédito, débito) com o centro de custo do lado, tipo de
  migração por empresa (destino agrupado), histórico vazio com texto fixo; sem conta (sem_item_a_gravar), conta
  recusada (pai_pendente), conta inexistente de um lado (o outro grava), centro inexistente sem a conta do lado,
  valor negativo (CHECK recusa os dois lados), data sentinela, natureza inexistente (pai_inexistente).
Não carregadas (NAO_CARREGADAS, sem coluna com destino): títulos a pagar e a receber, compensações, ajustes e dados
fiscais: falta mecanismo genérico do motor (pedidos em docs/obra/fatias/f4/saida/L8-11.json).
TBBANCOS, TBUSERS, MFADIFOR_TBCBOPRO e TBCBOPRO entram só como origem lida pelas referências (TBCBOPRO, da L5-04,
tem a forma que o mapa lê e é carregada por ela; o esperado dela é da L5-04, não conferido aqui).
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
  VARCHAR(4), "AGENCIA" VARCHAR(20), "CONTA" VARCHAR(20), "CARTEIRA" SMALLINT, "CODCEDENTE" VARCHAR(18),
  "SITUACAO" VARCHAR(1), "CODCEDENTEEXP" VARCHAR(18), "CEDENTE_DEBITO_AUTO" VARCHAR(18), "VARIACAO_CARTEIRA" SMALLINT,
  PRIMARY KEY ("EMPRESA", "COD"));
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
CREATE TABLE TBCBOPRO ("ID" INTEGER NOT NULL, "ID_TBCBOSUS" INTEGER NOT NULL, "UF" VARCHAR(2) NOT NULL, "COD" INTEGER
  NOT NULL, "ID_TBPROFIS" INTEGER NOT NULL, "VINC_EMPR" VARCHAR(1) NOT NULL, "CONS_PROF" VARCHAR(7), "ATIVO" VARCHAR(1),
  "COMP_INICIAL" INTEGER, "COMP_FINAL" INTEGER, "ATENDE_SUS" CHAR(1), "CRM_DIGITO" VARCHAR(1), PRIMARY KEY ("ID"));
CREATE TABLE MFLANGSI ("EMPRESA" INTEGER NOT NULL, "FORN" BIGINT NOT NULL, "DOC" INTEGER NOT NULL, "TIPO" CHAR(1) NOT
  NULL, "GRUPO" INTEGER NOT NULL, "SUBGRUPO" INTEGER NOT NULL, "ITEM" INTEGER NOT NULL, "VALOR" NUMERIC(18,2) NOT NULL,
  "CDC" INTEGER, "TP_LAN" SMALLINT NOT NULL, "DATA" DATE NOT NULL, "SERIE" VARCHAR(3) NOT NULL, "PERAPUR" VARCHAR(7),
  PRIMARY KEY ("EMPRESA", "TP_LAN", "FORN", "DATA", "DOC", "TIPO", "SERIE", "GRUPO", "SUBGRUPO", "ITEM"));
CREATE TABLE MFPARAM ("EMPRESA" INTEGER NOT NULL, "ANOPRO" SMALLINT NOT NULL, "MESPRO" SMALLINT NOT NULL, "HOSP" SMALLINT, "DES_EMI_CHE_PAG" CHAR(1), "TETO_INSS" NUMERIC(9,2), "ALI_MAX_INSS" NUMERIC(4,2), "DIAS_EXTRATO" SMALLINT, "DOC_NF_REC" CHAR(1), "COMP_CHE" VARCHAR(1), "BAI_EMI_CHE" CHAR(1), "ALIQ_CPMF" NUMERIC(4,2), "ALIQ_PIS" NUMERIC(4,2), "HIST_PAD_PAG" CHAR(1), "NMESES" SMALLINT, "QTDE_DIA_VENC" INTEGER, "COD_OPE_IR" INTEGER, "COD_OPE_INSS" INTEGER, "COD_OPE_ISS" INTEGER, "COD_OPE_PIS" INTEGER, "COD_OPE_CPMF" INTEGER, "SEQ_AP" INTEGER, "IMP_AP" CHAR(1), "COD_OPE_COFINS" INTEGER, "COD_OPE_CSLL" INTEGER, "COD_OPE_IPI" INTEGER, "COD_OPE_FGTS" INTEGER, "COD_OPE_ACRES" INTEGER, "COD_OPE_DESC" INTEGER, "ALERTA_VENC" CHAR(1), "DIG_GSI" CHAR(1), "INT_LAN" CHAR(1), "ALIQ_COFINS" NUMERIC(9,2), "ALIQ_CSLL" NUMERIC(9,2), "AUT_ELET" CHAR(1), "COD_OPE_INSS2" INTEGER, "COD_OPE_INSS3" INTEGER, "COD_OPE_INSS4" INTEGER, "COD_OPE_INSS5" INTEGER, "ABERTURA_CAIXA" DATE, "IDE_CDC_PAG" CHAR(1), "CDC_CRE_PAG" INTEGER, "CDC_BCO_PAG" INTEGER, "COD_OPE_CHE_COMP" INTEGER, "OLD_GRAV_IMP_MAN_PAG" CHAR(1), "INT_PAG" CHAR(1), "INT_REC" CHAR(1), "COFINSH" SMALLINT, "CPMFH" SMALLINT, "CSLLH" SMALLINT, "FGTSH" SMALLINT, "PISH" SMALLINT, "IPIH" SMALLINT, "IRH" SMALLINT, "ISSH" SMALLINT, "INSSH" SMALLINT, "INSS2H" SMALLINT, "INSS3H" SMALLINT, "INSS4H" SMALLINT, "INSS5H" SMALLINT, "CHEQUEH" SMALLINT, "COD_OPE_GLOSAS" INTEGER, "COD_OPE_OUTROS" INTEGER, "GLOSASH" SMALLINT, "OUTROSH" SMALLINT, "COD_OPE_AF" INTEGER, "INT_CHE_COMP_PAG" CHAR(1), "GRAV_DOC_NF_PAG" CHAR(1), "GRAV_NOME_COMPL_REC" CHAR(1), "RODOU" INTEGER, "GRAV_DOC_NF_REC" CHAR(1), "IDE_CDC_REC" CHAR(1), "HIST_PAD_REC" CHAR(1), "GRAV_OBS_COMPL_PAG" CHAR(1), "GRAV_OBS_COMPL_REC" CHAR(1), "CDC_DEV_REC" INTEGER, "CDC_BCO_REC" INTEGER, "CDC_GLO_REC" INTEGER, "GRAV_CHE_BOR_PAG" CHAR(1), "CONS_PAG_CREDOR_LAN_PAG" CHAR(1), "INT_BAI_CONT_REC" CHAR(1), "INT_MAN_CONT_REC" CHAR(1), "GRAV_NOME_COMPL_PAG" CHAR(1), "HIST_PAD_LAN" CHAR(1), "IDE_CDC_LAN" CHAR(1), "CODOPECREDNIDEN" INTEGER, "INT_CREDN_IDE" VARCHAR(1), "INF_HIST_COMP" VARCHAR(1), "USA_EMPENHO" VARCHAR(1), "DATA_PGTO_CHEQUE" VARCHAR(1), "DIG_SERIE_REC" VARCHAR(1), "DIG_TIPO_DOC_REC" VARCHAR(1), "GER_REP_BAIXA_INTEG" CHAR(1), "GRAV_REF_COMPL_PAG" CHAR(1), "GRAV_NOME_EMP_MED_COMPL_PAG" CHAR(1), "REST_CTA_USU" CHAR(1), "RECIBO_PACIENTE_COMPL" CHAR(1), "INT_DOC_CHE_SEP" CHAR(1), "TIPO_PGTO_OBRIG" CHAR(1) NOT NULL, "GRAV_NF_COMPL_REC" CHAR(1), "LISTAR_DOC_BAIXADOS_POR_CNI" CHAR(1), "ROTINA" CHAR(1), "EXIBE_TELA_CUSTO_LAN" CHAR(1), "EXIBE_TELA_CUSTO_REC" CHAR(1), "EXIBE_TELA_CUSTO_PAG" CHAR(1), "EMITIR_RECIBO_NAO_PAGOS" CHAR(1) NOT NULL, "INCLUIR_USUARIO_RECIBO" CHAR(1) NOT NULL, "EMITIR_RECIBO_MEIA_FOLHA" CHAR(1) NOT NULL, "ADICIONAR_CPF_RECIBO" CHAR(1) NOT NULL, "REPLICAR_REF_PARCELA" CHAR(1) NOT NULL, "EXIBIR_DOC_APARTIR" DATE, "INCLUIR_PRONTUARIO_RECIBO" CHAR(1), "REPLICAR_DOCUMENTO" CHAR(1), "INTEGRAR_COLAB_PGTO_A_VISTA" CHAR(1), "CONSIDERAR_INTEGR_SAIDA_LANC" CHAR(1), "INCLUIR_NOME_PACIENTE_DEVEDOR" CHAR(1), "INCLUIR_HIST_EMISSAO_CHEQUE" CHAR(1), "UTILIZAR_DATA_ENT_CONTA_PAGAR" CHAR(1), "MODELO_EMISSAO_CHEQUE" SMALLINT, "INCLUIR_TP_PGTO_COMPL_CTA_PAG" CHAR(1), "ORDEM_GRAV_DOC_COMPL_CTA_PAG" SMALLINT, "ORDEM_GRAV_OBS_COMPL_CTA_PAG" SMALLINT, "ORDEM_GRAV_BORD_COMPL_CTA_PAG" SMALLINT, "ORDEM_GRAV_FORN_COMPL_CTA_PAG" SMALLINT, "ORDEM_GRAV_REF_COMPL_CTA_PAG" SMALLINT, "ORDEM_GRAV_EMP_COMPL_CTA_PAG" SMALLINT, "ORDEM_GRAV_TP_PG_COMPL_CTA_PAG" SMALLINT, "ORDEM_GRAV_DOC_COMPL_CTA_REC" SMALLINT, "ORDEM_GRAV_OBS_COMPL_CTA_REC" SMALLINT, "ORDEM_GRAV_CONV_COMPL_CTA_REC" SMALLINT, "ORDEM_GRAV_REC_COMPL_CTA_REC" SMALLINT, "ORDEM_GRAV_NF_COMPL_CTA_REC" SMALLINT, "GRUPO_TBITEDES" INTEGER NOT NULL, "SUBGRUPO_TBITEDES" INTEGER NOT NULL, "ITEM_TBITEDES" INTEGER NOT NULL, "DIGITAR_COND_CONTR_ORDEM_PGTO" SMALLINT, "ORDEM_PGTO_FORNEC" SMALLINT, "ORDEM_PGTO_PROTESTO" SMALLINT, "ORDEM_PGTO_JUROS" SMALLINT, "ORDEM_PGTO_MULTA" SMALLINT, "OLD_GRAVAR_IMPOST_MANUT_CTA_REC" CHAR(1), "INTEGRAR_IMP_CONTA_CONT_FORN" CHAR(1), "INDIVID_PARTIDA_DOC_INT_CHEQUE" CHAR(1), "IMPRIMIR_RELAT_DADOS_CABEC" SMALLINT, PRIMARY KEY ("EMPRESA"));
CREATE TABLE TBINTIMP ("EMPRESA" SMALLINT NOT NULL, "TIPO_CTA" SMALLINT NOT NULL, "TIPO" VARCHAR(1) NOT NULL, "DT_VIG_I" DATE, "DT_VIG_F" DATE, "COFINS" NUMERIC(9,2), "ISS" NUMERIC(9,2), "PIS" NUMERIC(9,2), "CSLL" NUMERIC(9,2), "COFINS_C" INTEGER, "ISS_C" INTEGER, "PIS_C" INTEGER, "CSLL_C" INTEGER, "FGTS_C" INTEGER, "IPI_C" INTEGER, "IRRF_C" INTEGER, "INSS_C" INTEGER, "IRRF" NUMERIC(9,2), "PIS_COFINS_CSLL" NUMERIC(9,2), "COD_MFREFDES_PIS_COFINS_CSLL" INTEGER, "ALIQUOTA_ADICIONAL_INSS" NUMERIC(9,2), "ALIQUOTA_CBS" NUMERIC(9,2), "ALIQUOTA_IBS" NUMERIC(9,2), "CODIGO_CBS" INTEGER, "CODIGO_IBS" INTEGER, PRIMARY KEY ("EMPRESA", "TIPO_CTA", "TIPO"));
"""
CARREGADAS = ("TBAGEBAN", "TBCTABAN", "MFBORDER", "MFCTAUSU", "TBCENCUS", "TBCLIENT", "MFREFDES", "TBGRUDES",
              "MFADIFOR", "MFLANCTO", "MFSALATU", "MFSALDOS", "TBINTIMP", "MFPARAM", "MFCTAREC",
              "MFADIFOR_TBCBOPRO")
NAO_CARREGADAS = ("TBFINCODRECOL", "TBINDNIF")
# MFCONPAG e afins são da L8-12 (carregam lá): aqui só lidos, como as demais de fora da fatia
SO_ORIGEM = ("TBBANCOS", "TBUSERS", "TBCBOPRO", "MFCONPAG", "MFCONPAG_TBCBOPRO", "MFPAGADF",
             "SDMFCONPAG", "MFDESACR", "MFLANGSI")
PROPRIAS = ()
# fornecedores e profissionais de fora da fatia (L7, L5), dados como já carregados
PAIS_EXTERNOS = {"TBUSERS": ["usr.um", "usr.dois"], "TBITEDES": ["1|1|1"], "TBFORNEC": [10, 11, 12],
                 "TBPROFIS": [700, 701], "TBCONVEN": [5], "MFCABECLANC": [1]}
# destino principal desdobrado (um item por lado): linhas da origem que gravaram ao menos um item
LINHAS_COM_ITEM = {"MFLANCTO": 6, "TBINTIMP": 2, "MFPARAM": 1}
# linhas recusadas pelo domínio (exige_dominio: valor_fora_do_dominio), além das recusas por restrição
RECUSAS_POR_DOMINIO = {"MFCTAREC": 1}
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
CREATE TABLE IF NOT EXISTS tributo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(30) NOT NULL,
  descricao VARCHAR(150) NOT NULL, esfera VARCHAR(30) NOT NULL, forma_apuracao VARCHAR(30) NOT NULL,
  incidencia VARCHAR(30) NOT NULL, criado_em DATETIME(3) NOT NULL);
INSERT INTO tributo (codigo, descricao, esfera, forma_apuracao, incidencia, criado_em)
  SELECT x.c, x.c, 'federal', 'mensal', 'retido', UTC_TIMESTAMP(3) FROM (SELECT 'IRRF' AS c UNION ALL SELECT 'ISS'
  UNION ALL SELECT 'PIS' UNION ALL SELECT 'COFINS' UNION ALL SELECT 'CSLL' UNION ALL SELECT 'CSRF') x
  WHERE NOT EXISTS (SELECT 1 FROM tributo t WHERE t.codigo = x.c);
CREATE TABLE IF NOT EXISTS modulo_sistema (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(30) NOT NULL,
  descricao VARCHAR(150) NOT NULL, criado_em DATETIME(3) NOT NULL);
INSERT INTO modulo_sistema (codigo, descricao, criado_em) SELECT 'financeiro', 'Financeiro', UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = 'financeiro');
CREATE TABLE IF NOT EXISTS parametro_definicao (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  chave VARCHAR(100) NOT NULL, modulo_sistema_id BIGINT UNSIGNED NOT NULL, descricao VARCHAR(500) NOT NULL,
  tipo VARCHAR(30) NOT NULL, criado_em DATETIME(3) NOT NULL);
INSERT INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, criado_em)
  SELECT x.c, (SELECT MIN(id) FROM modulo_sistema WHERE codigo = 'financeiro'), x.c, 'inteiro', UTC_TIMESTAMP(3)
  FROM (SELECT 'financeiro.mesesConsulta' AS c UNION ALL SELECT 'financeiro.diasVencimentoPadrao') x
  WHERE NOT EXISTS (SELECT 1 FROM parametro_definicao d WHERE d.chave = x.c);
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
    # saldos do dia: (id, conta, dia, saldo); 4 sem conta, 5 dia repetido, 6 conta recusada
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
    # saldo atual (dia da carga): (id, conta, saldo); 2 sem conta, 4 conta repetida no mesmo dia, 5 conta recusada
    for i, cta, s in [(1, 1, M("10.00")), (2, None, M("1.00")), (3, 2, M("20.00")), (4, 1, M("11.00")),
                      (5, 4, M("3.00"))]:
        put("MFSALATU", ID=i, EMPRESA=1, BANCO=1, AGENCIA=1234, CONTA=11111, SALDO=s, ID_TBCTABAN=cta)
    # inscrições (só lidas pela referência encadeada ao profissional) e o vínculo do adiantamento com a inscrição
    for i, pf in [(31, 700), (32, 701)]:
        put("TBCBOPRO", ID=i, ID_TBPROFIS=pf, ID_TBCBOSUS=1, UF="SP", COD=90000 + i, VINC_EMPR="N", CONS_PROF="CRM",
            ATIVO="S")
    for a, i in [(2, 31), (3, 32)]:
        put("MFADIFOR_TBCBOPRO", ID_MFADIFOR=a, ID_TBCBOPRO=i)
    # adiantamentos: (id, tipo, credor, conta interna, emissão, vencimento, valor, pago)
    # 1 fornecedor; 2 profissional; 3 profissional cujo código coincide com o fornecedor 11 (CHECK); 4 tipo E (sem
    # par); 5 conta recusada (43); 6 valor zero; 7 sem emissão; 8 vencimento antes da emissão; 9 conta inexistente;
    # 10 pago negativo
    for i, tp, cod, cta, em, vc, v, pg in [
            (1, "F", 10, 41, D(2026, 3, 1), D(2026, 3, 31), M("500.00"), M("500.00")),
            (2, "M", 999, 41, D(2026, 3, 2), None, M("800.00"), M("0.00")),
            (3, "M", 11, 42, D(2026, 3, 3), None, M("300.00"), M("0.00")),
            (4, "E", 12, 41, D(2026, 3, 4), None, M("70.00"), M("0.00")),
            (5, "F", 10, 43, D(2026, 3, 5), None, M("90.00"), M("0.00")),
            (6, "F", 10, 41, D(2026, 3, 6), None, M("0.00"), M("0.00")),
            (7, "F", 10, 41, None, None, M("60.00"), M("0.00")),
            (8, "F", 10, 41, D(2026, 3, 8), D(2026, 3, 1), M("40.00"), M("0.00")),
            (9, "F", 10, 99, D(2026, 3, 9), None, M("30.00"), M("30.00")),
            (10, "F", 10, 45, D(2026, 3, 10), None, M("20.00"), M("-1.00"))]:
        put("MFADIFOR", ID_MFADIFOR=i, EMPRESA=1, COD=cod, TIPO_CREDOR=tp, DOC=9000 + i, EMISSAO=em, VENC=vc,
            DT_PGTO=em if pg else None, VLR_DOC_TOT=v, PAGO=pg, REFERENTE="Adiantamento inventado %d" % i,
            ID_TBCTABAN=cta, CHEQUE=0, TP_PGTO=1, HIST=1, ID_MFCABECLANC=i, ID_MFTIPOLANC=1)
    # lançamentos: (id, empresa, data, conta crédito, centro crédito, conta débito, centro débito, valor, histórico,
    # item do plano). 1 os dois lados; 2 só crédito, sem histórico, natureza inexistente; 3 só débito; 4 sem conta;
    # 5 crédito na conta recusada (3); 6 valor negativo; 7 conta de crédito inexistente; 8 centro de crédito
    # inexistente e sem a conta (o lado não grava); 9 outra empresa (outro tipo de migração); 10 data sentinela.
    # Nenhum centro válido: TBCENCUS vem depois de MFLANCTO na ordem atual do mapa (dependência pedida); a imagem não
    # depende da ordem
    for i, e, d, cc, ccc, cd, ccd, v, h, it in [
            (1, 1, D(2026, 4, 1), 1, None, 2, None, M("100.00"), "Transferência  entre contas", 1),
            (2, 1, D(2026, 4, 2), 5, None, None, None, M("50.00"), None, 9),
            (3, 1, D(2026, 4, 3), None, None, 6, None, M("30.00"), "Tarifa inventada", None),
            (4, 1, D(2026, 4, 4), None, None, None, None, M("10.00"), "Sem conta", None),
            (5, 1, D(2026, 4, 5), 3, None, 1, None, M("10.00"), "Conta recusada", None),
            (6, 1, D(2026, 4, 6), 1, None, 2, None, M("-5.00"), "Valor negativo", None),
            (7, 1, D(2026, 4, 7), 99, None, 7, None, M("15.00"), "Crédito em conta inexistente", None),
            (8, 1, D(2026, 4, 8), None, 77, 8, None, M("25.00"), "Centro inexistente sem conta", None),
            (9, 2, D(2026, 4, 9), 9, None, None, None, M("35.00"), "Lançamento da filial", None),
            (10, 1, D(1899, 12, 30), 1, None, None, None, M("45.00"), "Data sentinela", None)]:
        put("MFLANCTO", ID=i, EMPRESA=e, DATA=d, DOC=7000 + i, HIST=h, VALOR=v, GRUPO=it, SUBGRUPO=it, ITEM=it,
            ID_MFCABECLANC=i, ID_TBCTABAN_CRE=cc, CDC_CRE=ccc, ID_TBCTABAN_DEV=cd, CDC_DEB=ccd, TIPO_TRF="T",
            USUARIO="usuario.falso")
    # não carregadas: formas da origem só para a imagem
    for i, rot in [(1, 'Beneficiário com NIF'), (2, 'Beneficiário dispensado do NIF'), (3, 'País não exige NIF')]:  # rodada 5 (revisão): código E rótulo da prova (provas.d/TBINDNIF.sql)
        ins("TBINDNIF", [i, rot])
    for t in NAO_CARREGADAS:
        if t in PROPRIAS or t == "TBINDNIF":
            continue
        for k in (1, 2):
            ins(t, _linha(f[t], {f[t][0][0]: k}, r))
    # alíquotas de retenção (tributos semeados no PREPARO; CBS fora da semente): 1 IRRF e ISS, fim aberto 2999;
    # 2 quatro tributos, sem início (vigência da carga); 3 tipo X (padrão todas, valor_fora_do_dominio) e CBS sem
    # tributo no destino (codigo_inexistente_destino + 1048: linha recusada); 4 nenhuma alíquota (sem_item_a_gravar);
    # 5 alíquota acima de 100 (CHECK 4025)
    for e, tc, tp, vi, vf, al in [
            (1, 1, "M", D(2020, 1, 1), D(2999, 12, 31), {"IRRF": M("1.50"), "ISS": M("5.00")}),
            (1, 1, "E", None, None, {"PIS": M("0.65"), "COFINS": M("3.00"), "CSLL": M("1.00"),
                                     "PIS_COFINS_CSLL": M("4.65")}),
            (1, 2, "X", D(2021, 1, 1), None, {"IRRF": M("1.00"), "ALIQUOTA_CBS": M("0.90")}),
            (2, 1, "M", D(2021, 1, 1), None, {}),
            (2, 2, "E", D(2021, 1, 1), D(2024, 12, 31), {"IRRF": M("150.00")}),
            # 6: difere da 1 só pelo TIPO_CTA (mesmo tributo, pessoa e vigência): chave única recusa (1062, visível)
            (1, 3, "M", D(2020, 1, 1), D(2999, 12, 31), {"IRRF": M("2.00")})]:
        put("TBINTIMP", EMPRESA=e, TIPO_CTA=tc, TIPO=tp, DT_VIG_I=vi, DT_VIG_F=vf, **al)
    # títulos a receber (parcela = linha; título = grupo EMPRESA, DEV, COD, DOC, SERIE): 1 e 2 parcelas do mesmo
    # título do convênio 5 (natureza pelo maior rateio); 3 cliente 1, recebida; 4 DEV T sem sentido medido
    # (valor_fora_do_dominio, recusada); 5 convênio sem rateio (natureza pai_inexistente + 1048)
    for i, dev, cod, doc, parc, val, pg, vpg in [(901, "E", 5, 100, 1, M("100.00"), None, None),
                                                 (902, "E", 5, 100, 2, M("50.00"), None, None),
                                                 (903, "C", 1, 200, 1, M("80.00"), D(2025, 3, 10), M("80.00")),
                                                 (904, "T", 5, 300, 1, M("10.00"), None, None),
                                                 (905, "E", 5, 400, 1, M("20.00"), None, None)]:
        put("MFCTAREC", ID=i, EMPRESA=1, DEV=dev, COD=cod, APRES=D(2025, 2, 1), DOC=doc, PARC=parc,
            VENC=D(2025, 3, parc), VALOR=val, PGTO=pg, VLR_PAG=vpg, SERIE="A", TIPO_DOC="B", RECIBO=1,
            ID_MFCTAREC=i, ID_MFCABECLANC=1, ID_MFTIPOLANC=1, FLUXO=1)
    for cod, doc, tp, g, v in [(5, 100, "E", 1, M("120.00")), (5, 100, "E", 2, M("30.00")), (1, 200, "C", 1, M("80.00")),
                               (5, 300, "T", 1, M("10.00"))]:
        put("MFLANGSI", EMPRESA=1, FORN=cod, DOC=doc, TIPO=tp, SERIE="A", TP_LAN=2, DATA=D(2025, 2, 1), GRUPO=g,
            SUBGRUPO=1, ITEM=1, VALOR=v)
    # parâmetros: 1 dois inteiros; 2 outra empresa no mesmo estabelecimento (1062: a mesma definição e vigência)
    for e, nm, qd in [(1, 12, 30), (2, 6, None)]:
        put("MFPARAM", EMPRESA=e, ANOPRO=2025, MESPRO=1, NMESES=nm, QTDE_DIA_VENC=qd, TIPO_PGTO_OBRIG="N",
            GRUPO_TBITEDES=1, SUBGRUPO_TBITEDES=1, ITEM_TBITEDES=1)
    return {t: {"gravados": e["gravados"], "pendencias": dict(e["pendencias"])} for t, e in ESPERADO.items()}


ESPERADO = {
    # títulos a receber: hoje as 4 linhas válidas caem com 1048 (tipo de documento nulo: o motor grava o título
    # agrupado antes do tipo de documento que ele cita; pedido 20 da L8-11, provado: 3 parcelas com a ordem corrigida);
    # 904 DEV T fora do domínio (recusa visível); 905 sem rateio (pai_inexistente + 1048); escolha_pelo_maior: o maior
    # rateio do documento 100; valor_presumido: tipo de origem avulso presumido por linha
    "MFCTAREC": {"gravados": 0, "pendencias": {"escolha_pelo_maior": 2, "pai_inexistente": 1,
                                               "restricao_destino_1048": 4, "valor_fora_do_dominio": 1,
                                               "valor_presumido": 4}},
    # gravados = itens (alíquotas e parâmetros)
    "TBINTIMP": {"gravados": 6, "pendencias": {"valor_presumido": 5, "vigencia_sem_fonte": 1,
                                               "restricao_destino_1062": 1,
                                               "valor_fora_do_dominio": 1, "codigo_inexistente_destino": 1,
                                               "restricao_destino_1048": 1, "sem_item_a_gravar": 1,
                                               "restricao_destino_4025": 1}},
    "MFPARAM": {"gravados": 2, "pendencias": {"vigencia_sem_fonte": 2, "restricao_destino_1062": 1}},
    "TBAGEBAN": {"gravados": 5, "pendencias": {"adotado_existente": 1, "catalogo_codigo_inexistente": 1,
                                               "mescla_conflito_origem_guardada": 1,
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
    # saldo anterior 0 PRESUMIDO (valor_presumido por linha lida até a gravação)
    "MFSALATU": {"gravados": 2, "pendencias": {"pai_pendente": 1, "restricao_destino_1048": 1,
                                               "restricao_destino_1062": 1, "valor_presumido": 4}},
    "MFSALDOS": {"gravados": 4, "pendencias": {"pai_pendente": 1, "restricao_destino_1048": 1,
                                               "restricao_destino_1062": 1, "valor_presumido": 6}},
    # rodada 5 (ADR 0006): o vínculo com a inscrição complementa o adiantamento (UPDATE do credor profissional);
    # o adiantamento 3 é recusado (CHECK): pai_pendente
    "MFADIFOR_TBCBOPRO": {"gravados": 1, "pendencias": {"pai_pendente": 1}},
    "MFADIFOR": {"gravados": 4, "pendencias": {"pai_inexistente": 9, "pai_pendente": 1, "restricao_destino_1048": 2,
                                               "restricao_destino_4025": 3, "valor_fora_do_dominio": 3}},
    # gravados = movimentos (itens): 2 + 1 + 1 + 1 + 1 + 1
    # data sentinela: na data do movimento e na data de compensação
    "MFLANCTO": {"gravados": 7, "pendencias": {"data_sentinela": 2, "pai_inexistente": 3, "pai_pendente": 1,
                                               "restricao_destino_1048": 1, "restricao_destino_4025": 1,
                                               "sem_item_a_gravar": 1}},
}

