"""Fatia L7-04 (SADT e suprimentos, módulo SADT): tabelas da origem e anomalias, com dados 100% falsos.

Rodada 3 (revisão): 18 tabelas carregam e 1 fica bloqueada com decisão (SIHISTVLREFELEMENTO -> faixa_referencia_versao,
até o L7-03 gravar a faixa do analito; o caminho da carga é provado aqui com a faixa dada como já carregada). Carregam
agora: movimento da bolsa (SHBOLSAHIST -> movimento_bolsa), valores das variáveis de fórmula (SIRESVAR ->
resultado_variavel_formula, resultado pelo exame no destino), históricos do texto de referência do exame (SIHISTVLREF e
SIHISTVLREFEXAME -> trilha_auditoria, retrato completo). PREXAMEASSINATURA vira o vínculo exame_item_assinatura: exame pela
referência e documento assinado pela ligação da origem (PRASS_DOC_PREXAMEASS -> PRASSINATURA_DOC -> cabeçalho, este
dado como já carregado em PAIS_EXTERNOS); as duas intermediárias entram só para a referência encadeada. SIHISTVLREFELEMENTO
e SIHISTVLREFEXAME entram na imagem só para as referências encadeadas do resultado (referência da época do laudo).
Carregadas: grupo sanguíneo, fator Rh (sinal por de-para de valores), leiaute de etiqueta do apoio (modelo de
etiqueta com tamanho presumido e o leiaute no retrato), requisição (SICADATE), exame pedido (SILANEXA), exame da
emissão do laudo, liberação, resultado (SIRES01: um resultado por exame, adotado pelas linhas de analito, e um
resultado_analito por linha), observação do resultado, versão e item da versão do kit, exclusão de resultado e
histórico de alerta por sexo (trilha de auditoria).
Anomalias: sigla ABO fora do domínio, repetida e vazia; nome do Rh sem par e sinal repetido; leiaute longo
(codigo_derivado) e vazio; requisição com vários exames (setor pai_ambiguo, pedido do motor), paciente, profissional e
unidade nunca vistos, sem solicitante interno, sem exame, data sentinela; exame de requisição recusada (pai_pendente),
exame do cadastro inexistente, material inexistente, quantidade zero, urgência fora do domínio; resultado sem valor
(CHECK), analito repetido (1062), exame inexistente, referência da época inexistente; observação de exame com vários
analitos (pai_ambiguo) e vazia; emissão inexistente e exame repetido na emissão; liberação sem data; kit e exame
inexistentes. Pais de fora da fatia (já carregados) em PAIS_EXTERNOS; ATCABECATEND (L3) e TBCBOPRO (L5) entram só
com as colunas lidas pelas referências encadeadas (TBCBOPRO com a forma inteira do dicionário).
"""
import datetime as _dt
from decimal import Decimal as _D

