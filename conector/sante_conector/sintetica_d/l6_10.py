"""Fatia L6-10 (prontuário, assinatura e assistência, módulo PEP): tabelas de domínio da origem, dados 100% falsos.

Carregadas (21): tipos de encaminhamento, de alergia, de interação, de parto e de recém-nascido (os dois últimos
INATIVOS até a revisão do campo de segurança presumido); autoridades, periodicidades e modalidades de notificação;
ações do alerta de alergia (presumido o mais restritivo) e a gravidade de cada uma (complemento da ação, pelo NOME da
gravidade lido na origem); alergenos; formas de validar interação; bloco de internação da grade de horário (complemento
da grade); variáveis do cálculo de dose; unidades de medida (dois destinos: unidade de prescrição e de resultado);
variáveis de escala clínica e as respostas pontuadas (opções e faixas); unidades por tipo de validação de dose e por
tipo de item da prescrição (a primeira com carga PARCIAL: a unidade casa pela sigla de integração; a segunda adota
ou cria a unidade de prescrição pelo código da unidade de estoque, como a L6-11); as seções do sumário de alta (uma
linha da origem em até 4 seções, pelo desdobrar no principal; recorte e modelo por seção pedem referência no item). O bloco
da grade grava uma CÓPIA da grade por bloco (dois blocos na mesma grade: duas cópias, nenhuma sobrescrita).
Descartada (1): o banco global de perguntas (duplicado: o campo do modelo, PRPADEVOL da L6-11, lê título, tipo,
unidade, texto padrão e situação da pergunta pela encadeada); entra na imagem para provar que não gera carga. As opções de resposta (PRRESPOSTA) passaram à L6-11.
REQUER a L6-08: a gravidade (TBCBARASEVERIDADE) é lida na origem pela referência encadeada, e a categoria do
tipo de alergia (TBCLASSIFALERGIA) vem carregada dela; tipo de alergia e alergeno dividem cadastro com a L6-08
(códigos com prefixo de domínio).
O literal presumido deixa valor_presumido em toda linha avaliada (inclusive a recusada pela restrição do destino;
não na recusada por pai_pendente). Na tabela de dois destinos, a pendência de coluna vale por destino.
Anomalias: descrição vazia ou só espaços em destino NOT NULL, espaços repetidos, CP1252 acentuado, S/N e A/I fora do
domínio, referência zero (ausência), pai recusado (pai_pendente), pai inexistente (nulo com pendência; em NOT NULL
recusa), identificador repetido na mesma escala (único), faixa invertida (CHECK), símbolo maior que o destino de um
só dos dois destinos, pontos nulos (padrão do destino), nome de gravidade sem par e literais presumidos.
"""
import decimal

