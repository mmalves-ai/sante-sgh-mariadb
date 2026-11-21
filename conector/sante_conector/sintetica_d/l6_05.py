"""Fatia L6-05 (prontuário, assinatura e assistência, módulo PEP): tabelas da origem e anomalias, com dados 100% falsos.

Só as 12 tabelas carregáveis hoje pela carga dirigida pelo mapa (as outras 12 da fatia aguardam regra genérica do motor
ou decisão; ver docs/obra/fatias/f4/saida/L6-05.md). Anomalias: descrição vazia em destino NOT NULL (1048), código com
colisão de caixa (codigo_colisao_caixa nas duas linhas), S/N fora do domínio (padrão do destino), pai recusado
(pai_pendente), pai nunca visto (pai_inexistente + 1048), chave única repetida (1062), fórmula migrada
inativa (valor_presumido), texto com espaços repetidos, quebra de linha e acentos CP1252.
"""
DDL = """
CREATE TABLE GETABVIA (COD VARCHAR(2) NOT NULL PRIMARY KEY, NOME VARCHAR(35), ATIVO CHAR(1), ID_TBTISSVIAADMIN SMALLINT,
  ID_DIGITAL VARCHAR(36));
CREATE TABLE PRAGRAVOTPARQUETIPO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE PRAGRAVOPERGUNTA (ID INTEGER NOT NULL PRIMARY KEY, ID_PRAGRAVOTPARQUETIPO INTEGER NOT NULL,
  CODIGO INTEGER NOT NULL, SUBCODIGO INTEGER NOT NULL, NOME VARCHAR(255) NOT NULL);
CREATE TABLE PRBHINTENSIDADE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE PRBHTPELIMINA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL, DIGITAR_VOLUME_ELIMINADO CHAR(1),
  DIGITAR_VOLUME_ESTIMADO CHAR(1), DIGITAR_INTENSIDADE CHAR(1), DIGITAR_ASPECTO CHAR(1), DIGITAR_ITEM_PRESCRITO CHAR(1),
  ATIVO CHAR(1));
CREATE TABLE PRCAB_IDENTIFIC_PAC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(200), ATIVO CHAR(1));
CREATE TABLE PRCAMPOSLOCALIZACAOPACIENTE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE PRFA_UTILIZACAO (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(100) NOT NULL, ATIVO CHAR(1) NOT NULL);
CREATE TABLE PRFILTROCLASSIF (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE PRFILTROUSUARIO (ID SMALLINT NOT NULL PRIMARY KEY, ID_TBUSERS VARCHAR(31) NOT NULL, ATENDIMENTO CHAR(1),
  SITUACAO_NAO_EMITIDOS CHAR(1), RESULTADO_LIBERADO CHAR(1), TODOS_REGISTROS CHAR(1), SOMENTE_MEUS_PEDIDOS CHAR(1));
CREATE TABLE PRFINALIDADETRAT (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(80), ID_TBTISSFINTRAT SMALLINT);
CREATE TABLE PRFORMULA (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30), FORMULA VARCHAR(1000), ATIVO CHAR(1));
"""

# logins inventados de usuários já carregados (L3)
PAIS_EXTERNOS = {"TBUSERS": ["usuario.exemplo.um", "usuario.exemplo.dois"]}


U1, U2 = PAIS_EXTERNOS["TBUSERS"]