DDL = """
CREATE TABLE TBTPSANGUINEO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(2) NOT NULL);
CREATE TABLE SIRES01_DELETE (ID DOUBLE PRECISION NOT NULL PRIMARY KEY, ID_SIRES01 DOUBLE PRECISION NOT NULL,
  USUARIO VARCHAR(31), DATA_HORA_EVENTO TIMESTAMP, DATA_HORA_GRAVACAO TIMESTAMP, ID_SILANEXA DOUBLE PRECISION,
  NUMERICO NUMERIC(18,4), ALFA VARCHAR(2000), TEXTO BLOB SUB_TYPE 1, CONCLUSAO BLOB SUB_TYPE 1, EXAME VARCHAR(4),
  ELEMENTO SMALLINT);
CREATE TABLE SHBOLSAHIST (ID INTEGER NOT NULL PRIMARY KEY, ID_BOLSA INTEGER NOT NULL, CODMOV INTEGER NOT NULL,
  CODMOTDEV INTEGER NOT NULL, USUARIO VARCHAR(31) NOT NULL, DATA TIMESTAMP NOT NULL, OBSERVACAO VARCHAR(60));
CREATE TABLE SIRESVAR (ID DOUBLE PRECISION NOT NULL PRIMARY KEY, ID_SILANEXA DOUBLE PRECISION NOT NULL,
  CODIGOVARFORMULA INTEGER NOT NULL, VALOR DOUBLE PRECISION);
CREATE TABLE SIHISTVLREF (ID INTEGER NOT NULL PRIMARY KEY, ID_SITABPRO_ATO SMALLINT NOT NULL,
  ID_SITABPRO_CODALF VARCHAR(4) NOT NULL, DATA_HORA_GRAVACAO TIMESTAMP NOT NULL, ID_TBUSERS VARCHAR(31) NOT NULL,
  VLRREF BLOB SUB_TYPE 1);
CREATE TABLE SIKITHISTEXA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30), GERARBATERIAEXAME CHAR(1),
  HORA_SUGERIDA_COLETA_PEP TIMESTAMP, DATA_HORA_GRAVACAO TIMESTAMP, DATA_HORA_FIM TIMESTAMP, ID_SIKITEXA SMALLINT);
CREATE TABLE TBFATORRH (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(10) NOT NULL);
CREATE TABLE SIWSETIQUETA (ID INTEGER NOT NULL PRIMARY KEY, LAYOUTETIQUETA BLOB SUB_TYPE 1);
CREATE TABLE ATCABECATEND (ID BIGINT NOT NULL PRIMARY KEY, ID_RICADPAC INTEGER NOT NULL);
CREATE TABLE TBCBOPRO (ID INTEGER NOT NULL PRIMARY KEY, ID_TBCBOSUS INTEGER NOT NULL, UF VARCHAR(2) NOT NULL,
  COD INTEGER NOT NULL, ID_TBPROFIS INTEGER NOT NULL, VINC_EMPR VARCHAR(1) NOT NULL, CONS_PROF VARCHAR(7),
  ATIVO VARCHAR(1), VINCULO SMALLINT, COMP_INICIAL INTEGER, COMP_FINAL INTEGER, ATENDE_SUS CHAR(1),
  CRM_DIGITO VARCHAR(1), REGIONAL INTEGER, ID_TBSIGLACONSPROF SMALLINT, REG_QUALIF_ESPECIALISTA VARCHAR(9),
  AXREG_ID_ANESTHESIOLOGISTS BIGINT, ID_DIGITAL VARCHAR(36));
CREATE TABLE SICADATE (ID DOUBLE PRECISION NOT NULL PRIMARY KEY, CONV SMALLINT NOT NULL, DATA DATE,
  SENHACONV VARCHAR(20), VALSENHA DATE, UNIDADE SMALLINT, ID_ATCABECATEND BIGINT NOT NULL,
  ID_TBCBOPRO_SOLICITANTE INTEGER, ID_TBMEDSOL INTEGER, DATA_HORA_INCLUSAO TIMESTAMP, DATA_AUT DATE);
CREATE TABLE SILANEXA (ID DOUBLE PRECISION NOT NULL PRIMARY KEY, ID_SICADATE DOUBLE PRECISION NOT NULL,
  ATO SMALLINT NOT NULL, EXAME VARCHAR(4) NOT NULL, SEQUENCIA SMALLINT NOT NULL, COLETA DATE, ENTREGA DATE,
  MATERIAL SMALLINT, OBS BLOB SUB_TYPE 1, QTDE INTEGER, URG VARCHAR(1), PENDTEXTO VARCHAR(50), RECIPIENTE SMALLINT,
  ID_TBCBOEXECUTANTE INTEGER, DATA_HORA_LIBERA_EXAME TIMESTAMP, USUARIOLIB VARCHAR(31),
  DATA_HORA_SUSPENSAO_PEP TIMESTAMP, USUARIO_SUSPENSAO_PEP VARCHAR(31), PAGO VARCHAR(1), RECOLETA VARCHAR(1),
  CIDPRIN VARCHAR(4), JUSTIFICATIVA_SUSPENSAO_PEP BLOB SUB_TYPE 1, DTEMIRES DATE, HREMIRES VARCHAR(5), HRCOL TIME);
CREATE TABLE SIASSLAUDO_IMP_SILANEXA (ID INTEGER NOT NULL PRIMARY KEY, ID_SIASSLAUDO_IMPRESSAO INTEGER,
  ID_SILANEXA DOUBLE PRECISION);
CREATE TABLE SILIBERACAOEXAME (ID INTEGER NOT NULL PRIMARY KEY, LOTE INTEGER NOT NULL, ID_SILANEXA DOUBLE PRECISION
  NOT NULL, DATA_HORA_LIBERACAO TIMESTAMP, ID_TBUSERS VARCHAR(31), DATA_HORA_VISUALIZACAO TIMESTAMP,
  IP_VIZUALIZACAO VARCHAR(50), SITUACAO SMALLINT);
CREATE TABLE SIHISTVLREFELEMENTO (ID INTEGER NOT NULL PRIMARY KEY, ID_SITABELE_CODELE SMALLINT NOT NULL,
  ID_SITABELE_CODPRC VARCHAR(4) NOT NULL, DATA_HORA_GRAVACAO TIMESTAMP NOT NULL, ID_TBUSERS VARCHAR(31) NOT NULL,
  VLRREF BLOB SUB_TYPE 1, UNIDADE VARCHAR(20), MIN_ABE NUMERIC(18,4), MAX_ABE NUMERIC(18,4), REFINI NUMERIC(18,4),
  REFFIN NUMERIC(18,4));
CREATE TABLE SIRES01 (ID DOUBLE PRECISION NOT NULL PRIMARY KEY, ID_SILANEXA DOUBLE PRECISION NOT NULL, DATA DATE,
  ATO SMALLINT NOT NULL, EXAME VARCHAR(4) NOT NULL, ELEMENTO SMALLINT NOT NULL, NUMERICO NUMERIC(18,4),
  ABSOLUTA NUMERIC(18,4), ALFA VARCHAR(2000), TEXTO BLOB SUB_TYPE 1, INDIC VARCHAR(70), MEDIC VARCHAR(40),
  INTERC VARCHAR(40), CONCLUSAO BLOB SUB_TYPE 1, TECNICA BLOB SUB_TYPE 1, USUARIO VARCHAR(31),
  DATA_HORA_EVENTO TIMESTAMP, ID_SIHISTVLREFELEMENTO INTEGER, METODO SMALLINT, ID_TBCBOPRO_EMISSOR INTEGER,
  ID_SIHISTVLREFEXAME INTEGER, DATARES DATE, HORA TIME);
CREATE TABLE SIHISTVLREFEXAME (ID INTEGER NOT NULL PRIMARY KEY, ID_SITABPRO_ATO SMALLINT NOT NULL,
  ID_SITABPRO_CODALF VARCHAR(4) NOT NULL, DATA_HORA_GRAVACAO TIMESTAMP NOT NULL, ID_TBUSERS VARCHAR(31) NOT NULL,
  VLRREF BLOB SUB_TYPE 1);
CREATE TABLE SIRESOBS (ID DOUBLE PRECISION NOT NULL PRIMARY KEY, ID_SILANEXA DOUBLE PRECISION NOT NULL,
  OBS BLOB SUB_TYPE 1);
CREATE TABLE HTNOTEXAMESEXO (ID SMALLINT NOT NULL PRIMARY KEY, ID_TBSEXO INTEGER, ID_PRTIPONOTIFICACAO INTEGER,
  ID_SITABPRO_ATO INTEGER, ID_SITABPRO_CODALF VARCHAR(4), DATA_HORA_HISTORICO TIMESTAMP NOT NULL);
CREATE TABLE SIKITHISTITE (ID SMALLINT NOT NULL PRIMARY KEY, ATO SMALLINT, EXAME VARCHAR(4), QTDE SMALLINT,
  ID_SIKITHISTEXA SMALLINT);
CREATE TABLE PREXAMEASSINATURA (ID INTEGER NOT NULL PRIMARY KEY, ID_AGRUPAMENTO INTEGER NOT NULL,
  ID_SILANEXA DOUBLE PRECISION NOT NULL, ID_PRLOCAL_ASSISTENCIA INTEGER);
CREATE TABLE PRASS_DOC_PREXAMEASS (ID INTEGER NOT NULL PRIMARY KEY, ID_PRASSINATURA_DOC INTEGER NOT NULL,
  ID_PREXAMEASSINATURA INTEGER NOT NULL);
CREATE TABLE PRASSINATURA_DOC (ID INTEGER NOT NULL PRIMARY KEY, ID_PRASSINATURA_CAB INTEGER NOT NULL,
  ID_PRTPDOCUMENTO SMALLINT NOT NULL, ID_PRSITDOCUMENTO SMALLINT NOT NULL, ID_TBCBOPRO INTEGER NOT NULL,
  DATA_HORA_EVENTO TIMESTAMP NOT NULL, FUSO_HORARIO_EVENTO SMALLINT, HORARIO_VERAO_EVENTO CHAR(1),
  DATA_HORA_EVENTO_UTC VARCHAR(30) NOT NULL, DATA_HORA_GRAVACAO TIMESTAMP NOT NULL, FUSO_HORARIO_GRAVACAO SMALLINT,
  HORARIO_VERAO_GRAVACAO CHAR(1), DATA_HORA_GRAVACAO_UTC VARCHAR(30) NOT NULL, DOCUMENTO_ORIGINAL BLOB SUB_TYPE 1,
  ID_PRCADSTATUSORDEM_MEDICA INTEGER, SEARCH_MACHINE_REPLICATED TIMESTAMP, DOCUMENTO_XML_IMPRESSAO BLOB SUB_TYPE 1,
  CLASSIFICACAO_RISCO CHAR(1), LEGADO VARCHAR(1) NOT NULL, ARQUIVO_EXPORTADO VARCHAR(100));
"""

