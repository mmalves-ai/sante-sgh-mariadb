"""Fatia L8-16 (faturamento e restantes, módulo INTG): tabelas da origem e anomalias, com dados 100% falsos.

Só as 2 tabelas carregáveis hoje pela carga dirigida pelo mapa (perfil de prioridade da triagem externa e serviço
integrado como sistema externo); as outras 20 da fatia aguardam regra genérica do motor, pai carregável ou decisão
(ver docs/obra/fatias/f4/saida/L8-16.md). Anomalias: nome só de espaços (texto_nome vazio: 1048), espaços repetidos
colapsados, acentos CP1252, código do serviço repetido (chave única do destino: 1062), categoria presumida
(valor_presumido por linha lida, inclusive a recusada), porta interna nunca migrada.
Sem pais de fora da fatia.
"""

DDL = """
CREATE TABLE RETPPROTOLIFE (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE TBIDENTIFICACAOENDPOINT (ID SMALLINT NOT NULL PRIMARY KEY, COD SMALLINT NOT NULL,
  DESCRICAO VARCHAR(50) NOT NULL, PORTA_DOCKER_INTERNO SMALLINT);
"""

DADOS = [
    # 3 só de espaços: recusada (1048); 2 com espaços repetidos; 5 com acento
    ("RETPPROTOLIFE", [[1, "Perfil exemplo um"], [2, "Perfil  exemplo   dois"], [3, "   "],
                       [4, "Perfil exemplo quatro"], [5, "Perfil exemplo ação"]],
     {"gravados": 4, "pendencias": {"restricao_destino_1048": 1}}),
    # 3 repete o código de 1 (1062); 4 descrição só de espaços (1048); categoria presumida nas 5
    ("TBIDENTIFICACAOENDPOINT", [[1, 10, "Serviço exemplo laudos", 8080], [2, 11, "Serviço exemplo agenda", None],
                                 [3, 10, "Serviço exemplo repetido", None], [4, 12, "   ", None],
                                 [5, 13, "Serviço  exemplo   ação", 9090]],
     {"gravados": 3, "pendencias": {"restricao_destino_1062": 1, "restricao_destino_1048": 1,
                                    "valor_presumido": 5}}),
]


def linhas(r, ins):
    esperado = {}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        esperado[tab] = esp
    return esperado
