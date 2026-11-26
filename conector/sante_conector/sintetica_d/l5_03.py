"""Fatia L5-03 (cadastros e administração): imagem sintética de TODAS as tabelas carregáveis da fatia.

Dados 100% falsos (logins USR.*, identificadores no arco inventado 9.99, nomes inventados). As tabelas da origem
são criadas com as colunas do dicionário do mapa (`mapa/colunas.tsv`), todas anuláveis menos a chave. Entram também,
SÓ para a leitura das referências encadeadas, as tabelas de outras fatias que a cadeia atravessa (TBCBOPRO, TBCBOSUS,
TBSEXO, HTPACIENTE), com todas as colunas do dicionário: se a fatia dona as declarar, a carga delas roda aqui sem
quebrar a leitura (o esperado delas não é conferido aqui).

Anomalias cobertas, por tabela:
- TBOID, TBTPMINISTCER, TBTPACAOAUDIT: identificador repetido (1062), código ou nome ausente (1048), nome com espaços
  repetidos e descrição com quebra de linha;
- vínculos do usuário (TBUNIUSE, TBUSERCON, TBUSERS_TBCONVEN, TBUSERSCOMPL, TBLOCAL_TBUSERS, TBUSERS_TBALERTA): login
  ou pai nunca carregado (pai_inexistente e recusa NOT NULL), par já gravado por outra origem (adotado_existente),
  regra de alerta recusada (pai_pendente);
- TBUSERS_TBPAPEL: CBO pela cadeia inscrição > CBO (código fora do catálogo: catalogo_codigo_inexistente), papel
  inativo (vigência termina na carga), S/N fora do domínio, mesmo usuário e papel em outra ocupação (consolidado:
  adotado_existente), papel inexistente;
- TBALERTA: sexo F/M pela sigla, sigla sem par e sexo inexistente, faixa 0..12, 0..0 e 30..0 (0 no limite superior é
  faixa aberta), invertida (4025), cenário ausente ou nunca carregado, data sentinela, texto longo (resumido),
  repetição presumida;
- TBALERTA_TBOPCOES_TBEVENTOS: sequência por regra, regra recusada e inexistente, tela inexistente;
- TBUSUCPL: profissional pela cadeia inscrição > profissional, sem inscrição (4025), profissional inexistente,
  a mesma inscrição noutra empresa (a empresa vira o estabelecimento do cliente: 1062); senha secundária preenchida que NUNCA é lida;
- PRJUSTIF_IMP_EXPORTACAO: usuário pelo login do profissional da inscrição (recusas-fase2 P1a: TBCBOPRO > TBPROFIS
  > login; i=2 grava), sem login nem profissional (CHECK do autor), tipo de operação e formato presumidos, documento exportado (tipo + id na origem), sem
  justificativa (4025), sem data, sem inscrição;
- exclusões (CCCADCIR_EXCLUSAO, SIPACAGD_EXCLUSAO): autor presumido (valor_presumido), atendimento pelo registro
  (um visto, um nunca visto), sem usuário, sem data, paciente inexistente;
- trilha (TBCABTRILHA, TBLANTRALERTA, TBLANTRILHASGH): paciente pela versão do cadastro, tipo de ação recusado
  (R9: grava com o tipo nulo e pai_pendente), sem usuário (CHECK do autor), mensagem longa e vazia, linhas idênticas
  sem chave.
"""
import datetime
from pathlib import Path

_MAPA = Path(__file__).resolve().parents[2] / "mapa"


def _dicionario():
    cols, chaves = {}, {}
    with open(_MAPA / "colunas.tsv", encoding="utf-8") as f:
        cab = f.readline().rstrip("\n").split("\t")
        for l in f:
            r = dict(zip(cab, l.rstrip("\n").split("\t")))
            cols.setdefault(r["tabela"], []).append((r["coluna"], r["forma"], r.get("regra", "")))
    with open(_MAPA / "tabelas.tsv", encoding="utf-8") as f:
        cab = f.readline().rstrip("\n").split("\t")
        for l in f:
            r = dict(zip(cab, l.rstrip("\n").split("\t")))
            chaves[r["tabela"]] = [x for x in (r.get("chave") or "").split(",") if x]
    return cols, chaves