# pais de fora da fatia, inventados e já carregados: kit (L7), usuário (L3), atendimento e paciente (L3), profissional,
# unidade e convênio (L5), setor, exame, material, recipiente e analito (L7), emissão do laudo (L7-01)
PAIS_EXTERNOS = {"SIKITEXA": ["1", "2"], "TBUSERS": ["USR_L704_A", "USR_L704_B"],
                 "ATCABECATEND": ["7001", "7002", "7003"], "RICADPAC": ["8001", "8002"], "TBPROFIS": ["9001"],
                 "TBUNIDAD": ["3"], "TBCONVEN": ["5"], "SIMODULO": ["1", "2"],
                 "SITABPRO": ["1|HEM", "1|GLI", "2|RXT"], "SIMATERI": ["4"], "SIRECIPI": ["6"],
                 "SITABELE": ["HEM|1", "HEM|2", "GLI|1", "RXT|1"], "SIASSLAUDO_IMPRESSAO": ["11"],
                 "SIMETODO": ["3"], "PRASSINATURA_CAB": ["21", "22"], "TBMEDSOL": ["7"], "PRLOCAL_ASSISTENCIA": ["1"],
                 # bolsa e cadastros do hemocentro (L7-01), variáveis de fórmula (L7-03) e a faixa do analito HEM|1
                 # (secundário faixa_referencia do SITABELE, L7-03)
                 "SHBOLSA": ["1", "2"], "SHMOV": ["1", "2"], "SHMOTDEV": ["1"], "SIVARFORMULA": ["1", "2"]}
PAIS_EXTERNOS["SITABELE"] = PAIS_EXTERNOS["SITABELE"] + ["HEM|1/faixa_referencia"]
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');"
                   # cadastro de unidades (L7-03 cria pelo texto): a unidade da época do resultado é achada pelo código
                   " CREATE TABLE IF NOT EXISTS unidade_resultado (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(30) NOT NULL, descricao VARCHAR(150), simbolo VARCHAR(30), criado_em DATETIME(3));"
                   " INSERT INTO unidade_resultado (codigo, descricao, simbolo, criado_em)"
                   " VALUES ('g/dL', 'g/dL', 'g/dL', UTC_TIMESTAMP(3))")


def _t(*a):
    return _dt.datetime(*a)


def _d(*a):
    return _dt.date(*a)



