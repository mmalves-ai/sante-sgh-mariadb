"""Fatia L6-15 (prontuário, assinatura e assistência, módulo INT): tabelas da origem com os mesmos nomes e tipos do
dicionário (as não carregadas só com parte das colunas) e dados 100% falsos.

Carregadas (CARREGADAS, 9): desfecho da internação, motivo de saída, central reguladora + sistema externo (dois
destinos), serviço de regulação, categoria de acomodação, regime de internação, local e leito de observação e a
ocupação do leito de observação. Anomalias cobertas:
- nome nulo ou só de espaços (NOT NULL do destino: restricao_destino_1048), espaços internos (texto_nome colapsa);
- S/N fora do domínio (valor_fora_do_dominio, fica o padrão), literais presumidos (valor_presumido por linha lida);
- código duplicado na chave única do destino (1062: sigla da central, serviço na central, local, leito no local,
  duas ocupações abertas no mesmo leito);
- vigência e ocupação com fim antes do início (CHECK: 4025), quantidade negativa em UNSIGNED (1264);
- data sentinela (data_sentinela) e data e hora com data sentinela (hora_sem_data, recusa pela NOT NULL); saída da
  ocupação com data sentinela, 00:00 (data_sentinela) e com hora (hora_sem_data): por ora gravada com saída NULL e
  situação presumida (valor_presumido), em leitos sem outra ocupação aberta (situação condicional pedida no L6-15.json);
- pai recusado (pai_pendente: serviço de central recusada, leito de local recusado, ocupação de leito recusado), pai
  nunca visto (pai_inexistente: centro de custo em coluna anulável fica NULL; central, tipo de leito e atendimento
  em coluna NOT NULL recusam a linha) e pais de fora da fatia (PAIS_EXTERNOS);
- BLOB de texto com quebra de linha e espaços internos preservados.
Não carregadas (NAO_CARREGADAS: na imagem para provar que nada delas é gravado; pedidos em
docs/obra/fatias/f4/saida/L6-15.json): ocupação de leito da internação, acomodações, leitos, pré-internação,
internação e histórico do leito.
"""
import datetime

