"""Fatia L6-11 (prontuário, assinatura e assistência, módulo PEP): tabelas da origem com a forma do dicionário e dados
100% falsos.

Carregadas pelo mapa (colunas.d/L6-11.tsv, pares em valores.d/L6-11.tsv): PRLOCAL_ASSISTENCIA, TBCBARAREACAOADVERSA,
PRPROTGERALESP, PREVOLUCAO, PREVOLESPEC, PREVOLTIPOACO, PRITEMNAOPAD (item não padronizado), PRITEMNAOPAD_GETABVIA,
PRKITMED (kit do medicamento), PRITENSKITMED e PRKITSOLITENS (itens de kit), TBKITPRO (kit de cuidado de enfermagem e
item), PRFAVORITO (filtro do painel do usuário) e PRMANCHESTER (nível de prioridade). Descarte de produto
(declarado/sem_carga.tsv): PRAGRUP_PRFILTROCLASSIF, PRPARAM, PRPAREVOLIMG. Bloqueadas por mecanismo compartilhado
(pedidos em docs/obra/fatias/f4/saida/L6-11.json): PRITEM_GEITENS, PRITEMNAOPAD_TBPRINC, TBALERGIA_TBPRINC, PRPADEVOL,
PRFORMULCOMP, PRASSINATURA_CAB. As não carregadas entram só com a forma (2 linhas falsas).

Pais lidos na ORIGEM pelas referências por chave alternativa e encadeadas: REQUER a L7-07 (GEITENS e GEUNIPRESC:
insumo, nome do item, unidade do insumo); PRLOCPACDEFAULT (forma e linhas da L6-05) e TBUNIDADEMEDIDA (forma da L6-10)
entram pelo módulo da dona, porque L6-05 e L6-10 não cabem juntas com a L7-07 nesta imagem. TBPROENF (forma da
L6-09) idem. O PREPARO_DESTINO cria o
estabelecimento único (o da requerida não roda na conferência desta fatia).
Anomalias: texto acima do tamanho do destino (1406), NOT NULL do destino sem valor (1048), pai inexistente, pai
recusado (pai_pendente em cadeia), colisão de caixa no código único, valor fora do domínio (padrão do destino ou
recusa), literal presumido, CHECK do destino (4025: intervalo invertido, quantidade zero, produto ausente), unidade sem
correspondência na chave alternativa, nome do pai vazio na referência encadeada.
"""
import datetime
import decimal
import re

REQUER = ["L7-07"]
# pais lidos na origem cujas donas não podem entrar juntas na imagem desta fatia (L6-05 e L7-07 divergem em GETABVIA;
# L6-10 depende da L6-09): a forma e as linhas vêm do módulo da dona, sem cópia (L6-05: PRLOCPACDEFAULT, como ela já
# faz para a L5-01; L6-09: TBPROENF; L6-10: TBUNIDADEMEDIDA). São carregados também (as colunas são as do mapa); o esperado deles não é
# desta fatia.
from . import l6_05 as _l6_05, l6_09 as _l6_09, l6_10 as _l6_10
_PAI_DDL = {t: re.search(r"CREATE TABLE %s \(.*?\);" % t, m.DDL, re.S).group(0)
            for t, m in (("PRLOCPACDEFAULT", _l6_05), ("TBPROENF", _l6_09), ("TBUNIDADEMEDIDA", _l6_10))}
UNIDADES = [(1, 10, "Miligrama", "MG", "mg", "A"), (2, 10, "Mililitro", "ML", "mL", "A"),
            (4, 11, "Unidade internacional", "UI", "UI", "A")]
CUIDADOS = [[1, "Cuidado exemplo um", "A", "C", 1, 1, None, None, None, None, None, None, "N", 0],
            [4, None, "A", "C", 1, 1, None, None, None, None, None, None, "N", 0],          # recusado (1048)
            [5, "Cuidado exemplo cinco", "A", "C", 1, 2, None, None, None, None, None, None, "N", 0]]