_COLS, _CHAVES = _dicionario()


def _forma(forma, regra):
    if forma == "BLOB":
        return "BLOB SUB_TYPE %d" % (1 if regra == "texto_longo" else 0)
    if forma == "DOUBLE":
        return "DOUBLE PRECISION"
    return forma


def _create(t):
    ch = _CHAVES.get(t) or []
    partes = ["%s %s%s" % (c, _forma(f, r), " NOT NULL" if c in ch else "") for c, f, r in _COLS[t]]
    if ch:
        partes.append("PRIMARY KEY (%s)" % ", ".join(ch))
    return "CREATE TABLE %s (%s);" % (t, ", ".join(partes))


TABELAS = ("TBHISTSENHA", "TBUNIUSE", "TBUSERCON", "TBUSERSCOMPL", "TBUSERS_TBPAPEL", "TBALERTA_TBOPCOES_TBEVENTOS",
           "TBUSERS_TBALERTA", "TBLOCAL_TBUSERS", "PRJUSTIF_IMP_EXPORTACAO", "CCCADCIR_EXCLUSAO", "TBUSUCPL",
           "TBUSERS_TBCONVEN", "SIPACAGD_EXCLUSAO", "TBCABTRILHA", "TBLANTRALERTA", "TBLANTRILHASGH")
CADEIA = ("TBCBOPRO", "TBPROFIS", "TBSEXO", "HTPACIENTE", "TBTIPOOID")  # de outras fatias: só lidas pela referência encadeada
DDL = """
CREATE TABLE TBTPPERM_RICADPAC (ID INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(23));
CREATE TABLE TBOID (ID SMALLINT NOT NULL PRIMARY KEY, OID VARCHAR(30) NOT NULL, DESCRICAO VARCHAR(100) NOT NULL,
  ID_TBCONSPROF SMALLINT, ID_TBTIPOOID SMALLINT);
CREATE TABLE TBTPMINISTCER (ID SMALLINT NOT NULL PRIMARY KEY, COD_TBTPMINISTCER VARCHAR(8), NOME VARCHAR(60));
CREATE TABLE TBALERTA (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40) NOT NULL, ATIVO CHAR(1),
  IDADE_INICIAL INTEGER, IDADE_FINAL INTEGER, DESCRICAO_ALERTA BLOB SUB_TYPE 1 NOT NULL, TP_EXIBICAO SMALLINT,
  ID_TBSEXO INTEGER, ID_TBCENARIO INTEGER, ORIGEM CHAR(1) NOT NULL, DATA_CAD_INICIO DATE, ALERTA_MENSAL SMALLINT,
  REPETIR_ACRITERIODOUSR CHAR(1), REPETIR_HORAS SMALLINT, REPETIR_MINUTOS SMALLINT, GRAVAR_LOG CHAR(1));
CREATE TABLE TBTPACAOAUDIT (ID SMALLINT NOT NULL PRIMARY KEY, OLD_COD_TP_ACAO_AUDITORIA SMALLINT, NOME VARCHAR(80));
CREATE TABLE TBCBOSUS (ID INTEGER NOT NULL PRIMARY KEY, COD VARCHAR(6));
""" + "\n".join(_create(t) for t in TABELAS + CADEIA) + "\n"

A, B, C, D, Z = "USR.ANA", "USR.BETO", "USR.CAIO", "USR.DORA", "USR.NINGUEM"
PAIS_EXTERNOS = {"TBUSERS": [A, B, C, D], "TBCENARIO": ["1", "2"], "TBUNIDAD": ["1", "2"], "TBCONVEN": ["10", "11"],
                 "TBPAPEL": ["1", "2"], "TBLOCAL": ["5", "6"], "TBOPCOES": ["100", "101"], "TBEVENTOS": ["200", "201"],
                 "TBNVLCRITICID": ["1"], "ATCABECATEND": ["5000"], "RICADPAC": ["700", "701"], "TBHOSPIT": ["1"],
                 "PRTIPO_JUSTIF_EXPORTACAO": ["1"], "PRTPASSINATURA": ["1", "2"], "TBPROFIS": ["300", "301"],
                 "RECADATE": ["1"]}


