"""Fatia L8-05 (faturamento e restantes, módulo FAT): tabelas da origem com a forma do dicionário e dados 100% falsos.

Rodada 3 (correção). CARREGADAS (14): TBTIPPLANO, TBTABDTH, TBTPPROFPROC, TBCODATI, TBCODATI_TBUSERS,
TBCONVEN_TBTISSPARDEF, TBEMIREF, TBENTCON, TBVLRTHM e, novas na rodada 3, TBTIPPLCONV (diária por plano da fonte, modelo
12_FAT/11), TBTISS (parâmetros TISS, versão pelo cadastro de versões da origem e de-para oficial versao_tiss),
TBVLRDTH (valor da diária pela chave alternativa composta TAB+OPE), FCCTAEXT (conta) e FCDIAEXT (segurado da conta,
carteira lida da conta na origem).
COMENTADAS (declaração pronta, BLOQUEADA com motivo em colunas.d/L8-05.tsv): TBSEGUIA (regra inteiro_mais_um e tipo
'lote'), TBINTCRC (dimensões do de-para no modelo), FCCTAAUD (dependência da conta, total nulo e conclusão condicional),
TBPERMEM e TBEMIREFMATMED (pai TBMATMED, L8-03) e RPLANRPA (linhas da L8-02). As três primeiras mantêm as linhas
específicas na imagem; as outras, a forma. RPLANRPA entra na imagem desta fatia e no esperado só quando a L8-02 a
retirar da dela e a declaração daqui for descomentada (sem tabela duplicada na imagem conjunta).
SO_ORIGEM: TBVERSAOTISS (catálogo oficial, só lido pela referência encadeada).
PAIS_EXTERNOS: TBCONVEN (L5-06), TBCTRDTH (L8-03), TBUSERS (L3), TBCLASSI (L8-02), TBTABTHM (L8-04, chave TAB|COD),
RECADATE (L3; o destino `atendimento` com o paciente vem do PREPARO) e
TBLOCCON (L8-03). PREPARO_DESTINO: estabelecimento, semente de tipo_conta e tipo_auditoria (pedida à F2.2), versão
TISS 4.03.00 do carregador oficial e os atendimentos dos pais externos.
TBTISSPARDEF (L8-04) NÃO entra nesta imagem: aqui o campo TISS fica pai_inexistente e a linha é recusada (1048).
As demais (DESCARTE em sem_carga.tsv) entram só com a forma (2 linhas falsas cada).
"""
import datetime
import decimal

