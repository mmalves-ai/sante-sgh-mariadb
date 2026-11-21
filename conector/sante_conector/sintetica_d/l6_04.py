"""Fatia L6-04 (agenda: situações da marcação, vínculos da agenda, escala e trilha das marcações canceladas e
excluídas): situações da marcação, fontes pagadoras aceitas por agenda (consultas e exames), especialidades por agenda,
escala semanal da agenda de exames e os eventos de cancelamento e de exclusão de marcação na trilha de auditoria.

Descartes com motivo de produto (`declarado/sem_carga.tsv`): estado de confirmação de ALERGIA (domínio fixo do
produto), agenda e cadeira padrão "não informado", indisponibilidade fictícia e parâmetros da agenda de cadeiras.
Bloqueadas até regra nova do motor (pedidos em docs/obra/fatias/f4/saida/L6-04.json): a agenda de exames, a grade
de horários de exames e as marcações de consulta e de exame.

Dados 100% falsos. Anomalias: descrição nula (NOT NULL no destino), nome com espaços repetidos (colapsados), bytes
CP1252 0x80-0x9F, S/N inválido e vazio (padrão do destino), código igual ao de uma situação da agenda de CONSULTAS já
gravada (PREPARO_DESTINO: o prefixo 'exame_' separa os domínios), significado pelo de-para de valores por código e
código sem par (valor_fora_do_dominio e recusa pelo NOT NULL), aceita na marcação online com o padrão do destino
(TRUE, sem declaração), especialidade principal presumida FALSE (valor_presumido em toda linha), par agenda/fonte e
agenda/especialidade
repetido (chave única do destino), pai inexistente e pai zero em coluna NOT NULL (recusa pela restrição), BLOB de
texto com quebras e espaços preservados, ícone binário não lido; escala: agenda pelo nome repetido (pai_ambiguo),
agenda não carregada, dia da semana fora de 1..7, hora HHMM inválida e fim antes do início (restrição do destino),
vigência sem fonte; cancelamento: login desconhecido (linha entra sem usuário), data sentinela (NOT NULL recusa);
exclusão (registro_excluido): instante da exclusão vazio e sentinela e usuário vazio (NOT NULL recusa).
Convênios da agenda de exames, escala e cancelamento: linhas e esperado prontos (ESPERADO_PRONTO), fora do
retorno até SIAGENDA carregar e até as regras pedidas (o esperado deles supõe SIAGENDA carregada).
Pais de fora da fatia (já carregados): REAGENDA (L6-03), TBCONVEN e TBESPEC (L5), TBUSERS e RICADPAC (L3). SIAGENDA
(desta fatia, bloqueada) NÃO entra como carregada: nada do retorno depende dela.
"""
import datetime as _dt