def id_externo(tabela, chave):
    """Id que a conferência dá ao pai externo (ordem de tabela e de chave, a partir de 1)."""
    i = 0
    for t, ks in sorted(PAIS_EXTERNOS.items()):
        for k in ks:
            i += 1
            if (t, k) == (tabela, chave):
                return i
    raise KeyError((tabela, chave))


CBO_VALIDO = "225125"
PREPARO_DESTINO = (
    "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);\n"
    "INSERT INTO estabelecimento () VALUES ();\n"
    "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES ('%s', 'Ocupação exemplo', UTC_TIMESTAMP(3));\n"
    "INSERT INTO preferencia_usuario (usuario_id, criado_em) VALUES (%d, UTC_TIMESTAMP(3));\n"
    % (CBO_VALIDO, id_externo("TBUSERS", A)))


def _linha(t, **v):
    return [v.get(c) for c, _, _ in _COLS[t]]


def linhas(r, ins):
    ts = datetime.datetime(2025, 3, 10, 8, 30)
    # --- cadastros (TBOID, TBTPMINISTCER, TBTPACAOAUDIT) ---
    for i in range(1, 13):
        oid = "9.99.%d.%d" % (1 + i % 3 if i != 12 else 1, 100 + (3 if i == 12 else i))
        descr = "Atributo exemplo %d" % i if i != 4 else "  Atributo\r\ncom quebra  "
        ins("TBOID", [i, oid, descr, 7 if i in (2, 5) else None, 1 + i % 3])
    for c in [(1, "MEX", "  Ministério   Exemplo  "), (2, "EST", "Secretaria Exemplo"), (3, None, "Sem código"),
              (4, "MUN", None), (5, "MEX", "Código repetido")]:
        ins("TBTPMINISTCER", list(c))
    for i in range(1, 9):
        nome = "Ação auditável %d" % i
        if i == 2:
            nome = "  Impressão   de  documento "
        if i == 5:
            nome = None          # descrição obrigatória no destino: recusa (a trilha que o usa fica pai_pendente)
        ins("TBTPACAOAUDIT", [i, 100 + i, nome])

    # --- tabelas atravessadas pelas cadeias (de outras fatias) ---
    ins("TBCBOSUS", [1, CBO_VALIDO])
    ins("TBCBOSUS", [2, "999999"])                       # fora do catálogo oficial
    for i, sus, prof in [(50, 1, 300), (51, 1, 301), (52, 2, 399), (53, 9, 300)]:
        ins("TBCBOPRO", _linha("TBCBOPRO", ID=i, ID_TBCBOSUS=sus, ID_TBPROFIS=prof, UF="ZZ", COD=90000 + i,
                               VINC_EMPR="N"))
    # recusas-fase2 P1a: o login da exportação vem do profissional da inscrição (TBCBOPRO > TBPROFIS > login); 399 e
    # o 9 da inscrição 53 nunca foram carregados
    for prof, login in [(300, A), (301, B)]:
        ins("TBPROFIS", _linha("TBPROFIS", ID=prof, ID_TBUSERS=login, NOME="Profissional exemplo %d" % prof))
    for cod, nome, sigla in [(1, "Masculino", "M"), (2, "Feminino", "F"), (3, "Ignorado", "I")]:
        ins("TBSEXO", [cod, nome, sigla])
    for i, pac in [(40, 700), (41, 799)]:
        ins("HTPACIENTE", _linha("HTPACIENTE", ID=i, ID_RICADPAC=pac, DATA_HORA_HISTORICO=ts, ID_TBSEXO=1,
                                 NOME="Paciente Ficticio %d" % i))

    # --- vínculos do usuário ---
    for u, un in [(A, 1), (A, 2), (B, 1), (Z, 1), (C, 9)]:
        ins("TBUNIUSE", [u, un])
    for u, cv in [(A, 10), (B, 10), (B, 11), (D, 99)]:
        ins("TBUSERCON", [u, cv])
    for u, cv in [(A, 10), (C, 11), (D, 10)]:          # A|10 já veio do modelo antigo: adotado
        ins("TBUSERS_TBCONVEN", [u, cv])
    ins("TBUSERSCOMPL", [A, "S", b"leiaute antigo"])   # A já tem preferência (PREPARO_DESTINO): adotada
    ins("TBUSERSCOMPL", [B, "N", None])
    ins("TBUSERSCOMPL", [Z, "S", None])
    for loc, u in [(5, A), (6, A), (5, B), (7, C)]:
        ins("TBLOCAL_TBUSERS", [loc, u])
    for i, u, papel, cbo, ativo in [(1, A, 1, 50, "S"), (2, A, 2, None, "N"), (3, B, 1, 52, "S"),
                                    (4, B, 1, None, "S"), (5, C, 9, None, "S"), (6, D, 2, None, "X")]:
        ins("TBUSERS_TBPAPEL", [i, u, papel, cbo, ativo])

    # --- regras de alerta ---
    base = datetime.date(2025, 1, 1)
    for i in range(1, 17):
        nome, ativo, ini, fim, cen = "Alerta exemplo %d" % i, "SN"[i % 2], None, None, 1 + i % 2
        dt, texto = base + datetime.timedelta(days=r.randint(0, 300)), "Mensagem de alerta %d ação" % i
        sexo, horas, minutos, exib = None, 0, 0, r.randint(0, 2)
        if i == 1:
            ini, fim = 0, 12
        if i == 2:
            sexo = 2             # feminino: não pode virar 'todos'
        if i == 3:
            ativo = "X"          # fora do domínio
        if i == 4:
            ini, fim = 60, 18    # faixa invertida: CHECK
        if i == 5:
            cen = None           # cenário ausente
        if i == 6:
            cen = 99             # cenário nunca carregado
        if i == 7:
            dt = datetime.date(1899, 12, 30)  # data sentinela em coluna obrigatória
        if i == 8:
            texto = "palavra " * 150  # maior que o destino (1000)
        if i == 9:
            nome, texto = "  Alerta   nove ", "Primeira linha\r\n  segunda linha  "
        if i == 10:
            horas, minutos = 2, 30  # repetição a cada 150 minutos (presumida até a regra de minutos)
        if i == 11:
            ini, fim = 0, 0      # 0..0: faixa aberta
        if i == 12:
            ini, fim = 30, 0     # 0 no limite superior: a partir de 30 anos
        if i == 13:
            sexo, minutos = 1, 45
        if i == 15:
            sexo = 3             # sigla sem par: todos, com pendência
        if i == 16:
            sexo = 7             # sexo inexistente
        ins("TBALERTA", [i, nome, ativo, ini, fim, texto.encode("cp1252"), exib, sexo, cen, "S", dt,
                         None, "N", horas, minutos, "S"])
    for al, op, ev in [(1, 100, 200), (1, 101, 201), (2, 100, 200), (4, 100, 200), (99, 100, 200), (13, 999, 201)]:
        ins("TBALERTA_TBOPCOES_TBEVENTOS", [al, op, ev])
    for u, al in [(A, 1), (B, 2), (C, 5)]:
        ins("TBUSERS_TBALERTA", [u, al])

    # --- cadastro complementar do usuário ---
    for emp, u, cbo in [(1, A, 50), (1, B, 51), (1, C, None), (1, D, 52), (2, A, 50)]:
        ins("TBUSUCPL", _linha("TBUSUCPL", EMPRESA=emp, USUARIO=u, ID_TBCBOPRO=cbo, COD_EMP=1, COD_FUNC=10 + emp,
                               REAUDITAR_USU="N", ALTERAR_LOCAL_CONSUMO="N", ALTERPARINTCONT_PLS="N", EXCPAC="S",
                               SENHA_SEC="naoler%d" % emp, SENHA_CAN_NF="naoler"))

    # --- exportação de documento ---
    for i, tipo, cbo, just, quando in [(1, 1, 51, 1, ts), (2, 2, 50, 1, ts), (3, None, 51, None, ts), (4, 1, 51, 1, None),
                                       (5, 1, 53, 1, ts), (6, 1, None, 1, ts), (7, 1, 51, 9, ts), (8, 1, 52, 1, ts),
                                       (9, 2, 51, 1, ts)]:
        ins("PRJUSTIF_IMP_EXPORTACAO", [i, tipo, cbo, just, quando, 9000 + i, "2025-03-10T11:30:00Z"])

    # --- cópias de registro excluído ---
    for i, u, quando in [(1, A, ts), (2, None, ts), (3, B, None)]:
        ins("CCCADCIR_EXCLUSAO", _linha("CCCADCIR_EXCLUSAO", ID=i, ID_CCCADCIR=800 + i, REG=i, DATA=ts.date(),
                                        ORDEM=1, ATEND="I", TIPO_ANES=1, CONTA=1.0, USUARIO=u,
                                        DATA_HORA_EXCLUSAO=quando, DIAG="Diagnóstico exemplo"))
    for i, pac, u in [(1, 700, C), (2, 799, A)]:
        ins("SIPACAGD_EXCLUSAO", _linha("SIPACAGD_EXCLUSAO", ID=i, NOME="Agenda exemplo", HORA="08:00", TP_AGE=1,
                                        CRM=1, DATA=ts.date(), ID_SIPACAGD=900 + i, DATA_HORA_AGENDAMENTO=ts,
                                        ID_RICADPAC=pac, USUARIO=u, DATA_HORA_EXCLUSAO=ts,
                                        PACIENTE="Paciente Ficticio"))

    # --- trilha de auditoria ---
    for i, op, atend, nivel, tipo, htp, u in [(1, 100, 5000, 1, 1, 40, A), (2, 101, None, None, 5, None, B),
                                             (3, 100, None, None, None, None, None), (4, 100, 9999, None, 2, 41, C),
                                             (5, 100, None, None, None, 49, D), (6, 100, None, None, 2, None, A)]:
        ins("TBCABTRILHA", _linha("TBCABTRILHA", ID=i, DATA_HORA_ACAO=ts + datetime.timedelta(minutes=i),
                                  ID_TBOPCOES=op, MAQUINA_USUARIO="ESTACAO-%02d" % i, ID_ATCABECATEND=atend,
                                  ID_TBNVLCRITICID=nivel, FUSO_HORARIO_LOCAL="-03:00", ID_TBTPACAOAUDIT=tipo,
                                  ID_HTPACIENTE=htp, USUARIO=u, ID_TBUSERS_TBPAPEL_LOGADO=1))
    for i, tr, msg in [(1, 1, b"Acesso fora do padrao"), (2, 1, b"Segundo alerta"), (3, 2, b"Do evento recusado"),
                       (4, 6, b"texto " * 400), (5, 77, b"Sem evento"), (6, 4, b"   ")]:
        ins("TBLANTRALERTA", [i, tr, 200, msg])
    for tr, campo, ident in [(1, "TABELA_EXEMPLO.NOME", 700), (1, "TABELA_EXEMPLO.MAE", 700),
                             (1, "TABELA_EXEMPLO.NOME", 700), (2, "TABELA_EXEMPLO.X", 1), (6, "OUTRA_EXEMPLO.ALTA", 5000)]:
        ins("TBLANTRILHASGH", [tr, campo, ident])

    # r5: tipos de OID (lidos pela referência encadeada do TBOID; provados em provas.tsv)
    for i, d in enumerate(["Política", "CPF", "CNPJ", "Nome", "Data de nascimento", "Título de eleitor",
                           "Registro no conselho", "UF do conselho", "Especialidade", "CNES"], 1):
        ins("TBTIPOOID", [i, d])
    # r5 (revisão): modo da restrição de prontuário, provado por código e rótulo (provas.tsv)
    for i, d in [(1, "Restrito"), (2, "Consentido")]:
        ins("TBTPPERM_RICADPAC", [i, d])
    # r5 (ADR 0007, 17): histórico de senhas com o resumo importado (falso: SHA-256 de textos de exemplo)
    import base64 as _b64, hashlib as _hl
    # recusas-fase2 P1a: o resumo da origem é SHA-1 (40 hex; base64 vira hex); outro formato recusa
    _h = lambda s: _hl.sha1(s.encode()).hexdigest()
    for u, s, salt in [(A, _h("exemplo-1"), "sal-1"), (B, _b64.b64encode(_hl.sha1(b"exemplo-2").digest()).decode(), None),
                       (C, "nao-e-resumo", None), ("zeca", _h("exemplo-3"), None)]:
        ins("TBHISTSENHA", [u, ts, s, salt])
    return {
        "TBHISTSENHA": {"gravados": 2, "pendencias": {"senha_hash_invalido": 1, "pai_inexistente": 1,
                                                      "restricao_destino_1048": 2}},
        "TBOID": {"gravados": 11, "pendencias": {"restricao_destino_1062": 1}},
        "TBTPMINISTCER": {"gravados": 2, "pendencias": {"restricao_destino_1048": 2, "restricao_destino_1062": 1}},
        "TBTPACAOAUDIT": {"gravados": 7, "pendencias": {"restricao_destino_1048": 1}},
        "TBUNIUSE": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 2}},
        "TBUSERCON": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}},
        "TBUSERS_TBCONVEN": {"gravados": 3, "pendencias": {"adotado_existente": 1}},
        "TBUSERSCOMPL": {"gravados": 2, "pendencias": {"adotado_existente": 1, "pai_inexistente": 1,
                                                       "restricao_destino_1048": 1}},
        "TBLOCAL_TBUSERS": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}},
        "TBUSERS_TBPAPEL": {"gravados": 5, "pendencias": {"vigencia_sem_fonte": 6, "catalogo_codigo_inexistente": 1,
                                                          "valor_fora_do_dominio": 1, "pai_inexistente": 1,
                                                          "restricao_destino_1048": 1, "adotado_existente": 1}},
        "TBALERTA": {"gravados": 12, "pendencias": {"valor_presumido": 16, "valor_fora_do_dominio": 2,
                                                    "pai_inexistente": 2, "data_sentinela": 1, "texto_resumido": 1,
                                                    "restricao_destino_4025": 1, "restricao_destino_1048": 3}},
        "TBALERTA_TBOPCOES_TBEVENTOS": {"gravados": 4, "pendencias": {"pai_pendente": 1, "pai_inexistente": 2,
                                                                      "restricao_destino_1048": 1}},
        "TBUSERS_TBALERTA": {"gravados": 2, "pendencias": {"pai_pendente": 1}},
        # recusas-fase2 P1a: a empresa vira o estabelecimento do cliente: A na empresa 2 repete o vínculo da empresa 1
        "TBUSUCPL": {"gravados": 2, "pendencias": {"vigencia_sem_fonte": 5, "pai_inexistente": 1,
                                                   "restricao_destino_4025": 2, "restricao_destino_1062": 1}},
        # recusas-fase2 P1a: login pelo profissional da inscrição (sem ambiguidade: a 2 grava); sem login, o autor
        # migrado sem profissional recusa pelo CHECK do autor (6 e 8), não mais pelo NOT NULL
        "PRJUSTIF_IMP_EXPORTACAO": {"gravados": 4, "pendencias": {
            "valor_presumido": 27, "pai_inexistente": 4, "catalogo_codigo_inexistente": 1,
            "restricao_destino_1048": 1, "restricao_destino_4025": 4}},
        "CCCADCIR_EXCLUSAO": {"gravados": 1, "pendencias": {"valor_presumido": 3, "pai_inexistente": 2,
                                                            "restricao_destino_1048": 2}},
        "SIPACAGD_EXCLUSAO": {"gravados": 2, "pendencias": {"valor_presumido": 2, "pai_inexistente": 1}},
        # R9: o tipo de ação recusado (coluna anulável) deixa a trilha 2 gravada com o tipo nulo e pai_pendente; o
        # alerta e o campo da trilha 2 gravam com ela
        "TBCABTRILHA": {"gravados": 5, "pai_pendente_gravado": 1, "pendencias": {
            "pai_pendente": 1, "pai_inexistente": 3, "restricao_destino_4025": 1}},
        "TBLANTRALERTA": {"gravados": 4, "pendencias": {"pai_inexistente": 1,
                                                        "texto_resumido": 1, "restricao_destino_1048": 2}},
        "TBLANTRILHASGH": {"gravados": 5, "pendencias": {"valor_presumido": 5}},
    }
