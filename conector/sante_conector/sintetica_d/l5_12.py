"""Fatia L5-12 (cadastros e administração, módulo RH): tabelas da origem com a forma do dicionário e dados 100% falsos.

Carregadas pelo mapa (colunas.d/L5-12.tsv): PEJUSTIF, TBTPTRIBUTO (tipo pelo de-para de valores), FPRESP
(responsável legal), FPREMESSA (competência da folha), FPPARAM (cadastro do empregador, classificação tributária,
construtora e cooperativa pela empresa: referência encadeada a TBEMPHOS e de-para oficial/de valores), FPPARAMVIG
(versões do cadastro na trilha, com retrato), FPEVENTO (natureza pelo código no catálogo oficial do destino, cod:),
FPLOTTRIBCAD (FPAS pelo código, cod:), FPREMESSA (abertura e fechamento pelas datas da apuração, tipar). Declaradas mas
recusadas por coluna NOT NULL que aguarda mecanismo ou modelo (1364, pedidos em saida/L5-12.json):
FPTPEVENTOAUT_TBEMPHOS (rubrica) e as quatro incidências (código de incidência por tributo e código). Fora da carga
(só a forma, 2 linhas): os 5 catálogos oficiais ST*, a tabela legal TBTABIRR (catálogo oficial) e as listas
TBTPCONSTRUT/TBTPCOOPERAT (descartes pedidos em saida/L5-12.json).
Anomalias: data sentinela, faixa invertida, NOT NULL sem valor, código repetido entre empresas, CPF inválido, UF sem
código oficial, classificação tributária inexistente, dia de pagamento fora da faixa, mês 13, tipo de folha
inexistente, situação fora do domínio, responsável recusado (pai_pendente), cadastro inexistente (pai_inexistente).
TBEMPHOS (empresa, de outra fatia) entra na imagem só com as colunas lidas pela referência encadeada, a não ser que
outra fatia já a defina na imagem sintética: aí ela é requerida (REQUER), o PREPARO_DESTINO dela roda antes do desta, e
esta fatia acrescenta as empresas 11 a 13 (CNPJ válido e novo, classificação 99/77, construtora 0/1, cooperativa 0..3);
o esperado de TBEMPHOS é o da dona mais estas 3 linhas.
"""
import datetime
import decimal
import importlib
import random
import re

