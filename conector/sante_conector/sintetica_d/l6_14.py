"""Fatia L6-14 (prontuário, assinatura e assistência, módulo INT): tabelas da origem com coluna declarada e anomalias.

Dados 100% falsos (nomes e códigos inventados). Carregadas (CARREGADAS) e anomalias cobertas:
- RETPLEITO: nome com espaços repetidos (texto_nome colapsa), nome nulo e nome só de espaços (descrição NOT NULL:
  restricao_destino_1048); categoria presumida 'outro' (valor_presumido por linha);
- RIBLOCOS: nome nulo (1048); andares e ordem negativos (inteiro_nao_negativo: NULL com valor_fora_do_dominio, o
  bloco grava e não derruba leitos em cascata); código que só difere pela caixa de outro ('a' e 'A' são blocos
  distintos na origem; a chave única composta do destino não distingue caixa: hoje restricao_destino_1062); destino
  secundário unidade_internacao (unidade assistencial pela UNID, tipo presumido, idades em anos): UNID nula recusa o
  bloco (1048), o segundo bloco da mesma unidade assistencial ADOTA a unidade de internação (UNIQUE do modelo, M5);
- RISITREGLEITO: nome nulo (1048), código da central nulo (aceito), estado presumido 'solicitado' com a linha
  inativa (o NIR não a usa) até o de-para de valores (valor_presumido conta toda linha lida, inclusive a recusada);
- TBALTARN: nome só de espaços (vira NULL: 1048), nome com acento, óbito presumido FALSE com a linha inativa.
- RITITFIC: o mesmo COD em duas variantes de impressão (GRAFICA N e S: a segunda ADOTA o título, adotado_existente),
  nome nulo (1048), FICINT fora do S/N (valor_fora_do_dominio), finalidade presumida 'outro';
- RIMODFIC: variante adotada; título pela chave composta ausente (pai_inexistente, grava) e recusado (pai_pendente);
  cópias 0, ordem negativa e idade acima de 150 (valor_fora_do_dominio); nome nulo (1048); conteúdo presumido;
- RICONFIC: variante adotada; fonte pagadora inexistente (pai_inexistente, grava com NULL), modelo recusado
  (pai_pendente), modelo sem COD (pai_inexistente no modelo e no título, 1048), SELECAO fora do S/N;
- RIESPFIC: variante adotada; especialidade por pai externo.
- RICTRLOC: declarada (internação, acomodação, leito por referência), mas a data e hora de entrada (M3) e a unidade de
  internação (M1) ainda não têm fonte: toda linha é recusada (NOT NULL), com pai_inexistente da internação, da
  acomodação e do leito, que carregam depois na ordem (RICADINT, RIACOMOD, RILEITOS: dependências pedidas).
RIPARAM é descarte de produto (sem_carga.tsv).
"""

DDL = """
CREATE TABLE RETPLEITO (ID SMALLINT NOT NULL PRIMARY KEY, COD_TP_LEITO SMALLINT NOT NULL, NOME VARCHAR(30));
CREATE TABLE RIBLOCOS (BLOCO VARCHAR(5) NOT NULL PRIMARY KEY, NOME VARCHAR(40), ANDARES SMALLINT, IDAMIN SMALLINT,
  IDAMAX SMALLINT, UNID SMALLINT, ORDEM SMALLINT);
CREATE TABLE RISITREGLEITO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40), CODIGO INTEGER);
CREATE TABLE RITITFIC (COD SMALLINT NOT NULL, NOME VARCHAR(30), GRAFICA VARCHAR(1) NOT NULL, FICINT VARCHAR(1),
  PRIMARY KEY (COD, GRAFICA));
CREATE TABLE RIMODFIC (COD SMALLINT NOT NULL, NOME VARCHAR(30), QTDE SMALLINT, ORDEM SMALLINT, CLINICA VARCHAR(50),
  IMPNA VARCHAR(1), CONFIMP VARCHAR(1), GRAFICA VARCHAR(1) NOT NULL, DUPLEX VARCHAR(1), IDADEI INTEGER, IDADEF INTEGER,
  PRIMARY KEY (COD, GRAFICA));
CREATE TABLE RICONFIC (COD SMALLINT, CONV SMALLINT, SELECAO CHAR(1), GRAFICA VARCHAR(1) NOT NULL);
CREATE TABLE RIESPFIC (COD SMALLINT, ESP SMALLINT, SELECAO CHAR(1), GRAFICA VARCHAR(1) NOT NULL);
CREATE TABLE TBALTARN (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE RICTRLOC (BLOCO VARCHAR(5), ACOMOD VARCHAR(6), LEITO VARCHAR(5), ENTRADA DATE, HORAENT VARCHAR(4),
  SAIDA DATE, HORASAI VARCHAR(4), REG INTEGER NOT NULL, ID_TBTIPOACOMOD SMALLINT NOT NULL, COD INTEGER NOT NULL,
  ID_DIGITAL VARCHAR(36));
"""
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')")
# Pais de fora da fatia dados como já carregados. TBUNIDAD (L5, ordem 90) carrega de fato antes de RIBLOCOS.
# TBCONVEN e TBESPEC (L5) HOJE carregam DEPOIS de RICONFIC e RIESPFIC no mapa: só valem como já carregados depois das
# dependências RICONFIC -> TBCONVEN e RIESPFIC -> TBESPEC pedidas no L6-14.json; o teste test_ordem_de_carga confere a
# ordem real do mapa e falha até lá (sem a aresta, a fonte e a especialidade ficariam NULL = regra para todas).
PAIS_EXTERNOS = {"TBUNIDAD": ["1", "2"], "TBCONVEN": ["10", "20"], "TBESPEC": ["30", "40"]}
CARREGADAS = ("RETPLEITO", "RIBLOCOS", "RISITREGLEITO", "TBALTARN", "RITITFIC", "RIMODFIC", "RICONFIC", "RIESPFIC",
              "RICTRLOC")


