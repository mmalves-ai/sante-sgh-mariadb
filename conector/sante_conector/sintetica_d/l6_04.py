"""Fatia L6-04 (agenda: situações da marcação de exame, agenda de exames, vínculos da agenda, grade gerada e as cópias
das marcações de consulta canceladas e excluídas): situações da marcação de exame, agenda de exames, fontes pagadoras
aceitas por agenda (consultas e exames), especialidades por agenda, pedidos de geração da grade da agenda de exames e
os cancelamentos e exclusões de marcação de consulta em registro_excluido.

Descartes com motivo de produto (`declarado/sem_carga.tsv`): estado de confirmação de ALERGIA (domínio fixo do
produto), agenda e cadeira padrão "não informado", indisponibilidade fictícia e parâmetros da agenda de cadeiras.
Declaração pronta e comentada até a regra pedida ao motor (fim do horário = início + duração; L6-04.json, pedido 1):
horários da agenda de exames (SIPACAGI) e marcações de exame e de consulta (SIPACAGD, REPACAGD).

Dados 100% falsos. Anomalias: situação (descrição nula, espaços repetidos, CP1252, S/N inválido e vazio, código igual
ao da agenda de consultas já gravado, código sem par no de-para); agenda de exames: profissional pelo número do
conselho (encontrado, inexistente, repetido em duas inscrições: pai_ambiguo), CRM 0 sem dono (restrição de dono do
destino), duração '0000' (NOT NULL), duração acima de 480 minutos (restrição), nome repetido (1062), login e S/N
desconhecidos (linha entra), categoria pelo cadastro do destino com natureza 'exame'; vínculos: par repetido (1062),
pai inexistente, zero e recusado (pai_pendente); grade: agenda pela chave alternativa composta (encontrada, recusada,
inexistente), reversão 'E' (restrição do destino), período invertido, hora HHMM inválida, situação vazia e sem par
(concluída, nunca pendente), login desconhecido; cancelamento: motivo vazio (texto fixo concorrente), login
desconhecido e vazio, data sentinela e hora inválida (NOT NULL), entidade própria do cancelamento (o protocolo não é
o id da marcação); exclusão: instante vazio e sentinela, usuário vazio, justificativa e autor presumidos
(valor_presumido por linha) e retrato completo da linha.
Pais de fora da fatia (já carregados): REAGENDA e RETP_INTEG_AGENDA_ONLINE (L6-03), TBCONVEN, TBESPEC, TBUNIDAD e
TBPROFIS (L5), TBUSERS e RICADPAC (L3). TBCBOPRO (L5) entra na imagem só com as colunas lidas pela referência
encadeada; por isso a conferência usa o mapa real só com as declarações DESTA fatia (`MAPA_TESTE`), para não carregar
o pai de outra fatia com a forma parcial.
"""
import datetime as _dt

FATIA = ("SIPACAGI", "TBESTADOCONFIRMACAO", "TBSITAGE", "AGPARAM", "SIAGENDA", "SIAGECRI", "REAGENDA_TBCONVEN",
         "SIAGENDA_TBCONVEN", "AGCADAGENDA", "AGCADEIRA", "AGDIASINDISP", "REAGENDA_TBESPEC", "REPACAGD", "RECANAGE",
         "REPACAGD_EXCLUSAO", "SIPACAGD")

