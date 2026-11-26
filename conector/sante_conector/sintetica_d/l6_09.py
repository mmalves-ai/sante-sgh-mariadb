"""Fatia L6-09 (prontuário, assinatura e assistência, módulo PEP): domínios do diagnóstico, da prescrição, da
interação medicamentosa, da grade de horários e dos cuidados de enfermagem. Dados 100% falsos.

Cobertura: 18 tabelas carregadas (TBHORMED_TBUNIDAD grava uma CÓPIA da grade por unidade assistencial: a grade 1
tem duas unidades e as duas ligações ficam);
4 descartadas com motivo de produto (`declarado/sem_carga.tsv`): ficam na imagem para provar que nada delas é gravado
como linha. Requer a L6-08
(TBACAOGRAUGRA e PRUNIDRESPOSTA, lidas pela referência encadeada ao nome).
Comportamento das listas pelo NOME (de-para de valores, nunca pela ordem da chave nem presumido): categoria e
clinicamente ativo da situação do problema, grau e confirmado da certeza, papel do tipo de diagnóstico, base da
validação e da referência da dose (com a unidade da base), categoria/vigente/final da situação da prescrição,
etapa/final da situação do procedimento, nível da gravidade e ação da gravidade; nome sem par: valor_fora_do_dominio e
a linha recusada (1048). Tipo do cuidado presumido 'cuidado' (valor_presumido: a letra A/E/M da origem não é a
classificação do produto); nome do cuidado acima de 150 resumido (texto_resumido) com o integral no detalhe; ação das restrições
por sexo e idade 'alertar' sem notificação; unidade do parâmetro vital pelo nome (inexistente: pai_inexistente).
Outras anomalias: pai inexistente, S/N e A/I fora do domínio, tipo de atendimento sem par e hora HHMM inválida ou
nula na grade (1048), horários em pai_pendente, CHECK 4025, ordem negativa (1264),
situação repetida sem caixa no código único (1062), tipo de resposta presumido (valor_presumido).
"""

