"""Fatia L7-01 (SADT e suprimentos, módulo SADT: hemoterapia, impressão de laudo, exclusão de requisição e
dispositivo de coleta). Carregadas 10 de 20 tabelas: condutas, destinos finais, testes imuno-hematológicos,
reações transfusionais, motivos de devolução, tipos de movimento da bolsa, perguntas da triagem, modalidades de
transfusão, exclusão de requisição (trilha de auditoria) e dispositivos de coleta. As outras 10 ficam fora até os
pedidos em docs/obra/fatias/f4/saida/L7-01.json. Destinos finais e tipos de movimento: TODA linha recusada (1364: coluna NOT NULL sem padrão e sem valor)
até o de-para de valores da situação da bolsa e da natureza do movimento (nada presumido que mexa no estoque).

Dados 100% falsos. Anomalias: descrição nula, vazia e só de espaços (NOT NULL no destino), texto com espaços internos
preservados e nome com espaços colapsados, bytes CP1252, S/N e A/I inválidos e vazios (padrão do destino), ordem
negativa (valor_fora_do_dominio), teste sem nenhuma aplicação (CHECK do destino), literal presumido (valor_presumido em
toda linha avaliada), sexo codificado sem par (valor_fora_do_dominio) e exclusão sem data (NOT NULL). A exclusão grava
a chave original da requisição na correlação e não atribui usuário (USUARIO é o da requisição copiada).
"""
import datetime

DDL = """
CREATE TABLE SHCONDUTA (COD_CONDUTA INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(80));
CREATE TABLE SHESTFINAL (COD_ESTFINAL INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(80));
CREATE TABLE SHEXAME (COD_EXAME INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50), TIPO INTEGER, UNIDADE VARCHAR(10),
  ORDEM INTEGER NOT NULL, CONSDOACAO VARCHAR(1), CONSBOLSA VARCHAR(1), CONSPRETRANSFUSAO VARCHAR(1), EXAME_PAI CHAR(1));
CREATE TABLE SHMOTDEV (CODMOTDEV INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50), TIPO INTEGER, CODREF VARCHAR(10));
CREATE TABLE SHMOV (CODMOV INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(50), BLOQUEADO VARCHAR(1), DEVOLUCAO_PERDA VARCHAR(1));
CREATE TABLE SHPERGUN (COD_PERGUNTA INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(80), TIPO_PERG INTEGER,
  UNID_PERG VARCHAR(10), ORDEM INTEGER NOT NULL, SEXO INTEGER);
CREATE TABLE SHREACAO (CODIGOREACAO INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(50), TP_REACAO SMALLINT);
CREATE TABLE SHTPTRANSF (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(100) NOT NULL);
CREATE TABLE SICADATE_EXCLUSAO (ID INTEGER NOT NULL PRIMARY KEY, ID_SICADATE DOUBLE PRECISION NOT NULL,
  USUARIO VARCHAR(31), UNIDADE SMALLINT, DATA_HORA_EXCLUSAO TIMESTAMP);
CREATE TABLE SICOLETE (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40), SITUACAO VARCHAR(1));
"""
PAIS_EXTERNOS = {}


def linhas(r, ins):
    for v in [(1, "Suspender a transfusão exemplo"), (2, "  Hidratar   exemplo  "),  # internos preservados
              (3, None),                                                           # NOT NULL: 1048
              (4, "Conduta ação €")]:
        ins("SHCONDUTA", list(v))
    for v in [(1, "Transfundida exemplo"), (2, "Descartada exemplo"), (3, None)]:  # nula: 1048
        ins("SHESTFINAL", list(v))
    for v in [(1, "Tipagem exemplo", 1, None, 1, "S", "S", "S", "N"),
              (2, "Pesquisa exemplo", 1, "mg/dL", 2, "N", "N", "S", None),
              (3, "Sem aplicação exemplo", 1, None, 3, "N", "N", "N", None),     # CHECK de aplicação: 4025
              (4, "Ordem negativa exemplo", 1, None, -1, "S", None, None, None),  # ordem: valor_fora_do_dominio
              (5, "S/N estranho exemplo", 2, None, 5, "X", "N", "S", None)]:      # valor_fora_do_dominio
        ins("SHEXAME", list(v))
    for v in [(10, "Reação  febril   exemplo", 1), (11, "Urticária exemplo", 2),
              (2, "Reação tardia exemplo", 2),
              (12, None, 1)]:                                                     # NOT NULL: 1048
        ins("SHREACAO", list(v))
    for v in [(1, "Vencida exemplo", 1, "V01"), (2, "Violada exemplo", 2, None), (3, "", 1, None)]:  # vazio: 1048
        ins("SHMOTDEV", list(v))
    for v in [(1, "Entrada exemplo", "N", None), (2, "Bloqueio   exemplo", "S", None),
              (3, "Devolução exemplo", "N", "D"), (4, "Estranho exemplo", "Q", None),  # valor_fora_do_dominio
              (5, None, "N", None)]:                                                    # NOT NULL: 1048
        ins("SHMOV", list(v))
    for v in [(1, "Já teve hepatite exemplo?", 1, None, 1, None), (2, "Peso exemplo", 2, "kg", 2, None),
              (3, None, 1, None, 3, None),                                         # NOT NULL: 1048
              (4, "Pergunta\r\n  com quebra exemplo", 1, None, 1, 1)]:                # sexo sem par: valor_fora_do_dominio
        ins("SHPERGUN", list(v))
    for v in [(1, "Rotina exemplo"), (2, "Urgência exemplo"), (3, "  Programada   exemplo "),
              (4, "   ")]:                                                         # vazio: 1048
        ins("SHTPTRANSF", list(v))
    dt = datetime.datetime
    for v in [(1, 101.0, "USR_L7_A", 1, dt(2025, 3, 4, 10, 20, 0)), (2, 102.0, "USR_L7_B", 2, dt(2025, 4, 5, 8, 0, 0)),
              (3, 103.0, None, None, dt(2025, 5, 6, 9, 30, 0)),
              (4, 104.0, "USR_L7_A", 1, None)]:                                     # sem data: 1048
        ins("SICADATE_EXCLUSAO", list(v))
    for v in [(1, "Tubo a vácuo exemplo", "A"), (2, "Seringa exemplo", "I"), (3, "Swab exemplo", None),
              (4, "Lanceta exemplo", "Z")]:                                         # valor_fora_do_dominio
        ins("SICOLETE", list(v))
    return {
        "SHCONDUTA": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "SHESTFINAL": {"gravados": 0, "pendencias": {"restricao_destino_1364": 3}},
        "SHEXAME": {"gravados": 4, "pendencias": {"restricao_destino_4025": 1, "valor_fora_do_dominio": 2}},
        "SHREACAO": {"gravados": 3, "pendencias": {"valor_presumido": 8, "restricao_destino_1048": 1}},
        "SHMOTDEV": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "SHMOV": {"gravados": 0, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1364": 5}},
        "SHPERGUN": {"gravados": 3, "pendencias": {"valor_presumido": 4, "valor_fora_do_dominio": 1,
                                                   "restricao_destino_1048": 1}},
        "SHTPTRANSF": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "SICADATE_EXCLUSAO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "SICOLETE": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1}},
    }