class _Hora:
    """Literal TIME do Firebird ('HH:MM:SS'): o gerador da imagem escreve str(v) dos tipos que não conhece."""

    def __init__(self, hhmm):
        self.hhmm = hhmm

    def __str__(self):
        return "'%s:00'" % self.hhmm


H = _t(1899, 12, 30, 7, 30)
S0 = _t(1899, 12, 30, 0, 0)
LEIAUTE_LONGO = "^XA" + "^FO10,10^ADN,18,10^FDcampo de exemplo^FS" * 6 + "^XZ"
DADOS = [
    ("TBTPSANGUINEO", [[1, "A"], [2, "B"], [3, "AB"], [4, "O"], [5, "X"], [6, "O "], [7, "  "]],
     {"gravados": 4, "pendencias": {"restricao_destino_4025": 1, "restricao_destino_1062": 1,
                                    "restricao_destino_1048": 1}}),
    ("SIRES01_DELETE", [
        [1.0, 501.0, "USR_L704_A", _t(2025, 3, 4, 10, 20), _t(2025, 3, 4, 10, 21)],
        [2.0, 502.0, "USR_L704_B", _t(2025, 4, 5, 8, 0), None],
        [3.0, 503.0, "USR_L704_NAO_EXISTE", _t(2025, 5, 6, 9, 30), None],        # pai_inexistente (NULL anulável)
        [4.0, 504.0, None, _t(2025, 6, 7, 11, 0), None],                          # sem usuário: NULL, sem pendência
        [5.0, 505.0, "USR_L704_A", None, _t(2025, 7, 1, 9, 0)],                   # sem evento: vale a gravação
        [6.0, 506.0, "USR_L704_B", S0, None]],                                    # data sentinela + 1048
     # a 5 (sem evento) grava pela gravação (concorrente); a 6 (evento sentinela, sem gravação) recusa
     {"gravados": 5, "pendencias": {"pai_inexistente": 1, "data_sentinela": 1, "restricao_destino_1048": 1}}),
    # histórico do texto de referência do exame (trilha): exame nunca visto grava com entidade NULL; data sentinela recusa
    ("SIHISTVLREFEXAME", [[1, 1, "HEM", _t(2024, 1, 1, 8, 0), "USR_L704_A", "Adulto: 12,0 a 16,0 g/dL"],
                          [2, 9, "XXX", _t(2024, 2, 1, 8, 0), "USR_L704_B", "Texto de exame inexistente"],
                          [3, 1, "GLI", S0, "USR_L704_A", "Jejum de 8 horas"]],
     {"gravados": 2, "pendencias": {"pai_inexistente": 1, "data_sentinela": 1, "restricao_destino_1048": 1}}),
    ("SIHISTVLREF", [[1, 1, "GLI", _t(2024, 3, 1, 8, 0), "USR_L704_A", "Coleta em jejum de 8 horas"],
                     [2, 1, "HEM", _t(2024, 3, 2, 8, 0), "USR_L704_NAO_EXISTE", "Texto geral de exemplo"]],
     {"gravados": 2, "pendencias": {"pai_inexistente": 1}}),
    # movimento da bolsa: transfusão (sem motivo: 0), devolução com motivo, bolsa nunca vista, linha de preenchimento
    # de 1899, tipo de movimento nunca visto, motivo e usuário nunca vistos (usuário NOT NULL)
    ("SHBOLSAHIST", [[1, 1, 1, 0, "USR_L704_A", _t(2025, 5, 1, 10, 0), "Transfusão no leito"],
                     [2, 1, 2, 1, "USR_L704_B", _t(2025, 5, 1, 12, 0), None],
                     [3, 9, 1, 0, "USR_L704_A", _t(2025, 5, 2, 10, 0), None],
                     [4, 2, 1, 0, "USR_L704_A", S0, None],
                     [5, 2, 7, 0, "USR_L704_A", _t(2025, 5, 3, 10, 0), None],
                     [6, 2, 1, 5, "USR_L704_NAO_EXISTE", _t(2025, 5, 4, 10, 0), None]],
     {"gravados": 2, "pendencias": {"pai_inexistente": 4, "data_sentinela": 1, "restricao_destino_1048": 4}}),
    # kit 1: versões 1, 2, 6, 8, 9 (número da versão 1..5 na ordem da chave); kit 2: 3, 4, 7; kit 9 nunca visto
    ("SIKITHISTEXA", [
        [1, "Kit exemplo pré-operatório", "S", H, _t(2026, 1, 5, 10, 0), _t(2026, 2, 1, 8, 0), 1],
        [2, "Kit exemplo pré-operatório", "S", H, _t(2026, 2, 1, 8, 0), None, 1],
        [3, "Kit  exemplo   rotina", "N", None, _t(2026, 1, 10, 9, 0), None, 2],
        [4, "Kit exemplo rotina ação", "X", _t(1899, 12, 30, 6, 0), _t(2026, 3, 1, 9, 0), None, 2],
        [5, "Kit de kit inexistente", "S", None, _t(2026, 1, 11, 9, 0), None, 9],
        [6, None, "S", None, _t(2026, 2, 2, 9, 0), None, 1],
        [7, "Kit gravação sentinela", "N", None, S0, None, 2],
        [8, "Kit vigência invertida", "S", None, _t(2026, 2, 3, 9, 0), _t(2026, 1, 3, 9, 0), 1],
        [9, "Kit hora com data", "N", _t(2026, 3, 1, 6, 45), _t(2026, 2, 4, 9, 0), None, 1]],
     {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 1, "pai_inexistente": 1, "restricao_destino_1048": 3,
                                    "data_sentinela": 2, "restricao_destino_4025": 1, "hora_com_data": 1}}),
    # sinal pelo nome (valores.d/L7-04.tsv): sem par recusa; dois negativos: o segundo recusa pela chave única do sinal
    ("TBFATORRH", [[1, "POSITIVO"], [2, "Negativo"], [3, "Talvez"], [4, "NEG"]],
     {"gravados": 2, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1,
                                    "restricao_destino_1062": 1}}),
    # leiaute curto (descrição = o texto), longo (codigo_derivado) e vazio (1048); tamanho presumido em todas (2 por linha)
    ("SIWSETIQUETA", [[1, "^XA^FDEXEMPLO^FS^XZ"], [2, LEIAUTE_LONGO], [3, None]],
     {"gravados": 2, "pendencias": {"valor_presumido": 6, "codigo_derivado": 1, "restricao_destino_1048": 1}}),
    ("ATCABECATEND", [[7001, 8001], [7002, 8002], [7003, 8999]], None),
    ("TBCBOPRO", [[501, 1, "SP", 111, 9001, "S", None, "S", None, None, None, None, None, None, None, None, None,
                   None],
                  [502, 1, "SP", 112, 9999, "S", None, "S", None, None, None, None, None, None, None, None, None,
                   None]], None),
    # ID, CONV, DATA, SENHACONV, VALSENHA, UNIDADE, ID_ATCABECATEND, ID_TBCBOPRO_SOLICITANTE, ID_TBMEDSOL,
    # DATA_HORA_INCLUSAO
    ("SICADATE", [
        [1.0, 5, _d(2025, 3, 1), "SENHA01", _d(2025, 4, 1), 3, 7001, 501, None, _t(2025, 3, 1, 8, 15)],    # um exame: carrega
        [2.0, 5, _d(2025, 3, 2), None, None, 3, 7002, 501, None, _t(2025, 3, 2, 8, 15)],                 # dois exames: setor pai_ambiguo
        [3.0, 5, _d(2025, 3, 3), None, None, 3, 7003, 501, None, _t(2025, 3, 3, 8, 15)],                 # paciente nunca visto
        [4.0, 5, _d(2025, 3, 4), None, None, 3, 7001, None, 7, _t(2025, 3, 4, 8, 15)],                   # só solicitante externo
        [5.0, 5, _d(2025, 3, 5), None, None, 3, 7002, 502, None, _t(2025, 3, 5, 8, 15)],                 # profissional nunca visto
        [6.0, 5, _d(2025, 3, 6), None, None, 77, 7002, 501, None, _t(2025, 3, 6, 8, 15)],                # unidade nunca vista (anulável)
        [7.0, 5, _d(2025, 3, 7), None, None, 3, 7001, 501, None, _t(2025, 3, 7, 8, 15)],                 # sem exame: setor inexistente
        [8.0, 5, S0.date(), None, None, 3, 7001, 501, None, S0],                      # data sentinela
        [9.0, 5, _d(2025, 3, 9), None, None, 3, 7001, 501, None, _t(2025, 3, 9, 8, 15)],
        [10.0, 5, _d(2025, 3, 10), None, None, 3, 7001, 501, None, _t(2025, 3, 10, 8, 15)],
        [11.0, 5, _d(2025, 3, 11), None, None, 3, 7001, 501, None, _t(2025, 3, 11, 8, 15)]],             # exame 111
     # rodada 4 (DDL 10_SADT/09): setor anulável (2 e 7 gravam, setor NULL), solicitante externo (4 grava); 5 sem
     # nenhum solicitante (profissional nunca visto): CHECK de exatamente um (4025); 3 paciente e 8 data (1048);
     # data sentinela na inclusão e na data concorrente (2)
     {"gravados": 8, "pendencias": {"valor_presumido": 11, "pai_ambiguo": 1, "pai_inexistente": 4,
                                    "data_sentinela": 2, "restricao_destino_1048": 2,
                                    "restricao_destino_4025": 1}}),
    # ID, ID_SICADATE, ATO, EXAME, SEQUENCIA, COLETA, ENTREGA, MATERIAL, OBS, QTDE, URG, PENDTEXTO, RECIPIENTE,
    # ID_TBCBOEXECUTANTE, DATA_HORA_LIBERA_EXAME
    ("SILANEXA", [
        [101.0, 1.0, 1, "HEM", 1, _d(2025, 3, 1), _d(2025, 3, 2), 4, "Observação de exemplo", 1, "S", None, 6, 501,
         _t(2025, 3, 2, 10, 0)],
        [102.0, 2.0, 1, "GLI", 1, None, None, None, None, 1, "N", None, None, None, None],
        [103.0, 2.0, 1, "HEM", 2, None, None, None, None, 1, "N", None, None, None, None],
        [104.0, 3.0, 2, "RXT", 1, None, None, None, None, 1, "N", None, None, None, None],
        [105.0, 4.0, 1, "HEM", 1, None, None, None, None, 1, "N", None, None, None, None],
        [106.0, 5.0, 1, "HEM", 1, None, None, None, None, 1, "N", None, None, None, None],
        [107.0, 6.0, 2, "RXT", 1, None, None, None, None, 0, "X", "aguarda preparo", None, 502, None],
        [108.0, 8.0, 1, "HEM", 1, None, None, None, None, 1, "N", None, None, None, None],
        [109.0, 9.0, 1, "ZZZ", 1, None, None, None, None, 1, "N", None, None, None, None],
        [110.0, 10.0, 1, "GLI", 1, None, None, 99, None, None, "N", None, None, None, None],
        [111.0, 11.0, 1, "HEM", 1, _d(2025, 3, 12), None, None, None, 1, "N", None, None, None, None]],
     # + usuário da liberação nunca visto (107) e PAGO fora do domínio (110); situação 'liberado' só no 101
     # rodada 4: só os exames das requisições 3, 5 e 8 (recusadas) ficam pai_pendente
     {"gravados": 7, "pendencias": {"pai_pendente": 3, "pai_inexistente": 4, "valor_elevado_ao_minimo": 1,
                                    "valor_fora_do_dominio": 2, "restricao_destino_1048": 1}}),
    ("SIASSLAUDO_IMP_SILANEXA", [[1, 11, 101.0], [2, 11, 107.0], [3, 11, 101.0], [4, 12, 110.0], [5, 11, 102.0]],
     {"gravados": 3, "pendencias": {"restricao_destino_1062": 1, "pai_inexistente": 1,  # 102 grava (rodada 4)
                                    "restricao_destino_1048": 1}}),
    ("SILIBERACAOEXAME", [
        [1, 7, 101.0, _t(2025, 3, 2, 11, 0), "USR_L704_A", _t(2025, 3, 3, 8, 0), "10.0.0.1"],
        [2, 8, 107.0, _t(2025, 3, 7, 11, 0), "USR_L704_NAO_EXISTE", None, None],
        [3, 9, 110.0, None, "USR_L704_A", None, None],
        [4, 9, 104.0, _t(2025, 3, 4, 11, 0), "USR_L704_A", None, None],
        [5, 10, 101.0, _t(2025, 3, 5, 11, 0), "USR_L704_A", None, None]],      # SITUACAO sem par: recusa
     {"gravados": 2, "pendencias": {"valor_fora_do_dominio": 1, "pai_inexistente": 1, "restricao_destino_1048": 2,
                                    "pai_pendente": 1}}),
    # versão da faixa do analito: HEM|1 (faixa dada como carregada) grava; HEM|2 sem faixa recusa; gravação sentinela
    # recusa; usuário nunca visto grava com NULL
    ("SIHISTVLREFELEMENTO", [[1, 1, "HEM", _t(2024, 1, 1, 8, 0), "USR_L704_A", "12,0 a 16,0 g/dL", "g/dL", None,
                              None, _D("12.0"), _D("16.0")],
                             [2, 2, "HEM", _t(2024, 1, 2, 8, 0), "USR_L704_B", "4,0 a 5,5", "x10^6/uL", _D("0.5"),
                              _D("20"), _D("4.0"), _D("5.5")],
                             [3, 1, "HEM", S0, "USR_L704_A", "12 a 16", "g/dL", None, None, _D("12"), _D("16")],
                             [4, 1, "HEM", _t(2025, 1, 2, 8, 0), "USR_L704_NAO_EXISTE", "12,5 a 16,0 g/dL", "g/dL",
                              _D("1"), _D("30"), _D("12.5"), _D("16.0")]],
     {"gravados": 2, "pendencias": {"pai_inexistente": 2, "data_sentinela": 2, "restricao_destino_1048": 2}}),
    # ID, ID_SILANEXA, DATA, ATO, EXAME, ELEMENTO, NUMERICO, ABSOLUTA, ALFA, TEXTO, INDIC, MEDIC, INTERC, CONCLUSAO,
    # TECNICA, USUARIO, DATA_HORA_EVENTO, ID_SIHISTVLREFELEMENTO
    ("SIRES01", [
        [1.0, 101.0, _d(2025, 3, 1), 1, "HEM", 1, _D("13.5"), None, None, None, "Rotina", None, None, None, None,
         "USR_L704_A", _t(2025, 3, 2, 9, 0), 1],
        [2.0, 101.0, _d(2025, 3, 1), 1, "HEM", 2, _D("4.8"), _D("4800"), None, None, None, None, None, None, None,
         "USR_L704_A", _t(2025, 3, 2, 9, 0), None],                                  # adota o resultado do exame 101
        [3.0, 107.0, _d(2025, 3, 6), 2, "RXT", 1, None, None, "Sem alterações", "Laudo descritivo de exemplo",
         None, None, None, "Conclusão de exemplo", "Técnica de exemplo", "USR_L704_NAO_EXISTE", None, None],
        [4.0, 110.0, _d(2025, 3, 10), 1, "GLI", 1, None, None, None, None, None, None, None, None, None, None, None,
         None],                                                                    # sem valor: CHECK (4025)
        [5.0, 110.0, _d(2025, 3, 10), 1, "GLI", 1, _D("90"), None, None, None, None, None, None, None, None, None,
         None, 9],                                                                 # referência da época inexistente
        [6.0, 102.0, _d(2025, 3, 2), 1, "GLI", 1, _D("95"), None, None, None, None, None, None, None, None, None,
         None, None],                                                              # exame recusado: pai_pendente
        [7.0, 101.0, _d(2025, 3, 1), 1, "HEM", 1, _D("13.9"), None, None, None, None, None, None, None, None, None,
         None, None],                                                              # analito repetido: 1062
        [8.0, 999.0, _d(2025, 3, 1), 1, "HEM", 1, _D("1"), None, None, None, None, None, None, None, None, None,
         None, None],                                                              # exame nunca visto
        [9.0, 111.0, _d(2025, 3, 11), 1, "HEM", 1, _D("14.1"), None, None, None, None, None, None, None, None,
         "USR_L704_A", None, 2]],      # sem evento: data e hora do laudo; unidade da época fora do cadastro
     None),
    ("SIRESOBS", [[1.0, 107.0, "Observação do resultado"], [2.0, 101.0, "Exame com dois analitos"],
                  [3.0, 107.0, None], [4.0, 555.0, "Sem resultado"]],
     {"gravados": 1, "pendencias": {"pai_ambiguo": 1, "pai_inexistente": 1, "restricao_destino_1048": 3}}),
    ("HTNOTEXAMESEXO", [[1, 1, 2, 1, "HEM", _t(2025, 1, 2, 8, 0)], [2, 2, 2, 9, "XXX", _t(2025, 1, 3, 8, 0)],
                        [3, 1, 1, 1, "GLI", S0]],
     {"gravados": 2, "pendencias": {"pai_inexistente": 1, "data_sentinela": 1, "restricao_destino_1048": 1}}),
    # versões carregadas: 1, 2, 3, 4, 9; a 6 é recusada (pai_pendente); a 99 nunca existiu
    ("SIKITHISTITE", [[1, 1, "HEM", 2, 1], [2, 1, "GLI", 0, 1], [3, 1, "ZZZ", 1, 2], [4, 1, "HEM", 1, 6],
                      [5, 2, "RXT", None, 99]],
     {"gravados": 2, "pendencias": {"valor_elevado_ao_minimo": 1, "pai_inexistente": 2, "restricao_destino_1048": 2,
                                    "pai_pendente": 1}}),
]
# SIRES01: momento do resultado (DATA_HORA_EVENTO) nas linhas sem evento explícito, menos a 3 e a 9, que provam as
# linhas antigas sem evento: a 9 pela data e hora do laudo (DATARES, HORA), a 3 pela DATA (concorrentes)
for _tab, _ls, _ in DADOS:
    if _tab == "SIRES01":
        for _v in _ls:
            if _v[0] not in (3.0, 9.0):
                _v[16] = _v[16] or _dt.datetime.combine(_v[2], _dt.time(9, 0))
