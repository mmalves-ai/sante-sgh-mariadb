"""Fatia L5-10 (cadastros e administração, módulo RH): tabelas de domínio da origem, dados 100% falsos.

Carregadas: tipos de colaborador, de rubrica (natureza e sinal por de-para de valores da letra, com evidência), de
referência da rubrica (unidade por de-para), de folha (indicativo de apuração e categoria derivada do mesmo código; ativo
presumido como marca de revisão) e de férias (categoria presumida). As 16 listas legais ou próprias do RH (rodada 5,
ADR 0006, decisão do conferidor r5-1/r5-2) carregam como opções ativas de um parâmetro de lista rh.lista.<nome>
(definição e módulo migracao criados pela 1.ª linha e adotados pelas outras: adotado_existente, baixa).
Anomalias: descrição vazia em destino NOT NULL (recusa a linha), texto com espaços repetidos, CP1252 acentuado,
código de 1 caractere que só difere pela caixa em FPTP_EVENTO e FPTP_REFER (codigo_colisao_caixa no grupo todo),
código sem par no de-para de valores (valor_fora_do_dominio), indicativo da folha fora de 1 e 2 (3 a 5: NULL no
indicativo e categoria presumida; outro código: a categoria NOT NULL recusa a linha) e literal presumido
(valor_presumido por linha); lista sem descrição (o rótulo é o código) e código de processo
não numérico (a ordem da opção é o código: recusa visível).
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

LISTAS = ("FPTPDEPENDENT", "FPTPDEPENDENTREINF", "FPTPEVENTOAUT", "FPTPFOLHAESOC", "FPTPONUS",
          "FPTPONUSREMUN", "FPTPPENSAOALI", "FPTPPROCESSO", "FPTPREGIMEPRE", "FPTPREGIMETRA",
          "FPTPREGJORNAD", "FPTPREINTEG", "FPTPRESCDIRET", "FPTP_ARQ_EMPREGADORWEB", "FPTP_EVENTO_SIND",
          "FPTPVALE")
CARREGADAS = ("FPTP_FUNC", "FPTPFERIAS", "FPTP_EVENTO", "FPTP_FOLHA", "FPTP_REFER") + LISTAS
DESCARTADAS = ()


def linhas(r, ins):
    # listas do hospital (parametro_opcao); 4.º tipo de dependente sem descrição: o rótulo é o código
    for i in range(1, 4):
        ins("FPTPDEPENDENT", ["Tipo exemplo %d" % i, "%02d" % i, datetime.date(2020, 1, i), None])
        ins("FPTPDEPENDENTREINF", ["%d" % i, "Tipo REINF exemplo %d" % i])
        ins("FPTPEVENTOAUT", [i, "Evento exemplo %d" % i])
        ins("FPTPONUS", [i, "Ônus exemplo %d" % i])
        ins("FPTPONUSREMUN", [i, "Ônus remun. %d" % i])
        ins("FPTPPENSAOALI", [i, "Pensão exemplo %d" % i])
        ins("FPTPPROCESSO", [str(i), "Processo exemplo %d" % i])
        ins("FPTPREGIMEPRE", [i, "Regime prev. %d" % i])
        ins("FPTPREGIMETRA", [i, "Regime trab. %d" % i])
        ins("FPTPREGJORNAD", [i, "Jornada exemplo %d" % i])
        ins("FPTPREINTEG", [i, "Reintegração %d" % i])
        ins("FPTPRESCDIRET", [i, "Motivo exemplo %d" % i])
        ins("FPTP_ARQ_EMPREGADORWEB", [i, "Arquivo %d" % i])
        ins("FPTP_EVENTO_SIND", [i, "Evento sindical %d" % i])
    ins("FPTPDEPENDENT", [None, "04", datetime.date(2020, 1, 4), datetime.date(2021, 12, 31)])
    ins("FPTPPROCESSO", ["X", "Processo sem código numérico"])  # sequencia NOT NULL pelo código: recusa visível
    for i in range(1, 6):  # 5 códigos, como na imagem de referência
        ins("FPTPFOLHAESOC", [i, "Apuração %d" % i])
    # tipos de férias: 1 sem descrição (NOT NULL no destino); a pendência de categoria presumida fica em toda linha lida
    for g in [(1, "Normal"), (2, "Coletiva"), (3, None), (4, "Abono  10")]:
        ins("FPTPFERIAS", list(g))
    # tipos de vale: lista do hospital (classificação do benefício)
    for g in [(1, "Vale   transporte"), (2, "  Vale refeição "), (3, "Cesta básica")]:
        ins("FPTPVALE", list(g))
    # tipos de rubrica: as 5 letras da origem (J informativa dedutora); 'p' colide com 'P' no destino (os dois
    # recusados); 'X' sem par no de-para (natureza e sinal: duas pendências; natureza NOT NULL recusa a linha)
    for g in [("P", "Provento"), ("D", "Desconto"), ("B", "Base"), ("I", "Informativo"), ("J", "Inf. dedutora"),
              ("p", "Provento minúsculo"), ("X", "Sem par")]:
        ins("FPTP_EVENTO", list(g))
    # tipos de folha (toda linha: ativo presumido = marca de revisão da categoria): 1 sem descrição (recusa); 2 (anual)
    # no 13º -> decimo_terceiro_segunda; sem indicativo -> mensal; 4 (entre 3 e 5) -> indicativo NULL com
    # valor_fora_do_dominio e categoria mensal; 9 sem par nos dois de-paras -> categoria NULL recusa a linha
    for g in [(1, "Mensal", 1), (2, "Adiantamento", 1), (3, "13o salário", 2), (4, None, 1), (5, "Férias", None),
              (6, "Extra", 9), (7, "Rescisão", 4)]:
        ins("FPTP_FOLHA", list(g))
    # tipos de colaborador: nome só com espaços vira vazio (NOT NULL no destino)
    for i in range(1, 7):
        ins("FPTP_FUNC", [i, "   " if i == 4 else "Tipo  colaborador %d" % i])
    # tipos de referência: 1 sem nome; 'h' colide com 'H' pela caixa; 'R' referência (quantidade); 'Z' sem par
    for g in [("H", "Horas"), ("D", "Dias"), ("P", None), ("V", "Valor"), ("h", "Horas minúsculo"),
              ("R", "Referência"), ("Z", "Sem par")]:
        ins("FPTP_REFER", list(g))
    esp = {t: {"gravados": 3, "pendencias": {"adotado_existente": 5}} for t in LISTAS}
    esp["FPTPDEPENDENT"] = {"gravados": 4, "pendencias": {"adotado_existente": 6}}  # 1.ª lista: cria o módulo
    esp["FPTPFOLHAESOC"] = {"gravados": 5, "pendencias": {"adotado_existente": 9}}
    esp["FPTPPROCESSO"] = {"gravados": 3, "pendencias": {"adotado_existente": 5, "valor_fora_do_dominio": 1,
                                                       "restricao_destino_1048": 1}}
    esp.update({
        "FPTP_FUNC": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1}},
        "FPTPFERIAS": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
        "FPTP_EVENTO": {"gravados": 4, "pendencias": {"codigo_colisao_caixa": 2, "valor_fora_do_dominio": 2,
                                                      "restricao_destino_1048": 1}},
        "FPTP_FOLHA": {"gravados": 5, "pendencias": {"valor_presumido": 7, "valor_fora_do_dominio": 3,
                                                     "restricao_destino_1048": 2}},
        "FPTP_REFER": {"gravados": 3, "pendencias": {"codigo_colisao_caixa": 2, "valor_fora_do_dominio": 1,
                                                     "restricao_destino_1048": 2}},
    })
    return esp
