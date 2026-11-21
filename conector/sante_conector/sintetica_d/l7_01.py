"""Fatia L7-01 (SADT e suprimentos, módulo SADT: hemoterapia, impressão de laudo, exclusão de requisição e
dispositivo de coleta). Cobertura total: 18 tabelas carregam e 2 são descarte com motivo de produto (parâmetros do
módulo antigo e cabeçalho do pedido ao fornecedor, em declarado/sem_carga.tsv).

Dados 100% falsos. Anomalias: descrição nula, vazia e só de espaços (NOT NULL no destino), texto com espaços internos
preservados e nome com espaços colapsados, bytes CP1252, S/N e A/I inválidos e vazios (padrão do destino), ordem
negativa (valor_fora_do_dominio), teste sem nenhuma aplicação (CHECK do destino), literal presumido (valor_presumido em
toda linha avaliada), sexo codificado sem par, situação da bolsa e natureza do movimento por de-para do NOME (nome sem
par: valor_fora_do_dominio e recusa), exclusão e impressão sem data (NOT NULL), doador e fornecedor inexistentes
(pai_inexistente e recusa), bolsa de doação recusada (pai_pendente), sigla de hemocomponente sem par, volume fora da
faixa, opções de resposta agrupadas por pergunta (adotado_existente) e pergunta inexistente.
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
CREATE TABLE PRHEMOTLAN (ID_HEMOTLAN INTEGER NOT NULL PRIMARY KEY, ATO SMALLINT, CODALF VARCHAR(4));
CREATE TABLE SHCLIENT (CODCLIENTE INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40));
CREATE TABLE SHINTER (CODINTER INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50));
CREATE TABLE SHDOACAO (REGISTRO INTEGER NOT NULL PRIMARY KEY, CODDOADOR INTEGER, DATA DATE NOT NULL,
  CRM_TECNICO INTEGER NOT NULL, HORA VARCHAR(5), RETORNO DATE, INAPTO INTEGER, OBS BLOB SUB_TYPE 1,
  VOLUME DOUBLE PRECISION, FATORRH INTEGER, SANGUE INTEGER, REG INTEGER, ATEND VARCHAR(1), CODINTER INTEGER,
  PREDOACAO VARCHAR(1), PESO DOUBLE PRECISION, ALTURA DOUBLE PRECISION, PRESSAO DOUBLE PRECISION, IMC DOUBLE PRECISION,
  ANO_REG SMALLINT, AUTORIZADA_DOACAO_MENOR CHAR(1));
CREATE TABLE SHLOCAL (CODLOCAL SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50));
CREATE TABLE SHRESPOSTA (COD_RESPOSTA INTEGER NOT NULL PRIMARY KEY, COD_PERGUNTA INTEGER NOT NULL,
  CONTEVOL VARCHAR(200));
CREATE TABLE SHBOLSA (ID_BOLSA INTEGER NOT NULL PRIMARY KEY, REGISTRO INTEGER NOT NULL, CRM_TECNICO INTEGER NOT NULL,
  CODMOV INTEGER, BOLSA VARCHAR(16), HEMOCOMPONENTE VARCHAR(4) NOT NULL, DATA DATE, VENCIMENTO DATE,
  VOLUME DOUBLE PRECISION, FATOR INTEGER, USUARIO VARCHAR(31), RECEBIMENTO TIMESTAMP, UNIDADE INTEGER, SANGUE INTEGER,
  ESTOQUE DOUBLE PRECISION, OBS BLOB SUB_TYPE 1, HORA VARCHAR(5), PROCEDENCIA INTEGER, CODFORNEC INTEGER,
  CODLOCAL INTEGER, DTDEVOLUCAO_PERDA DATE, INICIAISDOADOR VARCHAR(5), PESQHEMOGLOBINA SMALLINT, SOROLOGIA SMALLINT,
  MESREF INTEGER, ANOREF INTEGER, CODMOTDEV INTEGER, ID_SHREQUISICAO INTEGER NOT NULL, COD_DOACAO_FORNECEDOR BIGINT,
  CDE SMALLINT, SEQUENCIA SMALLINT NOT NULL, TEMPERATURA NUMERIC(4,1), SEGMENTO VARCHAR(10), COD_PRODUTO VARCHAR(8));
CREATE TABLE SIASSLAUDO_IMPRESSAO (ID INTEGER NOT NULL PRIMARY KEY, UUID VARCHAR(36),
  DATA_HORA_GERACAO_LAUDO TIMESTAMP, ID_TBUSERS VARCHAR(31), DATA_HORA_IMPRESSAO TIMESTAMP,
  DATA_HORA_IMPRESSAO_UTC VARCHAR(36), ID_SIASSLAUDO DOUBLE PRECISION);
"""
# pais de fora da fatia (já carregados): técnicos (L5), usuários (L3), grupo ABO e fator Rh (L7-04) e doadores
# (cadastro fora do mapa nesta origem; aqui como se outro cliente o tivesse). O cadastro de fornecedores (TBFORNEC) é
# lido na ORIGEM pela chave alternativa do nome: REQUER a L7-06, e o serviço fornecedor entra com a empresa de mesmo nome.
REQUER = ["L7-06"]
PREPARO_DOS_REQUERIDOS = True  # o preparo da L7-06 (locais, itens) roda antes, no banco descartável
PAIS_EXTERNOS = {"SHTECNIC": ["10", "11"], "TBUSERS": ["USR_L7_A", "USR_L7_B"], "TBTPSANGUINEO": ["1", "2", "3", "4"],
                 "TBFATORRH": ["1", "2"], "SHDOADOR": ["1", "2", "3"]}