DDL = """
CREATE TABLE TBTABENC (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40));
CREATE TABLE TBTPALERGIA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(100) NOT NULL, ID_TBCLASSIFALERGIA SMALLINT NOT NULL);
CREATE TABLE TBTPAUTORIDADE (ID SMALLINT NOT NULL PRIMARY KEY, SIGLA VARCHAR(5), DESCRICAO VARCHAR(255));
CREATE TABLE TBTPINTMED (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ATIVO CHAR(1) NOT NULL);
CREATE TABLE TBTPNOTAGRAVO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE TBTPNOTIFCID10 (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE TBTPNOTIFICACAOALERGIA (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(80) NOT NULL);
CREATE TABLE TBALERGIA (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(60) NOT NULL, ATIVO CHAR(1), ID_TBTPALERGIA SMALLINT,
  ID_TBTPNOTIFICACAOALERGIA INTEGER);
CREATE TABLE TBCBARANOTIFICACAO (ID INTEGER NOT NULL PRIMARY KEY, ID_TBCBARASEVERIDADE SMALLINT NOT NULL,
  ID_TBTPNOTIFICACAOALERGIA INTEGER NOT NULL);
CREATE TABLE TBTPPARTO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE TBTPRN (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE TBTPSITUACAOMP (ID_TBTPSITUACAOMP INTEGER NOT NULL PRIMARY KEY, ID_TBSITUACAOMP INTEGER NOT NULL,
  PROCESSO SMALLINT NOT NULL, MODULO SMALLINT NOT NULL, NEC_SENHA SMALLINT, SENHA_MASTER VARCHAR(1),
  SENHA_USUARIO VARCHAR(1), NEC_MOTIVO VARCHAR(1));
CREATE TABLE TBTPVALIDINTERACAO (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(20) NOT NULL);
CREATE TABLE TBHORMED_RIBLOCOS (ID_RIBLOCOS VARCHAR(5) NOT NULL PRIMARY KEY, ID_TBHORMED SMALLINT NOT NULL);
CREATE TABLE PRPARVARCAD (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40) NOT NULL, ID_PRPARVARUNIRESP SMALLINT NOT NULL);
CREATE TABLE TBUNIDADEMEDIDA (ID INTEGER NOT NULL PRIMARY KEY, ID_TBGRUPOUNIDADEMEDIDA INTEGER NOT NULL, NOME VARCHAR(50),
  SIGLA_API VARCHAR(30), SIMBOLO VARCHAR(30), SITUACAO CHAR(1) NOT NULL);
CREATE TABLE PRINDICEVARIAVEL (ID INTEGER NOT NULL PRIMARY KEY, ID_PRINDICEAGRUPAMENTO INTEGER, SIGLA_VARIAVEL VARCHAR(20),
  NOME_VARIAVEL VARCHAR(50), ID_TBUNIDADEMEDIDA INTEGER, PONTUACAO_CATEGORIA DOUBLE PRECISION,
  TITULO_CATEGORIA SMALLINT, INDICE_CATEGORIA SMALLINT);
CREATE TABLE PRGLASGOW (ID SMALLINT NOT NULL PRIMARY KEY, ID_PRINDICEVARIAVEL INTEGER NOT NULL, NOME VARCHAR(30) NOT NULL,
  PONTUACAO SMALLINT, INDICE_REFERENCIA INTEGER);
CREATE TABLE PRINDICEPONTUACAO (ID INTEGER NOT NULL PRIMARY KEY, ID_PRINDICEVARIAVEL INTEGER NOT NULL,
  PONTUACAO NUMERIC(9,3), VALOR_REF_INI NUMERIC(9,3), VALOR_REF_FIN NUMERIC(9,3));
CREATE TABLE PRPERGUNTA (ID INTEGER NOT NULL PRIMARY KEY, COD_PERGUNTA INTEGER NOT NULL, COLUNA SMALLINT NOT NULL,
  DESCRICAO VARCHAR(100), TIPOPERG VARCHAR(2), UNIDPERG VARCHAR(10), CONTEVOL BLOB SUB_TYPE 1, ATIVO CHAR(1),
  MANTERHIST SMALLINT, ALTURA_COMPONENTE INTEGER, LARGURA_COMPONENTE INTEGER, ID_TBUNIDADEMEDIDA INTEGER);
CREATE TABLE PRPARAMSUMARIOALTA (ID SMALLINT NOT NULL PRIMARY KEY, ID_PRTPATEND SMALLINT NOT NULL,
  ID_PROPCAOPERIODO_PROC SMALLINT NOT NULL, ID_PROPCAOPERIODO_EXA SMALLINT NOT NULL, ID_PRPERGUNTA_EVOL_CLIN INTEGER,
  ID_PRPERGUNTA_PLANO INTEGER);
CREATE TABLE TBUNIDMEDIDA_PRINC_VALID (ID SMALLINT NOT NULL PRIMARY KEY, ID_TBPRINC_VALIDACAO SMALLINT NOT NULL,
  ID_TBUNIDADEMEDIDA INTEGER NOT NULL);
CREATE TABLE PRUNITPLAN (TPLAN VARCHAR(2) NOT NULL, UNI_PRESC VARCHAR(7) NOT NULL, PRIMARY KEY (TPLAN, UNI_PRESC));
"""
REQUER = ["L6-08"]
# o preparo da L6-08 (vias de uso com o identificador da prescrição digital, alvo do cod: de TBDIGITAL_VIAACESSO)
# roda antes do desta fatia
PREPARO_DOS_REQUERIDOS = True
PAIS_EXTERNOS = {"PRINDICEAGRUPAMENTO": ["1", "2"],
                 "TBHORMED": ["1", "2", "3"], "RIBLOCOS": ["A", "B"], "PRPARVARUNIRESP": ["1", "2"],
                 "PRTPLAN": ["1", "2"], "TBPRINC_VALIDACAO": ["1", "2"], "TBUNICON": ["MG", "ML"],
                 "TBSITUACAOMP": ["1", "2", "3"]}