DDL = """
CREATE TABLE TBDESFECHO_INTERNACAO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ATIVO CHAR(1));
CREATE TABLE TBMOTALT (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(80), STATUS VARCHAR(1), NOME_ANT VARCHAR(80),
  ID_DIGITAL VARCHAR(36));
CREATE TABLE TBREGUL_SISTEMA (ID INTEGER NOT NULL PRIMARY KEY, SIGLA VARCHAR(30), ATIVO VARCHAR(1));
CREATE TABLE TBREGUL_SERVICO (ID INTEGER NOT NULL PRIMARY KEY, ID_TBREGUL_SISTEMA INTEGER, COD VARCHAR(50),
  DESCRICAO VARCHAR(100), ATIVO VARCHAR(1));
CREATE TABLE TBTIPOACOMOD (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(45));
CREATE TABLE RICTRLOC (BLOCO VARCHAR(5), ACOMOD VARCHAR(6), LEITO VARCHAR(5), ENTRADA DATE, HORAENT VARCHAR(4),
  SAIDA DATE, HORASAI VARCHAR(4), REG INTEGER NOT NULL, ID_TBTIPOACOMOD SMALLINT NOT NULL, COD INTEGER NOT NULL,
  ID_DIGITAL VARCHAR(36));
CREATE TABLE TBTISSREGINT (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(15), DATA_VIGENCIA_INICIAL DATE,
  DATA_VIGENCIA_FINAL DATE);
CREATE TABLE RELOCLEITO (ID SMALLINT NOT NULL PRIMARY KEY, COD_LOCAL_LEITO VARCHAR(6) NOT NULL, NOME VARCHAR(45),
  ID_TBCENCUS INTEGER, QTD_LEITO SMALLINT NOT NULL, ID_TBSEXO INTEGER NOT NULL, ID_TBTIPOACOMOD SMALLINT NOT NULL,
  TP_CONVENIO SMALLINT NOT NULL, ID_TBCLINICA VARCHAR(1), COR VARCHAR(20), IDADE_MINIMA SMALLINT,
  ID_TBUNID_IDADE_MIN SMALLINT, IDADE_MAXIMA SMALLINT, ID_TBUNID_IDADE_MAX SMALLINT);
CREATE TABLE RELEITO (ID SMALLINT NOT NULL PRIMARY KEY, ID_RELOCLEITO SMALLINT NOT NULL, COD_LEITO VARCHAR(5) NOT NULL,
  ID_RETPLEITO SMALLINT NOT NULL, ATIVO CHAR(1), ID_TBTABDTH INTEGER);
CREATE TABLE RIACOMOD (BLOCO VARCHAR(5) NOT NULL, ACOMOD VARCHAR(6) NOT NULL, NOME VARCHAR(40), ANDAR SMALLINT,
  SEXO VARCHAR(1), LEITOS SMALLINT, TIPO SMALLINT, CONSTRAINT PK_RIACOMOD PRIMARY KEY (BLOCO, ACOMOD));
CREATE TABLE TBACOMODLEITO (ID SMALLINT NOT NULL PRIMARY KEY, ID_RIBLOCOS VARCHAR(5), COD_ACOMODACAO VARCHAR(6) NOT NULL,
  TP_ATENDIMENTO CHAR(1) NOT NULL, NOME VARCHAR(45), QTD_LEITO SMALLINT NOT NULL, TP_CONVENIO SMALLINT NOT NULL,
  ID_TBSEXO INTEGER NOT NULL, ID_TBTIPOACOMOD SMALLINT NOT NULL);
CREATE TABLE TBLEITO (ID SMALLINT NOT NULL PRIMARY KEY, ID_TBACOMODLEITO SMALLINT NOT NULL, COD_LEITO VARCHAR(5) NOT NULL,
  ATIVO CHAR(1), DATA_VIGENCIA DATE);
CREATE TABLE RIPREINT (PRONT INTEGER NOT NULL, TIPOPAC VARCHAR(1) NOT NULL, OTMU VARCHAR(1) NOT NULL, ENTRADA DATE,
  HORAENT VARCHAR(4), CONV SMALLINT, ALTAPREV DATE, ALTA DATE, REG INTEGER NOT NULL,
  CONSTRAINT PK_RIPREINT PRIMARY KEY (PRONT, TIPOPAC, OTMU));
CREATE TABLE REOCUPLEITO (ID_RECADATE INTEGER NOT NULL, TIPO CHAR(1) NOT NULL, DATA_HORA_ENTRADA TIMESTAMP NOT NULL,
  ID_RELEITO SMALLINT NOT NULL, DATA_HORA_SAIDA TIMESTAMP, JUSTIFICATIVA BLOB SUB_TYPE 1, COD INTEGER NOT NULL,
  ID_DIGITAL VARCHAR(36), CONSTRAINT PK_REOCUPLEITO PRIMARY KEY (ID_RECADATE, TIPO, DATA_HORA_ENTRADA));
CREATE TABLE RICADINT (REG INTEGER NOT NULL PRIMARY KEY, PRONT INTEGER, ENTRADA DATE, HORAENT VARCHAR(4),
  BLOCO VARCHAR(5) NOT NULL, ACOMOD VARCHAR(6) NOT NULL, LEITO VARCHAR(5) NOT NULL, CONV SMALLINT NOT NULL,
  ALTA DATE, ALTAPREV DATE, ID_ATCABECATEND BIGINT NOT NULL, DATA_HORA_ULTIMA_ATUALIZACAO TIMESTAMP);
CREATE TABLE HTLEITO (ID SMALLINT NOT NULL PRIMARY KEY, ID_TBLEITO SMALLINT NOT NULL,
  DATA_HORA_HISTORICO TIMESTAMP NOT NULL, NOME_BLOCO VARCHAR(40), NOME_ACOMODACAO VARCHAR(45), NUM_ANDAR SMALLINT,
  ID_TBTIPOACOMOD SMALLINT NOT NULL);
"""
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')")
PAIS_EXTERNOS = {"TBCENCUS": ["10", "20"], "RETPLEITO": ["1", "2"],
                 "RECADATE": ["5001", "5002", "5003", "5004", "5005", "5006"]}
