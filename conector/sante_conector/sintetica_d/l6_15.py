"""Fatia L6-15 (prontuário, assinatura e assistência, módulo INT): tabelas da origem com os mesmos nomes e tipos do
dicionário (as não carregadas só com parte das colunas) e dados 100% falsos.

Carregadas (CARREGADAS, 8): desfecho da internação, motivo de saída, central reguladora + sistema externo (dois
destinos), serviço de regulação, categoria de acomodação, local e leito de observação e a ocupação do leito de
observação. Anomalias cobertas:
- nome nulo ou só de espaços (NOT NULL do destino: restricao_destino_1048), espaços internos (texto_nome colapsa);
- S/N e A/I fora do domínio (valor_fora_do_dominio, fica o padrão), literais presumidos (valor_presumido por linha);
- de-para de valores: classe do motivo de saída pelo código da AIH (óbito com declaração, permanência que não encerra,
  evasão sem alta médica; código fora da tabela pública: valor_fora_do_dominio em cada coluna derivada), sexo do local
  pela sigla do cadastro de sexo (TBSEXO, lido só pela referência encadeada) e situação da ocupação pela presença da
  saída na origem (sentinela inclusive: encerrada);
- código duplicado na chave única do destino (1062: sigla da central, serviço na central, local, leito no local,
  duas ocupações abertas no mesmo leito);
- vigência e ocupação com fim antes do início (CHECK: 4025), quantidade negativa em UNSIGNED (1264);
- data sentinela (data_sentinela) e data e hora com data sentinela (hora_sem_data, recusa pela NOT NULL); saída da
  ocupação com data sentinela, 00:00 (data_sentinela) e com hora (hora_sem_data): gravada com saída NULL e situação
  'encerrada' (a origem tem saída), sem ocupar o leito vigente;
- pai recusado (pai_pendente: serviço de central recusada, leito de local recusado, ocupação de leito recusado), pai
  nunca visto (pai_inexistente: centro de custo em coluna anulável fica NULL; central, tipo de leito e atendimento
  em coluna NOT NULL recusam a linha) e pais de fora da fatia (PAIS_EXTERNOS);
- BLOB de texto com quebra de linha e espaços internos preservados.
Não carregadas (NAO_CARREGADAS: na imagem para provar que nada delas é gravado; pedidos em
docs/obra/fatias/f4/saida/L6-15.json): regime de internação (terminologia TISS, catálogo oficial), acomodações,
leitos, pré-internação, internação, cancelamentos, transferências, trocas e histórico do leito
(decisões em F4-decisoes-destino.md, seção L6-15).
"""
import datetime

