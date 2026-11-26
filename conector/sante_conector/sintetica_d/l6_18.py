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
- CHEXECLIMPEZA: solicitação recusada (pai_pendente), executante nunca visto (pai_inexistente, NULL), executante
  com profissional de higienização (bia: gravado pelo usuário) e sem (ana: codigo_inexistente_destino, NULL; conta também na linha recusada pelo ck), fim antes do
  início (ck periodo: restricao_destino_4025), observação com quebra de linha;
- CHSOLICITLIMP_TBLEITO: sequência por solicitação, solicitação recusada (pai_pendente), leito nunca visto
  (pai_inexistente + ck alvo 4025), indicador fora do domínio (valor_fora_do_dominio, padrão FALSE).
- GDPRONTMOVIM: paciente e atendimento pela encadeada conta > atendimento > paciente; UM volume de prontuário
  antigo por paciente (criado na primeira movimentação, adotado nas seguintes: adotado_existente), paciente nunca
  visto (pai_inexistente + 1048), usuário e operação nunca vistos (pai_inexistente + 1048), excluído S (data da
  carga) e fora do domínio (valor_fora_do_dominio).
Rodada 5 (ADR 0006, continuidade; antes descartadas): TBTPDIETA vira opções da lista `nutricao.tipoDieta`
(parametro_opcao: código, ordem e rótulo do hospital); CHPARAM e CVPARAM viram parametro_valor do estabelecimento
(rodada 6: um valor por chave do produto, desdobrado; vigência pela evidência); a senha mestra de visita vai ao cofre (credencial_integracao,
só com senha; sem chave mestra na conferência: segredo_aguarda_cofre). As definições do produto vêm do preparo
(semente pedida em saida/L6-18.json).
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
CREATE TABLE ATCONTA (ID BIGINT NOT NULL PRIMARY KEY, ID_ATCABECATEND BIGINT NOT NULL, COD_CONTA BIGINT NOT NULL);
CREATE TABLE ATCABECATEND (ID BIGINT NOT NULL PRIMARY KEY, ID_RICADPAC INTEGER NOT NULL);
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
                 "ATCABECATEND": ["900", "901", "7601", "7602", "7603", "7604"], "TBLEITO": ["1", "2", "3"],
                 "CHPROFISLIMP": ["1", "2"], "RICADPAC": ["7701", "7702"], "GDPRONTCADOPER": ["1", "2"],
                 # contas de internação (L8-06, chave registro|conta parcial) que a prova de ATCONTA confere
                 "RICONTAS": ["801|1", "802|1", "803|1", "804|1"]}


def _id_externo(tabela, chave):
    """Id que a conferência dá ao pai externo no conector_origem: sequencial pelas tabelas em ordem alfabética e pelas
    chaves na ordem declarada (conferencia.conferir). Só serve ao preparo do banco descartável."""
    i = 0
    for t, ks in sorted(PAIS_EXTERNOS.items()):
        for k in ks:
            i += 1
            if (t, k) == (tabela, chave):
                return i
    raise KeyError((tabela, chave))


def _preparo_definicoes(chaves, modulo):
    """SQL do PREPARO_DESTINO: módulo do produto e definições dos parâmetros (catálogo do produto; a migração nunca
    cria definição). Próprio da fatia, para não depender do preparo de outra."""
    sel = " UNION ALL ".join("SELECT '%s' AS c" % c for c in chaves)
    return ("INSERT INTO modulo_sistema (codigo, descricao, criado_em) SELECT '%s', '%s', UTC_TIMESTAMP(3) FROM DUAL"
            " WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = '%s');"
            " INSERT INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, permite_estabelecimento,"
            " criado_em) SELECT x.c, (SELECT MIN(id) FROM modulo_sistema WHERE codigo = '%s'), x.c, 'texto', TRUE,"
            " UTC_TIMESTAMP(3) FROM (%s) x WHERE NOT EXISTS (SELECT 1 FROM parametro_definicao d WHERE d.chave = x.c)"
            % (modulo, modulo, modulo, modulo, sel))


