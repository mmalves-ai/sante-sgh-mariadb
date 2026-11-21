"""Fatia L5-01 (cadastros e administração): tabelas da origem com a forma do dicionário e dados 100% falsos.

Cobertura total: carregam 13 tabelas; FPCON, TBAGEUSE e as três TBDIGITAR* são descarte de produto
(`declarado/sem_carga.tsv`); DIPERMPS e TBCTRPRTUSU são bloqueio explícito ao dono (restrições de acesso em uso que pedem
mecanismo no motor; pedido em docs/obra/fatias/f4/saida/L5-01.json) e ficam fora desta imagem.
Anomalias: nome com espaços repetidos, código acima do tamanho do destino (codigo_derivado), colisão de caixa na
unicidade do destino, S/N inválido, vazio em coluna obrigatória do destino, pai recusado (pai_pendente), pai
inexistente, CHECK do destino, duplicidade na unicidade, segredo que nunca é gravado (segredo_aguarda_cofre), porta e
tentativas fora da faixa, mínimo de senha elevado a 8, data sentinela em termo publicado, aceite repetido,
duração guardada como hora (minutos), literal presumido (valor_presumido), letra sem par no de-para de valores,
aceite periódico exigido na origem que continua exigido no destino (período presumido) e servidor de e-mail inativo.
"""
import datetime as _dt

DDL = """
CREATE TABLE TBGRUUSU (NOME VARCHAR(50) NOT NULL PRIMARY KEY, ATIVO CHAR(1));
CREATE TABLE PREMAILMODULO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE PRTIPO_JUSTIF_EXPORTACAO (ID INTEGER NOT NULL PRIMARY KEY, JUSTIFICATIVA_EXPORTACAO VARCHAR(200));
CREATE TABLE RPMATRIZ_GUT_TIPO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(20));
CREATE TABLE RPMATRIZ_GUT_DESCRICAO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(80) NOT NULL,
  ID_RPMATRIZ_GUT_TIPO INTEGER NOT NULL, PONTO INTEGER NOT NULL);
CREATE TABLE TBCENARIO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(60) NOT NULL);
CREATE TABLE PREMAILCFG (ID SMALLINT NOT NULL PRIMARY KEY, SERVIDOR_SMTP VARCHAR(100) NOT NULL, PORTA SMALLINT NOT NULL,
  USUARIO_AUTENTICACAO VARCHAR(100), SENHA_AUTENTICACAO VARCHAR(50), CONEXAO_SSL CHAR(1),
  SENHA_CRIPTOGRAFADA VARCHAR(1));
CREATE TABLE PRLOCPACDEFAULT (ID INTEGER NOT NULL PRIMARY KEY, USUARIO VARCHAR(31) NOT NULL,
  TP_ATENDIMENTO_DEFAULT CHAR(1) NOT NULL, ZOOM_PADRAO_VISUALIZACAO_LANC SMALLINT, INICIAR_TELA_CFG_LOCAL_PAINEL CHAR(1),
  INICIAR_TELA_LOC_ACESSAR_PEP CHAR(1), PERMITE_ASSINATURA_DIGITAL CHAR(1), PERMITE_ASSINATURA_DIG_EM_LOTE CHAR(1),
  PERMITE_LANC_RETROATIVO CHAR(1) NOT NULL, PERMITE_SOMENTE_SALVAR VARCHAR(1), PERMITE_AVALIAR VARCHAR(1),
  ALERTAR_EXAMES_LIBERADOS VARCHAR(1) NOT NULL, ALERTAR_EXAMES_LIB_PERIODO TIME NOT NULL,
  ALERTAR_PEND_AVAL_PRESC_O_PROF VARCHAR(1), PERMITE_CRIAR_EXCL_PRESC_FUTURA CHAR(1), ALE_EXA_REP_D4H_CON CHAR(1) NOT NULL);
CREATE TABLE PRTERMOCAD (ID INTEGER NOT NULL PRIMARY KEY, TERMO_CONCORDANCIA_USO_PEP BLOB SUB_TYPE 1 NOT NULL,
  DATA_HORA_TERMO TIMESTAMP NOT NULL, USUARIO_INCLUSAO VARCHAR(31) NOT NULL, ATIVO CHAR(1), FUSO_HORARIO_TERMO SMALLINT,
  HORARIO_VERAO_TERMO CHAR(1), DATA_HORA_TERMO_UTC VARCHAR(30));
CREATE TABLE PRTERMOACEITE (ID INTEGER NOT NULL PRIMARY KEY, ID_PRTERMOCAD INTEGER NOT NULL,
  USUARIO_ACEITE VARCHAR(31) NOT NULL, DATA_HORA_ACEITE TIMESTAMP NOT NULL, FUSO_HORARIO_ACEITE SMALLINT,
  HORARIO_VERAO_ACEITE CHAR(1), DATA_HORA_ACEITE_UTC VARCHAR(30));
CREATE TABLE PRTPNOTIFEMAIL (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE TBCFGLOGIN (ID_TBHOSPIT SMALLINT NOT NULL PRIMARY KEY, PERIOD_TROCA_SENHA SMALLINT,
  PERIOD_REUTILIZACAO_SENHA SMALLINT, PERIOD_AVISO_EXPIRACAO_SENHA SMALLINT, QTDE_TENTATIVA_INVALIDA_BLOQ SMALLINT,
  TEMPO_MAX_INATIVO_ENC_SESSAO TIMESTAMP, DOMINIO_EMAIL VARCHAR(50), RECUPERA_SENHA_APENAS_POR_EMAIL CHAR(1),
  SOLIC_TERMO_ACEITE_PERIODICO CHAR(1) NOT NULL, QTDE_PERIODO_TERMO_ACEITE SMALLINT, TIPO_PERIODO_TERMO_ACEITE CHAR(1),
  TEMPO_AVISO_ENC_SESSAO TIMESTAMP, QTD_MINIMA_CARACTERES INTEGER, CARACTERE_ALFANUMERICO CHAR(1),
  CARACTERE_NUMERICO CHAR(1), CARACTERE_ESPECIAL CHAR(1), LETRA_MINUSCULA CHAR(1), LETRA_MAIUSCULA CHAR(1));
CREATE TABLE TBDICIONARIO_TBUSERS (USUARIO VARCHAR(31) NOT NULL, PALAVRA VARCHAR(50) NOT NULL,
  FONETICA VARCHAR(50) NOT NULL, PRIMARY KEY (USUARIO, PALAVRA));
"""