FORMAS = {
    'PRITEMNAOPAD': ('ID_ITEMNAOPAD', [
        ('ID_ITEMNAOPAD', 'INTEGER', True), ('NOME', 'VARCHAR(60)', False), ('UNI_PRESC', 'VARCHAR(7)', True),
        ('SITUACAO', 'VARCHAR(1)', False), ('ITEM', 'INTEGER', False), ('USUARIO_CAD', 'VARCHAR(31)', False),
        ('ID_PRTPLAN', 'SMALLINT', True),]),
    'PRITEMNAOPAD_GETABVIA': ('ID_PRITEMNAOPAD,ID_GETABVIA', [
        ('ID_PRITEMNAOPAD', 'INTEGER', True), ('ID_GETABVIA', 'VARCHAR(2)', True),]),
    'PRITEM_GEITENS': ('ID_GEITENS', [
        ('ID_GEITENS', 'INTEGER', True), ('INFORMAR_LOCAL_ACESSO_INVASIVO', 'CHAR(1)', False),
        ('TEMPO_MAX_PERMANENCIA_INVASIVO', 'INTEGER', False), ('TIPO_UNID_RESP_ACESSO_INVASIVO', 'SMALLINT', False),
        ('ITEM_CONTABILIZADO_BALANCO_PEP', 'CHAR(1)', False),
        ('COORDENADA_EXIBICAO_NOME_ITEM', 'VARCHAR(100)', False), ('POTENCIALMENTE_PERIGOSO', 'CHAR(1)', False),
        ('INFORMACAO_COMPLEMENTAR_PRESC', 'SMALLINT', False), ('CONSISTIR_DOSE_MINIMA_MAXIMA', 'SMALLINT', True),
        ('PERMITIR_DOSE_INTERV_SUP_24H', 'CHAR(1)', False), ('PERIODO_MINIMO_ENTRE_DOSE', 'SMALLINT', False),
        ('ID_GEITEACAODOSE', 'SMALLINT', True), ('PADRAO_BOMBA_FICHA_ANEST', 'CHAR(1)', True),
        ('ID_PRFA_UTILIZACAO', 'SMALLINT', False),]),
    'PRKITMED': ('ID', [
        ('ID', 'INTEGER', True), ('ID_GEITENS', 'INTEGER', True), ('INTERVALO_INICIAL_DOSE', 'NUMERIC(18,3)', True),
        ('INTERVALO_FINAL_DOSE', 'NUMERIC(18,3)', True), ('ID_TBUNICON_UNI_PRESC', 'VARCHAR(7)', True),
        ('ID_GETABVIA', 'VARCHAR(2)', True), ('TP_ATENDIMENTO', 'CHAR(1)', False), ('ATIVO', 'CHAR(1)', False),]),
    'PRITENSKITMED': ('ID_PRKITMED,ID_GEITENS', [
        ('ID_PRKITMED', 'INTEGER', True), ('ID_GEITENS', 'INTEGER', True), ('QTDE', 'NUMERIC(18,3)', True),
        ('ID_TBUNICON_UNI_PRESC', 'VARCHAR(7)', True),]),
    'PRKITSOLITENS': ('ID_PRKITSOL,ID_GEITENS', [
        ('ID_PRKITSOL', 'INTEGER', True), ('ID_GEITENS', 'INTEGER', True), ('ITEM_PRINCIPAL', 'SMALLINT', True),
        ('QTDE', 'NUMERIC(9,3)', True), ('ID_TBUNICON_UNI_PRESC', 'VARCHAR(7)', True),
        ('ID_PRFORMULA', 'SMALLINT', False),]),
    'TBKITPRO': ('ID', [
        ('ID', 'INTEGER', True), ('PROCTO', 'INTEGER', True), ('QTDE', 'NUMERIC(9,3)', False),
        ('INTERVALO_INICIAL', 'SMALLINT', True), ('INTERVALO_FINAL', 'SMALLINT', False), ('ACM', 'CHAR(1)', False),
        ('ID_GEUNIPRESC', 'INTEGER', True), ('ID_GETABVIA', 'VARCHAR(2)', False),]),
    'PRITEMNAOPAD_TBPRINC': ('ID_PRITEMNAOPAD,ID_TBPRINC', [
        ('ID_PRITEMNAOPAD', 'INTEGER', True), ('ID_TBPRINC', 'INTEGER', True),]),
    'TBALERGIA_TBPRINC': ('ID_TBALERGIA,ID_TBPRINC', [
        ('ID_TBALERGIA', 'INTEGER', True), ('ID_TBPRINC', 'INTEGER', True), ('SITUACAO', 'CHAR(1)', True),]),
    'PRAGRUP_PRFILTROCLASSIF': ('ID', [
        ('ID', 'SMALLINT', True), ('ID_PRFILTROCLASSIF', 'SMALLINT', True), ('ID_TBCLASSI', 'SMALLINT', True),]),
    'PRLOCAL_ASSISTENCIA': ('ID', [
        ('ID', 'INTEGER', True), ('TIPO_ATENDIMENTO', 'CHAR(1)', False), ('ID_TBLEITO', 'SMALLINT', False),
        ('ID_TBUNIDAD', 'SMALLINT', False), ('LOCAL_ASSISTENCIA', 'VARCHAR(200)', False),
        ('SITUACAO', 'CHAR(1)', True),]),
    'TBCBARAREACAOADVERSA': ('ID', [
        ('ID', 'INTEGER', True), ('CODIGO', 'VARCHAR(50)', True), ('NOME', 'VARCHAR(200)', True),
        ('DESCRICAO', 'VARCHAR(500)', False), ('SINONIMO_1', 'VARCHAR(200)', False),
        ('SINONIMO_2', 'VARCHAR(200)', False), ('ID_TBCID10', 'INTEGER', False), ('ID_TBCIAP', 'INTEGER', False),
        ('ID_TBVERSAOCBARA', 'SMALLINT', False), ('ATIVO', 'CHAR(1)', True), ('ID_DIGITAL', 'VARCHAR(36)', False),]),
    'PRFAVORITO': ('ID_PRLOCPACDEFAULT,TIPO_ATENDIMENTO', [
        ('ID_PRLOCPACDEFAULT', 'INTEGER', True), ('OLD_USUARIO', 'VARCHAR(31)', False),
        ('TIPO_ATENDIMENTO', 'CHAR(1)', True), ('BUSCA_PACIENTES', 'SMALLINT', True),
        ('ID_TBUNIDAD', 'SMALLINT', True), ('ID_TBTIPOACOMOD', 'SMALLINT', True),
        ('ID_RIBLOCOS', 'VARCHAR(5)', False), ('TODOS_PACIENTES', 'CHAR(1)', False),
        ('ATUALIZAR_CRM_ATEND_PEXT', 'CHAR(1)', False), ('EXIBIR_SOMENTE_AGENDA_MEDICA', 'CHAR(1)', False),
        ('ID_TBACOMODLEITO', 'SMALLINT', False), ('ANAMNESE_ABRIR_AUTOM_ATEND_PA', 'CHAR(1)', False),
        ('PRESC_MED_ABRIR_AUTOM_ATEND_PA', 'CHAR(1)', False), ('SOL_EXAME_ABRIR_AUTOM_ATEND_PA', 'CHAR(1)', False),
        ('EVOLUCAO_ABRIR_AUTOM_ATEND_PA', 'CHAR(1)', False), ('REC_MED_ABRIR_AUTOM_ATEND_PA', 'CHAR(1)', False),
        ('ATEST_MED_ABRIR_AUTOM_ATEND_PA', 'CHAR(1)', False), ('ATEND_APENAS_PAC_PROF_LOG_CRM', 'CHAR(1)', False),
        ('EXIBIR_RESUMO_AUT_LOC_PAC', 'CHAR(1)', False), ('LOCALIZA_PACIENTE_CODIGO_BARRAS', 'CHAR(1)', True),
        ('ORDENAR_PAC_COM_CHAMADA_PAINEL', 'SMALLINT', True), ('DESFAZER_ACAO_OUTRO_USUARIO', 'CHAR(1)', False),
        ('ID_TBESPEC', 'SMALLINT', False), ('PACIENTE_LEITO_OBSERVACAO', 'CHAR(1)', False),]),
    'PRPROTGERALESP': ('ID_PROTGERAL,ESPEC', [
        ('ID_PROTGERAL', 'INTEGER', True), ('ESPEC', 'SMALLINT', True),]),
    'PREVOLUCAO': ('ID_EVOLUCAO', [
        ('ID_EVOLUCAO', 'INTEGER', True), ('COD', 'VARCHAR(10)', False), ('DESCRICAO', 'VARCHAR(100)', False),
        ('OLD_TIPOCOMP', 'SMALLINT', False), ('CODCAB', 'SMALLINT', False), ('FASE', 'SMALLINT', False),
        ('TP_ATENDIMENTO', 'SMALLINT', False), ('ID_PRTPCOMP', 'SMALLINT', False), ('ID_TBEDITREL', 'INTEGER', False),
        ('LAYOUT_VISUALIZACAO_IMPRESSAO', 'CHAR(1)', False), ('HIST_CLINICO_ABA', 'INTEGER', False),
        ('HIST_CLINICO_PERIODO', 'INTEGER', False), ('HIST_CLINICO_TIPOATENDIMENTO', 'INTEGER', False),
        ('HIST_CLINICO_HISTORICO', 'INTEGER', False),]),
    'PREVOLESPEC': ('ID_EVOLUCAO,ESPEC', [
        ('ID_EVOLUCAO', 'INTEGER', True), ('ESPEC', 'SMALLINT', True),]),
    'PREVOLTIPOACO': ('ID_EVOLUCAO,COD', [
        ('ID_EVOLUCAO', 'INTEGER', True), ('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(30)', False),]),
    'PRPADEVOL': ('ID', [
        ('ID', 'INTEGER', True), ('ID_EVOLUCAO', 'INTEGER', True), ('ID_PRPERGUNTA', 'INTEGER', True),
        ('ORDEM', 'VARCHAR(15)', True), ('CAMPOOBRIG', 'VARCHAR(1)', False), ('VISAUTO', 'VARCHAR(1)', False),
        ('FONTE', 'BLOB SUB_TYPE 1', False), ('ESPACODUPLO', 'VARCHAR(1)', False), ('ATIVO', 'CHAR(1)', False),
        ('EXIBIR_HISTORICO_PERGUNTA', 'CHAR(1)', False), ('EXIBIR_TODOS_PROFISSIONAIS', 'CHAR(1)', False),]),
    'PRFORMULCOMP': ('ID', [
        ('ID', 'INTEGER', True), ('ID_PRPADEVOL', 'INTEGER', True), ('NOME_CLASSE', 'VARCHAR(30)', True),
        ('NOME_COMPONENTE_PAI', 'VARCHAR(30)', True), ('COMPONENTE', 'BLOB SUB_TYPE 1', False),
        ('ORDEM_CRIACAO', 'SMALLINT', False),]),
    'PRMANCHESTER': ('ID', [
        ('ID', 'SMALLINT', True), ('COD_PROTOCOLO', 'SMALLINT', True), ('CLASSIFICACAO', 'VARCHAR(20)', False),
        ('COR', 'VARCHAR(20)', False), ('ID_PRPADEVOL', 'INTEGER', False), ('ID_PRRESPOSTA', 'INTEGER', False),
        ('ID_PRPADEVOL_PROT_OBSTETRICIA', 'INTEGER', False),]),
    'PRPARAM': ('', [
        ('MAT', 'SMALLINT', False), ('MED', 'SMALLINT', False), ('DILUENTE', 'SMALLINT', False),
        ('SOLUCAO', 'SMALLINT', False), ('UNI_CON_ML', 'VARCHAR(7)', False), ('UNI_CON_GOTAS', 'VARCHAR(7)', False),
        ('PROTSEQ', 'VARCHAR(1)', False), ('VIS_PREVISTO', 'VARCHAR(4)', False), ('CATETER', 'VARCHAR(1)', False),
        ('CHECKLAB', 'VARCHAR(1)', False), ('REFCOMERCIAL', 'VARCHAR(1)', False), ('REQESTOQUE', 'VARCHAR(1)', False),
        ('MOTFALTA', 'VARCHAR(1)', False), ('CHECKENF', 'VARCHAR(1)', False), ('PRESC_ANT', 'SMALLINT', False),
        ('REFDILUENTE', 'VARCHAR(1)', False), ('PERCJUST', 'SMALLINT', False), ('VISUALMAT', 'VARCHAR(1)', False),
        ('ID_EVOLFICADM', 'INTEGER', False), ('VIAVENOSA', 'VARCHAR(2)', False), ('IMPMAT', 'VARCHAR(1)', False),
        ('OLD_CABRECEITA', 'SMALLINT', False), ('FATORBLEND', 'SMALLINT', False), ('IMPQTDE', 'VARCHAR(1)', False),
        ('IMPDATAS', 'VARCHAR(1)', False), ('IMPEVOLENF', 'VARCHAR(1)', False), ('IMPBOMBA', 'VARCHAR(1)', False),
        ('IMPREQ', 'VARCHAR(1)', False), ('CHKMEMNAO', 'VARCHAR(1)', False), ('IMPDESCPROT', 'VARCHAR(1)', False),
        ('ESPPSIC', 'SMALLINT', False), ('INCD', 'VARCHAR(1)', False), ('CHECKMAT', 'VARCHAR(1)', False),
        ('PRESCMEDURG', 'VARCHAR(1)', False), ('INFCONTA', 'VARCHAR(1)', False), ('VALIDFARM', 'VARCHAR(1)', False),
        ('CORRPRESCVALID', 'VARCHAR(1)', False), ('IMPRELMED', 'VARCHAR(1)', False),
        ('PERMPERCACIMA', 'VARCHAR(1)', False), ('INCITENSPRESC', 'VARCHAR(1)', False), ('CHECKPEND', 'DATE', False),
        ('CHKINTERVALO', 'VARCHAR(1)', False), ('REQSENEC', 'VARCHAR(1)', False), ('REQACM', 'VARCHAR(1)', False),
        ('CHECARDOSE24HS', 'VARCHAR(1)', False), ('CHKINTERVDOSE', 'VARCHAR(1)', False),
        ('ITEMNAOPAD', 'INTEGER', True), ('MINTRILHA', 'VARCHAR(1)', False), ('IMPMEDRODPRESC', 'SMALLINT', False),
        ('CONSHRTOL', 'VARCHAR(4)', False), ('IMPEMITIDOEM', 'SMALLINT', False),
        ('OLD_GERARREQEST', 'SMALLINT', False), ('LANCARKIT', 'VARCHAR(1)', False), ('IMPREG', 'VARCHAR(1)', False),
        ('IMPDOSETOTAL', 'VARCHAR(1)', False), ('CABHISTORICO', 'SMALLINT', False),
        ('OLD_GERARAUTORMANIPUL', 'SMALLINT', False), ('SOLSENHAALTPLAN', 'VARCHAR(1)', False),
        ('SENHAALTPLAN', 'VARCHAR(15)', False), ('ALERTARPLANPEND', 'VARCHAR(1)', False),
        ('VERIFFATORCONV', 'VARCHAR(1)', False), ('IMPPRESCPOR', 'SMALLINT', False),
        ('ALERTARPLANPENDQDIAS', 'SMALLINT', False), ('OLD_ID_REPORTSLAUDO', 'INTEGER', False),
        ('ID_EVOLLAUDOINT', 'INTEGER', False), ('RECVIAACESSOITEM', 'VARCHAR(1)', False),
        ('OLD_VELOCIDADEOBR', 'VARCHAR(1)', False), ('IMPQTDEPADRAO', 'VARCHAR(1)', False),
        ('VALIDARPERVIGENCIA', 'VARCHAR(1)', False), ('ID_EVOLANTIMI', 'INTEGER', False),
        ('OLD_ID_REPORTSANTIMI', 'INTEGER', False), ('INSTREGPROSUS', 'VARCHAR(200)', False),
        ('OLD_IMPREFBIBL', 'VARCHAR(1)', False), ('VALIDARANTIMICRO', 'VARCHAR(1)', False),
        ('OLD_ID_REPORTSSOLEXAME', 'INTEGER', False), ('IMPRELSOLEXAMECONV', 'VARCHAR(1)', False),
        ('PROCEDGLICEMIA', 'INTEGER', True), ('QTDEPROFENF', 'SMALLINT', False),
        ('LCARCOMPPEDIDOANTIMI', 'SMALLINT', False), ('OLD_ID_REPORTSSOLEXAMESEG', 'INTEGER', False),
        ('OLD_ID_REPORTSSUMARIO', 'INTEGER', False), ('VIAORAL', 'VARCHAR(2)', False),
        ('VISUAL_IMP_NOMECOMERCIAL', 'CHAR(1)', False), ('INCLUIR_KIT_MATERIAIS', 'CHAR(1)', False),
        ('IMPRIMIR_NUM_DOSES_PRESC_GERAL', 'CHAR(1)', False), ('INCLUIR_KIT_LANC_PRESC_MEDICA', 'CHAR(1)', False),
        ('IMPRIMIR_PRESC_FRENTE_VERSO', 'CHAR(1)', False), ('CHECAR_SOMENTE_ITENS_CONSOL', 'CHAR(1)', False),
        ('OLD_INTEGRAR_DISPENSACAO_HORARI', 'CHAR(1)', False), ('OLD_GERAR_REQ_ESTOQUE_ONCOLOGIA', 'SMALLINT', False),
        ('GERAR_DOC_DEVOLUCAO_ESTOQUE', 'CHAR(1)', False), ('ID_TBCENCUS', 'INTEGER', True),
        ('LIBERAR_PAC_INTEGRADO_PAINEL', 'CHAR(1)', False), ('LOGOTIPO', 'BLOB SUB_TYPE 0', False),
        ('HORA_INICIO_VIS_IMP_DADOS_MONI', 'TIMESTAMP', False), ('ASSINAR_DIGITALMENTE', 'CHAR(1)', False),
        ('GERAR_FOLHA_SALA', 'CHAR(1)', False), ('ID_GETABVIA_EV_CENTRAL', 'VARCHAR(2)', False),
        ('ID_GETABVIA_EV_PERIFERICO', 'VARCHAR(2)', False), ('ID_GETABVIA_HIPODERMOCLISE', 'VARCHAR(2)', False),
        ('INTEGRAR_GED_POR', 'SMALLINT', False), ('MARCADO_INI_ADM_AGORA_PRESCSOL', 'CHAR(1)', False),
        ('VISUAL_PAINEL_ATD_GERADO_SADT', 'CHAR(1)', False), ('EXEC_EVOLUCAOFIXRESPHORA_TMP', 'CHAR(1)', False),
        ('ID_PRLAYIMPPRESC', 'SMALLINT', False), ('EMITIR_HOR_PRE_CAD_HOR_REL', 'CHAR(1)', False),
        ('SUPRIMIR_ITENS_MANIP_MAT_UTIL', 'CHAR(1)', False), ('URL_WEBSERVICE_INTEG_LAB', 'VARCHAR(150)', False),
        ('CONSISTIR_ITEM_PRESC_DUPLICADO', 'CHAR(1)', False), ('VALIDAR_LANC_IND_PROG_PRESC', 'SMALLINT', False),
        ('IMPRIMIR_REF_BIBLIOGRAFICA', 'SMALLINT', False), ('ID_PREVOLUCAO_ITEM_NAO_PADRON', 'INTEGER', False),
        ('IMPRIMIR_CABEC_PRESC_GERAL_MED', 'SMALLINT', False), ('CALCULAR_VELOCIDADE_INFUSAO', 'SMALLINT', False),
        ('IMPRIMIR_COD_REGIONAL_PRESC', 'CHAR(1)', False), ('IMPRIMIR_DIG_CONSELHO_PRESC', 'CHAR(1)', False),
        ('ID_PREVOLUCAO_INTERCORRENCIA', 'INTEGER', False), ('NOTIF_RESP_COMP_INTERCORRENCIA', 'SMALLINT', False),
        ('DATA_IMPRESSA_PRESC_ONCO_GERAL', 'SMALLINT', False), ('IMPRIMIR_PRESC_AGRUP_ATEND_PSIQ', 'CHAR(1)', False),
        ('DEFAULT_PAR_PAC_REAL_EXAME_FORA', 'CHAR(1)', False), ('INCLUIR_COL_DATA_IMP_PRESC', 'CHAR(1)', False),
        ('AGRUPAR_ITEM_TP_LANC_IMP_PRESC', 'CHAR(1)', False), ('IMPRIMIR_NOME_CIDADE_PRESC_ONC', 'SMALLINT', False),
        ('EXIBIR_COLUNA_ESPERA_GER_SENHA', 'CHAR(1)', False), ('EXIBIR_COLUNA_ESPERA_GER_ATEND', 'CHAR(1)', False),
        ('EXIBIR_COLUNA_ESPERA_LOC_ATEND', 'CHAR(1)', False), ('EXIBIR_COLUNA_ESPERA_ULT_MOVIM', 'CHAR(1)', False),
        ('IMPRIMIR_ZEBRADO_PRESC_GERAL', 'CHAR(1)', False), ('TIPO_LANC_ANTIMICROBIANO', 'SMALLINT', False),
        ('DIGITAR_INF_COMP_DADOS_CLI_OBR', 'CHAR(1)', False), ('MIGRADO_PROTOCOLO_ONCOLOGICO', 'SMALLINT', False),
        ('PERMITIR_REG_CONSENT_LANC_PRONT', 'CHAR(1)', False), ('EXIBIR_FREQ_REL_PRESC_ANTIMI', 'CHAR(1)', False),
        ('ID_PRPARTAMPADPRESC', 'SMALLINT', True), ('COD_PRFICHAREL_CAB_OFTALMOLOGIA', 'SMALLINT', False),
        ('ID_TBCLASSI_ALIMENTO', 'SMALLINT', False), ('INTEGRACAO_LAB_WS', 'SMALLINT', False),
        ('CONTROLA_TELA_AUX_LOCALIZA_PAC', 'CHAR(1)', True), ('PERMITE_OBS_MEDICA_MAIS250', 'CHAR(1)', False),
        ('CRIA_DOC_SEPARADO_ITEM_CONSIG', 'CHAR(1)', False), ('ID_PRTPREQUISICAO', 'SMALLINT', False),
        ('QTD_PAG_PADRAO_IMPR_PRESCRICAO', 'SMALLINT', False), ('EXIBIR_PROT_SOL_ITEM_NAO_PAD', 'CHAR(1)', False),
        ('VISUALIZAR_NOME_KIT_PRESCRICAO', 'CHAR(1)', False), ('IMPRIMIR_HORARIOS', 'CHAR(1)', False),
        ('MODELO_PRESCRICAO_GERAL', 'SMALLINT', False), ('SEPARAR_BATERIA_HIST_SOL_EXAME', 'CHAR(1)', False),
        ('EXTENDEDDUPLEX', 'SMALLINT', False), ('CONTEUDO_EMAIL_DOC_ASSINADO', 'BLOB SUB_TYPE 0', False),
        ('HABILITA_ASSINATURA_DIGITAL', 'CHAR(1)', False), ('TEMPO_EXIBICAO_ASSINATURA_PEND', 'VARCHAR(3)', False),
        ('RECEITA_PSICOTROPICO_PADRAO', 'CHAR(1)', False), ('SOLICITAR_JUSTIF_EXPORT_SRES', 'CHAR(1)', False),
        ('ENVIO_BATERIA_AGRUPADO', 'CHAR(1)', False), ('COD_PRFICHAREL_SOL_EXAME', 'INTEGER', False),
        ('TOLERANCIA_LANC_ATRASADO_SV', 'TIME', False), ('TOLERANCIA_LANC_TEMPORARIO', 'TIME', False),
        ('ACESSOLEGADO', 'VARCHAR(31)', False), ('EXIBIR_PARAMETROS_IMPRESSAO', 'VARCHAR(1)', False),
        ('MANTER_LANCAMENTO_MESMA_PAGINA', 'VARCHAR(1)', False), ('CONSIDERAR_PRESCRICAO_IMPRESSA', 'SMALLINT', True),
        ('URL_LOGOTIPO_NEXODATA', 'VARCHAR(200)', False), ('TIPO_ATESTADO_REQUERIMENTO', 'SMALLINT', True),
        ('TIPO_RECEITA', 'SMALLINT', True), ('NEXODATA_PROD', 'VARCHAR(1)', True),
        ('EXTENDEDDUPLEX_PRESCRICAO_GERAL', 'SMALLINT', False), ('VALIDACAO_APOS_CONFIRMAR_DOC', 'CHAR(1)', True),
        ('CONTROLAR_LOCAIS_POR_USUARIO', 'CHAR(1)', False), ('ASS_PEND_SEM_MSG_INIC_PEP', 'CHAR(1)', True),
        ('ID_PRCAB_IDENTIFIC_PAC', 'SMALLINT', True), ('ID_PRVALIDARMEDDUPLICPRESC', 'SMALLINT', True),
        ('VALIDARLANCTODUPLICADOPRESC', 'CHAR(1)', False), ('ID_PRTIPONOTIFICACAO_NT_MM_PA', 'INTEGER', False),
        ('ID_PRTIPONOTIFICACAO_NT_CT_PA', 'INTEGER', False), ('ID_PRTIPONOTIFICACAOSEXODIAG', 'INTEGER', False),
        ('ID_PRTIPONOTIFICACAOSEXOPROCED', 'INTEGER', False), ('IMPRIMIR_ASSINATURA_PRESC_ONCO', 'CHAR(1)', True),
        ('IMPRIMIR_ASSINATURA_PRESC_GERAL', 'CHAR(1)', False), ('EXPORTAR_ARQUIVOS_COM_SENHA', 'VARCHAR(1)', False),
        ('CHECAR_SOMENTE_ITENS_ASSINADOS', 'CHAR(1)', False), ('ALERTAR_PREVISAO_ALTA', 'CHAR(1)', False),
        ('ENVIAR_AVAL_FARM_ITEM_FVP', 'CHAR(1)', False), ('REALIZAR_APRAZAMENTO_ENFERMAGEM', 'SMALLINT', False),
        ('EMITIR_THM_DTH', 'SMALLINT', False), ('USAR_SERVICO_ARMAZEN_ARQUIVOS', 'CHAR(1)', False),
        ('OBRIGAR_DIG_LAUDO_AIH_APOS_48H', 'SMALLINT', False), ('VER_ELE_EXA_REP', 'SMALLINT', True),
        ('ID_PREVOLUCAO_RAC', 'INTEGER', False), ('REST_ACESS_PACI_NAO_ESTE_ATEND', 'VARCHAR(1)', True),
        ('CHECAGEM_ANTECIPADA', 'TIME', False), ('CONSISTIR_FREQ_UNICA_MEDIC', 'CHAR(1)', False),]),
    'PRASSINATURA_CAB': ('ID', [
        ('ID', 'INTEGER', True), ('ID_PRTPASSINATURA', 'SMALLINT', True), ('ID_TABELA', 'BIGINT', True),
        ('ID_HTPACIENTE', 'BIGINT', True), ('ID_HTATENDIMENTO', 'BIGINT', False),
        ('DOCUMENTO_CONSOLIDADO', 'BLOB SUB_TYPE 1', False),]),
    'PRPAREVOLIMG': ('ID', [
        ('ID', 'INTEGER', True), ('NOME', 'VARCHAR(50)', True), ('ATIVO', 'CHAR(1)', False),
        ('IMAGEM', 'BLOB SUB_TYPE 0', True), ('ANOTACOES', 'BLOB SUB_TYPE 1', False),
        ('ID_PREVOLUCAO', 'INTEGER', True),]),
}