DDL = """
CREATE TABLE STFIL_PREV (COD_FIL SMALLINT NOT NULL, NOME VARCHAR(50), PRIMARY KEY (COD_FIL));
CREATE TABLE STLOCAL (ID SMALLINT NOT NULL, NOME VARCHAR(50), PRIMARY KEY (ID));
CREATE TABLE STRESULT (COD_RES SMALLINT NOT NULL, NOME VARCHAR(50), PRIMARY KEY (COD_RES));
CREATE TABLE STTPASO (ID SMALLINT NOT NULL, NOME VARCHAR(70), PRIMARY KEY (ID));
CREATE TABLE STTPMEDIDAS (COD_TP INTEGER NOT NULL, NOME VARCHAR(50), PRIMARY KEY (COD_TP));
CREATE TABLE TBTABIRR (ISENTO DOUBLE PRECISION, F1_INICIO DOUBLE PRECISION, F1_FIM DOUBLE PRECISION, F1_DED DOUBLE
  PRECISION, F1_ALIQ DOUBLE PRECISION, F2_INICIO DOUBLE PRECISION, F2_FIM DOUBLE PRECISION, F2_DED DOUBLE PRECISION,
  F2_ALIQ DOUBLE PRECISION, ACIMA DOUBLE PRECISION, ACIMA_DED DOUBLE PRECISION, ACIMA_ALIQ DOUBLE PRECISION,
  DESC_DEP DOUBLE PRECISION, ISENTO_PJ NUMERIC(9,2), ALIQ_PJ NUMERIC(9,2), INSS_PERC_PF NUMERIC(9,2), INSS_TETO_PF
  NUMERIC(9,2), INSS_PERC_PJ NUMERIC(9,2), DTA_INSS_IRRF DATE NOT NULL, F1_INSS_INI NUMERIC(18,2), F1_INSS_FIM
  NUMERIC(18,2), F1_INSS_ALIQ NUMERIC(18,2), F2_INSS_INI NUMERIC(18,2), F2_INSS_FIM NUMERIC(18,2), F2_INSS_ALIQ
  NUMERIC(18,2), F3_INSS_INI NUMERIC(18,2), F3_INSS_FIM NUMERIC(18,2), F3_INSS_ALIQ NUMERIC(18,2), F4_INSS_INI
  NUMERIC(18,2), F4_INSS_FIM NUMERIC(18,2), F4_INSS_ALIQ NUMERIC(18,2), F1_SAL_FAM_INI NUMERIC(18,2), F1_SAL_FAM_FIM
  NUMERIC(18,2), COTA1_SAL_FAM NUMERIC(18,2), F2_SAL_FAM_INI NUMERIC(18,2), F2_SAL_FAM_FIM NUMERIC(18,2),
  COTA2_SAL_FAM NUMERIC(18,2), SAL_MIN NUMERIC(18,2), CONTR_IND NUMERIC(18,2), VLR_ACIMA_F4 NUMERIC(18,2),
  TETO_CONTR_IND NUMERIC(18,2), F3_INICIO DOUBLE PRECISION, F3_FIM DOUBLE PRECISION, F3_DED DOUBLE PRECISION,
  F3_ALIQ DOUBLE PRECISION, CONTR_IND_FINS NUMERIC(18,2), TETO_CONTR_IND_FINS NUMERIC(18,2), DESC_SIMPLIFICADO
  NUMERIC(18,2), ISENTO_26 DOUBLE PRECISION, F1_INICIO_26 DOUBLE PRECISION, F1_FIM_26 DOUBLE PRECISION, REDUCAO_26
  DOUBLE PRECISION, ACIMA_26 DOUBLE PRECISION, PRIMARY KEY (DTA_INSS_IRRF));
CREATE TABLE TBTPCONSTRUT (ID SMALLINT NOT NULL, NOME VARCHAR(25) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE TBTPCOOPERAT (ID SMALLINT NOT NULL, NOME VARCHAR(25) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE FPEVENTO (ID_EVENTO INTEGER NOT NULL, COD_EMP SMALLINT NOT NULL, COD_EVENTO INTEGER NOT NULL, NOME
  VARCHAR(50), TP_EVENTO VARCHAR(1) NOT NULL, TP_REFER VARCHAR(1) NOT NULL, PERC_INC NUMERIC(18,2), PRIORIDADE
  SMALLINT, FORMULA BLOB SUB_TYPE 1, FORMULA_PAD BLOB SUB_TYPE 1, INC_SAL VARCHAR(1), INC_INSS VARCHAR(1), INC_IRRF
  VARCHAR(1), INC_FGTS VARCHAR(1), INC_DSR VARCHAR(1), INC_VTRANSP VARCHAR(1), INC_SF VARCHAR(1), INC_RAIS
  VARCHAR(1), INC_INFREND VARCHAR(1), INC_IRRFF VARCHAR(1), INC_INSS13 VARCHAR(1), INC_IRRF13 VARCHAR(1), INC_FGTS13
  VARCHAR(1), INC_FER13 VARCHAR(1), INC_PENSAO VARCHAR(1), INC_PENSAO_FERIAS VARCHAR(1), INC_PENSAO_13 VARCHAR(1),
  INC_MED_13 VARCHAR(1), INC_MED_FER VARCHAR(1), DEDUTIVEL_IRRF VARCHAR(1), EST_CALC_VL_TRAN VARCHAR(1),
  EST_CALC_SAL_FAM VARCHAR(1), EST_CALC_FERIAS VARCHAR(1), EST_IRRF_FERIAS VARCHAR(1), EST_IRRF_13 VARCHAR(1),
  EST_INSS_13 VARCHAR(1), EST_FGTS_13 VARCHAR(1), EST_INSS VARCHAR(1), EST_IRRF VARCHAR(1), EST_FGTS VARCHAR(1),
  SITUACAO VARCHAR(1), INC_LIC_MATER VARCHAR(1), FOLHA VARCHAR(1), FERIAS VARCHAR(1), RESCISAO VARCHAR(1), ANUENIO
  VARCHAR(1), INSALUBRIDADE VARCHAR(1), LIC_MATERNIDADE VARCHAR(1), DEC_TER_SALARIO VARCHAR(1), INC_MED_HREXTRAS
  VARCHAR(1), INC_MED_ADIC_NOT VARCHAR(1), GRATIFICACAO VARCHAR(1), INC_UM_TER_FER VARCHAR(1), FORMULA_REF BLOB
  SUB_TYPE 1, FORMULA_REF_PAD BLOB SUB_TYPE 1, FORMULA_VLR_CHEIO BLOB SUB_TYPE 1, FORMULA_VLR_CHEIO_PAD BLOB
  SUB_TYPE 1, PERICULOSIDADE VARCHAR(1), INC_INSS_FER VARCHAR(1), INC_PROV VARCHAR(1), INC_MED_1 VARCHAR(1),
  INC_MED_2 VARCHAR(1), INC_MED_3 VARCHAR(1), INC_MED_4 VARCHAR(1), INC_MED_5 VARCHAR(1), INC_MED_6 VARCHAR(1),
  INC_MED_7 VARCHAR(1), INC_MED_8 VARCHAR(1), INC_MED_9 VARCHAR(1), INC_MED_10 VARCHAR(1), INC_MED_11 VARCHAR(1),
  INC_MED_12 VARCHAR(1), INR_DIARIA_AJUDA_CUSTO VARCHAR(1), INR_IND_RESC_CONT_TRAB VARCHAR(1), INR_OUTROS
  VARCHAR(1), QUINQUENIO VARCHAR(1), EST_PIS VARCHAR(1), ESTORNAR_FALTA CHAR(1), ID_RUBRICA INTEGER, INC_MED_14
  CHAR(1), INC_MED_15 CHAR(1), INC_MED_16 CHAR(1), INC_MED_17 CHAR(1), INC_MED_18 CHAR(1), INC_MED_19 CHAR(1),
  INC_MED_20 CHAR(1), INC_MED_21 CHAR(1), INC_MED_22 CHAR(1), INC_MED_23 CHAR(1), INC_MED_24 CHAR(1), INC_MED_25
  CHAR(1), INC_MED_26 CHAR(1), INC_MED_27 CHAR(1), INC_MED_28 CHAR(1), INC_MED_29 CHAR(1), INC_MED_30 CHAR(1),
  INC_PIS CHAR(1), INC_PIS13 CHAR(1), DATA_INICIAL_VALIDADE DATE, DATA_FINAL_VALIDADE DATE, INC_RESCISAO CHAR(1),
  INC_CONTRIBUICAO_SINDICAL CHAR(1), MEDIA_RESCISAO CHAR(1), ID_FPNATRUBRICA SMALLINT, INC_FGTS_VERBA_INDENIZADA
  CHAR(1), FORMULA_INTERNA_PAD BLOB SUB_TYPE 1, FORMULA_INTERNA_REF_PAD BLOB SUB_TYPE 1,
  FORMULA_INTERNA_VLR_CHEIO_PAD BLOB SUB_TYPE 1, DATA_FORMULA_INTERNA DATE, OBS_EVENTO_ESOCIAL VARCHAR(255),
  DATA_HORA_INC_ULT_ALT_ESOC TIMESTAMP, ANTECIPACAO_FERIAS CHAR(1), ID_FPEVENTO_ANTECIPACAO INTEGER, PRIMARY KEY
  (ID_EVENTO));
CREATE TABLE FPLOTTRIBCAD (ID INTEGER NOT NULL, NOME VARCHAR(80) NOT NULL, DATA_VIGENCIA_INICIAL DATE NOT NULL,
  DATA_VIGENCIA_FINAL DATE, ID_FPLOTACAOTRIB VARCHAR(2) NOT NULL, ID_FPCODALIQFPAS SMALLINT, ID_FPTPINSCRICAO
  SMALLINT, CNPJ_CNO BIGINT, ID_FPFPAS SMALLINT NOT NULL, ID_TBEMPHOS SMALLINT NOT NULL, DATA_HORA_INC_ULT_ALT_ESOC
  TIMESTAMP, ID_ERP_TERCEIRO VARCHAR(30), PRIMARY KEY (ID));
CREATE TABLE FPREMESSA (ID_REMESSA INTEGER NOT NULL, COD_EMP SMALLINT NOT NULL, ANO_PROC INTEGER, MES_PROC SMALLINT,
  COD_REMESSA SMALLINT, COD_TP SMALLINT NOT NULL, DTA_INI_APUR DATE, DTA_FIN_APUR DATE, DATA_PAGAMENTO DATE, FECHADA
  CHAR(1), ID_FPESOCMOTREM SMALLINT, DATA_MOTIVO DATE, DESCRICAO_MOTIVO VARCHAR(255), PGTO_EMPREGADOS_DES_EMP_SUC
  CHAR(1), ID_FPESOCFECEVT INTEGER, ID_FPTPFOLHAESOC SMALLINT, PRIMARY KEY (ID_REMESSA));
CREATE TABLE FPRESP (ID_RESP INTEGER NOT NULL, COD_EMP SMALLINT NOT NULL, COD_RESP INTEGER NOT NULL, NR_REGISTRO
  VARCHAR(10), PIS VARCHAR(13), DESC_FUNCAO VARCHAR(50), RESPONS VARCHAR(50), CPF VARCHAR(11), TEL VARCHAR(20),
  RAMAL VARCHAR(5), FAX VARCHAR(20), E_MAIL VARCHAR(60), SITUACAO VARCHAR(1), DDD VARCHAR(4), DTA_NASC DATE,
  VIGENCIA_INICIAL DATE, VIGENCIA_FINAL DATE, NUM_CELULAR VARCHAR(20), NOME VARCHAR(70), NUM_INSCRICAO_ORGAO_CLASSE
  VARCHAR(14), ID_TBUF VARCHAR(2), NIS_RESP_MONITORIZACAO VARCHAR(11), PRIMARY KEY (ID_RESP));
CREATE TABLE FPRUBRICAFGTS_FPEVENTO (ID_FPEVENTO INTEGER NOT NULL, ID_FPRUBRICAFGTS SMALLINT NOT NULL, PRIMARY KEY
  (ID_FPEVENTO));
CREATE TABLE FPRUBRICAINSS_FPEVENTO (ID_FPEVENTO INTEGER NOT NULL, ID_FPRUBRICAINSS SMALLINT NOT NULL, PRIMARY KEY
  (ID_FPEVENTO));
CREATE TABLE FPRUBRICAIRRF_FPEVENTO (ID_FPEVENTO INTEGER NOT NULL, ID_FPRUBRICAIRRF SMALLINT NOT NULL, PRIMARY KEY
  (ID_FPEVENTO));
CREATE TABLE FPRUBRICASIND_FPEVENTO (ID_FPEVENTO INTEGER NOT NULL, ID_FPRUBRICASIND SMALLINT NOT NULL, PRIMARY KEY
  (ID_FPEVENTO));
CREATE TABLE FPTPEVENTOAUT_TBEMPHOS (ID_FPTPEVENTOAUT SMALLINT NOT NULL, ID_TBEMPHOS SMALLINT NOT NULL,
  LANCAR_TP_EVENTO_AUTOM_FOLHA CHAR(1), PRIMARY KEY (ID_FPTPEVENTOAUT,ID_TBEMPHOS));
CREATE TABLE PEJUSTIF (ID_JUSTIF INTEGER NOT NULL, COD_EMP INTEGER NOT NULL, COD_JUSTIF INTEGER NOT NULL, NOME
  VARCHAR(45), PRIMARY KEY (ID_JUSTIF));
CREATE TABLE TBTPTRIBUTO (ID SMALLINT NOT NULL, NOME VARCHAR(30) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE FPPARAM (COD_EMP SMALLINT NOT NULL, AVOS_DEZ VARCHAR(1), AVOS_ATUAL VARCHAR(1), SAL_FAM_AFAST
  VARCHAR(1), SAL_FAM_PROP VARCHAR(1), SAL_NOMI VARCHAR(1), ARRED_SEFIP VARCHAR(1), MATER_SEFIP VARCHAR(1), DIA_PGTO
  SMALLINT, CAMIN_FOTO VARCHAR(150), COD_CENTR SMALLINT, FILANT NUMERIC(18,2), COD_SIMPLES INTEGER, PR_CONT_SOC
  NUMERIC(18,2), COD_CATEG INTEGER NOT NULL, ENCER_EMP DATE, NATU_JUR VARCHAR(4), QT_PROP SMALLINT, CATEG_EST
  SMALLINT, NR_MTB VARCHAR(7), CNPJ_SPDATA VARCHAR(14), ID_RESP_FICH INTEGER NOT NULL, ID_RESP_EMP INTEGER NOT NULL,
  DTA_IN_ATIV DATE, GR_RISCO SMALLINT, OLD_COD_FPAS SMALLINT, OLD_COD_TERC SMALLINT, OLD_PR_TERC NUMERIC(18,2),
  INSS_EMP NUMERIC(18,2), SAT VARCHAR(12), COD_GPS INTEGER NOT NULL, PAT SMALLINT, QT_5SM SMALLINT, QT_A5SM
  SMALLINT, PERC_SP NUMERIC(4,1), PERC_ACOZ NUMERIC(4,1), PERC_RC NUMERIC(4,1), PERC_RT NUMERIC(4,1), PERC_CA
  NUMERIC(4,1), PERC_ACON NUMERIC(4,1), REF_ARRED NUMERIC(18,2), CAMIN_CAGED VARCHAR(150), CAMIN_SEFIP VARCHAR(150),
  CAMIN_RAIS VARCHAR(150), DIA_COMER VARCHAR(1), ENV_TIMB VARCHAR(1), IMP_CNPJ VARCHAR(1), IMP_DADOS_BANC
  VARCHAR(1), DIG_PER_AQUIS VARCHAR(1), OLD_INT_FINANCEIRO VARCHAR(1), OLD_INT_CONTABILIDADE VARCHAR(1), INT_CUSTOS
  VARCHAR(1), DEPURACAO_VAR VARCHAR(1), PERC_APO15 NUMERIC(18,2), PERC_APO20 NUMERIC(18,2), PERC_APO25
  NUMERIC(18,2), PGFER31 VARCHAR(1), ARQ_LOGO VARCHAR(150), DIAS_CONTR_RISCO_FER INTEGER, MES_SD_ARRED SMALLINT,
  ANO_SD_ARRED SMALLINT, COD_OT_ENT INTEGER, DIA_COMER_RESCISAO VARCHAR(1), NRO_SEQ_EXP_BCO INTEGER,
  INTEGRAR_PONTO_ELETRONICO CHAR(1), DATA_FINAL_VALIDADE DATE, ID_FPPROCESSORAT INTEGER, ID_FPPROCESSOFAP INTEGER,
  UTILIZA_RECURSO_FGTS CHAR(1), DEBITO_AUTOMATICO_FGTS CHAR(1), ADESAO_SERVICO_SMS CHAR(1),
  AGENDAMENTO_RECOLHIMENTO_FGTS CHAR(1), ID_FPSIND_PATRONAL INTEGER, OLD_APURACAO_GRAU_RISCO SMALLINT,
  OLD_APURACAO_ALIQ_FAP SMALLINT, FORMA_INTEGRACAO_FINANCEIRO SMALLINT, OLD_ID_FPESOCSITEMP SMALLINT, ID_FPTPRETINSS
  SMALLINT, ID_FPESOCDESONER SMALLINT, ID_FPESOCENTEDUC SMALLINT, ID_FPESOCEMPTRAB SMALLINT,
  NRO_REG_EMP_TRAB_TEMP_MTE VARCHAR(30), ID_FPESOCTPAMB SMALLINT, DATA_INICIO_ESOCIAL DATE,
  VALIDA_DEPENDENCIA_ENTRE_EVENTO CHAR(1), DTA_INI_OBRIGA_EVT_PERIODIC DATE, DTA_INI_OBRIG_EVT_NAO_PERIODICO DATE,
  DTA_INI_OBRIGA_EVT_SEG_TRAB DATE, GERAR_S1210_BAIXA_FINANCEIRO CHAR(1), IND_SUBST_PATR_OBRA SMALLINT,
  INDTRIBFOLHAPISCOFINS CHAR(1), PRIMARY KEY (COD_EMP));
CREATE TABLE FPPARAMVIG (COD_EMP SMALLINT NOT NULL, DATA_HORA_VIGENCIA TIMESTAMP NOT NULL, AVOS_DEZ VARCHAR(1),
  AVOS_ATUAL VARCHAR(1), SAL_FAM_AFAST VARCHAR(1), SAL_FAM_PROP VARCHAR(1), SAL_NOMI VARCHAR(1), ARRED_SEFIP
  VARCHAR(1), MATER_SEFIP VARCHAR(1), DIA_PGTO SMALLINT, CAMIN_FOTO VARCHAR(150), COD_CENTR SMALLINT, FILANT
  NUMERIC(18,2), COD_SIMPLES INTEGER, PR_CONT_SOC NUMERIC(18,2), COD_CATEG INTEGER NOT NULL, ENCER_EMP DATE,
  NATU_JUR VARCHAR(4), QT_PROP SMALLINT, CATEG_EST SMALLINT, NR_MTB VARCHAR(7), CNPJ_SPDATA VARCHAR(14),
  ID_RESP_FICH INTEGER NOT NULL, ID_RESP_EMP INTEGER NOT NULL, DTA_IN_ATIV DATE, GR_RISCO SMALLINT, INSS_EMP
  NUMERIC(18,2), SAT VARCHAR(12), COD_GPS INTEGER NOT NULL, PAT SMALLINT, QT_5SM SMALLINT, QT_A5SM SMALLINT, PERC_SP
  NUMERIC(4,1), PERC_ACOZ NUMERIC(4,1), PERC_RC NUMERIC(4,1), PERC_RT NUMERIC(4,1), PERC_CA NUMERIC(4,1), PERC_ACON
  NUMERIC(4,1), REF_ARRED NUMERIC(18,2), CAMIN_CAGED VARCHAR(150), CAMIN_SEFIP VARCHAR(150), CAMIN_RAIS
  VARCHAR(150), DIA_COMER VARCHAR(1), ENV_TIMB VARCHAR(1), IMP_CNPJ VARCHAR(1), IMP_DADOS_BANC VARCHAR(1),
  DIG_PER_AQUIS VARCHAR(1), INT_CUSTOS VARCHAR(1), DEPURACAO_VAR VARCHAR(1), PERC_APO15 NUMERIC(18,2), PERC_APO20
  NUMERIC(18,2), PERC_APO25 NUMERIC(18,2), PGFER31 VARCHAR(1), ARQ_LOGO VARCHAR(150), DIAS_CONTR_RISCO_FER INTEGER,
  MES_SD_ARRED SMALLINT, ANO_SD_ARRED SMALLINT, COD_OT_ENT INTEGER, DIA_COMER_RESCISAO VARCHAR(1), NRO_SEQ_EXP_BCO
  INTEGER, INTEGRAR_PONTO_ELETRONICO CHAR(1), DATA_FINAL_VALIDADE DATE, ID_FPPROCESSORAT INTEGER, ID_FPPROCESSOFAP
  INTEGER, UTILIZA_RECURSO_FGTS CHAR(1), DEBITO_AUTOMATICO_FGTS CHAR(1), ADESAO_SERVICO_SMS CHAR(1),
  AGENDAMENTO_RECOLHIMENTO_FGTS CHAR(1), ID_FPSIND_PATRONAL INTEGER, APURACAO_GRAU_RISCO SMALLINT, APURACAO_ALIQ_FAP
  SMALLINT, FORMA_INTEGRACAO_FINANCEIRO SMALLINT, ID_FPESOCSITEMP SMALLINT, ID_FPTPRETINSS SMALLINT,
  ID_FPESOCDESONER SMALLINT, ID_FPESOCENTEDUC SMALLINT, ID_FPESOCEMPTRAB SMALLINT, NRO_REG_EMP_TRAB_TEMP_MTE
  VARCHAR(30), ID_FPESOCTPAMB SMALLINT, PRIMARY KEY (COD_EMP,DATA_HORA_VIGENCIA));
"""

