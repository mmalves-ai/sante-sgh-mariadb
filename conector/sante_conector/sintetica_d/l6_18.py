"""Fatia L6-18 (prontuário, assinatura e assistência, módulo HOT): tabelas da origem com coluna declarada e anomalias.

Dados 100% falsos (nomes, códigos e logins inventados). Carregadas (CARREGADAS) e anomalias cobertas:
- PRTPREFEIC: nome com espaços repetidos (texto_nome colapsa), nome nulo (descrição NOT NULL: restricao_destino_1048);
- RISETOR: nome só de espaços (1048), tipo presumido 'unidade' (valor_presumido em toda linha lida);
- PRVIAADMIN: nome só de espaços (1048), modalidade pelo nome do tipo de dieta (ref encadeada + de-para por nome);
  tipo sem par (valor_fora_do_dominio + 1048: via recusada, nunca presumida);
- TBDIETAS: situação fora do domínio A/I (valor_fora_do_dominio, padrão ativo) e nula (padrão), nome nulo (1048),
  estoque nunca visto (pai_inexistente, coluna aceita NULL), classe pelo nome do tipo de dieta; tipo sem par
  (valor_fora_do_dominio, padrão 'oral');
- PRCARACT_TBDIETAS: dieta recusada (pai_pendente), característica nunca vista (pai_inexistente + 1048), ordem em
  texto ('1.0' e '2º' viram NULL com valor_fora_do_dominio e ficam com o padrão 0) e situação nula (padrão);
- CHTPLIMPEZA_GEITENS: quantidade zero (ck quantidade > 0: restricao_destino_4025), item nunca visto (pai_inexistente
  + 1048);
- PRHORPAD: hora HHMM inválida (hora_invalida + 1048), refeição e dieta recusadas (pai_pendente), refeição nunca vista
  (pai_inexistente + 1048), situação fora do domínio (valor_fora_do_dominio, padrão ativo), fim presumido;
- TBLEITO_CHPROFISLIMP: leito e profissional nunca vistos (pai_inexistente + 1048), vigência sem fonte;
- CHSOLICITLIMP: situação pela execução (sem execução: pai_inexistente; duas execuções: pai_ambiguo; ambas + 1048),
  tipo de limpeza nulo (1048), solicitante nunca visto (pai_inexistente + 1048), atendimento nunca visto (NULL);
- CHEXECLIMPEZA: solicitação recusada (pai_pendente), executante nunca visto (pai_inexistente, NULL), fim antes do
  início (ck periodo: restricao_destino_4025), observação com quebra de linha;
- CHSOLICITLIMP_TBLEITO: sequência por solicitação, solicitação recusada (pai_pendente), leito nunca visto
  (pai_inexistente + ck alvo 4025), indicador fora do domínio (valor_fora_do_dominio, padrão FALSE).
Descartadas (DESCARTADAS, `declarado/sem_carga.tsv`): TBTPDIETA (lida pelas consumidoras), CHPARAM, CVPARAM. Bloqueada por modelo
(NAO_CARREGADAS, pedido no L6-18.json, declaração comentada): GDPRONTMOVIM.
"""
import datetime
import decimal

