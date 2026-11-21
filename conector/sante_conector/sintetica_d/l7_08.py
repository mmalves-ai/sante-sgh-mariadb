"""Fatia L7-08 (SADT e suprimentos, módulo SUP): tabelas da origem com a forma do dicionário e dados 100% falsos.

Rodada 3 de cobertura: 22 tabelas declaradas, GEPARAM e GEQTDELOTEVALLOTEDOCSAIDA descartadas e GEANTIMI bloqueada
pelo modelo (a ficha do produto exige o item prescrito, que a origem não tem: pedido 6 em saida/L7-08.json). GELANPED,
GELANPEDENTREGA e GERASVALBAL carregam aqui; na carga real dependem de GECADPED e GELANBAL (L7-07).
As declaradas trazem as anomalias que a carga trata: pai inexistente (NULL ou recusa 1048), pai pendente, CHECK do
destino (4025), chave única (1062), data sentinela, S/N fora do domínio, presumido (valor_presumido), vigência sem
fonte, complemento por UPDATE, referência encadeada à origem, chave alternativa composta (movimento e requisição ligados
ao documento de saída por ANO, MES, DOC), destino secundário do pai (lote da devolução), cabeçalho agrupado (requisição
por documento, setor funcional por local de consumo), código no destino (tipo de movimento nativo de migração, setor da
entrega) e colunas concorrentes (momento e centro de custo com segunda fonte). Os pais de outras fatias que as
encadeadas LEEM na origem (ORIGEM_PAIS) entram na imagem só com as colunas usadas e são PAIS_EXTERNOS (já carregados;
o MAPA_TESTE tira as declarações deles do plano, como no L6-13). TBCENCUS tem ID diferente de COD.
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
    'GELANPED': ('ID', [
        ('ID', 'INTEGER', True), ('OQUE', 'VARCHAR(1)', True), ('ANO', 'SMALLINT', True), ('DOC', 'INTEGER', True),
        ('SEQ', 'INTEGER', True), ('ITEM', 'INTEGER', True), ('FORN', 'INTEGER', True), ('QTDE', 'NUMERIC(18,3)', False),
        ('VLR_UNI', 'NUMERIC(18,4)', False), ('VLR_TOT', 'NUMERIC(18,2)', False), ('MARCA', 'VARCHAR(27)', False),
        ('TIPO', 'VARCHAR(1)', True), ('PER_IPI', 'NUMERIC(9,2)', False), ('VLR_IPI', 'NUMERIC(18,2)', False),
        ('PER_DES', 'NUMERIC(9,2)', False), ('VLR_DES', 'NUMERIC(18,2)', False), ('CONDI', 'SMALLINT', False),
        ('CONDICAO', 'VARCHAR(30)', False), ('COMPRADA', 'NUMERIC(18,3)', False), ('VENCEDOR', 'VARCHAR(1)', False),
        ('OBS', 'VARCHAR(304)', False), ('QTDE1', 'NUMERIC(18,3)', False), ('QTDE2', 'NUMERIC(18,3)', False),
        ('QTDE3', 'NUMERIC(18,3)', False), ('REG_MS', 'VARCHAR(20)', False), ('APRES', 'VARCHAR(25)', False),
        ('ENTREGA', 'DATE', False), ('QTDE_ARM', 'NUMERIC(18,3)', False), ('VLR_ARM', 'NUMERIC(18,2)', False),
        ('FATOR', 'NUMERIC(18,3)', False), ('VLR_MAX_SUG', 'DOUBLE PRECISION', True), ('DATA1', 'DATE', False),
        ('DATA2', 'DATE', False), ('DATA3', 'DATE', False), ('ID_GECADPED', 'INTEGER', True),
        ('ITEM_AUTORIZADO_ORCAMENTO', 'CHAR(1)', False),
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

# declaradas (carga dirigida pelo mapa); GEANTIMI fica fora do plano (bloqueada pelo modelo)
CARREGADAS = ("GELANPED", "GELANPEDENTREGA", "GERASVALBAL", "GEUSERS_TBCENCUS", "PRPARINTEGEST", "GECADDEV",
              "GECADDISPENSACAO", "GECADSAI", "GECTRLENTREGADOCSAIDA", "GEINFVENEXT", "GELANDISPENSACAO", "GELANSAI",
              "GEITEMKITRAS_GELANSAI", "GELANDEV", "GEITEMKITRAS_GELANDEV", "GELANSAIREQ", "GERASVALSAIDLOTE",
              "GERASVALDEVLOTE", "GEDISPHOR", "PREXTRATOITEM_SUBST", "PREXTRATOITEM_TBSITFARM", "PRINTEGRACAOESTOQUE")
BLOQUEADAS = ("GEANTIMI",)
DESCARTADAS = ("GEPARAM", "GEQTDELOTEVALLOTEDOCSAIDA")
COLUNAS = {t: cols for t, (_, cols) in FORMAS.items()}


# pais de outras fatias lidos na ORIGEM pelas referências encadeadas: só as colunas usadas (nomes e tipos do dicionário)
ORIGEM_PAIS = {
    'GEITENS': ('COD', [('COD', 'INTEGER', True), ('UNI_ARM', 'VARCHAR(7)', False)]),
    'GEITEMKITRAS': ('ID', [('ID', 'INTEGER', True), ('ID_GEKITRAS', 'INTEGER', False)]),
    'PRCHKGERAL': ('ID', [('ID', 'INTEGER', True), ('ID_PRLANGERAL', 'INTEGER', False),
                          ('ID_PRPRESCMED', 'INTEGER', False)]),
    'TBCENCUS': ('COD', [('COD', 'INTEGER', True), ('ID', 'INTEGER', True), ('LOCARM', 'SMALLINT', False)]),
    'TBLOCCON': ('COD', [('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(50)', False), ('CDC', 'INTEGER', False)]),
    'TBCBOPRO': ('ID', [('ID', 'INTEGER', True), ('ID_TBPROFIS', 'INTEGER', False)]),
    'PRPRESCMED': ('ID', [('ID', 'INTEGER', True), ('ID_GEITENS', 'INTEGER', False)]),
    'GELANPAC': ('ID', [('ID', 'INTEGER', True), ('LOCAL', 'SMALLINT', False)]),
    'RICADINT': ('REG', [('REG', 'INTEGER', True), ('ID_ATCABECATEND', 'INTEGER', False)]),
}


def _ddl():
    saida = []
    for t, (chave, cols) in list(FORMAS.items()) + list(ORIGEM_PAIS.items()):
        defs = ["%s %s%s" % (c, tp, " NOT NULL" if nn else "") for c, tp, nn in cols]
        if chave:
            defs.append("PRIMARY KEY (%s)" % chave)
        saida.append("CREATE TABLE %s (%s);" % (t, ", ".join(defs)))
    return "\n".join(saida) + "\n"


DDL = _ddl()
# pais de fora da fatia dados como já carregados (só pela chave: conector_origem)
PAIS_EXTERNOS = {"GECADPED": [1, 2], "GELANBAL": [1, 2], "GEVALMEM": [10, 11, 12], "TBUSERS": ["ana", "bia"],
                 "TBCENCUS": [10, 20, 30], "TBTP_ENV_LISTA_AVAL_FARM": [1], "GELOCARM": [1, 2], "RICADPAC": [500],
                 "GEITENS": [100, 101], "TBSITUACAOFARMACIA": [1], "PRCHKGERAL": [700, 701], "GEITEMKITRAS": [50, 51],
                 "GEKITRAS": [5], "TBUNICON": ["UN", "MG"], "PRLANGERAL": [1],
                 "RECADATE": [1001, 1002], "PRPRESC": [300], "TBPROFIS": [60], "GETABVIA": ["VO"], "TBLOCCON": [5],
                 "TBCBOPRO": [70], "PRPRESCMED": [800], "GELANPAC": [40], "RICADINT": [2001],
                 "ATCABECATEND": [900]}
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');"
                   # tipos NATIVOS de migração do produto (semente de db/migracoes/11_SUP/07_chaves.sql), achados por cod:
                   " CREATE TABLE IF NOT EXISTS tipo_movimento_estoque (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(30) NOT NULL UNIQUE);"
                   " INSERT INTO tipo_movimento_estoque (codigo) VALUES ('migracao_entrada'), ('migracao_saida')")


def __getattr__(nome):
    """`MAPA_TESTE`: o mapa REAL sem as declarações dos pais de ORIGEM_PAIS. Na carga real esses pais vêm antes, em
    outras fatias; aqui eles estão na imagem só para as encadeadas lerem a origem, e o pai externo (PAIS_EXTERNOS) já
    conta como carregado: planejá-lo de novo daria conciliação falsa (mesmo arranjo do L6-13)."""
    if nome != "MAPA_TESTE":
        raise AttributeError(nome)
    from .. import mapa
    m = mapa.carregar_execucao()
    return dict(m, colunas_decl=[c for c in m["colunas_decl"] if c["tabela"] not in ORIGEM_PAIS])


def _falso(tipo, i):
    """Valor falso pela forma da coluna."""
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


def _ins(ins, tab, i=1, **v):
    """Linha com os valores dados; coluna NOT NULL da origem não dada recebe um valor falso pela forma."""
    cols = COLUNAS[tab] if tab in COLUNAS else ORIGEM_PAIS[tab][1]
    ins(tab, [v[c] if c in v else (_falso(tp, i) if nn else None) for c, tp, nn in cols])


def linhas(r, ins):
    D, dt, ts = decimal.Decimal, datetime.date, datetime.datetime
    for tab, cols in COLUNAS.items():
        if tab not in CARREGADAS and tab != "GEANTIMI":
            for i in (1, 2):
                ins(tab, [_falso(tp, i) for _, tp, _ in cols])
    # entregas: (2, 1899-12-30) data sentinela em coluna obrigatória (1048); (3) quantidade zero (CHECK 4025); (9)
    # item do pedido inexistente (pai_inexistente + 1048). A sequência conta por item na ordem da chave
    for ped, d, q in [(1, dt(2025, 1, 10), D("10")), (1, dt(2025, 2, 10), D("5.5")), (2, dt(2025, 1, 15), D("100.125")),
                      (2, dt(1899, 12, 30), D("3")), (3, dt(2025, 3, 1), D("0")), (9, dt(2025, 3, 1), D("1"))]:
        _ins(ins, "GELANPEDENTREGA", ID_GELANPED=ped, DATA=d, QUANTIDADE=q)
    # lotes contados: 3 quantidade zero (aceita); 4 sem quantidade (1048); 5 negativa (4025); 6 lote achado sem
    # cadastro (texto só apara as pontas); 7 lote inexistente sem lote informado (pai_inexistente + CHECK 4025); 8 repete
    # o lote 10 no item 1 (1062); 9 item do inventário inexistente (pai_inexistente + 1048); 1 com saldo do sistema
    # lido na origem de GERASVALFINAL (outra fatia: pai_inexistente, saldo NULL)
    for i, bal, q, lote, d, txt in [
            (1, 1, D("10.5"), 10, dt(2027, 1, 31), "L-EX-01"), (2, 1, D("3"), 11, dt(2027, 6, 30), "L-EX-02"),
            (3, 1, D("0"), 12, None, None), (4, 2, None, 10, None, None), (5, 2, D("-1"), 11, None, None),
            (6, 2, D("2"), None, dt(2027, 2, 28), "  LOTE  NOVO "), (7, 2, D("2"), 99, None, None),
            (8, 1, D("4"), 10, None, None), (9, 7, D("1"), 10, None, None)]:
        _ins(ins, "GERASVALBAL", ID=i, ID_GELANBAL=bal, QTDE=q, ID_GEVALMEM=lote, DATA=d, LOTE=txt,
             ID_GERASVALFINAL=1 if i == 1 else None)
    # pais de outras fatias lidos na origem: insumo 101 sem unidade; item de kit 51 sem kit; horário 701 sem item
    # prescrito; centro de custo com ID diferente de COD, e o COD 30 tem ID 10 (= COD de outro centro) e não tem armazém
    for cod, uni in [(100, "UN"), (101, None)]:
        _ins(ins, "GEITENS", COD=cod, UNI_ARM=uni)
    for it, kit in [(50, 5), (51, None)]:
        _ins(ins, "GEITEMKITRAS", ID=it, ID_GEKITRAS=kit)
    for h, item, med in [(700, 1, 800), (701, None, None)]:
        _ins(ins, "PRCHKGERAL", ID=h, ID_PRLANGERAL=item, ID_PRPRESCMED=med)
    _ins(ins, "PRPRESCMED", ID=800, ID_GEITENS=101)
    _ins(ins, "TBLOCCON", COD=5, NOME="Posto  exemplo", CDC=20)
    _ins(ins, "TBCBOPRO", ID=70, ID_TBPROFIS=60)
    _ins(ins, "GELANPAC", ID=40, LOCAL=2)
    _ins(ins, "RICADINT", REG=2001, ID_ATCABECATEND=900)
    for cod, ident, arm in [(10, 110, 1), (20, 120, 2), (30, 10, None)]:
        _ins(ins, "TBCENCUS", COD=cod, ID=ident, LOCARM=arm)
    # usuário x centro de custo (pela coluna ID): 10 liga ao centro de COD 30, nunca ao de COD 10; login inexistente
    # e centro inexistente (pai_inexistente + 1048); vigência da carga
    for usu, cc in [("ana", 110), ("bia", 120), ("ze", 110), ("ana", 99), ("bia", 10)]:
        _ins(ins, "GEUSERS_TBCENCUS", USUARIO_GEUSERS=usu, ID_TBCENCUS=cc)
    # regra de integração (inativa): armazém do centro de custo lido na origem de TBCENCUS pela coluna ID; o centro
    # de ID 10 (COD 30) não tem armazém: NULL e 1048. Tipo e momento pelo de-para do código; 120 com tipo fora do
    # de-para (3): reserva presumida (valor_fora_do_dominio + valor_presumido)
    for cc, tp, ti, mi in [(110, 1, 1, 1), (120, 2, 3, 2), (10, 1, 2, 1)]:
        _ins(ins, "PRPARINTEGEST", ID_TBCENCUS=cc, TP_PRESCRICAO=tp, TP_INTEGRACAO=ti, MOMENTO_INTEGRACAO=mi,
             GERAR_DADOS_AUTORIZ_MANIPUL=tp % 2, ID_TBTP_ENV_LISTA_AVAL_FARM=1)
    # saídas, tipo pelo destino (DEST): 1 paciente em atendimento (DEST 3, atendimento pelo registro em CONTA);
    # 2 venda externa (DEST 5, terceiro); 5 setor (DEST 2); 6 paciente internado (DEST 1, atendimento da internação
    # PAC lida na origem de RICADINT), sem data de inclusão (vale a DATA à meia-noite). Anomalias: 3 armazém
    # inexistente (pai_inexistente + 1048); 4 sem data de inclusão nem DATA (1048); 5 consolidado fora do domínio
    # (fica FALSE); 6 usuário inexistente (NULL); 7 destino fora do de-para (valor_fora_do_dominio + 1048); 8 internado
    # sem internação (CHECK da saída a paciente, 4025). O atendimento tem duas fontes concorrentes: a que não casa
    # deixa pai_inexistente (pedido 15)
    for i, arm, cdc, pac, d, cons, usu, ter, dest, reg, inc in [
            (1, 1, 10, 500, dt(2025, 2, 1), "S", "ana", None, 3, 1001, True),
            (2, 2, None, None, dt(2025, 2, 2), "N", "bia", "Terceiro A", 5, None, True),
            (3, 9, 10, None, dt(2025, 2, 3), "S", "ana", None, 2, 0, True),
            (4, 1, 10, None, None, "S", "ana", None, 2, 0, True),
            (5, 1, 20, None, dt(2025, 2, 5), "X", "bia", None, 2, 0, True),
            (6, 2, 20, None, dt(2025, 2, 6), "N", "ze", None, 1, 2001, False),
            (7, 1, 20, None, dt(2025, 2, 7), "N", "ana", None, 9, 0, True),
            (8, 1, 20, None, dt(2025, 2, 8), "N", "ana", None, 1, 2999, True)]:
        _ins(ins, "GECADSAI", i, ID=i, ANO=2025, MES=2, DOC=i, ARM=arm, CDC=cdc, ID_RICADPAC=pac, CONS={1: 5, 2: 7}.get(i), DATA=d, CONSOL=cons,
             DATA_HORA_INCLUSAO=d and inc and ts(d.year, d.month, d.day, 10, i) or None, DEST=dest, PAC=reg,
             CONTA={1: 1001, 6: 1, 8: 1}.get(i, 0),
             OBS="obs saida %d" % i, USUARIO=usu, USU_CONS=usu if cons == "S" else None, TERCEIRO=ter)
    # complemento da saída: 1 grava a folha de gasto; 3 aponta saída recusada (pai_pendente); 99 sem saída
    for sai, folha in [(1, 7001), (3, 7003), (99, 7099)]:
        _ins(ins, "GEINFVENEXT", ID_GECADSAI=sai, NUMERO_FOLHA_GASTO=folha, NUMERO_CHAMADA=1, NUMERO_BO=2)
    # devoluções: 3 com centro de custo inexistente (NULL, pai_inexistente) e sem data de inclusão (vale a DATA)
    for i, arm, cdc in [(1, 1, 10), (2, 2, 20), (3, 1, 99)]:
        _ins(ins, "GECADDEV", i, ID=i, ANO=2025, MES=3, DOC=i, ARM=arm, CDC=cdc, DATA=dt(2025, 3, i), CONSOL="S",
             DATA_HORA_INCLUSAO=ts(2025, 3, i, 11, 0) if i < 3 else None,
             USUARIO="ana")
    # itens da devolução: unidade lida na origem de GEITENS (101 sem unidade: 1048); 3 sem documento (pai_inexistente
    # + 1048)
    # o movimento de entrada (secundário) segue o item: 1 grava os dois
    for i, dev, item in [(1, 1, 100), (2, 1, 101), (3, 9, 100)]:
        _ins(ins, "GELANDEV", i, ID_GELANDEV=i, ID_GECADDEV=dev, ITEM=item, DATA=dt(2025, 3, i), LOCAL=1,
             QTDE=D("2"), VALIDADE=dt(2027, 1, 1), VLRMED=D("12.34"), SEQ=i,
             DATA_HORA_INCLUSAO=ts(2025, 3, i, 12, 0))
    # itens de saída (movimento + item do documento, ligados ao documento por ANO, MES, DOC): 1, 2 e 5 gravam (5 sem
    # momento próprio: o do documento); 3 insumo sem unidade (1048 no movimento); 4 documento inexistente (pai_inexistente
    # nas cadeias, 1048); 6 quantidade zero (CHECK 4025). 1 com prescritor de controlado (TBCBOPRO 70 > TBPROFIS 60)
    for i, doc, seq, item, q, dhi in [(1, 1, 1, 100, D("3"), True), (2, 1, 2, 100, D("1"), True),
                                      (3, 2, 1, 101, D("2"), True), (4, 77, 1, 100, D("1"), True),
                                      (5, 5, 1, 100, D("4"), False), (6, 5, 2, 100, D("0"), True)]:
        _ins(ins, "GELANSAI", i, ID_GELANSAI=i, ANO=2025, MES=2, DOC=doc, SEQ=seq, ITEM=item, QTDE=q,
             VLR_UNI=D("2.5"), VLRMED=D("7.50"), ID_TBCBOPRO_MAT_MED_CONTROLADO=70 if i == 1 else 0,
             DATA_HORA_INCLUSAO=ts(2025, 2, 1, 9, i) if dhi else None)
    # requisição por documento (cabeçalho agrupado): doc 1 com dois itens (2: pedida 0, vale a atendida); doc 2 sem
    # centro de custo (CHECK do tipo setor no cabeçalho: 4025); doc 77 sem documento (número nulo: 1048 no cabeçalho)
    for doc, seq, item, q, qr in [(1, 1, 100, D("2"), D("3")), (1, 2, 100, D("1"), D("0")), (2, 1, 101, D("1"), D("1")),
                                  (77, 1, 100, D("1"), D("1"))]:
        _ins(ins, "GELANSAIREQ", seq, ANO=2025, MES=2, DOC=doc, SEQ=seq, ITEM=item, QTDE=q, QTDE_REQ=qr,
             OBS="req %d" % doc)
    # kit lido na origem de GEITEMKITRAS: 50 grava; 51 sem kit (1048). O movimento da saída fica NULL (pai_inexistente)
    for sai in (1, 2):
        _ins(ins, "GEITEMKITRAS_GELANSAI", ID_GELANSAI=sai, ID_GEITEMKITRAS=49 + sai)
    for dev in (1, 2):
        _ins(ins, "GEITEMKITRAS_GELANDEV", ID_GELANDEV=dev, ID_GEITEMKITRAS=49 + dev)
    # situação farmacêutica: item prescrito lido na origem de PRCHKGERAL; 701 sem item (1048)
    for i in (1, 2):
        _ins(ins, "PREXTRATOITEM_TBSITFARM", i, ID=i, ID_PRCHKGERAL=699 + i, ID_TBSITUACAOFARMACIA=1, ID_TBUSERS="ana",
             DATA_HORA_HISTORICO=ts(2025, 4, 1, 10, i), JUSTIFICATIVA_APROVACAO_MEDICA="aprovado %d" % i)
    # lotes da saída: GELANSAI ainda não carrega (pai_inexistente + 1048); GEQTDELOTEVALLOTEDOCSAIDA (descartada) só
    # com a forma
    for i in (1, 2, 3):
        _ins(ins, "GERASVALSAIDLOTE", i, ID=i, ID_GELANSAI=i, QTDE=D("1"), ID_GEVALMEM=10)
    # lotes da devolução pelo movimento secundário de GELANDEV: 1 grava; 2 devolução recusada inteira (o movimento
    # secundário nunca foi gravado: pai_inexistente + 1048); 3 sem devolução (1048)
    for i, dev in [(1, 1), (2, 2), (3, None)]:
        _ins(ins, "GERASVALDEVLOTE", i, ID=i, ID_GELANDEV=dev, ID_GEVALMEM=10, QTDE=D("1"))
    # dispensações: 1 e 2 no local de consumo 5 (um setor só, agrupado; 2 sem centro de custo: o do local); 3 local 6
    # sem cadastro (nome derivado); 4 prescrição inexistente (CHECK 4025); 5 atendimento inexistente (1048)
    for i, loc, cdc, reg, presc, usu in [(1, 5, 10, 1001, 300, "ana"), (2, 5, None, 1001, 300, "bia"),
                                         (3, 6, 20, 1002, 300, "ana"), (4, 5, 10, 1001, 999, "ana"),
                                         (5, 5, 10, 9999, 300, "ana")]:
        _ins(ins, "GECADDISPENSACAO", i, ID=i, LOC_CONS=loc, CDC=cdc, REG=reg, COD_PRESCRI=presc, LOC_ARM=1,
             USUARIO=usu, ID_RICADPAC=500, DATA=ts(2025, 4, 1, 7, i), ID_TBCBOPRO=70 if i == 1 else None)
    # itens dispensados: 1 sem justificativa (registra a falta de vínculo); 2 com justificativa; 3 sem dispensação
    # (1048); 4 dispensação recusada (pai_pendente)
    for i, disp, via, just in [(1, 1, "VO", None), (2, 1, None, "item extra exemplo"), (3, 9, None, None),
                               (4, 4, None, None)]:
        _ins(ins, "GELANDISPENSACAO", i, ID=i, ID_GECADDISPENSACAO=disp, ITEM=100, VIA=via, QTDE=D("2"),
             PRIMEIRA_DOSE_REF="S", JUSTIFICA_ITEM_NAO_PRESC=just)
    # entregas ao setor: 1 documento do local 5 (setor achado pelo código); 2 lançamento ao paciente sem setor (1048);
    # 3 documento do local 7 sem setor (codigo_inexistente_destino + 1048)
    for i, sai, pac in [(1, 1, None), (2, None, 40), (3, 2, None)]:
        _ins(ins, "GECTRLENTREGADOCSAIDA", i, ID=i, ID_GECADSAI=sai, ID_GELANPAC=pac, ID_TBSITUACAOFARMACIA=1,
             DATA_HORA=ts(2025, 4, 3, 9, i), ID_TBUSERS="ana", MOTIVO_ESTORNO=b"estorno exemplo" if i == 3 else None)
    # trocas no horário: 1 grava (item dispensado pela dose do horário 700, prescrito 101 -> 100); 2 horário sem
    # medicamento prescrito (1048); 3 troca pelo mesmo insumo (CHECK 4025)
    for i, h, novo in [(1, 700, 100), (2, 701, 100), (3, 700, 101)]:
        _ins(ins, "PREXTRATOITEM_SUBST", i, ID=i, ID_PRCHKGERAL=h, ID_GEITENS=novo, QTDE_DOSE=D("1"),
             ID_TBUNICON_UNI_PRESC="MG", ID_TBUSERS="bia", DATA_HORA_HISTORICO=ts(2025, 4, 4, 10, i))
    # itens do pedido de compra: 1-3 gravam (as entregas de GELANPEDENTREGA ligam a eles); 4 insumo sem unidade (CHECK
    # 4025); 5 pedido inexistente (pai_inexistente + 1048)
    for i, ped, item, q in [(1, 1, 100, D("10")), (2, 1, 100, D("5")), (3, 2, 100, D("1")), (4, 2, 101, D("1")),
                            (5, 99, 100, D("1"))]:
        _ins(ins, "GELANPED", i, ID=i, ID_GECADPED=ped, ITEM=item, QTDE=q, VLR_UNI=D("2.5"), VLR_TOT=q * D("2.5"),
             VLR_MAX_SUG=0.0, VENCEDOR="S", ENTREGA=dt(2025, 5, i), MARCA="marca exemplo", FATOR=D("1"))
    # doses por horário: uma por horário (a troca acha o item dispensado pela dose do horário)
    for i in (1, 2):
        _ins(ins, "GEDISPHOR", i, ID=i, ID_GELANDISPENSACAO=i, DATA_DISPENSA=ts(2025, 4, 2, 8, 0), QUANTIDADE=D("1"),
             EMITIDO="S", USUARIO_EMISSAO="bia", ID_PRCHKGERAL=699 + i)
    # integração horário x estoque: horário fora da carga (pai_inexistente: recusa do complemento)
    for i in (1, 2):
        _ins(ins, "PRINTEGRACAOESTOQUE", ID=i, ID_PRCHKGERAL=900 + i, ID_GEDISPHOR=i, QTDE_DOSE=D("1"))
    # liberações de antimicrobiano (bloqueada: a ficha do produto exige o item prescrito e dados clínicos que a origem
    # não tem, pedido 6); anomalias
    # mantidas para a reativação: 4 dias zero, 6 ficha inexistente, 7 vigência invertida, 8 S/N fora do domínio,
    # 3 e 9 autorreferência (duas fases), 10 usuário inexistente, 5 interrompida (DATA_INT)
    ini = ts(2025, 3, 1, 8, 0)
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
    pi, r48, r25, r62 = "pai_inexistente", "restricao_destino_1048", "restricao_destino_4025", "restricao_destino_1062"
    return {
        "GELANPEDENTREGA": {"gravados": 3, "pendencias": {"data_sentinela": 1, r48: 2, r25: 1, pi: 1}},
        "GERASVALBAL": {"gravados": 4, "pendencias": {pi: 2, r48: 2, r25: 2, r62: 1}},
        "GEUSERS_TBCENCUS": {"gravados": 3, "pendencias": {"vigencia_sem_fonte": 5, pi: 2, r48: 2}},
        "PRPARINTEGEST": {"gravados": 2, "pendencias": {"valor_presumido": 9, r48: 1, "valor_fora_do_dominio": 1}},
        "GECADSAI": {"gravados": 4, "pendencias": {pi: 6, r48: 3, r25: 1, "valor_fora_do_dominio": 3}},
        "GEINFVENEXT": {"gravados": 1, "pendencias": {"pai_pendente": 1, pi: 1}},
        "GECADDEV": {"gravados": 3, "pendencias": {pi: 1}},
        "GELANDEV": {"gravados": 1, "pendencias": {pi: 6, r48: 2}},
        "GEITEMKITRAS_GELANSAI": {"gravados": 1, "pendencias": {r48: 1}},
        "GEITEMKITRAS_GELANDEV": {"gravados": 1, "pendencias": {r48: 1}},
        "PREXTRATOITEM_TBSITFARM": {"gravados": 1, "pendencias": {r48: 1}},
        "GERASVALSAIDLOTE": {"gravados": 2, "pendencias": {"pai_pendente": 1}},
        "GEDISPHOR": {"gravados": 2, "pendencias": {}},
        "PRINTEGRACAOESTOQUE": {"gravados": 0, "pendencias": {pi: 2}},
        "GELANPED": {"gravados": 3, "pendencias": {pi: 1, r48: 1, r25: 1}},
        "GECADDISPENSACAO": {"gravados": 3, "pendencias": {pi: 5, r48: 1, r25: 1}},
        "GECTRLENTREGADOCSAIDA": {"gravados": 1, "pendencias": {"codigo_inexistente_destino": 1, r48: 2}},
        "GELANDISPENSACAO": {"gravados": 2, "pendencias": {pi: 1, "pai_pendente": 1, r48: 1}},
        "GELANSAI": {"gravados": 3, "pendencias": {pi: 8, r48: 2, r25: 1}},
        "GELANSAIREQ": {"gravados": 2, "pendencias": {pi: 6, r48: 1, r25: 1}},
        "GERASVALDEVLOTE": {"gravados": 1, "pendencias": {pi: 1, r48: 2}},
        "PREXTRATOITEM_SUBST": {"gravados": 1, "pendencias": {r48: 1, r25: 1}},
    }
