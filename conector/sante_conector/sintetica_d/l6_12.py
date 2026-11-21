"""Fatia L6-12 (prontuário, assinatura e assistência, módulo PEP): forma das tabelas da origem e anomalias, com dados
100% falsos. Rodada de cobertura total (F4).

Carregadas pelo mapa (colunas.d/L6-12.tsv): prescrição (PRPRESC), item (PRLANGERAL), medicamento (PRPRESCMED),
material (PRITENSGERAL), procedimento, dieta e característica, hemocomponente (PRPRESCHEMO), registro clínico
(PRCABEVOL), o texto dele (PRCONTEVOL, completa o registro) e as respostas (PREVOLPAC), alergia com evento, documento
emitido (PRATESTREQIMP) e evento de assinatura (PRASSINATURA_DOC).
Paciente, atendimento, profissional e usuário vêm por referência ENCADEADA pela origem: histórico do paciente
(HTPACIENTE -> RICADPAC), histórico do atendimento (HTATENDIMENTO -> ATCABECATEND), inscrição no conselho
(TBCBOPRO -> TBPROFIS) e inscrição -> profissional -> login (TBPROFIS -> TBUSERS). As intermediárias entram na imagem
com TODAS as colunas do dicionário (`conector/mapa/colunas.tsv`), com ids diferentes dos avós, para provar que a
referência direta não é usada. O profissional (TBPROFIS) é carregado pela declaração da L5-06; os demais avós são
pais externos. A alergia lê paciente, atendimento, data e autor do registro clínico pela origem dele. Unidade e
hemocomponente vêm por chave alternativa (sigla); o campo do modelo da resposta, pela opção -> pergunta -> ligação.
O princípio ativo da alergia (PRALERGIAPAC_TBPRINC) vem do catálogo oficial DCB pelo código guardado no princípio
da origem (TBPRINC, intermediária: encadeada terminada em coluna + `cod:principio_ativo.codigo_dcb`); o catálogo
oficial é preparado no destino (nunca gravado pelo conector). Descartes (sem_carga.tsv) entram só com a forma.
"""
import csv
import datetime
import os
from decimal import Decimal as D

