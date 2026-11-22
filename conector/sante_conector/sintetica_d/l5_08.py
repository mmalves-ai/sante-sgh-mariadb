"""Fatia L5-08 (cadastros e administração, módulo RH): imagem sintética com dados 100% falsos.

Carregadas pelo mapa: o motivo de afastamento do hospital (motivo_afastamento), o motivo oficial da tabela 18 com a
configuração do hospital (motivo_afastamento, código esocial_<código>) e o histórico dos dias de afastamento a cargo
do empregador (tabela_legal_vigencia, tipo dias_afastamento_empresa). As demais tabelas da fatia são descarte com
motivo de produto (declarado/sem_carga.tsv): catálogo oficial do eSocial ou domínio fixo do produto; algumas entram na
imagem. Rodada 5 (ADR 0006; decisão do conferidor r5-1/r5-2): as 19 listas legais e próprias entram INTEIRAS como
lista do hospital (parametro_opcao sob uma parametro_definicao rh.lista.<nome>, módulo 'migracao' adotado); valor =
código oficial da origem quando há coluna própria (sem ele, id_<chave>), sequência = chave da origem, rótulo = nome
(sem nome, o código). FPINTROTINA leva os atributos no retrato da trilha. FPESOCDESONER (3 códigos) também serve à
referência encadeada da L5-12 (FPPARAM.ID_FPESOCDESONER > COD_INDICATIVO_DESONERACAO), que a requer por REQUER.
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
CREATE TABLE FPESOCAUTORIA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40));
CREATE TABLE FPESOCCADRESEV (ID SMALLINT NOT NULL PRIMARY KEY, ID_FPESOCTPRESP SMALLINT NOT NULL,
  COD_RESPOSTA_EVENTO SMALLINT NOT NULL, NOME VARCHAR(254) NOT NULL);
CREATE TABLE FPESOCINDAVISO (ID SMALLINT NOT NULL PRIMARY KEY, COD_CUMPRIMENTO_AVISO SMALLINT, NOME VARCHAR(80));
CREATE TABLE FPESOCINDPROC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(80));
CREATE TABLE FPESOCINDSUSP (ID VARCHAR(2) NOT NULL PRIMARY KEY, NOME VARCHAR(80));
CREATE TABLE FPESOCORIRETIF (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE FPESOCPTOELET (ID SMALLINT NOT NULL PRIMARY KEY, COD_OPCAO_PONTO_ELETRONICO SMALLINT NOT NULL,
  NOME VARCHAR(80) NOT NULL);
CREATE TABLE FPESOCTPAVISO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(200));
CREATE TABLE FPESOCTPJORTRAB (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(120) NOT NULL);
CREATE TABLE FPESOCTRABTEMP (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(70));
CREATE TABLE FPEXPAGNOCIVO (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(80));
CREATE TABLE FPGRAUEXPAGNOC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(100));
CREATE TABLE FPINDICDECPRO (ID SMALLINT NOT NULL PRIMARY KEY, COD_FPINDICDECPRO SMALLINT, DESCRICAO VARCHAR(80));
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
        ins("FPEPC", [i, None if i == 2 else "Opção oficial %d" % i])
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
    # listas do hospital (parametro_opcao): anomalias = nome nulo (rótulo vira o código), nome longo (resumido em
    # 150), CP1252, código oficial nulo (valor id_<chave>), código oficial repetido (UNIQUE da lista: recusa 1062),
    # chave de texto não numérica (sequência sem inteiro: recusa 1048), chave de letra (ordem pelo de-para da letra)
    longo2 = " ".join(["palavra"] * 24)                 # 191 caracteres: resumido em 150
    for t, n in [("FPESOCAUTORIA", 2), ("FPESOCINDPROC", 3), ("FPESOCORIRETIF", 3), ("FPESOCTRABTEMP", 2),
                 ("FPGRAUEXPAGNOC", 4)]:
        for i in range(1, n + 1):
            ins(t, [i, None if i == 2 else "Item exemplo %d ação" % i])
    for i in range(1, 4):
        ins("FPINTAGRUP", [i, "Grupo exemplo %d" % i])
    ins("FPESOCTPJORTRAB", [1, "Jornada exemplo 1"])
    ins("FPESOCTPJORTRAB", [2, "Jornada exemplo 2"])
    ins("FPESOCTPAVISO", [1, longo2])
    ins("FPESOCTPAVISO", [2, "Aviso exemplo"])
    ins("FPEXPAGNOCIVO", [1, "  Exposição exemplo  "])
    ins("FPEXPAGNOCIVO", [2, None])
    for i, tp, cod in [(1, 1, 101), (2, 1, 102), (3, 2, 101)]:   # mesmo código em tipos diferentes: valores distintos
        ins("FPESOCCADRESEV", [i, tp, cod, "Resposta exemplo %d" % i])
    for i, cod in [(1, 1), (2, None), (3, 3)]:
        ins("FPESOCINDAVISO", [i, cod, "Cumprimento exemplo %d" % i])
    for i, cod in [(1, 1), (2, 2), (3, None)]:
        ins("FPINDICDECPRO", [i, cod, None if i == 2 else "Decisão exemplo %d" % i])
    for i, cod in [(1, 0), (2, 1), (3, 1)]:                     # código repetido: a 3 recusada (1062)
        ins("FPESOCPTOELET", [i, cod, "Ponto exemplo %d" % i])
    for cod in ["01", "92", "AB"]:                             # AB sem sequência inteira: recusa 1048
        ins("FPESOCINDSUSP", [cod, "Suspensão exemplo %s" % cod])
    ins("FPESOCPARAMS1210", ["A", "Opção exemplo A"])
    ins("FPESOCPARAMS1210", ["b", "Opção exemplo b"])
    ins("FPINTROTINA", [1, "Rotina exemplo", None, 1, 1, 0])
    ins("FPINTROTINA", [2, "Rotina exemplo 2", "Complemento", None, 0, 1])
    ins("FPLOTACAOTRIB", ["Lotação exemplo ação".encode("cp1252"), "01"])
    ins("FPLOTACAOTRIB", [None, "21"])
    return {
        M: {"gravados": 10, "pendencias": {"restricao_destino_1048": 2}},
        O: {"gravados": 6, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_4025": 1}},
        H: {"gravados": 2, "pendencias": {"restricao_destino_1062": 1, "restricao_destino_1048": 1,
                                          "restricao_destino_1264": 1, "data_sentinela": 1}},
        **ESPERADO_LISTAS,
    }


ESPERADO_LISTAS = {  # adotado_existente = módulo e definição da lista adotados pelas linhas seguintes
    'FPEPC': {'gravados': 4, 'pendencias': {'adotado_existente': 6}},
    'FPESOCAUTORIA': {'gravados': 2, 'pendencias': {'adotado_existente': 3}},
    'FPESOCCADRESEV': {'gravados': 3, 'pendencias': {'adotado_existente': 5}},
    'FPESOCDESONER': {'gravados': 3, 'pendencias': {'adotado_existente': 5}},
    'FPESOCINDAVISO': {'gravados': 3, 'pendencias': {'adotado_existente': 5}},
    'FPESOCINDPROC': {'gravados': 3, 'pendencias': {'adotado_existente': 5}},
    'FPESOCINDSUSP': {'gravados': 2, 'pendencias': {'adotado_existente': 3, 'restricao_destino_1048': 1, 'valor_fora_do_dominio': 1}},
    'FPESOCORIRETIF': {'gravados': 3, 'pendencias': {'adotado_existente': 5}},
    'FPESOCPARAMS1210': {'gravados': 2, 'pendencias': {'adotado_existente': 3}},
    'FPESOCPTOELET': {'gravados': 2, 'pendencias': {'adotado_existente': 3, 'restricao_destino_1062': 1}},
    'FPESOCTPAVISO': {'gravados': 2, 'pendencias': {'adotado_existente': 3, 'texto_resumido': 1}},
    'FPESOCTPJORTRAB': {'gravados': 2, 'pendencias': {'adotado_existente': 3}},
    'FPESOCTRABTEMP': {'gravados': 2, 'pendencias': {'adotado_existente': 3}},
    'FPEXPAGNOCIVO': {'gravados': 2, 'pendencias': {'adotado_existente': 3}},
    'FPGRAUEXPAGNOC': {'gravados': 4, 'pendencias': {'adotado_existente': 7}},
    'FPINDICDECPRO': {'gravados': 3, 'pendencias': {'adotado_existente': 5}},
    'FPINTAGRUP': {'gravados': 3, 'pendencias': {'adotado_existente': 5}},
    'FPINTROTINA': {'gravados': 2, 'pendencias': {'adotado_existente': 3, 'vigencia_sem_fonte': 2}},
    'FPLOTACAOTRIB': {'gravados': 2, 'pendencias': {'adotado_existente': 3}},
}