# colunas acrescentadas no fim de cada linha (as demais linhas ficam com nulo):
# SILANEXA: USUARIOLIB, DATA_HORA_SUSPENSAO_PEP, USUARIO_SUSPENSAO_PEP, PAGO, RECOLETA, CIDPRIN,
#   JUSTIFICATIVA_SUSPENSAO_PEP, DTEMIRES, HREMIRES (rodada 4), HRCOL (rodada 4, revisão: hora da coleta); SICADATE: DATA_AUT (rodada 4)
# SIRES01: METODO, ID_TBCBOPRO_EMISSOR, ID_SIHISTVLREFEXAME; SIRES01_DELETE: ID_SILANEXA
EXTRA = {
    "SILANEXA": (10, {101.0: ["USR_L704_A", None, None, "S", "N", None, None, _d(2025, 3, 2), "1030",
                             _Hora("07:45")],  # emitido; coleta às 07:45 (data + hora)
                     107.0: ["USR_L704_NAO_EXISTE", None, None, None, "S", None, None, None, None, None],  # liberador nunca visto
                     110.0: [None, _t(2025, 3, 11, 8, 0), "USR_L704_B", "X", None, None,             # suspenso; PAGO fora
                             "Pedido em duplicidade,  suspenso".encode("cp1252"), None, None, None]}),
    # DATA_AUT: autorização da operadora (requisição 1)
    "SICADATE": (1, {1.0: [_d(2025, 3, 1)]}),
    # METODO, ID_TBCBOPRO_EMISSOR, ID_SIHISTVLREFEXAME, DATARES, HORA
    "SIRES01": (5, {1.0: [3, 501, 1, None, None],     # método, emissor e referência do exame da época
                    2.0: [77, None, None, None, None],  # método nunca visto: pai_inexistente (analito)
                    3.0: [0, 502, 9, None, None],     # sem método; emissor nunca visto: pai_inexistente
                    9.0: [None, None, None, _d(2025, 3, 11), _Hora("10:15")]}),  # data e hora do laudo
    # ID_SILANEXA, NUMERICO, ALFA, TEXTO, CONCLUSAO, EXAME, ELEMENTO (conteúdo do resultado excluído, no retrato)
    "SIRES01_DELETE": (7, {1.0: [101.0, _D("13.2"), None, None, None, "HEM", 1],
                           2.0: [999.0, None, "Reagente", "Texto excluído de exemplo", "Conclusão excluída", "RXT", 1]}),
    "SILIBERACAOEXAME": (1, {5: [3]}),
}
for _tab, _ls, _ in DADOS:
    if _tab in EXTRA:
        _n, _m = EXTRA[_tab]
        for _v in _ls:
            _v.extend(_m.get(_v[0], [None] * _n))
