"""Fatia L7-08 (SADT e suprimentos, módulo SUP): tabelas da origem com a forma do dicionário e dados 100% falsos.

Nenhuma tabela da fatia é carregável hoje (esperado {}, como L6-12 e L6-13). GELANPEDENTREGA (entrega programada do
item do pedido de compra), GERASVALBAL (lote contado no inventário) e GEANTIMI (liberação do antimicrobiano) têm pai
OBRIGATÓRIO (NOT NULL) que nenhum lote carrega (BLOQUEADAS): declará-las recusaria 100% das linhas na imagem real.
Elas ficam na imagem com as anomalias que valerão quando os pais entrarem (pedido 10 em saida/L7-08.json): pai
inexistente, CHECK do destino, chave única, data sentinela, S/N fora do domínio, autorreferência em duas fases e
liberação interrompida (DATA_INT). As outras 22 entram só com a forma (2 linhas falsas cada).
"""
import datetime
import decimal

FORMAS = {
    'GELANPEDENTREGA': ('ID_GELANPED,DATA', [
        ('ID_GELANPED', 'INTEGER', True), ('DATA', 'DATE', True), ('QUANTIDADE', 'NUMERIC(18,3)', True),
    ]),
    'GERASVALBAL': ('ID', [
        ('ID', 'INTEGER', True), ('ID_GELANBAL', 'INTEGER', True), ('QTDE', 'NUMERIC(18,3)', False),
        ('ID_GEVALMEM', 'INTEGER', False), ('DATA', 'DATE', False), ('LOTE', 'VARCHAR(30)', False),
        ('ID_GERASVALFINAL', 'INTEGER', False),
    ]),
    'GEUSERS_TBCENCUS': ('USUARIO_GEUSERS,ID_TBCENCUS', [
        ('USUARIO_GEUSERS', 'VARCHAR(31)', True), ('ID_TBCENCUS', 'INTEGER', True),
    ]),
    'PRPARINTEGEST': ('ID_TBCENCUS,TP_PRESCRICAO', [
        ('ID_TBCENCUS', 'INTEGER', True), ('TP_PRESCRICAO', 'SMALLINT', True), ('TP_INTEGRACAO', 'SMALLINT', True),
        ('MOMENTO_INTEGRACAO', 'SMALLINT', True), ('GERAR_DADOS_AUTORIZ_MANIPUL', 'SMALLINT', False),
        ('ID_TBTP_ENV_LISTA_AVAL_FARM', 'SMALLINT', True),
    ]),
    'GECADNFS': ('ID', [
        ('ID', 'INTEGER', True), ('ANO', 'SMALLINT', True), ('MES', 'SMALLINT', True), ('DOC', 'INTEGER', True),
        ('NF', 'INTEGER', False), ('SERIE', 'VARCHAR(3)', False), ('FORN', 'INTEGER', False),
        ('DATA', 'DATE', False), ('NUM_LANC', 'SMALLINT', False), ('FECHA', 'NUMERIC(18,2)', False),
        ('DESCONTO', 'NUMERIC(18,2)', False), ('FRETE', 'NUMERIC(18,2)', False), ('SEGURO', 'NUMERIC(18,2)', False),
        ('OUTROS', 'NUMERIC(18,2)', False), ('PERC_ICMS', 'NUMERIC(18,2)', False), ('ICMS', 'NUMERIC(18,2)', False),
        ('INC1', 'VARCHAR(1)', False), ('INC2', 'VARCHAR(1)', False), ('INC3', 'VARCHAR(1)', False),
        ('TOTAL', 'NUMERIC(18,2)', False), ('CONSOL', 'VARCHAR(1)', False), ('CONSIS', 'VARCHAR(1)', False),
        ('QTDES', 'NUMERIC(18,3)', False), ('REFERENTE', 'VARCHAR(12)', False), ('TRANSP', 'SMALLINT', False),
        ('CONHEC', 'VARCHAR(8)', False), ('EMIS', 'DATE', False), ('DATA_GRAV', 'DATE', False),
        ('HORA_GRAV', 'VARCHAR(4)', False), ('USUARIO', 'VARCHAR(31)', False), ('MEXENDO', 'VARCHAR(31)', False),
        ('DESTINO', 'SMALLINT', False), ('EMPRESA', 'SMALLINT', False), ('USU_CONS', 'VARCHAR(31)', False),
        ('FONTE_PAG', 'SMALLINT', False), ('NAT_OP', 'SMALLINT', False), ('TIPO_DOC', 'VARCHAR(1)', False),
        ('OBS', 'VARCHAR(200)', False), ('NUM_PROCES', 'VARCHAR(40)', False), ('TIPO_COMPRA', 'VARCHAR(1)', False),
        ('DATA_HORA_INCLUSAO', 'TIMESTAMP', False), ('DATA_HORA_ULTIMA_ATUALIZACAO', 'TIMESTAMP', False),
        ('DATA_VENCIMENTO_FRETE', 'DATE', False), ('BASE_CALC_ICMS', 'NUMERIC(18,2)', False),
        ('NOTA_ENTRADA', 'INTEGER', False),
    ]),
    'GEANTIMI': ('ID_GEANTIMI', [
        ('ID_GEANTIMI', 'INTEGER', True), ('ID_GECADANTIMI', 'INTEGER', True), ('TIPO', 'VARCHAR(1)', True),
        ('REG', 'INTEGER', True), ('ITEM', 'INTEGER', True), ('DATA', 'DATE', True), ('DIAS', 'SMALLINT', True),
        ('QTDE_TOMADA', 'NUMERIC(18,3)', True), ('QTDE_TOTAL', 'NUMERIC(18,3)', True),
        ('DATA_INI', 'TIMESTAMP', False), ('DATA_INT', 'TIMESTAMP', False), ('PRO_TER', 'VARCHAR(1)', False),
        ('USU_INT', 'VARCHAR(31)', False), ('USUARIO', 'VARCHAR(31)', False), ('ID_TBUNICON', 'VARCHAR(7)', True),
        ('ID_GEANTIMI_ORIGEM_TRAT', 'INTEGER', False), ('DATA_VIGENCIA_INICIAL', 'TIMESTAMP', True),
        ('DATA_VIGENCIA_FINAL', 'TIMESTAMP', True), ('QUANTIDADE_DOSE', 'NUMERIC(18,3)', True),
        ('DOSE_EXTRA', 'CHAR(1)', True), ('ID_PRFREQUENCIA', 'SMALLINT', True), ('DIA_INICIO', 'SMALLINT', False),
        ('ID_RICADPAC', 'INTEGER', False),
    ]),
    'GECADDEV': ('ID', [
        ('ID', 'INTEGER', True), ('ANO', 'SMALLINT', True), ('MES', 'SMALLINT', True), ('DOC', 'INTEGER', True),
        ('REQ', 'INTEGER', False), ('DEST', 'SMALLINT', False), ('DATA', 'DATE', False),
        ('OBS', 'VARCHAR(60)', False), ('CONSOL', 'VARCHAR(1)', False), ('PAC', 'INTEGER', False),
        ('ARM', 'SMALLINT', False), ('CON', 'SMALLINT', False), ('CDC', 'INTEGER', True),
        ('CONV', 'SMALLINT', False), ('EMPRESA', 'SMALLINT', False), ('REQUISICAO', 'VARCHAR(1)', False),
        ('EMIT', 'VARCHAR(1)', False), ('HORA_GRAV', 'VARCHAR(4)', False), ('DATA_GRAV', 'DATE', False),
        ('USUARIO', 'VARCHAR(31)', False), ('MEXENDO', 'VARCHAR(31)', False), ('NASC_TER', 'DATE', False),
        ('TERCEIRO', 'VARCHAR(45)', False), ('DOCSAI', 'INTEGER', False), ('ANO_SAI', 'SMALLINT', False),
        ('MES_SAI', 'SMALLINT', False), ('USU_CONS', 'VARCHAR(31)', False), ('HORA', 'VARCHAR(4)', False),
        ('DATA_HORA_INCLUSAO', 'TIMESTAMP', False), ('DATA_HORA_ULTIMA_ATUALIZACAO', 'TIMESTAMP', False),
        ('CDC_BK', 'INTEGER', False), ('ID_RICADPAC', 'INTEGER', False),
    ]),
    'GECADDISPENSACAO': ('ID', [
        ('ID', 'INTEGER', True), ('DOC', 'INTEGER', True), ('MES', 'SMALLINT', True), ('ANO', 'SMALLINT', True),
        ('TIPO_CONTA', 'SMALLINT', True), ('COD_PRESCRI', 'INTEGER', True), ('DATA', 'TIMESTAMP', True),
        ('REG', 'INTEGER', True), ('CONTA', 'BIGINT', True), ('CDC', 'INTEGER', False),
        ('LOC_ARM', 'SMALLINT', True), ('LOC_CONS', 'SMALLINT', True), ('USUARIO', 'VARCHAR(31)', False),
        ('DATA_CADASTRO', 'TIMESTAMP', True), ('CONV', 'SMALLINT', False), ('OLD_ID_PRPRESC', 'INTEGER', False),
        ('ID_TBCBOPRO', 'INTEGER', False), ('CDC_BK', 'INTEGER', False), ('ID_RICADPAC', 'INTEGER', False),
    ]),
    'GECADSAI': ('ID', [
        ('ID', 'INTEGER', True), ('ANO', 'SMALLINT', True), ('MES', 'SMALLINT', True), ('DOC', 'INTEGER', True),
        ('REQ', 'INTEGER', False), ('DEST', 'SMALLINT', False), ('DATA', 'DATE', False),
        ('OBS', 'VARCHAR(60)', False), ('EMIT', 'VARCHAR(1)', False), ('CONTA', 'BIGINT', False),
        ('CONSOL', 'VARCHAR(1)', False), ('PAC', 'INTEGER', False), ('CONS', 'SMALLINT', False),
        ('ARM', 'SMALLINT', False), ('CDC', 'INTEGER', False), ('CONV', 'SMALLINT', False),
        ('EMP', 'SMALLINT', False), ('DESCON', 'NUMERIC(4,2)', False), ('REQUISICAO', 'VARCHAR(1)', False),
        ('CUPOM', 'BIGINT', False), ('TCE', 'VARCHAR(1)', False), ('TIPO_DESC', 'SMALLINT', False),
        ('DATA_GRAV', 'DATE', False), ('CRM', 'INTEGER', False), ('HORA', 'VARCHAR(4)', True),
        ('HORA_GRAV', 'VARCHAR(4)', False), ('USUARIO', 'VARCHAR(31)', False), ('USU_CONS', 'VARCHAR(31)', False),
        ('MEXENDO', 'VARCHAR(31)', False), ('NASC', 'DATE', False), ('ORIGEM', 'VARCHAR(1)', False),
        ('PERIODO', 'SMALLINT', False), ('TERCEIRO', 'VARCHAR(45)', False), ('MED_SOL', 'VARCHAR(40)', False),
        ('ID_PRESC', 'INTEGER', True), ('ID_TBCBOPRO', 'INTEGER', False), ('DOC_DISP', 'VARCHAR(1)', True),
        ('DATA_HORA_GRAV', 'TIMESTAMP', False), ('DATA_HORA_INCLUSAO', 'TIMESTAMP', False),
        ('DATA_HORA_ULTIMA_ATUALIZACAO', 'TIMESTAMP', False), ('CDC_BK', 'INTEGER', False),
        ('ID_RICADPAC', 'INTEGER', False),
    ]),
    'GECTRLENTREGADOCSAIDA': ('ID', [
        ('ID', 'INTEGER', True), ('ID_GECADSAI', 'INTEGER', False), ('ID_GELANPAC', 'INTEGER', False),
        ('ID_TBSITUACAOFARMACIA', 'INTEGER', True), ('DATA_HORA', 'TIMESTAMP', True),
        ('MOTIVO_ESTORNO', 'BLOB SUB_TYPE 1', False), ('ID_TBUSERS', 'VARCHAR(31)', True),
    ]),
    'GEINFVENEXT': ('ID_GECADSAI', [
        ('ID_GECADSAI', 'INTEGER', True), ('NUMERO_FOLHA_GASTO', 'INTEGER', False),
        ('NUMERO_CHAMADA', 'INTEGER', False), ('NUMERO_BO', 'INTEGER', False),
    ]),
    'GELANDISPENSACAO': ('ID', [
        ('ID', 'INTEGER', True), ('ID_GECADDISPENSACAO', 'INTEGER', True), ('ITEM', 'INTEGER', True),
        ('HM', 'SMALLINT', True), ('VIA', 'VARCHAR(2)', False), ('DOSE', 'TIMESTAMP', True),
        ('QTDE', 'NUMERIC(18,3)', False), ('PRIMEIRA_DOSE_REF', 'VARCHAR(1)', True), ('SEQ', 'SMALLINT', True),
        ('JUSTIFICA_ITEM_NAO_PRESC', 'VARCHAR(100)', False),
    ]),
    'GELANSAI': ('ID_GELANSAI', [
        ('ID_GELANSAI', 'INTEGER', True), ('ANO', 'SMALLINT', True), ('MES', 'SMALLINT', True),
        ('DOC', 'INTEGER', True), ('SEQ', 'SMALLINT', True), ('ITEM', 'INTEGER', True),
        ('QTDE', 'NUMERIC(18,3)', False), ('CONSOL', 'VARCHAR(1)', False), ('HM', 'SMALLINT', False),
        ('COD_NOC', 'SMALLINT', False), ('ETIQ', 'SMALLINT', False), ('KIT', 'INTEGER', False),
        ('VIA', 'VARCHAR(2)', False), ('DOSE1', 'VARCHAR(4)', False), ('ORIGINAL', 'INTEGER', False),
        ('TIPO_ANT', 'VARCHAR(1)', False), ('PAGO', 'VARCHAR(1)', False), ('VLRMED', 'NUMERIC(18,2)', False),
        ('STATUS', 'VARCHAR(1)', False), ('FORN', 'INTEGER', False), ('VLR_UNI', 'NUMERIC(18,4)', False),
        ('QTDE_REQ', 'NUMERIC(18,3)', False), ('MOT_INC', 'SMALLINT', False), ('PREPARADO', 'VARCHAR(1)', False),
        ('RET_DIAS', 'SMALLINT', False), ('TRANSICAO', 'VARCHAR(1)', False), ('ID_NOMCOM', 'INTEGER', True),
        ('CRM_MAT_MED_CONT', 'INTEGER', True), ('STATUSPEP', 'VARCHAR(1)', False),
        ('PROCESSADO', 'VARCHAR(1)', True), ('OBS', 'VARCHAR(250)', False),
        ('DATA_HORA_INCLUSAO', 'TIMESTAMP', False), ('DATA_HORA_ULTIMA_ATUALIZACAO', 'TIMESTAMP', False),
        ('ID_TBCBOPRO_MAT_MED_CONTROLADO', 'INTEGER', True), ('ID_GEANTIMI', 'INTEGER', False),
        ('JUSTIFICA_ITEM_NAO_PRESC', 'VARCHAR(100)', False), ('JUSTIFICA_QTDE_PRESC_X_DISP', 'VARCHAR(100)', False),
    ]),
    'GEITEMKITRAS_GELANSAI': ('ID_GELANSAI,ID_GEITEMKITRAS', [
        ('ID_GELANSAI', 'INTEGER', True), ('ID_GEITEMKITRAS', 'INTEGER', True),
    ]),
    'GELANDEV': ('ID_GELANDEV', [
        ('ID_GELANDEV', 'INTEGER', True), ('ID_GECADDEV', 'INTEGER', True), ('OLD_ANO', 'SMALLINT', False),
        ('OLD_MES', 'SMALLINT', False), ('OLD_DOC', 'INTEGER', False), ('ITEM', 'INTEGER', True),
        ('DATA', 'DATE', True), ('LOCAL', 'SMALLINT', True), ('QTDE', 'NUMERIC(18,3)', False),
        ('CONSOL', 'VARCHAR(1)', False), ('NOC', 'SMALLINT', False), ('VALIDADE', 'DATE', False),
        ('LOTE', 'VARCHAR(20)', False), ('DOCSAI', 'INTEGER', True), ('VLRMED', 'NUMERIC(18,2)', False),
        ('STATUS', 'VARCHAR(1)', False), ('KIT', 'INTEGER', True), ('PREPARADO', 'VARCHAR(1)', False),
        ('VALOR_MANUAL', 'VARCHAR(1)', True), ('ID_NOMCOM', 'INTEGER', True), ('ID_GELANSAI', 'INTEGER', False),
        ('SEQ', 'SMALLINT', True), ('DATA_HORA_INCLUSAO', 'TIMESTAMP', False),
        ('DATA_HORA_ULTIMA_ATUALIZACAO', 'TIMESTAMP', False),
    ]),
    'GEITEMKITRAS_GELANDEV': ('ID_GELANDEV,ID_GEITEMKITRAS', [
        ('ID_GELANDEV', 'INTEGER', True), ('ID_GEITEMKITRAS', 'INTEGER', True),
    ]),
    'GELANSAIREQ': ('ANO,MES,DOC,SEQ,ITEM', [
        ('ANO', 'SMALLINT', True), ('MES', 'SMALLINT', True), ('DOC', 'INTEGER', True), ('SEQ', 'SMALLINT', True),
        ('ITEM', 'INTEGER', True), ('QTDE', 'NUMERIC(18,3)', False), ('HM', 'SMALLINT', False),
        ('COD_NOC', 'SMALLINT', False), ('ETIQ', 'SMALLINT', False), ('KIT', 'INTEGER', False),
        ('VIA', 'VARCHAR(2)', False), ('DOSE1', 'VARCHAR(4)', False), ('ORIGINAL', 'INTEGER', False),
        ('TIPO_ANT', 'VARCHAR(1)', False), ('PAGO', 'VARCHAR(1)', False), ('VLRMED', 'NUMERIC(18,2)', False),
        ('STATUS', 'VARCHAR(1)', False), ('FORN', 'INTEGER', False), ('VLR_UNI', 'NUMERIC(18,4)', False),
        ('QTDE_REQ', 'NUMERIC(18,3)', False), ('MOT_INC', 'SMALLINT', False), ('PREPARADO', 'VARCHAR(1)', False),
        ('RET_DIAS', 'SMALLINT', False), ('TRANSICAO', 'VARCHAR(1)', False), ('ID_NOMCOM', 'INTEGER', True),
        ('CRM_MAT_MED_CONT', 'INTEGER', True), ('STATUSPEP', 'VARCHAR(1)', False),
        ('PROCESSADO', 'VARCHAR(1)', True), ('OBS', 'VARCHAR(250)', False),
        ('DATA_HORA_INCLUSAO', 'TIMESTAMP', False), ('DATA_HORA_ULTIMA_ATUALIZACAO', 'TIMESTAMP', False),
        ('ID_TBCBOPRO_MAT_MED_CONTROLADO', 'INTEGER', True), ('ID_GELANSAI_SUBSTITUIDO', 'INTEGER', False),
    ]),
    'GERASVALSAIDLOTE': ('ID', [
        ('ID', 'INTEGER', True), ('ID_GELANSAI', 'INTEGER', True), ('QTDE', 'NUMERIC(18,3)', False),
        ('ID_GEVALMEM', 'INTEGER', False), ('DATA', 'DATE', False), ('LOTE', 'VARCHAR(30)', False),
        ('ID_GERASVALFINAL', 'INTEGER', False),
    ]),
    'GEQTDELOTEVALLOTEDOCSAIDA': ('ID_GERASVALSAIDLOTE', [
        ('ID_GERASVALSAIDLOTE', 'INTEGER', True), ('QTDE', 'NUMERIC(18,3)', False),
    ]),
    'GERASVALDEVLOTE': ('ID', [
        ('ID', 'INTEGER', True), ('ID_GELANDEV', 'INTEGER', False), ('ID_GEVALMEM', 'INTEGER', False),
        ('ID_GERASVALSAIDLOTE', 'INTEGER', False), ('DATA', 'DATE', False), ('LOTE', 'VARCHAR(30)', False),
        ('QTDE', 'NUMERIC(18,3)', False), ('ID_GERASVALFINAL', 'INTEGER', False), ('ID_TBLABORA', 'SMALLINT', False),
    ]),
    'GEPARAM': ('USUARIO', [
        ('USUARIO', 'VARCHAR(31)', True), ('EMPRES', 'VARCHAR(30)', False), ('ENDERECO', 'VARCHAR(30)', False),
        ('CIDADE', 'VARCHAR(25)', False), ('FONE', 'VARCHAR(15)', False), ('CEP', 'INTEGER', False),
        ('IMPOK', 'VARCHAR(1)', False), ('ESTADO', 'VARCHAR(2)', False), ('MESPRO', 'SMALLINT', False),
        ('ANOPRO', 'SMALLINT', False), ('GER_DMM', 'VARCHAR(1)', False), ('DIG_DOC', 'VARCHAR(1)', False),
        ('ARM_UNI', 'VARCHAR(1)', False), ('DATVAL', 'VARCHAR(1)', False), ('INF_MED', 'VARCHAR(1)', False),
        ('CONS_QTDE', 'VARCHAR(1)', False), ('VLR_SAI', 'VARCHAR(1)', False), ('HOR_MED', 'VARCHAR(1)', False),
        ('VENC_NF', 'VARCHAR(1)', False), ('CONS_AUT', 'VARCHAR(1)', False), ('SERIAL', 'SMALLINT', False),
        ('COD_BARRAS', 'VARCHAR(1)', False), ('CONS_EST_MIN', 'VARCHAR(1)', False),
        ('GERAR_DOCS', 'VARCHAR(1)', False), ('DIG_VIA', 'VARCHAR(1)', False), ('VLR_DEV', 'VARCHAR(1)', False),
        ('VLR_REQ', 'VARCHAR(1)', False), ('VLR_VEXT', 'VARCHAR(1)', False), ('ITEVAL', 'VARCHAR(1)', False),
        ('PERC_CPA', 'SMALLINT', False), ('BARRAS_TR', 'VARCHAR(1)', False), ('BARRAS_DV', 'VARCHAR(1)', False),
        ('TRCB', 'VARCHAR(1)', False), ('VLR_VEXT_T', 'VARCHAR(1)', False), ('PERC_VE_F', 'NUMERIC(4,2)', False),
        ('PERC_VE_T', 'NUMERIC(4,2)', False), ('ATU_FAT', 'VARCHAR(1)', False), ('GRA_01', 'VARCHAR(1)', False),
        ('DEV_PACCDC', 'VARCHAR(1)', False), ('DIG_CRM', 'VARCHAR(1)', False), ('DIG_TRANSP', 'VARCHAR(1)', False),
        ('DIG_CONHEC', 'VARCHAR(1)', False), ('EMI_NF', 'VARCHAR(1)', False), ('PED_NF', 'VARCHAR(1)', False),
        ('REQ_ENT', 'SMALLINT', False), ('REQ_SAI', 'SMALLINT', False), ('REQ_DEV', 'SMALLINT', False),
        ('REQ_REQ', 'SMALLINT', False), ('SEQ_478', 'INTEGER', False), ('REQ_HOR', 'VARCHAR(1)', False),
        ('PESQ_ITE', 'VARCHAR(1)', False), ('DIG_MAR', 'VARCHAR(1)', False), ('MML', 'VARCHAR(1)', False),
        ('ETIQ_DOSE', 'SMALLINT', False), ('HOSP', 'SMALLINT', False), ('DATA_EI', 'DATE', False),
        ('PI_ENT', 'DATE', False), ('PF_ENT', 'DATE', False), ('PI_SAI', 'DATE', False), ('PF_SAI', 'DATE', False),
        ('PI_DEV', 'DATE', False), ('PF_DEV', 'DATE', False), ('PI_TRA', 'DATE', False), ('PF_TRA', 'DATE', False),
        ('VLR_TRANSF', 'VARCHAR(1)', False), ('CDC_INT', 'VARCHAR(1)', False), ('PI_PED', 'DATE', False),
        ('PF_PED', 'DATE', False), ('DIG_LAB', 'VARCHAR(1)', False), ('SENHA', 'VARCHAR(6)', False),
        ('CONS_ORC', 'VARCHAR(1)', False), ('SAI_DEV', 'VARCHAR(1)', False), ('QDO_ESC', 'VARCHAR(1)', False),
        ('IND_ATU_FAT', 'VARCHAR(1)', False), ('PATH', 'VARCHAR(50)', False), ('PATHI', 'VARCHAR(50)', False),
        ('DEST_NF', 'VARCHAR(1)', False), ('RESP_TEC', 'VARCHAR(70)', False), ('COM_FONE', 'VARCHAR(15)', False),
        ('COM_FAX', 'VARCHAR(15)', False), ('COM_EMAIL', 'VARCHAR(100)', False),
        ('COM_PRESID', 'VARCHAR(70)', False), ('COM_ENCARR', 'VARCHAR(70)', False),
        ('DIAS_PESQ_EXT', 'SMALLINT', False), ('COM_EMAIL_SERV', 'VARCHAR(40)', False),
        ('COM_EMAIL_USER', 'VARCHAR(40)', False), ('FATOR_ENT', 'VARCHAR(1)', False),
        ('GSI_VENC', 'VARCHAR(1)', False), ('VISUAL_REQ', 'VARCHAR(1)', False), ('ORDEM_REQ', 'VARCHAR(1)', False),
        ('COM_RAMAL', 'SMALLINT', False), ('VAL_DEV', 'VARCHAR(1)', False), ('MOD_PED', 'SMALLINT', False),
        ('REQ_SEM_QTDE', 'VARCHAR(1)', False), ('AVISO_PED', 'VARCHAR(1)', False),
        ('FONTE_PAG', 'VARCHAR(1)', False), ('EMPENHO', 'VARCHAR(1)', False), ('FIN_OBJ', 'VARCHAR(1)', False),
        ('REG_MS', 'VARCHAR(1)', False), ('MARCA', 'VARCHAR(1)', False), ('SETOR', 'VARCHAR(1)', False),
        ('REQUIS', 'VARCHAR(1)', False), ('SOLIC', 'VARCHAR(1)', False), ('MOT_INC_REQ', 'VARCHAR(1)', False),
        ('OBS_CONPAG', 'VARCHAR(1)', False), ('INTEG_FIN', 'VARCHAR(1)', False), ('INTEG_CONT', 'VARCHAR(1)', False),
        ('RASTREAR', 'VARCHAR(1)', False), ('LANC_AVISTA', 'VARCHAR(1)', False), ('HIS_PAD', 'SMALLINT', False),
        ('CDC_CRE', 'INTEGER', False), ('CDC_DEB', 'INTEGER', False), ('IMP_AP', 'VARCHAR(1)', False),
        ('PER_CHE_REQ', 'SMALLINT', False), ('NAT_OP', 'VARCHAR(1)', False),
        ('CONS_DOC_ANT_EXT', 'VARCHAR(1)', False), ('DIAS_PES_CONS', 'SMALLINT', False),
        ('VENC_ANT_EMI', 'VARCHAR(1)', False), ('OBSTRA', 'VARCHAR(350)', False),
        ('VISU_QTDE_VLR_REQ', 'CHAR(1)', False), ('GRAVA_MES_REQ', 'VARCHAR(1)', False),
        ('ANO_SALDO', 'SMALLINT', False), ('MES_SALDO', 'SMALLINT', False), ('QTD_LIN_REQ', 'SMALLINT', False),
        ('DIG_FATOR_PED', 'VARCHAR(1)', False), ('INC_FORN_COMP', 'VARCHAR(1)', False),
        ('SEP_MED_CONT_REQ', 'VARCHAR(1)', False), ('SGHCOT_PRAZ_ENT', 'VARCHAR(1)', False),
        ('SGHCOT_VLR_FRETE', 'VARCHAR(1)', False), ('SGHCOT_VLR_MIN', 'VARCHAR(1)', False),
        ('DIG_FATOR_NEC', 'VARCHAR(1)', False), ('CONT_PROV_NOTA', 'VARCHAR(1)', False),
        ('UNID_GEST', 'INTEGER', False), ('DT_INIC_GEST_RESP', 'DATE', False), ('DT_INIC_GEST_RATIA', 'DATE', False),
        ('INF_REG_EXEC', 'VARCHAR(1)', False), ('INF_TIP_RESP', 'VARCHAR(1)', False),
        ('INF_TIP_DISP', 'VARCHAR(1)', False), ('CPF_RESP', 'VARCHAR(11)', False),
        ('CPF_RATIA', 'VARCHAR(11)', False), ('INC_TIP_DOC_COMP', 'VARCHAR(1)', False),
        ('INC_SERIE_COMP', 'VARCHAR(1)', False), ('IMP_NUM_PED_ENT', 'VARCHAR(1)', False),
        ('IMP_VENC_NF', 'VARCHAR(1)', False), ('LANC_CONT_EMIS', 'CHAR(1)', False),
        ('PER_DIST_MATMED', 'SMALLINT', False), ('VIS_RET_DIST_MATMED', 'VARCHAR(1)', False),
        ('CONS_GSI', 'VARCHAR(1)', False), ('INTEG_PRONT', 'VARCHAR(1)', False),
        ('CONS_DOC_FOR', 'VARCHAR(1)', False), ('GER_REG_PREC', 'VARCHAR(1)', False),
        ('CONS_REG_ALL_FORN', 'VARCHAR(1)', False), ('QTD_LIN_ENT', 'SMALLINT', False),
        ('CHE_PRIN_ATI', 'VARCHAR(1)', False), ('NUM_VIAS', 'SMALLINT', False),
        ('SGHCOT_RESPON', 'VARCHAR(1)', False), ('SGHCOT_DOC', 'VARCHAR(1)', False),
        ('COT_DOC_VENC', 'VARCHAR(1)', False), ('NUMERO_PROCESSO', 'VARCHAR(1)', False),
        ('LIST_DOC_VENC', 'VARCHAR(1)', False), ('COPIA_SETOR_COMPRA', 'VARCHAR(1)', False),
        ('INF_FINAN_PED', 'VARCHAR(1)', True), ('INF_FINAN_LIC', 'VARCHAR(1)', True),
        ('QTD_LIN_DEV', 'SMALLINT', True), ('QTD_LIN_TRAN', 'SMALLINT', True),
        ('QTDE_DIFER_PED', 'VARCHAR(1)', True), ('IMP_OBS_REQ_ENT', 'VARCHAR(1)', True),
        ('INTEG_SAIDA_CONT', 'VARCHAR(1)', True), ('INTEG_SAIDA_CUST', 'VARCHAR(1)', True),
        ('HIS_PAD_SAIDA', 'SMALLINT', True), ('CRM_MATMEDCONT', 'VARCHAR(1)', True),
        ('LOTE_VALIDADE_SAID_DEVOL', 'SMALLINT', True), ('FARM_RESP', 'VARCHAR(70)', True),
        ('ID_GESALDO', 'INTEGER', True), ('UNI_DIG_EST_INI', 'SMALLINT', True),
        ('UNI_VIS_EST_INI', 'SMALLINT', True), ('UNI_DIG_BALANCO', 'SMALLINT', True),
        ('UNI_VIS_BALANCO', 'SMALLINT', True), ('UNI_DIG_MOV_PAC', 'SMALLINT', True),
        ('UNI_VIS_MOV_PAC', 'SMALLINT', True), ('UNI_DIG_MOV_CDC', 'SMALLINT', True),
        ('UNI_VIS_MOV_CDC', 'SMALLINT', True), ('UNI_DIG_TRA', 'SMALLINT', True), ('UNI_VIS_TRA', 'SMALLINT', True),
        ('UNI_DIG_COMP', 'SMALLINT', True), ('UNI_VIS_COMP', 'SMALLINT', True), ('UNI_DIG_ENT', 'SMALLINT', True),
        ('UNI_VIS_ENT', 'SMALLINT', True), ('PERM_ANTI_SUP1', 'VARCHAR(1)', True),
        ('DIG_JUST_PERM_ANTI_SUP1', 'VARCHAR(1)', True), ('BARRAS_BALANCO', 'VARCHAR(1)', True),
        ('LOTE_VALIDADE_TRANSF', 'SMALLINT', True), ('SUG_LT_VAL_AUT', 'VARCHAR(1)', False),
        ('CONS_DISP_HOR', 'VARCHAR(1)', True), ('SUG_MOV_TRANS_DISP_HOR', 'VARCHAR(1)', True),
        ('SUG_LOT_VAL_DISP_HOR', 'VARCHAR(1)', True), ('TEMP_ATU_LISTA_MP', 'SMALLINT', False),
        ('TEMPO_MP', 'SMALLINT', False), ('RASTREAR_LOTE', 'VARCHAR(1)', False),
        ('OLD_DIG_CRM_LANPAC', 'VARCHAR(1)', False), ('GER_DOC_SAID_COMPL_DISP_HOR', 'VARCHAR(1)', True),
        ('EXIGIR_PRAZO_ENT', 'VARCHAR(1)', False), ('CONS_DT_POST_LANC_POST_DOSE1', 'VARCHAR(1)', True),
        ('CONS_DT_ATUAL_LANC_ENTRE_DOSE1', 'VARCHAR(1)', True), ('DESCTABKITS', 'VARCHAR(1)', False),
        ('FARM_RESP_MP', 'INTEGER', False), ('PMS_OBRIG', 'VARCHAR(1)', True),
        ('DATA_INICIO_RASTREABILIDADE', 'TIMESTAMP', False), ('UNI_VIS_CAD_ITEM', 'SMALLINT', True),
        ('BARRAS_ESTINI', 'VARCHAR(1)', True), ('UNI_DIG_CAD_ITEM', 'SMALLINT', True),
        ('INTEG_CONT_FRETE_N_INCL', 'VARCHAR(1)', True), ('LOCAL_MANIPULACAO', 'SMALLINT', False),
        ('COD_SIMPAS', 'VARCHAR(1)', True), ('GERAR_DOC_TRANSF_MANIP', 'VARCHAR(1)', True),
        ('UNI_VIS_MOV_VE', 'SMALLINT', True), ('UNI_DIG_MOV_VE', 'SMALLINT', True),
        ('PROG_ENTREGA', 'VARCHAR(1)', False), ('DIG_QTDE_ENT', 'VARCHAR(1)', True),
        ('INTEG_DT_ENTRADA', 'VARCHAR(1)', True), ('ALERTA_SEM_ESTOQUE', 'VARCHAR(1)', False),
        ('NUMERO_PED_ITEM', 'VARCHAR(1)', False), ('TIPO_INTEGRACAO_CONTABIL', 'SMALLINT', False),
        ('DIG_OBRIGATORIA_PEDIDO_NF', 'CHAR(1)', False), ('DIG_CFOP_GECADNFS', 'CHAR(1)', False),
        ('DIG_CFOP_GELANNFS', 'CHAR(1)', False), ('LANCAR_ITEM_SIMILAR', 'CHAR(1)', False),
        ('APRESENTAR_PAC_ENT_CONSIGNADO', 'CHAR(1)', False), ('DIGITAR_CDC_NECESSIDADE_COMPRA', 'CHAR(1)', False),
        ('DIGITAR_CDC_PEDIDO', 'CHAR(1)', False), ('PERMITIR_SAIDA_KIT_ITEM_RASTRE', 'CHAR(1)', False),
        ('UTILIZAR_AUTORIZACAO_PEDIDO', 'CHAR(1)', False), ('GERAR_PEDIDO_OPME_DOC_SAIDA', 'CHAR(1)', False),
        ('ENVIAR_EMAIL_PEDIDO_COMPRA', 'CHAR(1)', False), ('DIGITAR_NUM_CTR_VENDA_EXT_TERC', 'CHAR(1)', False),
        ('INCLUIR_DT_EMISSAO_COMPL_CONT', 'CHAR(1)', False), ('INTEGRAR_APOIO_COTACAO', 'CHAR(1)', False),
        ('INTEGRAR_FRETE_NAO_INCLUSO_FIN', 'SMALLINT', False), ('ID_TBCBOPRO_FARM_RESP_GERAL', 'INTEGER', False),
        ('PERMITIR_ALT_EXC_ITEM_REQ_SAI', 'CHAR(1)', False), ('GRAVAR_QTDE_REQ_FAT_CONV', 'CHAR(1)', False),
        ('UTILIZAR_COD_BARRAS_REQUISICAO', 'CHAR(1)', False), ('UTILIZAR_CTR_CONSIGNADOS_OPME', 'CHAR(1)', False),
        ('TP_EMISSAO_DISPENSACAO', 'SMALLINT', False), ('OLD_ID_TBCBOPRO_RESP_MANIPULACA', 'INTEGER', False),
        ('CARGO_COMPRA', 'VARCHAR(25)', False), ('BUSCAR_QTD_GRAV_DOC_COD_BARRA', 'CHAR(1)', False),
        ('PERMITIR_DISP_ATEND_EXT_SUP_24H', 'CHAR(1)', False), ('INTEGRAR_DESCONTO_NF_FIN_CONT', 'CHAR(1)', False),
        ('DIGITAR_DTA_HR_USU_EMAIL_PED', 'CHAR(1)', False), ('INTEGRAR_NF_CFOP_DOACAO_CONT', 'CHAR(1)', False),
        ('DIGITAR_LABORA_ITEM_ENTRADA', 'SMALLINT', False), ('CONTROLAR_SAIDA_PROFILATICO', 'CHAR(1)', False),
        ('PERMITIR_ENT_PED_ITEM_QTDE_DIF', 'CHAR(1)', False), ('ENDERECO_WS_APOIO_COTACAO', 'VARCHAR(150)', False),
        ('UTILIZAR_LEITOR_COD_BARRA_DISP', 'CHAR(1)', False), ('ID_TBEDITREL_ORDEM_COMPRA', 'INTEGER', False),
        ('PERM_ANEXAR_QTD_DISP_COD_BARRA', 'CHAR(1)', False), ('ID_TBEMPHOS_INTEG_CONT_CUSTO', 'SMALLINT', True),
        ('OBS_MOV_CDC_ACERTO_OBRIGATORIO', 'CHAR(1)', True), ('ENVIA_EMAIL_ALTERA_SIT_PEDIDO', 'CHAR(1)', False),
        ('CONTA_DESCONTO', 'INTEGER', False), ('ANEXAR_QUANTIDADE_TOTAL_LOTE', 'CHAR(1)', False),
        ('INFORMAR_MOT_EXC_ITEM_SAIDA', 'CHAR(1)', False), ('API_CONTROLE_BLOQUEIO', 'VARCHAR(255)', False),
        ('SUBSTITUICAO_ITENS_PRESCRITOS', 'CHAR(1)', False), ('LANCAR_ITENS_NAO_PRESCRITOS', 'SMALLINT', False),
        ('CONSIDERA_NOME_COMERC_LOTE_MOV', 'SMALLINT', False), ('OBRIG_JUSTIF_SUBSTITUICAO', 'SMALLINT', False),
        ('OBRIG_JUST_INCL_ITEM_NAO_PRESC', 'SMALLINT', False), ('DIG_LOTE_VAL_ITE_CONSIG_REQ', 'VARCHAR(1)', False),
        ('UTILIZAR_DATAMATRIX_QRCODE', 'VARCHAR(1)', False), ('CONSISTIR_QTDE_PRESC_X_DISP', 'SMALLINT', False),
    ]),
    'GEDISPHOR': ('ID', [
        ('ID', 'INTEGER', True), ('ID_GELANSAI', 'INTEGER', False), ('DATA_DISPENSA', 'TIMESTAMP', True),
        ('QUANTIDADE', 'NUMERIC(18,3)', True), ('ID_GELANDISPENSACAO', 'INTEGER', False),
        ('EMITIDO', 'VARCHAR(1)', True), ('USUARIO_EMISSAO', 'VARCHAR(31)', False),
        ('DATA_EMISSAO', 'TIMESTAMP', False), ('OLD_DOC_SAI', 'INTEGER', False), ('OLD_MES_SAI', 'SMALLINT', False),
        ('OLD_ANO_SAI', 'SMALLINT', False), ('ID_SEQ_ETIQ', 'INTEGER', False), ('ID_GECADSAI', 'INTEGER', False),
        ('ID_PRCHKGERAL', 'INTEGER', False),
    ]),
    'PREXTRATOITEM_SUBST': ('ID', [
        ('ID', 'INTEGER', True), ('ID_PRCHKGERAL', 'INTEGER', False), ('ID_GEITENS', 'INTEGER', True),
        ('ID_GENOMCOM', 'INTEGER', False), ('QTDE_DOSE', 'NUMERIC(18,3)', True),
        ('ID_TBUNICON_UNI_PRESC', 'VARCHAR(7)', True), ('ID_TBUSERS', 'VARCHAR(31)', True),
        ('DATA_HORA_HISTORICO', 'TIMESTAMP', True), ('DATA_HORA_HISTORICO_UTC', 'VARCHAR(30)', True),
        ('FUSO_HORARIO_HISTORICO', 'SMALLINT', False),
    ]),
    'PREXTRATOITEM_TBSITFARM': ('ID', [
        ('ID', 'INTEGER', True), ('ID_PRCHKGERAL', 'INTEGER', False), ('ID_TBSITUACAOFARMACIA', 'SMALLINT', True),
        ('ID_TBUSERS', 'VARCHAR(31)', True), ('DATA_HORA_HISTORICO', 'TIMESTAMP', True),
        ('DATA_HORA_HISTORICO_UTC', 'VARCHAR(30)', True), ('FUSO_HORARIO_HISTORICO', 'SMALLINT', False),
        ('JUSTIFICATIVA_APROVACAO_MEDICA', 'VARCHAR(254)', False),
    ]),
    'PRINTEGRACAOESTOQUE': ('ID', [
        ('ID', 'INTEGER', True), ('ID_PRCHKGERAL', 'INTEGER', False), ('ID_GELANSAI', 'INTEGER', False),
        ('ID_GELANPAC', 'INTEGER', False), ('ID_GEDISPHOR', 'INTEGER', False), ('QTDE_DOSE', 'NUMERIC(18,3)', False),
        ('ID_TBUNICON', 'VARCHAR(7)', False),
    ]),
}