DDL = """
CREATE TABLE TBSITAGE (COD VARCHAR(2) NOT NULL PRIMARY KEY, NOME VARCHAR(40), EXTENSAO VARCHAR(5),
  ICONE BLOB SUB_TYPE 0, INT_AGENDA_ONLINE CHAR(1));
CREATE TABLE REAGENDA_TBCONVEN (ID INTEGER NOT NULL PRIMARY KEY, ID_REAGENDA INTEGER NOT NULL,
  ID_TBCONVEN SMALLINT NOT NULL, OBS_AGEND_ONLINE BLOB SUB_TYPE 1);
CREATE TABLE REAGENDA_TBESPEC (ID INTEGER NOT NULL PRIMARY KEY, ID_REAGENDA INTEGER NOT NULL,
  ID_TBESPEC INTEGER NOT NULL);
CREATE TABLE TBCBOPRO (ID INTEGER NOT NULL PRIMARY KEY, COD INTEGER NOT NULL, ID_TBPROFIS INTEGER NOT NULL);
CREATE TABLE SIAGENDA (ID INTEGER NOT NULL PRIMARY KEY, CRM INTEGER NOT NULL, NOME VARCHAR(40) NOT NULL,
  EXAME VARCHAR(1) NOT NULL, DURACAO VARCHAR(4), QTDE_RET SMALLINT, ATIVA VARCHAR(1), HR_CRIACAO VARCHAR(4),
  QTDE_D_RET SMALLINT, USUARIO VARCHAR(31), PERINI DATE, PERFIN DATE, DT_CRIACAO DATE, FX_FIN SMALLINT,
  FX_INC SMALLINT, UNID INTEGER, OBSERVACAO BLOB SUB_TYPE 1, ID_TBTABATO SMALLINT NOT NULL,
  ID_RETP_INTEG_AGENDA_ONLINE SMALLINT NOT NULL, OBS_PORTAL_PAC_AGEND_ONLINE BLOB SUB_TYPE 1);
CREATE TABLE SIAGENDA_TBCONVEN (ID INTEGER NOT NULL PRIMARY KEY, ID_SIAGENDA INTEGER NOT NULL,
  ID_TBCONVEN SMALLINT NOT NULL, OBS_AGEND_ONLINE BLOB SUB_TYPE 1);
CREATE TABLE SIAGECRI (NOME VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL, PERINI DATE NOT NULL, PERFIN DATE NOT NULL,
  DT_CRIACAO DATE NOT NULL, HR_CRIACAO VARCHAR(4) NOT NULL, EXAME CHAR(1) NOT NULL, DURACAO VARCHAR(4),
  STATUS VARCHAR(1), SEM1 VARCHAR(1), SEM2 VARCHAR(1), SEM3 VARCHAR(1), SEM4 VARCHAR(1), SEM5 VARCHAR(1),
  SEM6 VARCHAR(1), SEM7 VARCHAR(1), USUARIO VARCHAR(31),
  PRIMARY KEY (NOME, CRM, PERINI, PERFIN, DT_CRIACAO, HR_CRIACAO, EXAME));
CREATE TABLE RECANAGE (NOME VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL, DATA DATE NOT NULL, HORA VARCHAR(4) NOT NULL,
  PACIENTE VARCHAR(70), FONE VARCHAR(15), CONV SMALLINT, USU_AGE VARCHAR(31), DT_CAN DATE NOT NULL,
  HR_CAN VARCHAR(4) NOT NULL, USU_CAN VARCHAR(31), MOTIVO VARCHAR(300), PROTOCOLO INTEGER NOT NULL,
  ID_TBMOTCANCCAD INTEGER, PRIMARY KEY (NOME, CRM, DATA, HORA, DT_CAN, HR_CAN));
CREATE TABLE REPACAGD_EXCLUSAO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL,
  DATA DATE NOT NULL, HORA VARCHAR(5) NOT NULL, PACIENTE VARCHAR(70), USUARIO VARCHAR(31), ID_REPACAGD INTEGER NOT NULL,
  DATA_HORA_AGENDAMENTO TIMESTAMP NOT NULL, ID_TBUSERS_INCLUSAO VARCHAR(31) NOT NULL, DATA_HORA_EXCLUSAO TIMESTAMP,
  ID_RICADPAC INTEGER);
"""
PAIS_EXTERNOS = {"REAGENDA": ["1", "2", "3"], "TBCONVEN": ["1", "2", "3"], "TBESPEC": ["1", "2", "3"],
                 "TBUSERS": ["ana", "bia"], "RICADPAC": ["7"], "TBPROFIS": ["9001"], "TBUNIDAD": ["3"],
                 "RETP_INTEG_AGENDA_ONLINE": ["1"]}
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo, a situação da
# agenda de CONSULTAS (outra fatia) já gravada com o código cru 'C' e o cadastro de categorias de agenda do cliente
# (uma de natureza 'exame', uma de 'consulta') vêm daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');"
                   " INSERT INTO situacao_marcacao (codigo, descricao, significado, criado_em)"
                   " VALUES ('C', 'Consulta exemplo', 'cancelada', NOW(3));"
                   " CREATE TABLE IF NOT EXISTS categoria_agenda (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(30) NOT NULL, natureza VARCHAR(30) NOT NULL);"
                   " INSERT INTO categoria_agenda (codigo, natureza) VALUES ('exames', 'exame'), ('consultas', 'consulta')")