FORMAS = {
    'PRASSINATURA_DOC': ('ID',
        'ID:INTEGER ID_PRASSINATURA_CAB:INTEGER ID_PRTPDOCUMENTO:SMALLINT ID_PRSITDOCUMENTO:SMALLINT '
        'ID_TBCBOPRO:INTEGER DATA_HORA_EVENTO:TIMESTAMP FUSO_HORARIO_EVENTO:SMALLINT HORARIO_VERAO_EVENTO:CHAR(1) '
        'DATA_HORA_EVENTO_UTC:VARCHAR(30) DATA_HORA_GRAVACAO:TIMESTAMP FUSO_HORARIO_GRAVACAO:SMALLINT '
        'HORARIO_VERAO_GRAVACAO:CHAR(1) DATA_HORA_GRAVACAO_UTC:VARCHAR(30) DOCUMENTO_ORIGINAL:BLOB1 '
        'ID_PRCADSTATUSORDEM_MEDICA:INTEGER SEARCH_MACHINE_REPLICATED:TIMESTAMP DOCUMENTO_XML_IMPRESSAO:BLOB1 '
        'CLASSIFICACAO_RISCO:CHAR(1) LEGADO:VARCHAR(1) ARQUIVO_EXPORTADO:VARCHAR(100) '),
    'PRASS_DOC_PREXAMEASS': ('ID',
        'ID:INTEGER ID_PRASSINATURA_DOC:INTEGER ID_PREXAMEASSINATURA:INTEGER '),
    'PRATESTREQIMP': ('ID',
        'ID:INTEGER ID_HTATENDIMENTO:BIGINT DATA_HORA_INCLUSAO:TIMESTAMP ID_HTPACIENTE:BIGINT ID_TBCBOPRO:INTEGER '
        'NOME_ATESTADO_MODELO:VARCHAR(50) CONTEUDO:BLOB0 ID_TBCBOPRO_SUSPENSAO:INTEGER '
        'DATA_HORA_SUSPENSAO:TIMESTAMP HORARIO_VERAO_SUSPENSAO:CHAR(1) JUSTIFICATIVA_SUSPENSAO:VARCHAR(70) '
        'PRE_IMPRESSO:CHAR(1) CONTEUDO_QRP:BLOB1 CONTEUDO_PDF:BLOB1 ASSINATURA:BLOB1 CONTEUDO_XML:BLOB1 '
        'FUSO_HORARIO_SUSPENSAO:SMALLINT FUSO_HORARIO_LANCAMENTO:SMALLINT HORARIO_VERAO_LANCAMENTO:CHAR(1) '
        'FUSO_HORARIO_INCLUSAO:SMALLINT HORARIO_VERAO_INCLUSAO:CHAR(1) ID_PRLOCAL_ASSISTENCIA:INTEGER '
        'DATA_HORA_INCLUSAO_UTC:VARCHAR(30) DATA_HORA_SUSPENSAO_UTC:VARCHAR(30) ID_TBPROFIS_ACOMP_RESP:INTEGER '
        'REGISTRO_VALIDO:CHAR(1) DATA_HORA_LANCAMENTO:TIMESTAMP DATA_HORA_LANCAMENTO_UTC:VARCHAR(30) '
        'JUSTIFICATIVA_LANC_RETROATIVO:VARCHAR(255) DATA_HORA_GRAVACAO_SUSPENSAO:TIMESTAMP '
        'DATA_HORA_GRAVACAO_SUSPENSA_UTC:VARCHAR(30) FUSO_HORARIO_GRAVACAO_SUSPENSAO:SMALLINT '
        'HORARIO_VERAO_GRAVACAO_SUSPENSA:CHAR(1) JUSTIFICATIVA_SUSP_RETROATIVA:VARCHAR(255) '
        'DATA_HORA_EXCLUSAO:TIMESTAMP DATA_HORA_ARQUIVADO:TIMESTAMP ID_PRATESTREQIMP:INTEGER '
        'ID_PRATESTREQIMP_ORIG_CORREC:INTEGER '),
    'PRCABEC_MONITORIZACAO': ('ID',
        'ID:INTEGER VIGENCIA_INICIAL:TIMESTAMP VIGENCIA_FINAL:TIMESTAMP ID_HTATENDIMENTO:BIGINT '
        'ID_HTPACIENTE:BIGINT VIGENCIA_INICIAL_UTC:VARCHAR(30) VIGENCIA_FINAL_UTC:VARCHAR(30) '
        'DATA_HORA_GRAVACAO:TIMESTAMP DATA_HORA_GRAVACAO_UTC:VARCHAR(30) '
        'JUSTIFICATIVA_LANC_RETROATIVO:VARCHAR(255) FUSO_HORARIO_VIGENCIA_INICIAL:SMALLINT '
        'HORARIO_VERAO_VIGENCIA_INICIAL:CHAR(1) FUSO_HORARIO_VIGENCIA_FINAL:SMALLINT '
        'HORARIO_VERAO_VIGENCIA_FINAL:CHAR(1) FUSO_HORARIO_GRAVACAO:SMALLINT HORARIO_VERAO_GRAVACAO:CHAR(1) '),
    'PRCABEVOL': ('ID_CABEVOL',
        'ID_CABEVOL:INTEGER ID_HTATENDIMENTO:BIGINT ID_HTPACIENTE:BIGINT ID_EVOLUCAO:INTEGER '
        'DATA_HORA_EVOLUCAO:TIMESTAMP OLD_REG:INTEGER OLD_TIPOATE:VARCHAR(1) OLD_CRM:INTEGER '
        'OLD_USUARIO:VARCHAR(31) OLD_USERSUSP:VARCHAR(31) ID_TBCBOPRO_EVOLUCAO:INTEGER '
        'ID_TBCBOPRO_SUSPENSAO:INTEGER DATA_HORA_SUSPENSAO:TIMESTAMP JUSTIFICATIVA_SUSPENSAO:VARCHAR(200) '
        'HORARIO_VERAO_EVOLUCAO:CHAR(1) DATA_HORA_LANCAMENTO:TIMESTAMP HORARIO_VERAO_LANCAMENTO:CHAR(1) '
        'HORARIO_VERAO_SUSPENSAO:CHAR(1) PRE_IMPRESSO:CHAR(1) ID_PRLANIMAG:INTEGER ID_TBPROFIS_ACOMP_RESP:INTEGER '
        'FUSO_HORARIO_SUSPENSAO:SMALLINT FUSO_HORARIO_LANCAMENTO:SMALLINT FUSO_HORARIO_EVOLUCAO:SMALLINT '
        'ID_PRLOCAL_ASSISTENCIA:INTEGER DATA_HORA_EVOLUCAO_UTC:VARCHAR(30) DATA_HORA_LANCAMENTO_UTC:VARCHAR(30) '
        'DATA_HORA_SUSPENSAO_UTC:VARCHAR(30) JUSTIFICATIVA_LANC_RETROATIVO:VARCHAR(255) '
        'DATA_HORA_GRAVACAO_SUSPENSAO:TIMESTAMP FUSO_HORARIO_GRAVACAO_SUSPENSAO:SMALLINT '
        'HORARIO_VERAO_GRAVACAO_SUSPENSA:CHAR(1) JUSTIFICATIVA_SUSP_RETROATIVA:VARCHAR(255) '
        'DATA_HORA_GRAVACAO_SUSPENSA_UTC:VARCHAR(30) ID_PRCABEVOL_ORIG_CORREC:INTEGER '
        'ARQUIVO_EXPORTADO:VARCHAR(100) ID_DIGITAL:VARCHAR(36) '),
    'PRALERGIAPAC': ('ID',
        'ID:INTEGER ID_PRCABEVOL:INTEGER ID_TBALERGIA:INTEGER RETIRAR_VINCULO_PACIENTE:CHAR(1) '
        'OBSERVACAO:VARCHAR(255) ACAO:CHAR(1) ACAO_DATA_HORA:TIMESTAMP ACAO_DATA_HORA_UTC:VARCHAR(30) '
        'ID_TBUSERS_ACAO:VARCHAR(31) ID_PRCABEVOL_ACAO:INTEGER '),
    'PRALERGIAPAC_TBPRINC': ('ID',
        'ID:INTEGER ID_PRALERGIAPAC:INTEGER ID_TBPRINC:INTEGER '),
    'PRCABEVOLTMP': ('ID_CABEVOL',
        'ID_CABEVOL:INTEGER ID_HTATENDIMENTO:BIGINT ID_HTPACIENTE:BIGINT ID_EVOLUCAO:INTEGER '
        'DATA_HORA_EVOLUCAO:TIMESTAMP ID_TBCBOPRO_EVOLUCAO:INTEGER ID_TBCBOPRO_SUSPENSAO:INTEGER '
        'DATA_HORA_SUSPENSAO:TIMESTAMP JUSTIFICATIVA_SUSPENSAO:VARCHAR(200) HORARIO_VERAO_EVOLUCAO:CHAR(1) '
        'DATA_HORA_LANCAMENTO:TIMESTAMP HORARIO_VERAO_LANCAMENTO:CHAR(1) HORARIO_VERAO_SUSPENSAO:CHAR(1) '
        'PRE_IMPRESSO:CHAR(1) ID_PRLANIMAG:INTEGER ID_TBPROFIS_ACOMP_RESP:INTEGER FUSO_HORARIO_SUSPENSAO:SMALLINT '
        'FUSO_HORARIO_LANCAMENTO:SMALLINT FUSO_HORARIO_EVOLUCAO:SMALLINT ID_PRLOCAL_ASSISTENCIA:INTEGER '
        'JUSTIFICATIVA_LANC_RETROATIVO:VARCHAR(255) DATA_HORA_GRAVACAO_SUSPENSAO:TIMESTAMP '
        'FUSO_HORARIO_GRAVACAO_SUSPENSAO:SMALLINT HORARIO_VERAO_GRAVACAO_SUSPENSA:CHAR(1) '
        'JUSTIFICATIVA_SUSP_RETROATIVA:VARCHAR(255) DATA_HORA_GRAVACAO_SUSPENSA_UTC:VARCHAR(30) '
        'DATA_HORA_EVOLUCAO_UTC:VARCHAR(30) DATA_HORA_EXCLUSAO:TIMESTAMP DATA_HORA_ARQUIVADO:TIMESTAMP '
        'ID_PRCABEVOLTMP:INTEGER DATA_HORA_LANCAMENTO_UTC:VARCHAR(30) DATA_HORA_SUSPENSAO_UTC:VARCHAR(30) '
        'ID_PRCABEVOL_ORIG_CORREC:INTEGER ARQUIVO_EXPORTADO:VARCHAR(100) '),
    'PRALERGIAPACTMP': ('ID',
        'ID:INTEGER ID_PRCABEVOL:INTEGER ID_TBALERGIA:INTEGER RETIRAR_VINCULO_PACIENTE:CHAR(1) '
        'OBSERVACAO:VARCHAR(255) '),
    'PRALERGIAPACTMP_TBPRINC': ('ID',
        'ID:INTEGER ID_PRALERGIAPAC:INTEGER ID_TBPRINC:INTEGER '),
    'PRCONTEVOL': ('ID',
        'ID:BIGINT ID_PRCABEVOL:INTEGER EVOLUCAO:BLOB1 EVOLUCAO_XML:BLOB1 ID_RIEVOLUCAOPAC:INTEGER '
        'DOCUMENTO_QRP:BLOB1 ASSINATURA:BLOB1 '),
    'PRGEDIMP': ('ID',
        'ID:INTEGER ID_RICADPAC:INTEGER ID_ATCABECATEND:BIGINT DATA_HORA_IMPORTACAO:TIMESTAMP '
        'ID_TBCBOPRO_IMPORTACAO:INTEGER MAQUINA_IMPORTACAO:VARCHAR(100) HORARIO_VERAO_IMPORTACAO:CHAR(1) '
        'DOCUMENTO:BLOB1 NOME_DOCUMENTO:VARCHAR(40) FUSO_HORARIO_IMPORTACAO:SMALLINT EXTENSAO:VARCHAR(10) '
        'IMAGEM:BLOB0 DOCUMENTO_COMPRESS:CHAR(1) DATA_HORA_IMPORTACAO_UTC:VARCHAR(30) '
        'DATA_HORA_SUSPENSAO:TIMESTAMP FUSO_HORARIO_SUSPENSAO:SMALLINT HORARIO_VERAO_SUSPENSAO:CHAR(1) '
        'DATA_HORA_SUSPENSAO_UTC:VARCHAR(30) DATA_HORA_EVENTO:TIMESTAMP FUSO_HORARIO_EVENTO:SMALLINT '
        'HORARIO_VERAO_EVENTO:CHAR(1) FUSO_HORARIO_GRAVACAO_SUSPENSAO:SMALLINT '
        'DATA_HORA_GRAVACAO_SUSPENSAO:TIMESTAMP HORARIO_VERAO_GRAVACAO_SUSPENSA:CHAR(1) '
        'JUSTIFICATIVA_EVENTO_RETROATIVO:VARCHAR(255) JUSTIFICATIVA_SUSPENSAO:VARCHAR(70) '
        'JUSTIFICATIVA_SUSP_RETROATIVA:VARCHAR(255) DATA_HORA_EVENTO_UTC:VARCHAR(30) '
        'DATA_HORA_GRAVACAO_SUSPENSA_UTC:VARCHAR(30) ID_TBCBOPRO_SUSPENSAO:INTEGER ID_PRTIPODOCANEXO:SMALLINT '
        'REFERENCIA:DATE ORIGEM:SMALLINT LOCAL_ORIGEM:VARCHAR(255) ID_HTATENDIMENTO:BIGINT ID_HTPACIENTE:BIGINT '
        'DATA_HORA_STORAGE:TIMESTAMP ARQUIVO_EXPORTADO:VARCHAR(100) '),
    'PRPLANPRESC': ('ID',
        'ID:INTEGER ID_HTPACIENTE:BIGINT ID_HTATENDIMENTO:BIGINT ID_ATCABECATEND_INTEGRACAO:BIGINT '
        'DATA_HORA_PRESCRICAO:TIMESTAMP DATA_HORA_INICIAL_VIGENCIA:TIMESTAMP DATA_HORA_FINAL_VIGENCIA:TIMESTAMP '
        'TP_PRESCRICAO:CHAR(1) OBS_GERAL_PRESCRICAO:BLOB1 ID_TBCBOPRO_PRESCRICAO:INTEGER '
        'ID_TBPROFIS_ACOMP_RESP:INTEGER FUSO_HORARIO_PRESCRICAO:SMALLINT HORARIO_VERAO_PRESCRICAO:CHAR(1) '
        'DATA_HORA_INICIAL_VIGENCIA_UTC:VARCHAR(30) DATA_HORA_FINAL_VIGENCIA_UTC:VARCHAR(30) '
        'DATA_HORA_PRESCRICAO_UTC:VARCHAR(30) DATA_HORA_GRAVACAO:TIMESTAMP DATA_HORA_GRAVACAO_UTC:VARCHAR(30) '
        'JUSTIFICATIVA_LANC_RETROATIVO:VARCHAR(255) LANCAMENTO_RETROATIVO:CHAR(1) ID_PRLOCAL_ASSISTENCIA:INTEGER '),
    'PRPRESC': ('ID',
        'ID:INTEGER ID_HTPACIENTE:BIGINT ID_HTATENDIMENTO:BIGINT ID_ATCABECATEND_INTEGRACAO:BIGINT '
        'DATA_HORA_PRESCRICAO:TIMESTAMP TP_PRESCRICAO:CHAR(1) DATA_HORA_INICIAL_VIGENCIA:TIMESTAMP '
        'DATA_HORA_FINAL_VIGENCIA:TIMESTAMP OBS_GERAL_PRESCRICAO:BLOB1 ID_TBCBOPRO_PRESCRICAO:INTEGER '
        'ID_TBCBOPRO_SUSPENSAO:INTEGER DATA_HORA_SUSPENSAO:TIMESTAMP JUSTIFICATIVA_SUSPENSAO:VARCHAR(200) '
        'GERAR_FOLHA_SALA:CHAR(1) OLD_REG:INTEGER OLD_TIPOATE:VARCHAR(1) OLD_SEQ:SMALLINT '
        'OLD_MODALIDADE:VARCHAR(1) OLD_LITERATURA:VARCHAR(2000) OLD_MOTIVO:VARCHAR(2000) OLD_STATUS:VARCHAR(1) '
        'OLD_USERPRESC:VARCHAR(31) OLD_USERSUSP:VARCHAR(31) OLD_DATASUSP:DATE OLD_HORASUSP:VARCHAR(4) '
        'OLD_UNID:SMALLINT OLD_CONTA:INTEGER OLD_PESO:NUMERIC(9,3) OLD_ALTURA:NUMERIC(9,2) OLD_SC:NUMERIC(9,3) '
        'OLD_CREATININA:NUMERIC(4,2) OLD_TFG:NUMERIC(9,3) OLD_AUC:NUMERIC(9,3) OLD_TIG:NUMERIC(9,3) '
        'OLD_FORMULA_SC:SMALLINT OLD_THT:NUMERIC(9,3) COD_AGRUPAMENTO_PRESCRICAO:INTEGER ID_RIEVOLUCAOPAC:INTEGER '
        'FUSO_HORARIO_PRESCRICAO:SMALLINT HORARIO_VERAO_PRESCRICAO:CHAR(1) FUSO_HORARIO_SUSPENSAO:SMALLINT '
        'HORARIO_VERAO_SUSPENSAO:CHAR(1) ID_PRLOCAL_ASSISTENCIA:INTEGER '
        'DATA_HORA_INICIAL_VIGENCIA_UTC:VARCHAR(30) DATA_HORA_FINAL_VIGENCIA_UTC:VARCHAR(30) '
        'DATA_HORA_PRESCRICAO_UTC:VARCHAR(30) DATA_HORA_SUSPENSAO_UTC:VARCHAR(30) DATA_HORA_GRAVACAO:TIMESTAMP '
        'DATA_HORA_GRAVACAO_UTC:VARCHAR(30) JUSTIFICATIVA_LANC_RETROATIVO:VARCHAR(255) '
        'LANCAMENTO_RETROATIVO:CHAR(1) FUSO_HORARIO_GRAVACAO:SMALLINT HORARIO_VERAO_GRAVACAO:CHAR(1) '
        'DATA_HORA_GRAVACAO_SUSPENSAO:TIMESTAMP FUSO_HORARIO_GRAVACAO_SUSPENSAO:SMALLINT '
        'HORARIO_VERAO_GRAVACAO_SUSPENSA:CHAR(1) DATA_HORA_GRAVACAO_SUSPENSA_UTC:VARCHAR(30) '
        'JUSTIFICATIVA_SUSP_RETROATIVA:VARCHAR(255) FUSO_HORARIO_INICIAL_VIGENCIA:SMALLINT '
        'HORARIO_VERAO_INICIAL_VIGENCIA:CHAR(1) FUSO_HORARIO_FINAL_VIGENCIA:SMALLINT '
        'HORARIO_VERAO_FINAL_VIGENCIA:CHAR(1) ID_DIGITAL:VARCHAR(36) '),
    'PRLANGERAL': ('ID',
        'ID:INTEGER ID_PRPRESC:INTEGER ID_PRPROTGERAL:INTEGER ID_PRTPLAN:SMALLINT NUM_DOSE:SMALLINT '
        'ID_PRFREQUENCIA:SMALLINT ID_GETABVIA:VARCHAR(2) ITEM_IMPRESSO:CHAR(1) ID_TBCBOPRO_LANCAMENTO:INTEGER '
        'JUSTIFICATIVA_INC_ITEM_AVULSO:VARCHAR(200) OBS_ENFERMAGEM:VARCHAR(250) OLD_ITEM:INTEGER OLD_SEQ:SMALLINT '
        'OLD_HM:SMALLINT OLD_VIA_ADM:SMALLINT OLD_VIA_EV:VARCHAR(1) OLD_VIA:VARCHAR(2) OLD_TPLAN:VARCHAR(2) '
        'OLD_ID_LAN:INTEGER OLD_PROCTO:INTEGER OLD_DIETA:SMALLINT OLD_ID_HEMOTLAN:INTEGER OLD_OBS:BLOB1 '
        'OLD_VOL_DOSE:NUMERIC(18,3) OLD_UNIDADE:SMALLINT OLD_VOL_TOTAL:NUMERIC(18,3) OLD_TEMPTOTAL:VARCHAR(20) '
        'OLD_BOMBA:VARCHAR(1) OLD_AGORA:VARCHAR(1) OLD_ACM:VARCHAR(1) OLD_NECESSARIO:VARCHAR(1) '
        'OLD_NAOAJUSTAR:VARCHAR(1) OLD_FEBRE:VARCHAR(1) OLD_DOR:VARCHAR(1) OLD_VOMITO:VARCHAR(1) '
        'OLD_OUTROS:VARCHAR(1) OLD_STATUS:VARCHAR(1) OLD_OBSENF:BLOB1 OLD_INDEXHM:SMALLINT OLD_DOC:INTEGER '
        'OLD_ANODOC:SMALLINT OLD_ID_ITEMNAOPAD:INTEGER OLD_JUSTIFNAOPAD:VARCHAR(200) OLD_USERLAN:VARCHAR(31) '
        'OLD_VOL_ADM:NUMERIC(18,3) OLD_VELOCIDADE:NUMERIC(9,3) OLD_VELOC_UNID:SMALLINT OLD_ID_GELANSAI:INTEGER '
        'OLD_UNI_PRESC:VARCHAR(7) OLD_QTDECALC:NUMERIC(18,3) OLD_FORMULA:SMALLINT OLD_VOL_KG:NUMERIC(18,3) '
        'OLD_ID_GENOMCOM:INTEGER OLD_MESDOC:SMALLINT OLD_ID_PRLOCALINVASIVO:SMALLINT OLD_ID_HTCID:INTEGER '
        'ID_PRPLANPRESC:INTEGER OBS_MEDICA_PARA_CHECAGEM_ENF:BLOB1 ID_TBCBOPRO_SUSP_CORRECAO:INTEGER '
        'DATA_HORA_SUSP_CORRECAO:TIMESTAMP FUSO_HORARIO_SUSP_CORRECAO:SMALLINT '
        'HORARIO_VERAO_SUSP_CORRECAO:CHAR(1) DATA_HORA_INCLUSAO:TIMESTAMP FUSO_HORARIO_INCLUSAO:SMALLINT '
        'HORARIO_VERAO_INCLUSAO:CHAR(1) DATA_HORA_INCLUSAO_UTC:VARCHAR(30) '
        'DATA_HORA_SUSP_CORRECAO_UTC:VARCHAR(30) DATA_HORA_GRAVACAO:TIMESTAMP FUSO_HORARIO_GRAVACAO:SMALLINT '
        'HORARIO_VERAO_GRAVACAO:CHAR(1) DATA_HORA_GRAVACAO_UTC:VARCHAR(30) ID_PRLANGERAL_AGRUPAMENTO:INTEGER '
        'ID_PRPRESCFUTURA:INTEGER ITEM_INCLUIDO_JSON_DIGITAL:CHAR(1) ID_DIGITAL:VARCHAR(36) '),
    'PRPRESCDIETA': ('ID',
        'ID:INTEGER ID_PRLANGERAL:INTEGER ID_TBDIETAS:SMALLINT ID_PRVIAADMIN:SMALLINT QTDE_DOSE:NUMERIC(18,3) '
        'ID_TBUNICON_UNI_PRESC:VARCHAR(7) ID_PRTPINFUSAO:SMALLINT VELOCIDADE_INFUSAO:NUMERIC(9,3) '
        'ID_PRUNIDINFUSAO:SMALLINT '),
    'PRCARACTLAN': ('ID_PRCARACTDIE,ID_PRPRESCDIETA',
        'ID_PRCARACTDIE:INTEGER ID_PRPRESCDIETA:INTEGER OLD_ID_GERAL:INTEGER RESPOSTA:VARCHAR(50) '
        'ID_PRUNIDRESPOSTA:SMALLINT '),
    'PRPRESCHEMO': ('ID',
        'ID:INTEGER ID_PRLANGERAL:INTEGER ATO_SITABPRO:SMALLINT CODALF_SITABPRO:VARCHAR(4) '
        'QTDE_DOSE:NUMERIC(18,3) ID_TBUNICON_UNI_PRESC:VARCHAR(7) VELOCIDADE_INFUSAO:NUMERIC(18,3) '
        'ID_PRUNIDINFUSAO:SMALLINT ID_PRTPINFUSAO:SMALLINT INDICACAO_CLINICA:BLOB1 INICIAR_ADM_AGORA:CHAR(1) '
        'NAO_AJUSTAR_ESQUEMA_ENF:CHAR(1) '),
    'PRPRESCMED': ('ID',
        'ID:INTEGER ID_PRLANGERAL:INTEGER ID_GEITENS:INTEGER ID_GENOMCOM:INTEGER ID_PRITEMNAOPAD:INTEGER '
        'JUSTIFICATIVA_NAO_PADRONIZ:VARCHAR(200) ID_HTCID_NAO_PADRONIZ:INTEGER QTDE:NUMERIC(18,3) '
        'ID_PRFORMULA:SMALLINT QTDE_DOSE:NUMERIC(18,3) ID_TBUNICON_UNI_PRESC:VARCHAR(7) INICIAR_ADM_AGORA:CHAR(1) '
        'NAO_AJUSTAR_ESQUEMA_ENF:CHAR(1) TEMPO_INFUSAO:TIME DOSE_EXTRA_ANTIMICROBIANO:CHAR(1) '
        'INTERVALO_ENTRE_DOSES:INTEGER JUSTIFICATIVA_ITEM_ALERGICO:VARCHAR(255) '),
    'PRITENSGERAL': ('ID',
        'ID:INTEGER ID_PRLANGERAL:INTEGER ID_GEITENS:INTEGER ID_GENOMCOM:INTEGER ID_PRITEMNAOPAD:INTEGER '
        'JUSTIFICATIVA_NAO_PADRONIZ:VARCHAR(200) ID_HTCID_NAO_PADRONIZ:INTEGER QTDE:NUMERIC(18,3) '
        'ID_PRFORMULA:SMALLINT QTDE_DOSE:NUMERIC(18,3) ID_TBUNICON_UNI_PRESC:VARCHAR(7) '
        'JUSTIFICATIVA_INC_ITEM_ENF:VARCHAR(200) OBS_ENFERMAGEM:VARCHAR(250) ITEM_IMPRESSO:CHAR(1) '
        'IMPRIMIR_FOLHA_SALA:CHAR(1) ID_PRLOCALINVASIVO:SMALLINT OLD_ITEM:INTEGER OLD_QTDE:NUMERIC(18,3) '
        'OLD_QTDEADM:NUMERIC(18,3) OLD_JUSTIFICATIVA:VARCHAR(200) OLD_OBSENF:BLOB1 OLD_STATUS:VARCHAR(1) '
        'OLD_ID_ITEMNAOPAD:INTEGER OLD_JUSTIFNAOPAD:VARCHAR(200) OLD_ITEMIMPRESSO:VARCHAR(1) OLD_FORMULA:SMALLINT '
        'OLD_UNI_PRESC:VARCHAR(7) OLD_ID_GELANSAI:INTEGER OLD_ID_GENOMCOM:INTEGER OLD_ID_PRLOCALINVASIVO:SMALLINT '
        'OLD_FOLHA_SALA:CHAR(1) OLD_ID_HTCID:INTEGER ITEM_KIT:CHAR(1) DOSE_EXTRA_ANTIMICROBIANO:CHAR(1) '
        'ID_PRKITSOL:INTEGER JUSTIFICATIVA_ITEM_ALERGICO:VARCHAR(255) ID_DIGITAL:VARCHAR(36) '),
    'PREVOLPAC': ('ID',
        'ID:INTEGER ID_CABEVOL:INTEGER SEQ:SMALLINT ID_RESPOSTA:INTEGER UNIDRESP:VARCHAR(10) CONTEVOL:BLOB1 '
        'RESPDATA:DATE RESPHORA:VARCHAR(4) RESPSNAO:VARCHAR(5) RESPVALOR:NUMERIC(18,3) RESPALFA:VARCHAR(255) '
        'ORDEM:VARCHAR(15) TAB:SMALLINT ID_HTPROCTO:INTEGER ID_HTCID:INTEGER RESPDATA_UTC:VARCHAR(30) '
        'OBSERVACAO:VARCHAR(255) AUTOPREENCHIDO:CHAR(1) JUSTIFICATIVA_DIAGNOSTICO:VARCHAR(254) '),
    'PRPRESCPROCED': ('ID',
        'ID:INTEGER ID_PRLANGERAL:INTEGER ID_TBPROENF:INTEGER INICIAR_ADM_AGORA:CHAR(1) '
        'NAO_AJUSTAR_ESQUEMA_ENF:CHAR(1) '),
}