FORMAS = {
    'TBTPOBRIGAMAT': ('ID', [
        ('ID', 'SMALLINT', True), ('DESCRICAO', 'VARCHAR(15)', False),
    ]),
    'TBTPPERFILUNIBH': ('ID', [
        ('ID', 'SMALLINT', True), ('NOME', 'VARCHAR(40)', True),
    ]),
    'TBTPPROFPROC': ('ID', [
        ('ID', 'SMALLINT', True), ('NOME', 'VARCHAR(20)', True),
    ]),
    'TBTPTRATUNIBH': ('ID', [
        ('ID', 'SMALLINT', True), ('NOME', 'VARCHAR(40)', True),
    ]),
    'TBTPCLASSIFUNIBH': ('ID', [
        ('ID', 'SMALLINT', True), ('NOME', 'VARCHAR(60)', True), ('CLASSIFICACAO', 'VARCHAR(60)', True),
        ('ID_TBTPTRATUNIBH', 'SMALLINT', True), ('ID_TBTPPERFILUNIBH', 'SMALLINT', True),
        ('ID_TBTPFASEUNIBH', 'SMALLINT', True),
    ]),
    'TBTABDTH': ('ID', [
        ('ID', 'INTEGER', True), ('TAB', 'SMALLINT', True), ('OPE', 'INTEGER', True),
        ('NOME', 'VARCHAR(150)', False), ('COD', 'VARCHAR(10)', False), ('TITULO', 'VARCHAR(1)', False),
        ('TIPO', 'SMALLINT', False), ('SUBTIPO', 'SMALLINT', False), ('FATOR', 'VARCHAR(6)', False),
        ('CH', 'DOUBLE', False), ('COBTX', 'VARCHAR(1)', False), ('TIPO_ACO', 'VARCHAR(1)', False),
        ('PACOTE', 'VARCHAR(1)', False), ('LAN_CRM', 'VARCHAR(1)', False), ('SITUACAO', 'VARCHAR(1)', False),
        ('PERIODO_I', 'SMALLINT', False), ('PERIODO_F', 'SMALLINT', False), ('MAT_INSUMO', 'VARCHAR(1)', False),
        ('UNIDADE', 'SMALLINT', False), ('MED_INSUMO', 'VARCHAR(1)', False),
        ('OLD_TIPO_ACO_TISS', 'SMALLINT', False), ('EQUIV_TISS', 'SMALLINT', False),
        ('PERMANENCIA', 'SMALLINT', False), ('LAN_HORA_FINAL', 'VARCHAR(1)', False),
        ('DATA_HORA_INCLUSAO', 'TIMESTAMP', False), ('DATA_HORA_ULTIMA_ATUALIZACAO', 'TIMESTAMP', False),
        ('ID_TBTPACOMTISS', 'SMALLINT', False), ('ID_TBTABDTH_COD_TUSS', 'INTEGER', False),
        ('ID_TBTPCLASSIFUNIBH', 'SMALLINT', False), ('NUMERO_MESES', 'SMALLINT', False),
        ('PORTE', 'VARCHAR(2)', False),
    ]),
    'TBVERSAOBRASIN': ('ID', [
        ('ID', 'SMALLINT', True), ('VERSAO', 'INTEGER', True),
    ]),
    'TBCODATI': ('ID', [
        ('ID', 'SMALLINT', True), ('CONV', 'SMALLINT', True), ('ATIVIDADE', 'SMALLINT', True),
        ('COD_CONV', 'VARCHAR(14)', False), ('NOME', 'VARCHAR(20)', False), ('COD_HOSPITAL', 'SMALLINT', False),
        ('LOGIN_PRESTADOR', 'VARCHAR(30)', False), ('SENHA_PRESTADOR', 'VARCHAR(64)', False),
        ('SENHA_PRESTADOR_PADRAO_HASH_MD5', 'CHAR(1)', False), ('CTR_AUT_TP_BASIC', 'CHAR(1)', False),
    ]),
    'TBCODATI_TBUSERS': ('ID_TBCODATI,USUARIO', [
        ('ID_TBCODATI', 'SMALLINT', True), ('USUARIO', 'VARCHAR(31)', True),
    ]),
    'TBCONVEN_TBTISSPARDEF': ('ID_TBCONVEN,ID_TBTISSPARDEF', [
        ('ID_TBCONVEN', 'SMALLINT', True), ('ID_TBTISSPARDEF', 'SMALLINT', True),
        ('VALOR_DEFAULT', 'CHAR(1)', False),
    ]),
    'TBEMIREF': ('CONV,CLASSIF', [
        ('CONV', 'SMALLINT', True), ('CLASSIF', 'SMALLINT', True), ('COD_DESC', 'VARCHAR(1)', True),
        ('REF_COD', 'VARCHAR(1)', False), ('REF_DESC', 'VARCHAR(1)', False), ('REF_VALOR', 'VARCHAR(1)', False),
        ('REF_VALOR_PFB', 'CHAR(1)', False), ('REF_VALOR_PMC', 'CHAR(1)', False),
    ]),
    'TBEMIREFMATMED': ('ID_TBCONVEN,ID_TBMATMED', [
        ('ID_TBCONVEN', 'SMALLINT', True), ('ID_TBMATMED', 'INTEGER', True), ('REF_VALOR_PMC', 'CHAR(1)', True),
        ('REF_VALOR_PFB', 'CHAR(1)', True),
    ]),
    'TBENTCON': ('CONV,ENTREGA', [
        ('CONV', 'SMALLINT', True), ('ENTREGA', 'DATE', True), ('PAGAMENTO', 'DATE', False),
    ]),
    'TBPERMEM': ('CON,DATA,ID_TBMATMED,TP_CONTA', [
        ('CON', 'SMALLINT', True), ('COD', 'INTEGER', True), ('DATA', 'DATE', True),
        ('PERC', 'NUMERIC(9,4)', False), ('TAB', 'SMALLINT', True), ('VLR_FIXO', 'NUMERIC(18,2)', False),
        ('QTDE_FIXA', 'NUMERIC(18,3)', False), ('ID_TBMATMED', 'INTEGER', True), ('TP_CONTA', 'CHAR(1)', True),
    ]),
    'TBSEGUIA': ('CONV,TIPO_GUIA', [
        ('CONV', 'SMALLINT', True), ('TIPO_GUIA', 'SMALLINT', True), ('NUM_LOTE', 'VARCHAR(12)', False),
        ('SEQ_TRANSACAO', 'VARCHAR(12)', False),
    ]),
    'TBTIPPLANO': ('ID', [
        ('ID', 'INTEGER', True), ('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(60)', False),
        ('PLANO_COOPART', 'VARCHAR(1)', False), ('ID_TBCONVEN', 'SMALLINT', False),
    ]),
    'TBTIPPLCONV': ('CONV,ID_TBTIPPLANO', [
        ('CONV', 'SMALLINT', True), ('ID_TBTIPPLANO', 'SMALLINT', True), ('ID_TBTABDTH', 'INTEGER', False),
        ('ID_TBLOCCON', 'SMALLINT', False),
    ]),
    'TBTISS': ('CONV', [
        ('CONV', 'SMALLINT', True), ('VLR_SP_ZERADO_SPSADT_XML', 'SMALLINT', False),
        ('VLR_SP_ZERADO_RESUMO_XML', 'SMALLINT', False), ('VLR_SP_ZERADO_INDIVIDUAL_XML', 'SMALLINT', False),
        ('VLR_RC_ZERADO_SPSADT_XML', 'SMALLINT', False), ('VLR_RC_ZERADO_RESUMO_XML', 'SMALLINT', False),
        ('DADOS_MED_XML_COOP', 'VARCHAR(1)', False), ('TAG_VIA_TODOS_PROC', 'VARCHAR(1)', False),
        ('IMP_SADT_G_PART', 'VARCHAR(1)', False), ('IMP_SPSADT', 'VARCHAR(1)', False),
        ('IMP_TAG_CNPJ', 'VARCHAR(1)', False), ('COD_CON_TISS', 'VARCHAR(14)', False),
        ('GNGINR', 'SMALLINT', False), ('DESAB_GUIA_REC', 'VARCHAR(1)', False),
        ('GERAR_GUIA_AUT', 'VARCHAR(1)', False), ('SADT_13_14', 'SMALLINT', False),
        ('SADT_30_31', 'SMALLINT', False), ('SADT_24', 'SMALLINT', False), ('SP_40A_41', 'SMALLINT', False),
        ('RC_40A_41', 'SMALLINT', False), ('LANC_RC_40A_41', 'SMALLINT', False), ('GSI_12_13', 'SMALLINT', False),
        ('GSI_20_21', 'SMALLINT', False), ('CON_09_10', 'SMALLINT', False), ('TISS_REC_INT', 'VARCHAR(1)', False),
        ('TISS_REC_INT_OBR', 'VARCHAR(1)', False), ('TISS_REC_INT_XML', 'VARCHAR(1)', False),
        ('TISS_REC_EXT', 'VARCHAR(1)', False), ('TISS_REC_EXT_OBR', 'VARCHAR(1)', False),
        ('TISS_REC_EXT_XML', 'VARCHAR(1)', False), ('TISS_SADT', 'VARCHAR(1)', False),
        ('TISS_SADT_OBR', 'VARCHAR(1)', False), ('TISS_SADT_XML', 'VARCHAR(1)', False),
        ('TISS_SADT_INT', 'VARCHAR(1)', False), ('TISS_SADT_INT_OBR', 'VARCHAR(1)', False),
        ('TISS_SADT_INT_XML', 'VARCHAR(1)', False), ('TISS_FAT_CONV', 'VARCHAR(1)', False),
        ('TISS_FAT_CONV_OBR', 'VARCHAR(1)', False), ('CONSID_MED_PLAN_NC', 'VARCHAR(1)', False),
        ('DIG_TEC_UTIL', 'VARCHAR(1)', False), ('IMP_VERSO_GUIA', 'VARCHAR(1)', False),
        ('IMP_10_11_GUIA_O_DESP', 'VARCHAR(1)', False), ('E_OBS_GUIA_TISS', 'VARCHAR(1)', False),
        ('CONS_EQUIV_TISS_MM', 'VARCHAR(1)', False), ('DESC_EQ_BRAS_TIPO', 'VARCHAR(1)', False),
        ('CHEGTP', 'SMALLINT', False), ('IMAGEM_FIXA', 'VARCHAR(1)', False), ('CONS_MED_COOP', 'SMALLINT', False),
        ('IMP_HORAS_TISS', 'SMALLINT', False), ('ARRED_VLR_UNIT', 'SMALLINT', False),
        ('IMP_SENHA_2_3_GUIA', 'VARCHAR(1)', False), ('IMP_VLR_33_34_35', 'VARCHAR(1)', False),
        ('IMP_DT_88_89_SPSADT', 'VARCHAR(1)', False), ('IMP_VL_71_SPSADT', 'VARCHAR(1)', False),
        ('G_SEQ_EXP_XML', 'VARCHAR(1)', False), ('DESTINO_ARQ_XML', 'VARCHAR(40)', False),
        ('IMP_G_PARTIC', 'VARCHAR(1)', False), ('E_DADOS_GUIA_DESP', 'VARCHAR(1)', False),
        ('TIPO_PERC_XML', 'SMALLINT', False), ('TIPO_PERC_GUIA', 'SMALLINT', False),
        ('IMP_DAD_TERC', 'SMALLINT', False), ('SEP_COD_FILME_RAD', 'SMALLINT', False),
        ('ESTR_XML_SPSADT', 'SMALLINT', False), ('IMP_GUIA_GER_GRUPO', 'VARCHAR(1)', False),
        ('GERAR_SPSADT_NCRE', 'VARCHAR(1)', False), ('MANTER_N_LOTE', 'VARCHAR(1)', False),
        ('VERSAO_TISS', 'SMALLINT', False), ('SADT_52_53', 'VARCHAR(1)', False),
        ('SADT_65A_71', 'VARCHAR(1)', False), ('TAG_VIA_HONO_IND', 'VARCHAR(1)', False),
        ('EXP_LOTE_IGUAL_SEQ', 'VARCHAR(1)', False), ('GRAVAR_REGIONAL_CRM', 'VARCHAR(1)', False),
        ('GHI_10_11_12', 'SMALLINT', False), ('GHI_13_14_15', 'SMALLINT', False),
        ('GERAR_GHI_MED_NAO_CRED', 'VARCHAR(1)', False), ('PERM_ALT_GUIA_REF', 'VARCHAR(1)', False),
        ('CONSID_PAR_XML_GUIA_IMP', 'VARCHAR(1)', False), ('GERAR_GUIA_PS_ATO', 'VARCHAR(1)', False),
        ('GERAR_GUIA_ZERO_ESQUERDA', 'VARCHAR(1)', False), ('UTIL_COD_TISS_EXT_ELETIVA', 'VARCHAR(1)', False),
        ('COD_TISS_EXT_ELETIVA', 'VARCHAR(14)', False), ('CONS_REF_TISS_BRAS_XML', 'VARCHAR(1)', False),
        ('GHI_36', 'SMALLINT', False), ('CONS_TAB_GRAU_ILHEUS_HI', 'VARCHAR(1)', False),
        ('EMITIR_TAG_TIPO_CONSULTA', 'VARCHAR(1)', False), ('EMITIR_TAG_CTA_LANC_PROF', 'VARCHAR(1)', False),
        ('OLD_G_GUIA_SADT_PREST_N_CRED', 'VARCHAR(1)', False), ('GERAR_GUIA_PROFIS_ATO_MEDICO', 'CHAR(1)', False),
        ('UTILIZAR_CTR_GUIA_MANUAL_FAT', 'CHAR(1)', False), ('IMPRIMIR_DTA_ATEND_CAMPO_38_39', 'CHAR(1)', False),
        ('CTR_COBRANCAS_OUT_DESPESAS_SH', 'SMALLINT', False), ('CTR_COBRANCAS_OUT_DESPESAS_MM', 'SMALLINT', False),
        ('EMITIR_VLR_SH_ZERADO_SPSADT', 'SMALLINT', False), ('EMITIR_VLR_SH_ZERADO_RESUMO', 'SMALLINT', False),
        ('EMITIR_VLR_MM_ZERADO_SPSADT', 'SMALLINT', False), ('EMITIR_VLR_MM_ZERADO_RESUMO', 'SMALLINT', False),
        ('LOGOTIPO', 'BLOB', False), ('MODELO_IMPRESSAO_PADRAO_RECEP', 'SMALLINT', False),
        ('MODELO_IMPRESSAO_PADRAO_SADT', 'SMALLINT', False), ('MODELO_IMPRESSAO_PADRAO_FAT', 'SMALLINT', False),
        ('DEFAULT_TECNICA_UTIL', 'SMALLINT', False), ('CONSIDERAR_COD_MM_10_DIG_CTA', 'SMALLINT', False),
        ('GERAR_GUIA_PS_SEQUENCIA', 'CHAR(1)', False), ('NUM_GUIA_OPME_INICIAL', 'VARCHAR(20)', False),
        ('NUM_GUIA_OPME_FINAL', 'VARCHAR(20)', False), ('NUM_GUIA_QUIMIO_INICIAL', 'VARCHAR(20)', False),
        ('NUM_GUIA_QUIMIO_FINAL', 'VARCHAR(20)', False), ('NUM_GUIA_RADIO_INICIAL', 'VARCHAR(20)', False),
        ('NUM_GUIA_RADIO_FINAL', 'VARCHAR(20)', False), ('GERAR_GUIA_PROFIS_SEQUENCIA', 'CHAR(1)', False),
        ('NUM_GUIA_RECURSO_GLOSA_INICIAL', 'VARCHAR(20)', False),
        ('NUM_GUIA_RECURSO_GLOSA_FINAL', 'VARCHAR(20)', False),
        ('GUIA_RESUMO_IDENTIFICAR_EQUIPE', 'SMALLINT', False), ('GUIA_SOL_AUTORIZ_SPSADT_SOLIC', 'SMALLINT', False),
        ('GUIA_SOL_AUTORIZ_SPSADT_EXEC', 'SMALLINT', False), ('IMPRIMIR_LAB_ITEM_GUIA_OUT_DESP', 'CHAR(1)', False),
        ('TOTALIZAR_VLR_LANC_GUIA_PRI_PAG', 'CHAR(1)', False), ('ID_TBTISSEMIEXP_INC_LOC_DESC', 'SMALLINT', False),
        ('ID_TBTISSGERSPSADTPS', 'SMALLINT', False), ('CERTIFICADO_DIG_WS_TISS', 'BLOB', False),
        ('SENHA_CERTIFICADO_DIG_WS_TISS', 'VARCHAR(100)', False),
        ('IMP_LANC_N_DISCRI_XML_PG_INTEG', 'CHAR(1)', False), ('SADT_INFO_CONTR_EXEC', 'SMALLINT', False),
        ('GERAR_SPSADT_CONTA_INTERNA', 'CHAR(1)', False), ('VALOR_UNITARIO_TABELA', 'VARCHAR(1)', False),
    ]),
    'TBVLRDTH': ('TAB,OPE,DATA', [
        ('TAB', 'SMALLINT', True), ('OPE', 'INTEGER', True), ('DATA', 'DATE', True), ('VALOR', 'DOUBLE', False),
    ]),
    'TBVLRMEM': ('TAB,COD,DATA', [
        ('TAB', 'SMALLINT', True), ('COD', 'INTEGER', True), ('DATA', 'DATE', True), ('VALOR', 'DOUBLE', False),
        ('PFB', 'VARCHAR(1)', False), ('ID_TBVERSAOBRASIN', 'SMALLINT', True), ('ID_TBMATMED', 'INTEGER', True),
        ('VALOR_PFB_BRASINDICE', 'DOUBLE', False), ('VALOR_PMC_BRASINDICE', 'DOUBLE', False),
    ]),
    'TBVLRTHM': ('TAB,COD,DATA', [
        ('TAB', 'SMALLINT', True), ('COD', 'INTEGER', True), ('DATA', 'DATE', True), ('VALOR_CH', 'DOUBLE', False),
        ('VALOR_CO', 'DOUBLE', False), ('VALOR_OUTROS', 'DOUBLE', False), ('VALOR_ANES', 'NUMERIC(18,2)', False),
        ('VALOR_FILME', 'NUMERIC(18,2)', False),
    ]),
    'TBINTCRC': ('EMPRESA,CONV,TIPO_CONTA,TIPO_LANC,TIPO_ATO,SUBTIPO_DIARIA', [
        ('CONV', 'SMALLINT', True), ('TIPO_CONTA', 'VARCHAR(1)', True), ('TIPO_LANC', 'SMALLINT', True),
        ('TIPO_ATO', 'SMALLINT', True), ('SUBTIPO_DIARIA', 'SMALLINT', True), ('GRUPO', 'SMALLINT', False),
        ('SUBGRUPO', 'SMALLINT', False), ('ITEM', 'SMALLINT', False), ('CTA_CONTABIL', 'INTEGER', False),
        ('EMPRESA', 'SMALLINT', True),
    ]),
    'TBVERSAOTISS': ('ID', [
        ('ID', 'SMALLINT', True), ('COD_VERSAO_TISS', 'VARCHAR(7)', True), ('ID_TBVERSAOTISSPAD', 'SMALLINT', True),
    ]),
    'FCCTAAUD': ('ANOPRO,MESPRO,TIPO_CTA,COD', [
        ('ANOPRO', 'SMALLINT', True), ('MESPRO', 'SMALLINT', True), ('TIPO_CTA', 'VARCHAR(1)', True),
        ('COD', 'INTEGER', True), ('PACIENTE', 'VARCHAR(70)', False), ('CON', 'SMALLINT', False),
        ('ALTA', 'TIMESTAMP', False), ('HOR_ALT', 'VARCHAR(4)', False), ('GUIA', 'VARCHAR(20)', False),
        ('NASC', 'TIMESTAMP', False), ('SEGURADO', 'VARCHAR(70)', False), ('VEIO', 'VARCHAR(1)', False),
        ('TIPO_NOTA', 'SMALLINT', False), ('OCORRENCIA', 'VARCHAR(1)', False), ('TIPO_ATE', 'SMALLINT', False),
        ('MATRICULA', 'VARCHAR(24)', False), ('EMPRESA', 'VARCHAR(40)', False), ('SENHA', 'VARCHAR(20)', False),
        ('CENCUS', 'INTEGER', False), ('CID9_P', 'INTEGER', False), ('CID9_S', 'INTEGER', False),
        ('CID10_P', 'VARCHAR(6)', False), ('CID10_S', 'VARCHAR(6)', False), ('MOTIVO', 'SMALLINT', False),
        ('SEXO', 'VARCHAR(1)', False), ('IDADE', 'SMALLINT', False), ('PERMANEN', 'SMALLINT', False),
        ('ESP', 'SMALLINT', False), ('CLINICA', 'VARCHAR(1)', False), ('UNID', 'SMALLINT', False),
        ('GRUPO', 'SMALLINT', False), ('AUTORIZADO', 'VARCHAR(1)', False), ('REG_ATE', 'INTEGER', False),
        ('CAA', 'BIGINT', False), ('DESCONTO', 'NUMERIC(9,2)', False), ('MODVIII', 'VARCHAR(1)', False),
        ('DESC_SH', 'VARCHAR(1)', False), ('DESC_SP', 'VARCHAR(1)', False), ('DESC_RC', 'VARCHAR(1)', False),
        ('DESC_MM', 'VARCHAR(1)', False), ('DESC_TD', 'VARCHAR(1)', False), ('CRM_RESP', 'INTEGER', False),
        ('UF_RESP', 'VARCHAR(2)', False), ('CRM_REQ', 'INTEGER', False), ('DATA_REQ', 'TIMESTAMP', False),
        ('CRM_ENC', 'INTEGER', False), ('DESC_ENC', 'VARCHAR(40)', False), ('PROC_SOL', 'INTEGER', False),
        ('MED_SOL', 'INTEGER', False), ('DATA_EMI', 'TIMESTAMP', False), ('DATA_GRA', 'TIMESTAMP', False),
        ('DATA_FEC', 'TIMESTAMP', False), ('NOME_RESP', 'VARCHAR(70)', False), ('NOME_REQ', 'VARCHAR(70)', False),
        ('DEPO', 'DOUBLE', False), ('ENCAM', 'VARCHAR(1)', False), ('PACOTE', 'VARCHAR(1)', False),
        ('CONDIC', 'VARCHAR(1)', False), ('NOTA', 'INTEGER', False), ('AUDITADA', 'VARCHAR(1)', False),
        ('IND_EMI', 'VARCHAR(1)', False), ('FECHADA', 'VARCHAR(1)', False), ('REMESSA', 'SMALLINT', False),
        ('HOR_BAI', 'VARCHAR(4)', False), ('BAIXA', 'DATE', False), ('USU_EMI', 'VARCHAR(31)', False),
        ('USU_FEC', 'VARCHAR(31)', False), ('USUARIO', 'VARCHAR(31)', False), ('COD_REQ', 'VARCHAR(14)', False),
        ('UF_REQ', 'VARCHAR(2)', False), ('PERC_DESC', 'NUMERIC(9,2)', False), ('MOT_EXC', 'SMALLINT', False),
        ('FICOU_APTO', 'VARCHAR(1)', False), ('HOR_URG', 'VARCHAR(1)', False), ('TFSHMM', 'SMALLINT', False),
        ('INAMPS', 'INTEGER', False), ('PARTO', 'VARCHAR(1)', False), ('PREMAT', 'SMALLINT', False),
        ('ATERMO', 'SMALLINT', False), ('NATIM', 'SMALLINT', False), ('MATRIC', 'VARCHAR(4)', False),
        ('IDAGES', 'SMALLINT', False), ('DT_GUIA', 'DATE', False), ('PG_INTEG', 'CHAR(1)', False),
        ('OBS', 'BLOB SUB_TYPE 1', False), ('DOC', 'INTEGER', False), ('PROC_CTA', 'INTEGER', False),
        ('MED_CTA', 'INTEGER', False), ('DOC_CONTABIL', 'INTEGER', False), ('PESSOA', 'CHAR(1)', False),
        ('CRED_PLS', 'INTEGER', False), ('FCH_PLS', 'CHAR(1)', False), ('USU_FCH_PLS', 'VARCHAR(31)', False),
        ('DT_FCH_PLS', 'DATE', False), ('ORIG_PLS', 'CHAR(1)', False), ('PS_PLS', 'INTEGER', False),
        ('SOL_PLS', 'INTEGER', False), ('PPS_PLS', 'CHAR(1)', False), ('PSOL_PLS', 'CHAR(1)', False),
        ('ID_TBCBOPRO_SOLICITANTE', 'INTEGER', False), ('ID_TBCBOPRO_PRINCIPAL_CTA', 'INTEGER', False),
    ]),
    'FCCTAEXT': ('ID', [
        ('ID', 'INTEGER', True), ('ANOPRO', 'SMALLINT', True), ('MESPRO', 'SMALLINT', True),
        ('TIPO_CTA', 'VARCHAR(1)', True), ('COD', 'INTEGER', True), ('PACIENTE', 'VARCHAR(70)', False),
        ('CON', 'SMALLINT', False), ('ALTA', 'TIMESTAMP', False), ('HOR_ALT', 'VARCHAR(4)', False),
        ('GUIA', 'VARCHAR(20)', False), ('NASC', 'TIMESTAMP', False), ('SEGURADO', 'VARCHAR(70)', False),
        ('VEIO', 'VARCHAR(1)', False), ('TIPO_NOTA', 'SMALLINT', False), ('OCORRENCIA', 'VARCHAR(1)', False),
        ('TIPO_ATE', 'SMALLINT', False), ('MATRICULA', 'VARCHAR(26)', False), ('EMPRESA', 'VARCHAR(40)', False),
        ('SENHA', 'VARCHAR(20)', False), ('CENCUS', 'INTEGER', False), ('CID9_P', 'INTEGER', False),
        ('CID9_S', 'INTEGER', False), ('CID10_P', 'VARCHAR(6)', False), ('CID10_S', 'VARCHAR(6)', False),
        ('MOTIVO', 'SMALLINT', False), ('SEXO', 'VARCHAR(1)', False), ('IDADE', 'SMALLINT', False),
        ('PERMANEN', 'SMALLINT', False), ('ESP', 'SMALLINT', False), ('CLINICA', 'VARCHAR(1)', False),
        ('UNID', 'SMALLINT', False), ('GRUPO', 'SMALLINT', False), ('AUTORIZADO', 'VARCHAR(1)', False),
        ('REG_ATE', 'INTEGER', False), ('CAA', 'BIGINT', False), ('DESCONTO', 'NUMERIC(9,2)', False),
        ('MODVIII', 'VARCHAR(1)', False), ('DESC_SH', 'VARCHAR(1)', False), ('DESC_SP', 'VARCHAR(1)', False),
        ('DESC_RC', 'VARCHAR(1)', False), ('DESC_MM', 'VARCHAR(1)', False), ('DESC_TD', 'VARCHAR(1)', False),
        ('CRM_RESP', 'INTEGER', False), ('UF_RESP', 'VARCHAR(2)', False), ('CRM_REQ', 'INTEGER', False),
        ('DATA_REQ', 'TIMESTAMP', False), ('CRM_ENC', 'INTEGER', False), ('DESC_ENC', 'VARCHAR(40)', False),
        ('PROC_SOL', 'INTEGER', False), ('MED_SOL', 'INTEGER', False), ('DATA_EMI', 'TIMESTAMP', False),
        ('DATA_GRA', 'TIMESTAMP', False), ('DATA_FEC', 'TIMESTAMP', False), ('NOME_RESP', 'VARCHAR(70)', False),
        ('NOME_REQ', 'VARCHAR(70)', False), ('DEPO', 'DOUBLE', False), ('ENCAM', 'VARCHAR(1)', False),
        ('PACOTE', 'VARCHAR(1)', False), ('CONDIC', 'VARCHAR(1)', False), ('NOTA', 'INTEGER', False),
        ('AUDITADA', 'VARCHAR(1)', False), ('IND_EMI', 'VARCHAR(1)', False), ('FECHADA', 'VARCHAR(1)', False),
        ('REMESSA', 'SMALLINT', False), ('HOR_BAI', 'VARCHAR(4)', False), ('BAIXA', 'DATE', False),
        ('USU_EMI', 'VARCHAR(31)', False), ('USU_FEC', 'VARCHAR(31)', False), ('USUARIO', 'VARCHAR(31)', False),
        ('COD_REQ', 'VARCHAR(14)', False), ('UF_REQ', 'VARCHAR(2)', False), ('PERC_DESC', 'NUMERIC(9,2)', False),
        ('MOT_EXC', 'SMALLINT', False), ('FICOU_APTO', 'VARCHAR(1)', False), ('HOR_URG', 'VARCHAR(1)', False),
        ('TFSHMM', 'SMALLINT', False), ('INAMPS', 'INTEGER', False), ('PARTO', 'VARCHAR(1)', False),
        ('PREMAT', 'SMALLINT', False), ('ATERMO', 'SMALLINT', False), ('NATIM', 'SMALLINT', False),
        ('MATRIC', 'VARCHAR(4)', False), ('IDAGES', 'SMALLINT', False), ('DT_GUIA', 'DATE', False),
        ('PG_INTEG', 'CHAR(1)', False), ('OBS', 'BLOB SUB_TYPE 1', False), ('DOC', 'INTEGER', False),
        ('PROC_CTA', 'INTEGER', False), ('MED_CTA', 'INTEGER', False), ('DOC_CONTABIL', 'INTEGER', False),
        ('PESSOA', 'CHAR(1)', False), ('CRED_PLS', 'INTEGER', False), ('FCH_PLS', 'CHAR(1)', False),
        ('USU_FCH_PLS', 'VARCHAR(31)', False), ('DT_FCH_PLS', 'DATE', False), ('ORIG_PLS', 'CHAR(1)', False),
        ('PS_PLS', 'INTEGER', False), ('SOL_PLS', 'INTEGER', False), ('PPS_PLS', 'CHAR(1)', False),
        ('PSOL_PLS', 'CHAR(1)', False), ('CID10_O', 'VARCHAR(6)', False), ('N_DECL_OBITO', 'VARCHAR(17)', False),
        ('PLANO', 'VARCHAR(40)', False), ('SERIE', 'VARCHAR(5)', True), ('TIPO_DOC', 'VARCHAR(1)', False),
        ('TPDOENCA', 'SMALLINT', False), ('IDANO', 'SMALLINT', False), ('IDMESES', 'SMALLINT', False),
        ('IDDIAS', 'SMALLINT', False), ('VAL_SENHA', 'DATE', True), ('TPSAIDA', 'SMALLINT', False),
        ('GUIA_S', 'VARCHAR(20)', False), ('NR_DECLARA_VIVO_1', 'VARCHAR(15)', False), ('DATA_AUT', 'DATE', False),
        ('TP_OBITO_MULHER', 'SMALLINT', False), ('ATUALIZOU_PLS', 'CHAR(1)', False),
        ('GUIASPSADT', 'VARCHAR(20)', False), ('GUIACONS', 'VARCHAR(20)', False), ('ATIVIDADE', 'SMALLINT', False),
        ('REGIME_INT', 'SMALLINT', False), ('CPL_POS_PARTO', 'CHAR(1)', False),
        ('COMPL_PUERPERIO', 'CHAR(1)', False), ('ATD_RN_SALA', 'CHAR(1)', False),
        ('COMPL_NEONATAL', 'CHAR(1)', False), ('BAIXO_PESO', 'CHAR(1)', False),
        ('TRANST_EM_PARTO', 'CHAR(1)', False), ('TIPO_FAT', 'SMALLINT', False), ('ID_MFCTAREC', 'INTEGER', False),
        ('HOSP', 'SMALLINT', False), ('DATA_APRES', 'DATE', False), ('TOTAL_CONTA', 'DOUBLE', False),
        ('TERCEIRIZADO', 'SMALLINT', False), ('VAL_CAR', 'DATE', False), ('IDENT', 'VARCHAR(15)', False),
        ('VALOR_PACOTE', 'NUMERIC(18,2)', False), ('CODVALIDBIO', 'VARCHAR(10)', False),
        ('NUMERO_RAT', 'VARCHAR(10)', False), ('DATA_HORA_INCLUSAO', 'TIMESTAMP', False),
        ('DATA_HORA_ULTIMA_ATUALIZACAO', 'TIMESTAMP', False),
        ('GUIA_ATRIBUIDA_OPERADORA_TISS', 'VARCHAR(20)', False), ('ATENDIMENTO_RN_TISS', 'CHAR(1)', False),
        ('TP_CONSULTA_TISS', 'SMALLINT', False), ('ID_TBTISSINDACID', 'SMALLINT', False),
        ('ID_TBPROCTO', 'INTEGER', False), ('DATA_RAT', 'DATE', False),
        ('ID_TBCBOPRO_SOLICITANTE', 'INTEGER', False), ('ID_TBCBOPRO_PRINCIPAL_CTA', 'INTEGER', False),
        ('ID_FCCTAEXT_FATURADO', 'INTEGER', False), ('ID_TBCONSPROF_CRM_REQ', 'SMALLINT', False),
        ('CODIGO_VALIDACAO_TISS', 'VARCHAR(10)', False), ('ID_TBTISSIDENTBENEFI', 'SMALLINT', False),
        ('ID_TBTISSMOTAUSENCODVALID', 'SMALLINT', False), ('ID_FCCADNFS', 'INTEGER', False),
        ('ID_TBTIPPLANO', 'INTEGER', False), ('NOME_SOCIAL', 'VARCHAR(70)', False),
        ('ID_TBTISSCOBERTESPECIAL', 'INTEGER', False), ('ID_TBTISSREGIMEATEND', 'INTEGER', False),
        ('ID_TBTISSSAUDEOCUPAC', 'INTEGER', False), ('USU_REM', 'VARCHAR(31)', False),
        ('DATA_REM', 'TIMESTAMP', False),
    ]),
    'FCDIAEXT': ('ANOPRO,MESPRO,COD', [
        ('ANOPRO', 'SMALLINT', True), ('MESPRO', 'SMALLINT', True), ('COD', 'INTEGER', True),
        ('DIAB', 'BLOB SUB_TYPE 1', False), ('EST_CIVIL', 'VARCHAR(1)', False), ('NACAO', 'VARCHAR(32)', False),
        ('ORIGEM', 'VARCHAR(20)', False), ('CPF', 'DOUBLE', False), ('VAL_CAR', 'DATE', False),
        ('CARGO', 'VARCHAR(6)', False), ('PADRAO', 'INTEGER', False), ('UND_ADM', 'VARCHAR(50)', False),
        ('AFINIDADE', 'VARCHAR(15)', False), ('N_ORDEM', 'VARCHAR(4)', False), ('CLASSE', 'VARCHAR(10)', False),
    ]),
}
# RPLANRPA: forma e linhas aqui só quando a L8-02 retirar a tabela da imagem dela (imagem conjunta sem duplicata)
# e a declaração desta fatia estiver ativa (descomentada).
from pathlib import Path as _Path  # noqa: E402
from sante_conector.sintetica_d import l8_02 as _l8_02  # noqa: E402