CARREGADAS = ("PRLOCAL_ASSISTENCIA", "TBCBARAREACAOADVERSA", "PRPROTGERALESP", "PREVOLUCAO", "PREVOLESPEC",
              "PREVOLTIPOACO", "PRITEMNAOPAD", "PRITEMNAOPAD_GETABVIA", "PRKITMED", "PRITENSKITMED", "PRKITSOLITENS",
              "TBKITPRO", "PRFAVORITO", "PRMANCHESTER")
COLUNAS = {t: cols for t, (_, cols) in FORMAS.items()}


def _definida_fora(tabela):
    """Tabela já definida por outra fatia da imagem (ex.: PRPADEVOL, pai lido pela L6-10): a forma não é repetida."""
    import pathlib
    aqui = pathlib.Path(__file__).resolve()
    return any(p.resolve() != aqui and ("CREATE TABLE %s (" % tabela) in p.read_text(encoding="utf-8")
               for p in aqui.parent.glob("*.py"))


SO_FORMA = [t for t in FORMAS if t not in CARREGADAS and not _definida_fora(t)]


def _ddl():
    saida = []
    for t, (chave, cols) in FORMAS.items():
        if t not in CARREGADAS and t not in SO_FORMA:
            continue
        defs = ["%s %s%s" % (c, tp, " NOT NULL" if nn else "") for c, tp, nn in cols]
        if chave:
            defs.append("PRIMARY KEY (%s)" % chave)
        saida.append("CREATE TABLE %s (%s);" % (t, ", ".join(defs)))
    return "\n".join(saida) + "\n"