# intermediárias da referência encadeada (de outras fatias): todas as colunas do dicionário, chave ID
_TIPOS_FB = {"DOUBLE": "DOUBLE PRECISION", "BLOB": "BLOB SUB_TYPE 0"}
INTERMEDIARIAS = ("HTPACIENTE", "HTATENDIMENTO", "TBCBOPRO", "TBPROFIS", "PRRESPOSTA", "PRPADEVOL", "PRHEMOTLAN",
                  "TBUNIDADEMEDIDA", "TBPRINC", "PREVOLUCAO", "PRPERGUNTA", "PRCADRESP")
# chave das intermediárias (as demais: ID). PRHEMOTLAN, TBUNIDADEMEDIDA (L7-01, L6-10), PREVOLUCAO, PRPADEVOL e
# PRRESPOSTA (L6-11, rodada 3) são carregadas pela declaração das outras fatias: o campo do modelo e a opção da
# resposta saem do destino que elas gravam. PRPERGUNTA e PRCADRESP só são lidas (título do campo e rótulo da opção)
CHAVE_INTER = {"PRRESPOSTA": "ID_RESPOSTA", "PRHEMOTLAN": "ID_HEMOTLAN", "TBPRINC": "COD", "PREVOLUCAO": "ID_EVOLUCAO",
               "PRCADRESP": "COD"}