_DECL = _Path(__file__).resolve().parents[2] / "mapa/declarado/colunas.d/L8-05.tsv"
RPLANRPA_ATIVA = ("RPLANRPA" not in _l8_02.FORMAS
                  and any(l.startswith("RPLANRPA\t") for l in _DECL.read_text(encoding="utf-8").splitlines()))
if RPLANRPA_ATIVA:
    FORMAS['RPLANRPA'] = ('ID_RPRPA,ID_RPLANEVE', [('ID_RPRPA', 'INTEGER', True), ('ID_RPLANEVE', 'INTEGER', True)])


COLUNAS = {t: cols for t, (_, cols) in FORMAS.items()}
CARREGADAS = ("TBTIPPLANO", "TBTABDTH", "TBTPPROFPROC", "TBCODATI", "TBCODATI_TBUSERS", "TBCONVEN_TBTISSPARDEF",
              "TBEMIREF", "TBENTCON", "TBVLRTHM", "TBTIPPLCONV", "TBTISS", "TBVLRDTH",
              "FCCTAEXT", "FCDIAEXT") + (("RPLANRPA",) if RPLANRPA_ATIVA else ())
# declaração pronta e comentada (BLOQUEADA, motivo na linha); as três primeiras com linhas específicas na imagem
COMENTADAS = ("TBSEGUIA", "TBINTCRC", "FCCTAAUD", "TBPERMEM", "TBEMIREFMATMED")
COM_LINHAS = ("TBSEGUIA", "TBINTCRC", "FCCTAAUD")
# só lida pela referência encadeada (cadastro de versões TISS da origem, catálogo oficial nunca gravado)
SO_ORIGEM = ("TBVERSAOTISS",)
DESCARTES = ("TBTPOBRIGAMAT", "TBTPPERFILUNIBH", "TBTPTRATUNIBH", "TBTPCLASSIFUNIBH",
             "TBVERSAOBRASIN", "TBVLRMEM")