# SIRES01: linhas gravadas 1, 3, 5, 9 e 2 (adotada): resultados dos exames 101 (liberado), 107, 110 e 111 (digitados)
# rodada 4: o exame 102 grava (requisição 2 com setor NULL), e a linha 6 também; a referência da época do exame
# vai também a resultado_exame.referencia_texto (+1 pai_inexistente na linha 3, referência 9 nunca vista)
ESPERADO_SIRES01 = {"gravados": 6, "pendencias": {
    "adotado_existente": 1,        # linha 2 adota o resultado do exame 101 (a 7 adota mas é recusada pelo 1062)
    "pai_inexistente": 12,         # usuário e emissor (3), referência da época nas 3 colunas e unidade (5), exame,
                                   # paciente, situação e liberação pelo exame (8), método (2)
    "codigo_inexistente_destino": 1,  # unidade da época fora do cadastro de unidades (9)
    "restricao_destino_4025": 1,   # analito sem valor (4)
    "restricao_destino_1062": 1,   # analito repetido no resultado (7)
    "restricao_destino_1048": 1}}  # exame nunca visto (8); sem evento, a 3 e a 9 gravam pelas concorrentes  # exame nunca visto (8); sem momento do evento (9)


# PREXAMEASSINATURA: ID, ID_AGRUPAMENTO, ID_SILANEXA, ID_PRLOCAL_ASSISTENCIA. Exames carregados: 101, 107, 110, 111;
# 102 recusado (pai_pendente); 999 nunca visto. Ligação (PRASS_DOC_PREXAMEASS: ID, evento, assinatura do exame) e
# evento -> cabeçalho (21 e 22 já carregados; 99 nunca visto)
EVENTO_CAB = {1: 21, 2: 21, 3: 22, 4: 22, 5: 99, 6: 21, 7: 21, 8: 22}
LIGACAO = [(1, 1, 1), (2, 2, 2), (3, 3, 3), (4, 4, 4), (5, 1, 5), (6, 7, 7), (7, 8, 7), (8, 5, 8), (9, 1, 9),
           (10, 6, 10)]
