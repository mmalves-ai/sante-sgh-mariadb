"""Fatia L5-08 (cadastros e administração, módulo RH): imagem sintética com dados 100% falsos.

Carregadas pelo mapa: o motivo de afastamento do hospital (motivo_afastamento), o motivo oficial da tabela 18 com a
configuração do hospital (motivo_afastamento, código esocial_<código>) e o histórico dos dias de afastamento a cargo
do empregador (tabela_legal_vigencia, tipo dias_afastamento_empresa). As demais tabelas da fatia são descarte com
motivo de produto (declarado/sem_carga.tsv): catálogo oficial do eSocial ou domínio fixo do produto; algumas entram na
imagem só para provar que ficam fora da carga. FPESOCDESONER (indicativo de desoneração, 3 códigos) entra na imagem para
a referência encadeada da L5-12 (FPPARAM.ID_FPESOCDESONER > COD_INDICATIVO_DESONERACAO), que a requer por REQUER.
O motivo oficial NÃO copia o texto oficial da origem (regra 7): a descrição é o rótulo provisório pelo código.
Anomalias: descrição nula e vazia (NOT NULL sem padrão), texto com quebra de linha e CP1252, data sentinela na
vigência (NOT NULL), vigência repetida no mesmo tipo (UNIQUE), quantidade negativa (UNSIGNED); no motivo oficial,
lançamento automático fora de S/N e fim de vigência antes do início (CHECK); descrição nula ou longa na origem não
importa (não é lida).
"""
import datetime

DDL = """
CREATE TABLE FPMOTAFAST (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(140));
CREATE TABLE FPHSTDIAAFAST (NUM_DIA SMALLINT NOT NULL, DATA_VIGENCIA DATE NOT NULL, PRIMARY KEY (NUM_DIA, DATA_VIGENCIA));
CREATE TABLE FPEPC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50));
CREATE TABLE FPESOCMOTAFAS (ID VARCHAR(2) NOT NULL PRIMARY KEY, NOME BLOB SUB_TYPE 1, LANC_AUT_EVENTOS CHAR(1),
  DATA_VIGENCIA_INICIAL DATE, DATA_VIGENCIA_FINAL DATE);
CREATE TABLE FPESOCDESONER (ID SMALLINT NOT NULL PRIMARY KEY, COD_INDICATIVO_DESONERACAO SMALLINT NOT NULL,
  NOME VARCHAR(80) NOT NULL);
CREATE TABLE FPESOCPARAMS1210 (ID CHAR(1) NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(80) NOT NULL);
CREATE TABLE FPINTAGRUP (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE FPINTROTINA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, COMPLEMENTO VARCHAR(45),
  ID_FPINTAGRUP SMALLINT, PERMITE_INTEGRAR_FINANCEIRO SMALLINT NOT NULL, PERMITE_INTEGRAR_CONTABILIDADE SMALLINT NOT NULL);
CREATE TABLE FPLOTACAOTRIB (NOME BLOB SUB_TYPE 1, ID VARCHAR(2) NOT NULL PRIMARY KEY);
"""

M, H, O = "FPMOTAFAST", "FPHSTDIAAFAST", "FPESOCMOTAFAS"


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
    d0, longo = datetime.date(2014, 1, 1), " ".join(["palavra"] * 30)  # 239 caracteres: resumido em 150
    for cod, nome, lanc, ini, fim in [
            ("01", "Motivo oficial 01", "S", d0, None),
            ("03", "Motivo oficial 03", "N", d0, None),
            ("05", "Motivo oficial 05", None, d0, None),                      # nulo: padrão FALSE
            ("06", "Motivo oficial ação\r\nsegunda linha", "X", d0, None),  # fora de S/N; CP1252 e quebra
            ("07", None, "S", d0, None),                                      # nome nulo: não é lido
            ("08", longo, "S", d0, datetime.date(2020, 12, 31)),             # vencido: segue ativo (vigência)
            ("09", "Motivo oficial 09", "N", datetime.date(2020, 1, 1), datetime.date(2019, 1, 1))]:  # CHECK
        ins(O, [cod, None if nome is None else nome.encode("cp1252"), lanc, ini, fim])
    for i, cod in enumerate([0, 1, 2], 1):
        ins("FPESOCDESONER", [i, cod, "Indicativo exemplo %d" % cod])
    ins("FPESOCPARAMS1210", ["A", "Opção exemplo A"])
    ins("FPINTAGRUP", [1, "Grupo exemplo"])
    ins("FPINTROTINA", [1, "Rotina exemplo", None, 1, 1, 0])
    ins("FPLOTACAOTRIB", ["Lotação exemplo".encode("cp1252"), "01"])
    return {
        M: {"gravados": 10, "pendencias": {"restricao_destino_1048": 2}},
        O: {"gravados": 6, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_4025": 1}},
        H: {"gravados": 2, "pendencias": {"restricao_destino_1062": 1, "restricao_destino_1048": 1,
                                          "restricao_destino_1264": 1, "data_sentinela": 1}},
    }