# r5 achado (ADR 0006/0003): um valor por chave do produto (CHPARAM e CVPARAM desdobrados em parametro_valor)
CHAVES_PARAMETROS = ("hotelaria.higienizacao.situacaoLeitoAposAlta", "hotelaria.higienizacao.materialLimpezaPadrao",
                     "hotelaria.visita.gravarFotoNoBanco", "hotelaria.visita.corEmVisita",
                     "hotelaria.visita.corVisitaFinalizada", "hotelaria.visita.corSaidaPendente",
                     "hotelaria.visita.corVisitaEmEspera", "hotelaria.visita.diretorioFotos",
                     "hotelaria.visita.exigeDataNascimento", "hotelaria.visita.exigeCelular",
                     "hotelaria.visita.exigeDocumento", "hotelaria.visita.modeloEtiqueta",
                     "hotelaria.visita.situacaoAcessoPadrao", "hotelaria.visita.imprimirEtiquetaSemVisualizar")
# ATCONTA (descarte duplicado COM PROVA, provas.tsv): pares (atendimento, registro da conta) que a carga das contas de
# internação (RICONTAS, L8-06) deixa em atendimento_conta; a prova confere linha a linha com a origem
CONTAS_ATENDIMENTO = [("7601", "801|1"), ("7602", "802|1"), ("7603", "803|1"), ("7604", "804|1")]
_BIA = _id_externo("TBUSERS", "bia.exemplo")
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
                   # tipo documental da carga de domínio do produto (09_HOT/06_chaves.sql), que o banco descartável
                   # da conferência não traz
                   " CREATE TABLE IF NOT EXISTS tipo_documento_arquivo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(30) NOT NULL UNIQUE, descricao VARCHAR(150) NOT NULL, grupo VARCHAR(30) NOT NULL,"
                   " criado_em DATETIME(3) NOT NULL);"
                   " INSERT INTO tipo_documento_arquivo (codigo, descricao, grupo, criado_em) SELECT 'prontuario-antigo',"
                   " 'Prontuário antigo', 'prontuario', NOW(3) FROM DUAL WHERE NOT EXISTS"
                   " (SELECT 1 FROM tipo_documento_arquivo WHERE codigo = 'prontuario-antigo');"
                   # os pais das linhas preparadas abaixo (empresa, paciente, fonte pagadora, tipo de conta) não são
                   # desta fatia: FKs desligadas só neste preparo
                   " SET FOREIGN_KEY_CHECKS=0;"
                   # profissional de higienização do executante, achado pelo usuário (chave alternativa do destino,
                   # `cod:profissional_higienizacao.usuario_id`): cadastro da L6-17, que não grava na imagem dela.
                   # Rodada 6: com o DDL completo no banco descartável ele exige vínculo (terceirizado com empresa),
                   # e o INSERT IGNORE de antes não gravava nada (o executante bia ficava sem profissional)
                   " CREATE TABLE IF NOT EXISTS profissional_higienizacao (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " estabelecimento_id BIGINT UNSIGNED NOT NULL, vinculo VARCHAR(20) NULL,"
                   " empresa_fornecedora_id BIGINT UNSIGNED NULL, nome VARCHAR(150) NOT NULL,"
                   " usuario_id BIGINT UNSIGNED NULL, criado_em DATETIME(3) NULL,"
                   " UNIQUE KEY uq_profissional_higienizacao_usuario (estabelecimento_id, usuario_id));"
                   " INSERT INTO profissional_higienizacao (estabelecimento_id, vinculo, empresa_fornecedora_id, nome,"
                   " usuario_id, criado_em) SELECT 1, 'terceirizado', 1, 'Profissional exemplo', %d, NOW(3) FROM DUAL"
                   " WHERE NOT EXISTS (SELECT 1 FROM profissional_higienizacao WHERE usuario_id = %d);" % (_BIA, _BIA)
                   # conta_hospitalar e atendimento_conta como a carga das contas de internação os deixa
                   + " CREATE TABLE IF NOT EXISTS conta_hospitalar (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " atendimento_id BIGINT UNSIGNED NULL, estabelecimento_id BIGINT UNSIGNED NULL, numero VARCHAR(20) NULL,"
                   " paciente_id BIGINT UNSIGNED NULL, fonte_pagadora_id BIGINT UNSIGNED NULL,"
                   " tipo_conta_id BIGINT UNSIGNED NULL, natureza VARCHAR(20) NULL, competencia DATE NULL,"
                   " inicio_em DATETIME(3) NULL, criado_em DATETIME(3) NULL);"
                   " CREATE TABLE IF NOT EXISTS atendimento_conta (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " atendimento_id BIGINT UNSIGNED NOT NULL, conta_hospitalar_id BIGINT UNSIGNED NOT NULL,"
                   " criado_em DATETIME(3) NULL, excluido_em DATETIME(3) NULL);"
                   + "".join(" INSERT INTO conta_hospitalar (id, atendimento_id, estabelecimento_id, numero, paciente_id,"
                             " fonte_pagadora_id, tipo_conta_id, natureza, competencia, inicio_em, criado_em)"
                             " SELECT %d, %d, 1, 'CT%d', 1, 1, 1, 'internacao', '2020-01-01', '2020-01-01', NOW(3)"
                             " FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM conta_hospitalar WHERE id = %d);"
                             % (_id_externo("RICONTAS", c), _id_externo("ATCABECATEND", a), _id_externo("RICONTAS", c),
                                _id_externo("RICONTAS", c)) for a, c in CONTAS_ATENDIMENTO)
                   + (" INSERT INTO atendimento_conta (atendimento_id, conta_hospitalar_id, criado_em) SELECT a, c, NOW(3)"
                      " FROM (%s) x WHERE NOT EXISTS (SELECT 1 FROM atendimento_conta);" % " UNION ALL ".join(
                          "SELECT %d a, %d c" % (_id_externo("ATCABECATEND", a), _id_externo("RICONTAS", c))
                          for a, c in CONTAS_ATENDIMENTO))
                   + " SET FOREIGN_KEY_CHECKS=1; "
                   # r5 achado: definições dos parâmetros da higienização e da visita (catálogo do produto, pedido em
                   # saida/L6-18.json; a migração nunca cria definição)
                   + _preparo_definicoes(CHAVES_PARAMETROS, "hotelaria"))