DDL = """
CREATE TABLE TBSEXO (CODIGO INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(20), SIGLA CHAR(1));
CREATE TABLE TBDESFECHO_INTERNACAO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ATIVO CHAR(1));
CREATE TABLE TBMOTALT (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(80), STATUS VARCHAR(1), NOME_ANT VARCHAR(80),
  ID_DIGITAL VARCHAR(36));
CREATE TABLE TBREGUL_SISTEMA (ID INTEGER NOT NULL PRIMARY KEY, SIGLA VARCHAR(30), ATIVO VARCHAR(1));
CREATE TABLE TBREGUL_SERVICO (ID INTEGER NOT NULL PRIMARY KEY, ID_TBREGUL_SISTEMA INTEGER, COD VARCHAR(50),
  DESCRICAO VARCHAR(100), ATIVO VARCHAR(1));
CREATE TABLE TBTIPOACOMOD (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(45));
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
CREATE TABLE RILEITOS (ID SMALLINT NOT NULL PRIMARY KEY, BLOCO VARCHAR(5) NOT NULL, ACOMOD VARCHAR(6) NOT NULL,
  LEITO VARCHAR(5) NOT NULL, ANDAR SMALLINT, REG INTEGER NOT NULL, STATUS VARCHAR(1), RESERVADO CHAR(1),
  DATA_HORA_RESERVA TIMESTAMP);
CREATE TABLE RIALTA_EXCLUSAO (ID INTEGER NOT NULL PRIMARY KEY, ID_ATCABECATEND INTEGER, MOTIVO SMALLINT,
  JUSTIFICATIVAALTERNATIVA VARCHAR(255), DATA_HORA_ALTA_MEDICA TIMESTAMP, ALTA DATE, USUARIOALTA VARCHAR(31),
  DATA_HORA_EXCLUSAO TIMESTAMP);
CREATE TABLE RIEXCINT (REG INTEGER NOT NULL, ENTRADA DATE, PRONT INTEGER, DTCANCEL DATE, JUSTIF VARCHAR(80),
  USUARIO VARCHAR(31), ID_TBMOTCANCCAD INTEGER);
CREATE TABLE RITRANSF (REG INTEGER NOT NULL, DATA DATE NOT NULL, HORA VARCHAR(4) NOT NULL, BLOCOO VARCHAR(5) NOT NULL,
  ACOMODO VARCHAR(6) NOT NULL, LEITOO VARCHAR(5) NOT NULL, BLOCOD VARCHAR(5) NOT NULL, ACOMODD VARCHAR(6) NOT NULL,
  LEITOD VARCHAR(5) NOT NULL, USUARIO VARCHAR(31), JUSTIF VARCHAR(80));
CREATE TABLE RITRFCLI (REG INTEGER NOT NULL, DATA DATE, HORA VARCHAR(4), USUARIO VARCHAR(31), CLINO VARCHAR(1),
  CLIND VARCHAR(1));
CREATE TABLE RITRFCON (REG INTEGER NOT NULL, DATA DATE, HORA VARCHAR(4), CONVO INTEGER, CONVD INTEGER,
  USUARIO VARCHAR(31));
CREATE TABLE RITRFESP (REG INTEGER NOT NULL, DATA DATE, HORA VARCHAR(4), ESPO INTEGER, ESPD INTEGER, USUARIO VARCHAR(31));
CREATE TABLE RITRFMED (REG INTEGER NOT NULL, DATA DATE NOT NULL, HORA VARCHAR(4) NOT NULL, TIPO VARCHAR(1) NOT NULL,
  CPFO DOUBLE PRECISION NOT NULL, CPFD DOUBLE PRECISION NOT NULL, PRONT INTEGER, USUARIO VARCHAR(31),
  CONSTRAINT PK_RITRFMED PRIMARY KEY (REG, DATA, HORA, TIPO, CPFO, CPFD));
CREATE TABLE HTLEITO (ID SMALLINT NOT NULL PRIMARY KEY, ID_TBLEITO SMALLINT NOT NULL,
  DATA_HORA_HISTORICO TIMESTAMP NOT NULL, NOME_BLOCO VARCHAR(40), NOME_ACOMODACAO VARCHAR(45), NUM_ANDAR SMALLINT,
  ID_TBTIPOACOMOD SMALLINT NOT NULL);
"""
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')")
PAIS_EXTERNOS = {"TBCENCUS": ["10", "20"], "RETPLEITO": ["1", "2"],
                 "RECADATE": ["5001", "5002", "5003", "5004", "5005", "5006"]}
CADEIA = ("TBSEXO",)  # de outra fatia (L5-05): lida pela referência encadeada do sexo do local
CARREGADAS = ("TBDESFECHO_INTERNACAO", "TBMOTALT", "TBREGUL_SISTEMA", "TBREGUL_SERVICO", "TBTIPOACOMOD",
              "RELOCLEITO", "RELEITO", "REOCUPLEITO")
NAO_CARREGADAS = ("TBTISSREGINT", "RIACOMOD", "TBACOMODLEITO", "RILEITOS", "TBLEITO", "RIPREINT", "RICADINT",
                  "RIALTA_EXCLUSAO", "RIEXCINT", "RITRANSF", "RITRFCLI", "RITRFCON", "RITRFESP", "RITRFMED", "HTLEITO")