# nenhuma carregável: cada uma tem pai obrigatório (NOT NULL no destino) que o mapa não carrega (pedido 10)
CARREGADAS = ()
BLOQUEADAS = {"GELANPEDENTREGA": ("GELANPED",), "GERASVALBAL": ("GELANBAL",), "GEANTIMI": ("GECADANTIMI",)}
COLUNAS = {t: cols for t, (_, cols) in FORMAS.items()}


def _ddl():
    saida = []
    for t, (chave, cols) in FORMAS.items():
        defs = ["%s %s%s" % (c, tp, " NOT NULL" if nn else "") for c, tp, nn in cols]
        if chave:
            defs.append("PRIMARY KEY (%s)" % chave)
        saida.append("CREATE TABLE %s (%s);" % (t, ", ".join(defs)))
    return "\n".join(saida) + "\n"


DDL = _ddl()
# pais de fora da fatia dados como já carregados: só pai que o mapa de fato carrega (o teste cruza com as
# declarações). Sem tabela carregável, nenhum.
PAIS_EXTERNOS = {}


def _falso(tipo, i):
    """Valor falso pela forma da coluna (tabelas só com a forma)."""
    if tipo.startswith(("SMALLINT", "INTEGER", "BIGINT")):
        return i
    if tipo.startswith(("VARCHAR", "CHAR")):
        n = int(tipo.split("(")[1].rstrip(")"))
        return "S" if n == 1 else (str(i) + " exemplo")[:n]
    if tipo.startswith("NUMERIC"):
        return decimal.Decimal("1.5")
    if tipo == "DATE":
        return datetime.date(2025, 1, i)
    if tipo == "TIMESTAMP":
        return datetime.datetime(2025, 1, i, 8, 30)
    return ("texto exemplo " + str(i)).encode("cp1252")