DDL = """
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
REQUER = ["L6-08"]
# o preparo da L6-08 (vias de uso com o identificador da prescrição digital, alvo do cod: de TBDIGITAL_VIAACESSO)
# roda antes do desta fatia
PREPARO_DOS_REQUERIDOS = True
PAIS_EXTERNOS = {"TBSEXO": ["1", "2"], "TBUNID_IDADE": ["1", "2"], "TBUNIDAD": ["1", "2", "3", "4"]}
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL);\nINSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');\n"
                   # a cópia da grade lê o estabelecimento da unidade gravada (ref:TBUNIDAD@estabelecimento_id): as
                   # unidades externas têm id_destino 1..n na conferência; todas do estabelecimento de exemplo
                   "CREATE TABLE IF NOT EXISTS unidade_assistencial (id BIGINT UNSIGNED PRIMARY KEY,"
                   " estabelecimento_id BIGINT UNSIGNED NOT NULL);\n"
                   "INSERT INTO unidade_assistencial (id, estabelecimento_id) SELECT n, (SELECT MIN(id) FROM"
                   " estabelecimento) FROM (WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE"
                   " n < 200) SELECT n FROM s) x;")

NAO_CARREGADAS = []  # rodada 5 (revisão 2): todas carregam; o número de doses vira frequência (ADR 0006)


def linhas(r, ins):
    for i in range(1, 5):
        ins("TBTABELA_CAMPO", [i, "Campo exemplo %d" % i])      # lista do hospital (parâmetro de lista)
    for m in [(1, "Sim", "Mantém no próximo atendimento"), (2, "Não", "Encerra no atendimento"), (3, "   ", "Sem nome")]:
        ins("TBLANC_DIAG_MANTER", list(m))  # 3: valor = código
    # gravidade: nível pelo NOME (Grave = 3, nunca pela chave); ação pela ref. encadeada ao nome da ação (L6-08:
    # 1 Avisar, 2 Bloquear), destino opcional; 4: ação inexistente e S/N fora; 5: nome sem par (1048); 6: só
    # espaços (1048); 7: nível repetido (1062)
    for g in [(1, "Grave", "S", 2), (2, "  Moderada  ", "S", 1), (3, "Leve", "N", 1), (4, "Contraindicada", "X", 99),
              (5, "Sem nível", "S", 1), (6, "   ", "S", 1), (7, "GRAVE", "S", 2)]:
        ins("TBGRAUGRAVINT", list(g))
    # grade: 3 sem hora (1048), 5 tipo E sem par (1048), 6 hora inválida (1048)
    for h in [(1, "I", "0700", 1, "S", "N"), (2, "U", "0000", 0, "N", "S"), (3, "A", None, 1, None, None),
              (4, "A", "0600", None, "N", "N"), (5, "E", "0700", 1, "N", "N"), (6, "I", "2575", 1, "N", "N")]:
        ins("TBHORMED", list(h))
    # cópia da grade por unidade: 1 e 4 são da MESMA grade 1 (as duas ligações ficam, a conciliação fecha), 2 grava;
    # 3 aponta a grade recusada 3 (pai_pendente); 9 é unidade inexistente (estabelecimento NULL: 1048, nunca uma
    # segunda grade do estabelecimento inteiro); 8 aponta grade e unidade inexistentes (1048); pai_inexistente
    # conta uma por coluna: 9 nas duas da unidade, 8 nas quatro da grade e nas duas da unidade
    for u in [(1, 1), (2, 2), (3, 3), (9, 4), (8, 77), (4, 1)]:
        ins("TBHORMED_TBUNIDAD", list(u))
    # números de doses (frequência 'N vezes ao dia' nos horários padrão, uma por número, adotada pelo código):
    # 7 da grade recusada 3 (o número de doses carrega; o horário dele fica pai_pendente pela grade); 8 com menos
    # horários que doses (carrega); 9 com 50 doses (CHECK 1..48 recusa: pendência visível; o horário dele lê as 50
    # doses pela encadeada e é recusado pelo MESMO CHECK do destino, 4025, também visível: a encadeada só confere
    # a pendência do último pai, a grade 2, que carregou); 10 SEM horário nenhum (carrega)
    doses = [(1, 1, 1), (2, 1, 2), (3, 2, 3), (4, 2, 2), (5, 4, 1), (6, 4, 3), (7, 3, 1), (8, 1, 3), (9, 2, 50),
             (10, 4, 4)]
    for n in doses:
        ins("TBNUMDOSE", list(n))
    for h in [(1, 1, "0800"), (1, 2, "2000"), (2, 1, "0800"), (2, 2, "2000"), (3, 1, "0600"), (3, 2, "1400"),
              (3, 3, "2200"), (4, 1, "0800"), (4, 2, "2000"), (5, 1, "0800"), (6, 1, "0700"), (6, 2, "1500"), (6, 3, "2300"), (6, 4, "2575"),
              (99, 1, "0800")] + [(7, 1, "0800"), (8, 1, "0600"), (8, 2, "1400"), (9, 1, "0800")]:
        ins("TBHORARIODOSE", list(h))
    # lista do hospital (parâmetro de lista); 7 situações, só 1 com o nome de uma da lista de problemas
    for s in [(1, "Ativo"), (2, "Em acompanhamento"), (3, "Aguardando exame"), (4, "Excluído"), (5, "Revisado"),
              (6, "Pendente de alta"), (7, "Arquivado")]:
        ins("TBLANC_DIAG_STATUS", list(s))
    # categoria e clinicamente ativo pelo NOME: 3 colapsa espaços; 4 S/N fora (padrão); 5 nome sem par: inativo
    # presumido (pedido 67: nunca ativo), clinicamente ativo no padrão (verdadeiro)
    for s in [(1, "Ativo", "S"), (2, "Resolvido", "N"), (3, "  Em   remissão ", "S"), (4, "Descartado", "X"),
              (5, "Situação sem par", "S")]:
        ins("TBLISTADIAGNOSTICOSITUACAO", list(s))
    for s in [(1, "Paciente"), (2, "Feto"), (3, "   ")]:
        ins("TBLANC_DIAG_SUJ_CUID", list(s))
    # grau e confirmado pelo NOME, nunca pela chave (1 = Confirmado): 4 nome sem par (1048)
    for e in [(1, "Confirmado", "S"), (2, "Suspeito", "S"), (3, "PROVÁVEL", "N"), (4, "Estado sem par", "S")]:
        ins("TBLISTADIAGNOSTICOESTADO", list(e))
    for t in [(1, "Principal", "S"), (2, "Secundario", "N"), (3, "Tipo sem par", "S")]:  # 3: 1048
        ins("TBLISTADIAGNOSTICOTIPO", list(t))
    for c in [(1, "Problema clínico", "S"), (2, "Risco", "N"), (3, "Condição", " ")]:
        ins("TBLISTAPROBLEMACLASSIF", list(c))
    for m in [(1, "Internação", "S"), (2, "Hospital-dia", None), (3, "Domiciliar", "N")]:
        ins("TBMODALIDADE_ASSIST", list(m))
    for m in [(1, "Suspenso a pedido", "S"), (2, None, "S"), (3, "Erro de prescrição", None)]:
        ins("TBMOTIVOMP", list(m))
    # tipo de validação (base pelo NOME): 4 nome sem par (1048)
    for p in [(1, "Por dose", "S"), (2, "Por quilo", "S"), (3, "Cumulativa", None), (4, "Validação sem par", "S")]:
        ins("TBPRINC_VALIDACAO", list(p))
    for p in [(1, "Estabelecida", "S"), (2, "Provável", "N")]:
        ins("TBPROBOCINTMED", list(p))
    for i in range(1, 11):
        nome, sit, sexo, imin, umin, imax, umax, exib, ordem = ("Cuidado exemplo %d" % i, "A" if i % 3 else "I",
                                                                 1 + i % 2, None, None, None, None, "N", 0)
        if i == 2:
            sexo = 9                                   # pai inexistente: NULL com pendência
        if i == 3:
            nome = "Cuidado " + "longo " * 26          # acima de 150: resumido (texto_resumido), integral no detalhe
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
            umax, tipo = 7, "Z"                        # pai inexistente; tipo: presumido 'cuidado' em toda linha
        else:
            tipo = "AEM"[i % 3]
        # sem notificação: ação 'alertar' (de-para do vazio)
        ins("TBPROENF", [i, nome, sit, tipo, 1, sexo, imin, imax, None, umin, umax, None, exib, ordem])
    # unidade pelo nome da unidade de resposta (L6-08: 1 mg); 2: unidade inexistente (pai_inexistente, gravada)
    for s in [(1, 10, "Pressão arterial", 1, "S", "PA", 1, 1, "S"), (2, 11, "Temperatura", 2, "N", "TAX", 2, 9, "S"),
              (3, 12, None, 3, None, None, None, None, "N")]:
        ins("PRSINAIS", list(s))
    # referência da dose (base e unidade pelo NOME): 4 nome sem par (1048)
    for t in [(1, "Por quilo", "S"), (2, "Por metro quadrado", "N"), (3, "Dose fixa", None), (4, "Referência sem par", "S")]:
        ins("TBREFERENCIA", list(t))
    # 6 nome sem par: suspensa presumida (pedido 67, não acionável; a 4 sem nome também a recebe antes do 1048)
    for s in [(1, "Liberada", b"\x89PNG\r\n\x1a\n\x00\xff", 1, "S"), (2, "Suspensa", None, 2, "S"),
              (3, "  Cancelada  ", None, 3, "N"), (4, None, None, 4, "S"), (5, "Encerrada", None, -2, "S"),
              (6, "Situação sem par", None, 6, "S")]:
        ins("TBSITUACAOMP", list(s) + ["N", None, None])
    # 5 nome sem par: suspenso presumido (pedido 67: nunca pedido, que geraria coleta ou execução)
    for s in [(1, "Pedido", "S"), (2, "Coletado", "S"), (3, "Realizado", None), (4, "pedido", "S"),
              (5, "Situação sem par", "S")]:
        ins("TBSTATUSPROCEDIMENTO", list(s))
    return {
        "TBGRAUGRAVINT": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 2, "pai_inexistente": 1,
                                                        "restricao_destino_1048": 2, "restricao_destino_1062": 1}},
        "TBHORMED": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "hora_invalida": 1,
                                                   "restricao_destino_1048": 3}},
        "TBHORMED_TBUNIDAD": {"gravados": 3, "pendencias": {"pai_pendente": 1, "pai_inexistente": 8,
                                                            "restricao_destino_1048": 2}},
        "TBNUMDOSE": {"gravados": 9, "pendencias": {"adotado_existente": 5, "restricao_destino_4025": 1}},
        "TBHORARIODOSE": {"gravados": 14, "pendencias": {"restricao_destino_4025": 2, "hora_invalida": 1,
                                                         "pai_pendente": 1, "pai_inexistente": 2,
                                                         "restricao_destino_1048": 2}},
        "TBTABELA_CAMPO": {"gravados": 4, "pendencias": {"adotado_existente": 7}},
        "TBLANC_DIAG_STATUS": {"gravados": 7, "pendencias": {"adotado_existente": 13}},
        "TBLANC_DIAG_MANTER": {"gravados": 3, "pendencias": {"adotado_existente": 5}},

        "TBLISTADIAGNOSTICOSITUACAO": {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 3,
                                                                     "valor_presumido": 1}},
        "TBLANC_DIAG_SUJ_CUID": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        "TBLISTADIAGNOSTICOESTADO": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 2,
                                                                   "restricao_destino_1048": 1}},
        "TBLISTADIAGNOSTICOTIPO": {"gravados": 2, "pendencias": {"valor_fora_do_dominio": 2,
                                                                 "restricao_destino_1048": 1}},
        "TBLISTAPROBLEMACLASSIF": {"gravados": 3, "pendencias": {}},
        "TBMODALIDADE_ASSIST": {"gravados": 3, "pendencias": {}},
        "TBMOTIVOMP": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        "TBPRINC_VALIDACAO": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "TBPROBOCINTMED": {"gravados": 2, "pendencias": {}},
        "TBPROENF": {"gravados": 7, "pendencias": {"pai_inexistente": 2, "valor_fora_do_dominio": 1,
                                                   "valor_presumido": 10, "texto_resumido": 1,
                                                   "restricao_destino_1048": 1,
                                                   "restricao_destino_4025": 1, "restricao_destino_1264": 1}},
        "PRSINAIS": {"gravados": 2, "pendencias": {"valor_presumido": 3, "pai_inexistente": 1,
                                                   "restricao_destino_1048": 1}},
        "TBREFERENCIA": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 2, "restricao_destino_1048": 1}},
        "TBSITUACAOMP": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 3, "restricao_destino_1048": 1,
                                                       "valor_presumido": 2,
                                                       "restricao_destino_1264": 1}},
        "TBSTATUSPROCEDIMENTO": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 2, "valor_presumido": 1,
                                                               "restricao_destino_1062": 1}},
    }