def __getattr__(nome):
    """`MAPA_TESTE` (lido pela conferência): o mapa real só com as declarações desta fatia. A imagem traz TBCBOPRO
    (L5) só com as colunas da referência encadeada; com as declarações dela, a conferência tentaria carregá-la."""
    if nome != "MAPA_TESTE":
        raise AttributeError(nome)
    from .. import mapa
    m = mapa.carregar_execucao()
    m["colunas_decl"] = [c for c in m["colunas_decl"] if c["tabela"] in FATIA]
    return m


SIT, CONV, ESP = "TBSITAGE", "REAGENDA_TBCONVEN", "REAGENDA_TBESPEC"
AGE, SICONV, GRADE, CAN, EXC = "SIAGENDA", "SIAGENDA_TBCONVEN", "SIAGECRI", "RECANAGE", "REPACAGD_EXCLUSAO"
D, TS = _dt.date, _dt.datetime


def _agenda(ins, id_, crm, nome, exame, dur, ativa=None, qret=None, usu=None, unid=None, obs=None, portal=None):
    ins(AGE, [id_, crm, nome, exame, dur, None, ativa, None, qret, usu, None, None, None, None, None, unid, obs, 1, 1,
              portal])


def _grade(ins, nome, crm, ini, fim, dt, hr, exame, dur, status, usu, sem=("S", None, "S", None, "S", None, None)):
    ins(GRADE, [nome, crm, ini, fim, dt, hr, exame, dur, status] + list(sem) + [usu])