# @estabelecimento: o estabelecimento único do cliente de exemplo
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
                   # o município que o cadastro de fornecedores da L7-06 (REQUER) usa: só o preparo desta fatia roda
                   " INSERT INTO municipio_ibge (codigo_ibge, nome, unidade_federativa_id, criado_em)"
                   " SELECT '3550308', 'Municipio exemplo', 1, UTC_TIMESTAMP(3) FROM DUAL"
                   " WHERE NOT EXISTS (SELECT 1 FROM municipio_ibge WHERE codigo_ibge = '3550308')")


def linhas(r, ins):
    for v in [(1, "Suspender a transfusão exemplo"), (2, "  Hidratar   exemplo  "),  # internos preservados
              (3, None),                                                           # NOT NULL: 1048
              (4, "Conduta ação €")]:
        ins("SHCONDUTA", list(v))
    for v in [(1, "Transfundida"), (2, "DESCARTE"), (3, None),                     # nula: 1048
              (4, "Outro destino exemplo")]:                                      # sem par: vfd e 1048
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
    for v in [(1, "ENTRADA", "N", None), (2, "Bloqueio", "S", None),
              (3, "Devolução", "N", "D"), (4, "Estranho exemplo", "Q", None),  # S/N e nome sem par: vfd, 1048
              (5, None, "N", None),                                             # NOT NULL: 1048
              (6, "  Transfusão  ", "N", None)]:                                # nome aparado casa com o par
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
    for v in [(1, 10, "CH"), (2, 10, "PFC"), (3, 11, None),                       # sigla nula: 1048
              (4, None, "CRIO")]:
        ins("PRHEMOTLAN", list(v))
    for v in [(1, "Fornecedor exemplo um"),                                         # empresa da L7-06 pelo nome
              (2, None),                                                            # nome nulo: 1048
              (3, "Hemocentro exemplo")]:                                           # sem empresa: pai_inexistente
        ins("SHCLIENT", list(v))
    for v in [(1, "Hematoma exemplo"), (2, "Lipotimia exemplo"), (3, None)]:       # nula: 1048
        ins("SHINTER", list(v))
    d = datetime.date
    cd = ("REGISTRO", "CODDOADOR", "DATA", "CRM_TECNICO", "HORA", "RETORNO", "INAPTO", "OBS", "VOLUME", "FATORRH",
          "SANGUE", "REG", "ATEND", "CODINTER", "PREDOACAO", "PESO", "ALTURA", "PRESSAO", "IMC", "ANO_REG",
          "AUTORIZADA_DOACAO_MENOR")
    for v in [dict(REGISTRO=1, CODDOADOR=1, DATA=d(2025, 1, 10), CRM_TECNICO=10, HORA="08:30", RETORNO=d(2025, 5, 10),
                   INAPTO=0, OBS="Doação sem intercorrência", VOLUME=450.0, FATORRH=1, SANGUE=1, PESO=70.5, ALTURA=1.7,
                   PRESSAO=12.8, IMC=24.4, AUTORIZADA_DOACAO_MENOR="N"),               # 0: coletada
              dict(REGISTRO=2, CODDOADOR=2, DATA=d(2025, 2, 11), CRM_TECNICO=11, VOLUME=500.0, FATORRH=2, SANGUE=4,
                   CODINTER=1, AUTORIZADA_DOACAO_MENOR="S"),                          # sem indicador: triagem
              dict(REGISTRO=3, CODDOADOR=9, DATA=d(2025, 3, 12), CRM_TECNICO=10, VOLUME=450.0, FATORRH=1,
                   SANGUE=1),                                                         # doador 9: pai_inexistente
              dict(REGISTRO=4, CODDOADOR=3, DATA=d(2025, 3, 13), CRM_TECNICO=10, INAPTO=1, VOLUME=1500.0, FATORRH=1,
                   SANGUE=2),                                                         # inapto com motivo; volume: vfd
              dict(REGISTRO=5, DATA=d(2025, 3, 14), CRM_TECNICO=11),                  # sem doador: 1048
              dict(REGISTRO=6, CODDOADOR=1, DATA=d(2025, 3, 15), CRM_TECNICO=10, INAPTO=0, FATORRH=1,
                   SANGUE=1),                                                         # coletada sem volume: 4025
              dict(REGISTRO=7, CODDOADOR=2, DATA=d(2025, 3, 16), CRM_TECNICO=11, INAPTO=7, VOLUME=450.0, FATORRH=2,
                   SANGUE=3, REG=55, ATEND="I", ANO_REG=2025, PREDOACAO="S")]:        # indicador sem par: vfd, triagem
        ins("SHDOACAO", [v.get(c) for c in cd])
    for v in [(1, "Geladeira exemplo"), (2, "Freezer exemplo"), (3, None)]:         # nula: 1048
        ins("SHLOCAL", list(v))
    for v in [(1, 1, "Sim"), (2, 1, "Não"),                                         # a 2a adota o grupo da pergunta 1
              (3, 4, "Sim"),
              (4, 3, "Sim"),                                                        # pergunta sem texto: 1048
              (5, 9, "Talvez")]:                                                    # pergunta 9: pai_inexistente
        ins("SHRESPOSTA", list(v))
    ts = datetime.datetime
    cb = ("ID_BOLSA", "REGISTRO", "CRM_TECNICO", "CODMOV", "BOLSA", "HEMOCOMPONENTE", "DATA", "VENCIMENTO", "VOLUME",
          "FATOR", "USUARIO", "RECEBIMENTO", "UNIDADE", "SANGUE", "ESTOQUE", "OBS", "HORA", "PROCEDENCIA", "CODFORNEC",
          "CODLOCAL", "DTDEVOLUCAO_PERDA", "INICIAISDOADOR", "PESQHEMOGLOBINA", "SOROLOGIA", "MESREF", "ANOREF",
          "CODMOTDEV", "ID_SHREQUISICAO", "COD_DOACAO_FORNECEDOR", "CDE", "SEQUENCIA", "TEMPERATURA", "SEGMENTO",
          "COD_PRODUTO")
    base = dict(REGISTRO=1, CRM_TECNICO=10, HEMOCOMPONENTE="CH", DATA=d(2025, 1, 10), VENCIMENTO=d(2025, 2, 10),
                VOLUME=300.0, FATOR=1, SANGUE=1, RECEBIMENTO=ts(2025, 1, 11, 9, 0, 0), ID_SHREQUISICAO=1, SEQUENCIA=1)
    for v in [dict(ID_BOLSA=1, CODMOV=1, BOLSA="B0001", USUARIO="USR_L7_A", OBS="ok", CODLOCAL=1, TEMPERATURA=4.0,
                   SEGMENTO="A1", COD_PRODUTO="E0001", UNIDADE=1, ESTOQUE=1.0, HORA="09:00", MESREF=1,
                   ANOREF=2025),                                                      # entrada: quarentena
              dict(ID_BOLSA=2, REGISTRO=2, CRM_TECNICO=11, CODMOV=3, BOLSA="B0002", HEMOCOMPONENTE="PFC", VOLUME=200.0,
                   FATOR=2, SANGUE=4, CODLOCAL=2, DTDEVOLUCAO_PERDA=d(2025, 1, 20), CODMOTDEV=1, TEMPERATURA=-30.5,
                   PESQHEMOGLOBINA=1, SOROLOGIA=1),                                  # devolvida; códigos sem par: vfd
              dict(ID_BOLSA=3, CODMOV=6, BOLSA="B0003", CODFORNEC=1, PROCEDENCIA=2,
                   COD_DOACAO_FORNECEDOR=123456),                                     # fornecedor; transfusão: vfd
              dict(ID_BOLSA=4, BOLSA="B0004", HEMOCOMPONENTE="XX"),                   # sigla sem par: pai_inexistente
              dict(ID_BOLSA=5, BOLSA="B0005", VENCIMENTO=None),                       # sem validade: 1048
              dict(ID_BOLSA=6, BOLSA="B0006", HEMOCOMPONENTE="CRIO", VOLUME=0.0),     # volume 0: vfd e 1048
              dict(ID_BOLSA=7, REGISTRO=3, BOLSA="B0007")]:                          # doação recusada: pai_pendente
        ins("SHBOLSA", [{**base, **v}.get(c) for c in cb])
    for v in [(1, "0a1b2c3d-0000-4000-8000-000000000001", dt(2025, 6, 1, 8, 0, 0), "USR_L7_A",
               dt(2025, 6, 1, 9, 0, 0), "2025-06-01T12:00:00Z", 501.0),
              (2, "0a1b2c3d-0000-4000-8000-000000000002", None, "USR_NAO_EXISTE", dt(2025, 6, 2, 9, 0, 0), None,
               502.0),                                                              # login: pai_inexistente
              (3, None, None, "USR_L7_B", None, None, 503.0),                       # sem data: 1048
              (4, None, None, None, dt(2025, 6, 4, 9, 0, 0), None, None)]:
        ins("SIASSLAUDO_IMPRESSAO", list(v))
    return {
        "PRHEMOTLAN": {"gravados": 3, "pendencias": {"valor_presumido": 8, "restricao_destino_1048": 1}},
        "SHCLIENT": {"gravados": 1, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 2}},
        "SHINTER": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        "SHDOACAO": {"gravados": 4, "pendencias": {"pai_inexistente": 1, "valor_fora_do_dominio": 4,
                                                  "restricao_destino_1048": 2, "restricao_destino_4025": 1}},
        "SHLOCAL": {"gravados": 2, "pendencias": {"valor_presumido": 9, "restricao_destino_1048": 1}},
        "SHRESPOSTA": {"gravados": 3, "pendencias": {"adotado_existente": 1, "pai_inexistente": 1,
                                                    "restricao_destino_1048": 2}},
        "SHBOLSA": {"gravados": 3, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                 "valor_fora_do_dominio": 4, "restricao_destino_1048": 3}},
        "SIASSLAUDO_IMPRESSAO": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}},
        "SHCONDUTA": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "SHESTFINAL": {"gravados": 2, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 2}},
        "SHEXAME": {"gravados": 4, "pendencias": {"restricao_destino_4025": 1, "valor_fora_do_dominio": 2}},
        "SHREACAO": {"gravados": 3, "pendencias": {"valor_presumido": 8, "restricao_destino_1048": 1}},
        "SHMOTDEV": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "SHMOV": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 3, "restricao_destino_1048": 2}},
        "SHPERGUN": {"gravados": 3, "pendencias": {"valor_presumido": 4, "valor_fora_do_dominio": 1,
                                                   "restricao_destino_1048": 1}},
        "SHTPTRANSF": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "SICADATE_EXCLUSAO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "SICOLETE": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1}},
    }
