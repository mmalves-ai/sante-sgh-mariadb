"""Fatia L6-14 (prontuário, assinatura e assistência, módulo INT): tabelas da origem com coluna declarada e anomalias.

Dados 100% falsos (nomes e códigos inventados). Carregadas (CARREGADAS) e anomalias cobertas:
- RETPLEITO: nome com espaços repetidos (texto_nome colapsa), nome nulo e nome só de espaços (descrição NOT NULL:
  restricao_destino_1048); categoria presumida 'outro' (valor_presumido por linha);
- RIBLOCOS: nome nulo (1048); andares e ordem negativos (inteiro_nao_negativo: NULL com valor_fora_do_dominio, o
  bloco grava e não derruba leitos em cascata); código que só difere pela caixa de outro ('a' e 'A' são blocos
  distintos na origem; a chave única composta do destino não distingue caixa: hoje restricao_destino_1062); destino
  secundário unidade_internacao (unidade assistencial pela UNID, tipo presumido, idades em anos): UNID nula recusa o
  bloco (1048), o segundo bloco da mesma unidade assistencial ADOTA a unidade de internação (UNIQUE do modelo, M5);
- RISITREGLEITO: nome nulo (1048), código da central nulo (aceito), estado presumido 'cancelado' (pedido 67) com a linha
  inativa (o NIR não a usa) até o de-para de valores (valor_presumido conta toda linha lida, inclusive a recusada);
- TBALTARN: nome só de espaços (vira NULL: 1048), nome com acento, óbito presumido FALSE com a linha inativa.
- RITITFIC: o mesmo COD em duas variantes de impressão (GRAFICA N e S: a segunda ADOTA o título, adotado_existente),
  nome nulo (1048), FICINT fora do S/N (valor_fora_do_dominio), finalidade presumida 'outro';
- RIMODFIC: variante adotada; título pela chave composta ausente (pai_inexistente, grava) e recusado (pai_pendente);
  cópias 0, ordem negativa e idade acima de 150 (valor_fora_do_dominio); nome nulo (1048); conteúdo presumido;
- RICONFIC: variante adotada; fonte pagadora inexistente (pai_inexistente, grava com NULL), modelo recusado
  (pai_pendente), modelo sem COD (pai_inexistente no modelo e no título, 1048), SELECAO fora do S/N;
- RIESPFIC: variante adotada; especialidade por pai externo.
- RIACOMOD (alimentadora única de acomodacao): bloco e unidade de internação do bloco (ref:RIBLOCOS e
  ref:RIBLOCOS/unidade_internacao), nome vazio cai no código (concorrente), sexo pelo de-para de valores (código sem
  par: valor_fora_do_dominio), capacidade 0 (padrão 1), categoria nula (1048), bloco recusado (pai_pendente), bloco
  inexistente (1048), idades com a unidade em TBUNID_IDADE (#dias, ano e mês: periodo_aproximado; unidade
  inexistente: pai_inexistente), mínima acima da máxima (CHECK do destino), centro de custo inexistente;
- RICTRLOC (ocupacao_leito): internação (pai externo), acomodação pela chave composta, leito pela chave alternativa
  composta BLOCO,ACOMOD,LEITO (o mesmo código de leito em dois quartos não confunde), unidade de internação do bloco,
  início e fim por data + hora HHMM, situação encerrada quando há saída; sem data de entrada (1048), leito inexistente
  (1048), quarto recusado (pai_pendente), fim antes do início (CHECK). Tipo de movimento 'admissao' presumido.
- RILEITOS (tabela da L6-15, declarada lá): carrega de fato aqui, porque RICTRLOC aponta o leito pela chave
  alternativa composta na ORIGEM; o leito "1" existe em quartos de unidades diferentes (A/101 e UTI/U1) e a chave
  composta não confunde; leito de quarto recusado (pai_pendente); situação no domínio medido da L6-15 (A livre,
  I inativo); sigla sem par (valor_fora_do_dominio); o literal 'livre' presumido concorrente marca valor_presumido por linha. Os códigos de leito são únicos na unidade de internação (UNIQUE do destino).
- RIPARAM: só os contadores de numeração, desdobrados em sequencia_negocio inativa (como REPARAM na L6-02): quatro
  com valor (um deles zero) e dois vazios (sem item); médicos padrão e competências não carregam.
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
CREATE TABLE RIACOMOD (BLOCO VARCHAR(5) NOT NULL, ACOMOD VARCHAR(6) NOT NULL, NOME VARCHAR(40), ANDAR SMALLINT,
  SEXO VARCHAR(1), LEITOS SMALLINT, TIPO SMALLINT, LOCUP SMALLINT, CDC INTEGER, LCONS SMALLINT, CLINICA VARCHAR(1),
  TCONV VARCHAR(1), ACOMOD_TISS SMALLINT, NUMAIH VARCHAR(4), IDADE_MINIMA SMALLINT, IDADE_MAXIMA SMALLINT,
  ID_TBUNID_IDADE_MIN SMALLINT, ID_TBUNID_IDADE_MAX SMALLINT, CONSTRAINT PK_RIACOMOD PRIMARY KEY (BLOCO, ACOMOD));
CREATE TABLE TBUNID_IDADE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE RILEITOS (ID SMALLINT NOT NULL PRIMARY KEY, BLOCO VARCHAR(5) NOT NULL, ACOMOD VARCHAR(6) NOT NULL,
  LEITO VARCHAR(5) NOT NULL, ANDAR SMALLINT, REG INTEGER NOT NULL, STATUS VARCHAR(1), RAMAL SMALLINT,
  INAMPS VARCHAR(10), ORDEM SMALLINT);
CREATE TABLE RIPARAM (PRONT INTEGER, REGISTRO INTEGER, MESPRO SMALLINT, ANOPRO SMALLINT, REGANT INTEGER,
  PRTANT INTEGER, MEDRESP DOUBLE PRECISION, MEDLAUDO DOUBLE PRECISION, PRT_OTMU INTEGER, PRTA_OTMU INTEGER,
  MESSUS SMALLINT, ANOSUS SMALLINT, MESCONV SMALLINT, ANOCONV SMALLINT);
CREATE TABLE RICTRLOC (BLOCO VARCHAR(5), ACOMOD VARCHAR(6), LEITO VARCHAR(5), ENTRADA DATE, HORAENT VARCHAR(4),
  SAIDA DATE, HORASAI VARCHAR(4), REG INTEGER NOT NULL, ID_TBTIPOACOMOD SMALLINT NOT NULL, COD INTEGER NOT NULL,
  ID_DIGITAL VARCHAR(36));
"""
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
# e o catálogo-base de situação do leito (semente do 'criar novo cliente'), procurado pelo código (`cod:`) em RILEITOS
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');"
                   " CREATE TABLE IF NOT EXISTS situacao_leito (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(30) NOT NULL, UNIQUE KEY uq_situacao_leito_codigo (codigo));"
                   " INSERT INTO situacao_leito (codigo, descricao, situacao_base, criado_em) SELECT c, c, c, UTC_TIMESTAMP(3) FROM"
                   " (SELECT 'livre' c UNION ALL SELECT 'ocupado' UNION ALL SELECT 'reservado' UNION ALL SELECT"
                   " 'higienizacao' UNION ALL SELECT 'interditado' UNION ALL SELECT 'manutencao' UNION ALL SELECT"
                   " 'bloqueado' UNION ALL SELECT 'inativo') s")