def _dicionario():
    arq = os.path.join(os.path.dirname(__file__), "..", "..", "mapa", "colunas.tsv")
    cols = {t: [] for t in INTERMEDIARIAS}
    with open(arq, encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            if r["tabela"] in cols:
                cols[r["tabela"]].append((r["coluna"], _TIPOS_FB.get(r["forma"], r["forma"])))
    return cols


COLS_INTER = _dicionario()

_TIPO = {"BLOB1": "BLOB SUB_TYPE 1", "BLOB0": "BLOB SUB_TYPE 0"}


def _colunas(t):
    if t in COLS_INTER:
        return COLS_INTER[t]
    return [c.split(":", 1) for c in FORMAS[t][1].split()]


DDL = "".join("CREATE TABLE %s (%s, PRIMARY KEY (%s));\n" % (
    t, ", ".join('"%s" %s' % (c, _TIPO.get(f, f)) for c, f in _colunas(t)), k)
    for t, k in [(t, FORMAS[t][0]) for t in FORMAS] + [(t, CHAVE_INTER.get(t, "ID")) for t in INTERMEDIARIAS])

# avós da referência encadeada e pais de fora da fatia, registrados como já carregados (ids diferentes das
# intermediárias: a referência direta não acharia nada)
PAIS_EXTERNOS = {"RICADPAC": [1, 2], "ATCABECATEND": [1, 2], "TBUSERS": ["USR1", "USR2"], "TBPESSOA": [1, 2],
                 "PRLOCAL_ASSISTENCIA": [1], "PRTPCOMP": [1], "PRASSINATURA_CAB": [1, 2], "PRSITDOCUMENTO": [1],
                 "TBALERGIA": [1], "PRTPLAN": [1, 2], "PRFREQUENCIA": [1], "GETABVIA": ["VO", "EV"],
                 "PRPROTGERAL": [1], "TBPROENF": [1, 2], "PRTPINFUSAO": [1], "TBDIETAS": [1, 2], "PRVIAADMIN": [1],
                 "PRUNIDINFUSAO": [1], "PRCARACTDIE": [1, 2], "GEITENS": [1, 2], "PRITEMNAOPAD": [1],
                 "PRFORMULA": [1], "PRKITSOL": [1]}
# único estabelecimento do cliente de exemplo (o @estabelecimento resolve por ele)
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');"
                   # catálogo oficial DCB (do carregador oficial; aqui a forma mínima e dois códigos inventados): o
                   # conector só lê
                   " CREATE TABLE IF NOT EXISTS principio_ativo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo_dcb VARCHAR(10) NOT NULL UNIQUE, descricao VARCHAR(255) NOT NULL,"
                   " versao_fonte VARCHAR(30) NOT NULL, criado_em DATETIME(3) NOT NULL);"
                   " INSERT IGNORE INTO principio_ativo (codigo_dcb, descricao, versao_fonte, criado_em) VALUES"
                   " ('01234', 'Principio falso A', 'exemplo', NOW(3)), ('00777', 'Principio falso B', 'exemplo',"
                   " NOW(3))")