CARREGADAS = ("FPEVENTO", "FPLOTTRIBCAD", "FPREMESSA", "FPRESP", "FPRUBRICAFGTS_FPEVENTO",
              "FPRUBRICAINSS_FPEVENTO", "FPRUBRICAIRRF_FPEVENTO", "FPRUBRICASIND_FPEVENTO", "FPTPEVENTOAUT_TBEMPHOS",
              "PEJUSTIF", "TBTPTRIBUTO", "FPPARAM", "FPPARAMVIG")
INCIDENCIAS = ("FPRUBRICAFGTS_FPEVENTO", "FPRUBRICAINSS_FPEVENTO", "FPRUBRICAIRRF_FPEVENTO", "FPRUBRICASIND_FPEVENTO")
PAIS_EXTERNOS = {"FPTP_EVENTO": ["P", "D"], "FPTP_REFER": ["H", "V"], "FPTP_FOLHA": ["1", "2"]}
PREPARO_PROPRIO = (
    "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
    " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
    "INSERT IGNORE INTO tabela_esocial (fonte, codigo_oficial, descricao, versao_fonte, criado_em) VALUES"
    " ('esocial', '08', 'Classificacao tributaria', 'teste', UTC_TIMESTAMP(3)),"
    " ('esocial', '10', 'Tipo de lotacao tributaria', 'teste', UTC_TIMESTAMP(3));"
    "INSERT IGNORE INTO codigo_esocial (tabela_esocial_id, codigo_esocial, descricao, criado_em) SELECT id, '99',"
    " 'Pessoa juridica exemplo', UTC_TIMESTAMP(3) FROM tabela_esocial WHERE codigo_oficial = '08';"
    "INSERT IGNORE INTO codigo_esocial (tabela_esocial_id, codigo_esocial, descricao, criado_em) SELECT id, '01',"
    " 'Lotacao exemplo', UTC_TIMESTAMP(3) FROM tabela_esocial WHERE codigo_oficial = '10';"
    "INSERT IGNORE INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES"
    " ('35', 'SP', 'Estado exemplo', 1, UTC_TIMESTAMP(3));"
    # catálogos oficiais (só leitura pelo cod:): natureza 1000; 1200 com duas vigências (pai_ambiguo); FPAS 515
    # (o cod: só LÊ o catálogo; a conferência cria só os destinos do plano: aqui a forma mínima do catálogo)
    "CREATE TABLE IF NOT EXISTS natureza_rubrica (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo_esocial"
    " VARCHAR(4) NOT NULL, descricao VARCHAR(150) NOT NULL, vigencia_inicio DATE NOT NULL, versao_fonte VARCHAR(30) NOT"
    " NULL, criado_em DATETIME(3) NOT NULL, UNIQUE KEY (codigo_esocial, vigencia_inicio));"
    "CREATE TABLE IF NOT EXISTS fpas (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo_fpas CHAR(3) NOT NULL,"
    " descricao VARCHAR(255) NOT NULL, criado_em DATETIME(3) NOT NULL, UNIQUE KEY (codigo_fpas));"
    "INSERT IGNORE INTO natureza_rubrica (codigo_esocial, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES"
    " ('1000', 'Natureza exemplo', '2018-01-01', 'teste', UTC_TIMESTAMP(3)),"
    " ('1200', 'Natureza exemplo antiga', '2018-01-01', 'teste', UTC_TIMESTAMP(3)),"
    " ('1200', 'Natureza exemplo nova', '2021-01-01', 'teste', UTC_TIMESTAMP(3));"
    "INSERT IGNORE INTO fpas (codigo_fpas, descricao, criado_em) VALUES ('515', 'FPAS exemplo', UTC_TIMESTAMP(3));")


