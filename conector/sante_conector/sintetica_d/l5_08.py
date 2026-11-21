"""Fatia L5-08 (cadastros e administração, módulo RH): imagem sintética com dados 100% falsos.

Carregadas pelo mapa: o motivo de afastamento do hospital (motivo_afastamento) e o histórico dos dias de afastamento
a cargo do empregador (tabela_legal_vigencia, tipo dias_afastamento_empresa). As demais tabelas da fatia são catálogo
oficial do eSocial (de-para pelo código, nunca gravado) ou domínio fixo do modelo; duas delas entram na imagem só para
provar que ficam fora da carga (nenhuma coluna declarada).
Anomalias: descrição nula e vazia (NOT NULL sem padrão), texto com quebra de linha e CP1252, data sentinela na
vigência (NOT NULL), vigência repetida no mesmo tipo (UNIQUE) e quantidade negativa (UNSIGNED).
"""
import datetime

DDL = """
CREATE TABLE FPMOTAFAST (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(140));
CREATE TABLE FPHSTDIAAFAST (NUM_DIA SMALLINT NOT NULL, DATA_VIGENCIA DATE NOT NULL, PRIMARY KEY (NUM_DIA, DATA_VIGENCIA));
CREATE TABLE FPEPC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50));
CREATE TABLE FPESOCMOTAFAS (ID VARCHAR(2) NOT NULL PRIMARY KEY, NOME BLOB SUB_TYPE 1, LANC_AUT_EVENTOS CHAR(1),
  DATA_VIGENCIA_INICIAL DATE, DATA_VIGENCIA_FINAL DATE);
"""

M, H = "FPMOTAFAST", "FPHSTDIAAFAST"


def linhas(r, ins):
    for i in range(1, 13):
        d = "Motivo exemplo %d" % i
        if i == 5:
            d = None                                   # NOT NULL sem padrão: restricao_destino_1048
        if i == 6:
            d = "  Licença exemplo\r\n segunda linha  "  # pontas aparadas, quebra interna preservada
        if i == 7:
            d = "Afastamento ação – teste"              # CP1252 (travessão 0x96)
        if i == 8:
            d = "   "                                   # vazio vira NULL: restricao_destino_1048
        ins(M, [i, d])
    for dias, vig in [(15, datetime.date(2000, 1, 1)), (15, datetime.date(2026, 1, 1)),
                      (60, datetime.date(2026, 1, 1)),      # mesma vigência no mesmo tipo: restricao_destino_1062
                      (30, datetime.date(1899, 12, 30)),    # data sentinela em coluna NOT NULL: recusa
                      (-5, datetime.date(2010, 1, 1))]:     # negativo em UNSIGNED: restricao_destino_1264
        ins(H, [dias, vig])
    for i in range(1, 5):
        ins("FPEPC", [i, "Opção oficial %d" % i])
    for i, cod in enumerate(["01", "03", "05"]):
        ins("FPESOCMOTAFAS", [cod, ("Motivo oficial %s" % cod).encode("cp1252"), "SN"[i % 2],
                              datetime.date(2014, 1, 1), None])
    return {
        M: {"gravados": 10, "pendencias": {"restricao_destino_1048": 2}},
        H: {"gravados": 2, "pendencias": {"restricao_destino_1062": 1, "restricao_destino_1048": 1,
                                          "restricao_destino_1264": 1, "data_sentinela": 1}},
    }