CARREGADAS = ("TBDESFECHO_INTERNACAO", "TBMOTALT", "TBREGUL_SISTEMA", "TBREGUL_SERVICO", "TBTIPOACOMOD",
              "TBTISSREGINT", "RELOCLEITO", "RELEITO", "REOCUPLEITO")
NAO_CARREGADAS = ("RICTRLOC", "RIACOMOD", "TBACOMODLEITO", "TBLEITO", "RIPREINT", "RICADINT", "HTLEITO")

D = datetime.date
H = datetime.datetime


def linhas(r, ins):
    for x in [(1, "Alta  melhorada", "S"), (2, "Óbito", "S"), (3, "Evasão", None), (4, "Transferência externa", "X"),
              (5, "   ", "N")]:
        ins("TBDESFECHO_INTERNACAO", list(x))
    for x in [(11, "Alta  curado", "A"), (12, "Alta melhorado", "A"), (41, "Óbito com declaração", "I"),
              (15, None, "A"), (31, "Permanência por\r\ncaracterística da doença", "A")]:
        ins("TBMOTALT", list(x) + [None, None])
    for x in [(1, "CENTRAL-A", "S"), (2, "CENTRAL-B", "N"), (3, None, "S"), (4, "CENTRAL-A", None)]:
        ins("TBREGUL_SISTEMA", list(x))
    for x in [(1, 1, "101", "Leito clínico adulto", "S"), (2, 1, "102", "Leito  UTI   adulto", "S"),
              (3, 2, "201", "Leito pediátrico", "N"), (4, 3, "301", "Serviço de central recusada", "S"),
              (5, 9, "901", "Central nunca vista", "S"), (6, 1, "101", "Código repetido na central", "S"),
              (7, 2, None, "Sem código", "S"), (8, 2, "202", "Leito obstétrico", "X")]:
        ins("TBREGUL_SERVICO", list(x))
    for x in [(1, "Enfermaria"), (2, "Apartamento"), (3, "UTI  adulto"), (4, None), (5, "Berçário")]:
        ins("TBTIPOACOMOD", list(x))
    for x in [(1, "Hospitalar", D(2020, 1, 1), None), (2, "Hospital-dia", D(2020, 1, 1), D(2030, 12, 31)),
              (3, "Domiciliar", D(1899, 12, 30), None), (4, "Teste", D(2025, 6, 1), D(2025, 1, 1)),
              (5, None, None, None)]:
        ins("TBTISSREGINT", list(x))
    # ID, COD, NOME, CENCUS, QTD, SEXO, TIPOACOMOD, TP_CONVENIO, CLINICA, COR, IDMIN, UNMIN, IDMAX, UNMAX
    for x in [(1, "OBS1", "Observação  adulto", 10, 6, 1, 1, 0, "A", "clBlue", 18, 1, 130, 1),
              (2, "OBS2", "Observação pediátrica", 20, 4, 1, 1, 0, "P", None, 0, 1, 12, 1),
              (3, "OBS3", None, 10, 2, 1, 1, 0, None, None, None, None, None, None),
              (4, "MED1", "Sala de medicação", 77, 3, 2, 1, 0, None, None, None, None, None, None),
              (5, "OBS5", "Local com quantidade negativa", None, -1, 1, 1, 0, None, None, None, None, None, None),
              (6, "OBS1", "Código repetido", 10, 2, 1, 1, 0, None, None, None, None, None, None)]:
        ins("RELOCLEITO", list(x))
    for x in [(1, 1, "L01", 1, "S"), (2, 1, "L02", 2, "S"), (3, 2, "P01", 1, None), (4, 3, "X01", 1, "S"),
              (5, 1, "L01", 1, "S"), (6, 2, "P02", 9, "S"), (7, 1, "L03", 2, "X"), (8, 5, "Z01", 1, "S")]:
        ins("RELEITO", list(x) + [None])
    j = "Observação\r\n  pós-medicação  ".encode("cp1252")
    for x in [(5001, "E", H(2026, 3, 1, 8), 1, H(2026, 3, 1, 12), j, 1),
              (5002, "E", H(2026, 3, 1, 9), 2, H(2026, 3, 1, 10, 30), None, 2),
              (5001, "T", H(2026, 3, 1, 13), 3, None, None, 3),
              (5003, "E", H(2026, 3, 2, 8), 3, None, None, 4),                      # leito 3 já ocupado: 1062
              (5004, "E", H(2026, 3, 2, 10), 1, H(2026, 3, 2, 9), None, 5),         # saída antes da entrada: 4025
              (5005, "E", H(2026, 3, 2, 11), 4, None, None, 6),                     # leito recusado: pai_pendente
              (5099, "E", H(2026, 3, 2, 12), 2, H(2026, 3, 2, 13), None, 7),        # atendimento nunca visto
              (5006, "E", H(1899, 12, 30, 10), 2, None, None, 8),                   # data sentinela com hora
              (5002, "E", H(2026, 3, 3, 8), 7, None, None, 9),
              (5003, "E", H(2026, 3, 4, 8), 1, H(1899, 12, 30), None, 10),          # saída sentinela 00:00
              (5004, "E", H(2026, 3, 4, 9), 2, H(1899, 12, 30, 15, 30), None, 11)]:  # saída sentinela com hora
        ins("REOCUPLEITO", list(x) + [None])
    # não carregadas (sem coluna declarada com destino): só para provar que nada delas é gravado
    for k in range(1, 4):
        d = D(2026, 2, k)
        ins("RICTRLOC", ["A", "101", "0%d" % k, d, "0830", d + datetime.timedelta(days=r.randint(1, 5)), "1000",
                         7000 + k, 1, k, None])
        ins("RIACOMOD", ["A", "10%d" % k, "Quarto %d" % k, 1, "I", 2, 1])
        ins("TBACOMODLEITO", [k, "A", "10%d" % k, "I", "Quarto %d" % k, 2, 0, 1, 1])
        ins("TBLEITO", [k, k, "0%d" % k, "S", d])
        ins("RIPREINT", [8000 + k, "I", "A", d, "0900", 1, d + datetime.timedelta(days=3), None, 7000 + k])
        ins("RICADINT", [7000 + k, 8000 + k, d, "0930", "A", "10%d" % k, "0%d" % k, 1, None, None, 6000 + k,
                         H(2026, 2, k, 10)])
        ins("HTLEITO", [k, k, H(2026, 1, k, 9), "Bloco A", "Quarto %d" % k, 1, 1])
    # valor_presumido: uma por literal presumido em cada linha lida, inclusive a recusada pela restrição do destino
    # (a recusada por pai_pendente para antes do literal: TBREGUL_SERVICO 4)
    return {
        "TBDESFECHO_INTERNACAO": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1,
                                                                "valor_fora_do_dominio": 1, "valor_presumido": 5}},
        "TBMOTALT": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 10}},
        "TBREGUL_SISTEMA": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1062": 1,
                                                          "valor_presumido": 4}},
        "TBREGUL_SERVICO": {"gravados": 4, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                          "restricao_destino_1048": 2, "restricao_destino_1062": 1,
                                                          "valor_fora_do_dominio": 1, "valor_presumido": 7}},
        "TBTIPOACOMOD": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        "TBTISSREGINT": {"gravados": 3, "pendencias": {"data_sentinela": 1, "restricao_destino_4025": 1,
                                                       "restricao_destino_1048": 1}},
        "RELOCLEITO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "pai_inexistente": 1,
                                                     "restricao_destino_1264": 1, "restricao_destino_1062": 1,
                                                     "valor_presumido": 6}},
        "RELEITO": {"gravados": 4, "pendencias": {"pai_pendente": 2, "restricao_destino_1062": 1,
                                                  "pai_inexistente": 1, "restricao_destino_1048": 1,
                                                  "valor_fora_do_dominio": 1}},
        "REOCUPLEITO": {"gravados": 6, "pendencias": {"restricao_destino_1062": 1, "restricao_destino_4025": 1,
                                                      "pai_pendente": 1, "pai_inexistente": 1,
                                                      "restricao_destino_1048": 2, "hora_sem_data": 2,
                                                      "data_sentinela": 1, "valor_presumido": 20}},
    }