def _dono(tabela):
    """Módulo de outra fatia que já define `tabela` na imagem sintética (None: nenhum)."""
    import pathlib
    aqui = pathlib.Path(__file__).resolve()
    for p in sorted(aqui.parent.glob("*.py")):
        if p.resolve() != aqui and ("CREATE TABLE %s (" % tabela) in p.read_text(encoding="utf-8"):
            return p.stem
    return None


DONO_EMPRESA = _dono("TBEMPHOS")
REQUER = [DONO_EMPRESA] if DONO_EMPRESA else []
MOD_DONO = importlib.import_module("sante_conector.sintetica_d." + DONO_EMPRESA) if DONO_EMPRESA else None
# a conferência roda só o PREPARO_DESTINO da fatia conferida: o da dona (destino do L3, pessoa jurídica já
# cadastrada) entra antes do desta, para a adoção da dona dar o esperado dela
PREPARO_DESTINO = (getattr(MOD_DONO, "PREPARO_DESTINO", "") or "") + PREPARO_PROPRIO
if not DONO_EMPRESA:
    DDL += ("CREATE TABLE TBEMPHOS (COD SMALLINT NOT NULL, NOME VARCHAR(80), ID_FPCLASSIFTRIB VARCHAR(2), ID_TBTPCONSTRUT"
            " SMALLINT, ID_TBTPCOOPERAT SMALLINT, PRIMARY KEY (COD));\n")


