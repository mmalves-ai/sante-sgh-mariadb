"""Fatia L6-11 (prontuário, assinatura e assistência, módulo PEP): tabelas da origem com a forma do dicionário e dados
100% falsos.

Carregadas pelo mapa (colunas.d/L6-11.tsv, pares em valores.d/L6-11.tsv): PRLOCAL_ASSISTENCIA, TBCBARAREACAOADVERSA,
PRPROTGERALESP, PREVOLUCAO, PREVOLESPEC, PREVOLTIPOACO, PRITEMNAOPAD (item não padronizado), PRITEMNAOPAD_GETABVIA,
PRKITMED (kit do medicamento), PRITENSKITMED e PRKITSOLITENS (itens de kit), TBKITPRO (kit de cuidado de enfermagem e
item), PRFAVORITO (filtro do painel do usuário), PRMANCHESTER (nível de prioridade) e, na rodada 3, PRITEM_GEITENS
(parâmetro clínico e item prescritível adotado pelo insumo), PRITEMNAOPAD_TBPRINC e TBALERGIA_TBPRINC (princípio
ativo oficial pelo código DCB no catálogo do destino), PRPADEVOL, PRFORMULCOMP e PRRESPOSTA (campo, leiaute e opção da
versão atual do modelo, que PREVOLUCAO grava como destino secundário) e PRASSINATURA_CAB (documento do prontuário pelo
evento de assinatura). Rodada 5 (ADR 0006): PRAGRUP_PRFILTROCLASSIF e PRPARAM carregam na trilha (retrato sem segredo; logotipo no arquivo).
Revisão da rodada 3: PRASSINATURA_CAB, PRRESPOSTA, TBKITPRO e PRPAREVOLIMG BLOQUEADAS (falta de mecanismo; BLOQUEADAS abaixo).
As não carregadas entram só com a forma (2 linhas falsas).

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
from . import l5_06 as _l5_06, l6_02 as _l6_02, l6_05 as _l6_05, l6_07 as _l6_07, l6_09 as _l6_09, l6_10 as _l6_10
from .. import sintetica as _sint
# rodada 3: pais lidos na origem pelas encadeadas da PRASSINATURA_CAB (versão do paciente, versão do atendimento, tipo
# de assinatura, inscrição no conselho), da PRPADEVOL (pergunta) e a própria PRRESPOSTA (imagem da L6-10, agora desta
# fatia), com a forma das donas
_PAI_DDL = {t: re.search(r"CREATE TABLE %s \(.*?\);" % t, m.DDL, re.S).group(0)
            for t, m in (("PRLOCPACDEFAULT", _l6_05), ("TBPROENF", _l6_09), ("TBUNIDADEMEDIDA", _l6_10),
                         ("HTPACIENTE", _l5_06), ("HTATENDIMENTO", _l6_02), ("TBCBOPRO", _l5_06),
                         ("PRTPASSINATURA", _l6_07), ("PRPERGUNTA", _l6_10))}
# pais lidos na origem sem imagem em outra fatia (forma do dicionário): princípio ativo da origem (descarte
# catalogo_oficial; só o código DCB é lido), catálogo de respostas (descarte duplicado; só o texto é lido) e eventos de
# assinatura (L6-12; lidos pela chave alternativa ID_PRASSINATURA_CAB)
_PAI_DDL.update({
    "TBPRINC": "CREATE TABLE TBPRINC (COD INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(254), ATIVO CHAR(1) NOT NULL,"
               " COD_DCB VARCHAR(10), ID_TBTERAPEUTICO INTEGER, ID_TBUNICON_PADRAO VARCHAR(7));",
    "PRCADRESP": "CREATE TABLE PRCADRESP (COD INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(255));",
    "PRASSINATURA_DOC": "CREATE TABLE PRASSINATURA_DOC (ID INTEGER NOT NULL PRIMARY KEY, ID_PRASSINATURA_CAB INTEGER"
                        " NOT NULL, ID_PRTPDOCUMENTO SMALLINT NOT NULL, ID_PRSITDOCUMENTO SMALLINT NOT NULL, ID_TBCBOPRO"
                        " INTEGER NOT NULL, DATA_HORA_EVENTO TIMESTAMP NOT NULL, FUSO_HORARIO_EVENTO SMALLINT,"
                        " HORARIO_VERAO_EVENTO CHAR(1), DATA_HORA_EVENTO_UTC VARCHAR(30) NOT NULL, DATA_HORA_GRAVACAO"
                        " TIMESTAMP NOT NULL, FUSO_HORARIO_GRAVACAO SMALLINT, HORARIO_VERAO_GRAVACAO CHAR(1),"
                        " DATA_HORA_GRAVACAO_UTC VARCHAR(30) NOT NULL, DOCUMENTO_ORIGINAL BLOB SUB_TYPE 1,"
                        " ID_PRCADSTATUSORDEM_MEDICA INTEGER, SEARCH_MACHINE_REPLICATED TIMESTAMP,"
                        " DOCUMENTO_XML_IMPRESSAO BLOB SUB_TYPE 1, CLASSIFICACAO_RISCO CHAR(1), LEGADO VARCHAR(1) NOT"
                        " NULL, ARQUIVO_EXPORTADO VARCHAR(100));"})
_PAI_DDL["HTATENDIMENTO"] = _PAI_DDL["HTATENDIMENTO"].replace("MATRICULA", "ID_TBCBOPRO_ASSISTENTE INTEGER, MATRICULA", 1)
_PAI_COLS = {t: list(_sint._colunas_create(d.rstrip(";"))) for t, d in _PAI_DDL.items()}
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
    'PRRESPOSTA': ('ID_RESPOSTA', [
        ('ID_RESPOSTA', 'INTEGER', True), ('ID_PRPERGUNTA', 'INTEGER', True), ('COD', 'INTEGER', False),
        ('CONTEVOL', 'BLOB SUB_TYPE 1', False), ('ATIVO', 'CHAR(1)', False), ('ORDEM', 'SMALLINT', True),]),
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
              "PRFAVORITO", "PRMANCHESTER", "PRITEM_GEITENS", "PRITEMNAOPAD_TBPRINC", "TBALERGIA_TBPRINC",
              "PRPADEVOL", "PRFORMULCOMP", "PRASSINATURA_CAB", "TBKITPRO", "PRRESPOSTA", "PRPAREVOLIMG",
              "PRPARAM", "PRAGRUP_PRFILTROCLASSIF")  # rodada 5 (ADR 0006); r6: PRAGRUP_PRFILTROCLASSIF
# rodada 3 (revisão): BLOQUEADAS com a declaração pronta e comentada (sem_carga.tsv): a forma e as linhas entram na
# imagem (provam a declaração quando o mecanismo chegar), mas a tabela não é carregada. PRRESPOSTA (forma da L6-10)
# também fica só como pai lido na origem.
# rodada 4: as três carregam (min:/max: do evento, agrupar:PROCTO no principal, por_pai)
BLOQUEADAS = ()  # r6: PRAGRUP_PRFILTROCLASSIF carrega no vínculo classificacao_filtro_painel_despesa (06_PEP/40)
COLUNAS = {t: cols for t, (_, cols) in FORMAS.items()}


def _definida_fora(tabela):
    """Tabela já definida por outra fatia da imagem (ex.: PRPADEVOL, pai lido pela L6-10): a forma não é repetida."""
    import pathlib
    aqui = pathlib.Path(__file__).resolve()
    return any(p.resolve() != aqui and ("CREATE TABLE %s (" % tabela) in p.read_text(encoding="utf-8")
               for p in aqui.parent.glob("*.py"))


SO_FORMA = [t for t in FORMAS if t not in CARREGADAS and t not in BLOQUEADAS and not _definida_fora(t)]


def _ddl():
    saida = []
    for t, (chave, cols) in FORMAS.items():
        if t not in CARREGADAS and t not in SO_FORMA and t not in BLOQUEADAS:
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
                 "TBUSERS": list(_l6_05.PAIS_EXTERNOS["TBUSERS"]),
                 # rodada 3: alergeno (L6-10), profissional (L5), paciente e atendimento (L3), situação do documento
                 # (L6-07): pontas das referências, dados como já carregados
                 "TBALERGIA": ["1", "2"], "TBPROFIS": ["1", "2"], "RICADPAC": ["1", "2"], "ATCABECATEND": ["1"],
                 "PRSITDOCUMENTO": ["1", "2"],
                 "PRFILTROCLASSIF": ["1"],  # r5: filtro do painel (L6-05); o 2 nunca visto
                 "TBCLASSI": ["7"]}  # r6: classificação de despesa (L7), dada como já carregada
# rodada 4: a inscrição no conselho da imagem é a da requerida L7-07 (TBCBOPRO 1 -> profissional 501; as linhas da
# TBCBOPRO desta fatia são omitidas porque a L7-07 já define a tabela): o profissional 501 é dado como carregado
PAIS_EXTERNOS["TBPROFIS"] = PAIS_EXTERNOS["TBPROFIS"] + ["501"]
# donas dos pais lidos na origem (referência por chave alternativa e encadeada); dados delas usados abaixo:
# TBUNIDADEMEDIDA sigla MG (1), ML (2), UI (4) carregadas, X (3) recusada; GEITENS 101-106, 111, 112 carregados, 107
# sem nome, 108 pai_pendente; GEUNIPRESC 1 (101, ML) e 2 (101, CX); TBPROENF 1 e 5 carregados, 4 sem nome (recusado);
# PRKITSOL 1, 2, 4, 5, 6 carregados, 3 recusado; PRLOCPACDEFAULT 10 e 20 com login conhecido, 30 com login nunca visto;
# PRTPLAN 1-3 e GETABVIA VO, EV, IV como pais externos das requeridas
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL);\nINSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');\n"
                   # catálogo oficial de princípio ativo (DCB) e tipo de item da prescrição (código 6 = medicamento):
                   # só o código, achado por cod: (nunca gravado pelo conector)
                   # mesma forma mínima da requerida L7-07 (ela acha por cod:principio_ativo.descricao)
                   "CREATE TABLE IF NOT EXISTS principio_ativo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo_dcb VARCHAR(10) NOT NULL UNIQUE, descricao VARCHAR(255) NOT NULL,"
                   " versao_fonte VARCHAR(30) NOT NULL, criado_em DATETIME(3) NOT NULL);\n"
                   "INSERT IGNORE INTO principio_ativo (codigo_dcb, descricao, versao_fonte, criado_em) VALUES"
                   " ('00101', 'Principio falso C', 'exemplo', NOW(3)), ('00202', 'Principio falso D', 'exemplo', NOW(3)),"
                   " ('01234', 'Principio falso A', 'exemplo', NOW(3)), ('01235', 'Principio falso B', 'exemplo', NOW(3));\n"
                   "CREATE TABLE IF NOT EXISTS tipo_item_prescricao (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(30) NOT NULL UNIQUE);\n"
                   "INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES ('6', 'Tipo exemplo seis', 'medicamento', UTC_TIMESTAMP(3)), ('7', 'Tipo exemplo sete', 'cuidado', UTC_TIMESTAMP(3));\n"
                   # tipos nativos de migração do estoque (11_SUP/07_chaves.sql) que a requerida L7-07 acha por cod:
                   # (o PREPARO_DESTINO dela não roda aqui: repetiria o estabelecimento único)
                   "CREATE TABLE IF NOT EXISTS tipo_movimento_estoque (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(40) NOT NULL UNIQUE);\n"
                   "INSERT IGNORE INTO tipo_movimento_estoque (codigo, descricao, natureza, sentido, afeta_saldo, afeta_custo_medio, sistema, ativo, criado_em) VALUES ('migracao_entrada', 'Entrada trazida de outro sistema', 'entrada', 'entrada', TRUE, FALSE, TRUE, FALSE, UTC_TIMESTAMP(3)), ('migracao_saida', 'Saída trazida de outro sistema', 'saida', 'saida', TRUE, FALSE, TRUE, FALSE, UTC_TIMESTAMP(3));\n"
                   "CREATE TABLE IF NOT EXISTS tipo_entrada_estoque (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(40) NOT NULL UNIQUE);\n"
                   "INSERT IGNORE INTO tipo_entrada_estoque (codigo, descricao, natureza, tipo_movimento_estoque_id, exige_documento_fiscal, atualiza_custo_medio, atualiza_ultimo_preco, exige_fornecedor, ativo, criado_em) SELECT 'migracao', 'Entrada trazida de outro sistema', 'outra', id, FALSE, FALSE, FALSE, FALSE, FALSE, UTC_TIMESTAMP(3) FROM tipo_movimento_estoque WHERE codigo = 'migracao_entrada';\n"
                   # situação do documento (cadastro do produto, achado por cod: no cabeçalho sem evento): SEM a semente
                   # nativa migrado_sem_assinatura, pedida à F2.2 (saida/L6-11.json): prova a recusa visível até lá
                   "CREATE TABLE IF NOT EXISTS situacao_documento_prontuario (id BIGINT UNSIGNED AUTO_INCREMENT"
                   " PRIMARY KEY, codigo VARCHAR(30) NOT NULL UNIQUE);")



CATALOGO_PROPOSTO = """\
INSERT INTO modulo_sistema (codigo, descricao, criado_em) SELECT 'pep', 'Prontuário eletrônico', CURRENT_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = 'pep');
INSERT IGNORE INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, permite_rede, ativo, criado_em)
  SELECT x.chave, m.id, x.descricao, x.tipo, TRUE, TRUE, CURRENT_TIMESTAMP(3)
  FROM (
    SELECT 'pep.prescricao.unidadeConsumoMililitro' AS chave, 'Prontuário (prescricao): unidade consumo mililitro' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.unidadeConsumoGotas' AS chave, 'Prontuário (prescricao): unidade consumo gotas' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.protocoloSequencial' AS chave, 'Prontuário (prescricao): protocolo sequencial' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.visualizacaoPrevisto' AS chave, 'Prontuário (prescricao): visualizacao previsto' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.controlaCateter' AS chave, 'Prontuário (prescricao): controla cateter' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.exigeChecagemLaboratorio' AS chave, 'Prontuário (checagem): exige checagem laboratorio' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.exibeReferenciaComercial' AS chave, 'Prontuário (prescricao): exibe referencia comercial' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.geraRequisicaoEstoque' AS chave, 'Prontuário (prescricao): gera requisicao estoque' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.exigeMotivoFalta' AS chave, 'Prontuário (checagem): exige motivo falta' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.exigeChecagemEnfermagem' AS chave, 'Prontuário (checagem): exige checagem enfermagem' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.diasPrescricaoAnterior' AS chave, 'Prontuário (prescricao): dias prescricao anterior' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'pep.prescricao.exibeReferenciaDiluente' AS chave, 'Prontuário (prescricao): exibe referencia diluente' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.percentualExigeJustificativa' AS chave, 'Prontuário (prescricao): percentual exige justificativa' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'pep.prescricao.exibeMateriais' AS chave, 'Prontuário (prescricao): exibe materiais' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.viaVenosaPadrao' AS chave, 'Prontuário (prescricao): via venosa padrao' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeMateriais' AS chave, 'Prontuário (impressao.prescricao): imprime materiais' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.fatorDietaBlend' AS chave, 'Prontuário (prescricao): fator dieta blend' AS descricao, 'decimal' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeQuantidade' AS chave, 'Prontuário (impressao.prescricao): imprime quantidade' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeDatas' AS chave, 'Prontuário (impressao.prescricao): imprime datas' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeEvolucaoEnfermagem' AS chave, 'Prontuário (impressao.prescricao): imprime evolucao enfermagem' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeBombaInfusao' AS chave, 'Prontuário (impressao.prescricao): imprime bomba infusao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeRequisicao' AS chave, 'Prontuário (impressao.prescricao): imprime requisicao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.memorizaNaoAdministrado' AS chave, 'Prontuário (checagem): memoriza nao administrado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeDescricaoProtocolo' AS chave, 'Prontuário (impressao.prescricao): imprime descricao protocolo' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.especialidadePsiquiatria' AS chave, 'Prontuário (prescricao): especialidade psiquiatria' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.incluiDieta' AS chave, 'Prontuário (prescricao): inclui dieta' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.exigeChecagemMaterial' AS chave, 'Prontuário (checagem): exige checagem material' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.permitePrescricaoUrgencia' AS chave, 'Prontuário (prescricao): permite prescricao urgencia' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.lancaNaConta' AS chave, 'Prontuário (prescricao): lanca na conta' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.exigeValidacaoFarmaceutica' AS chave, 'Prontuário (prescricao): exige validacao farmaceutica' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.permiteCorrigirPrescricaoValidada' AS chave, 'Prontuário (prescricao): permite corrigir prescricao validada' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeRelacaoMedicamentos' AS chave, 'Prontuário (impressao.prescricao): imprime relacao medicamentos' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.permitePercentualAcimaLimite' AS chave, 'Prontuário (prescricao): permite percentual acima limite' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.permiteIncluirItensPrescricao' AS chave, 'Prontuário (prescricao): permite incluir itens prescricao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.dataInicioPendencias' AS chave, 'Prontuário (checagem): data inicio pendencias' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'pep.checagem.validaIntervalo' AS chave, 'Prontuário (checagem): valida intervalo' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.requisicaoSeNecessario' AS chave, 'Prontuário (prescricao): requisicao se necessario' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.requisicaoACriterioMedico' AS chave, 'Prontuário (prescricao): requisicao acriterio medico' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.validaDose24Horas' AS chave, 'Prontuário (prescricao): valida dose24horas' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.validaIntervaloDose' AS chave, 'Prontuário (checagem): valida intervalo dose' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.registraTrilhaMinima' AS chave, 'Prontuário (prescricao): registra trilha minima' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.medicoNoRodape' AS chave, 'Prontuário (impressao.prescricao): medico no rodape' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.toleranciaHorario' AS chave, 'Prontuário (checagem): tolerancia horario' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeEmitidoEm' AS chave, 'Prontuário (impressao.prescricao): imprime emitido em' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.lancaKit' AS chave, 'Prontuário (prescricao): lanca kit' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeRegistro' AS chave, 'Prontuário (impressao.prescricao): imprime registro' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeDoseTotal' AS chave, 'Prontuário (impressao.prescricao): imprime dose total' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.cabecalhoHistorico' AS chave, 'Prontuário (prescricao): cabecalho historico' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.planejamento.exigeSenhaAlteracao' AS chave, 'Prontuário (prescricao.planejamento): exige senha alteracao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.planejamento.alertaPendente' AS chave, 'Prontuário (prescricao.planejamento): alerta pendente' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.verificaFatorConversao' AS chave, 'Prontuário (prescricao): verifica fator conversao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.agrupamento' AS chave, 'Prontuário (impressao.prescricao): agrupamento' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.planejamento.diasAlertaPendente' AS chave, 'Prontuário (prescricao.planejamento): dias alerta pendente' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'pep.prescricao.lembraViaAcessoItem' AS chave, 'Prontuário (prescricao): lembra via acesso item' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeQuantidadePadrao' AS chave, 'Prontuário (impressao.prescricao): imprime quantidade padrao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.validaPeriodoVigencia' AS chave, 'Prontuário (prescricao): valida periodo vigencia' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.instrucaoRegistroProducaoPublica' AS chave, 'Prontuário (prontuario): instrucao registro producao publica' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'pep.prescricao.exigeValidacaoAntimicrobiano' AS chave, 'Prontuário (prescricao): exige validacao antimicrobiano' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.solicitacaoExame.porConvenio' AS chave, 'Prontuário (impressao.solicitacaoExame): por convenio' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.quantidadeProfissionaisEnfermagem' AS chave, 'Prontuário (checagem): quantidade profissionais enfermagem' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.antimicrobiano.complementoPedido' AS chave, 'Prontuário (prescricao.antimicrobiano): complemento pedido' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.viaOralPadrao' AS chave, 'Prontuário (prescricao): via oral padrao' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.exibeNomeComercial' AS chave, 'Prontuário (impressao.prescricao): exibe nome comercial' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.incluiKitMateriais' AS chave, 'Prontuário (prescricao): inclui kit materiais' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeNumeroDoses' AS chave, 'Prontuário (impressao.prescricao): imprime numero doses' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.incluiKitNaPrescricaoMedica' AS chave, 'Prontuário (prescricao): inclui kit na prescricao medica' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.frenteVerso' AS chave, 'Prontuário (impressao.prescricao): frente verso' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.somenteItensConsolidados' AS chave, 'Prontuário (checagem): somente itens consolidados' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.geraDocumentoDevolucaoEstoque' AS chave, 'Prontuário (prescricao): gera documento devolucao estoque' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.painel.liberaPacienteIntegrado' AS chave, 'Prontuário (painel): libera paciente integrado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.assinatura.assinaDigitalmente' AS chave, 'Prontuário (assinatura): assina digitalmente' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.geraFolhaSala' AS chave, 'Prontuário (prescricao): gera folha sala' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.viaAcessoVenosoCentral' AS chave, 'Prontuário (prescricao): via acesso venoso central' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.viaAcessoVenosoPeriferico' AS chave, 'Prontuário (prescricao): via acesso venoso periferico' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.viaHipodermoclise' AS chave, 'Prontuário (prescricao): via hipodermoclise' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.documentos.integracaoArquivoPor' AS chave, 'Prontuário (documentos): integracao arquivo por' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.solucao.iniciaAdministracaoAgora' AS chave, 'Prontuário (prescricao.solucao): inicia administracao agora' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.painel.exibeAtendimentoGeradoExame' AS chave, 'Prontuário (painel): exibe atendimento gerado exame' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.corrigeHoraRespostaRascunho' AS chave, 'Prontuário (prontuario): corrige hora resposta rascunho' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.horariosPreCadastrados' AS chave, 'Prontuário (impressao.prescricao): horarios pre cadastrados' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.suprimeItensManipulacao' AS chave, 'Prontuário (prescricao): suprime itens manipulacao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.integracao.laboratorio.endereco' AS chave, 'Prontuário (integracao.laboratorio): endereco' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'pep.prescricao.consisteItemDuplicado' AS chave, 'Prontuário (prescricao): consiste item duplicado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.validaLancamentoIndicadorProgramado' AS chave, 'Prontuário (prescricao): valida lancamento indicador programado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.referenciaBibliografica' AS chave, 'Prontuário (impressao.prescricao): referencia bibliografica' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.cabecalhoMedico' AS chave, 'Prontuário (impressao.prescricao): cabecalho medico' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.calculaVelocidadeInfusao' AS chave, 'Prontuário (prescricao): calcula velocidade infusao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.codigoRegional' AS chave, 'Prontuário (impressao.prescricao): codigo regional' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.digitoConselho' AS chave, 'Prontuário (impressao.prescricao): digito conselho' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.intercorrencia.notificaResponsavel' AS chave, 'Prontuário (prontuario.intercorrencia): notifica responsavel' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricaoOncologica.data' AS chave, 'Prontuário (impressao.prescricaoOncologica): data' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.agrupaAtendimentoPsiquiatria' AS chave, 'Prontuário (impressao.prescricao): agrupa atendimento psiquiatria' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.exameForaPadrao' AS chave, 'Prontuário (prescricao): exame fora padrao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.colunaData' AS chave, 'Prontuário (impressao.prescricao): coluna data' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.agrupaPorTipoLancamento' AS chave, 'Prontuário (impressao.prescricao): agrupa por tipo lancamento' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricaoOncologica.nomeCidade' AS chave, 'Prontuário (impressao.prescricaoOncologica): nome cidade' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.painel.colunaEsperaSenha' AS chave, 'Prontuário (painel): coluna espera senha' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.painel.colunaEsperaAtendimento' AS chave, 'Prontuário (painel): coluna espera atendimento' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.painel.colunaEsperaLocal' AS chave, 'Prontuário (painel): coluna espera local' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.painel.colunaEsperaUltimaMovimentacao' AS chave, 'Prontuário (painel): coluna espera ultima movimentacao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.zebrado' AS chave, 'Prontuário (impressao.prescricao): zebrado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.antimicrobiano.tipoLancamento' AS chave, 'Prontuário (prescricao.antimicrobiano): tipo lancamento' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prontuario.exigeInformacaoComplementarClinica' AS chave, 'Prontuário (prontuario): exige informacao complementar clinica' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.protocoloOncologicoConvertido' AS chave, 'Prontuário (prescricao): protocolo oncologico convertido' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.permiteConsentimentoNoLancamento' AS chave, 'Prontuário (prontuario): permite consentimento no lancamento' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.antimicrobiano.exibeFrequencia' AS chave, 'Prontuário (impressao.antimicrobiano): exibe frequencia' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.integracao.laboratorio.modo' AS chave, 'Prontuário (integracao.laboratorio): modo' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.painel.telaAuxiliarLocalizacao' AS chave, 'Prontuário (painel): tela auxiliar localizacao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.observacaoMedicaLonga' AS chave, 'Prontuário (prescricao): observacao medica longa' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.documentoSeparadoConsignado' AS chave, 'Prontuário (prescricao): documento separado consignado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.paginasPadrao' AS chave, 'Prontuário (impressao.prescricao): paginas padrao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'pep.prescricao.exibeProtocoloItemNaoPadronizado' AS chave, 'Prontuário (prescricao): exibe protocolo item nao padronizado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.exibeNomeKit' AS chave, 'Prontuário (prescricao): exibe nome kit' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeHorarios' AS chave, 'Prontuário (impressao.prescricao): imprime horarios' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.modelo' AS chave, 'Prontuário (impressao.prescricao): modelo' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prontuario.historicoExame.separaBateria' AS chave, 'Prontuário (prontuario.historicoExame): separa bateria' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.duplex' AS chave, 'Prontuário (impressao): duplex' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.assinatura.textoEmailDocumentoAssinado' AS chave, 'Prontuário (assinatura): texto email documento assinado' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'pep.assinatura.habilitada' AS chave, 'Prontuário (assinatura): habilitada' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.assinatura.tempoExibicaoPendente' AS chave, 'Prontuário (assinatura): tempo exibicao pendente' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'pep.receita.psicotropicoPadrao' AS chave, 'Prontuário (receita): psicotropico padrao' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prontuario.exportacao.exigeJustificativa' AS chave, 'Prontuário (prontuario.exportacao): exige justificativa' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.exame.envioBateriaAgrupado' AS chave, 'Prontuário (prontuario.exame): envio bateria agrupado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.sinaisVitais.toleranciaLancamentoAtrasado' AS chave, 'Prontuário (sinaisVitais): tolerancia lancamento atrasado' AS descricao, 'duracao_minutos' AS tipo
    UNION ALL SELECT 'pep.prontuario.toleranciaLancamentoRascunho' AS chave, 'Prontuário (prontuario): tolerancia lancamento rascunho' AS descricao, 'duracao_minutos' AS tipo
    UNION ALL SELECT 'pep.impressao.exibeParametros' AS chave, 'Prontuário (impressao): exibe parametros' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.mantemLancamentoMesmaPagina' AS chave, 'Prontuário (impressao): mantem lancamento mesma pagina' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.consideraImpressa' AS chave, 'Prontuário (prescricao): considera impressa' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.receitaDigital.enderecoLogotipo' AS chave, 'Prontuário (receitaDigital): endereco logotipo' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'pep.documentos.tipoAtestadoRequerimento' AS chave, 'Prontuário (documentos): tipo atestado requerimento' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.receita.tipo' AS chave, 'Prontuário (receita): tipo' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.receitaDigital.ambienteProducao' AS chave, 'Prontuário (receitaDigital): ambiente producao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.duplex' AS chave, 'Prontuário (impressao.prescricao): duplex' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.validaAposConfirmar' AS chave, 'Prontuário (prontuario): valida apos confirmar' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.locaisPorUsuario' AS chave, 'Prontuário (prontuario): locais por usuario' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.assinatura.semAvisoPendenteAoEntrar' AS chave, 'Prontuário (assinatura): sem aviso pendente ao entrar' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.validaLancamentoDuplicado' AS chave, 'Prontuário (prescricao): valida lancamento duplicado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricaoOncologica.assinatura' AS chave, 'Prontuário (impressao.prescricaoOncologica): assinatura' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.assinatura' AS chave, 'Prontuário (impressao.prescricao): assinatura' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.exportacao.comSenha' AS chave, 'Prontuário (prontuario.exportacao): com senha' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.somenteItensAssinados' AS chave, 'Prontuário (checagem): somente itens assinados' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.alertaPrevisaoAlta' AS chave, 'Prontuário (prontuario): alerta previsao alta' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.avaliacaoFarmaceuticaForaPadrao' AS chave, 'Prontuário (prescricao): avaliacao farmaceutica fora padrao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.aprazamentoPelaEnfermagem' AS chave, 'Prontuário (prescricao): aprazamento pela enfermagem' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.horarioMedicacao' AS chave, 'Prontuário (impressao.prescricao): horario medicacao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.documentos.usaServicoArmazenamento' AS chave, 'Prontuário (documentos): usa servico armazenamento' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.internacao.exigeLaudoApos48Horas' AS chave, 'Prontuário (internacao): exige laudo apos48horas' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.alertaExameRepetido' AS chave, 'Prontuário (prescricao): alerta exame repetido' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.restringeAcessoForaDoAtendimento' AS chave, 'Prontuário (prontuario): restringe acesso fora do atendimento' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.antecedenciaPermitida' AS chave, 'Prontuário (checagem): antecedencia permitida' AS descricao, 'duracao_minutos' AS tipo
    UNION ALL SELECT 'pep.prescricao.consisteFrequenciaUnica' AS chave, 'Prontuário (prescricao): consiste frequencia unica' AS descricao, 'booleano' AS tipo
  ) x JOIN modulo_sistema m ON m.codigo = 'pep'"""


def _catalogo_parametros():
    """r5 (ADR 0006, achado alto): o catálogo TIPADO dos parâmetros do prontuário é o PROPOSTO à trilha de modelo
    (CATALOGO_PROPOSTO = docs/obra/fatias/f4/saida/L6-11-parametros.sql sem comentários; migração pedida em
    saida/L6-11.json), o mesmo texto que irá para
    db/migracoes/06_PEP; a fatia não inventa definição. Quando a migração entrar, esta parte sai do PREPARO (o banco
    descartável já terá o catálogo) e a cobertura deixa de contar PRPARAM como bloqueada."""
    corpo = CATALOGO_PROPOSTO
    return ("CREATE TABLE IF NOT EXISTS modulo_sistema (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
            " codigo VARCHAR(30) NOT NULL, descricao VARCHAR(150) NOT NULL, ativo BOOLEAN NOT NULL DEFAULT TRUE,"
            " ordem INT NOT NULL DEFAULT 0, criado_em DATETIME(3) NOT NULL);\n"
            "CREATE TABLE IF NOT EXISTS parametro_definicao (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
            " chave VARCHAR(100) NOT NULL UNIQUE, modulo_sistema_id BIGINT UNSIGNED NOT NULL,"
            " descricao VARCHAR(500) NOT NULL, tipo VARCHAR(30) NOT NULL, permite_rede BOOLEAN NOT NULL DEFAULT TRUE,"
            " ativo BOOLEAN NOT NULL DEFAULT TRUE, criado_em DATETIME(3) NOT NULL);\n" + corpo)


PREPARO_DESTINO = PREPARO_DESTINO + "\n" + _catalogo_parametros() + ";"


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


def _pai(ins, tab, **v):
    ins(tab, [v.get(c) for c in _PAI_COLS[tab]])


def _rodada3(ins):
    """Linhas das tabelas destravadas na rodada 3 e dos pais lidos na origem por elas."""
    T = datetime.datetime
    # parâmetro clínico do insumo (GEITENS da L7-07: 101-106 carregados, 107 recusado): 103 com marca fora do domínio
    # (valor_fora_do_dominio nos dois destinos, fica o padrão); 107 pai recusado (pai_pendente); 999 nunca visto
    for it, perig, int24, per, bal, bomba, inv in [(101, "S", "N", 6, "S", "N", "N"), (102, "N", "S", 0, "N", "S", "S"),
                                                  (103, "X", "N", None, "N", "N", "N"),
                                                  (107, "S", "N", 4, "N", "N", "N"),
                                                  (999, "S", "N", 4, "N", "N", "N")]:
        _ins(ins, "PRITEM_GEITENS", ID_GEITENS=it, POTENCIALMENTE_PERIGOSO=perig, PERMITIR_DOSE_INTERV_SUP_24H=int24,
             PERIODO_MINIMO_ENTRE_DOSE=per, ITEM_CONTABILIZADO_BALANCO_PEP=bal, PADRAO_BOMBA_FICHA_ANEST=bomba,
             INFORMAR_LOCAL_ACESSO_INVASIVO=inv, CONSISTIR_DOSE_MINIMA_MAXIMA=0, ID_GEITEACAODOSE=1)
    # r6 (ADR 0006): o princípio é o do HOSPITAL (TBPRINC carrega em principio_ativo_cliente na requerida L7-07, que
    # define a tabela na imagem: as linhas dela valem, 1 e 2 com DCB do catálogo, 4 com código fora do catálogo e
    # gravado como item próprio, 6 recusado). Princípio do item não padronizado (PRITEMNAOPAD: 1, 2, 6 gravados; 3
    # recusado): 4 local entra utilizável; 6 recusado (pai_pendente); 99 nunca visto (pai_inexistente + CHECK 4025);
    # item recusado (pai_pendente)
    for it, pr in [(1, 1), (2, 2), (1, 4), (2, 6), (1, 99), (3, 1)]:
        _ins(ins, "PRITEMNAOPAD_TBPRINC", ID_PRITEMNAOPAD=it, ID_TBPRINC=pr)
    # princípio do alergeno: situação fora do domínio (padrão ativo); alergeno nunca visto (pai_inexistente + 1048);
    # princípio local (4) entra utilizável
    for al, pr, sit in [(1, 1, "A"), (2, 1, "I"), (2, 2, "X"), (9, 1, "A"), (1, 4, "A")]:
        _ins(ins, "TBALERGIA_TBPRINC", ID_TBALERGIA=al, ID_TBPRINC=pr, SITUACAO=sit)
    # perguntas (lidas pela ligação PRPADEVOL): 1 decimal com unidade 'kg', texto padrão e reaproveitamento (65535 h);
    # 2 escolha, MANTERHIST 3 (sem semântica: valor_fora_do_dominio); 3 CID (texto, destino diagnóstico) e INATIVA
    # (exclui o campo); 4 sem descrição; 5 tipo sem par (NULL: valor_fora_do_dominio e recusa) com a mesma unidade 'kg'
    for i, desc, tp, un, txt, mh, atv in [(1, "Pergunta exemplo um", "6", "kg", b"Peso exemplo", 1, "T"),
                                          (2, "Pergunta exemplo dois", "13", None, None, 3, "T"),
                                          (3, "Pergunta exemplo três", "10", " ", None, None, "F"),
                                          (4, None, "11", None, None, None, "T"),
                                          (5, "Pergunta exemplo cinco", "99", "kg", None, 2, "T")]:
        _pai(ins, "PRPERGUNTA", ID=i, COD_PERGUNTA=100 + i, COLUNA=1, DESCRICAO=desc, TIPOPERG=tp, UNIDPERG=un,
             CONTEVOL=txt, MANTERHIST=mh, ATIVO=atv)
    # campos do modelo (PREVOLUCAO: 1, 2, 5, 6 gravados; 3 e 4 recusados): pergunta 1 em dois modelos (opção ambígua);
    # 4 modelo recusado (a versão dele nunca foi gravada: pai_inexistente + 1048); 5 pergunta sem descrição (1048); 6
    # modelo nunca visto (pai_inexistente + 1048); 7 obrigatório fora do domínio (padrão); tipo presumido em todos
    # campo 2 INATIVO no modelo (ATIVO F: excluído na data da carga); campo 3 adota a unidade 'kg' criada pelo campo 1
    for i, ev, pg, ordem, obrig, atv in [(1, 1, 1, "1", "S", "T"), (2, 1, 2, "2", "N", "F"), (3, 2, 1, "1", "S", "T"),
                                         (4, 3, 5, "1", "N", "T"), (5, 1, 4, "3", "N", "T"), (6, 9, 5, "1", "N", "T"),
                                         (7, 5, 3, "1A", "Z", "T")]:
        _ins(ins, "PRPADEVOL", ID=i, ID_EVOLUCAO=ev, ID_PRPERGUNTA=pg, ORDEM=ordem, CAMPOOBRIG=obrig, ATIVO=atv,
             FONTE=("fonte exemplo %d" % i).encode("cp1252"))
    # componentes do leiaute: 3 campo de modelo recusado (versão nunca gravada: pai_inexistente + 1048); 4 campo nunca
    # visto (pai_inexistente + 1048)
    for i, pv in [(1, 1), (2, 2), (3, 4), (4, 99), (5, 7)]:
        _ins(ins, "PRFORMULCOMP", ID=i, ID_PRPADEVOL=pv, NOME_CLASSE="TEdit", NOME_COMPONENTE_PAI="Painel%d" % i,
             COMPONENTE=("componente exemplo %d" % i).encode("cp1252"), ORDEM_CRIACAO=i)
    for cod, desc in [(1, "Sim exemplo"), (2, "Não exemplo")]:
        _pai(ins, "PRCADRESP", COD=cod, DESCRICAO=desc)
    # opções: rótulo pelo catálogo de respostas (1) ou pelo texto (2; 4 com COD nunca visto: pai_inexistente e vale o
    # texto); 3 pergunta em dois modelos (por_pai: uma opção em cada campo); 5 pergunta sem campo (pai_inexistente)
    for i, pg, cod, txt, ordem in [(1, 2, 1, None, 1), (2, 2, None, b"Talvez exemplo", 2), (3, 1, 2, None, 1),
                                   (4, 3, 7, b"Outro exemplo", 1), (5, 9, 1, None, 1)]:
        _ins(ins, "PRRESPOSTA", ID_RESPOSTA=i, ID_PRPERGUNTA=pg, COD=cod, CONTEVOL=txt, ATIVO="S", ORDEM=ordem)
    # documento do prontuário: pais lidos na origem
    for i, pac in [(10, 1), (11, 2), (12, 9)]:
        _pai(ins, "HTPACIENTE", ID=i, ID_RICADPAC=pac, DATA_HORA_HISTORICO=T(2025, 1, 2, 8, 0), ID_TBSEXO=1)
    _pai(ins, "HTATENDIMENTO", ID=20, ID_ATCABECATEND=1, DATA_HORA_HISTORICO=T(2025, 1, 2, 8, 0),
         DATA_HORA_ENTRADA=T(2025, 1, 2, 8, 0), ID_HTCONVEN=1, ID_TBCBOPRO_ASSISTENTE=1)
    for i, desc in [(1, "Evolução exemplo"), (2, "Prescrição exemplo")]:
        _pai(ins, "PRTPASSINATURA", ID=i, DESCRICAO=desc, ORDEM_MEDICA="N")
    for i, prof in [(100, 1), (101, 2)]:
        _pai(ins, "TBCBOPRO", ID=i, ID_TBCBOSUS=1, UF="SP", COD=1000 + i, ID_TBPROFIS=prof, VINC_EMPR="S")
    # eventos de assinatura: cabeçalho 2 com dois eventos (autor e momento do primeiro, situação do último); 4 sem evento
    for i, cab, sit, cbo, dia in [(1, 1, 1, 1, 3), (2, 2, 1, 1, 4), (3, 2, 2, 1, 5), (4, 3, 2, 1, 6),
                                  (5, 5, 2, 1, 7), (6, 7, 2, 1, 8), (7, 7, 1, 1, 8)]:
        _pai(ins, "PRASSINATURA_DOC", ID=i, ID_PRASSINATURA_CAB=cab, ID_PRTPDOCUMENTO=1, ID_PRSITDOCUMENTO=sit,
             ID_TBCBOPRO=cbo, DATA_HORA_EVENTO=T(2025, 1, dia, 9, 15), DATA_HORA_EVENTO_UTC="falso",
             DATA_HORA_GRAVACAO=T(2025, 1, dia, 9, 20), DATA_HORA_GRAVACAO_UTC="falso", LEGADO="N")
    # cabeçalhos: 1 completo com documento consolidado; 2 dois eventos (primeiro e último, sem ambiguidade);
    # 3 paciente nunca visto (pai_inexistente + 1048); 4 sem evento, com atendimento (autor = assistente, momento =
    # entrada; situação nativa migrado_sem_assinatura ainda sem semente: codigo_inexistente_destino + 1048); 5 sem
    # atendimento; 6 sem evento e sem atendimento (sem autor: recusa); 7 dois eventos no MESMO instante (6 situação 2,
    # 7 situação 1): situação atual = a do maior ID (7)
    for i, tp, tab, pac, at, doc in [(1, 1, 500, 10, 20, "Documento exemplo\nassinado"), (2, 1, 501, 11, None, None),
                                     (3, 2, 502, 12, None, None), (4, 2, 503, 10, 20, None),
                                     (5, 2, 504, 11, None, None), (6, 1, 505, 11, None, None),
                                     (7, 1, 506, 10, None, None)]:
        _ins(ins, "PRASSINATURA_CAB", ID=i, ID_PRTPASSINATURA=tp, ID_TABELA=tab, ID_HTPACIENTE=pac,
             ID_HTATENDIMENTO=at, DOCUMENTO_CONSOLIDADO=doc.encode("cp1252") if doc else None)


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
    # rodada 5 (ADR 0006): ligação do filtro do painel à classificação, na trilha do filtro (1 filtro conhecido; 2
    # filtro nunca visto: pai_inexistente, gravada com a chave original no retrato)
    # r6: no vínculo classificacao_filtro_painel_despesa; o 2 (filtro nunca visto) é recusado pelo NOT NULL
    for i in (1, 2):
        ins("PRAGRUP_PRFILTROCLASSIF", [i, i, 7])
    # parâmetros globais (sem chave): uma linha com logotipo (arquivo + logotipo do estabelecimento) e senha (ao cofre,
    # nunca no retrato)
    nomes = [c for c, _, _ in COLUNAS["PRPARAM"]]
    # r6: UMA linha (a tabela de parâmetros globais tem uma linha só; duas linhas globais colidiriam na vigência)
    for i in (2,):
        v = [_falso(tp, i) for _, tp, _ in COLUNAS["PRPARAM"]]
        # r6: com logotipo e com a senha (ao cofre; sem chave mestra no descartável: segredo_aguarda_cofre): 148
        # parâmetros com valor (os 3 de hora ficam nulos na imagem) + trilha + logotipo
        v[nomes.index("LOGOTIPO")] = b"\x89PNG falso"
        ins("PRPARAM", v)
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
    # linha e espaços internos (texto só apara as pontas); todos com o tipo de registro presumido (valor_presumido).
    # Código do modelo (decisão 61): 1 em minúsculas vira M1; 2 fora do padrão (valor_fora_do_dominio) fica com a
    # chave '2' (reserva); 5 e 6 colidem pela caixa (codigo_colisao_reserva) e ficam com as chaves '5' e '6'
    for i, cod, desc, tp in [(1, "m1", "Evolução médica exemplo", 1), (2, "M-2", "Anamnese exemplo", 2),
                             (3, "M3", None, 1), (4, "M4", "Modelo órfão exemplo", 9),
                             (5, "ev5", "  Evolução   diária\r\nexemplo ", 1), (6, "EV5", "Admissão exemplo", 2)]:
        _ins(ins, "PREVOLUCAO", ID_EVOLUCAO=i, COD=cod, DESCRICAO=desc, ID_PRTPCOMP=tp)
    # conferidor r4: imagem de base do modelo (#arquivo): 1 PNG do modelo 1; 2 o MESMO binário no modelo 2 (um arquivo
    # só no armazenamento); 3 imagem vazia (1048); 4 do modelo 3 recusado (pai_pendente)
    for i, nome, img, mod in [(1, "Mapa do corpo exemplo", b"\x89PNG\r\n\x1a\nimagem falsa 1", 1),
                              (2, "Mapa do corpo copia", b"\x89PNG\r\n\x1a\nimagem falsa 1", 2),
                              (3, "Imagem vazia exemplo", b"", 1), (4, "Imagem orfa exemplo", b"GIF89a falsa", 3)]:
        _ins(ins, "PRPAREVOLIMG", ID=i, NOME=nome, ATIVO="S", IMAGEM=img, ID_PREVOLUCAO=mod)
    # especialidade do modelo: modelo 3 recusado (pai_pendente); especialidade 7 inexistente
    for mod, esp in [(1, 1), (1, 2), (2, 1), (5, 3), (6, 1), (3, 1), (6, 7)]:
        _ins(ins, "PREVOLESPEC", ID_EVOLUCAO=mod, ESPEC=esp)
    # acomodação do modelo: modelo 4 recusado (pai_pendente); categoria 0 (vazia: NULL em NOT NULL)
    for mod, cat in [(1, 1), (1, 2), (4, 1), (5, 2), (6, 0)]:
        _ins(ins, "PREVOLTIPOACO", ID_EVOLUCAO=mod, COD=cat, NOME="Categoria exemplo %d" % cat)
    D = decimal.Decimal
    _rodada3(ins)
    # item não padronizado: 1 e 2 completos (espaços internos colapsados no 2); 3 sem nome (1048); 4 unidade sem sigla
    # correspondente (pai_inexistente + 1048); 5 tipo de item nunca visto (pai_inexistente + 1048); 6 produto nunca
    # visto (NULL, grava); 7 produto recusado na L7-07 (pai_pendente)
    # unidade de prescrição pelo código da origem (TBUNICON da L7-07: CX, AMP, FR, ML e X carregadas, UN recusada; ZZ
    # nunca vista): criada antes e adotada pelo código nas linhas seguintes
    for i, nome, uni, tp, item in [(1, "Item não padronizado um", "AMP", 1, 101), (2, "  Item   dois ", "ML", 2, None),
                                   (3, None, "AMP", 1, None), (4, "Item quatro", "UN", 1, None),
                                   (5, "Item cinco", "AMP", 9, None), (6, "Item seis", "FR", 3, 999),
                                   (7, "Item sete", "AMP", 1, 108)]:
        _ins(ins, "PRITEMNAOPAD", ID_ITEMNAOPAD=i, NOME=nome, UNI_PRESC=uni, SITUACAO="A", ITEM=item,
             USUARIO_CAD="usuario.exemplo", ID_PRTPLAN=tp)
    # vias do item: 3 recusado (pai_pendente); via nunca vista e item nunca visto (pai_inexistente + 1048)
    for it, via in [(1, "VO"), (1, "IV"), (2, "IV"), (3, "VO"), (6, "ZZ"), (99, "VO")]:
        _ins(ins, "PRITEMNAOPAD_GETABVIA", ID_PRITEMNAOPAD=it, ID_GETABVIA=via)
    # kit do medicamento: nome = nome do item na origem; 3 item sem nome (1048); 4 item nunca visto (pai_inexistente +
    # 1048); 5 intervalo invertido (4025); 6 unidade sem correspondência (NULL) e tipo de atendimento fora do domínio
    for k, item, ini, fim, uni, via, tp, atv in [(1, 101, "1", "2", "AMP", "VO", "I", "S"),
                                                 (2, 102, "0.5", "1", "ML", "IV", "A", "N"),
                                                 (3, 107, "1", "2", "AMP", "VO", "T", "S"),
                                                 (4, 999, "1", "2", "AMP", "VO", "T", "S"),
                                                 (5, 103, "3", "1", "CX", "VO", "U", "S"),
                                                 (6, 104, "1", "2", "ZZ", "VO", "X", "S")]:
        _ins(ins, "PRKITMED", ID=k, ID_GEITENS=item, INTERVALO_INICIAL_DOSE=D(ini), INTERVALO_FINAL_DOSE=D(fim),
             ID_TBUNICON_UNI_PRESC=uni, ID_GETABVIA=via, TP_ATENDIMENTO=tp, ATIVO=atv)
    # itens do kit do medicamento: quantidade zero (4025); unidade sem correspondência (pai_inexistente + 1048); kit 3
    # recusado (pai_pendente); produto nunca visto (NULL: CHECK do produto, 4025)
    for k, item, q, uni in [(1, 101, "2", "AMP"), (1, 102, "1", "ML"), (2, 103, "0", "AMP"), (2, 104, "1", "ZZ"),
                            (3, 101, "1", "AMP"), (6, 101, "1.5", "CX"), (6, 999, "1", "ML")]:
        _ins(ins, "PRITENSKITMED", ID_PRKITMED=k, ID_GEITENS=item, QTDE=D(q), ID_TBUNICON_UNI_PRESC=uni)
    # itens do kit de solução: 2 com indicador fora do domínio (padrão componente); kit 3 recusado (pai_pendente); kit
    # 3 e 9 nunca vistos (pai_inexistente + 1048)
    for k, item, pr, q, uni in [(1, 101, 1, "1", "ML"), (1, 102, 0, "2", "AMP"), (2, 103, 2, "1", "FR"),
                                (3, 101, 1, "1", "ML"), (4, 101, 0, "1", "X"), (9, 101, 0, "1", "ML")]:
        _ins(ins, "PRKITSOLITENS", ID_PRKITSOL=k, ID_GEITENS=item, ITEM_PRINCIPAL=pr, QTDE=D(q),
             ID_TBUNICON_UNI_PRESC=uni)
    # kit de cuidado: cada linha é um ITEM; um kit por cuidado (agrupado por PROCTO; cuidado 1 com os itens 1, 4, 5 e
    # 6, sequência pela posição na ordem da chave); 3 cuidado recusado (pai_pendente); 4 unidade CX do insumo (criada
    # e adotada pelo código); 5 sem quantidade (1048); 6 intervalo invertido (4025); 7 unidade do insumo nunca vista
    # (pai_inexistente + 1048)
    for i, proc, q, ini, fim, acm, gu, via in [(1, 1, "2", 0, 6, "N", 1, "VO"), (2, 5, "1", 2, None, "S", 1, None),
                                               (3, 4, "1", 0, None, "N", 1, "VO"), (4, 1, "1", 0, None, "N", 2, "VO"),
                                               (5, 1, None, 0, None, "N", 1, "VO"), (6, 1, "1", 8, 4, "N", 1, "VO"),
                                               (7, 5, "1", 0, None, "N", 99, "VO")]:
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
        "PRPAREVOLIMG": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1, "pai_pendente": 1}},
        "PRLOCAL_ASSISTENCIA": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1406": 1,
                                                             "valor_fora_do_dominio": 2}},
        "TBCBARAREACAOADVERSA": {"gravados": 4, "pendencias": {"codigo_colisao_caixa": 2, "restricao_destino_1406": 1,
                                                              "valor_fora_do_dominio": 1}},
        "PRPROTGERALESP": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 2}},
        "PREVOLUCAO": {"gravados": 4, "pendencias": {"valor_presumido": 6, "pai_inexistente": 1,
                                                    "restricao_destino_1048": 2, "valor_fora_do_dominio": 1,
                                                    "codigo_colisao_reserva": 2}},
        "PREVOLESPEC": {"gravados": 5, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                     "restricao_destino_1048": 1}},
        "PREVOLTIPOACO": {"gravados": 3, "pendencias": {"pai_pendente": 1, "restricao_destino_1048": 1}},
        # r6: unidade UN recusada na L7-07 = pai_pendente (não pai_inexistente + 1048); a linha recusada antes não presume
        "PRITEMNAOPAD": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "pai_pendente": 2, "restricao_destino_1048": 2, "valor_presumido": 5}},
        "PRITEMNAOPAD_GETABVIA": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "pai_pendente": 1, "restricao_destino_1048": 2}},
        # r6: unidade adotada pelo código (adotado_existente, baixa); kit 6 com unidade ZZ nunca vista é recusado
        # (pai_inexistente + 1048 na unidade criada antes), como o item do kit com ZZ: a conciliação mostra a referência órfã
        "PRKITMED": {"gravados": 2, "pendencias": {"adotado_existente": 2, "pai_inexistente": 3, "restricao_destino_1048": 3, "restricao_destino_4025": 1, "valor_fora_do_dominio": 1}},
        "PRITENSKITMED": {"gravados": 2, "pendencias": {"adotado_existente": 2, "pai_inexistente": 2, "pai_pendente": 3, "restricao_destino_1048": 1, "restricao_destino_4025": 1}},  # r6: itens do kit 6 recusado: pai_pendente
        "PRKITSOLITENS": {"gravados": 4, "pendencias": {"adotado_existente": 3, "pai_inexistente": 2, "restricao_destino_1048": 2, "valor_fora_do_dominio": 1}},
        "PRFAVORITO": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 3, "valor_fora_do_dominio": 3}},
        # rodada 3
        "PRITEM_GEITENS": {"gravados": 3, "pendencias": {"pai_inexistente": 3, "pai_pendente": 1,
                                                        "restricao_destino_1048": 1, "valor_fora_do_dominio": 2,
                                                        "valor_presumido": 4}},
        "PRITEMNAOPAD_TBPRINC": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "pai_pendente": 2,
                                                              "restricao_destino_4025": 1}},  # r6: princípio do hospital
        "TBALERGIA_TBPRINC": {"gravados": 4, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1,
                                                           "valor_fora_do_dominio": 1}},  # r6: princípio do hospital
        "PRPADEVOL": {"gravados": 4, "pendencias": {"adotado_existente": 2, "pai_inexistente": 2,
                                                   "restricao_destino_1048": 3, "valor_fora_do_dominio": 8}},
        # r6: sem tipo presumido (o tipo vem do de-para de TIPOPERG); fora do domínio: MANTERHIST 2/3, TIPOPERG 99 (tipo e
        # destino), obrigatório 'Z'; unidade 'kg' adotada pela sigla
        "PRFORMULCOMP": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 2}},
        # rodada 4
        # cabeçalho 2: autor, momento e gravação pelo menor evento e situação pelo maior ID (pendência baixa da escolha);
        # 7 dois eventos no mesmo instante (situação do maior ID); 3 paciente nunca visto; 4 sem evento com atendimento
        # (autor, momento e gravação pelo atendimento; situação sem semente nativa: pai_inexistente + 1048); 6 sem evento
        # nem atendimento (sem autor: recusa); 3, 4 e 6 recusados (1048)
        "PRASSINATURA_CAB": {"gravados": 4, "pendencias": {"pai_inexistente": 9, "restricao_destino_1048": 3,
                                                          "escolha_pelo_menor": 6, "escolha_pelo_maior": 2}},
        # itens gravados 1, 2, 4 em dois kits (cuidados 1 e 5); 7 deixa pai_inexistente nas 5 referências da unidade
        "TBKITPRO": {"gravados": 3, "pendencias": {"adotado_existente": 2, "pai_inexistente": 5, "pai_pendente": 1,
                                                  "restricao_destino_1048": 2, "restricao_destino_4025": 1}},
        "PRRESPOSTA": {"gravados": 5, "pendencias": {"pai_inexistente": 2}},
        # rodada 6: vínculo do filtro do painel com a classificação de despesa
        "PRAGRUP_PRFILTROCLASSIF": {"gravados": 1, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}},
        # rodada 5 (ADR 0006)
        "PRPARAM": {"gravados": 148, "pendencias": {"segredo_aguarda_cofre": 1, "vigencia_sem_fonte": 1}},
        # r6: uma linha, 148 parâmetros (151 desdobrados menos os 3 de hora nulos); a senha vai ao cofre (sem chave mestra
        # no descartável: segredo_aguarda_cofre, credencial opcional não grava e a linha fica; nunca em claro)
        "PRMANCHESTER": {"gravados": 6, "pendencias": {"restricao_destino_1048": 2, "restricao_destino_1406": 1,
                                                      "restricao_destino_1062": 1, "valor_fora_do_dominio": 3}},
    }


def __getattr__(nome):
    """`MAPA_TESTE` (lido pela conferência): o mapa REAL sem as declarações dos pais que a requerida L7-07 põe na
    imagem só para a referência ler a origem (ORIGEM_PAIS dela: TBCENCUS, TBPRINC, TBCBOPRO), como a própria L7-07
    faz; na carga real eles vêm antes, nas fatias donas."""
    if nome != "MAPA_TESTE":
        raise AttributeError(nome)
    _ORIGEM_SO_REF = ("TBCENCUS", "TBCBOPRO", "PRCADRESP")  # r5: PRCADRESP carrega na L6-05 (opção de parâmetro)
    from .. import mapa
    m = mapa.carregar_execucao()
    return dict(m, colunas_decl=[c for c in m["colunas_decl"] if c["tabela"] not in _ORIGEM_SO_REF])