# Pais de fora da fatia dados como já carregados. TBUNIDAD (L5, ordem 90) carrega de fato antes de RIBLOCOS.
# TBCONVEN e TBESPEC (L5) HOJE carregam DEPOIS de RICONFIC e RIESPFIC no mapa: só valem como já carregados depois das
# dependências RICONFIC -> TBCONVEN e RIESPFIC -> TBESPEC pedidas no L6-14.json; o teste test_ordem_de_carga confere a
# ordem real do mapa e falha até lá (sem a aresta, a fonte e a especialidade ficariam NULL = regra para todas).
PAIS_EXTERNOS = {"TBUNIDAD": ["1", "2"], "TBCONVEN": ["10", "20"], "TBESPEC": ["30", "40"],
                 "TBTIPOACOMOD": ["1", "2"], "TBCENCUS": ["10"], "TBCLINICA": ["C"],
                 "RICADINT": ["900001", "900002", "900003"]}
# Pais lidos na imagem: TBUNID_IDADE (L5-05: o nome da unidade da idade, pela referência encadeada; carrega junto).
# RILEITOS (L6-15) é declarada lá e carrega de fato aqui (está em CARREGADAS): RICTRLOC acha o leito pela chave
# alternativa composta na origem e o id pelo conector_origem da carga real (nunca mais pai externo).
CADEIA = ("TBUNID_IDADE",)
CARREGADAS = ("RETPLEITO", "RIBLOCOS", "RISITREGLEITO", "TBALTARN", "RITITFIC", "RIMODFIC", "RICONFIC", "RIESPFIC",
              "RIACOMOD", "RILEITOS", "RICTRLOC", "RIPARAM")
