"""Fatia L6-02 (recepção: recepções, guichês, locais, painéis, geradores e senhas): tabelas da origem carregáveis hoje
pela carga dirigida pelo mapa.

Dados 100% falsos (descrições e logins inventados). Anomalias cobertas:
- descrição só de espaços em coluna obrigatória do destino (restricao_destino_1048);
- indicador S/N ou A/I fora do domínio (valor_fora_do_dominio, fica o padrão do destino);
- número de guichê 0 e encaminhamento para o próprio local (CHECK do destino: restricao_destino_4025);
- pai recusado (pai_pendente em cadeia: recepção -> local -> painel, encaminhamento, visibilidade; gerador -> senha
  -> atendimento_senha e marcação) e pai nunca visto (pai_inexistente; em coluna NOT NULL também recusa a linha);
- código, prefixo ou número repetido sob chave única do destino (restricao_destino_1062), inclusive código que só
  difere pela caixa e pelas pontas (colação sem caixa do destino);
- tipo de gerador e situação da senha fora do de-para de valores; situação vazia (tratada como aguardando);
- data sentinela na data da senha e no momento da emissão (data_sentinela; NOT NULL recusa a linha);
- login de usuário que nunca existiu (pai_inexistente, coluna anulável: grava);
- nome presumido do painel e do gerador (valor_presumido em toda linha que chega à gravação).
- evento da senha (TBFLUXOATEND): ação casada pela letra exata (chave alternativa; 'c' e 'C' são ações distintas),
  ação recusada na L6-01 (pai_pendente), letra nunca vista, senha e local recusados, senha vazia, momento vazio ou
  sentinela (NOT NULL recusa), login nunca visto (anulável: grava);
- histórico do atendimento (HTATENDIMENTO) como trilha de auditoria com retrato JSON COMPLETO (`#retrato:*`):
  atendimento nunca visto (entidade_id anulável: grava com pai_inexistente) e momento sentinela (NOT NULL recusa);
- horário do local (TBLOCALHORA, pares início/fim no destino principal): um horário por dia com hora, feriado como dia
  não útil, local sem nenhum dia (sem_item_a_gravar), fim antes do início (a linha inteira é recusada pelo CHECK),
  local recusado (pai_pendente) e local nunca visto (NOT NULL recusa).
PREPARO_DESTINO cria o estabelecimento único do cliente de exemplo (no cliente real ele vem do L3).
REQUER a L6-01: a ação do evento casa pela letra na ORIGEM de TBACAOFLUXOSENHA (chave alternativa), que é tabela da
L6-01 (o tipo de painel também vem de lá, não mais como pai externo).
- contadores de numeração da linha única de parâmetros (REPARAM, desdobrados em sequencia_negocio inativa): quatro
  contadores com valor (um deles zero) e três vazios (sem item); competência e opções não carregam.
Fora da imagem: descartes da fatia (TBREFCANCMODTP, TBSTATUSGUICHE, TBTIPO_ATENDIMENTO; motivos em sem_carga.tsv) e
ATCONTA, descarte duplicado: atendimento_conta nasce da carga das contas (FCCTAEXT na L8-05, RICONTAS na L8-06).
Situação 'S' (suspensa) vira 'suspensa': o esperado supõe o CHECK do modelo com 'suspensa' (pedido de ler_ddl).
"""
import datetime