DDL = """
CREATE TABLE PRTPREFEIC (COD INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(30), TPDIETA SMALLINT);
CREATE TABLE RISETOR (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40), OPER_REG VARCHAR(1), SAME CHAR(1));
CREATE TABLE TBTPDIETA (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ID_DIGITAL VARCHAR(36));
CREATE TABLE PRVIAADMIN (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ID_TBTPDIETA INTEGER,
  ID_DIGITAL VARCHAR(36));
CREATE TABLE TBDIETAS (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40), TPDIETA SMALLINT, SITUACAO VARCHAR(1),
  TIPO_PRESCRICAO SMALLINT, ID_GELOCARM SMALLINT);
CREATE TABLE PRCARACT_TBDIETAS (ID_TBDIETAS SMALLINT NOT NULL, ID_PRCARACTDIE INTEGER NOT NULL, ORDEM VARCHAR(15),
  SITUACAO CHAR(1), PRIMARY KEY (ID_TBDIETAS, ID_PRCARACTDIE));
CREATE TABLE PRHORPAD (ID_HORPAD INTEGER NOT NULL PRIMARY KEY, CODREF INTEGER NOT NULL, HORARIO VARCHAR(4) NOT NULL,
  SITUACAO VARCHAR(1), ID_TBDIETAS SMALLINT NOT NULL);
CREATE TABLE CHPARAM (ID_TBHOSPIT SMALLINT NOT NULL PRIMARY KEY, ID_CHSITUACAO_APOS_ALTA SMALLINT,
  ID_GEREFER_MATERIAL_LIMPEZA INTEGER);
CREATE TABLE CHTPLIMPEZA_GEITENS (ID_CHTPLIMPEZA SMALLINT NOT NULL, ID_GEITENS INTEGER NOT NULL,
  QTDE NUMERIC(18,3) NOT NULL, PRIMARY KEY (ID_CHTPLIMPEZA, ID_GEITENS));
CREATE TABLE TBLEITO_CHPROFISLIMP (ID_TBLEITO SMALLINT NOT NULL, ID_CHPROFISLIMP SMALLINT NOT NULL,
  PRIMARY KEY (ID_TBLEITO, ID_CHPROFISLIMP));
CREATE TABLE CHSOLICITLIMP (ID INTEGER NOT NULL PRIMARY KEY, USUARIO_SOLICITANTE VARCHAR(31) NOT NULL,
  ID_CHTPLIMPEZA SMALLINT, DATA_HORA_SOLICITACAO TIMESTAMP NOT NULL, ID_ATCABECATEND BIGINT);
CREATE TABLE CHEXECLIMPEZA (ID INTEGER NOT NULL PRIMARY KEY, ID_CHSOLICITLIMP INTEGER NOT NULL,
  ID_CHSITUACAO SMALLINT NOT NULL, USUARIO_EXECUTANTE VARCHAR(31), DATA_HORA_EXECUCAO_INICIAL TIMESTAMP,
  DATA_HORA_EXECUCAO_FINAL TIMESTAMP, OBSERVACAO BLOB SUB_TYPE 1);
CREATE TABLE CHSOLICITLIMP_TBLEITO (ID_CHSOLICITLIMP INTEGER NOT NULL, ID_TBLEITO SMALLINT NOT NULL,
  EXECUTAR_LIMPEZA_ACOMODACAO CHAR(1), PRIMARY KEY (ID_CHSOLICITLIMP, ID_TBLEITO));
CREATE TABLE GDPRONTMOVIM (ID INTEGER NOT NULL PRIMARY KEY, ID_GDPRONTCADOPER SMALLINT NOT NULL,
  ID_ATCONTA BIGINT NOT NULL, DATA_HORA_MOVIMENTACAO TIMESTAMP NOT NULL, USUARIO_MOVIMENTACAO VARCHAR(31) NOT NULL,
  ID_RISETOR_ORIGEM SMALLINT, ID_RISETOR_DESTINO SMALLINT, ID_RIMOTIVO SMALLINT, NOME_RESPONSAVEL VARCHAR(70),
  OBSERVACAO BLOB SUB_TYPE 1, CIENTIFICO CHAR(1), DATA_VALIDADE_PRONTUARIO DATE, EXCLUIDO CHAR(1),
  USUARIO_EXCLUSAO VARCHAR(31));
CREATE TABLE CVPARAM (COD_TBHOSPIT SMALLINT NOT NULL PRIMARY KEY, GRAVAR_FOTO_BANCO CHAR(1),
  COR_LEGENDA_EM_VISITA VARCHAR(20), COR_LEGENDA_VISITA_FINALIZADA VARCHAR(20), COR_LEGENDA_SAIDA_PENDENTE VARCHAR(20),
  COR_LEGENDA_VISITA_ESPERA VARCHAR(20), DIRETORIO_ARM_FOTO VARCHAR(80), DIGITAR_DATA_NASCIMENTO SMALLINT,
  DIGITAR_CELULAR SMALLINT, DIGITAR_DOCUMENTO SMALLINT, SENHA_MASTER_LIB_VISITA VARCHAR(100),
  ID_TBEDITREL_ETIQ_VISITA INTEGER, ID_CVTPSITACESSO SMALLINT, IMPRIME_ETIQ_SEM_PRE_VIZUALIZAR CHAR(1));
"""
# pais de fora da fatia, registrados como já carregados (estoque L7, característica L6, tipo de limpeza L6, item L7,
# situação da limpeza L6, usuários L3, atendimento L3, leito L6, profissional de limpeza L6)
PAIS_EXTERNOS = {"GELOCARM": ["1", "2"], "PRCARACTDIE": ["1", "2", "3"], "CHTPLIMPEZA": ["1", "2"],
                 "GEITENS": ["10", "11", "12"], "CHSITUACAO": ["1", "2"], "TBUSERS": ["ana.exemplo", "bia.exemplo"],
                 "ATCABECATEND": ["900", "901"], "TBLEITO": ["1", "2", "3"], "CHPROFISLIMP": ["1", "2"]}
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento)")
CARREGADAS = ("PRTPREFEIC", "RISETOR", "PRVIAADMIN", "TBDIETAS", "PRCARACT_TBDIETAS", "CHTPLIMPEZA_GEITENS", "PRHORPAD",
              "TBLEITO_CHPROFISLIMP", "CHSOLICITLIMP", "CHEXECLIMPEZA", "CHSOLICITLIMP_TBLEITO")
