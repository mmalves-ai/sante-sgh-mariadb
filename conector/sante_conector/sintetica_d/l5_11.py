"""Fatia L5-11 (cadastros e administração, módulo RH): tabelas da origem com as colunas declaradas em
`conector/mapa/declarado/colunas.d/L5-11.tsv`, dados 100% falsos e as anomalias da fatia.

Só entram as tabelas com coluna declarada (as demais da fatia são domínio de CHECK, catálogo oficial, mecanismo ou
aguardam o de-para de valor: ver docs/obra/fatias/f4/saida/L5-11.md). Anomalias: descrição nula em destino NOT NULL
(restricao_destino_1048), limite semanal fora do CHECK 1..44, inclusive 0 (restricao_destino_4025),
espaços e quebra interna na descrição (texto preserva), acentos CP1252 e chaves com lacunas.
FPVALE, PETPINTERVALO e PETP_MOVIM ficam sem carga até o modelo e o de-para de valor (AGUARDAM_CLASSIFICACAO no teste).
"""

DDL = """
CREATE TABLE FPVACINA (COD_VAC SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50));
CREATE TABLE POTPCONTTEMP (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40) NOT NULL, LIMITE_HORA_SEMANAL SMALLINT);
"""


def linhas(r, ins):
    # vacina: 7 linhas, a 4 sem descrição (NOT NULL no destino); a 2 com espaço e quebra internos preservados
    for i in range(1, 8):
        d = None if i == 4 else ("Vacina  exemplo\n%d ção" % i if i == 2 else "Vacina exemplo %d" % i)
        ins("FPVACINA", [i * 10, d])
    # contrato temporário: limite 60 e 0 (sentinela provável de "sem limite") fora do CHECK (1..44); nulo aceito
    for i, lim in [(1, 44), (2, None), (3, 60), (4, 20), (5, 0)]:
        ins("POTPCONTTEMP", [i, "  Contrato   exemplo %d " % i, lim])  # nome: texto_nome colapsa
    return {
        "FPVACINA": {"gravados": 6, "pendencias": {"restricao_destino_1048": 1}},
        "POTPCONTTEMP": {"gravados": 3, "pendencias": {"restricao_destino_4025": 2}},
    }