DDL = _ddl() + "\n".join(_PAI_DDL.values()) + "\n"
# pais de fora da fatia, dados como já carregados (chave da origem): tipo de documento clínico, especialidade médica,
# categoria de acomodação e protocolo de prescrição
PAIS_EXTERNOS = {"PRTPCOMP": ["1", "2"], "TBESPEC": ["1", "2", "3"], "TBTIPOACOMOD": ["1", "2"],
                 "PRPROTGERAL": ["10", "11"], "TBACOMODLEITO": ["1", "2"],
                 "PRKITSOL": ["1", "2", "4"], "PRTPLAN": ["1", "2", "3"], "TBSEXO": ["1", "2"],
                 "TBUSERS": list(_l6_05.PAIS_EXTERNOS["TBUSERS"])}
# donas dos pais lidos na origem (referência por chave alternativa e encadeada); dados delas usados abaixo:
# TBUNIDADEMEDIDA sigla MG (1), ML (2), UI (4) carregadas, X (3) recusada; GEITENS 101-106, 111, 112 carregados, 107
# sem nome, 108 pai_pendente; GEUNIPRESC 1 (101, ML) e 2 (101, CX); TBPROENF 1 e 5 carregados, 4 sem nome (recusado);
# PRKITSOL 1, 2, 4, 5, 6 carregados, 3 recusado; PRLOCPACDEFAULT 10 e 20 com login conhecido, 30 com login nunca visto;
# PRTPLAN 1-3 e GETABVIA VO, EV, IV como pais externos das requeridas
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL);\nINSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');")


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
    if tipo == "TIME":  # o gerador (sintetica._q) não escreve TIME: fica nulo (colunas opcionais)
        return None
    return ("texto exemplo " + str(i)).encode("cp1252")