DESCARTADAS = ("TBTPDIETA", "CHPARAM", "CVPARAM")
NAO_CARREGADAS = ("GDPRONTMOVIM",)


def linhas(r, ins):
    for x in [(1, "Desjejum", 1), (2, "Colação", 1), (3, "  Almoço   principal ", 1), (4, None, 1),
              (5, "Jantar", None), (6, "Ceia", 2)]:
        ins("PRTPREFEIC", list(x))
    for x in [(1, "Arquivo  médico", "S", "S"), (2, "Faturamento", "N", "N"), (3, "Auditoria", None, None),
              (4, "   ", "S", "N"), (5, "Posto exemplo", "N", "N")]:
        ins("RISETOR", list(x))
    for x in [(1, "Oral", None), (2, "Enteral", None), (3, "PARENTERAL", None), (4, "Especial exemplo", None)]:
        ins("TBTPDIETA", list(x))
    for x in [(1, "Oral", 1, None), (2, "Sonda  nasoenteral", 2, None), (3, "Gastrostomia", 2, None),
              (4, "Parenteral central", 3, None), (5, "  ", 1, None), (6, "Via exemplo", 4, None)]:
        ins("PRVIAADMIN", list(x))
    for x in [(1, "Livre", 1, "A", 1, None), (2, "Branda", 1, "I", 1, 1), (3, "Enteral  padrão", 2, "X", 2, 2),
              (4, None, 1, "A", 1, None), (5, "Pastosa", 1, None, 1, 9), (6, "Líquida", 4, "A", 1, 1)]:
        ins("TBDIETAS", list(x))
    for x in [(1, 1, "1", "A"), (1, 2, "2", "A"), (2, 1, None, "I"), (2, 3, "3", None), (4, 1, "1", "A"),
              (6, 7, "1", "A"), (6, 2, "1.0", "A"), (6, 3, "2º", "A")]:
        ins("PRCARACT_TBDIETAS", list(x))
    D = decimal.Decimal
    for x in [(1, 10, D("2.500")), (1, 11, D("1")), (2, 10, D("0.125")), (2, 12, D("0")), (2, 13, D("1"))]:
        ins("CHTPLIMPEZA_GEITENS", list(x))
    # horário padrão: (id, refeição, HHMM, situação, dieta)
    for x in [(1, 1, "0700", "A", 1), (2, 3, "1130", "A", 1), (3, 6, "2100", "I", 2), (4, 2, "2575", "A", 1),
              (5, 4, "1200", "A", 1), (6, 9, "1500", "A", 1), (7, 5, "1900", "A", 4), (8, 2, "0930", "X", 3)]:
        ins("PRHORPAD", list(x))
    ins("CHPARAM", [1, 1, 10])
    ins("CVPARAM", [1, "N", "verde", "azul", "amarelo", "cinza", None, 1, 0, 1, None, None, 1, "S"])
    for x in [(1, 1), (1, 2), (2, 1), (3, 9), (7, 1)]:
        ins("TBLEITO_CHPROFISLIMP", list(x))
    t0 = datetime.datetime(2025, 5, 1, 8, 0)
    m = datetime.timedelta(minutes=1)
    ts = [t0 + m * r.randint(0, 5000) for _ in range(10)]
    # solicitações: 3 sem tipo, 4 solicitante nunca visto, 5 sem execução, 6 com duas execuções, 7 atendimento
    # nunca visto (gravada)
    for i, u, tp, at in [(1, "ana.exemplo", 1, 900), (2, "bia.exemplo", 2, None), (3, "ana.exemplo", None, None),
                         (4, "zeca.exemplo", 1, 901), (5, "ana.exemplo", 1, None), (6, "ana.exemplo", 2, None),
                         (7, "bia.exemplo", 1, 905), (8, "ana.exemplo", 2, None), (9, "bia.exemplo", 1, None)]:
        ins("CHSOLICITLIMP", [i, u, tp, ts[i], at])
    obs = lambda i: ("limpeza %d\r\nconcluída" % i).encode("cp1252")  # noqa: E731
    # execuções: (id, solicitação, situação, executante, início, fim, observação)
    for e, s_, st, u, ini, fim, ob in [
            (1, 1, 1, "bia.exemplo", 10, 50, obs(1)), (2, 2, 2, None, 5, None, None), (3, 3, 1, None, 1, 2, None),
            (4, 4, 1, None, 1, 2, None), (6, 6, 1, None, 1, 2, None), (7, 6, 2, None, 3, 4, None),
            (8, 7, 1, "zeca.exemplo", 1, 30, None), (9, 8, 2, "ana.exemplo", 40, 20, None),
            (10, 9, 1, "ana.exemplo", 1, 15, obs(10))]:
        ins("CHEXECLIMPEZA", [e, s_, st, u, ts[s_] + m * ini, ts[s_] + m * fim if fim else None, ob])
    for x in [(1, 1, "S"), (1, 2, "N"), (2, 1, None), (3, 1, "S"), (7, 9, "N"), (8, 2, "X")]:
        ins("CHSOLICITLIMP_TBLEITO", list(x))
    # bloqueada por modelo (GDPRONTMOVIM): formas da origem só para a imagem
    for i in range(1, 4):
        ins("GDPRONTMOVIM", [i, 1, 500 + i, ts[i], "ana.exemplo", 1, 2, None, "Responsável Exemplo", None, "N",
                             datetime.date(2045, 1, 1), "N", None])
    return {
        "PRTPREFEIC": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1}},
        "RISETOR": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        "PRVIAADMIN": {"gravados": 4, "pendencias": {"restricao_destino_1048": 2, "valor_fora_do_dominio": 1}},
        "TBDIETAS": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1, "pai_inexistente": 1,
                                                   "valor_fora_do_dominio": 2}},
        "PRCARACT_TBDIETAS": {"gravados": 6, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                            "restricao_destino_1048": 1, "valor_fora_do_dominio": 2}},
        "CHTPLIMPEZA_GEITENS": {"gravados": 3, "pendencias": {"restricao_destino_4025": 1, "pai_inexistente": 1,
                                                              "restricao_destino_1048": 1}},
        # hora inválida conta nas duas colunas que leem HORARIO (início e corte); a linha recusada por pai_pendente
        # não chega ao literal presumido
        "PRHORPAD": {"gravados": 4, "pendencias": {"hora_invalida": 2, "restricao_destino_1048": 2, "pai_pendente": 2,
                                                   "pai_inexistente": 1, "valor_fora_do_dominio": 1,
                                                   "valor_presumido": 6}},
        "TBLEITO_CHPROFISLIMP": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 2,
                                                               "vigencia_sem_fonte": 5}},
        "CHSOLICITLIMP": {"gravados": 5, "pendencias": {"pai_inexistente": 3, "pai_ambiguo": 1,
                                                        "restricao_destino_1048": 4, "valor_presumido": 9}},
        "CHEXECLIMPEZA": {"gravados": 4, "pendencias": {"pai_pendente": 4, "pai_inexistente": 1,
                                                        "restricao_destino_4025": 1}},
        "CHSOLICITLIMP_TBLEITO": {"gravados": 4, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                                "restricao_destino_4025": 1,
                                                                "valor_fora_do_dominio": 1}},
    }
