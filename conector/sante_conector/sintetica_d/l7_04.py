"""Fatia L7-04 (SADT e suprimentos, módulo SADT): tabelas da origem e anomalias, com dados 100% falsos.

Rodada de cobertura total: 13 tabelas carregam, 5 são descarte de produto e PREXAMEASSINATURA fica bloqueada com
decisão (`declarado/sem_carga.tsv`: SHBOLSAHIST, SIHISTVLREF, SIHISTVLREFEXAME, SIHISTVLREFELEMENTO, SIRESVAR). SIHISTVLREFELEMENTO
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
  USUARIO VARCHAR(31), DATA_HORA_EVENTO TIMESTAMP, DATA_HORA_GRAVACAO TIMESTAMP, ID_SILANEXA DOUBLE PRECISION);
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
  ID_TBCBOPRO_SOLICITANTE INTEGER, ID_TBMEDSOL INTEGER, DATA_HORA_INCLUSAO TIMESTAMP);
CREATE TABLE SILANEXA (ID DOUBLE PRECISION NOT NULL PRIMARY KEY, ID_SICADATE DOUBLE PRECISION NOT NULL,
  ATO SMALLINT NOT NULL, EXAME VARCHAR(4) NOT NULL, SEQUENCIA SMALLINT NOT NULL, COLETA DATE, ENTREGA DATE,
  MATERIAL SMALLINT, OBS BLOB SUB_TYPE 1, QTDE INTEGER, URG VARCHAR(1), PENDTEXTO VARCHAR(50), RECIPIENTE SMALLINT,
  ID_TBCBOEXECUTANTE INTEGER, DATA_HORA_LIBERA_EXAME TIMESTAMP, USUARIOLIB VARCHAR(31),
  DATA_HORA_SUSPENSAO_PEP TIMESTAMP, USUARIO_SUSPENSAO_PEP VARCHAR(31), PAGO VARCHAR(1), RECOLETA VARCHAR(1),
  CIDPRIN VARCHAR(4));
CREATE TABLE SIASSLAUDO_IMP_SILANEXA (ID INTEGER NOT NULL PRIMARY KEY, ID_SIASSLAUDO_IMPRESSAO INTEGER,
  ID_SILANEXA DOUBLE PRECISION);
CREATE TABLE SILIBERACAOEXAME (ID INTEGER NOT NULL PRIMARY KEY, LOTE INTEGER NOT NULL, ID_SILANEXA DOUBLE PRECISION
  NOT NULL, DATA_HORA_LIBERACAO TIMESTAMP, ID_TBUSERS VARCHAR(31), DATA_HORA_VISUALIZACAO TIMESTAMP,
  IP_VIZUALIZACAO VARCHAR(50));
CREATE TABLE SIHISTVLREFELEMENTO (ID INTEGER NOT NULL PRIMARY KEY, ID_SITABELE_CODELE SMALLINT NOT NULL,
  ID_SITABELE_CODPRC VARCHAR(4) NOT NULL, DATA_HORA_GRAVACAO TIMESTAMP NOT NULL, ID_TBUSERS VARCHAR(31) NOT NULL,
  VLRREF BLOB SUB_TYPE 1, UNIDADE VARCHAR(20), MIN_ABE NUMERIC(18,4), MAX_ABE NUMERIC(18,4), REFINI NUMERIC(18,4),
  REFFIN NUMERIC(18,4));
CREATE TABLE SIRES01 (ID DOUBLE PRECISION NOT NULL PRIMARY KEY, ID_SILANEXA DOUBLE PRECISION NOT NULL, DATA DATE,
  ATO SMALLINT NOT NULL, EXAME VARCHAR(4) NOT NULL, ELEMENTO SMALLINT NOT NULL, NUMERICO NUMERIC(18,4),
  ABSOLUTA NUMERIC(18,4), ALFA VARCHAR(2000), TEXTO BLOB SUB_TYPE 1, INDIC VARCHAR(70), MEDIC VARCHAR(40),
  INTERC VARCHAR(40), CONCLUSAO BLOB SUB_TYPE 1, TECNICA BLOB SUB_TYPE 1, USUARIO VARCHAR(31),
  DATA_HORA_EVENTO TIMESTAMP, ID_SIHISTVLREFELEMENTO INTEGER, METODO SMALLINT, ID_TBCBOPRO_EMISSOR INTEGER,
  ID_SIHISTVLREFEXAME INTEGER);
CREATE TABLE SIHISTVLREFEXAME (ID INTEGER NOT NULL PRIMARY KEY, ID_SITABPRO_ATO SMALLINT NOT NULL,
  ID_SITABPRO_CODALF VARCHAR(4) NOT NULL, DATA_HORA_GRAVACAO TIMESTAMP NOT NULL, ID_TBUSERS VARCHAR(31) NOT NULL,
  VLRREF BLOB SUB_TYPE 1);
CREATE TABLE SIRESOBS (ID DOUBLE PRECISION NOT NULL PRIMARY KEY, ID_SILANEXA DOUBLE PRECISION NOT NULL,
  OBS BLOB SUB_TYPE 1);
CREATE TABLE HTNOTEXAMESEXO (ID SMALLINT NOT NULL PRIMARY KEY, ID_TBSEXO INTEGER, ID_PRTIPONOTIFICACAO INTEGER,
  ID_SITABPRO_ATO INTEGER, ID_SITABPRO_CODALF VARCHAR(4), DATA_HORA_HISTORICO TIMESTAMP NOT NULL);
CREATE TABLE SIKITHISTITE (ID SMALLINT NOT NULL PRIMARY KEY, ATO SMALLINT, EXAME VARCHAR(4), QTDE SMALLINT,
  ID_SIKITHISTEXA SMALLINT);
"""