def _externos():
    """Pais externos como a conferência os junta: os das fatias requeridas antes, depois os desta, sem repetição."""
    from sante_conector import sintetica
    tudo = {}
    for m in [sintetica.modulo_fatia(f) for f in REQUER] + [None]:
        for t, ks in (getattr(m, "PAIS_EXTERNOS", {}) if m else PAIS_EXTERNOS).items():
            tudo.setdefault(t, [])
            tudo[t] += [str(k) for k in ks if str(k) not in tudo[t]]
    return tudo


def _id_externo(tabela, chave):
    """id de destino que a conferência dá ao pai externo (ordem das tabelas e das chaves de PAIS_EXTERNOS)."""
    i, ext = 0, _externos()
    for t in sorted(ext):
        for k in ext[t]:
            i += 1
            if (t, k) == (tabela, chave):
                return i
    raise KeyError((tabela, chave))


# a grade copiada por bloco (TBHORMED_RIBLOCOS) já existe no destino com o id que a conferência dá ao pai externo
PREPARO_DESTINO = "".join(
    "INSERT INTO grade_horario_unidade (id, estabelecimento_id, tipo_atendimento, hora_inicio_dia, criado_em)"
    " VALUES (%d, 1, 'internacao', '07:00:00', UTC_TIMESTAMP(3));\n" % _id_externo("TBHORMED", k)
    for k in PAIS_EXTERNOS["TBHORMED"]) + "".join(
    # a unidade de medida que TBUNICON (L7-07) gravou: PRUNITPLAN copia a descrição dela (ref:TBUNICON@descricao);
    # forma mínima (a tabela é de outro módulo e não vem com o destino da fatia)
    ["CREATE TABLE IF NOT EXISTS unidade_medida (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
     " codigo VARCHAR(30) NOT NULL UNIQUE, descricao VARCHAR(150) NOT NULL, sigla VARCHAR(10) NOT NULL,"
     " criado_em DATETIME(3) NOT NULL);\n"] + [
    "INSERT IGNORE INTO unidade_medida (id, codigo, descricao, sigla, criado_em)"
    " VALUES (%d, '%s', 'Unidade externa %s', '%s', UTC_TIMESTAMP(3));\n" % (_id_externo("TBUNICON", k), k, k, k)
    for k in PAIS_EXTERNOS["TBUNICON"]])

CARREGADAS = ("TBTABENC", "TBTPALERGIA", "TBTPAUTORIDADE", "TBTPINTMED", "TBTPNOTAGRAVO", "TBTPNOTIFCID10",
              "TBTPNOTIFICACAOALERGIA", "TBALERGIA", "TBTPPARTO", "TBTPRN", "TBTPVALIDINTERACAO", "TBUNIDADEMEDIDA",
              "PRINDICEVARIAVEL", "PRGLASGOW", "PRINDICEPONTUACAO", "TBCBARANOTIFICACAO",
              "TBHORMED_RIBLOCOS", "PRPARVARCAD", "TBUNIDMEDIDA_PRINC_VALID", "PRUNITPLAN", "TBTPSITUACAOMP",
              "PRPARAMSUMARIOALTA", "PRPERGUNTA")
# rodada 5 (ADR 0006): PRPERGUNTA carrega (banco de perguntas como campos do modelo BANCO_PERGUNTAS_MIGRACAO)
DESCARTADAS = ()
BLOQUEADAS = ()

D = decimal.Decimal


