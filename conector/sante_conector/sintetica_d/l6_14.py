"""Fatia L6-14 (prontuário, assinatura e assistência, módulo INT): tabelas da origem com coluna declarada e anomalias.

Dados 100% falsos (nomes e códigos inventados). Carregadas (CARREGADAS) e anomalias cobertas:
- RETPLEITO: nome com espaços repetidos (texto_nome colapsa), nome nulo e nome só de espaços (descrição NOT NULL:
  restricao_destino_1048); categoria presumida 'outro' (valor_presumido por linha);
- RIBLOCOS: nome nulo (1048); andares e ordem negativos (ANDARES e ORDEM não declarados até a regra
  inteiro_nao_negativo, pedido 12: o bloco grava e não derruba leitos em cascata); código que só difere pela caixa de
  outro ('a' e 'A' são blocos distintos na origem; a chave única composta do destino não distingue caixa: hoje
  restricao_destino_1062; com o pedido 8, codigo_colisao_caixa nos dois e nenhum vence pela ordem de leitura);
- RISITREGLEITO: nome nulo (1048), código da central nulo (aceito), estado presumido 'solicitado' com a linha
  inativa (o NIR não a usa) até o de-para de valores (valor_presumido conta toda linha lida, inclusive a recusada);
- TBALTARN: nome só de espaços (vira NULL: 1048), nome com acento, óbito presumido FALSE com a linha inativa.
Não carregadas (NAO_CARREGADAS: na imagem, sem coluna declarada; dependem dos pedidos do L6-14.json): RITITFIC (chave
COD,GRAFICA com o mesmo COD em duas linhas: código composto), RITRFCON (internação, carregada depois na ordem) e
RIEXCINT (retrato JSON, internação e motivo fora do mapa).
"""
import datetime

DDL = """
CREATE TABLE RETPLEITO (ID SMALLINT NOT NULL PRIMARY KEY, COD_TP_LEITO SMALLINT NOT NULL, NOME VARCHAR(30));
CREATE TABLE RIBLOCOS (BLOCO VARCHAR(5) NOT NULL PRIMARY KEY, NOME VARCHAR(40), ANDARES SMALLINT, IDAMIN SMALLINT,
  IDAMAX SMALLINT, UNID SMALLINT, ORDEM SMALLINT);
CREATE TABLE RISITREGLEITO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40), CODIGO INTEGER);
CREATE TABLE RITITFIC (COD SMALLINT NOT NULL, NOME VARCHAR(30), GRAFICA VARCHAR(1) NOT NULL, FICINT VARCHAR(1),
  PRIMARY KEY (COD, GRAFICA));
CREATE TABLE RITRFCON (REG INTEGER NOT NULL, "DATA" DATE, HORA VARCHAR(4), CONVO INTEGER, CONVD INTEGER,
  USUARIO VARCHAR(31));
CREATE TABLE RIEXCINT (REG INTEGER NOT NULL, ENTRADA DATE, PRONT INTEGER, NOME VARCHAR(70), DTCANCEL DATE,
  JUSTIF VARCHAR(80), USUARIO VARCHAR(31), MEDSOL VARCHAR(70), ID_TBMOTCANCCAD INTEGER);
CREATE TABLE TBALTARN (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
"""
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')")
CARREGADAS = ("RETPLEITO", "RIBLOCOS", "RISITREGLEITO", "TBALTARN")
NAO_CARREGADAS = ("RITITFIC", "RITRFCON", "RIEXCINT")


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
    # não carregadas: o mesmo COD com GRAFICA diferente (código composto), troca de convênio e internação excluída
    for x in [(1, "Guia", "S", "S"), (1, "Guia", "N", "N"), (2, "Termo", "S", None)]:
        ins("RITITFIC", list(x))
    d = datetime.date(2025, 3, 1)
    for i in range(1, 4):
        ins("RITRFCON", [900 + i, d + datetime.timedelta(days=r.randint(0, 30)), "%02d30" % (8 + i), 1, 2, "ana"])
    ins("RIEXCINT", [950, d, 7001, "Paciente Exemplo", d + datetime.timedelta(days=1), "Cadastro em duplicidade",
                     "ana", "Médico Exemplo", 1])
    return {
        "RETPLEITO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 2, "valor_presumido": 5}},
        "RIBLOCOS": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1062": 1}},
        "RISITREGLEITO": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        "TBALTARN": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
    }