# pais de fora da fatia (L3), dados como já carregados: logins falsos e o estabelecimento 1
PAIS_EXTERNOS = {"TBUSERS": ["ana", "bia", "caio"], "TBHOSPIT": ["1"]}


def _ts(s):
    return _dt.datetime.strptime(s, "%Y-%m-%d %H:%M")


class _Hora:
    """Literal TIME do Firebird ('HH:MM:SS'): o gerador da imagem escreve str(v) dos tipos que não conhece."""

    def __init__(self, hhmm):
        self.hhmm = hhmm

    def __str__(self):
        return "'%s:00'" % self.hhmm


def _h(s):
    return _Hora(s)


def linhas(r, ins):
    # perfis: espaços repetidos (código preserva a chave: 'A   B' e 'A B' são perfis distintos; nome colapsa), código
    # acima de 30 (codigo_derivado, gravado), colisão de caixa na unicidade (1062), S/N inválido (ativo fica com o
    # padrão), ativo vazio (padrão)
    for nome, ativo in [("Faturamento", "S"), ("Recepcao central", "N"), ("Enfermagem   plantao", "S"),
                        ("Enfermagem plantao", "S"), ("Perfil de exemplo com nome bem comprido", "S"),
                        ("ADMINISTRACAO", "S"), ("Administracao", "N"), ("Laboratorio", "X"), ("Farmacia", None)]:
        ins("TBGRUUSU", [nome, ativo])
    for i, nome in [(1, "Laudo"), (2, "  Relatorio   agendado "), (3, "Convite de conta"), (4, "")]:
        ins("PREMAILMODULO", [i, nome])
    for i, j in [(1, "Pedido do paciente"), (2, "Auditoria interna"), (3, None), (4, "Justificativa longa " * 8),
                 (5, "Ordem judicial")]:
        ins("PRTIPO_JUSTIF_EXPORTACAO", [i, j])
    for i, nome in [(1, "Gravidade"), (2, "Urgencia"), (3, "Tendencia"), (4, None)]:
        ins("RPMATRIZ_GUT_TIPO", [i, nome])
    n = 0
    for tipo in (1, 2, 3):
        for ponto in range(1, 6):
            n += 1
            ins("RPMATRIZ_GUT_DESCRICAO", [n, "Grau %d da dimensao %d" % (ponto, tipo), tipo, ponto])
    ins("RPMATRIZ_GUT_DESCRICAO", [16, "Grau de dimensao recusada", 4, 1])     # pai recusado: pai_pendente
    ins("RPMATRIZ_GUT_DESCRICAO", [17, "Grau de dimensao inexistente", 9, 2])  # pai_inexistente + NOT NULL
    ins("RPMATRIZ_GUT_DESCRICAO", [18, "Grau fora da escala", 1, 7])           # CHECK 1..5
    ins("RPMATRIZ_GUT_DESCRICAO", [19, "Grau repetido", 2, 3])                 # unicidade dimensão + pontuação
    for i, nome in [(1, "Envio fiscal pendente"), (2, "Exame   atrasado")]:
        ins("TBCENARIO", [i, nome])
    # servidores de e-mail: 1 com senha (nunca gravada: segredo_aguarda_cofre), SSL ligado; 2 sem senha nem SSL
    # (nenhuma); 3 SSL inválido (valor_fora_do_dominio, fica o padrão); 4 sem usuário: remetente NOT NULL (1048)
    ins("PREMAILCFG", [1, "smtp.exemplo.test", 587, "avisos@exemplo.test", "senha-falsa", "T", "N"])
    ins("PREMAILCFG", [2, "relay.exemplo.test", 25, "relay@exemplo.test", None, None, None])
    ins("PREMAILCFG", [3, "smtp3.exemplo.test", 465, "outro@exemplo.test", None, "X", None])
    ins("PREMAILCFG", [4, "smtp4.exemplo.test", 587, None, None, "N", None])
    # preferências: 1 ok (internação, 30 min); 2 zoom fora de 50..300; 3 usuário repetido (1062); 4 login
    # inexistente (pai_inexistente + NOT NULL); 5 letra sem par no de-para e intervalo 00:00 (sem intervalo)
    for i, u, tp, zoom, alerta, per in [(1, "ana", "I", 100, "S", "00:30"), (2, "bia", "A", 400, "N", "00:15"),
                                        (3, "ana", "U", 120, "S", "01:00"), (4, "zeca", "E", 100, "N", "00:10"),
                                        (5, "caio", "Z", None, "N", "00:00")]:
        ins("PRLOCPACDEFAULT", [i, u, tp, zoom, "N", "S", "S", "N", "S", "N", "S", alerta, _h(per), "N", "N", "N"])
    # termos: 1 inativo (revogado); 2 ativo (publicado); 3 ativo com data sentinela (CHECK de publicação: 4025);
    # 4 sem situação (rascunho) com autor inexistente (pai_inexistente, NULL)
    for i, txt, quando, autor, ativo in [
            (1, "Termo de uso falso, versao um.\nLinha dois.", "2024-01-10 08:00", "ana", "F"),
            (2, "Termo de uso falso, versao dois.\n\n  Paragrafo com recuo.", "2025-03-01 09:00", "bia", "T"),
            (3, "Termo falso com data sentinela.", "1899-12-30 00:00", "ana", "T"),
            (4, "Termo falso em rascunho.", "2025-06-01 10:00", "zeca", None)]:
        ins("PRTERMOCAD", [i, txt.encode("cp1252"), _ts(quando), autor, ativo, -3, "N", None])
    # aceites: 1, 2 e 6 ok; 3 aceite repetido (1062); 4 termo recusado (pai_pendente); 5 termo inexistente
    for i, termo, u in [(1, 2, "ana"), (2, 2, "bia"), (3, 2, "ana"), (4, 3, "ana"), (5, 9, "bia"), (6, 1, "caio")]:
        ins("PRTERMOACEITE", [i, termo, u, _ts("2025-03-%02d 08:00" % (i + 1)), -3, "N", None])
    # tipos de notificação por e-mail -> finalidade_email com prefixo de domínio; vazio recusa (1048)
    for i, nome in [(1, "Exames liberados"), (2, "  Laudo   disponivel "), (3, "")]:
        ins("PRTPNOTIFEMAIL", [i, nome])
    # política: 1 tentativas 0 (fora de 1..50: padrão), mínimo 6 (elevado a 8), 20 e 2 minutos, aceite periódico
    # exigido (T, 6 meses): exigido no destino com período presumido de 30 dias (valor_presumido); 2 estabelecimento inexistente (pai_inexistente + NOT NULL)
    ins("TBCFGLOGIN", [1, 90, 180, 10, 0, _ts("1899-12-30 00:20"), "exemplo.test", "T", "T", 6, "M",
                       _ts("1899-12-30 00:02"), 6, "T", "T", "F", "F", "T"])
    ins("TBCFGLOGIN", [2, 0, None, None, 5, _ts("1899-12-30 00:30"), None, None, "F", None, None, None, 10,
                       "F", "F", "F", "F", "F"])
    # dicionário: 3 ok; colisão de caixa na unicidade (1062); login inexistente (pai_inexistente + NOT NULL)
    for u, p, f in [("ana", "hemograma", "EMGRM"), ("ana", "dipirona", "DPRN"), ("bia", "hemograma", "EMGRM"),
                    ("ana", "Dipirona", "DPRN"), ("zeca", "teste", "TST")]:
        ins("TBDICIONARIO_TBUSERS", [u, p, f])
    return {
        "TBGRUUSU": {"gravados": 8, "pendencias": {"codigo_derivado": 1, "restricao_destino_1062": 1,
                                                   "valor_fora_do_dominio": 1}},
        "PREMAILMODULO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "PRTIPO_JUSTIF_EXPORTACAO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1,
                                                                   "restricao_destino_1406": 1}},
        "RPMATRIZ_GUT_TIPO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "RPMATRIZ_GUT_DESCRICAO": {"gravados": 15, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                                  "restricao_destino_1048": 1,
                                                                  "restricao_destino_4025": 1,
                                                                  "restricao_destino_1062": 1}},
        "TBCENARIO": {"gravados": 2, "pendencias": {}},
        "PREMAILCFG": {"gravados": 3, "pendencias": {"segredo_aguarda_cofre": 1, "valor_fora_do_dominio": 1,
                                                     "restricao_destino_1048": 1}},
        "PRLOCPACDEFAULT": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 2, "restricao_destino_1062": 1,
                                                          "pai_inexistente": 1, "restricao_destino_1048": 1}},
        "PRTERMOCAD": {"gravados": 3, "pendencias": {"data_sentinela": 2, "restricao_destino_4025": 1,
                                                     "pai_inexistente": 1}},
        "PRTERMOACEITE": {"gravados": 3, "pendencias": {"restricao_destino_1062": 1, "pai_pendente": 1,
                                                        "pai_inexistente": 1, "restricao_destino_1048": 1}},
        "PRTPNOTIFEMAIL": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        "TBCFGLOGIN": {"gravados": 1, "pendencias": {"valor_presumido": 2, "valor_fora_do_dominio": 1,
                                                     "valor_elevado_ao_minimo": 1, "pai_inexistente": 1,
                                                     "restricao_destino_1048": 1}},
        "TBDICIONARIO_TBUSERS": {"gravados": 3, "pendencias": {"restricao_destino_1062": 1, "pai_inexistente": 1,
                                                               "restricao_destino_1048": 1}},
    }