def _colunas_dono(tabela):
    """Colunas de `tabela` na ordem do DDL da fatia dona (forma dela)."""
    m = re.search(r"CREATE TABLE %s \((.*?)\);" % tabela, MOD_DONO.DDL, re.S)
    return [c for c in re.findall(r"(?:^|,)\s*([A-Z_0-9]+)\s+[A-Z]", m.group(1)) if c != "PRIMARY"]


def _colunas():
    """{tabela: [(coluna, tipo, obrigatoria)]} lidas do próprio DDL (fonte única da forma)."""
    saida = {}
    for st in DDL.split(";"):
        m = re.match(r"\s*CREATE TABLE (\w+) \((.*), PRIMARY KEY", " ".join(st.split()))
        if m:
            cols = []
            for c in re.split(r",\s*(?=[A-Z_0-9]+ )", m.group(2)):
                nome, resto = c.strip().split(" ", 1)
                cols.append((nome, resto.replace(" NOT NULL", "").strip(), "NOT NULL" in resto))
            saida[m.group(1)] = cols
    return saida


COLUNAS = _colunas()
FATIA = tuple(t for t in COLUNAS if t != "TBEMPHOS")


def _falso(tipo, i):
    """Valor falso pela forma da coluna (tabelas só com a forma)."""
    if tipo.startswith(("SMALLINT", "INTEGER", "BIGINT")):
        return i
    if tipo.startswith(("VARCHAR", "CHAR")):
        n = int(tipo.split("(")[1].rstrip(")"))
        return "S" if n == 1 else ("exemplo " + str(i))[:n]
    if tipo.startswith("NUMERIC"):
        return decimal.Decimal("1.0")
    if tipo.startswith("DOUBLE"):
        return 1.5
    if tipo == "DATE":
        return datetime.date(2025, 1, i)
    if tipo == "TIMESTAMP":
        return datetime.datetime(2025, 1, i, 8, 30)
    return ("texto exemplo " + str(i)).encode("cp1252")