# (tabela, linhas, esperado)
DADOS = [
    ("GETABVIA", [["VO", "Via oral", "S", 1, None], ["IV", "Intravenosa", "S", 2, None],
                  ["SC", " Subcutânea  ", "N", None, "00000000-0000-0000-0000-000000000001"],
                  ["Ab", "Via exemplo caixa mista", "S", None, None], ["AB", "Via exemplo caixa alta", "S", None, None],
                  ["SN", None, "S", None, None], ["IM", "Intramuscular", "X", None, None]],
     {"gravados": 4, "pendencias": {"codigo_colisao_caixa": 2, "restricao_destino_1048": 1,
                                    "valor_fora_do_dominio": 1}}),
    ("PRAGRAVOTPARQUETIPO", [[1, "Agravo exemplo um"], [2, "Agravo  exemplo   dois"], [3, "   "],
                             [4, "Agravo exemplo quatro"]],
     {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}}),
    # sequência = id da origem (nunca muda: apagar a 2 e criar a 8 no diferencial não colide nem desloca a 3);
    # agravo 1: ids 1, 2, 3, 6; 6 repete campo e subcódigo do 2 (1062); 5 aponta o agravo recusado; 7 aponta agravo
    # nunca visto; 8 entra com lacuna na chave (sequência 8, depois da 3)
    ("PRAGRAVOPERGUNTA", [[1, 1, 10, 0, "Data dos primeiros sintomas"], [2, 1, 11, 0, "Febre?"],
                          [3, 1, 11, 1, "Temperatura  aferida"], [4, 2, 10, 0, "Pergunta exemplo"],
                          [5, 3, 10, 0, "Pergunta do agravo recusado"], [6, 1, 11, 0, "Febre repetida"],
                          [7, 9, 1, 0, "Pergunta de agravo inexistente"], [8, 1, 12, 0, "Pergunta nova depois de lacuna"]],
     {"gravados": 5, "pendencias": {"pai_pendente": 1, "restricao_destino_1062": 1, "pai_inexistente": 1,
                                    "restricao_destino_1048": 1}}),
    ("PRBHINTENSIDADE", [[1, "Pequena"], [2, "Moderada"], [3, "Grande"], [4, "  Muito\r\ngrande "]],
     {"gravados": 4, "pendencias": {}}),
    ("PRBHTPELIMINA", [[1, "Diurese", "S", "N", "N", "S", "N", "S"], [2, "Vômito", "N", "S", "S", "S", "N", "S"],
                       [3, "Dreno", "S", None, None, None, None, "N"], [4, "Evacuação", "X", "N", "N", "N", "N", "S"]],
     {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1}}),
    ("PRCAB_IDENTIFIC_PAC", [[1, "Dados atuais do paciente", "S"], [2, "Dados da emissão", "S"], [3, None, "N"]],
     {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}}),
    ("PRCAMPOSLOCALIZACAOPACIENTE", [[1, "Leito"], [2, "Dias de internação"], [3, "Alergia"]],
     {"gravados": 3, "pendencias": {}}),
    ("PRFA_UTILIZACAO", [[1, "Medicamento", "S"], [2, "Uso em bomba de infusão", "S"], [3, "Material", "N"]],
     {"gravados": 3, "pendencias": {}}),
    ("PRFILTROCLASSIF", [[1, "Classificação exemplo"]], {"gravados": 1, "pendencias": {}}),
    # 4: login nunca visto (pai_inexistente + NOT NULL)
    ("PRFILTROUSUARIO", [[1, U1, "A", "N", "S", "N", "S"], [2, U1, "T", "S", "N", "S", "N"],
                         [3, U2, None, None, None, None, None], [4, "usuario.exemplo.tres", "A", "N", "S", "N", "N"]],
     {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}}),
    ("PRFINALIDADETRAT", [[1, "Curativa", 1], [2, "Paliativa", 2], [3, "Adjuvante", None]],
     {"gravados": 3, "pendencias": {}}),
    # expressão na sintaxe da origem (não validada): as duas entram inativas; valor_presumido por coluna (base e ativo)
    ("PRFORMULA", [[1, "Superfície corporal", "peso * 0,1 + altura", "S"], [2, "Dose por peso", "peso * 10", "N"]],
     {"gravados": 2, "pendencias": {"valor_presumido": 4}}),
]


def linhas(r, ins):
    esperado = {}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        esperado[tab] = esp
    return esperado