BLOQUEADAS = tuple(t for t in FORMAS if t not in CARREGADAS and t not in SO_ORIGEM)


def _ddl():
    saida = []
    for t, (chave, cols) in FORMAS.items():
        defs = ["%s %s%s" % (c, "DOUBLE PRECISION" if tp == "DOUBLE" else tp, " NOT NULL" if nn else "")
                for c, tp, nn in cols]
        if chave:
            defs.append("PRIMARY KEY (%s)" % chave)
        saida.append("CREATE TABLE %s (%s);" % (t, ", ".join(defs)))
    return "\n".join(saida) + "\n"


DDL = _ddl()
PAIS_EXTERNOS = {"TBCONVEN": ["1", "2"], "TBCTRDTH": ["1", "2"], "TBUSERS": ["ANA.EX", "BRUNO.EX"],
                 "TBCLASSI": ["1", "2"], "TBTABTHM": ["1|10", "1|11"],
                 "RECADATE": ["500", "501"], "TBLOCCON": ["1"]}
if RPLANRPA_ATIVA:  # RPA da L8-02 e lançamento de repasse da L8-01
    PAIS_EXTERNOS.update({"RPRPA": ["1", "2"], "RPLANEVE": ["10", "11"]})
# id de destino dado pela conferência a cada pai externo: 1, 2... na ordem das tabelas (nome) e das chaves
_IDS_EXTERNOS = {}
for _t in sorted(PAIS_EXTERNOS):
    for _k in PAIS_EXTERNOS[_t]:
        _IDS_EXTERNOS[(_t, _k)] = len(_IDS_EXTERNOS) + 1