T0 = datetime.datetime(2026, 3, 2, 8, 30)
SENTINELA = datetime.datetime(1899, 12, 30)


def _h(horas):
    return T0 + datetime.timedelta(hours=horas)


class _Hora:
    """TIME literal do isql (o gerador só cita texto e data)."""
    def __init__(self, h):
        self.h = h

    def __str__(self):
        return "'%s'" % self.h


def linhas(r, ins):
    def linha(t, **v):
        ins(t, [v.get(c) for c, _ in _colunas(t)])

    # intermediárias: histórico do paciente 101/102 -> pacientes 1/2, 103 -> paciente 9 nunca visto; histórico do
    # atendimento 201/202 -> atendimentos 1/2; inscrição 301/302 -> profissionais 1/2, 303 -> profissional 9 (não existe)
    for i, pac in ((101, 1), (102, 2), (103, 9)):
        linha("HTPACIENTE", ID=i, ID_RICADPAC=pac, DATA_HORA_HISTORICO=_h(-48))
    for i, atd in ((201, 1), (202, 2)):
        linha("HTATENDIMENTO", ID=i, ID_ATCABECATEND=atd, DATA_HORA_HISTORICO=_h(-48))
    for i, prof in ((301, 1), (302, 2), (303, 9)):
        linha("TBCBOPRO", ID=i, ID_TBPROFIS=prof, ID_TBCBOSUS=1, UF="SP", COD=7000 + i, VINC_EMPR="N")
    for i in (1, 2):
        linha("TBPROFIS", ID=i, ID_TBPESSOA=i, NOME="Profissional falso %d" % i, APELIDO="Dr. Exemplo %d" % i,
              ID_TBUSERS="USR%d" % i, SITUACAO="A", DATA_INICIO=datetime.date(2020, 1, i))

    # prescrições: 1 e 2 normais (2 suspensa); 3 fim antes do início (CHECK); 4 prescrita na data sentinela
    # (NOT NULL); 5 retroativa sem justificativa (CHECK); 6 histórico de paciente nunca visto (NOT NULL)
    for i, pac, ini, fim, dt, retro in [(1, 101, 0, 24, 0, "N"), (2, 102, 1, 25, 1, "N"), (3, 101, 24, 2, 2, "N"),
                                        (4, 102, 0, 24, None, "N"), (5, 101, 0, 24, 3, "S"), (6, 103, 0, 24, 4, "N")]:
        extra = {}
        if i == 2:
            extra = {"DATA_HORA_SUSPENSAO": _h(5), "ID_TBCBOPRO_SUSPENSAO": 302,
                     "JUSTIFICATIVA_SUSPENSAO": "Suspensão de teste nº %d" % i}
        linha("PRPRESC", ID=i, ID_HTPACIENTE=pac, ID_HTATENDIMENTO=200 + (1 + i % 2), ID_PRLOCAL_ASSISTENCIA=1,
              ID_TBCBOPRO_PRESCRICAO=301, DATA_HORA_PRESCRICAO=SENTINELA if dt is None else _h(dt), TP_PRESCRICAO="X" if i == 1 else "G",
              DATA_HORA_INICIAL_VIGENCIA=_h(ini), DATA_HORA_FINAL_VIGENCIA=_h(fim), COD_AGRUPAMENTO_PRESCRICAO=1,
              OBS_GERAL_PRESCRICAO=("Observação geral\r\n  linha dois  %d" % i).encode("cp1252"),
              OLD_PESO=D("%d.250" % r.randint(40, 90)), DATA_HORA_GRAVACAO=_h(dt or 0), DATA_HORA_GRAVACAO_UTC="x",
              LANCAMENTO_RETROATIVO=retro, **extra)
    # itens: 1, 2, 5 e 7 na prescrição 1 (sequência pela ordem); 3 e 6 na 2 (3 suspenso por correção); 4 na 3
    # (recusada: pai_pendente); 5 sem data de inclusão (NOT NULL); 6 via de uso sem par (NULL com pendência);
    # 7 observação acima de 2000 (1406); 8 de planejamento, sem prescrição (NOT NULL)
    for i, presc, via, inc, obs in [(1, 1, "VO", 0, None), (2, 1, "EV", 0, None), (3, 2, "VO", 1, None),
                                    (4, 3, "VO", 2, None), (5, 1, "VO", None, None), (6, 2, "XX", 1, None),
                                    (7, 1, None, 0, "x" * 2100), (8, None, "VO", 0, None)]:
        linha("PRLANGERAL", ID=i, ID_PRPRESC=presc, ID_PRTPLAN=1 + i % 2, ID_PRFREQUENCIA=1, ID_GETABVIA=via,
              ID_PRPROTGERAL=1 if i == 1 else None, ID_TBCBOPRO_LANCAMENTO=301 + i % 2,
              OBS_ENFERMAGEM="Cuidado %d" % i, DATA_HORA_INCLUSAO=None if inc is None else _h(inc),
              OBS_MEDICA_PARA_CHECAGEM_ENF=obs.encode("cp1252") if obs else None,
              DATA_HORA_SUSP_CORRECAO=_h(3) if i == 3 else None, ID_TBCBOPRO_SUSP_CORRECAO=302 if i == 3 else None,
              ID_PRPLANPRESC=1 if i == 8 else None)
    # procedimentos: 2 repete o item 1 (UNIQUE); 3 cuidado nunca visto (NULL, e o CHECK de alvo recusa); 4 item
    # recusado (pai_pendente); 5 S/N inválido (NULL com pendência: fica o padrão do destino)
    for i, item, proc, agora in [(1, 1, 1, "S"), (2, 1, 2, "N"), (3, 3, 99, "N"), (4, 4, 1, "N"), (5, 6, 2, "X")]:
        linha("PRPRESCPROCED", ID=i, ID_PRLANGERAL=item, ID_TBPROENF=proc, INICIAR_ADM_AGORA=agora,
              NAO_AJUSTAR_ESQUEMA_ENF="N")
    # dietas: 2 velocidade sem unidade (CHECK); 3 modalidade nunca vista (NOT NULL)
    for i, item, dieta, vel, unid in [(1, 3, 1, D("50.000"), 1), (2, 6, 2, D("30.000"), None), (3, 2, 99, None, None)]:
        linha("PRPRESCDIETA", ID=i, ID_PRLANGERAL=item, ID_TBDIETAS=dieta, ID_PRVIAADMIN=1, QTDE_DOSE=D("200.000"),
              ID_TBUNICON_UNI_PRESC="ML", ID_PRTPINFUSAO=1, VELOCIDADE_INFUSAO=vel, ID_PRUNIDINFUSAO=unid)
    # características (chave composta): a terceira aponta a dieta recusada
    for car, dieta, resp in [(1, 1, "Branda"), (2, 1, None), (1, 2, "Pastosa")]:
        linha("PRCARACTLAN", ID_PRCARACTDIE=car, ID_PRPRESCDIETA=dieta, RESPOSTA=resp, ID_PRUNIDRESPOSTA=1)
    # hemoterapia: 1 no item 1 (sigla e unidade com par); 2 item recusado (pai_pendente); 3 item nunca visto (NOT
    # NULL); 4 sigla sem hemocomponente (pai_inexistente, NOT NULL); 5 sem indicação clínica (NOT NULL)
    for i, item, sigla, ind in [(1, 1, "HM01", "Anemia sintomática " * 120), (2, 4, "HM01", "Plaquetopenia"),
                                (3, 99, "HM01", "Sem item"), (4, 2, "ZZ99", "Sigla sem cadastro"), (5, 3, "HM01", None)]:
        linha("PRPRESCHEMO", ID=i, ID_PRLANGERAL=item, ATO_SITABPRO=1, CODALF_SITABPRO=sigla, QTDE_DOSE=D("2.000"),
              ID_TBUNICON_UNI_PRESC="ML", INDICACAO_CLINICA=ind.encode("cp1252") if ind else None,
              INICIAR_ADM_AGORA="N", NAO_AJUSTAR_ESQUEMA_ENF="S", ID_PRUNIDINFUSAO=1, ID_PRTPINFUSAO=1,
              VELOCIDADE_INFUSAO=D("100.000"))
    # medicamentos: 1 padronizado (o item prescritível do insumo ainda não é gravado: CHECK); 2 não padronizado com
    # justificativa e tempo de infusão (gravado); 3 não padronizado sem justificativa (CHECK); 4 unidade sem par
    # (pai_inexistente, NOT NULL); 5 item recusado (pai_pendente)
    for i, item, geitem, naopad, just, unid in [(1, 1, 1, None, None, "MG"), (2, 2, None, 1, "Sem similar", "MG"),
                                                (3, 3, None, 1, None, "MG"), (4, 6, None, 1, "Sem similar", "ZZ"),
                                                (5, 4, None, 1, "Sem similar", "MG")]:
        linha("PRPRESCMED", ID=i, ID_PRLANGERAL=item, ID_GEITENS=geitem, ID_PRITEMNAOPAD=naopad,
              JUSTIFICATIVA_NAO_PADRONIZ=just, QTDE=D("3.000"), ID_PRFORMULA=1, QTDE_DOSE=D("500.000"),
              ID_TBUNICON_UNI_PRESC=unid, INICIAR_ADM_AGORA="S", NAO_AJUSTAR_ESQUEMA_ENF="N",
              TEMPO_INFUSAO=_Hora("00:30:00") if i == 2 else None, DOSE_EXTRA_ANTIMICROBIANO="N")
    # materiais: 1 e 2 no item 1 (sequência 1 e 2); 3 quantidade zero (CHECK); 4 insumo nunca visto e sem não
    # padronizado (pai_inexistente e CHECK de alvo); 5 item recusado (pai_pendente)
    for i, item, geitem, qtd in [(1, 1, 1, "2.000"), (2, 1, 2, "1.000"), (3, 2, 1, "0.000"), (4, 3, 99, "1.000"),
                                 (5, 4, 1, "1.000")]:
        linha("PRITENSGERAL", ID=i, ID_PRLANGERAL=item, ID_GEITENS=geitem, QTDE_DOSE=D(qtd),
              ID_TBUNICON_UNI_PRESC="UN", ITEM_KIT="N", IMPRIMIR_FOLHA_SALA="S", DOSE_EXTRA_ANTIMICROBIANO="N",
              ID_PRKITSOL=1 if i == 1 else None, OBS_ENFERMAGEM="Material %d" % i)
    # cadastros lidos por chave alternativa e encadeada (unidade e hemocomponente carregados pela L6-10 e L7-01):
    # unidade pela sigla (ML, MG, UN), hemocomponente pela sigla HM01, opção -> pergunta -> ligação modelo x
    # pergunta (pergunta 12 em dois modelos: pai_ambiguo)
    for i, sig in ((1, "ML"), (2, "MG"), (3, "UN")):
        linha("TBUNIDADEMEDIDA", ID=i, NOME="Unidade falsa %d" % i, SIMBOLO="u%d" % i, SIGLA_API=sig, SITUACAO="A")
    linha("PRHEMOTLAN", ID_HEMOTLAN=1, ATO=1, CODALF="HM01")
    # modelos 1 e 2 (tipo de documento 1, pai externo), perguntas 10 a 12 e textos de resposta 1 a 3 (só lidos)
    for i in (1, 2):
        linha("PREVOLUCAO", ID_EVOLUCAO=i, DESCRICAO="Modelo falso %d" % i, ID_PRTPCOMP=1)
    for i in (10, 11, 12):
        linha("PRPERGUNTA", ID=i, COD_PERGUNTA=i, COLUNA=1, DESCRICAO="Pergunta falsa %d" % i, ATIVO="S")
    for i in (1, 2, 3):
        linha("PRCADRESP", COD=i, DESCRICAO="Resposta falsa %d" % i)
    for i, perg in ((1, 10), (2, 11), (3, 12)):
        linha("PRRESPOSTA", ID_RESPOSTA=i, ID_PRPERGUNTA=perg, COD=i, CONTEVOL=b"Opcao falsa", ATIVO="S", ORDEM=i)
    for i, modelo, perg in ((1, 1, 10), (2, 1, 11), (3, 1, 12), (4, 2, 12)):
        linha("PRPADEVOL", ID=i, ID_EVOLUCAO=modelo, ID_PRPERGUNTA=perg, ORDEM="%02d" % i, ATIVO="S")
    # registros clínicos: 1 normal; 2 suspenso (excluído logicamente) e correção do 1 (fase 2); 3 inscrição de
    # profissional inexistente (profissional e usuário pai_inexistente, NOT NULL); 4 modelo nunca visto (NOT NULL)
    for i, pac, atd, modelo, autor in [(1, 101, 201, 1, 301), (2, 102, 202, 1, 302), (3, 101, 201, 1, 303),
                                       (4, 102, 202, 99, 301)]:
        extra = {}
        if i == 2:
            extra = {"DATA_HORA_SUSPENSAO": _h(6), "ID_TBCBOPRO_SUSPENSAO": 302, "ID_PRCABEVOL_ORIG_CORREC": 1,
                     "JUSTIFICATIVA_SUSPENSAO": "Registro em paciente errado"}
        linha("PRCABEVOL", ID_CABEVOL=i, ID_HTPACIENTE=pac, ID_HTATENDIMENTO=atd, ID_EVOLUCAO=modelo,
              ID_TBCBOPRO_EVOLUCAO=autor, ID_PRLOCAL_ASSISTENCIA=1, DATA_HORA_EVOLUCAO=_h(i),
              DATA_HORA_LANCAMENTO=_h(i), **extra)
    # texto do registro (completa): 10 e 11 nos registros 1 e 2; 12 no registro recusado (pai_pendente);
    # 13 em registro nunca visto (recusa pai_inexistente)
    for i, cab in [(10, 1), (11, 2), (12, 3), (13, 77)]:
        linha("PRCONTEVOL", ID=i, ID_PRCABEVOL=cab, EVOLUCAO=("Evolução %d\r\n  Paciente estável." % i).encode("cp1252"))
    # alergias: 1 ativa; 2 retirada do paciente com data e usuário da ação (inativa); 3 em registro recusado
    # (pai_pendente); 4 alérgeno nunca visto (NULL e o CHECK de alergia recusa); 5 retirada sem data da ação (CHECK)
    for i, cab, alg, ret in [(1, 1, 1, "F"), (2, 2, 1, "T"), (3, 3, 1, "F"), (4, 1, 99, None), (5, 1, 1, "T")]:
        acao = {"ACAO": "R", "ACAO_DATA_HORA": _h(7), "ID_TBUSERS_ACAO": "USR2"} if i == 2 else {}
        linha("PRALERGIAPAC", ID=i, ID_PRCABEVOL=cab, ID_TBALERGIA=alg, RETIRAR_VINCULO_PACIENTE=ret,
              OBSERVACAO="Reação leve %d" % i, **acao)
    # respostas do registro: 1 e 2 no registro 1 (sequência 1 e 2), 3 no registro 2 (autopreenchida); 4 registro
    # recusado (pai_pendente); 5 opção de pergunta em dois modelos: a opção é recusada na L6-11 (pai_ambiguo lá) e a
    # resposta fica pai_pendente (entra quando a opção entrar); 6 opção nunca vista (NOT NULL);
    # 7 hora inválida (NULL com hora_invalida, gravada). A hora '0830' da 2 também sai hora_invalida: a origem entrega
    # VARCHAR em bytes; desde a rodada 2 a regra hora_hhmm decodifica o texto cru: só 2575 fica hora_invalida
    for i, cab, resp, extra in [(1, 1, 1, {"RESPALFA": "Texto livre", "RESPVALOR": D("37.500"), "UNIDRESP": "C"}),
                                (2, 1, 2, {"RESPDATA": datetime.date(2026, 3, 1), "RESPHORA": "0830",
                                           "RESPSNAO": "S"}),
                                (3, 2, 1, {"RESPALFA": "Repetido", "AUTOPREENCHIDO": "S"}), (4, 3, 1, {}),
                                (5, 1, 3, {"RESPALFA": "Ambígua"}), (6, 1, 99, {}), (7, 2, 2, {"RESPHORA": "2575"})]:
        linha("PREVOLPAC", ID=i, ID_CABEVOL=cab, SEQ=1, ID_RESPOSTA=resp, ORDEM="%02d" % i,
              CONTEVOL=b"Texto longo falso" if i == 1 else None, **extra)
    # documentos emitidos: 1 válido; 2 suspenso com justificativa (suspenso); 3 inválido sem suspensão (válido: a
    # situação vem da suspensão); 4 sem texto (NOT NULL); 5 correção do 1 (fase 2); 6 suspenso sem justificativa (CHECK)
    for i, valido, susp, texto in [(1, "T", False, True), (2, "T", True, True), (3, "F", False, True),
                                   (4, "T", False, False), (5, "T", False, True), (6, "T", True, True)]:
        extra = {"DATA_HORA_SUSPENSAO": _h(8), "ID_TBCBOPRO_SUSPENSAO": 302,
                 "JUSTIFICATIVA_SUSPENSAO": "Emitido por engano" if i == 2 else None} if susp else {}
        linha("PRATESTREQIMP", ID=i, ID_HTPACIENTE=101, ID_HTATENDIMENTO=201, ID_TBCBOPRO=301,
              ID_PRLOCAL_ASSISTENCIA=1, DATA_HORA_INCLUSAO=_h(i), DATA_HORA_LANCAMENTO=_h(i), PRE_IMPRESSO="N",
              CONTEUDO_XML=("Declaro, para os devidos fins, documento falso %d." % i).encode("cp1252") if texto else None,
              REGISTRO_VALIDO=valido, ID_PRATESTREQIMP_ORIG_CORREC=1 if i == 5 else None, ID_TBPROFIS_ACOMP_RESP=1,
              **extra)
    # eventos de assinatura: 1 e 2 normais; 3 documento nunca visto (NOT NULL); 4 sem momento do evento (NOT NULL)
    for i, cab, ev in [(1, 1, 1), (2, 2, 2), (3, 9, 3), (4, 1, None)]:
        linha("PRASSINATURA_DOC", ID=i, ID_PRASSINATURA_CAB=cab, ID_PRTPDOCUMENTO=1, ID_PRSITDOCUMENTO=1,
              ID_TBCBOPRO=301 + i % 2, DATA_HORA_EVENTO=None if ev is None else _h(ev), DATA_HORA_GRAVACAO=_h(9))
    # princípios da origem: 1 código sem zeros à esquerda (casa com 01234); 2 código já com 5 dígitos; 3 sem código
    # DCB; 4 código que o catálogo oficial não tem
    for i, dcb in ((1, "1234"), (2, "00777"), (3, None), (4, "99999")):
        linha("TBPRINC", COD=i, NOME="Principio falso %d" % i, ATIVO="S", COD_DCB=dcb)
    # princípio da alergia: 1 e 2 gravados; 3 alerta recusado (pai_pendente); 4 código ausente no catálogo
    # (codigo_inexistente_destino, NOT NULL); 5 princípio sem código DCB (NOT NULL); 6 princípio nunca visto na
    # origem (pai_inexistente, NOT NULL); 7 repete o par da 1 (UNIQUE)
    for i, alg, princ in [(1, 1, 1), (2, 2, 2), (3, 3, 1), (4, 1, 4), (5, 1, 3), (6, 1, 99), (7, 1, 1)]:
        linha("PRALERGIAPAC_TBPRINC", ID=i, ID_PRALERGIAPAC=alg, ID_TBPRINC=princ)
    # descartes: só a forma, duas linhas falsas cada
    feitas = {"PRPRESC", "PRLANGERAL", "PRPRESCPROCED", "PRPRESCDIETA", "PRCARACTLAN", "PRPRESCHEMO", "PRCABEVOL",
              "PRCONTEVOL", "PRALERGIAPAC", "PRATESTREQIMP", "PRASSINATURA_DOC", "PRPRESCMED", "PRITENSGERAL",
             "PREVOLPAC", "PRALERGIAPAC_TBPRINC"}
    for t in FORMAS:
        if t not in feitas:
            for i in (1, 2):
                linha(t, **{c: i for c in FORMAS[t][0].split(",")})
    return ESPERADO