# Significado gravado (relido do destino depois da carga): (tabela de destino, filtro {coluna: valor}, coluna, valor).
# Cobre os de-para de valores, os booleanos A/I e S/N e os literais. A conciliação compara contagem e soma; estes
# valores provam que nenhuma coluna entrou com o significado trocado (releitura pedida ao conferencia.py no L6-15.json).
VALORES_ESPERADOS = [
    ("motivo_saida_hospitalar", {"codigo": "41"}, "tipo_saida", "obito"),
    ("motivo_saida_hospitalar", {"codigo": "41"}, "exige_declaracao_obito", 1),
    ("motivo_saida_hospitalar", {"codigo": "41"}, "ativo", 0),
    ("motivo_saida_hospitalar", {"codigo": "41"}, "codigo_sus", "41"),
    ("motivo_saida_hospitalar", {"codigo": "21"}, "tipo_saida", "permanencia"),
    ("motivo_saida_hospitalar", {"codigo": "21"}, "encerra_internacao", 0),
    ("motivo_saida_hospitalar", {"codigo": "21"}, "ativo", 1),
    ("motivo_saida_hospitalar", {"codigo": "16"}, "tipo_saida", "evasao"),
    ("motivo_saida_hospitalar", {"codigo": "16"}, "alta_a_revelia", 1),
    ("motivo_saida_hospitalar", {"codigo": "31"}, "tipo_saida", "transferencia"),
    ("motivo_saida_hospitalar", {"codigo": "11"}, "tipo_saida", "alta"),
    ("motivo_saida_hospitalar", {"codigo": "11"}, "exige_declaracao_obito", 0),
    ("motivo_saida_hospitalar", {"codigo": "77"}, "tipo_saida", "alta"),
    ("motivo_saida_hospitalar", {"codigo": "77"}, "codigo_sus", None),
    ("desfecho_internacao", {"codigo": "3"}, "ativo", 1),
    ("desfecho_internacao", {"codigo": "1"}, "obito", 0),
    ("central_reguladora", {"sigla": "CENTRAL-B"}, "ativo", 0),
    ("central_reguladora", {"sigla": "CENTRAL-A"}, "nome", "CENTRAL-A"),
    ("sistema_externo", {"codigo": "CENTRAL-A"}, "categoria", "regulacao"),
    ("local_observacao", {"codigo": "OBS1"}, "sexo_permitido", "masculino"),
    ("local_observacao", {"codigo": "OBS7"}, "sexo_permitido", "feminino"),
    ("local_observacao", {"codigo": "MED1"}, "sexo_permitido", "qualquer"),
    ("local_observacao", {"codigo": "OBS8"}, "sexo_permitido", "qualquer"),
    ("leito_observacao", {"codigo": "P01"}, "ativo", 1),
    ("ocupacao_leito_observacao", {"data_hora_entrada": "2026-03-01 08:00:00"}, "situacao", "encerrada"),
    ("ocupacao_leito_observacao", {"data_hora_entrada": "2026-03-01 13:00:00"}, "situacao", "ativa"),
    ("ocupacao_leito_observacao", {"data_hora_entrada": "2026-03-04 08:00:00"}, "situacao", "encerrada"),
    ("ocupacao_leito_observacao", {"data_hora_entrada": "2026-03-04 08:00:00"}, "data_hora_saida", None),
    ("ocupacao_leito_observacao", {"data_hora_entrada": "2026-03-04 09:00:00"}, "situacao", "encerrada"),
]

D = datetime.date
H = datetime.datetime