DDL = """
CREATE TABLE TBREFCANCMODTP (ID_TBMOTCANCMOD SMALLINT NOT NULL, ID_TBMOTCANCTP SMALLINT NOT NULL,
  PRIMARY KEY (ID_TBMOTCANCMOD, ID_TBMOTCANCTP));
CREATE TABLE TBSTATUSGUICHE (NUMERO_GUICHE SMALLINT NOT NULL, ID_TBRECEPCAO SMALLINT NOT NULL, ID_TBUSERS VARCHAR(31),
  ID_TBLOCAL SMALLINT NOT NULL, CONSTRAINT PK_TBSTATUSGUICHE PRIMARY KEY (NUMERO_GUICHE, ID_TBRECEPCAO, ID_TBLOCAL));
CREATE TABLE TBTIPO_ATENDIMENTO (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(20) NOT NULL);
CREATE TABLE ATCONTA (ID BIGINT NOT NULL PRIMARY KEY, ID_ATCABECATEND BIGINT NOT NULL, COD_CONTA BIGINT NOT NULL);
CREATE TABLE TBRECEPCAO (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(40) NOT NULL, TEXTOIMP BLOB SUB_TYPE 1,
  IMPRESSORA_MODO_GRAFICO CHAR(1), QTDE_CHAM_SUGES_CANC_SENHA SMALLINT);
CREATE TABLE TBLOCALHORA (ID_TBLOCAL SMALLINT NOT NULL PRIMARY KEY, SEGUNDA_INICIO TIME, SEGUNDA_FINAL TIME,
  TERCA_INICIO TIME, TERCA_FINAL TIME, QUARTA_INICIO TIME, QUARTA_FINAL TIME, QUINTA_INICIO TIME, QUINTA_FINAL TIME,
  SEXTA_INICIO TIME, SEXTA_FINAL TIME, SABADO_INICIO TIME, SABADO_FINAL TIME, DOMINGO_INICIO TIME, DOMINGO_FINAL TIME,
  FERIADO_INICIO TIME, FERIADO_FINAL TIME);
CREATE TABLE TBGUICHE (NUMERO_GUICHE SMALLINT NOT NULL, ID_TBRECEPCAO SMALLINT NOT NULL,
  CONSTRAINT PK_TBGUICHE PRIMARY KEY (NUMERO_GUICHE, ID_TBRECEPCAO));
CREATE TABLE TBLOCAL (ID SMALLINT NOT NULL PRIMARY KEY, ID_TBRECEPCAO SMALLINT NOT NULL, COD SMALLINT NOT NULL,
  DESCRICAO VARCHAR(40), IP_PAINEL VARCHAR(15), PORTA_PAINEL SMALLINT, PERMITE_ENC CHAR(1),
  CONDICAO_LOCALIZACAO_PACIENTE SMALLINT, LOCAL_BASE_CALC_ESPERA_PEP CHAR(1), ATIVO CHAR(1), LOCAL_ENC INTEGER,
  CANAL VARCHAR(40), PAINEL_WEB CHAR(1), FLUXO_REAVALIACAO_MEDICA CHAR(1));
CREATE TABLE PNCONFIG (ID SMALLINT NOT NULL PRIMARY KEY, ID_PNTIPO SMALLINT NOT NULL, CONFIGURACAO BLOB SUB_TYPE 1,
  ID_TBLOCAL SMALLINT);
CREATE TABLE TBLOCALENCATE (ID_TBLOCAL SMALLINT NOT NULL, ID_TBLOCAL_ENCAM_ATEND SMALLINT NOT NULL,
  CONSTRAINT PK_TBLOCALENCATE PRIMARY KEY (ID_TBLOCAL, ID_TBLOCAL_ENCAM_ATEND));
CREATE TABLE TBLOCALPESATE (ID_TBLOCAL SMALLINT NOT NULL, ID_TBLOCAL_PESQ_ATEND SMALLINT NOT NULL,
  CONSTRAINT PK_TBLOCALPESATE PRIMARY KEY (ID_TBLOCAL, ID_TBLOCAL_PESQ_ATEND));
CREATE TABLE TBGERASENHA (ID INTEGER NOT NULL PRIMARY KEY, ID_TBRECEPCAO INTEGER NOT NULL, ID_TBUNIDAD SMALLINT,
  ID_TBPROFIS INTEGER, OLD_ID_TBMEDICO INTEGER, ID_TBESPEC SMALLINT, TIPO CHAR(1), GERAR_PRIORITARIA CHAR(1),
  LETRA_SENHA VARCHAR(3), SITUACAO CHAR(1), LIMITE_SENHA_DIA SMALLINT, GERAR_SENHA_AUTOMATICA CHAR(1),
  ID_REAGENDA INTEGER, ID_SIAGENDA INTEGER, NOME_TIPO_DIVERSO VARCHAR(40), ICONE BLOB, ORDENAR_LISTA_PACIENTE_POR SMALLINT);
CREATE TABLE TBSENHAATEND (ID INTEGER NOT NULL PRIMARY KEY, ID_TBGERASENHA INTEGER NOT NULL, DATA_SENHA DATE NOT NULL,
  SENHA SMALLINT NOT NULL, GUICHE SMALLINT, PRIORIDADE CHAR(1), SITUACAO CHAR(1), USUARIO VARCHAR(31) NOT NULL,
  MOTIVO VARCHAR(50), DATA_HORA TIMESTAMP NOT NULL);
CREATE TABLE ATCABECATEND_TBSENHAATEND (ID_ATCABECATEND BIGINT NOT NULL PRIMARY KEY, ID_TBSENHAATEND INTEGER NOT NULL);
CREATE TABLE TBSENHAATEND_REPACAGD (ID_TBSENHAATEND INTEGER NOT NULL PRIMARY KEY, ID_REPACAGD INTEGER NOT NULL);
CREATE TABLE TBSENHAATEND_SIPACAGD (ID_TBSENHAATEND INTEGER NOT NULL PRIMARY KEY, ID_SIPACAGD INTEGER NOT NULL);
CREATE TABLE TBFLUXOATEND (ID INTEGER NOT NULL PRIMARY KEY, ID_TBSENHAATEND INTEGER, ID_TBLOCAL SMALLINT NOT NULL,
  DATA_HORA TIMESTAMP, USUARIO VARCHAR(31) NOT NULL, ACAO CHAR(1));
CREATE TABLE HTATENDIMENTO (ID BIGINT NOT NULL PRIMARY KEY, ID_ATCABECATEND BIGINT NOT NULL,
  DATA_HORA_HISTORICO TIMESTAMP NOT NULL, DATA_HORA_ENTRADA TIMESTAMP NOT NULL, ID_HTCONVEN SMALLINT NOT NULL,
  MATRICULA VARCHAR(24), JUSTIFICATIVA_ALTA_RETROATIVA VARCHAR(255));
CREATE TABLE REPARAM (INSC_M VARCHAR(14), MESPRO SMALLINT, ANOPRO SMALLINT, ULTPRONT INTEGER, ULTREG INTEGER,
  ULTPRTFAM INTEGER, PRT_OTMU INTEGER, CTR_PAG_REG INTEGER, PRTA_OTMU INTEGER, PRTANT INTEGER);
"""
REQUER = ["L6-01"]
PAIS_EXTERNOS = {"TBUSERS": ["RECEP01", "RECEP02"], "ATCABECATEND": [str(i) for i in range(1, 7)],
                 "TBESPEC": ["1"], "TBPROFIS": ["1"], "TBUNIDAD": ["1"], "REAGENDA": ["1"],
                 "REPACAGD": ["1", "2"], "SIPACAGD": ["1", "2"]}
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
                   # rodada 5 (correção): conta_hospitalar e atendimento_conta como a carga das contas de internação
                   # (RICONTAS, L8-06) os deixa: conta por (registro, conta parcial), registrada como pai externo
                   " CREATE TABLE IF NOT EXISTS conta_hospitalar (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " atendimento_id BIGINT UNSIGNED NULL, estabelecimento_id BIGINT UNSIGNED NULL, numero VARCHAR(20) NULL,"
                   " paciente_id BIGINT UNSIGNED NULL, fonte_pagadora_id BIGINT UNSIGNED NULL,"
                   " tipo_conta_id BIGINT UNSIGNED NULL, natureza VARCHAR(20) NULL, competencia DATE NULL,"
                   " inicio_em DATETIME(3) NULL, criado_em DATETIME(3) NULL);"
                   " CREATE TABLE IF NOT EXISTS atendimento_conta (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " atendimento_id BIGINT UNSIGNED NOT NULL, conta_hospitalar_id BIGINT UNSIGNED NOT NULL,"
                   " criado_em DATETIME(3) NULL, excluido_em DATETIME(3) NULL);")