# único estabelecimento do cliente de exemplo (o @estabelecimento resolve por ele)
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');"
    # catálogos-base do produto (semente pedida à F2.2): tipo de conta e tipo de auditoria pelo código
    " CREATE TABLE IF NOT EXISTS tipo_conta (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(30) NOT NULL);"
    " INSERT INTO tipo_conta (codigo) VALUES ('ambulatorial'), ('externa'), ('urgencia'), ('internacao');"
    " CREATE TABLE IF NOT EXISTS tipo_auditoria (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
    " codigo VARCHAR(30) NOT NULL); INSERT INTO tipo_auditoria (codigo) VALUES ('migracao');"
    # versão TISS de troca do carregador oficial (só a 4.03.00; a 3.05.00 da origem fica sem par)
    " INSERT INTO versao_padrao_tiss (codigo_tiss, componente, descricao, vigencia_inicio, versao_fonte, criado_em)"
    " VALUES ('4.03.00', 'troca', 'Versao exemplo', '2024-01-01', 'exemplo', UTC_TIMESTAMP(3));"
    # atendimentos já carregados pelo L3 (pais externos RECADATE 500 e 501): o paciente vem da cópia da coluna
    " CREATE TABLE IF NOT EXISTS atendimento (id BIGINT UNSIGNED PRIMARY KEY, paciente_id BIGINT UNSIGNED NULL);"
    " INSERT INTO atendimento (id, paciente_id) VALUES (%d, 7001), (%d, 7002)" % (
        _IDS_EXTERNOS[("RECADATE", "500")], _IDS_EXTERNOS[("RECADATE", "501")]))