ASSINATURA_EXAME = [
    [1, 900, 101.0, 1],      # documento 21: grava
    [2, 900, 107.0, None],   # outro exame no mesmo documento 21: grava (sem local)
    [3, 901, 101.0, 1],      # exame reassinado no documento 22: grava (vínculo, não coluna)
    [4, 901, 102.0, 1],      # exame recusado: pai_pendente
    [5, 902, 999.0, 1],      # exame nunca visto: pai_inexistente + 1048
    [6, 903, 110.0, 1],      # sem ligação ao evento: documento pai_inexistente + 1048
    [7, 904, 111.0, 1],      # ligado a dois eventos de documentos diferentes: pai_ambiguo + 1048
    [8, 905, 111.0, 1],      # evento de cabeçalho nunca visto: pai_inexistente + 1048
    [9, 906, 110.0, 77],     # local nunca visto: NULL com pai_inexistente, grava
    [10, 907, 101.0, 1]]     # mesmo exame e documento da 1 (evento 6 -> 21): 1062
# só a ordem certa (exame e cabeçalho antes do vínculo: pedido de dependências em saida/L7-04.json) é aceita: na
# ordem errada a conciliação falha, em vez de aceitar zero gravados
ESPERADO_ASSINATURA = {"gravados": 5, "pendencias": {"pai_inexistente": 4,  # 102 grava (rodada 4)
                                                      "pai_ambiguo": 1,
                                                     "restricao_destino_1048": 4, "restricao_destino_1062": 1}}