DDL = """
CREATE TABLE TBSITAGE (COD VARCHAR(2) NOT NULL PRIMARY KEY, NOME VARCHAR(40), EXTENSAO VARCHAR(5),
  ICONE BLOB SUB_TYPE 0, INT_AGENDA_ONLINE CHAR(1));
CREATE TABLE REAGENDA_TBCONVEN (ID INTEGER NOT NULL PRIMARY KEY, ID_REAGENDA INTEGER NOT NULL,
  ID_TBCONVEN SMALLINT NOT NULL, OBS_AGEND_ONLINE BLOB SUB_TYPE 1);
CREATE TABLE REAGENDA_TBESPEC (ID INTEGER NOT NULL PRIMARY KEY, ID_REAGENDA INTEGER NOT NULL,
  ID_TBESPEC INTEGER NOT NULL);
CREATE TABLE SIAGENDA (ID INTEGER NOT NULL PRIMARY KEY, CRM INTEGER NOT NULL, NOME VARCHAR(40) NOT NULL,
  EXAME VARCHAR(1) NOT NULL, DURACAO VARCHAR(4));
CREATE TABLE SIAGENDA_TBCONVEN (ID INTEGER NOT NULL PRIMARY KEY, ID_SIAGENDA INTEGER NOT NULL,
  ID_TBCONVEN SMALLINT NOT NULL, OBS_AGEND_ONLINE BLOB SUB_TYPE 1);
CREATE TABLE SICTRAGE (AGENDA VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL, SEMANA VARCHAR(1) NOT NULL,
  DURACAO VARCHAR(4) NOT NULL, EXAME CHAR(1) NOT NULL, HOR_FIN VARCHAR(4), INTER_FIN VARCHAR(4), HOR_INC VARCHAR(4),
  INTER_INC VARCHAR(4), PRIMARY KEY (AGENDA, CRM, SEMANA, DURACAO, EXAME));
CREATE TABLE SICANAGE (NOME VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL, DATA DATE NOT NULL, HORA VARCHAR(4) NOT NULL,
  FONE VARCHAR(15), PACIENTE VARCHAR(70), DT_CAN DATE NOT NULL, HR_CAN VARCHAR(4) NOT NULL, USU_CAN VARCHAR(31),
  USU_AGE VARCHAR(31), CONV SMALLINT, MOTIVO VARCHAR(30), ID_TBMOTCANCCAD INTEGER,
  PRIMARY KEY (NOME, CRM, DATA, HORA, DT_CAN, HR_CAN));
CREATE TABLE REPACAGD_EXCLUSAO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL,
  DATA DATE NOT NULL, HORA VARCHAR(5) NOT NULL, PACIENTE VARCHAR(70), USUARIO VARCHAR(31), ID_REPACAGD INTEGER NOT NULL,
  DATA_HORA_AGENDAMENTO TIMESTAMP NOT NULL, ID_TBUSERS_INCLUSAO VARCHAR(31) NOT NULL, DATA_HORA_EXCLUSAO TIMESTAMP,
  ID_RICADPAC INTEGER);
"""
PAIS_EXTERNOS = {"REAGENDA": ["1", "2", "3"], "TBCONVEN": ["1", "2", "3"], "TBESPEC": ["1", "2", "3"],
                 "TBUSERS": ["ana", "bia"], "RICADPAC": ["7"]}
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');"
                   # situação da agenda de CONSULTAS (outra fatia) já gravada com o código cru 'C'
                   " INSERT INTO situacao_marcacao (codigo, descricao, significado, criado_em)"
                   " VALUES ('C', 'Consulta exemplo', 'cancelada', NOW(3))")