def _ids_externos():
    """Id que a conferência dá a cada pai externo: ordem das tabelas e das chaves, juntando os da fatia requerida."""
    import importlib
    ext = {}
    for mod in [importlib.import_module("sante_conector.sintetica_d.l6_01")]:
        for t, ks in getattr(mod, "PAIS_EXTERNOS", {}).items():
            ext.setdefault(t, []).extend(k for k in ks if k not in ext[t])
    for t, ks in PAIS_EXTERNOS.items():
        ext.setdefault(t, []).extend(k for k in ks if k not in ext[t])
    ids, i = {}, 0
    for t, ks in sorted(ext.items()):
        for k in ks:
            i += 1
            ids[(t, k)] = i
    return ids


# ATCONTA (atendimento, registro da conta): 1 -> 900 com duas contas parciais; 2 -> 901 e 902; 3 -> 903; 4 sem conta
# no destino (a origem também não a liga); o par é conferido linha a linha pela prova (provas.d/ATCONTA.sql)
CONTAS = [("1", "900|1"), ("1", "900|2"), ("2", "901|1"), ("2", "902|1"), ("3", "903|1")]
PAIS_EXTERNOS["RICONTAS"] = [c for _, c in CONTAS]
_IDS = _ids_externos()
# a conta é de outra fatia (L8-06): no banco descartável com o DDL completo ela exige as colunas obrigatórias e os
# CHECKs (natureza, competência no dia 1); os pais dela (paciente, fonte pagadora, tipo de conta) não são desta fatia,
# por isso as FKs ficam desligadas só neste preparo
PREPARO_DESTINO += " SET FOREIGN_KEY_CHECKS=0;"
PREPARO_DESTINO += "".join(" INSERT INTO conta_hospitalar (id, atendimento_id, estabelecimento_id, numero, paciente_id,"
                           " fonte_pagadora_id, tipo_conta_id, natureza, competencia, inicio_em, criado_em)"
                           " SELECT %d, %d, 1, 'CT%d', 1, 1, 1, 'internacao', '2020-01-01', '2020-01-01', NOW(3)"
                           " FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM conta_hospitalar WHERE id = %d);"
                           % (_IDS[("RICONTAS", c)], _IDS[("ATCABECATEND", a)], _IDS[("RICONTAS", c)],
                              _IDS[("RICONTAS", c)]) for a, c in CONTAS)