# SIRESVAR: ID, ID_SILANEXA, CODIGOVARFORMULA, VALOR. Resultados gravados: exames 101, 107, 110, 111; 102 recusado
VARIAVEIS = [[1.0, 101.0, 1, 4.5], [2.0, 101.0, 2, 30.0],
             [3.0, 101.0, 1, 5.0],        # variável repetida no resultado: 1062
             [4.0, 107.0, 9, 1.0],        # variável nunca vista: pai_inexistente + 1048
             [5.0, 107.0, 1, None],       # sem valor: 1048
             [6.0, 102.0, 1, 3.0],        # exame recusado: pai_pendente
             [7.0, 111.0, 1, 2.0],
             [8.0, 999.0, 1, 1.0],        # exame nunca visto: pai_inexistente + 1048
             [10.0, 110.0, 1, 7.25]]
ESPERADO_VARIAVEIS = {"gravados": 5, "pendencias": {"restricao_destino_1062": 1, "pai_inexistente": 2,
                                                    "restricao_destino_1048": 3}}  # 102 grava (rodada 4)


def linhas(r, ins):
    esperado = {}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        if esp is not None:
            esperado[tab] = esp
    esperado["SIRES01"] = ESPERADO_SIRES01
    h = _t(2025, 3, 2, 12, 0)
    for i, cab in EVENTO_CAB.items():
        ins("PRASSINATURA_DOC", [i, cab, 1, 1, 501, h, None, None, "2025-03-02T15:00:00Z", h, None, None,
                                 "2025-03-02T15:00:00Z", None, None, None, None, None, "N", None])
    for v in LIGACAO:
        ins("PRASS_DOC_PREXAMEASS", list(v))
    for v in ASSINATURA_EXAME:
        ins("PREXAMEASSINATURA", list(v))
    esperado["PREXAMEASSINATURA"] = ESPERADO_ASSINATURA
    for v in VARIAVEIS:
        ins("SIRESVAR", list(v))
    esperado["SIRESVAR"] = ESPERADO_VARIAVEIS
    return esperado