def _ins(ins, tab, **v):
    ins(tab, [v.get(c) for c, _, _ in COLUNAS[tab]])


def linhas(r, ins):
    for v in _l6_05.PREFERENCIAS:
        ins("PRLOCPACDEFAULT", list(v))
    for v in UNIDADES:
        ins("TBUNIDADEMEDIDA", list(v))
    for v in CUIDADOS:
        ins("TBPROENF", list(v))
    for tab in SO_FORMA:
        cols = COLUNAS[tab]
        if True:
            for i in (1, 2):
                ins(tab, [_falso(tp, i) for _, tp, _ in cols])
    # local de assistência: 3 sem descrição (1048); 4 com descrição acima de 150 (1406); 5 com situação fora do
    # domínio (fica com o padrão do destino: ativo); 6 com espaços internos preservados e tipo vazio (padrão: todos);
    # 7 com letra de tipo sem par (padrão todos, valor_fora_do_dominio); tipo pela letra nos demais
    for i, desc, sit, tp in [(1, "Leito 101 clínica exemplo", "A", "I"), (2, "Sala de observação exemplo", "I", "E"),
                             (3, None, "A", "I"), (4, "Local exemplo " * 12, "A", "A"), (5, "Posto exemplo", "X", "U"),
                             (6, "  Box   3 exemplo ", "A", " "), (7, "Consultório exemplo", "A", "Z")]:
        _ins(ins, "PRLOCAL_ASSISTENCIA", ID=i, TIPO_ATENDIMENTO=tp, LOCAL_ASSISTENCIA=desc, SITUACAO=sit)
    # manifestação alérgica: 3 e 4 só diferem pela caixa do código (as duas recusadas, nenhuma vence); 6 com código
    # acima de 30 (1406); 7 com indicador de ativo fora do domínio (fica com o padrão do destino)
    for i, cod, nome, atv in [(1, "RX001", "Urticária exemplo", "S"), (2, "RX002", "Prurido exemplo", "N"),
                              (3, "ab12", "Reação exemplo a", "S"), (4, "AB12", "Reação exemplo b", "S"),
                              (5, "RX005", "  Edema   de glote exemplo ", "S"), (6, "RX" + "9" * 38, "Longo", "S"),
                              (7, "RX007", "Náusea exemplo", "X")]:
        _ins(ins, "TBCBARAREACAOADVERSA", ID=i, CODIGO=cod, NOME=nome, DESCRICAO="Descrição falsa %d\nlinha 2" % i,
             SINONIMO_1="sinônimo %d" % i, SINONIMO_2="outro %d" % i, ATIVO=atv)
    # especialidade do protocolo: protocolo 12 e especialidade 8 inexistentes (NULL em NOT NULL: recusa)
    for prot, esp in [(10, 1), (10, 2), (11, 1), (12, 1), (11, 8)]:
        _ins(ins, "PRPROTGERALESP", ID_PROTGERAL=prot, ESPEC=esp)
    # modelos: 3 sem descrição (1048); 4 com tipo de documento inexistente (pai_inexistente + 1048); 5 com quebra de
    # linha e espaços internos (texto só apara as pontas); todos com o tipo de registro presumido (valor_presumido)
    for i, desc, tp in [(1, "Evolução médica exemplo", 1), (2, "Anamnese exemplo", 2), (3, None, 1),
                        (4, "Modelo órfão exemplo", 9), (5, "  Evolução   diária\r\nexemplo ", 1),
                        (6, "Admissão exemplo", 2)]:
        _ins(ins, "PREVOLUCAO", ID_EVOLUCAO=i, COD="M%d" % i, DESCRICAO=desc, ID_PRTPCOMP=tp)
    # especialidade do modelo: modelo 3 recusado (pai_pendente); especialidade 7 inexistente
    for mod, esp in [(1, 1), (1, 2), (2, 1), (5, 3), (6, 1), (3, 1), (6, 7)]:
        _ins(ins, "PREVOLESPEC", ID_EVOLUCAO=mod, ESPEC=esp)
    # acomodação do modelo: modelo 4 recusado (pai_pendente); categoria 0 (vazia: NULL em NOT NULL)
    for mod, cat in [(1, 1), (1, 2), (4, 1), (5, 2), (6, 0)]:
        _ins(ins, "PREVOLTIPOACO", ID_EVOLUCAO=mod, COD=cat, NOME="Categoria exemplo %d" % cat)
    D = decimal.Decimal
    # item não padronizado: 1 e 2 completos (espaços internos colapsados no 2); 3 sem nome (1048); 4 unidade sem sigla
    # correspondente (pai_inexistente + 1048); 5 tipo de item nunca visto (pai_inexistente + 1048); 6 produto nunca
    # visto (NULL, grava); 7 produto recusado na L7-07 (pai_pendente)
    for i, nome, uni, tp, item in [(1, "Item não padronizado um", "MG", 1, 101), (2, "  Item   dois ", "ML", 2, None),
                                   (3, None, "MG", 1, None), (4, "Item quatro", "CX", 1, None),
                                   (5, "Item cinco", "MG", 9, None), (6, "Item seis", "UI", 3, 999),
                                   (7, "Item sete", "MG", 1, 108)]:
        _ins(ins, "PRITEMNAOPAD", ID_ITEMNAOPAD=i, NOME=nome, UNI_PRESC=uni, SITUACAO="A", ITEM=item,
             USUARIO_CAD="usuario.exemplo", ID_PRTPLAN=tp)
    # vias do item: 3 recusado (pai_pendente); via nunca vista e item nunca visto (pai_inexistente + 1048)
    for it, via in [(1, "VO"), (1, "IV"), (2, "IV"), (3, "VO"), (6, "ZZ"), (99, "VO")]:
        _ins(ins, "PRITEMNAOPAD_GETABVIA", ID_PRITEMNAOPAD=it, ID_GETABVIA=via)
    # kit do medicamento: nome = nome do item na origem; 3 item sem nome (1048); 4 item nunca visto (pai_inexistente +
    # 1048); 5 intervalo invertido (4025); 6 unidade sem correspondência (NULL) e tipo de atendimento fora do domínio
    for k, item, ini, fim, uni, via, tp, atv in [(1, 101, "1", "2", "MG", "VO", "I", "S"),
                                                 (2, 102, "0.5", "1", "ML", "IV", "A", "N"),
                                                 (3, 107, "1", "2", "MG", "VO", "T", "S"),
                                                 (4, 999, "1", "2", "MG", "VO", "T", "S"),
                                                 (5, 103, "3", "1", "MG", "VO", "U", "S"),
                                                 (6, 104, "1", "2", "ZZ", "VO", "X", "S")]:
        _ins(ins, "PRKITMED", ID=k, ID_GEITENS=item, INTERVALO_INICIAL_DOSE=D(ini), INTERVALO_FINAL_DOSE=D(fim),
             ID_TBUNICON_UNI_PRESC=uni, ID_GETABVIA=via, TP_ATENDIMENTO=tp, ATIVO=atv)
    # itens do kit do medicamento: quantidade zero (4025); unidade sem correspondência (pai_inexistente + 1048); kit 3
    # recusado (pai_pendente); produto nunca visto (NULL: CHECK do produto, 4025)
    for k, item, q, uni in [(1, 101, "2", "MG"), (1, 102, "1", "ML"), (2, 103, "0", "MG"), (2, 104, "1", "CX"),
                            (3, 101, "1", "MG"), (6, 101, "1.5", "MG"), (6, 999, "1", "ML")]:
        _ins(ins, "PRITENSKITMED", ID_PRKITMED=k, ID_GEITENS=item, QTDE=D(q), ID_TBUNICON_UNI_PRESC=uni)
    # itens do kit de solução: 2 com indicador fora do domínio (padrão componente); kit 3 recusado (pai_pendente); kit
    # 3 e 9 nunca vistos (pai_inexistente + 1048)
    for k, item, pr, q, uni in [(1, 101, 1, "1", "ML"), (1, 102, 0, "2", "MG"), (2, 103, 2, "1", "MG"),
                                (3, 101, 1, "1", "ML"), (4, 101, 0, "1", "UI"), (9, 101, 0, "1", "ML")]:
        _ins(ins, "PRKITSOLITENS", ID_PRKITSOL=k, ID_GEITENS=item, ITEM_PRINCIPAL=pr, QTDE=D(q),
             ID_TBUNICON_UNI_PRESC=uni)
    # kit de cuidado (um por linha; kit e item gravam juntos ou nenhum): 3 cuidado recusado (pai_pendente); 4 unidade
    # do insumo sem correspondência (pai_inexistente + 1048); 5 sem quantidade (1048); 6 intervalo invertido (4025)
    for i, proc, q, ini, fim, acm, gu, via in [(1, 1, "2", 0, 6, "N", 1, "VO"), (2, 5, "1", 2, None, "S", 1, None),
                                               (3, 4, "1", 0, None, "N", 1, "VO"), (4, 1, "1", 0, None, "N", 2, "VO"),
                                               (5, 1, None, 0, None, "N", 1, "VO"), (6, 1, "1", 8, 4, "N", 1, "VO")]:
        _ins(ins, "TBKITPRO", ID=i, PROCTO=proc, QTDE=D(q) if q else None, INTERVALO_INICIAL=ini,
             INTERVALO_FINAL=fim, ACM=acm, ID_GEUNIPRESC=gu, ID_GETABVIA=via)
    # favorito do painel: nome e tipo pela letra; 30 login nunca visto (1048); 99 preferência nunca vista
    # (pai_inexistente + 1048); Z fora do domínio (tipo fica todos; nome NULL: 1048); X no indicador (padrão)
    for pref, tp, apenas, acom in [(10, "I", "S", 1), (10, "A", "N", None), (20, "U", "X", 2), (30, "I", "S", None),
                                   (99, "I", "S", None), (20, "Z", "N", None)]:
        _ins(ins, "PRFAVORITO", ID_PRLOCPACDEFAULT=pref, TIPO_ATENDIMENTO=tp, BUSCA_PACIENTES=1, ID_TBUNIDAD=1,
             ID_TBTIPOACOMOD=1, ID_TBACOMODLEITO=acom, ATEND_APENAS_PAC_PROF_LOG_CRM=apenas,
             EXIBIR_SOMENTE_AGENDA_MEDICA="N", PACIENTE_LEITO_OBSERVACAO="S", ORDENAR_PAC_COM_CHAMADA_PAINEL=1,
             LOCALIZA_PACIENTE_CODIGO_BARRAS="N", EXIBIR_RESUMO_AUT_LOC_PAC="S", ID_TBESPEC=1)
    # nível de prioridade: cor pela constante de cor da origem (nome ou $00BBGGRR); ordem clínica pela cor, nunca pelo
    # ID (IDs fora da ordem das cores); número do nível vira a sigla; 4 sem classificação (1048); 5 cor sem par (NULL
    # no nome, no hexadecimal e na ordem: valor_fora_do_dominio em cada um; hexadecimal NOT NULL: 1048); 9 número do nível com 6 posições
    # (1406); 10 segunda cor vermelha no mesmo contexto (ordem repetida: 1062)
    for i, prot, cl, cor in [(1, 3, "Urgente", "clYellow"), (2, 1, "Emergência", "clRed"),
                             (3, 2, "Muito urgente", "$000080FF"), (4, 4, None, "clGreen"),
                             (5, 9, "Não urgente", "Roxo"), (6, 5, "Não urgente", "clBlue"),
                             (7, 6, "Sem classificação", "clBlack"), (8, 7, "Eletivo exemplo", "clWhite"),
                             (9, -32000, "Pouco urgente", "clLime"), (10, 1, "Emergência dois", "clRed")]:
        _ins(ins, "PRMANCHESTER", ID=i, COD_PROTOCOLO=prot, CLASSIFICACAO=cl, COR=cor)
    return {
        "PRLOCAL_ASSISTENCIA": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1406": 1,
                                                             "valor_fora_do_dominio": 2}},
        "TBCBARAREACAOADVERSA": {"gravados": 4, "pendencias": {"codigo_colisao_caixa": 2, "restricao_destino_1406": 1,
                                                              "valor_fora_do_dominio": 1}},
        "PRPROTGERALESP": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 2}},
        "PREVOLUCAO": {"gravados": 4, "pendencias": {"valor_presumido": 6, "pai_inexistente": 1,
                                                    "restricao_destino_1048": 2}},
        "PREVOLESPEC": {"gravados": 5, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                     "restricao_destino_1048": 1}},
        "PREVOLTIPOACO": {"gravados": 3, "pendencias": {"pai_pendente": 1, "restricao_destino_1048": 1}},
        "PRITEMNAOPAD": {"gravados": 3, "pendencias": {"pai_inexistente": 3, "pai_pendente": 1, "restricao_destino_1048": 3, "valor_presumido": 6}},
        "PRITEMNAOPAD_GETABVIA": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "pai_pendente": 1, "restricao_destino_1048": 2}},
        "PRKITMED": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 2, "restricao_destino_4025": 1, "valor_fora_do_dominio": 1}},
        "PRITENSKITMED": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "pai_pendente": 1, "restricao_destino_1048": 1, "restricao_destino_4025": 2}},
        "PRKITSOLITENS": {"gravados": 4, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 2, "valor_fora_do_dominio": 1}},
        "TBKITPRO": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "pai_pendente": 1, "restricao_destino_1048": 2, "restricao_destino_4025": 1}},
        "PRFAVORITO": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 3, "valor_fora_do_dominio": 3}},
        "PRMANCHESTER": {"gravados": 6, "pendencias": {"restricao_destino_1048": 2, "restricao_destino_1406": 1,
                                                      "restricao_destino_1062": 1, "valor_fora_do_dominio": 3}},
    }