def linhas(r, ins):
    def varias(t, rs):
        for x in rs:
            ins(t, list(x))
    # tipos de encaminhamento: 3 sem nome (NOT NULL no destino)
    varias("TBTABENC", [(1, "Interno"), (2, "  Externo   ao  hospital "), (3, None)])
    # tipos de alergia: 3 com categoria inexistente (nula com pendência); 4 só espaços (recusa)
    varias("TBTPALERGIA", [(1, "Alergia", 1), (2, "Intolerância", 2), (3, "Reação adversa", 9), (4, "   ", 1),
                           (5, "Efeito  adverso", 1)])
    varias("TBTPAUTORIDADE", [(1, "SMS", "Secretaria municipal"), (2, "SES", "Secretaria estadual"),
                              (3, "MS", None), (4, "ANVIS", "  Agência   sanitária ")])
    varias("TBTPINTMED", [(1, "Medicamento", "S"), (2, "Alimento", "N"), (3, "Exame", "X")])
    varias("TBTPNOTAGRAVO", [(1, "Imediata"), (2, "Semanal"), (3, "Imediata")])
    varias("TBTPNOTIFCID10", [(1, "Individual"), (2, "  Surto   "), (3, "Negativa"), (4, "Investigação")])
    varias("TBTPNOTIFICACAOALERGIA", [(1, "Avisar"), (2, "Bloquear"), (3, "Exigir justificativa")])
    # alergenos: 4 ativo nulo; 5 S/N inválido; 6 tipo recusado (pai_pendente); 7 tipo inexistente; 8 sem nome;
    # 9 referências zero (ausência, sem pendência)
    varias("TBALERGIA", [(1, "Dipirona", "S", 1, 1), (2, "Amendoim", "S", 2, 2), (3, "Látex", "N", 5, 3),
                         (4, "Iodo   contraste", None, 1, None), (5, "Pó doméstico", "X", None, 1),
                         (6, "Penicilina", "S", 4, 1), (7, "Camarão", "S", 9, 1), (8, "  ", "S", 1, 1),
                         (9, "Sulfa", "S", 0, 0)])
    # gravidade da ação (complemento) pelo NOME da gravidade da L6-08 (1 Grave, 2 LEVE, 4 nome sem par): 2 nome sem
    # par (NULL, valor_fora_do_dominio); 3 gravidade inexistente (NULL, pai_inexistente); 4 ação inexistente (recusa)
    varias("TBCBARANOTIFICACAO", [(1, 1, 1), (2, 4, 2), (3, 7, 3), (4, 2, 9)])
    varias("TBTPPARTO", [(1, "Normal"), (2, "Cesárea"), (3, "Fórceps"), (4, " ")])
    varias("TBTPRN", [(1, "Vivo"), (2, "Natimorto"), (3, "Vivo  com  anomalia")])
    # regras de situação (qualquer origem = verdadeiro, origem nula; processo presumido): 3 marcações nulas (padrão
    # falso); 4 motivo fora do domínio S/N (padrão, pendência); 5 situação inexistente (NOT NULL: recusa)
    varias("TBTPSITUACAOMP", [(1, 1, 1, 1, 0, "N", "N", "N"), (2, 2, 2, 1, 1, "S", "N", "S"),
                              (3, 3, 3, 2, None, None, None, None), (4, 1, 4, 1, 1, "N", "N", "X"),
                              (5, 9, 1, 1, 0, "N", "N", "N")])
    varias("TBTPVALIDINTERACAO", [(1, "Princípio ativo"), (2, "Classe terapêutica")])
    # cópia da grade por bloco: A e B na MESMA grade 1 (duas cópias, nenhuma sobrescrita); Z bloco inexistente (cópia
    # com bloco NULL e pai_inexistente); C grade e bloco inexistentes (estabelecimento NOT NULL: recusa)
    varias("TBHORMED_RIBLOCOS", [("A", 1), ("B", 1), ("Z", 2), ("C", 9)])
    # variáveis de dose: 3 unidade inexistente (NOT NULL: recusa); 4 sem nome (recusa)
    varias("PRPARVARCAD", [(1, "Peso", 1), (2, "Altura", 2), (3, "Superfície  corporal", 3), (4, "  ", 1)])
    # unidades: 3 sem nome (recusa nos dois destinos); 5 símbolo cabe no resultado (30) e não na prescrição (10);
    # 6 situação fora do domínio A/I
    varias("TBUNIDADEMEDIDA", [(1, 10, "Miligrama", "MG", "mg", "A"), (2, 10, "Mililitro", "ML", "mL", "A"),
                               (3, 10, None, "X", "x", "A"), (4, 11, "Unidade  internacional", "UI", "UI", "I"),
                               (5, 12, "Microgramas por quilo por minuto", "MCGKGMIN", "microgramas/kg/min", "A"),
                               (6, 11, "Gotas", "GT", "gt", "X")])
    # variáveis: 6 sem escala; 7 escala inexistente (nula: recusa); 8 sem sigla; 9 sigla repetida na escala 1
    varias("PRINDICEVARIAVEL", [
        (1, 1, "AO", "Abertura ocular", None, None, 0, 1), (2, 1, "RV", "Resposta verbal", None, None, 0, 2),
        (3, 1, "RM", "Resposta  motora", None, None, 0, 3), (4, 2, "FC", "Frequência cardíaca", 1, 1.5, 1, 1),
        (5, 2, "TEMP", "Temperatura", 2, None, 0, 2), (6, None, "X", "Sem escala", None, None, 0, 0),
        (7, 9, "Y", "Escala inexistente", None, None, 0, 0), (8, 2, None, "Sem sigla", None, None, 0, 0),
        (9, 1, "AO", "Abertura repetida", None, None, 0, 4)])
    # opções pontuadas: 6 pontos nulos (padrão 0); 8 variável recusada (pai_pendente); 9 só espaços (recusa)
    varias("PRGLASGOW", [(1, 1, "Espontânea", 4, 1), (2, 1, "Ao som", 3, 1), (3, 1, "À dor", 2, 1),
                         (4, 1, "Nenhuma", 1, 1), (5, 2, "Orientado", 5, 2), (6, 2, "Confuso", None, 2),
                         (7, 3, "Obedece", 6, 3), (8, 6, "Pai recusado", 1, 0), (9, 3, "   ", 1, 0)])
    # faixas: 7 pontos nulos (padrão 0); 8 faixa invertida (CHECK); 9 variável recusada; 10 variável inexistente
    varias("PRINDICEPONTUACAO", [
        (1, 4, D("0"), D("60"), D("100")), (2, 4, D("1"), D("101"), D("110")), (3, 4, D("2"), D("111"), D("130")),
        (4, 4, D("3"), D("131"), D("999")), (5, 5, D("0"), D("36"), D("38")), (6, 5, D("1.5"), D("38.1"), D("39")),
        (7, 5, None, D("39.1"), D("42")), (8, 5, D("1"), D("40"), D("35")), (9, 7, D("1"), D("1"), D("2")),
        (10, 99, D("1"), D("1"), D("2"))])
    # banco de perguntas (campos do modelo BANCO_PERGUNTAS_MIGRACAO): 1 decimal com unidade (criada), 2 inativa com
    # reuso (a situação fica no retrato; nunca excluída na data da carga), 3 mesma unidade (adotada), 4 tipo sem par
    # (texto presumido, visível), 5 sem título (título presumido, visível): todas carregam (ADR 0007, 18)
    varias("PRPERGUNTA", [(1, 101, 1, "Pergunta exemplo 1", "6", "mmHg", b"texto da pergunta 1", "S", 0, 20, 200, None),
                          (2, 102, 1, "Pergunta exemplo 2", "13", None, None, "N", 1, None, None, 3),
                          (3, 103, 2, "Pergunta exemplo 3", "7", "mmHg", None, "S", None, 20, 200, None),
                          (4, 104, 1, "Pergunta exemplo 4", "TX", None, None, "S", 0, None, None, None),
                          (5, 105, 1, None, "1", None, None, "S", 0, None, None, None)])
    # seções do sumário de alta (ID, tipo de atendimento, período de procedimentos, de exames, pergunta da evolução,
    # do plano): 1 internação, 3 seções; 2 ambulatório, 3 seções (sem evolução); 3 tipo 4 'nenhum' (fora do domínio:
    # fica 'todos') e período 3 'últimas 48 h' (fora do domínio: NULL), exames com período 0 (a seção existe), 2 seções
    varias("PRPARAMSUMARIOALTA", [(1, 2, 1, 2, 7, None), (2, 1, 2, 2, None, 8), (3, 4, 3, 0, None, None)])
    # unidades por validação: 3 sigla sem unidade de medida; 4 validação inexistente; 6 par repetido (único)
    varias("TBUNIDMEDIDA_PRINC_VALID", [(1, 1, 1), (2, 1, 2), (3, 2, 4), (4, 9, 1), (5, 2, 1), (6, 1, 1)])
    # unidades por tipo de item (unidade de prescrição adotada ou criada pelo código de TBUNICON): MG criada e adotada
    # na 4a linha; X e ZZ códigos sem unidade de estoque (descrição NOT NULL: recusa); tipo 9 inexistente (recusa)
    varias("PRUNITPLAN", [("1", "MG"), ("2", "ML"), ("1", "X"), ("9", "MG"), ("2", "ZZ")])
    return {
        "PRPERGUNTA": {"gravados": 5, "pendencias": {"adotado_existente": 13, "valor_presumido": 2,
                                                    "valor_fora_do_dominio": 2}},
        "TBTABENC": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "TBTPALERGIA": {"gravados": 4, "pendencias": {"valor_presumido": 5, "pai_inexistente": 1,
                                                      "restricao_destino_1048": 1}},
        "TBTPAUTORIDADE": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
        "TBTPINTMED": {"gravados": 3, "pendencias": {"valor_presumido": 3, "valor_fora_do_dominio": 1}},
        "TBTPNOTAGRAVO": {"gravados": 3, "pendencias": {}},
        "TBTPNOTIFCID10": {"gravados": 4, "pendencias": {}},
        "TBTPNOTIFICACAOALERGIA": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
        "TBALERGIA": {"gravados": 7, "pendencias": {"valor_presumido": 8, "valor_fora_do_dominio": 1,
                                                    "pai_pendente": 1, "pai_inexistente": 1,
                                                    "restricao_destino_1048": 1}},
        "TBTPPARTO": {"gravados": 3, "pendencias": {"valor_presumido": 8, "restricao_destino_1048": 1}},
        "TBTPRN": {"gravados": 3, "pendencias": {"valor_presumido": 6}},
        "TBTPSITUACAOMP": {"gravados": 4, "pendencias": {"valor_presumido": 5, "valor_fora_do_dominio": 1,
                                                         "pai_inexistente": 1, "restricao_destino_1048": 1}},
        "TBTPVALIDINTERACAO": {"gravados": 2, "pendencias": {"valor_presumido": 2}},
        "TBUNIDADEMEDIDA": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1406": 1,
                                                          "valor_fora_do_dominio": 2}},
        "PRINDICEVARIAVEL": {"gravados": 5, "pendencias": {"valor_presumido": 9, "pai_inexistente": 1,
                                                           "restricao_destino_1048": 3,
                                                           "restricao_destino_1062": 1}},
        "PRGLASGOW": {"gravados": 7, "pendencias": {"pai_pendente": 1, "restricao_destino_1048": 1}},
        "TBCBARANOTIFICACAO": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "pai_inexistente": 2}},
        # Z: 1 pai_inexistente (bloco); C: 5 (grade, uma por coluna copiada) + 1 (bloco) e a recusa (NOT NULL)
        "TBHORMED_RIBLOCOS": {"gravados": 3, "pendencias": {"pai_inexistente": 7, "restricao_destino_1048": 1}},
        "PRPARVARCAD": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 2}},
        "TBUNIDMEDIDA_PRINC_VALID": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 2,
                                                                   "restricao_destino_1062": 1}},
        "PRUNITPLAN": {"gravados": 2, "pendencias": {"pai_inexistente": 5, "restricao_destino_1048": 3}},
        # 8 seções (itens) de 3 linhas; tipo 4 e período 3 sem par no domínio
        "PRPARAMSUMARIOALTA": {"gravados": 8, "pendencias": {"valor_fora_do_dominio": 2}},
        "PRINDICEPONTUACAO": {"gravados": 7, "pendencias": {"valor_presumido": 9, "restricao_destino_4025": 1, "pai_pendente": 1,
                                                            "pai_inexistente": 1, "restricao_destino_1048": 1}},
    }