def _ins(ins, tab, **v):
    ins(tab, [v.get(c) for c, _, _ in COLUNAS[tab]])


def linhas(r, ins):
    for tab, cols in COLUNAS.items():
        if tab not in CARREGADAS and tab not in BLOQUEADAS:
            for i in (1, 2):
                ins(tab, [_falso(tp, i) for _, tp, _ in cols])
    D = decimal.Decimal
    # entregas: (2, 1899-12-30) data sentinela em coluna obrigatória (NULL: 1048); (3, ...) quantidade zero (CHECK:
    # 4025); (9, ...) item do pedido inexistente (NULL em NOT NULL: 1048). A sequência conta por item na ordem da chave
    for ped, dt, q in [(1, datetime.date(2025, 1, 10), D("10")), (1, datetime.date(2025, 2, 10), D("5.5")),
                       (2, datetime.date(2025, 1, 15), D("100.125")), (2, datetime.date(1899, 12, 30), D("3")),
                       (3, datetime.date(2025, 3, 1), D("0")), (9, datetime.date(2025, 3, 1), D("1"))]:
        _ins(ins, "GELANPEDENTREGA", ID_GELANPED=ped, DATA=dt, QUANTIDADE=q)
    # lotes contados: 4 sem quantidade (1048); 5 quantidade negativa (4025); 6 lote achado na contagem, sem cadastro
    # (texto só apara as pontas); 7 lote inexistente e sem lote informado (pai_inexistente + CHECK 4025); 8 repete o
    # lote 10 no item 1 (chave única: 1062); 9 item do inventário inexistente (pai_inexistente + 1048)
    for i, bal, q, lote, dt, txt in [
            (1, 1, D("10.5"), 10, datetime.date(2027, 1, 31), "L-EX-01"),
            (2, 1, D("3"), 11, datetime.date(2027, 6, 30), "L-EX-02"),
            (3, 1, D("0"), 12, None, None), (4, 2, None, 10, None, None), (5, 2, D("-1"), 11, None, None),
            (6, 2, D("2"), None, datetime.date(2027, 2, 28), "  LOTE  NOVO "), (7, 2, D("2"), 99, None, None),
            (8, 1, D("4"), 10, None, None), (9, 7, D("1"), 10, None, None)]:
        _ins(ins, "GERASVALBAL", ID=i, ID_GELANBAL=bal, QTDE=q, ID_GEVALMEM=lote, DATA=dt, LOTE=txt,
             ID_GERASVALFINAL=i)
    # liberações de antimicrobiano: 3 aponta a 5 (vem depois: fase 2); 4 com dias zero (CHECK 4025); 6 com ficha
    # inexistente (1048); 7 com vigência invertida (4025); 8 com dose extra fora do domínio (fica FALSE, padrão);
    # 9 aponta a 4, recusada (gravada, pai_pendente na fase 2); 10 com usuário inexistente (1048). Decisão presumida
    # em todas (valor_presumido por linha); 5 interrompida no 2º dia (DATA_INT: pedido 11)
    ini = datetime.datetime(2025, 3, 1, 8, 0)
    for i, ficha, dias, ant, fim_d, extra, usu in [
            (1, 1, 7, None, 7, "N", "ana"), (2, 1, 3, 1, 3, "S", "bia"), (3, 2, 5, 5, 5, "N", "ana"),
            (4, 2, 0, None, 1, "N", "ana"), (5, 2, 10, None, 10, "N", "bia"), (6, 9, 5, None, 5, "N", "ana"),
            (7, 1, 5, None, -1, "N", "ana"), (8, 2, 2, None, 2, "X", "bia"), (9, 1, 4, 4, 4, "N", "ana"),
            (10, 1, 4, None, 4, "N", "ze")]:
        _ins(ins, "GEANTIMI", ID_GEANTIMI=i, ID_GECADANTIMI=ficha, TIPO="T", REG=1000 + i, ITEM=100 + i % 2,
             DATA=ini.date(), DIAS=dias, QTDE_TOMADA=D("1"), QTDE_TOTAL=D(dias * 2), USUARIO=usu,
             ID_TBUNICON="MG" if i % 2 else "ML", ID_GEANTIMI_ORIGEM_TRAT=ant, DATA_VIGENCIA_INICIAL=ini,
             DATA_VIGENCIA_FINAL=ini + datetime.timedelta(days=fim_d), QUANTIDADE_DOSE=D("500.25"),
             DOSE_EXTRA=extra, ID_PRFREQUENCIA=1 + i % 2, DIA_INICIO=1, ID_RICADPAC=None,
             DATA_INT=ini + datetime.timedelta(days=2) if i == 5 else None, USU_INT="bia" if i == 5 else None)
    return {}  # nada carregável hoje (BLOQUEADAS)
