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
import datetime

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
CREATE TABLE PODIA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE POTPINIBANCO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE POPROGSIT (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE POPROSITUACAO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE POBANCOHRTP (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE PETP_INTEGR_EVENTO (COD_INTEGR_EVENTO SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50));
CREATE TABLE PEPARAM (COD_EMP INTEGER NOT NULL PRIMARY KEY, DESC_MIN_FALTA_MARC VARCHAR(1), QTD_MIN_DESC INTEGER,
  UTILIZA_BHRS VARCHAR(1), ABATER_ATR_HR_EXT VARCHAR(1), QTD_MIN_ATR INTEGER, QTD_MIN_HR_EXT INTEGER,
  NRO_PORTA_COM SMALLINT, MIN_MARC_ADT_HR_EXT VARCHAR(1), MSG_ANIVER VARCHAR(40), INT_FOLHA_PGTO VARCHAR(1),
  CAMIN_FOTO VARCHAR(150), INT_ENT_MARC INTEGER, EDIT_REL VARCHAR(250), POL_MARCACAO VARCHAR(1), PER_INICIAL DATE,
  PER_FINAL DATE, HORA_NOTURNO_INICIAL TIMESTAMP, HORA_NOTURNO_FINAL TIMESTAMP, TP_TOLERANCIA CHAR(1),
  GERAR_EXTRA_FERIADO_NORMAL CHAR(1), GERAR_EXTRA_FERIADO_ESCALONADO CHAR(1), GERAR_EXTRA_FERIADO_MEIO_PER CHAR(1),
  GERAR_EXTRA_INTER_SEM_REG_ESC CHAR(1));
CREATE TABLE FPVALE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(45) NOT NULL, ID_FPTPVALE SMALLINT NOT NULL);
"""

# rodada 5 (correção): PEPARAM fica BLOQUEADA até o produto ter as definições do ponto (pedido em
# saida/L5-11.json); a sintética não cria definição que o produto não tem
PREPARO_DESTINO = """
CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);
INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);
"""


PROVADAS = {'PODIA': [(1, 'Domingo'), (2, 'Segunda'), (3, 'Terça'), (4, 'Quarta'), (5, 'Quinta'), (6, 'Sexta'), (7, 'Sábado'), (8, 'Feriado')], 'POTPINIBANCO': [(1, 'Admissão'), (2, 'Data fixa'), (3, 'Competência'), (4, 'Adesão')]}


def linhas(r, ins):
    # listas fixas com prova derivado (provas.d): a mesma lista conhecida; não carregadas, só conferidas
    for t in PROVADAS:
        for n, rot in PROVADAS[t]:
            ins(t, [n, rot])
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
    # rodada 5 (ADR 0006): listas fixas sem prova possível entram como listas do hospital (parametro_opcao sob a
    # definição migracao.<lista>, módulo migracao criado pela 1.ª linha e adotado depois: adotado_existente, baixa)
    for i, n in [(1, "Programada ex"), (2, "Liberada ex"), (3, "Fechada ex"), (4, "Cancelada ex"), (5, "Refeita ex")]:
        ins("POPROGSIT", [i, n])
    for i, n in [(1, "Aberta ex"), (2, "Calculada ex"), (3, "Fechada ex")]:
        ins("POPROSITUACAO", [i, n])
    for i, n in [(1, "Banco  ex  um"), (2, "Banco ex dois"), (3, "Banco ex três"), (4, "Banco ex quatro")]:
        ins("POBANCOHRTP", [i, n])
    for i in (1, 2, 3, 5, 8):          # o 8 sem descrição: o rótulo é o próprio código
        ins("PETP_INTEGR_EVENTO", [i, None if i == 8 else "Evento integração ex %d" % i])
    # configuração do ponto da empresa: uma linha com todas as colunas (retrato JSON numa definição por empresa)
    ins("PEPARAM", [1, "S", 10, "S", "N", 5, 10, 1, "N", "Feliz aniversário ex", "S", "C:\\fotos_ex", 30, "editor_ex",
                    "1", datetime.date(2026, 1, 1), datetime.date(2026, 1, 31), datetime.datetime(1899, 12, 30, 22, 0),
                    datetime.datetime(1899, 12, 30, 5, 0), "M", "S", "N", "N", "S"])
    return {
        "POPROGSIT": {"gravados": 5, "pendencias": {"adotado_existente": 9}},
        "POPROSITUACAO": {"gravados": 3, "pendencias": {"adotado_existente": 5}},
        "POBANCOHRTP": {"gravados": 4, "pendencias": {"adotado_existente": 7}},
        "PETP_INTEGR_EVENTO": {"gravados": 5, "pendencias": {"adotado_existente": 9}},
        "PEPARAM": {"gravados": 1, "pendencias": {}},
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