# pais de fora da fatia, inventados e já carregados: kit (L7), usuário (L3), atendimento e paciente (L3), profissional,
# unidade e convênio (L5), setor, exame, material, recipiente e analito (L7), emissão do laudo (L7-01)
PAIS_EXTERNOS = {"SIKITEXA": ["1", "2"], "TBUSERS": ["USR_L704_A", "USR_L704_B"],
                 "ATCABECATEND": ["7001", "7002", "7003"], "RICADPAC": ["8001", "8002"], "TBPROFIS": ["9001"],
                 "TBUNIDAD": ["3"], "TBCONVEN": ["5"], "SIMODULO": ["1", "2"],
                 "SITABPRO": ["1|HEM", "1|GLI", "2|RXT"], "SIMATERI": ["4"], "SIRECIPI": ["6"],
                 "SITABELE": ["HEM|1", "HEM|2", "GLI|1", "RXT|1"], "SIASSLAUDO_IMPRESSAO": ["11"],
                 "SIMETODO": ["3"]}
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')")


def _t(*a):
    return _dt.datetime(*a)


def _d(*a):
    return _dt.date(*a)


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
        [5.0, 505.0, "USR_L704_A", None, _t(2025, 7, 1, 9, 0)],                   # sem data do evento: 1048
        [6.0, 506.0, "USR_L704_B", S0, None]],                                    # data sentinela + 1048
     {"gravados": 4, "pendencias": {"pai_inexistente": 1, "data_sentinela": 1, "restricao_destino_1048": 2}}),
    ("SIHISTVLREFEXAME", [[1, 1, "HEM", _t(2024, 1, 1, 8, 0), "USR_L704_A", "Adulto: 12,0 a 16,0 g/dL"]], None),
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
     {"gravados": 5, "pendencias": {"valor_presumido": 11, "pai_ambiguo": 1, "pai_inexistente": 4,
                                    "data_sentinela": 1, "restricao_destino_1048": 6}}),
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
        [111.0, 11.0, 1, "HEM", 1, None, None, None, None, 1, "N", None, None, None, None]],
     # + usuário da liberação nunca visto (107) e PAGO fora do domínio (110); situação 'liberado' só no 101
     {"gravados": 4, "pendencias": {"pai_pendente": 6, "pai_inexistente": 4, "valor_elevado_ao_minimo": 1,
                                    "valor_fora_do_dominio": 2, "restricao_destino_1048": 1}}),
    ("SIASSLAUDO_IMP_SILANEXA", [[1, 11, 101.0], [2, 11, 107.0], [3, 11, 101.0], [4, 12, 110.0], [5, 11, 102.0]],
     {"gravados": 2, "pendencias": {"restricao_destino_1062": 1, "pai_inexistente": 1, "restricao_destino_1048": 1,
                                    "pai_pendente": 1}}),
    ("SILIBERACAOEXAME", [
        [1, 7, 101.0, _t(2025, 3, 2, 11, 0), "USR_L704_A", _t(2025, 3, 3, 8, 0), "10.0.0.1"],
        [2, 8, 107.0, _t(2025, 3, 7, 11, 0), "USR_L704_NAO_EXISTE", None, None],
        [3, 9, 110.0, None, "USR_L704_A", None, None],
        [4, 9, 104.0, _t(2025, 3, 4, 11, 0), "USR_L704_A", None, None]],
     {"gravados": 2, "pendencias": {"valor_presumido": 3, "pai_inexistente": 1, "restricao_destino_1048": 1,
                                    "pai_pendente": 1}}),
    ("SIHISTVLREFELEMENTO", [[1, 1, "HEM", _t(2024, 1, 1, 8, 0), "USR_L704_A", "12,0 a 16,0 g/dL", "g/dL", None,
                              None, _D("12.0"), _D("16.0")]], None),
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
         "USR_L704_A", None, None]],                                              # sem momento do evento: 1048
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
# SIRES01: momento do resultado (DATA_HORA_EVENTO, NOT NULL no destino) nas linhas sem evento explícito, menos a 9,
# que prova o caso real das linhas antigas sem evento: resultado recusado (1048) até a fonte alternativa DATA (pedido)
for _tab, _ls, _ in DADOS:
    if _tab == "SIRES01":
        for _v in _ls:
            if _v[0] != 9.0:
                _v[16] = _v[16] or _dt.datetime.combine(_v[2], _dt.time(9, 0))
