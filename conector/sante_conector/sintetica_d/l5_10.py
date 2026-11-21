"""Fatia L5-10 (cadastros e administração, módulo RH): tabelas de domínio da origem, dados 100% falsos.

Carregada: tipos de colaborador. Bloqueadas até o de-para de valores (tipos de férias, de vale, de rubrica, de folha e
de referência da rubrica: a classificação vem do código ou da descrição) e não carregadas (catálogos oficiais e
domínios que viram valor de coluna enum) entram na imagem para provar que não geram carga.
Anomalias: descrição vazia em destino NOT NULL (recusa a linha), texto com espaços repetidos, CP1252 acentuado,
código de 1 caractere que só difere pela caixa em FPTP_EVENTO e FPTP_REFER (casos prontos para quando a carga for
liberada: o esperado será codigo_colisao_caixa).
"""
import datetime

DDL = """
CREATE TABLE FPTPDEPENDENT (DESCRICAO VARCHAR(230), ID VARCHAR(2) NOT NULL PRIMARY KEY, DATA_INICIAL DATE, DATA_FINAL DATE);
CREATE TABLE FPTPDEPENDENTREINF (ID VARCHAR(2) NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(230));
CREATE TABLE FPTPEVENTOAUT (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE FPTPFERIAS (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(10));
CREATE TABLE FPTPFOLHAESOC (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(15));
CREATE TABLE FPTPONUS (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(30));
CREATE TABLE FPTPONUSREMUN (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(100));
CREATE TABLE FPTPPENSAOALI (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(80));
CREATE TABLE FPTPPROCESSO (ID CHAR(1) NOT NULL PRIMARY KEY, NOME VARCHAR(35));
CREATE TABLE FPTPREGIMEPRE (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(100));
CREATE TABLE FPTPREGIMETRA (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(100));
CREATE TABLE FPTPREGJORNAD (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(70) NOT NULL);
CREATE TABLE FPTPREINTEG (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(40));
CREATE TABLE FPTPRESCDIRET (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(150) NOT NULL);
CREATE TABLE FPTPVALE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE FPTP_ARQ_EMPREGADORWEB (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(20));
CREATE TABLE FPTP_EVENTO (TP_EVENTO VARCHAR(1) NOT NULL PRIMARY KEY, NOME VARCHAR(20));
CREATE TABLE FPTP_EVENTO_SIND (COD_EVENTO_SIND SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50));
CREATE TABLE FPTP_FOLHA (COD_TP SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(20), ID_FPTPFOLHAESOC SMALLINT);
CREATE TABLE FPTP_FUNC (COD_TIPO SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50));
CREATE TABLE FPTP_REFER (TP_REFER VARCHAR(1) NOT NULL PRIMARY KEY, NOME VARCHAR(20));
"""

CARREGADAS = ("FPTP_FUNC",)
BLOQUEADAS = ("FPTPFERIAS", "FPTPVALE", "FPTP_EVENTO", "FPTP_FOLHA", "FPTP_REFER")
NAO_CARREGADAS = ("FPTPDEPENDENT", "FPTPDEPENDENTREINF", "FPTPEVENTOAUT", "FPTPFOLHAESOC", "FPTPONUS",
                  "FPTPONUSREMUN", "FPTPPENSAOALI", "FPTPPROCESSO", "FPTPREGIMEPRE", "FPTPREGIMETRA",
                  "FPTPREGJORNAD", "FPTPREINTEG", "FPTPRESCDIRET", "FPTP_ARQ_EMPREGADORWEB", "FPTP_EVENTO_SIND")


def linhas(r, ins):
    # não carregadas (só presença na imagem)
    for i in range(1, 4):
        ins("FPTPDEPENDENT", ["Tipo exemplo %d" % i, "%02d" % i, datetime.date(2020, 1, i), None])
        ins("FPTPDEPENDENTREINF", ["%d" % i, "Tipo REINF exemplo %d" % i])
        ins("FPTPEVENTOAUT", [i, "Evento exemplo %d" % i])
        ins("FPTPFOLHAESOC", [i, "Apuração %d" % i])
        ins("FPTPONUS", [i, "Ônus exemplo %d" % i])
        ins("FPTPONUSREMUN", [i, "Ônus remun. %d" % i])
        ins("FPTPPENSAOALI", [i, "Pensão exemplo %d" % i])
        ins("FPTPPROCESSO", ["ABC"[i - 1], "Processo exemplo %d" % i])
        ins("FPTPREGIMEPRE", [i, "Regime prev. %d" % i])
        ins("FPTPREGIMETRA", [i, "Regime trab. %d" % i])
        ins("FPTPREGJORNAD", [i, "Jornada exemplo %d" % i])
        ins("FPTPREINTEG", [i, "Reintegração %d" % i])
        ins("FPTPRESCDIRET", [i, "Motivo exemplo %d" % i])
        ins("FPTP_ARQ_EMPREGADORWEB", [i, "Arquivo %d" % i])
        ins("FPTP_EVENTO_SIND", [i, "Evento sindical %d" % i])
    # tipos de férias (bloqueada): 1 sem descrição (NOT NULL no destino)
    for g in [(1, "Normal"), (2, "Coletiva"), (3, None), (4, "Abono  10")]:
        ins("FPTPFERIAS", list(g))
    # vales (bloqueada): nome com espaços repetidos (colapsados) e acento
    for g in [(1, "Vale   transporte"), (2, "  Vale refeição "), (3, "Cesta básica")]:
        ins("FPTPVALE", list(g))
    # tipos de rubrica (bloqueada): 'p' colide com 'P' no destino (não distingue caixa)
    for g in [("P", "Provento"), ("D", "Desconto"), ("B", "Base"), ("I", "Informativo"), ("p", "Provento minúsculo")]:
        ins("FPTP_EVENTO", list(g))
    # tipos de folha (bloqueada): 1 sem descrição; indicativo 2 (anual) no 13º
    for g in [(1, "Mensal", 1), (2, "Adiantamento", 1), (3, "13o salário", 2), (4, None, 1), (5, "Férias", None)]:
        ins("FPTP_FOLHA", list(g))
    # tipos de colaborador: nome só com espaços vira vazio (NOT NULL no destino)
    for i in range(1, 7):
        ins("FPTP_FUNC", [i, "   " if i == 4 else "Tipo  colaborador %d" % i])
    # tipos de referência (bloqueada): 1 sem nome; 'h' colide com 'H' pela caixa
    for g in [("H", "Horas"), ("D", "Dias"), ("P", None), ("V", "Valor"), ("h", "Horas minúsculo")]:
        ins("FPTP_REFER", list(g))
    return {
        "FPTP_FUNC": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1}},
    }
