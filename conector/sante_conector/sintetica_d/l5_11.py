"""Fatia L5-11 (cadastros e administração, módulo RH): tabelas da origem com as colunas declaradas em
`conector/mapa/declarado/colunas.d/L5-11.tsv`, dados 100% falsos e as anomalias da fatia.

Só entram as tabelas com coluna declarada; as demais da fatia são descarte de produto em `declarado/sem_carga.tsv`
(domínio fixo de CHECK no consumidor, catálogo oficial, parâmetro da instalação). Tipo de hora, de intervalo e de
relógio são cadastros próprios (tabela no modelo, consumida por FK) e carregam; o vale entra em beneficio com código
prefixado (v) para não colidir com o código do tipo de vale (FPTPVALE). Anomalias: descrição nula em
destino NOT NULL (restricao_destino_1048), limite semanal fora de 1..44, inclusive 0 (faixa: NULL com
valor_fora_do_dominio), espaços e quebra interna na descrição (texto preserva; texto_nome colapsa), acentos CP1252,
chaves com lacunas e classificador sem fonte gravado como literal presumido (valor_presumido, uma por coluna presumida em cada linha lida, também na recusada).
"""

DDL = """
CREATE TABLE FPVACINA (COD_VAC SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50));
CREATE TABLE POTPCONTTEMP (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40) NOT NULL, LIMITE_HORA_SEMANAL SMALLINT);
CREATE TABLE PEPERIOD_JUSTIF (COD_PERIOD_JUSTIF SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50));
CREATE TABLE PETP_MOVIM (COD_TP_MOVIM SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50));
CREATE TABLE POCLASSIFMARC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40) NOT NULL);
CREATE TABLE POTPTRABFOLGA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(150) NOT NULL);
CREATE TABLE POTPHORA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(45) NOT NULL);
CREATE TABLE PETPINTERVALO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(15) NOT NULL);
CREATE TABLE POREPHOMOLOGADO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE FPVALE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(45) NOT NULL, ID_FPTPVALE SMALLINT NOT NULL);
"""


def linhas(r, ins):
    # vacina: 7 linhas, a 4 sem descrição (NOT NULL no destino); a 2 com espaço e quebra internos preservados
    for i in range(1, 8):
        d = None if i == 4 else ("Vacina  exemplo\n%d ção" % i if i == 2 else "Vacina exemplo %d" % i)
        ins("FPVACINA", [i * 10, d])
    # contrato temporário: limite 60 e 0 (sentinela provável de "sem limite") fora de 1..44 viram NULL; nulo aceito
    for i, lim in [(1, 44), (2, None), (3, 60), (4, 20), (5, 0)]:
        ins("POTPCONTTEMP", [i, "  Contrato   exemplo %d " % i, lim])  # nome: texto_nome colapsa
    # período da justificativa: 5 linhas com lacuna na chave; a 7 sem descrição (recusa)
    for i in (1, 2, 3, 7, 9):
        ins("PEPERIOD_JUSTIF", [i, None if i == 7 else "Período exemplo %d" % i])
    # tipo de movimento: 4 linhas; espaços internos preservados pela regra texto
    for i in (1, 2, 5, 8):
        ins("PETP_MOVIM", [i, "Movimento  exemplo %d" % i if i == 5 else "Movimento exemplo %d" % i])
    for i in (1, 2, 3):
        ins("POCLASSIFMARC", [i, " Classificação   exemplo %d " % i])
    for i in (1, 2, 4, 6):
        ins("POTPTRABFOLGA", [i, "Regime  trabalho folga exemplo %d" % i])
    # tipo de hora: 9 linhas com lacuna na chave (cadastro próprio: tipo_hora), nome com espaços colapsados
    for i in (1, 2, 3, 4, 5, 6, 7, 8, 10):
        ins("POTPHORA", [i, "  Hora   exemplo %d ção" % i])
    # tipo de intervalo: 5 linhas; a 15 caracteres no limite da origem
    for i in (1, 2, 3, 4, 5):
        ins("PETPINTERVALO", [i, "Intervalo ex %d" % i])
    for i in (1, 2, 3):
        ins("POREPHOMOLOGADO", [i, "Relógio exemplo %d" % i])
    # vale: códigos 1 e 2 iguais aos do tipo (FPTPVALE grava '1', '2' em beneficio): o prefixo v evita a colisão
    for i, tp in [(1, 1), (2, 1), (3, 2)]:
        ins("FPVALE", [i, "Vale  exemplo %d" % i, tp])
    return {
        "FPVACINA": {"gravados": 6, "pendencias": {"restricao_destino_1048": 1}},
        "POTPCONTTEMP": {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 2}},
        "PEPERIOD_JUSTIF": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        "PETP_MOVIM": {"gravados": 4, "pendencias": {"valor_presumido": 4}},
        "POCLASSIFMARC": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
        "POTPTRABFOLGA": {"gravados": 4, "pendencias": {"valor_presumido": 8}},
        "POTPHORA": {"gravados": 9, "pendencias": {"valor_presumido": 9}},
        "PETPINTERVALO": {"gravados": 5, "pendencias": {"valor_presumido": 5}},
        "POREPHOMOLOGADO": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
        "FPVALE": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
    }