def linhas(r, ins):
    for x in [(1, 1, "Maca  do   pronto"), (2, 2, "Poltrona"), (3, 3, None), (4, 1, "   "),
              (5, 2, "Leito de observação")]:
        ins("RETPLEITO", list(x))
    for x in [("A", "Bloco  A", 3, 0, 120, 1, 1), ("B", "Bloco B", 2, None, None, None, None),
              ("C", None, 1, None, None, 1, 3), ("D", "Bloco D", -1, None, None, 1, 4),
              ("UTI", "  UTI   adulto ", 1, 18, 130, 2, 5), ("a", "Bloco anexo", 1, None, None, 1, 6),
              ("E", "Bloco E", 2, None, None, 1, -2)]:
        ins("RIBLOCOS", list(x))
    for x in [(1, "Aguardando  vaga", 10), (2, "Em análise", 20), (3, None, 30), (4, "Negado", None),
              (5, "Efetivado", 50)]:
        ins("RISITREGLEITO", list(x))
    for x in [(1, "Alta  junto", ), (2, "Permanece"), (3, "Transferido"), (4, "Óbito"), (5, "   ")]:
        ins("TBALTARN", list(x))
    for x in [(1, "Guia  de internação", "N", "S"), (1, "Guia de internação", "S", "S"),
              (2, "Termo de responsabilidade", "S", None), (4, "Ficha de admissão", "S", "X"), (5, None, "S", "N")]:
        ins("RITITFIC", list(x))
    # COD, NOME, QTDE, ORDEM, CLINICA, IMPNA, CONFIMP, GRAFICA, DUPLEX, IDADEI, IDADEF
    for x in [(1, "Guia  internação", 1, 1, None, "A", "S", "N", "N", None, None),
              (1, "Guia internação", 2, 1, None, "A", "N", "S", "S", None, None),
              (2, "Termo", 0, 2, "Clínica exemplo", None, "S", "S", "N", 0, 12),
              (4, "Ficha", 1, -1, None, None, None, "S", None, 10, 200),
              (3, "Sem título", 1, 3, None, None, "N", "S", "N", None, None),
              (5, "Título recusado", 1, 4, None, None, None, "S", None, None, None),
              (6, None, 1, 5, None, None, None, "S", None, None, None)]:
        ins("RIMODFIC", list(x))
    for x in [(1, 10, "S", "N"), (1, 10, "N", "S"), (2, 20, "X", "S"), (2, 99, "S", "S"), (5, 10, "S", "S"),
              (3, None, "S", "S"), (None, 10, "S", "S")]:
        ins("RICONFIC", list(x))
    for x in [(1, 30, "S", "N"), (1, 30, "S", "S"), (2, 40, "N", "S"), (4, 30, "S", "S")]:
        ins("RIESPFIC", list(x))
    # BLOCO, ACOMOD, LEITO, ENTRADA, HORAENT, SAIDA, HORASAI, REG, ID_TBTIPOACOMOD, COD, ID_DIGITAL
    for x in [("A", "101", "1", "2026-01-05", "0830", "2026-01-07", "1400", 900001, 1, 1, None),
              ("A", "102", "2", "2026-01-07", "1400", None, None, 900001, 1, 2, None),
              ("UTI", "U1", "9", "2026-02-01", "2359", None, "", 900002, 2, 3, None)]:
        ins("RICTRLOC", list(x))
    return {
        "RETPLEITO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 2, "valor_presumido": 5}},
        "RIBLOCOS": {"gravados": 4, "pendencias": {"restricao_destino_1048": 2, "restricao_destino_1062": 1,
                                                   "valor_fora_do_dominio": 2, "adotado_existente": 2,
                                                   "valor_presumido": 7}},
        "RISITREGLEITO": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        "TBALTARN": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        "RITITFIC": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5,
                                                   "adotado_existente": 1, "valor_fora_do_dominio": 1}},
        "RIMODFIC": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1, "pai_pendente": 1, "valor_presumido": 6,
                                                   "adotado_existente": 1, "valor_fora_do_dominio": 3,
                                                   "pai_inexistente": 2}},
        "RICONFIC": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1, "pai_pendente": 1,
                                                   "adotado_existente": 1, "valor_fora_do_dominio": 1,
                                                   "pai_inexistente": 4}},
        "RIESPFIC": {"gravados": 4, "pendencias": {"adotado_existente": 1}},
        # data e hora de entrada (M3) sem fonte: 1364 em toda linha; internação, acomodação e leito carregam depois
        "RICTRLOC": {"gravados": 0, "pendencias": {"restricao_destino_1364": 3, "pai_inexistente": 9,
                                                   "valor_presumido": 3}},
    }