CARREGADAS = ("PRTPREFEIC", "RISETOR", "PRVIAADMIN", "TBDIETAS", "PRCARACT_TBDIETAS", "CHTPLIMPEZA_GEITENS", "PRHORPAD",
              "TBLEITO_CHPROFISLIMP", "CHSOLICITLIMP", "CHEXECLIMPEZA", "CHSOLICITLIMP_TBLEITO", "GDPRONTMOVIM",
              "TBTPDIETA", "CHPARAM", "CVPARAM")
DESCARTADAS = ()

NAO_CARREGADAS = ()


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
    ins("CVPARAM", [1, "N", "verde", "azul", "amarelo", "cinza", None, 1, 0, 1, "senha-falsa-1", None, 1, "S"])
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
    # trâmite do prontuário: conta -> atendimento -> paciente (só as colunas lidas pela encadeada); 7604 leva a um
    # paciente nunca visto
    for x in [(7801, 7601, 801), (7802, 7602, 802), (7803, 7603, 803), (7804, 7604, 804)]:  # COD_CONTA = registro
        ins("ATCONTA", list(x))
    for x in [(7601, 7701), (7602, 7701), (7603, 7702), (7604, 7799)]:
        ins("ATCABECATEND", list(x))
    v = datetime.date(2045, 1, 1)
    # (id, operação, conta, quando, usuário, setor de/para, motivo, responsável, observação, científico, validade,
    #  excluído, quem excluiu): 1 cria o volume do paciente 7701, 2 o adota (excluído: data da carga), 3 cria o do
    #  7702, 4 paciente nunca visto (recusa), 5 usuário nunca visto (volume adotado, movimento recusado), 6 operação
    #  nunca vista (recusa), 7 excluído fora do domínio e científico S (adota)
    for x in [(1, 1, 7801, 1, "ana.exemplo", 1, 2, None, "Responsável  Exemplo", obs(1), "N", v, "N", None),
              (2, 2, 7802, 2, "bia.exemplo", 2, 1, None, None, None, None, None, "S", "ana.exemplo"),
              (3, 1, 7803, 3, "ana.exemplo", None, None, 1, None, None, "N", None, None, None),
              (4, 1, 7804, 4, "ana.exemplo", 1, 2, None, None, None, "N", None, "N", None),
              (5, 2, 7803, 5, "zeca.exemplo", 2, 5, None, None, None, "N", None, "N", None),
              (6, 9, 7801, 6, "ana.exemplo", 1, 2, None, None, None, "N", None, "N", None),
              (7, 1, 7801, 7, "bia.exemplo", 2, 1, None, None, None, "S", v, "X", None)]:
        ins("GDPRONTMOVIM", list(x[:3]) + [ts[x[3]]] + list(x[4:]))
    return {
        "PRTPREFEIC": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1}},
        "RISETOR": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        # P2b (recusas-fase2): a 6 tenta o tipo e o próprio nome (concorrente `senao`), nenhum casa: uma
        # valor_fora_do_dominio por declaração
        "PRVIAADMIN": {"gravados": 4, "pendencias": {"restricao_destino_1048": 2, "valor_fora_do_dominio": 2}},
        "TBDIETAS": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1, "pai_inexistente": 1,
                                                   "valor_fora_do_dominio": 2}},
        "PRCARACT_TBDIETAS": {"gravados": 6, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                            "restricao_destino_1048": 1, "valor_fora_do_dominio": 2}},
        "CHTPLIMPEZA_GEITENS": {"gravados": 3, "pendencias": {"restricao_destino_4025": 1, "pai_inexistente": 1,
                                                              "restricao_destino_1048": 1}},
        # hora inválida conta nas duas colunas que leem HORARIO (início e corte); a linha recusada por pai_pendente
        # (refeição, NOT NULL) não chega ao literal presumido; R9 (recusas-fase2): a 7, de dieta recusada, grava
        # com a dieta NULL e pai_pendente
        "PRHORPAD": {"gravados": 5, "pendencias": {"hora_invalida": 2, "restricao_destino_1048": 2, "pai_pendente": 2,
                                                   "pai_inexistente": 1, "valor_fora_do_dominio": 1,
                                                   "valor_presumido": 7}},
        "TBLEITO_CHPROFISLIMP": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 2,
                                                               "vigencia_sem_fonte": 5}},
        "CHSOLICITLIMP": {"gravados": 5, "pendencias": {"pai_inexistente": 3, "pai_ambiguo": 1,
                                                        "restricao_destino_1048": 4, "valor_presumido": 9}},
        "CHEXECLIMPEZA": {"gravados": 4, "pendencias": {"pai_pendente": 4, "pai_inexistente": 1,
                                                        "codigo_inexistente_destino": 2,
                                                        "restricao_destino_4025": 1}},
        "GDPRONTMOVIM": {"gravados": 4, "pendencias": {"pai_inexistente": 5, "restricao_destino_1048": 3,
                                                       "adotado_existente": 2, "valor_fora_do_dominio": 1,
                                                       # r5: a mescla guarda o conflito da 2ª linha do volume
                                                       "mescla_conflito_origem_guardada": 2}},
        # r5 (ADR 0006): opções da lista do produto; parâmetros do estabelecimento (vigência pela evidência: a
        # imagem não tem data própria da linha); CVPARAM com senha mestra e sem chave mestra na conferência: o cofre
        # falha fechado (segredo_aguarda_cofre, visível)
        # módulo 'nutricao' e definição 'nutricao.tipoDieta': TBTPDIETA (ordem 431) cria os dois e as 3 linhas seguintes adotam (6)
        "TBTPDIETA": {"gravados": 4, "pendencias": {"adotado_existente": 6}},
        # rodada 6: um valor por chave (desdobrar; "gravados" = itens): CHPARAM 2 colunas com valor; CVPARAM 10 (a
        # senha mestra nunca vira valor: vai ao cofre, e sem chave mestra a credencial OPCIONAL não grava, com
        # segredo_aguarda_cofre visível; a definição é do produto, sem adoção de módulo)
        "CHPARAM": {"gravados": 2, "pendencias": {"vigencia_sem_fonte": 1}},
        "CVPARAM": {"gravados": 10, "pendencias": {"segredo_aguarda_cofre": 1, "vigencia_sem_fonte": 1}},
        "CHSOLICITLIMP_TBLEITO": {"gravados": 4, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                                "restricao_destino_4025": 1,
                                                                "valor_fora_do_dominio": 1}},
    }