def linhas(r, ins):
    icone = bytes(r.getrandbits(8) for _ in range(64))
    for v in [("A", "Chegou exemplo", None, None, "S"),             # significado chegou
              ("C", "Confirmada exemplo", "bmp", icone, "S"),      # 'C' da consulta já gravado: exame_C não colide
              ("S", "Realizada exemplo", None, None, None),        # vazio: padrão do destino (FALSE)
              ("X", None, None, None, "N"),                        # NOT NULL: restricao_destino_1048
              ("F", "  Falta   exemplo ", None, None, "Z"),        # S/N inválido: valor_fora_do_dominio
              ("HR", "Reservado ação €", None, None, "N"),          # bloqueada
              ("K", "Sem par no de-para", None, None, "N")]:       # sem significado: valor_fora_do_dominio + 1048
        ins(SIT, list(v))
    obs = lambda i: ("Aviso %d ao paciente\r\n  segunda linha  " % i).encode("cp1252")  # noqa: E731
    for v in [(1, 1, 1, obs(1)), (2, 1, 2, None), (3, 2, 1, obs(3)),
              (4, 2, 1, None),                    # par repetido: restricao_destino_1062
              (5, 3, 99, None),                   # fonte inexistente em NOT NULL: recusa pela restrição
              (6, 77, 1, None),                   # agenda inexistente em NOT NULL: recusa pela restrição
              (7, 3, 0, None),                    # zero = sem pai: NULL em NOT NULL, recusa pela restrição
              (8, 3, 3, "Aviso €“” ação".encode("cp1252"))]:
        ins(CONV, list(v))
    for v in [(1, 1, 1), (2, 1, 2), (3, 2, 3),
              (4, 2, 3),                          # par repetido: restricao_destino_1062
              (5, 3, 50),                         # especialidade inexistente em NOT NULL
              (6, 3, 1)]:
        ins(ESP, list(v))
    # inscrições do profissional (L5, só as colunas da referência encadeada): 111 -> profissional carregado;
    # 222 -> profissional nunca visto; 333 em duas inscrições (pai_ambiguo)
    for v in [(501, 111, 9001), (502, 222, 9002), (503, 333, 9001), (504, 333, 9001), (505, 444, 9001)]:
        ins("TBCBOPRO", list(v))
    _agenda(ins, 1, 111, "Endoscopia exemplo", "E", "0030", "S", 15, "ana", 3,
            "Observação €\r\n  interna  ".encode("cp1252"), "Jejum de 8 horas\r\n".encode("cp1252"))
    _agenda(ins, 2, 111, "Ultrassom exemplo", "U", "0015", "N", 0, "bia", 0)       # 0: sem prazo e sem unidade
    _agenda(ins, 3, 0, "Raio X exemplo", "R", "0010", "S")                         # sem dono: restrição de dono
    _agenda(ins, 4, 111, "Agenda sem duracao", "E", "0000")                        # duração NULL: 1048
    _agenda(ins, 5, 444, "Endoscopia exemplo", "O", "0030")                        # nome repetido: 1062
    # (outro CRM: NOME+CRM é a identidade da agenda na origem, e a grade pela chave composta segue sem ambiguidade)
    _agenda(ins, 6, 222, "Cardio exemplo", "C", "0020")                            # pai_inexistente, sem dono
    _agenda(ins, 7, 333, "Doppler exemplo", "D", "0020")                           # pai_ambiguo, sem dono
    _agenda(ins, 8, 111, "Usuario desconhecido exemplo", "E", "0020", "Z", None, "zeca")  # entra sem autor
    _agenda(ins, 9, 111, "Duracao longa exemplo", "E", "0900")                     # 540 min: restrição
    # pares escolhidos para não coincidir, no banco descartável, com os ids dos pais EXTERNOS da agenda de consultas
    # (REAGENDA e SIAGENDA dividem agenda_fonte_pagadora; na carga real os ids nunca coincidem)
    for v in [(1, 1, 3, obs(11)), (2, 2, 2, None),
              (3, 1, 3, None),                    # par repetido: restricao_destino_1062
              (4, 99, 2, None),                   # agenda nunca vista em NOT NULL: recusa pela restrição
              (5, 2, 3, "Aviso €“” exame".encode("cp1252")),
              (6, 3, 2, None)]:                   # agenda recusada: pai_pendente
        ins(SICONV, list(v))
    e, u = "Endoscopia exemplo", "Ultrassom exemplo"
    _grade(ins, e, 111, D(2026, 3, 1), D(2026, 3, 31), D(2026, 2, 20), "1015", "E", "0030", "C", "ana")
    _grade(ins, u, 111, D(2026, 3, 1), D(2026, 3, 15), D(2026, 2, 21), "0900", "U", None, None, "bia")  # concluída
    _grade(ins, e, 111, D(2026, 3, 1), D(2026, 3, 31), D(2026, 2, 25), "1100", "E", "0030", "E", "ana")  # reversão
    _grade(ins, e, 111, D(2026, 4, 10), D(2026, 4, 1), D(2026, 3, 20), "0800", "E", "0030", "C", "ana")  # invertido
    _grade(ins, "Raio X exemplo", 0, D(2026, 3, 1), D(2026, 3, 31), D(2026, 2, 20), "1015", "R", None, "C",
           "ana")                                                                  # agenda recusada: pai_pendente
    _grade(ins, "Agenda inexistente", 111, D(2026, 3, 1), D(2026, 3, 31), D(2026, 2, 20), "1015", "E", None, "C",
           "ana")                                                                  # pai_inexistente: 1048
    _grade(ins, e, 111, D(2026, 5, 1), D(2026, 5, 31), D(2026, 4, 20), "2575", "E", "0030", "C", "ana")  # hora
    _grade(ins, u, 111, D(2026, 6, 1), D(2026, 6, 30), D(2026, 5, 20), "0930", "U", "0015", "Q", "ana")  # sem par
    _grade(ins, u, 111, D(2026, 7, 1), D(2026, 7, 31), D(2026, 6, 20), "0930", "U", "0015", "C", "zeca")  # login
    c = "Agenda consulta exemplo"
    for v in [(c, 101, D(2026, 3, 2), "0800", "Paciente Ficticio Um", "0000-0000", 1, "bia", D(2026, 3, 1), "1015",
               "ana", "Paciente desistiu", 9001, None),
              (c, 101, D(2026, 3, 2), "0830", "Paciente Ficticio Dois", None, 2, "ana", D(2026, 3, 1), "1100",
               "bia", None, 9002, None),                                       # sem motivo: texto fixo concorrente
              (c, 101, D(2026, 3, 2), "0900", None, None, None, None, D(2026, 3, 1), "1200", "zeca", "Remarcou",
               9003, None),                                                    # login desconhecido: 1048
              (c, 101, D(2026, 3, 2), "0930", None, None, None, None, D(2026, 3, 1), "1300", None, None, 9004,
               None),                                                          # sem usuário: 1048
              (c, 101, D(2026, 3, 3), "0800", None, None, None, None, D(1899, 12, 30), "0000", "ana", None, 9005,
               None),                                                          # data sentinela: 1048
              (c, 101, D(2026, 3, 3), "0830", None, None, None, None, D(2026, 3, 2), "2575", "ana", None, 9006,
               None),                                                          # hora inválida: 1048
              (c, 101, D(2026, 3, 3), "0900", "Paciente Ficticio Tres", None, 3, "ana", D(2026, 3, 2), "0900", "bia",
               "  Sem   motivo €", 9007, 4)]:
        ins(CAN, list(v))
    for v in [(1, "Agenda consulta exemplo", 101, D(2026, 1, 12), "08:00", "Paciente Ficticio Quatro", "ana", 501,
               TS(2026, 1, 5, 9, 0), "ana", TS(2026, 1, 10, 14, 30), 7),
              (2, "Agenda consulta exemplo", 101, D(2026, 1, 12), "08:30", None, None, 502,
               TS(2026, 1, 5, 9, 5), "bia", None, None),               # sem instante nem usuário: NOT NULL recusa
              (3, "Agenda consulta exemplo", 101, D(2026, 1, 12), "09:00", None, None, 503,
               TS(2026, 1, 5, 9, 10), "bia", TS(1899, 12, 30, 0, 0), None)]:  # sentinela: data_sentinela e recusa
        ins(EXC, list(v))
    return _esperado()