PREPARO_DESTINO += (" INSERT INTO atendimento_conta (atendimento_id, conta_hospitalar_id, criado_em)"
                    " SELECT a, c, NOW(3) FROM (%s) x"
                    " WHERE NOT EXISTS (SELECT 1 FROM atendimento_conta);" % " UNION ALL ".join(
                        "SELECT %d a, %d c" % (_IDS[("ATCABECATEND", a)], _IDS[("RICONTAS", c)]) for a, c in CONTAS))
PREPARO_DESTINO += " SET FOREIGN_KEY_CHECKS=1"
CARREGADAS = ("TBRECEPCAO", "TBGUICHE", "TBLOCAL", "PNCONFIG", "TBLOCALENCATE", "TBLOCALHORA", "TBLOCALPESATE",
              "TBGERASENHA", "TBSENHAATEND", "ATCABECATEND_TBSENHAATEND", "TBSENHAATEND_REPACAGD",
              "TBSENHAATEND_SIPACAGD", "TBFLUXOATEND", "HTATENDIMENTO", "REPARAM", "TBSTATUSGUICHE", "TBTIPO_ATENDIMENTO",
              "TBREFCANCMODTP")
DESCARTADAS = ("ATCONTA",)
BLOQUEADAS = ()   # ATCONTA: descarte duplicado COM PROVA (provas.tsv): atendimento_conta nasce da carga das contas
DESDOBRADAS = {"TBLOCALHORA": 2, "REPARAM": 1}   # linhas da origem que gravam itens (o esperado "gravados" conta itens)


