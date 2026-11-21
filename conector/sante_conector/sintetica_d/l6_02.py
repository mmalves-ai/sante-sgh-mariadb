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
PREPARO_DESTINO cria o estabelecimento único do cliente de exemplo (no cliente real ele vem do L3).
As tabelas bloqueadas da fatia (TBLOCALHORA, TBREFCANCMODTP, TBSTATUSGUICHE, TBFLUXOATEND, ATCONTA, REPARAM,
HTATENDIMENTO e TBTIPO_ATENDIMENTO, que é tipo de pré-atendimento e não módulo de recepção) ficam fora da imagem até
os pedidos do L6-02.json.
Situação 'S' (suspensa) vira 'suspensa': o esperado supõe o CHECK do modelo com 'suspensa' (pedido de ler_ddl).
"""
import datetime

DDL = """
CREATE TABLE TBRECEPCAO (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(40) NOT NULL, TEXTOIMP BLOB SUB_TYPE 1,
  IMPRESSORA_MODO_GRAFICO CHAR(1), QTDE_CHAM_SUGES_CANC_SENHA SMALLINT);
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
"""
PAIS_EXTERNOS = {"TBUSERS": ["RECEP01", "RECEP02"], "PNTIPO": ["1", "2"], "ATCABECATEND": [str(i) for i in range(1, 7)],
                 "TBESPEC": ["1"], "TBPROFIS": ["1"], "TBUNIDAD": ["1"], "REAGENDA": ["1"],
                 "REPACAGD": ["1", "2"], "SIPACAGD": ["1", "2"]}
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento)")
CARREGADAS = ("TBRECEPCAO", "TBGUICHE", "TBLOCAL", "PNCONFIG", "TBLOCALENCATE", "TBLOCALPESATE",
              "TBGERASENHA", "TBSENHAATEND", "ATCABECATEND_TBSENHAATEND", "TBSENHAATEND_REPACAGD",
              "TBSENHAATEND_SIPACAGD")
BLOQUEADAS = ("TBLOCALHORA", "TBREFCANCMODTP", "TBSTATUSGUICHE", "TBFLUXOATEND", "ATCONTA", "REPARAM", "HTATENDIMENTO",
              "TBTIPO_ATENDIMENTO")


def linhas(r, ins):
    # recepções: 3 com indicador fora do domínio; 4 só espaços na descrição (recusada: filhos com pai_pendente)
    for i, (descr, graf) in enumerate([("Recepção central", "S"), ("Recepção exames", "N"), ("Recepção três", "X"),
                                       ("   ", "N"), ("Recepção cinco", None)], 1):
        texto = ("Aguarde ser chamado\r\n  pelo painel  " if i == 2 else "Senha %d" % i).encode("cp1252")
        ins("TBRECEPCAO", [i, descr, texto, graf, r.randint(0, 5)])
    # guichês: (0, 2) CHECK numero > 0; (1, 4) pai recusado
    for g in [(1, 1), (2, 1), (1, 2), (0, 2), (1, 4), (3, 5)]:
        ins("TBGUICHE", list(g))
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
    return {
        "TBRECEPCAO": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "TBGUICHE": {"gravados": 4, "pendencias": {"restricao_destino_4025": 1, "pai_pendente": 1}},
        "TBLOCAL": {"gravados": 4, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1, "restricao_destino_1048": 2,
                                                  "restricao_destino_1062": 1, "valor_fora_do_dominio": 1}},
        "PNCONFIG": {"gravados": 2, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1, "restricao_destino_1048": 1,
                                                   "valor_presumido": 3}},
        "TBLOCALENCATE": {"gravados": 2, "pendencias": {"restricao_destino_4025": 1, "pai_pendente": 1}},
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
    }