def _falso(tipo, i):
    """Valor falso pela forma da coluna (tabelas só com a forma)."""
    if tipo.startswith(("SMALLINT", "INTEGER", "BIGINT")):
        return i
    if tipo.startswith(("VARCHAR", "CHAR")):
        n = int(tipo.split("(")[1].rstrip(")"))
        return "S" if n == 1 else (str(i) + " exemplo")[:n]
    if tipo.startswith("NUMERIC") or tipo == "DOUBLE":
        return decimal.Decimal("1.5")
    if tipo == "DATE":
        return datetime.date(2025, 1, i)
    if tipo == "TIMESTAMP":
        return datetime.datetime(2025, 1, i, 8, 30)
    return ("texto exemplo " + str(i)).encode("cp1252")


def _ins(ins, tab, **v):
    ins(tab, [v.get(c) for c, _, _ in COLUNAS[tab]])


def linhas(r, ins):
    D, dt = decimal.Decimal, datetime.date
    for tab in BLOQUEADAS:
        if tab in COM_LINHAS:
            continue
        for i in (1, 2):
            ins(tab, [_falso(tp, i) for _, tp, _ in COLUNAS[tab]])
    # planos: 3 repete o código 1 na fonte 1 (chave única: 1062); 4 sem nome (1048); 5 S/N fora do domínio (padrão
    # falso, gravado); 6 fonte nunca vista (pai_inexistente + 1048); 7 sem fonte (1048)
    for i, cod, nome, cop, conv in [(1, 1, "Plano basico exemplo", "S", 1), (2, 2, "Plano  especial  ex", "N", 1),
                                    (3, 1, "Plano repetido ex", "N", 1), (4, 3, None, "S", 2),
                                    (5, 4, "Plano quatro ex", "X", 2), (6, 5, "Plano orfao ex", "N", 99),
                                    (7, 6, "Plano sem fonte ex", "N", None)]:
        _ins(ins, "TBTIPPLANO", ID=i, COD=cod, NOME=nome, PLANO_COOPART=cop, ID_TBCONVEN=conv)
    # diárias e taxas: 2 cobra taxa fora do domínio (padrão verdadeiro, gravado); 4 sem nome (1048); 5 tabela nunca
    # vista (pai_inexistente + 1048); 6 meses negativos (NULL com pendência, gravado); 7 repete TAB 1 + OPE 10 (1062);
    # situação: 1 fora de A/I (padrão ativo, com pendência), 3 inativa (I: gravada com ativo falso)
    for i, tab, ope, nome, cobtx, meses in [(1, 1, 10, "Diaria apartamento ex", "S", None),
                                            (2, 1, 11, "Taxa de sala ex", "X", None),
                                            (3, 2, 10, "Gas exemplo", "N", None), (4, 1, 12, None, "S", None),
                                            (5, 9, 1, "Taxa orfa ex", "S", None), (6, 2, 11, "Aluguel ex", "S", -1),
                                            (7, 1, 10, "Diaria repetida ex", "S", None)]:
        _ins(ins, "TBTABDTH", ID=i, TAB=tab, OPE=ope, NOME=nome, COD="EX%d" % i, TIPO=1, CH=D("1.5") * i,
             COBTX=cobtx, PACOTE="N", LAN_CRM="S" if i % 2 else "N", MAT_INSUMO="N", MED_INSUMO="N",
             LAN_HORA_FINAL="N", NUMERO_MESES=meses, SITUACAO={1: "Z", 3: "I"}.get(i, "A"))
    # funções: código com prefixo de domínio (não colide com os IDs de TBCOSPPROF/TBGRAUPARTPROC); 3 nome em branco
    # (1048); tipo presumido em todas as lidas
    for i, nome in [(1, "Cirurgiao  ex"), (2, "Auxiliar ex"), (3, "   ")]:
        _ins(ins, "TBTPPROFPROC", ID=i, NOME=nome)
    # códigos do prestador: 1 com senha (nunca gravada: segredo_aguarda_cofre); 3 fonte nunca vista (pai_inexistente
    # + 1048); 4 sem código na operadora (1048)
    for i, conv, cod, senha in [(1, 1, "A1001", "senha falsa"), (2, 2, "B2002", None), (3, 9, "C3003", None),
                                (4, 1, None, None)]:
        _ins(ins, "TBCODATI", ID=i, CONV=conv, ATIVIDADE=1, COD_CONV=cod, NOME="Codigo ex %d" % i,
             LOGIN_PRESTADOR="login.ex%d" % i, SENHA_PRESTADOR=senha, SENHA_PRESTADOR_PADRAO_HASH_MD5="N",
             CTR_AUT_TP_BASIC="N")
    # usuários do código: 3 usuário nunca visto (pai_inexistente + 1048); 4 código recusado (pai_pendente)
    for cod, usu in [(1, "ANA.EX"), (2, "BRUNO.EX"), (1, "ZECA.EX"), (3, "ANA.EX")]:
        _ins(ins, "TBCODATI_TBUSERS", ID_TBCODATI=cod, USUARIO=usu)
    # valor padrão de campo TISS: o parâmetro (TBTISSPARDEF) não está nesta imagem: campo pai_inexistente + 1048
    for conv, par, v in [(1, 1, "S"), (2, 1, "N")]:
        _ins(ins, "TBCONVEN_TBTISSPARDEF", ID_TBCONVEN=conv, ID_TBTISSPARDEF=par, VALOR_DEFAULT=v)
    # referência de emissão: 3 código fora de S/N (padrão com valor_fora_do_dominio, gravado); 4 classificação
    # nunca vista (pai_inexistente + 1048)
    for conv, cl, rc, rd, pfb in [(1, 1, "S", "S", "S"), (1, 2, "N", "N", "N"), (2, 1, "X", None, None),
                                  (2, 9, "S", "S", "S")]:
        _ins(ins, "TBEMIREF", CONV=conv, CLASSIF=cl, COD_DESC="C", REF_COD=rc, REF_DESC=rd, REF_VALOR="S",
             REF_VALOR_PFB=pfb, REF_VALOR_PMC="N")
    # calendário: 3 pagamento antes da entrega (CHECK: 4025); 4 fonte nunca vista (pai_inexistente + 1048)
    for conv, ent, pag in [(1, dt(2025, 2, 10), dt(2025, 3, 15)), (1, dt(2025, 3, 10), None),
                           (2, dt(2025, 2, 10), dt(2025, 1, 5)), (9, dt(2025, 2, 10), None)]:
        _ins(ins, "TBENTCON", CONV=conv, ENTREGA=ent, PAGAMENTO=pag)
    # (BLOQUEADA, só presença na imagem; esperado de quando a regra inteiro_mais_um e o tipo 'lote' existirem)
    # contadores: 2 sem números (padrão 1); 3 tipo 7 fora do de-para (valor_fora_do_dominio + 1048); 4 lote zero
    # (CHECK: 4025); 5 lote não numérico (padrão 1 com valor_fora_do_dominio, gravado); 6 tipo 0, o contador geral
    # do lote, sem tipo no modelo (valor_fora_do_dominio + 1048, até o pedido de modelo)
    for conv, tg, lote, seq in [(1, 1, "120", "45"), (1, 2, None, None), (2, 7, "5", "5"), (2, 1, "0", "3"),
                                (2, 2, "L12", "9"), (2, 0, "7", "7")]:
        _ins(ins, "TBSEGUIA", CONV=conv, TIPO_GUIA=tg, NUM_LOTE=lote, SEQ_TRANSACAO=seq)
    # valores do procedimento: 3 sem nenhum valor (CHECK: 4025); 4 procedimento nunca visto (pai_inexistente + 1048)
    for tab, cod, data, ch, co, anes in [(1, 10, dt(2025, 1, 1), 10.5, 2.25, D("3.00")),
                                         (1, 10, dt(2025, 6, 1), 11.0, None, None),
                                         (1, 11, dt(2025, 1, 1), None, None, None),
                                         (2, 99, dt(2025, 1, 1), 1.0, None, None)]:
        _ins(ins, "TBVLRTHM", TAB=tab, COD=cod, DATA=data, VALOR_CH=ch, VALOR_CO=co, VALOR_ANES=anes)
    # (BLOQUEADA até as dimensões do de-para no modelo; só presença na imagem)
    # de-para da conta de receita: 1 com natureza; 2 sem natureza (vale para a fonte); 3 conta zero (sem conta: CHECK
    # 4025); 4 fonte nunca vista (pai_inexistente + CHECK 4025); 5 natureza nunca vista (pai_inexistente, gravado)
    for conv, tc, tl, g, sg, it, cta in [(1, "I", 1, 1, 1, 1, 3101), (2, "E", 1, None, None, None, 3102),
                                         (1, "E", 2, None, None, None, 0), (9, "I", 1, None, None, None, 3103),
                                         (2, "I", 3, 9, 9, 9, 3104)]:
        _ins(ins, "TBINTCRC", EMPRESA=1, CONV=conv, TIPO_CONTA=tc, TIPO_LANC=tl, TIPO_ATO=0, SUBTIPO_DIARIA=0,
             GRUPO=g, SUBGRUPO=sg, ITEM=it, CTA_CONTABIL=cta)
    # diária por plano e local: 1 com local; 2 todos os locais; 3 sem diária (1048); 4 fonte nunca vista
    # (pai_inexistente + 1048); 5 plano recusado (TBTIPPLANO 4: pai_pendente); 6 local nunca visto (NULL, gravado)
    for conv, pl, dth, loc in [(1, 1, 1, 1), (1, 2, 2, None), (2, 5, None, None), (9, 1, 1, None), (2, 4, 3, None),
                               (2, 1, 6, 7)]:
        _ins(ins, "TBTIPPLCONV", CONV=conv, ID_TBTIPPLANO=pl, ID_TBTABDTH=dth, ID_TBLOCCON=loc)
    # versões TISS da origem: 1 = 4.03.00 (no catálogo oficial); 2 = 3.05.00 (sem par no catálogo)
    for i, cod in [(1, "4.03.00"), (2, "3.05.00")]:
        _ins(ins, "TBVERSAOTISS", ID=i, COD_VERSAO_TISS=cod, ID_TBVERSAOTISSPAD=1)
    # parâmetros TISS: 1 grava os dois destinos (senha do certificado nunca lida); 2 versão sem par no catálogo
    # (catalogo_codigo_inexistente + 1048); 3 fonte nunca vista (pai_inexistente + 1048)
    for conv, ver, cod, verso in [(1, 1, "A100", "S"), (2, 2, "B200", "N"), (9, 1, "C300", "S")]:
        _ins(ins, "TBTISS", CONV=conv, VERSAO_TISS=ver, COD_CON_TISS=cod, IMP_VERSO_GUIA=verso,
             SENHA_CERTIFICADO_DIG_WS_TISS="senha falsa")
    # valor da diária por vigência (pai pela chave alternativa TAB+OPE de TBTABDTH): 1 e 2 gravam; 3 sem valor
    # (1048); 4 TAB+OPE repetido na origem (pai_ambiguo + 1048); 5 nunca visto (pai_inexistente + 1048); 6 valor
    # negativo (CHECK 4025); 7 pai recusado (TBTABDTH 4: pai_pendente)
    for tab, ope, data, v in [(1, 11, dt(2025, 1, 1), 100.0), (1, 11, dt(2025, 6, 1), 120.5),
                              (2, 10, dt(2025, 1, 1), None), (1, 10, dt(2025, 1, 1), 50.0),
                              (3, 99, dt(2025, 1, 1), 10.0), (2, 11, dt(2025, 1, 1), -5.0),
                              (1, 12, dt(2025, 1, 1), 9.0)]:
        _ins(ins, "TBVLRDTH", TAB=tab, OPE=ope, DATA=data, VALOR=v)
    # contas: 1, 2 (fechada), 7 e 8 gravam; 3 atendimento nunca visto (pai_inexistente + 1048); 4 tipo X fora do
    # de-para (valor_fora_do_dominio na natureza, no tipo e 1048); 5 fechada sem usuário (CHECK 4025); 6 sem data
    # de início (1048). A conta 8 repete ANO+MES+COD da 1 com outro tipo (a chave do segurado fica ambígua)
    ts = datetime.datetime
    for i, ano, mes, tc, cod, conv, reg, baixa, fech, dfec, ufec in [
            (1, 2025, 1, "E", 100, 1, 500, dt(2025, 1, 10), "N", None, None),
            (2, 2025, 1, "A", 101, 2, 501, dt(2025, 1, 11), "S", ts(2025, 1, 31, 18, 0), "ANA.EX"),
            (3, 2025, 1, "E", 102, 1, 999, dt(2025, 1, 12), "N", None, None),
            (4, 2025, 1, "X", 103, 1, 500, dt(2025, 1, 13), "N", None, None),
            (5, 2025, 1, "E", 104, 1, 500, dt(2025, 1, 14), "S", ts(2025, 1, 31, 18, 0), None),
            (6, 2025, 1, "E", 105, 1, 500, None, "N", None, None),
            (7, 2025, 2, "E", 100, 1, 500, dt(2025, 2, 3), "N", None, None),
            (8, 2025, 1, "A", 100, 2, 501, dt(2025, 1, 20), "N", None, None)]:
        _ins(ins, "FCCTAEXT", ID=i, ANOPRO=ano, MESPRO=mes, TIPO_CTA=tc, COD=cod, CON=conv, REG_ATE=reg,
             BAIXA=baixa, HOR_BAI="0830", ALTA=ts(2025, 2, 28) if i == 1 else None, HOR_ALT="1015",
             FECHADA=fech, DATA_FEC=dfec, USU_FEC=ufec, TOTAL_CONTA=150.75 * i, DESCONTO=D("1.50"),
             SENHA="AUT%d" % i, MATRICULA="CART-%d" % i, ID_TBTIPPLANO=1, SERIE="EX", VAL_SENHA=dt(2025, 12, 31),
             OBS=("Observacao exemplo %d" % i).encode("cp1252"))
    # (BLOQUEADA até a dependência, o total nulo e a conclusão condicional; só presença na imagem)
    # auditorias (cópia do cabeçalho antes da auditoria): 1 e 2 gravam; 3 conta recusada (pai_pendente); 4 conta
    # nunca vista (pai_inexistente + 1048); 5 sem auditor (CHECK 4025); 6 sem data (1048)
    for ano, mes, tc, cod, usu, dgra, aud in [
            (2025, 1, "E", 100, "ANA.EX", ts(2025, 1, 20, 10, 0), "S"),
            (2025, 1, "A", 101, "BRUNO.EX", ts(2025, 1, 21, 11, 0), "N"),
            (2025, 1, "E", 102, "ANA.EX", ts(2025, 1, 22, 9, 0), "S"),
            (2025, 3, "E", 555, "ANA.EX", ts(2025, 3, 2, 9, 0), "S"),
            (2025, 2, "E", 100, None, ts(2025, 2, 10, 9, 0), "S"),
            (2025, 1, "A", 100, "ANA.EX", None, "S")]:
        _ins(ins, "FCCTAAUD", ANOPRO=ano, MESPRO=mes, TIPO_CTA=tc, COD=cod, CON=1, USUARIO=usu, DATA_GRA=dgra,
             AUDITADA=aud, SENHA="AUTX", OBS=b"Nota de auditoria exemplo")
    # segurado da conta: 1 e 3 gravam (carteira lida da conta); 2 ANO+MES+COD em duas contas (pai_ambiguo + 1048);
    # 4 conta recusada (pai_pendente); 5 conta nunca vista (pai_inexistente + 1048)
    for ano, mes, cod, cargo in [(2025, 2, 100, "Analista"), (2025, 1, 100, "Tecnico"), (2025, 1, 101, "Auxiliar"),
                                 (2025, 1, 102, "Agente"), (2025, 5, 1, "Outro")]:
        _ins(ins, "FCDIAEXT", ANOPRO=ano, MESPRO=mes, COD=cod, CARGO=cargo[:6], PADRAO=3, CLASSE="B",
             UND_ADM="Unidade administrativa ex", AFINIDADE="Titular", N_ORDEM="01", VAL_CAR=dt(2026, 6, 30),
             CPF=None, DIAB=b"texto exemplo")
    # lançamentos do RPA: 1 e 2 gravam; 3 lançamento nunca visto (pai_inexistente + 1048)
    if RPLANRPA_ATIVA:
        for rpa, lan in [(1, 10), (2, 11), (1, 99)]:
            _ins(ins, "RPLANRPA", ID_RPRPA=rpa, ID_RPLANEVE=lan)
    esperado = {
        "TBTIPPLANO": {"gravados": 3, "pendencias": {"restricao_destino_1062": 1, "restricao_destino_1048": 3,
                                                     "valor_fora_do_dominio": 1, "pai_inexistente": 1}},
        "TBTABDTH": {"gravados": 4, "pendencias": {"valor_presumido": 7, "valor_fora_do_dominio": 3,
                                                   "restricao_destino_1048": 2, "restricao_destino_1062": 1,
                                                   "pai_inexistente": 1}},
        "TBTPPROFPROC": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "TBCODATI": {"gravados": 2, "pendencias": {"valor_presumido": 4, "vigencia_sem_fonte": 4,
                                                   "segredo_aguarda_cofre": 1, "pai_inexistente": 1,
                                                   "restricao_destino_1048": 2}},
        "TBCODATI_TBUSERS": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1,
                                                           "pai_pendente": 1}},
        "TBCONVEN_TBTISSPARDEF": {"gravados": 0, "pendencias": {"pai_inexistente": 2, "vigencia_sem_fonte": 2,
                                                                "restricao_destino_1048": 2}},
        "TBEMIREF": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "pai_inexistente": 1,
                                                   "restricao_destino_1048": 1}},
        "TBENTCON": {"gravados": 2, "pendencias": {"restricao_destino_4025": 1, "pai_inexistente": 1,
                                                   "restricao_destino_1048": 1}},
        "TBVLRTHM": {"gravados": 2, "pendencias": {"restricao_destino_4025": 1, "pai_inexistente": 1,
                                                   "restricao_destino_1048": 1}},
        "TBTIPPLCONV": {"gravados": 3, "pendencias": {"restricao_destino_1048": 2, "pai_inexistente": 2,
                                                      "pai_pendente": 1, "vigencia_sem_fonte": 5}},
        "TBTISS": {"gravados": 1, "pendencias": {"catalogo_codigo_inexistente": 2, "pai_inexistente": 2,
                                                 "restricao_destino_1048": 2, "vigencia_sem_fonte": 3}},
        "TBVLRDTH": {"gravados": 2, "pendencias": {"restricao_destino_1048": 3, "pai_ambiguo": 1,
                                                   "pai_inexistente": 1, "restricao_destino_4025": 1,
                                                   "pai_pendente": 1}},
        "FCCTAEXT": {"gravados": 4, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 3,
                                                   "restricao_destino_4025": 1, "valor_fora_do_dominio": 2}},
        "FCDIAEXT": {"gravados": 2, "pendencias": {"pai_ambiguo": 2, "pai_inexistente": 2, "pai_pendente": 1,
                                                   "restricao_destino_1048": 2}},
    }
    if RPLANRPA_ATIVA:
        esperado["RPLANRPA"] = {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}}
    return esperado

