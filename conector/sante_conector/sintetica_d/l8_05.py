"""Fatia L8-05 (faturamento e restantes, módulo FAT): tabelas da origem com a forma do dicionário e dados 100% falsos.

Carregáveis hoje (CARREGADAS): TBTIPPLANO (plano da fonte pagadora) e TBTABDTH (diária ou taxa na tabela de preço).
PAIS_EXTERNOS são pais de fora da fatia que AINDA NÃO SÃO CARREGADOS por nenhum lote: TBCONVEN (fonte pagadora, L5-06
comentada) e TBCTRDTH (tabela de preço de diárias e taxas, L8-03 sem destino: colisão de tabela_preco.codigo entre
origens). Eles entram aqui só para exercitar a carga; na carga real as duas tabelas dependem deles e ficam recusadas
(pai_inexistente + NOT NULL) até os pais carregarem: dependências bloqueantes registradas em saida/L8-05.json e
conferidas em test_l8_05. Anomalias: nome vazio (NOT NULL), S/N e A/I fora do domínio (padrão do destino com
pendência), chave única repetida, fonte ou tabela inexistente (pai_inexistente + NOT NULL), meses negativos (NULL com
pendência), item inativo (I) e literal presumido (valor_presumido por linha lida).
As outras 21 (BLOQUEADAS: pai ou coluna obrigatória do destino que a origem não dá, referência licenciada, chave
composta, código que colide entre origens) entram só com a forma (2 linhas falsas cada); os pedidos estão em
docs/obra/fatias/f4/saida/L8-05.json.
"""
import datetime
import decimal

FORMAS = {
    'TBTISSTERMO_TBTPLANC': ('ID', [
        ('ID', 'INTEGER', True), ('ID_TBTISSTERMO', 'SMALLINT', True), ('ID_TBTPLANC', 'SMALLINT', True),
    ]),
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
}


COLUNAS = {t: cols for t, (_, cols) in FORMAS.items()}
CARREGADAS = ("TBTIPPLANO", "TBTABDTH")
BLOQUEADAS = tuple(t for t in FORMAS if t not in CARREGADAS)


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
PAIS_EXTERNOS = {"TBCONVEN": ["1", "2"], "TBCTRDTH": ["1", "2"]}


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
    for tab in BLOQUEADAS:
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
    D = decimal.Decimal
    for i, tab, ope, nome, cobtx, meses in [(1, 1, 10, "Diaria apartamento ex", "S", None),
                                            (2, 1, 11, "Taxa de sala ex", "X", None),
                                            (3, 2, 10, "Gas exemplo", "N", None), (4, 1, 12, None, "S", None),
                                            (5, 9, 1, "Taxa orfa ex", "S", None), (6, 2, 11, "Aluguel ex", "S", -1),
                                            (7, 1, 10, "Diaria repetida ex", "S", None)]:
        _ins(ins, "TBTABDTH", ID=i, TAB=tab, OPE=ope, NOME=nome, COD="EX%d" % i, TIPO=1, CH=D("1.5") * i,
             COBTX=cobtx, PACOTE="N", LAN_CRM="S" if i % 2 else "N", MAT_INSUMO="N", MED_INSUMO="N",
             LAN_HORA_FINAL="N", NUMERO_MESES=meses, SITUACAO={1: "Z", 3: "I"}.get(i, "A"))
    return {
        "TBTIPPLANO": {"gravados": 3, "pendencias": {"restricao_destino_1062": 1, "restricao_destino_1048": 3,
                                                     "valor_fora_do_dominio": 1, "pai_inexistente": 1}},
        "TBTABDTH": {"gravados": 4, "pendencias": {"valor_presumido": 7, "valor_fora_do_dominio": 3,
                                                   "restricao_destino_1048": 2, "restricao_destino_1062": 1,
                                                   "pai_inexistente": 1}},
    }