def linhas(r, ins):
    for cod, nome, sigla in [(1, "Masculino", "M"), (2, "Feminino", "F"), (3, "Ignorado", "I"), (4, "Outro", "O")]:
        ins("TBSEXO", [cod, nome, sigla])
    for x in [(1, "Alta  melhorada", "S"), (2, "Óbito", "S"), (3, "Evasão", None), (4, "Transferência externa", "X"),
              (5, "   ", "N")]:
        ins("TBDESFECHO_INTERNACAO", list(x))
    # COD pela tabela da AIH: 41 óbito (inativo), 21 permanência (STATUS 'T' ambíguo), 16 evasão, 31 transferência
    # (STATUS nulo), 77 fora da tabela pública (valor_fora_do_dominio nas 5 colunas derivadas), 15 sem nome (1048)
    for x in [(11, "Alta  curado", "A"), (12, "Alta melhorado", "A"), (41, "Óbito com declaração", "I"),
              (15, None, "A"), (21, "Permanência por\r\ncaracterística da doença", "T"), (16, "Evasão", "A"),
              (31, "Transferência externa", None), (77, "Motivo local", "A")]:
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
    for x in [(1, "Hospitalar", D(2020, 1, 1), None), (2, "Hospital-dia", D(2020, 1, 1), D(2030, 12, 31))]:
        ins("TBTISSREGINT", list(x))  # catálogo oficial: nada gravado
    # ID, COD, NOME, CENCUS, QTD, SEXO, TIPOACOMOD, TP_CONVENIO, CLINICA, COR, IDMIN, UNMIN, IDMAX, UNMAX
    # sexo pela sigla: 1 M masculino, 2 F feminino, 3 I qualquer, 4 'O' sem par (valor_fora_do_dominio, 'qualquer')
    for x in [(1, "OBS1", "Observação  adulto", 10, 6, 1, 1, 0, "A", "clBlue", 18, 1, 130, 1),
              (2, "OBS2", "Observação pediátrica", 20, 4, 1, 1, 0, "P", None, 0, 1, 12, 1),
              (3, "OBS3", None, 10, 2, 1, 1, 0, None, None, None, None, None, None),
              (4, "MED1", "Sala de medicação", 77, 3, 3, 1, 0, None, None, None, None, None, None),
              (5, "OBS5", "Local com quantidade negativa", None, -1, 1, 1, 0, None, None, None, None, None, None),
              (6, "OBS1", "Código repetido", 10, 2, 1, 1, 0, None, None, None, None, None, None),
              (7, "OBS7", "Observação feminina", 20, 2, 2, 1, 0, None, None, None, None, None, None),
              (8, "OBS8", "Sexo sem par", 20, 2, 4, 1, 0, None, None, None, None, None, None)]:
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
        ins("RIACOMOD", ["A", "10%d" % k, "Quarto %d" % k, 1, "I", 2, 1])
        ins("TBACOMODLEITO", [k, "A", "10%d" % k, "I", "Quarto %d" % k, 2, 0, 1, 1])
        ins("TBLEITO", [k, k, "0%d" % k, "S", d])
        ins("RIPREINT", [8000 + k, "I", "A", d, "0900", 1, d + datetime.timedelta(days=3), None, 7000 + k])
        ins("RICADINT", [7000 + k, 8000 + k, d, "0930", "A", "10%d" % k, "0%d" % k, 1, None, None, 6000 + k,
                         H(2026, 2, k, 10)])
        ins("HTLEITO", [k, k, H(2026, 1, k, 9), "Bloco A", "Quarto %d" % k, 1, 1])
        ins("RILEITOS", [k, "A", "10%d" % k, "0%d" % k, 1, 7000 + k, "O", "N", None])
        ins("RIALTA_EXCLUSAO", [k, 6000 + k, 1, "Alta lançada por engano", H(2026, 2, k, 15), d, "usuario.exemplo",
                                H(2026, 2, k, 16)])
        ins("RIEXCINT", [7100 + k, d, 8000 + k, d, "Cadastro em duplicidade", "usuario.exemplo", 1])
        # sem chave na origem: duas transferências iguais no mesmo minuto; hora inválida ('2575') e vazia
        ins("RITRANSF", [7000 + k, d, ("1015", "2575", "")[k - 1], "A", "10%d" % k, "0%d" % k, "A", "103", "09",
                         "usuario.exemplo", "Troca de quarto"])
        ins("RITRFCLI", [7000 + k, d, "1100", "usuario.exemplo", "C", "P"])
        ins("RITRFCON", [7000 + k, d, "1130", 1, 2, "usuario.exemplo"])
        ins("RITRFESP", [7000 + k, d, None, 10, 20, "usuario.exemplo"])
        ins("RITRFMED", [7000 + k, d, "1200", "A", 11111111111.0 * k, 22222222222.0, 8000 + k,
                         "usuario.exemplo"])
    # valor_presumido: uma por literal presumido em cada linha lida, inclusive a recusada pela restrição do destino
    # (a recusada por pai_pendente para antes do literal: TBREGUL_SERVICO 4)
    return {
        "TBDESFECHO_INTERNACAO": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1,
                                                                "valor_fora_do_dominio": 1, "valor_presumido": 5}},
        "TBMOTALT": {"gravados": 7, "pendencias": {"restricao_destino_1048": 1, "valor_fora_do_dominio": 6}},
        "TBREGUL_SISTEMA": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1062": 1,
                                                          "valor_presumido": 4}},
        "TBREGUL_SERVICO": {"gravados": 4, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                          "restricao_destino_1048": 2, "restricao_destino_1062": 1,
                                                          "valor_fora_do_dominio": 1, "valor_presumido": 7}},
        "TBTIPOACOMOD": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        "RELOCLEITO": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1, "pai_inexistente": 1,
                                                     "restricao_destino_1264": 1, "restricao_destino_1062": 1,
                                                     "valor_fora_do_dominio": 1}},
        "RELEITO": {"gravados": 4, "pendencias": {"pai_pendente": 2, "restricao_destino_1062": 1,
                                                  "pai_inexistente": 1, "restricao_destino_1048": 1,
                                                  "valor_fora_do_dominio": 1}},
        "REOCUPLEITO": {"gravados": 6, "pendencias": {"restricao_destino_1062": 1, "restricao_destino_4025": 1,
                                                      "pai_pendente": 1, "pai_inexistente": 1,
                                                      "restricao_destino_1048": 2, "hora_sem_data": 2,
                                                      "data_sentinela": 1, "valor_presumido": 10}},
    }
