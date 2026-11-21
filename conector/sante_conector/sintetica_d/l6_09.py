"""Fatia L6-09 (prontuário, assinatura e assistência, módulo PEP): domínios do diagnóstico, da prescrição, da
interação medicamentosa e dos cuidados de enfermagem. Dados 100% falsos.

Carregadas 14 tabelas; não carregadas (declaradas sem destino, com motivo e pedido ao integrador): a gravidade da
interação (bloqueada até o de-para do nível: a imagem numera 1 = Grave, ordem oposta à severidade), a grade de horário
(bloqueada: hora HHMM em texto e tipo de atendimento sem de-para; presumir o tipo gravaria grades de escopo idêntico,
que a chave única não barra por causa do NULL), a ligação grade x unidade, os domínios "manter diagnóstico" e "situação
do lançamento", as doses e horários padrão (pai e filho juntos), os campos autopreenchidos e as vias da prescrição
digital. Elas entram na imagem para provar que nada delas é gravado.
Anomalias: pai inexistente (ação da gravidade, sexo, unidade da idade), S/N e A/I fora do domínio (padrão do destino),
grau presumido pela chave com valor_presumido (ordem oposta também),
grau acima de TINYINT (1264), tipo de resposta do parâmetro presumido (valor_presumido), nome só de espaços e descrição nula (1048), nome acima de 150 caracteres (1406),
idade sem unidade (CHECK do destino, 4025), ordem negativa (1264), situação repetida sem caixa no código único (1062),
categoria/papel/etapa/base presumidos (valor_presumido).
"""

DDL = """
CREATE TABLE TBDIGITAL_VIAACESSO (ID VARCHAR(36) NOT NULL PRIMARY KEY, CODIGO VARCHAR(30) NOT NULL,
  NOME VARCHAR(100) NOT NULL);
CREATE TABLE TBGRAUGRAVINT (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(15) NOT NULL, ATIVO CHAR(1) NOT NULL,
  ID_TBACAOGRAUGRA SMALLINT NOT NULL);
CREATE TABLE TBHORMED (ID SMALLINT NOT NULL PRIMARY KEY, TIPO_ATENDIMENTO CHAR(1) NOT NULL,
  HORARIO_INICIAL_VIGENCIA VARCHAR(4), CONSIDERAR_VIGENCIA SMALLINT, PADRAO CHAR(1), LIBERAR_VIGENCIA CHAR(1));
CREATE TABLE TBHORMED_TBUNIDAD (ID_TBUNIDAD SMALLINT NOT NULL PRIMARY KEY, ID_TBHORMED SMALLINT NOT NULL);
CREATE TABLE TBLANC_DIAG_MANTER (ID SMALLINT NOT NULL PRIMARY KEY, MANTER_DIAGNOSTICO VARCHAR(15) NOT NULL,
  DEFINICAO VARCHAR(50) NOT NULL);
CREATE TABLE TBLANC_DIAG_STATUS (ID SMALLINT NOT NULL PRIMARY KEY, STATUS VARCHAR(20) NOT NULL);
CREATE TABLE TBLANC_DIAG_SUJ_CUID (ID SMALLINT NOT NULL PRIMARY KEY, SUJEITO_CUIDADO VARCHAR(15) NOT NULL);
CREATE TABLE TBLISTADIAGNOSTICOESTADO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL,
  ATIVO VARCHAR(1) NOT NULL);
CREATE TABLE TBLISTADIAGNOSTICOSITUACAO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL,
  ATIVO VARCHAR(1) NOT NULL);
CREATE TABLE TBLISTADIAGNOSTICOTIPO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL,
  ATIVO VARCHAR(1) NOT NULL);
CREATE TABLE TBLISTAPROBLEMACLASSIF (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL,
  ATIVO CHAR(1) NOT NULL);
CREATE TABLE TBMODALIDADE_ASSIST (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ATIVO CHAR(1));
CREATE TABLE TBMOTIVOMP (ID_TBMOTIVOMP INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(45), ATIVO VARCHAR(1));
CREATE TABLE TBNUMDOSE (ID SMALLINT NOT NULL PRIMARY KEY, ID_TBHORMED SMALLINT NOT NULL, NUM_DOSE SMALLINT NOT NULL);
CREATE TABLE TBHORARIODOSE (ID_TBNUMDOSE SMALLINT NOT NULL, ORDEM SMALLINT NOT NULL, HORARIO VARCHAR(4) NOT NULL,
  PRIMARY KEY (ID_TBNUMDOSE, ORDEM));
CREATE TABLE TBPRINC_VALIDACAO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ATIVO CHAR(1));
CREATE TABLE TBPROBOCINTMED (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40) NOT NULL, ATIVO CHAR(1) NOT NULL);
CREATE TABLE TBPROENF (COD INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(200), SITUACAO VARCHAR(1), TIPO CHAR(1),
  TIPO_PRESCRICAO SMALLINT, ID_TBSEXO INTEGER, IDADEI DOUBLE PRECISION, IDADEF DOUBLE PRECISION,
  ID_PRTIPONOTIFICACAOIDADE INTEGER, ID_TBUNID_IDADE_MIN SMALLINT, ID_TBUNID_IDADE_MAX SMALLINT,
  ID_PRTIPONOTIFICACAOSEXO INTEGER, EXIBIR_FICHA_ANEST CHAR(1) NOT NULL, ORDEM_FICHA_ANEST SMALLINT NOT NULL);
CREATE TABLE PRSINAIS (COD INTEGER NOT NULL, PROCTO INTEGER NOT NULL, NOME VARCHAR(50), ID_SINAIS INTEGER NOT NULL
  PRIMARY KEY, PREVIAMENTE_MARCADO_LANCAMENTO CHAR(1), SIGLA VARCHAR(7), TIPO_RESPOSTA SMALLINT,
  ID_PRUNIDRESPOSTA SMALLINT, ATIVO CHAR(1));
CREATE TABLE TBREFERENCIA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ATIVO CHAR(1));
CREATE TABLE TBSITUACAOMP (ID_TBSITUACAOMP INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(45), ICONE BLOB,
  ORDEM SMALLINT, ATIVO VARCHAR(1), NEC_SENHA_ORDEM VARCHAR(1), ID_TBSITAGE VARCHAR(2),
  PERMITIR_ALT_SESSAO_SIT_PEXT CHAR(1));
CREATE TABLE TBSTATUSPROCEDIMENTO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ATIVO CHAR(1));
CREATE TABLE TBTABELA_CAMPO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
"""
PAIS_EXTERNOS = {"TBACAOGRAUGRA": ["1", "2", "3"], "TBSEXO": ["1", "2"], "TBUNID_IDADE": ["1", "2"]}
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL);\nINSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');")