SIT, CONV, ESP = "TBSITAGE", "REAGENDA_TBCONVEN", "REAGENDA_TBESPEC"
SICONV, ESC, CAN, EXC = "SIAGENDA_TBCONVEN", "SICTRAGE", "SICANAGE", "REPACAGD_EXCLUSAO"
D, TS = _dt.date, _dt.datetime


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
    # agenda de exames (só como pai: bloqueada na carga); 2 e 3 com o mesmo nome; 4 nunca carregada
    for v in [(1, 0, "Endoscopia exemplo", "E", "0030"), (2, 0, "Ultrassom exemplo", "U", "0015"),
              (3, 0, "Ultrassom exemplo", "O", "0015"), (4, 0, "Agenda nao carregada", "E", "0020")]:
        ins("SIAGENDA", list(v))
    for v in [(1, 1, 1, obs(11)), (2, 2, 1, None),
              (3, 1, 1, None),                    # par repetido: restricao_destino_1062
              (4, 9, 2, None),                    # agenda inexistente em NOT NULL: recusa pela restrição
              (5, 2, 3, "Aviso €“” exame".encode("cp1252"))]:
        ins(SICONV, list(v))
    e = "Endoscopia exemplo"
    for v in [(e, 0, "2", "0030", "E", "1200", "0000", "0800", "0000"),
              (e, 0, "4", "0030", "E", "1800", "1400", "1300", "1330"),
              ("Ultrassom exemplo", 0, "3", "0015", "U", "1100", None, "0700", None),   # nome repetido: pai_ambiguo
              (e, 0, "9", "0030", "O", "1000", None, "0800", None),     # dia fora de 1..7: valor_fora_do_dominio
              (e, 0, "5", "0020", "E", "0700", None, "0900", None),     # fim antes do início: restrição do destino
              (e, 0, "6", "0020", "E", "2575", None, "0800", None),     # hora inválida: hora_invalida
              ("Agenda nao carregada", 0, "2", "0030", "E", "1200", None, "0800", None)]:  # pai_inexistente
        ins(ESC, list(v))
    for v in [(e, 0, D(2026, 3, 2), "0800", "0000-0000", "Paciente Ficticio Um", D(2026, 3, 1), "1015", "ana", "bia",
               1, "Paciente desistiu", None),
              (e, 0, D(2026, 3, 2), "0830", None, "Paciente Ficticio Dois", D(2026, 3, 1), "1100", "zeca", "ana",
               2, "Exame remarcado", None),                             # login desconhecido: entra sem usuário
              (e, 0, D(2026, 3, 2), "0900", None, None, D(1899, 12, 30), "0000", None, None, None, None, None),
              (e, 0, D(2026, 3, 3), "0930", None, "Paciente Ficticio Tres", D(2026, 3, 2), "0900", None, None,
               None, "  Sem   motivo €", None)]:
        ins(CAN, list(v))
    for v in [(1, "Agenda consulta exemplo", 101, D(2026, 1, 12), "08:00", "Paciente Ficticio Quatro", "ana", 501,
               TS(2026, 1, 5, 9, 0), "ana", TS(2026, 1, 10, 14, 30), 7),
              (2, "Agenda consulta exemplo", 101, D(2026, 1, 12), "08:30", None, None, 502,
               TS(2026, 1, 5, 9, 5), "bia", None, None),               # sem instante nem usuário: NOT NULL recusa
              (3, "Agenda consulta exemplo", 101, D(2026, 1, 12), "09:00", None, None, 503,
               TS(2026, 1, 5, 9, 10), "bia", TS(1899, 12, 30, 0, 0), None)]:  # sentinela: data_sentinela e recusa
        ins(EXC, list(v))
    return {k: v for k, v in _esperado().items() if k not in ESPERADO_PRONTO}


# declaração pronta e comentada em colunas.d/L6-04.tsv até SIAGENDA carregar e até as regras pedidas (L6-04.json):
# as linhas e as anomalias já estão na imagem; o esperado abaixo entra no retorno de `linhas` quando a declaração for
# descomentada (SIAGENDA_TBCONVEN e SICTRAGE pedem também "SIAGENDA" em PAIS_EXTERNOS ou carregada na fatia)
ESPERADO_PRONTO = ("SIAGENDA_TBCONVEN", "SICTRAGE", "SICANAGE")


def _esperado():
    return {
        SIT: {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 2, "restricao_destino_1048": 2}},
        CONV: {"gravados": 4, "pendencias": {"restricao_destino_1062": 1, "pai_inexistente": 2,
                                             "restricao_destino_1048": 3}},
        ESP: {"gravados": 4, "pendencias": {"valor_presumido": 6, "restricao_destino_1062": 1, "pai_inexistente": 1,
                                            "restricao_destino_1048": 1}},
        SICONV: {"gravados": 3, "pendencias": {"restricao_destino_1062": 1,
                                               "pai_inexistente": 1, "restricao_destino_1048": 1}},
        ESC: {"gravados": 2, "pendencias": {"vigencia_sem_fonte": 7, "pai_ambiguo": 1, "pai_inexistente": 1,
                                            "valor_fora_do_dominio": 1, "hora_invalida": 1,
                                            "restricao_destino_1048": 4, "restricao_destino_4025": 1}},
        CAN: {"gravados": 3, "pendencias": {"pai_inexistente": 1, "data_sentinela": 1, "restricao_destino_1048": 1}},
        EXC: {"gravados": 1, "pendencias": {"data_sentinela": 1, "restricao_destino_1048": 2}},
    }