DESDOBRADAS = {"RIPARAM": 1}   # linhas da origem que gravam itens (o esperado "gravados" conta itens)


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
    for x in [(1, "Anos"), (2, "Meses"), (3, "Dias")]:
        ins("TBUNID_IDADE", list(x))
    # BLOCO, ACOMOD, NOME, ANDAR, SEXO, LEITOS, TIPO, LOCUP, CDC, LCONS, CLINICA, TCONV, ACOMOD_TISS, NUMAIH,
    # IDADE_MINIMA, IDADE_MAXIMA, ID_TBUNID_IDADE_MIN, ID_TBUNID_IDADE_MAX
    for x in [("A", "101", "Quarto  101", 1, "M", 2, 1, 0, 10, None, "C", None, None, "0101", 0, 120, 1, 1),
              ("A", "102", None, 1, "F", 0, 1, None, None, None, None, None, None, None, None, None, None, None),
              ("UTI", "U1", "UTI leito", 2, "X", 4, 2, None, 99, None, None, None, None, None, 18, 30, 3, 3),
              ("A", "103", "Sem categoria", 1, None, 1, None, None, None, None, None, None, None, None, None, None,
               None, None),
              ("B", "201", "Bloco recusado", 1, None, 1, 1, None, None, None, None, None, None, None, None, None,
               None, None),
              ("Z", "999", "Bloco inexistente", 1, None, 1, 1, None, None, None, None, None, None, None, None, None,
               None, None),
              ("D", "401", "Faixa invertida", 1, None, 1, 1, None, None, None, None, None, None, None, 10, 2, 1, 2),
              ("D", "402", "Unidade inexistente", 1, None, 1, 2, None, None, None, None, None, None, None, 5, None, 9,
               None)]:
        ins("RIACOMOD", list(x))
    # ID, BLOCO, ACOMOD, LEITO, ANDAR, REG, STATUS, RAMAL, INAMPS, ORDEM: o leito "1" existe em dois quartos de
    # unidades diferentes (A/101 e UTI/U1); D adota a unidade de internação de A (mesma unidade assistencial), por isso
    # o leito do quarto 402 tem código próprio; o leito do quarto 201 (bloco recusado) fica pai_pendente
    # STATUS no domínio medido A/I da L6-15 (A livre, I inativo); X sem par e vazio: livre presumida
    for x in [(1, "A", "101", "1", 1, 0, "A", 201, "0101", 1), (2, "A", "102", "2", 1, 0, "I", 202, None, 2),
              (3, "UTI", "U1", "1", 2, 0, "X", None, None, 3), (4, "B", "201", "1", 1, 0, "A", None, None, 4),
              (5, "D", "402", "5", 1, 0, None, None, None, 5)]:
        ins("RILEITOS", list(x))
    # BLOCO, ACOMOD, LEITO, ENTRADA, HORAENT, SAIDA, HORASAI, REG, ID_TBTIPOACOMOD, COD, ID_DIGITAL
    for x in [("A", "101", "1", "2026-01-05", "0830", "2026-01-07", "1400", 900001, 1, 1, None),
              ("A", "102", "2", "2026-01-07", "1400", None, None, 900001, 1, 2, None),
              ("UTI", "U1", "1", "2026-02-01", "2359", None, "", 900002, 2, 3, None),
              ("A", "101", "1", None, None, None, None, 900003, 1, 4, None),
              ("A", "101", "7", "2026-03-01", "1000", "2026-03-02", "1000", 900003, 1, 5, None),
              ("B", "201", "1", "2026-03-01", "1000", "2026-03-02", "1000", 900003, 1, 6, None),
              ("A", "101", "1", "2026-03-05", "1000", "2026-03-04", "0900", 900003, 1, 7, None)]:
        ins("RICTRLOC", list(x))
    # PRONT, REGISTRO, MESPRO, ANOPRO, REGANT, PRTANT, MEDRESP, MEDLAUDO, PRT_OTMU, PRTA_OTMU, MESSUS, ANOSUS, MESCONV,
    # ANOCONV: quatro contadores com valor (REGANT zero) e dois vazios
    ins("RIPARAM", [5000, 7000, 10, 2026, 0, None, 123.0, 456.0, None, 12, 9, 2026, 10, 2026])
    return {
        "RETPLEITO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 2, "valor_presumido": 5}},
        # r5b: motor r5 (ADR 0007, 20): mescla não destrutiva guarda o conflito da origem (pendência baixa)
        "RIBLOCOS": {"gravados": 4, "pendencias": {"mescla_conflito_origem_guardada": 2, "restricao_destino_1048": 2, "restricao_destino_1062": 1,
                                                   "valor_fora_do_dominio": 2, "adotado_existente": 2,
                                                   "valor_presumido": 7}},
        "RISITREGLEITO": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        "TBALTARN": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        "RITITFIC": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5,
                                                   "adotado_existente": 1, "valor_fora_do_dominio": 1}},
        "RIMODFIC": {"gravados": 5, "pendencias": {"mescla_conflito_origem_guardada": 1, "restricao_destino_1048": 1, "pai_pendente": 1, "valor_presumido": 6,
                                                   "adotado_existente": 1, "valor_fora_do_dominio": 3,
                                                   "pai_inexistente": 2}},
        "RICONFIC": {"gravados": 5, "pendencias": {"mescla_conflito_origem_guardada": 1, "restricao_destino_1048": 1, "pai_pendente": 1,
                                                   "adotado_existente": 1, "valor_fora_do_dominio": 1,
                                                   "pai_inexistente": 4}},
        "RIESPFIC": {"gravados": 4, "pendencias": {"adotado_existente": 1}},
        # 101 (idades em anos), 102 (sem nome: o código; capacidade 0), U1 (sexo sem par; centro de custo
        # inexistente) e 402 (unidade da idade inexistente) gravam; sem categoria e bloco inexistente (1048), bloco
        # recusado (pai_pendente), faixa invertida (CHECK 4025)
        "RIACOMOD": {"gravados": 4, "pendencias": {"pai_inexistente": 4, "pai_pendente": 1, "periodo_aproximado": 4,
                                                   "restricao_destino_1048": 2, "restricao_destino_4025": 1,
                                                   "valor_fora_do_dominio": 2}},
        # três períodos gravam (o leito "1" de A/101 e de UTI/U1 resolvido pela chave composta); sem entrada e leito
        # inexistente (1048), quarto recusado (pai_pendente), fim antes do início (CHECK 4025)
        "RICTRLOC": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "pai_pendente": 1,
                                                   "restricao_destino_1048": 2, "restricao_destino_4025": 1,
                                                   "valor_presumido": 6}},
        # 1, 2, 3 e 5 gravam; 4 (quarto do bloco recusado) pai_pendente; sigla X sem par (valor_fora_do_dominio);
        # o literal presumido 'livre' concorrente da L6-15 (=~livre) marca valor_presumido em cada linha gravada
        "RILEITOS": {"gravados": 4, "pendencias": {"pai_pendente": 1, "valor_fora_do_dominio": 1,
                                                   "valor_presumido": 2}},  # r5b: a declaração da L6-15 (dona) hoje presume em 2 linhas,
        # quatro sequências (itens) da única linha, inativas e presumidas
        "RIPARAM": {"gravados": 4, "pendencias": {"valor_presumido": 1}},
    }
