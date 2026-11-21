"""Fatia L8-01 (faturamento e restantes, módulo FAT). Carregadas 2 de 23 tabelas: grupos de motivo de glosa e tipos
de dedução do IRRF do autônomo. As outras 21 ficam fora até os pedidos em docs/obra/fatias/f4/saida/L8-01.json
(competência em duas colunas, referência em cadeia ao profissional, data somada a dias, desdobrar colunas em linhas,
referência ao item faturável e destinos NOT NULL sem fonte).

Dados 100% falsos. Anomalias: nome nulo e só de espaços (NOT NULL no destino), espaços internos colapsados no nome,
bytes CP1252 e literal presumido da natureza da dedução (valor_presumido em toda linha avaliada).
"""

DDL = """
CREATE TABLE FCTPMOTGLOSA (ID SMALLINT NOT NULL PRIMARY KEY, COD_TP_MOTIVO_GLOSA SMALLINT NOT NULL, NOME VARCHAR(45));
CREATE TABLE RPDEDUTIVEL (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(80));
"""
PAIS_EXTERNOS = {}


def linhas(r, ins):
    for v in [(1, 10, "Elegibilidade exemplo"), (2, 20, "  Guia   exemplo  "),   # espaços colapsados
              (3, 30, None),                                                    # NOT NULL: 1048
              (4, 40, "Cobrança ação € exemplo"),                               # bytes CP1252
              (5, 50, "   ")]:                                                  # só espaços: 1048
        ins("FCTPMOTGLOSA", list(v))
    for v in [(1, "Previdência oficial exemplo"), (2, "Pensão   alimentícia exemplo"),
              (3, None),                                                        # NOT NULL: 1048
              (7, "Dependente “exemplo”")]:
        ins("RPDEDUTIVEL", list(v))
    return {
        "FCTPMOTGLOSA": {"gravados": 3, "pendencias": {"restricao_destino_1048": 2}},
        "RPDEDUTIVEL": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
    }