NAO_CARREGADAS = ["TBDIGITAL_VIAACESSO", "TBGRAUGRAVINT", "TBHORMED", "TBHORMED_TBUNIDAD", "TBLANC_DIAG_STATUS", "TBLANC_DIAG_MANTER", "TBNUMDOSE", "TBHORARIODOSE",
                  "TBTABELA_CAMPO"]


def linhas(r, ins):
    for i in range(1, 5):
        ins("TBDIGITAL_VIAACESSO", ["00000000-0000-4000-8000-%012d" % i, "VIA%02d" % i, "Via exemplo %d" % i])
        ins("TBNUMDOSE", [i, 1, i])
        for o in range(1, i + 1):
            ins("TBHORARIODOSE", [i, o, "%02d00" % (6 + o * 4)])
        ins("TBTABELA_CAMPO", [i, "Campo exemplo %d" % i])
    ins("TBHORMED_TBUNIDAD", [1, 1])
    ins("TBLANC_DIAG_MANTER", [1, "Sim", "Mantém no próximo atendimento"])
    # gravidade (bloqueada): a chave numera 1 = Grave, oposta à severidade; nada é gravado
    for g in [(1, "Grave", "S", 1), (2, "  Moderada  ", "S", 2), (3, "Leve", "N", 3), (4, "Grau inativo", "X", 1),
              (5, "Sem ação", "S", 99), (300, "Grau alto", "S", 2), (6, "   ", "S", 1)]:
        ins("TBGRAUGRAVINT", list(g))
    # grade (bloqueada): tipos I, U, A e duas de internação; nenhuma é gravada, logo nenhum escopo repetido
    for h in [(1, "I", "0700", 1, "S", "N"), (2, "U", "0000", 0, "N", "S"), (3, "A", None, 1, None, None),
              (4, "I", "0600", 1, "N", "N")]:
        ins("TBHORMED", list(h))
    for s in [(1, "Ativo"), (2, "Resolvido"), (3, "  Em   observação "), (4, "Descartado"), (5, "ATIVO")]:
        ins("TBLANC_DIAG_STATUS", list(s))           # não carregada
    for i, a in enumerate("SNSXS", 1):
        ins("TBLISTADIAGNOSTICOSITUACAO", [i, "Situação exemplo %d" % i, a])
    for s in [(1, "Paciente"), (2, "Feto"), (3, "   ")]:
        ins("TBLANC_DIAG_SUJ_CUID", list(s))
    for e in [(1, "Confirmado", "S"), (2, "Suspeito", "S"), (256, "Grau fora", "S")]:  # chave oposta à certeza
        ins("TBLISTADIAGNOSTICOESTADO", list(e))
    for t in [(1, "Principal", "S"), (2, "Secundário", "N")]:
        ins("TBLISTADIAGNOSTICOTIPO", list(t))
    for c in [(1, "Problema clínico", "S"), (2, "Risco", "N"), (3, "Condição", " ")]:
        ins("TBLISTAPROBLEMACLASSIF", list(c))
    for m in [(1, "Internação", "S"), (2, "Hospital-dia", None), (3, "Domiciliar", "N")]:
        ins("TBMODALIDADE_ASSIST", list(m))
    for m in [(1, "Suspenso a pedido", "S"), (2, None, "S"), (3, "Erro de prescrição", None)]:
        ins("TBMOTIVOMP", list(m))
    for p in [(1, "Por quilo", "S"), (2, "Por metro quadrado", "S"), (3, "Dose fixa", None)]:
        ins("TBPRINC_VALIDACAO", list(p))
    for p in [(1, "Estabelecida", "S"), (2, "Provável", "N")]:
        ins("TBPROBOCINTMED", list(p))
    for i in range(1, 11):
        nome, sit, sexo, imin, umin, imax, umax, exib, ordem = ("Cuidado exemplo %d" % i, "A" if i % 3 else "I",
                                                                 1 + i % 2, None, None, None, None, "N", 0)
        if i == 2:
            sexo = 9                                   # pai inexistente: NULL com pendência
        if i == 3:
            nome = "Cuidado " + "longo " * 26          # acima de 150: restricao_destino_1406
        if i == 4:
            nome = None                                # NOT NULL: restricao_destino_1048
        if i == 5:
            imin, umin, imax, umax = 18.0, 1, 65.0, 2
        if i == 6:
            imin = 12.0                                # sem unidade: CHECK do destino (4025)
        if i == 7:
            sit = "X"                                  # fora do domínio A/I: padrão do destino
        if i == 8:
            exib, ordem = "S", 3
        if i == 9:
            ordem = -1                                 # SMALLINT UNSIGNED: restricao_destino_1264
        if i == 10:
            umax = 7                                   # pai inexistente
        ins("TBPROENF", [i, nome, sit, "C", 1, sexo, imin, imax, None, umin, umax, None, exib, ordem])
    for s in [(1, 10, "Pressão arterial", 1, "S", "PA", 1, None, "S"), (2, 11, "Temperatura", 2, "N", "TAX", 2, None, "S"),
              (3, 12, None, 3, None, None, None, None, "N")]:
        ins("PRSINAIS", list(s))
    for t in [(1, "Por dose", "S"), (2, "Por dia", "N")]:
        ins("TBREFERENCIA", list(t))
    for s in [(1, "Liberada", b"\x89PNG\r\n\x1a\n\x00\xff", 1, "S"), (2, "Suspensa", None, 2, "S"),
              (3, "  Cancelada  ", None, 3, "N"), (4, None, None, 4, "S"), (5, "Ordem negativa", None, -2, "S")]:
        ins("TBSITUACAOMP", list(s) + ["N", None, None])
    for s in [(1, "Pedido", "S"), (2, "Coletado", "S"), (3, "Realizado", None), (4, "pedido", "S")]:
        ins("TBSTATUSPROCEDIMENTO", list(s))
    return {
        "TBLISTADIAGNOSTICOSITUACAO": {"gravados": 5, "pendencias": {"valor_presumido": 10,
                                                                     "valor_fora_do_dominio": 1}},
        "TBLANC_DIAG_SUJ_CUID": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        "TBLISTADIAGNOSTICOESTADO": {"gravados": 2, "pendencias": {"valor_presumido": 3,
                                                                   "restricao_destino_1264": 1}},
        "TBLISTADIAGNOSTICOTIPO": {"gravados": 2, "pendencias": {"valor_presumido": 2}},
        "TBLISTAPROBLEMACLASSIF": {"gravados": 3, "pendencias": {}},
        "TBMODALIDADE_ASSIST": {"gravados": 3, "pendencias": {}},
        "TBMOTIVOMP": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        "TBPRINC_VALIDACAO": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
        "TBPROBOCINTMED": {"gravados": 2, "pendencias": {}},
        "TBPROENF": {"gravados": 6, "pendencias": {"pai_inexistente": 2, "valor_fora_do_dominio": 1,
                                                   "restricao_destino_1406": 1, "restricao_destino_1048": 1,
                                                   "restricao_destino_4025": 1, "restricao_destino_1264": 1}},
        "PRSINAIS": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "TBREFERENCIA": {"gravados": 2, "pendencias": {"valor_presumido": 2}},
        "TBSITUACAOMP": {"gravados": 3, "pendencias": {"valor_presumido": 5, "restricao_destino_1048": 1,
                                                       "restricao_destino_1264": 1}},
        "TBSTATUSPROCEDIMENTO": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1062": 1}},
    }