def linhas(r, ins):
    # recepções: 3 com indicador fora do domínio; 4 só espaços na descrição (recusada: filhos com pai_pendente)
    for i, (descr, graf) in enumerate([("Recepção central", "S"), ("Recepção exames", "N"), ("Recepção três", "X"),
                                       ("   ", "N"), ("Recepção cinco", None)], 1):
        texto = ("Aguarde ser chamado\r\n  pelo painel  " if i == 2 else "Senha %d" % i).encode("cp1252")
        ins("TBRECEPCAO", [i, descr, texto, graf, r.randint(0, 5)])
    # guichês: (0, 2) CHECK numero > 0; (1, 4) pai recusado
    for g in [(1, 1), (2, 1), (1, 2), (0, 2), (1, 4), (3, 5)]:
        ins("TBGUICHE", list(g))
    # rodada 5: estado do guichê: (1, 1) já carregado por TBGUICHE é adotado; (7, 1) só citado aqui é criado;
    # (2, 4) recepção recusada (pai_pendente, recusa: NOT NULL)
    for g in [(1, 1, "RECEP01", 1), (7, 1, None, 1), (2, 4, "RECEP02", 4)]:
        ins("TBSTATUSGUICHE", list(g))
    for i, d in [(1, "Pré-atendimento um"), (2, "Pré  atendimento 2")]:
        ins("TBTIPO_ATENDIMENTO", [i, d])
    # ligação atendimento x registro da conta (ficha externa ou registro da internação): o atendimento 2 com dois
    # registros; o registro 900 tem duas contas parciais no destino (um par só); a prova confere cada par
    for i, (at, conta) in enumerate([(1, 900), (2, 901), (2, 902), (3, 903)], 1):
        ins("ATCONTA", [i, at, conta])
    # locais: 4 pai recusado; 5 pai nunca visto (NOT NULL recusa); 6 código repetido; 7 ATIVO fora; 8 sem descrição
    loc = [(1, 1, 10, "Consultório um"), (2, 1, 11, "Consultório dois"), (3, 2, 12, "Sala de exame"),
           (4, 4, 13, "Sala quatro"), (5, 99, 14, "Sala cinco"), (6, 2, 10, "Código repetido"),
           (7, 5, 17, "Sala sete"), (8, 2, 18, None)]
    for i, rec, cod, descr in loc:
        ins("TBLOCAL", [i, rec, cod, descr, "10.0.0.%d" % i, 9000 + i, "SN"[i % 2], r.randint(0, 2), "N", "X" if i == 7 else "S",
                        None, "canal %d" % i if i < 3 else None, "S", "N" if i % 3 else "S"])
    # painéis: 3 local recusado (pai_pendente); 4 tipo nunca carregado (NOT NULL recusa)
    for p in [(1, 1, b"[painel]\r\nfila=1", 1), (2, 2, None, None), (3, 1, None, 4), (4, 9, None, 2)]:
        ins("PNCONFIG", list(p))
    for e in [(1, 2), (2, 1), (1, 1), (3, 4)]:          # (1, 1) CHECK distinto; (3, 4) pai recusado
        ins("TBLOCALENCATE", list(e))
    # horários (pares início/fim): 1 seg a sex, sábado e feriado (7 itens); 2 só domingo (1 item); 3 nenhum dia
    # (sem_item_a_gravar); 7 fim antes do início na segunda (CHECK recusa a linha); 4 local recusado; 50 nunca visto
    def h(hh, mm):        # TIME da origem como literal (a imagem é gerada por isql)
        return "%02d:%02d:00" % (hh, mm)

    semana = [h(7, 0), h(19, 0)] * 5 + [h(7, 0), h(12, 0), None, None, h(8, 0), h(12, 0)]
    for loc, hs in [(1, semana), (2, [None] * 12 + [h(8, 0), h(14, 0), None, None]), (3, [None] * 16),
                    (7, [h(13, 0), h(12, 0)] + [None] * 14), (4, [h(8, 0), h(12, 0)] + [None] * 14),
                    (50, [h(8, 0), h(12, 0)] + [None] * 14)]:
        ins("TBLOCALHORA", [loc] + hs)
    for v in [(1, 2), (1, 3), (2, 3), (3, 1), (7, 1), (8, 1)]:  # (8, 1) pai recusado
        ins("TBLOCALPESATE", list(v))
    # geradores: 4 prefixo repetido; 5 sem letra; 6 tipo sem par; 7 recepção recusada; 9 agenda sem alvo (CHECK);
    # 10 situação fora do domínio A/I
    ger = [(1, 1, "0", "A", "A", 0, None), (2, 1, "5", "B", "A", 50, "Exames diversos"), (3, 2, "0", "A", "I", 0, None),
           (4, 1, "0", "A", "A", 0, None), (5, 2, "0", None, "A", 0, None), (6, 2, "1", "C", "A", 0, None),
           (7, 4, "0", "D", "A", 0, None), (8, 2, "3", "E", "A", 10, None), (9, 3, "4", "G", "A", 0, None),
           (10, 3, "0", "H", "X", 0, None)]
    for i, rec, tipo, letra, sit, lim, nome in ger:
        esp = 1 if tipo == "3" else None
        ins("TBGERASENHA", [i, rec, 1 if i == 8 else None, 1 if i == 8 else None, None, esp, tipo, "SN"[i % 2], letra,
                            sit, lim, "N", None, None, nome, b"\x89PNG\x00\x01" if i == 2 else None, 0])
    # senhas: geradores gravados 1, 2, 3, 6, 8, 10; recusados 4, 5, 7, 9
    base, n = datetime.datetime(2026, 3, 2, 7, 0), {}
    for i in range(1, 31):
        g = (1, 2, 3, 6, 8, 10)[i % 6]
        dia = base + datetime.timedelta(days=i // 12, minutes=7 * i)
        num = n[(g, dia.date())] = n.get((g, dia.date()), 0) + 1
        prio, sit, usu, mot, data, dh = "2", "ALSGC"[i % 5], "RECEP0%d" % (1 + i % 2), None, dia.date(), dia
        if i == 5:
            g = 4                # gerador recusado: pai_pendente
        if i == 6:
            g = 99               # gerador nunca visto: NOT NULL recusa
        if i == 7:
            sit = "Z"            # fora do de-para: padrão 'aguardando' com pendência
        if i == 8:
            sit = ""             # vazio: aguardando
        if i == 9:
            g, data, num = 2, datetime.date(2026, 3, 2), 1   # repete o número da senha 1 (gerador 2, mesmo dia)
        if i == 10:
            usu = "NINGUEM"      # login nunca visto (anulável: grava)
        if i == 11:
            data = datetime.date(1899, 12, 30)              # data sentinela em NOT NULL: recusa
        if i == 12:
            prio = "0"
        if i == 13:
            prio = "1"
        if i == 14:
            dh = datetime.datetime(1899, 12, 30)            # momento sentinela em NOT NULL: recusa
        if sit == "S":
            mot = "Paciente não localizado"
        ins("TBSENHAATEND", [i, g, data, num, 0, prio, sit, usu, mot, dh])
    # vínculos: senha 5 pendente, 6 recusada; atendimento 77 nunca visto (NOT NULL recusa)
    for a in [(1, 1), (2, 2), (3, 3), (4, 5), (5, 6), (77, 4)]:
        ins("ATCABECATEND_TBSENHAATEND", list(a))
    for m in [(1, 1), (2, 2), (5, 1), (3, 9)]:
        ins("TBSENHAATEND_REPACAGD", list(m))
    for m in [(4, 1), (12, 2), (11, 1)]:
        ins("TBSENHAATEND_SIPACAGD", list(m))
    # eventos da senha. Ações da L6-01: C 1, A 2, c 3, F 4 gravadas; X recusada (descrição vazia); Z nunca vista.
    # Senha 5 pendente, 99 nunca vista; local 4 pendente
    sent, ev = datetime.datetime(1899, 12, 30), datetime.datetime(2026, 3, 2, 8, 0)
    flx = [(1, 1, 1, "RECEP01", "C"), (2, 1, 1, "RECEP01", "A"), (3, 2, 2, "RECEP02", "F"), (4, 3, 3, "RECEP01", "c"),
           (5, 2, 1, "RECEP01", "X"), (6, 5, 1, "RECEP01", "C"), (7, 1, 4, "RECEP01", "C"), (8, None, 1, "RECEP01", "C"),
           (9, 1, 1, "RECEP02", "A"), (10, 2, 2, "NINGUEM", "F"), (11, 3, 2, "RECEP01", "Z"), (12, 1, 2, "RECEP01", "A"),
           (13, 4, 7, "RECEP02", "C"), (14, 99, 1, "RECEP01", "C"), (15, 7, 3, "RECEP01", None)]
    for i, sen, loc, usu, acao in flx:
        dh = None if i == 9 else sent if i == 12 else ev + datetime.timedelta(minutes=3 * i)
        ins("TBFLUXOATEND", [i, sen, loc, dh, usu, acao])
    # histórico do atendimento: 4 atendimento nunca visto; 5 momento sentinela
    for i, cab in enumerate([1, 1, 2, 88, 3, 4], 1):
        hist = sent if i == 5 else datetime.datetime(2026, 3, 1 + i, 9, 30)
        ins("HTATENDIMENTO", [i, cab, hist, datetime.datetime(2026, 3, 1, 7, 0), 1, "MAT-%04d" % i,
                              "Alta registrada depois" if i == 2 else None])
    # parâmetros (linha única): ULTPRONT, ULTREG, PRTANT (zero) e CTR_PAG_REG com valor; ULTPRTFAM, PRT_OTMU e
    # PRTA_OTMU vazios (sem item); inscrição e competência lidas só pelo DDL (não carregam)
    # rodada 5 (ADR 0006): pares módulo x operação com motivo de cancelamento: lista do hospital, valor = módulo_operação
    for par in [(1, 1), (1, 2), (2, 1), (3, 2), (4, 1)]:
        ins("TBREFCANCMODTP", list(par))
    ins("REPARAM", ["0001234", 10, 2026, 1500, 3200, None, None, 12, None, 0])
    return {
        "TBRECEPCAO": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "TBGUICHE": {"gravados": 4, "pendencias": {"restricao_destino_4025": 1, "pai_pendente": 1}},
        "TBLOCAL": {"gravados": 4, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1, "restricao_destino_1048": 2,
                                                  "restricao_destino_1062": 1, "valor_fora_do_dominio": 1}},
        "PNCONFIG": {"gravados": 2, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1, "restricao_destino_1048": 1,
                                                   "valor_presumido": 3}},
        "TBLOCALENCATE": {"gravados": 2, "pendencias": {"restricao_destino_4025": 1, "pai_pendente": 1}},
        "TBLOCALHORA": {"gravados": 8, "pendencias": {"sem_item_a_gravar": 1, "restricao_destino_4025": 1,
                                                      "pai_pendente": 1, "pai_inexistente": 1,
                                                      "restricao_destino_1048": 1}},
        "TBLOCALPESATE": {"gravados": 5, "pendencias": {"pai_pendente": 1}},
        "TBGERASENHA": {"gravados": 6, "pendencias": {"valor_presumido": 9, "valor_fora_do_dominio": 2,
                                                      "restricao_destino_1062": 1, "restricao_destino_1048": 1,
                                                      "restricao_destino_4025": 1, "pai_pendente": 1}},
        "TBSENHAATEND": {"gravados": 25, "pendencias": {"pai_pendente": 1, "pai_inexistente": 2,
                                                        "restricao_destino_1048": 3, "restricao_destino_1062": 1,
                                                        "valor_fora_do_dominio": 1, "data_sentinela": 2}},
        "ATCABECATEND_TBSENHAATEND": {"gravados": 3, "pendencias": {"pai_pendente": 2, "pai_inexistente": 1,
                                                                     "restricao_destino_1048": 1}},
        "TBSENHAATEND_REPACAGD": {"gravados": 2, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                                 "restricao_destino_1048": 1}},
        "TBSENHAATEND_SIPACAGD": {"gravados": 2, "pendencias": {"pai_pendente": 1}},
        "TBFLUXOATEND": {"gravados": 6, "pendencias": {"pai_pendente": 3, "restricao_destino_1048": 6,
                                                       "pai_inexistente": 3, "data_sentinela": 1}},
        "HTATENDIMENTO": {"gravados": 5, "pendencias": {"pai_inexistente": 1, "data_sentinela": 1,
                                                        "restricao_destino_1048": 1}},
        "REPARAM": {"gravados": 4, "pendencias": {"valor_presumido": 1}},
        "TBSTATUSGUICHE": {"gravados": 2, "pendencias": {"pai_pendente": 1, "adotado_existente": 1}},
        "TBTIPO_ATENDIMENTO": {"gravados": 2, "pendencias": {"valor_presumido": 2}},
        "TBREFCANCMODTP": {"gravados": 5, "pendencias": {"adotado_existente": 9}},
    }