ESPERADO = {
    "PRPRESC": {"gravados": 2, "pendencias": {"data_sentinela": 1, "pai_inexistente": 1, "restricao_destino_1048": 2,
                                              "restricao_destino_4025": 2, "valor_fora_do_dominio": 1}},
    "PRLANGERAL": {"gravados": 4, "pendencias": {"pai_inexistente": 1, "pai_pendente": 1,
                                                 "restricao_destino_1048": 2, "restricao_destino_1406": 1}},
    "PRPRESCPROCED": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "pai_pendente": 1,
                                                    "restricao_destino_1062": 1, "restricao_destino_4025": 1,
                                                    "valor_fora_do_dominio": 1}},
    "PRPRESCDIETA": {"gravados": 1, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1,
                                                   "restricao_destino_4025": 1}},
    "PRCARACTLAN": {"gravados": 2, "pendencias": {"pai_pendente": 1}},
    "PRPRESCHEMO": {"gravados": 1, "pendencias": {"pai_pendente": 1, "pai_inexistente": 2,
                                                  "restricao_destino_1048": 3}},
    "PRPRESCMED": {"gravados": 1, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                 "restricao_destino_1048": 1, "restricao_destino_4025": 2}},
    "PRITENSGERAL": {"gravados": 2, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                   "restricao_destino_4025": 2}},
    "PRCABEVOL": {"gravados": 2, "pendencias": {"pai_inexistente": 3, "restricao_destino_1048": 2,
                                                "valor_presumido": 4}},
    "PRCONTEVOL": {"gravados": 2, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1}},
    "PREVOLPAC": {"gravados": 4, "pendencias": {"pai_pendente": 2, "pai_inexistente": 2,
                                                "restricao_destino_1048": 1, "hora_invalida": 1}},
    "PRALERGIAPAC": {"gravados": 2, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                   "restricao_destino_4025": 2}},
    "PRALERGIAPAC_TBPRINC": {"gravados": 2, "pendencias": {"pai_pendente": 1, "codigo_inexistente_destino": 1,
                                                           "pai_inexistente": 1, "restricao_destino_1048": 3,
                                                           "restricao_destino_1062": 1}},
    "PRATESTREQIMP": {"gravados": 4, "pendencias": {"valor_presumido": 6, "restricao_destino_1048": 1,
                                                    "restricao_destino_4025": 1}},
    "PRASSINATURA_DOC": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 2}},
}
