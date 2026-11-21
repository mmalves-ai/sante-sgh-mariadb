"""Fatia L8-03 (faturamento e restantes, módulo FAT): tabelas da origem e anomalias, com dados 100% falsos.

Só as 3 tabelas carregáveis hoje pela carga dirigida pelo mapa (função da equipe na cobrança, tipo de pendência da
conta e local de cobrança); as outras 20 da fatia aguardam regra genérica do motor ou decisão (ver
docs/obra/fatias/f4/saida/L8-03.md). Os módulos do tipo de pendência aguardam a referência pelo código do catálogo do
produto (o módulo do sistema é gravado com o produto, nunca pelo conector), por isso não há pai externo de módulo. Anomalias: nome só de espaços (texto_nome vazio: 1048), tipo e
categoria e controle presumidos (valor_presumido por coluna presumida e linha lida, inclusive a recusada), descrição em BLOB de texto vazia, nula e longa demais
(1048 e 1406) e com quebra de linha preservada, acentos CP1252, espaços repetidos; S/N fora do domínio
(valor_fora_do_dominio, fica o padrão) e vazio (padrão do destino). Os valores gravados são conferidos no destino pelo
teste da fatia (test_l8_03.py, classe ValoresNoDestino).
"""

DDL = """
CREATE TABLE TBCOSPPROF (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE TBIRREGULARID (ID SMALLINT NOT NULL PRIMARY KEY, NOME BLOB SUB_TYPE 1);
CREATE TABLE TBLOCCON (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50), CODMEM INTEGER, CDC INTEGER,
  CODMAT INTEGER, CPP VARCHAR(1), REFUNI SMALLINT, DESPAC VARCHAR(1), REFGEAP SMALLINT, ATIVO CHAR(1));
"""

def _b(s):
    return None if s is None else s.encode("cp1252")


DADOS = [
    ("TBCOSPPROF", [[1, "Função exemplo um"], [2, "Função  exemplo   ação"], [3, "Anestesia exemplo"], [4, "   "]],
     {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 4}}),
    # 3 nula e 6 vazia (1048), 4 longa demais (1406): recusadas; 2 com quebra de linha preservada
    ("TBIRREGULARID", [[1, _b("Pendência exemplo de diagnóstico")], [2, _b("Pendência exemplo\r\n  de assinatura")],
                       [3, None], [4, _b("Descrição exemplo longa " * 8)], [5, _b("Guia exemplo não autorizada")],
                       [6, _b("")]],
     {"gravados": 3, "pendencias": {"restricao_destino_1048": 2, "restricao_destino_1406": 1, "valor_presumido": 12}}),
    ("TBLOCCON", [[1, "Local exemplo internação", 10, 5, 11, "S", 1, "N", 2, "S"],
                  [2, "Local  exemplo   ação", None, None, None, None, None, None, None, "N"],
                  [3, None, None, None, None, None, None, None, None, "S"],
                  [4, "Local exemplo fora", None, 7, None, "N", None, "S", None, "X"],
                  [5, "Local exemplo sem ativo", None, None, None, None, None, None, None, None]],
     {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_fora_do_dominio": 1, "valor_presumido": 5}}),
]


def linhas(r, ins):
    esperado = {}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        esperado[tab] = esp
    return esperado