# colunas acrescentadas no fim de cada linha (as demais linhas ficam com nulo):
# SILANEXA: USUARIOLIB, DATA_HORA_SUSPENSAO_PEP, USUARIO_SUSPENSAO_PEP, PAGO, RECOLETA, CIDPRIN
# SIRES01: METODO, ID_TBCBOPRO_EMISSOR, ID_SIHISTVLREFEXAME; SIRES01_DELETE: ID_SILANEXA
EXTRA = {
    "SILANEXA": (6, {101.0: ["USR_L704_A", None, None, "S", "N", None],
                     107.0: ["USR_L704_NAO_EXISTE", None, None, None, "S", None],      # liberador nunca visto
                     110.0: [None, _t(2025, 3, 11, 8, 0), "USR_L704_B", "X", None, None]}),  # suspenso; PAGO fora
    "SIRES01": (3, {1.0: [3, 501, 1],              # método, emissor e referência do exame da época
                    2.0: [77, None, None],         # método nunca visto: pai_inexistente (analito)
                    3.0: [0, 502, 9]}),            # sem método; emissor e referência nunca vistos: pai_inexistente x2
    "SIRES01_DELETE": (1, {1.0: [101.0], 2.0: [999.0]}),
}
for _tab, _ls, _ in DADOS:
    if _tab in EXTRA:
        _n, _m = EXTRA[_tab]
        for _v in _ls:
            _v.extend(_m.get(_v[0], [None] * _n))
# SIRES01: linhas gravadas 1, 3, 5 e 2 (adotada): resultados dos exames 101, 107 e 110
ESPERADO_SIRES01 = {"gravados": 4, "pendencias": {
    "valor_presumido": 8,          # situação 'digitado' presumida em toda linha que chega à gravação (não na 6)
    "adotado_existente": 1,        # linha 2 adota o resultado do exame 101 (a 7 adota mas é recusada pelo 1062)
    "pai_inexistente": 9,          # usuário, emissor e referência do exame (3), referência da época nas 3 colunas
                                   # (5), exame e paciente (8), método (2)
    "pai_pendente": 1,             # exame 102 recusado (6)
    "restricao_destino_4025": 1,   # analito sem valor (4)
    "restricao_destino_1062": 1,   # analito repetido no resultado (7)
    "restricao_destino_1048": 2}}  # exame nunca visto (8); sem momento do evento (9)


def linhas(r, ins):
    esperado = {}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        if esp is not None:
            esperado[tab] = esp
    esperado["SIRES01"] = ESPERADO_SIRES01
    return esperado
