"""Fatia L6-18 (prontuário, assinatura e assistência, módulo HOT): tabelas da origem com coluna declarada e anomalias.

Dados 100% falsos (nomes, códigos e logins inventados). Carregadas (CARREGADAS) e anomalias cobertas:
- PRTPREFEIC: nome com espaços repetidos (texto_nome colapsa), nome nulo (descrição NOT NULL: restricao_destino_1048);
- RISETOR: nome só de espaços (1048), tipo presumido 'unidade' (valor_presumido em toda linha lida);
- PRVIAADMIN: nome só de espaços (1048), modalidade presumida 'oral' com a via gravada inativa;
- TBDIETAS: situação fora do domínio A/I e nula (sem destino: a dieta entra inativa enquanto a classe é presumida),
  nome nulo (1048), estoque nunca visto (pai_inexistente, coluna aceita NULL), classe presumida 'oral';
- PRCARACT_TBDIETAS: dieta recusada (pai_pendente), característica nunca vista (pai_inexistente + 1048), ordem sem
  destino (nula, decimal '1.0' e texto não numérico entram com o padrão 0, sem exceção) e situação nula (padrão);
- CHTPLIMPEZA_GEITENS: quantidade zero (ck quantidade > 0: restricao_destino_4025), item nunca visto (pai_inexistente
  + 1048).
Não carregadas (NAO_CARREGADAS: na imagem, sem coluna com destino; dependem dos pedidos do L6-18.json).
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
# pais de fora da fatia, registrados como já carregados (estoque L7, característica L6, tipo de limpeza L6, item L7)
PAIS_EXTERNOS = {"GELOCARM": ["1", "2"], "PRCARACTDIE": ["1", "2", "3"], "CHTPLIMPEZA": ["1", "2"],
                 "GEITENS": ["10", "11", "12"]}
CARREGADAS = ("PRTPREFEIC", "RISETOR", "PRVIAADMIN", "TBDIETAS", "PRCARACT_TBDIETAS", "CHTPLIMPEZA_GEITENS")
NAO_CARREGADAS = ("TBTPDIETA", "PRHORPAD", "CHPARAM", "CVPARAM", "TBLEITO_CHPROFISLIMP", "CHSOLICITLIMP",
                  "CHEXECLIMPEZA", "CHSOLICITLIMP_TBLEITO", "GDPRONTMOVIM")


def linhas(r, ins):
    for x in [(1, "Desjejum", 1), (2, "Colação", 1), (3, "  Almoço   principal ", 1), (4, None, 1),
              (5, "Jantar", None), (6, "Ceia", 2)]:
        ins("PRTPREFEIC", list(x))
    for x in [(1, "Arquivo  médico", "S", "S"), (2, "Faturamento", "N", "N"), (3, "Auditoria", None, None),
              (4, "   ", "S", "N"), (5, "Posto exemplo", "N", "N")]:
        ins("RISETOR", list(x))
    for x in [(1, "Oral", None), (2, "Enteral", None), (3, "Parenteral", None)]:
        ins("TBTPDIETA", list(x))
    for x in [(1, "Oral", 1, None), (2, "Sonda  nasoenteral", 2, None), (3, "Gastrostomia", 2, None),
              (4, "Parenteral central", 3, None), (5, "  ", 1, None)]:
        ins("PRVIAADMIN", list(x))
    for x in [(1, "Livre", 1, "A", 1, None), (2, "Branda", 1, "I", 1, 1), (3, "Enteral  padrão", 2, "X", 2, 2),
              (4, None, 1, "A", 1, None), (5, "Pastosa", 1, None, 1, 9), (6, "Líquida", 1, "A", 1, 1)]:
        ins("TBDIETAS", list(x))
    for x in [(1, 1, "1", "A"), (1, 2, "2", "A"), (2, 1, None, "I"), (2, 3, "3", None), (4, 1, "1", "A"),
              (6, 7, "1", "A"), (6, 2, "1.0", "A"), (6, 3, "2º", "A")]:
        ins("PRCARACT_TBDIETAS", list(x))
    D = decimal.Decimal
    for x in [(1, 10, D("2.500")), (1, 11, D("1")), (2, 10, D("0.125")), (2, 12, D("0")), (2, 13, D("1"))]:
        ins("CHTPLIMPEZA_GEITENS", list(x))
    # não carregadas: formas da origem só para a imagem (dependem dos pedidos do L6-18.json)
    for x in [(1, 1, "0700", "A", 1), (2, 3, "1130", "A", 1)]:
        ins("PRHORPAD", list(x))
    ins("CHPARAM", [1, 1, 10])
    ins("CVPARAM", [1, "N", "verde", "azul", "amarelo", "cinza", None, 1, 0, 1, None, None, 1, "S"])
    for x in [(1, 1), (1, 2), (2, 1)]:
        ins("TBLEITO_CHPROFISLIMP", list(x))
    t0 = datetime.datetime(2025, 5, 1, 8, 0)
    for i in range(1, 4):
        t = t0 + datetime.timedelta(minutes=r.randint(0, 5000))
        ins("CHSOLICITLIMP", [i, "ana", 1, t, None])
        ins("CHEXECLIMPEZA", [i, i, 1, "bia", t + datetime.timedelta(minutes=10), t + datetime.timedelta(minutes=50),
                              ("limpeza %d\r\nconcluída" % i).encode("cp1252")])
        ins("CHSOLICITLIMP_TBLEITO", [i, i, "N"])
        ins("GDPRONTMOVIM", [i, 1, 500 + i, t, "ana", 1, 2, None, "Responsável Exemplo", None, "N",
                             datetime.date(2045, 1, 1), "N", None])
    return {
        "PRTPREFEIC": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1}},
        "RISETOR": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        "PRVIAADMIN": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        "TBDIETAS": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1, "pai_inexistente": 1,
                                                   "valor_presumido": 6}},
        "PRCARACT_TBDIETAS": {"gravados": 6, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                            "restricao_destino_1048": 1}},
        "CHTPLIMPEZA_GEITENS": {"gravados": 3, "pendencias": {"restricao_destino_4025": 1, "pai_inexistente": 1,
                                                              "restricao_destino_1048": 1}},
    }