def cpf_falso(base9):
    """CPF de 11 dígitos com dígitos verificadores válidos a partir de 9 dígitos inventados."""
    d = [int(x) for x in "%09d" % base9]
    for n in (10, 11):
        r = sum(x * p for x, p in zip(d, range(n, 1, -1))) % 11
        d.append(0 if r < 2 else 11 - r)
    return "".join(map(str, d))


def cnpj_falso(base12):
    """CNPJ de 14 dígitos com dígitos verificadores válidos a partir de 12 dígitos inventados."""
    d = [int(x) for x in "%012d" % base12]
    for pesos in ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]):
        r = sum(x * p for x, p in zip(d, pesos)) % 11
        d.append(0 if r < 2 else 11 - r)
    return "".join(map(str, d))


def _ins(ins, tab, **v):
    ins(tab, [v.get(c) for c, _, _ in COLUNAS[tab]])


def _obrig(tab, **v):
    """Linha com as colunas NOT NULL da origem preenchidas (forma) e as dadas por cima."""
    base = {c: _falso(tp, 1) for c, tp, ob in COLUNAS[tab] if ob}
    base.update(v)
    return base


D = datetime.date
TS = datetime.datetime


def linhas(r, ins):
    for tab, cols in COLUNAS.items():
        if tab not in CARREGADAS and tab != "TBEMPHOS":
            for i in (1, 2):
                ins(tab, [_falso(tp, i) for _, tp, _ in cols])
    # justificativa de ponto: 3 sem nome (NOT NULL no destino); 4 repete o código 10 de outra empresa: o UNIQUE(codigo)
    # global do destino recusa (1062). É LIMITAÇÃO DO MODELO, não erro do dado (pedido em saida/L5-12.json)
    for idj, emp, cod, nome in [(1, 1, 10, "Atestado médico"), (2, 1, 11, "  Consulta   de rotina "), (3, 1, 12, None),
                                (4, 2, 10, "Atestado outra empresa"), (6, 1, 13, "Falta justificada ação"),
                                (7, 2, 14, "Curso externo")]:
        _ins(ins, "PEJUSTIF", ID_JUSTIF=idj, COD_EMP=emp, COD_JUSTIF=cod, NOME=nome)
    # tributo da folha: tipo pela chave (valores.d); 6 sem par no de-para (valor_fora_do_dominio) e com nome só de
    # espaços: o NOT NULL do destino recusa
    for i, nome in [(1, "Previdência exemplo"), (2, "Fundo exemplo"), (3, "Imposto exemplo"),
                    (4, "Contribuição   sobre   folha"), (5, "Sindical exemplo"), (6, "   ")]:
        _ins(ins, "TBTPTRIBUTO", ID=i, NOME=nome)
    # rubricas: natureza pelo código no catálogo oficial do destino: 1 e 2 existentes (2 inativa); 3 natureza fora do
    # catálogo (codigo_inexistente_destino, NOT NULL recusa); 4 natureza com duas vigências (pai_ambiguo, recusa)
    for i, (tp, rf, nat) in enumerate([("P", "H", 1000), ("D", "V", 1000), ("P", "V", 9999), ("D", "H", 1200)], 1):
        _ins(ins, "FPEVENTO", **_obrig("FPEVENTO", ID_EVENTO=i, COD_EMP=1, COD_EVENTO=100 + i, NOME="Rubrica %d" % i,
                                       TP_EVENTO=tp, TP_REFER=rf, PERC_INC=decimal.Decimal("50.00"), PRIORIDADE=10,
                                       SITUACAO="I" if i == 2 else "A", ID_FPNATRUBRICA=nat,
                                       FORMULA=b"SALARIO * 0.5" if i == 1 else None, FOLHA="S", FERIAS="N"))
    # incidências: rubricas 1 e 2 gravadas; o código de incidência aguarda o mecanismo (pedido 14): recusa 1364
    for t in INCIDENCIAS:
        for i in (1, 2):
            _ins(ins, t, **_obrig(t, ID_FPEVENTO=i))
    # lotação tributária: 1 FPAS 515 no catálogo; 2 FPAS fora do catálogo (codigo_inexistente_destino, NOT NULL recusa)
    for i, fpas in ((1, 515), (2, 999)):
        _ins(ins, "FPLOTTRIBCAD", ID=i, NOME="Lotacao %d" % i, DATA_VIGENCIA_INICIAL=D(2020, 1, i),
             ID_FPLOTACAOTRIB="01", ID_FPFPAS=fpas, ID_TBEMPHOS=1)
    # lançamento automático: gatilho presumido =~outro (valor_presumido); sem rubrica na origem: 1364
    for i in (1, 2):
        _ins(ins, "FPTPEVENTOAUT_TBEMPHOS", ID_FPTPEVENTOAUT=i, ID_TBEMPHOS=1, LANCAR_TP_EVENTO_AUTOM_FOLHA="S")
    # competência: 1 fechada, 2 aberta, 3 mês 13 (CHECK), 4 tipo de folha inexistente (pai_inexistente, NOT NULL),
    # 5 situação fora do domínio (padrão aberta), 6 sem fim de apuração (NOT NULL); abertura e fechamento pelas datas
    # da apuração às 00:00 (tipar)
    for i, mes, tp, fim, fech in [(1, 1, 1, D(2025, 1, 31), "S"), (2, 2, 1, D(2025, 2, 28), "N"),
                                  (3, 13, 1, D(2025, 3, 31), "N"), (4, 4, 9, D(2025, 4, 30), "N"),
                                  (5, 5, 2, D(2025, 5, 31), "X"), (6, 6, 1, None, "N")]:
        _ins(ins, "FPREMESSA", ID_REMESSA=i, COD_EMP=1, ANO_PROC=2025, MES_PROC=mes, COD_REMESSA=1, COD_TP=tp,
             DTA_INI_APUR=D(2025, min(mes, 12), 1), DTA_FIN_APUR=fim, DATA_PAGAMENTO=D(2025, min(mes, 12), 5),
             FECHADA=fech)
    # responsável: 1 válido; 2 UF sem código oficial; 3 CPF inválido (NOT NULL); 4 sem início de vigência (NOT NULL)
    for i, cpf, uf, ini in [(1, cpf_falso(123456789), "SP", D(2020, 1, 1)), (2, cpf_falso(987654321), "RJ", D(2021, 1, 1)),
                            (3, "123", "SP", D(2020, 1, 1)), (4, cpf_falso(111222333), "SP", None)]:
        _ins(ins, "FPRESP", ID_RESP=i, COD_EMP=1, COD_RESP=i, NOME="Responsavel   exemplo %d" % i, CPF=cpf,
             DTA_NASC=D(1970, 1, i), DESC_FUNCAO="Diretor", ID_TBUF=uf, TEL="5555-0000", E_MAIL="resp%d@exemplo.test" % i,
             VIGENCIA_INICIAL=ini, SITUACAO={1: "A", 2: " "}.get(i))
    # empresa (colunas lidas): 11 classificação 99 existente; 12 classificação 77 inexistente; 13 cooperativa 3
    empresas = [(11, "99", 0, 0), (12, "77", 1, 2), (13, "99", 0, 3)]
    if not DONO_EMPRESA:
        for cod, cl, co, cp in empresas:
            _ins(ins, "TBEMPHOS", COD=cod, NOME="Empresa exemplo %d" % cod, ID_FPCLASSIFTRIB=cl, ID_TBTPCONSTRUT=co,
                 ID_TBTPCOOPERAT=cp)
    else:  # a dona define TBEMPHOS: as empresas entram com a forma dela (CNPJ válido e novo; demais colunas nulas)
        cols = _colunas_dono("TBEMPHOS")
        for cod, cl, co, cp in empresas:
            v = dict(COD=cod, NOME="Empresa exemplo %d" % cod, CNPJ=int(cnpj_falso(998877660000 + cod)),
                     ID_FPCLASSIFTRIB=cl, ID_TBTPCONSTRUT=co, ID_TBTPCOOPERAT=cp)
            ins("TBEMPHOS", [v.get(c) for c in cols])
    # cadastro do empregador: 1 válido, dia de pagamento 40 (fora da faixa); 2 classificação inexistente (NOT NULL);
    # 3 responsável recusado (pai_pendente)
    for emp, resp, dia in [(11, 1, 40), (12, 2, 5), (13, 3, 5)]:
        _ins(ins, "FPPARAM", **_obrig("FPPARAM", COD_EMP=emp, ID_RESP_EMP=resp, ID_RESP_FICH=resp, COD_GPS=2100,
                                      COD_CATEG=1, DIA_PGTO=dia, INTEGRAR_PONTO_ELETRONICO="S",
                                      DATA_INICIO_ESOCIAL=D(2018, 1, 1)))
    # versões do cadastro: duas da empresa 11; uma da 12 (cadastro recusado: pai_pendente); uma da 19 (sem cadastro:
    # pai_inexistente, a versão entra sem o id da entidade)
    for emp, q in [(11, TS(2024, 1, 1, 8, 0)), (11, TS(2025, 6, 1, 9, 30)), (12, TS(2024, 3, 1, 10, 0)),
                   (19, TS(2024, 3, 1, 10, 0))]:
        _ins(ins, "FPPARAMVIG", **_obrig("FPPARAMVIG", COD_EMP=emp, DATA_HORA_VIGENCIA=q, COD_GPS=2100, COD_CATEG=1))
    esperado = {
        "PEJUSTIF": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1062": 1}},
        "TBTPTRIBUTO": {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "FPEVENTO": {"gravados": 2, "pendencias": {"vigencia_sem_fonte": 4, "codigo_inexistente_destino": 1,
                                                  "pai_ambiguo": 1, "restricao_destino_1048": 2}},
        "FPLOTTRIBCAD": {"gravados": 1, "pendencias": {"codigo_inexistente_destino": 1, "restricao_destino_1048": 1}},
        "FPTPEVENTOAUT_TBEMPHOS": {"gravados": 0, "pendencias": {"vigencia_sem_fonte": 2, "valor_presumido": 2,
                                                                "restricao_destino_1364": 2}},
        "FPREMESSA": {"gravados": 3, "pendencias": {"restricao_destino_4025": 1, "pai_inexistente": 1,
                                                   "restricao_destino_1048": 2, "valor_fora_do_dominio": 1}},
        "FPRESP": {"gravados": 2, "pendencias": {"valor_presumido": 4, "catalogo_codigo_inexistente": 1,
                                                "documento_invalido": 1, "restricao_destino_1048": 2}},
        "FPPARAM": {"gravados": 1, "pendencias": {"vigencia_sem_fonte": 2, "valor_fora_do_dominio": 1,
                                                 "catalogo_codigo_inexistente": 1, "restricao_destino_1048": 1,
                                                 "pai_pendente": 1}},
        "FPPARAMVIG": {"gravados": 3, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1}},
    }
    for t in INCIDENCIAS:  # o tributo é procurado antes de TBTPTRIBUTO carregar (ordem pedida: pedido 15)
        esperado[t] = {"gravados": 0, "pendencias": {"restricao_destino_1364": 2, "vigencia_sem_fonte": 2}}
        if t != "FPRUBRICASIND_FPEVENTO":
            esperado[t]["pendencias"]["codigo_inexistente_destino"] = 2
    if DONO_EMPRESA:  # o esperado de TBEMPHOS é o da dona (lido dela, sem inserir nada) mais as 3 empresas desta fatia
        dono = MOD_DONO.linhas(random.Random(0), lambda t, v: None).get("TBEMPHOS", {"gravados": 0, "pendencias": {}})
        esperado["TBEMPHOS"] = {"gravados": dono["gravados"] + len(empresas), "pendencias": dict(dono["pendencias"])}
    return esperado