def _esperado():
    return {
        SIT: {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 2, "restricao_destino_1048": 2}},
        CONV: {"gravados": 4, "pendencias": {"restricao_destino_1062": 1, "pai_inexistente": 2,
                                             "restricao_destino_1048": 3}},
        ESP: {"gravados": 4, "pendencias": {"valor_presumido": 6, "restricao_destino_1062": 1, "pai_inexistente": 1,
                                            "restricao_destino_1048": 1}},
        AGE: {"gravados": 3, "pendencias": {"restricao_destino_4025": 4, "restricao_destino_1048": 1,
                                            "restricao_destino_1062": 1, "pai_inexistente": 2, "pai_ambiguo": 1,
                                            "valor_fora_do_dominio": 1}},
        SICONV: {"gravados": 3, "pendencias": {"restricao_destino_1062": 1, "pai_inexistente": 1,
                                               "restricao_destino_1048": 1, "pai_pendente": 1}},
        GRADE: {"gravados": 3, "pendencias": {"restricao_destino_4025": 2, "pai_pendente": 1, "pai_inexistente": 2,
                                              "restricao_destino_1048": 3, "hora_invalida": 1,
                                              "valor_fora_do_dominio": 1}},
        CAN: {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 4, "data_sentinela": 1,
                                            "hora_invalida": 1}},
        EXC: {"gravados": 1, "pendencias": {"valor_presumido": 3, "data_sentinela": 1, "restricao_destino_1048": 2}},
    }


# linhas lidas que a carga RECUSA sem pendência de restrição do destino (o teste da imagem confere a soma)
RECUSAS_SEM_RESTRICAO = {SICONV: 1, GRADE: 1}
