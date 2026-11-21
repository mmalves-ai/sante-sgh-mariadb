"""Fatia L7-04 (SADT e suprimentos, módulo SADT): tabelas da origem e anomalias, com dados 100% falsos.

Só as 3 tabelas carregáveis hoje pela carga dirigida pelo mapa (grupo sanguíneo, exclusão de resultado de exame na
trilha de auditoria e versão do kit de exames); as outras 16 da fatia aguardam regra genérica do motor ou decisão (ver docs/obra/fatias/f4/saida/L7-04.md). Anomalias: sigla
fora do domínio ABO (CHECK, 4025), sigla repetida depois de aparar (1062), sigla só de espaços (1048); kit nunca visto
(pai_inexistente + 1048), nome vazio (1048), data de gravação sentinela (data_sentinela nas duas colunas que ela alimenta + 1048), fim da vigência antes
do início (CHECK, 4025), S/N fora do domínio (padrão do destino), hora sugerida com data (hora_com_data), texto com
espaços repetidos e acentos CP1252; exclusão de resultado com usuário nunca visto (pai_inexistente, NULL anulável),
sem usuário, sem data (1048) e com data sentinela (data_sentinela + 1048).
Pais de fora da fatia (já carregados): SIKITEXA (L7) e TBUSERS (L3).
"""
import datetime as _dt

DDL = """
CREATE TABLE TBTPSANGUINEO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(2) NOT NULL);
CREATE TABLE SIRES01_DELETE (ID DOUBLE PRECISION NOT NULL PRIMARY KEY, ID_SIRES01 DOUBLE PRECISION NOT NULL,
  USUARIO VARCHAR(31), DATA_HORA_EVENTO TIMESTAMP, DATA_HORA_GRAVACAO TIMESTAMP);
CREATE TABLE SIKITHISTEXA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30), GERARBATERIAEXAME CHAR(1),
  HORA_SUGERIDA_COLETA_PEP TIMESTAMP, DATA_HORA_GRAVACAO TIMESTAMP, DATA_HORA_FIM TIMESTAMP, ID_SIKITEXA SMALLINT);
"""

# kits de exame inventados, já carregados por outra fatia do L7 (ordem 492)
# e usuários inventados, já carregados pelo L3
PAIS_EXTERNOS = {"SIKITEXA": ["1", "2"], "TBUSERS": ["USR_L704_A", "USR_L704_B"]}


def _t(*a):
    return _dt.datetime(*a)


H = _t(1899, 12, 30, 7, 30)
DADOS = [
    ("TBTPSANGUINEO", [[1, "A"], [2, "B"], [3, "AB"], [4, "O"], [5, "X"], [6, "O "], [7, "  "]],
     {"gravados": 4, "pendencias": {"restricao_destino_4025": 1, "restricao_destino_1062": 1,
                                    "restricao_destino_1048": 1}}),
    ("SIRES01_DELETE", [
        [1.0, 501.0, "USR_L704_A", _t(2025, 3, 4, 10, 20), _t(2025, 3, 4, 10, 21)],
        [2.0, 502.0, "USR_L704_B", _t(2025, 4, 5, 8, 0), None],
        [3.0, 503.0, "USR_L704_NAO_EXISTE", _t(2025, 5, 6, 9, 30), None],        # pai_inexistente (NULL anulável)
        [4.0, 504.0, None, _t(2025, 6, 7, 11, 0), None],                          # sem usuário: NULL, sem pendência
        [5.0, 505.0, "USR_L704_A", None, _t(2025, 7, 1, 9, 0)],                   # sem data do evento: 1048
        [6.0, 506.0, "USR_L704_B", _t(1899, 12, 30, 0, 0), None]],                # data sentinela + 1048
     {"gravados": 4, "pendencias": {"pai_inexistente": 1, "data_sentinela": 1, "restricao_destino_1048": 2}}),
    # kit 1: versões 1, 2, 6, 8, 9 (número da versão 1..5 na ordem da chave); kit 2: 3, 4, 7; kit 9 nunca visto
    ("SIKITHISTEXA", [
        [1, "Kit exemplo pré-operatório", "S", H, _t(2026, 1, 5, 10, 0), _t(2026, 2, 1, 8, 0), 1],
        [2, "Kit exemplo pré-operatório", "S", H, _t(2026, 2, 1, 8, 0), None, 1],
        [3, "Kit  exemplo   rotina", "N", None, _t(2026, 1, 10, 9, 0), None, 2],
        [4, "Kit exemplo rotina ação", "X", _t(1899, 12, 30, 6, 0), _t(2026, 3, 1, 9, 0), None, 2],
        [5, "Kit de kit inexistente", "S", None, _t(2026, 1, 11, 9, 0), None, 9],
        [6, None, "S", None, _t(2026, 2, 2, 9, 0), None, 1],
        [7, "Kit gravação sentinela", "N", None, _t(1899, 12, 30, 0, 0), None, 2],
        [8, "Kit vigência invertida", "S", None, _t(2026, 2, 3, 9, 0), _t(2026, 1, 3, 9, 0), 1],
        [9, "Kit hora com data", "N", _t(2026, 3, 1, 6, 45), _t(2026, 2, 4, 9, 0), None, 1]],
     {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 1, "pai_inexistente": 1, "restricao_destino_1048": 3,
                                    "data_sentinela": 2, "restricao_destino_4025": 1, "hora_com_data": 1}}),
]


def linhas(r, ins):
    esperado = {}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        esperado[tab] = esp
    return esperado
