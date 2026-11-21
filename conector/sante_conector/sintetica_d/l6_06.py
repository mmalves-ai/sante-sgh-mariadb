"""Fatia L6-06 (prontuário, assinatura e assistência, módulo PEP): tabelas de domínio da origem com as colunas de
`conector/mapa/declarado/colunas.d/L6-06.tsv`, dados 100% falsos e as anomalias da fatia.

Carregadas (16): locais de acesso invasivo, tipos de modelo de impressão, grupos e exames oftalmológicos (referência
declarada na via), tipos de acuidade, períodos do sumário de alta (atendimento inteiro PRESUMIDO),
oxigenoterapia, receita padrão (texto livre, abrangência PRESUMIDA, criador pelo login), protocolos de prescrição (sexo
PRESUMIDO 'todos' com pendência por linha, que também sinaliza a vigência ainda não migrada),
motivos de reavaliação, classificação de metas, escala Likert, condições se necessário e situações de aprazamento e
de checagem (categoria PRESUMIDA).
Fora da carga (entram na imagem para provar que nada é gravado): gabarito e graduação da acuidade, extensões de
arquivo (não são tipos de anexo), os três parâmetros de linha única (mecanismo parametro), tamanhos de fonte da prescrição, protocolo aplicado à prescrição
(pais carregados depois) e processos do prontuário.
Anomalias: nome vazio ou só espaços em destino NOT NULL (1048), S/N e A/I fora do domínio (padrão com pendência),
pai recusado (pai_pendente) e pai nunca visto (pai_inexistente + 1048), login sem usuário (pai_inexistente, NULL
aceito), data sentinela na vigência (1048), fim antes do início e idade máxima menor que a mínima (4025), peso acima
de DECIMAL(7,3) (1264), ponto Likert fora de 1..5 (4025) e repetido (1062), 0 como "sem limite" (NULL), BLOB de texto
com quebras de linha, espaços repetidos e CP1252.
"""
import datetime
import decimal

DDL = """
CREATE TABLE PRLOCALINVASIVO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(45) NOT NULL, SIGLA VARCHAR(12) NOT NULL,
  ATIVO CHAR(1) NOT NULL);
CREATE TABLE PRMODELOREL (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE PROFTGABARITO (ID SMALLINT NOT NULL PRIMARY KEY, FORMA SMALLINT NOT NULL, LETRA CHAR(1) NOT NULL,
  LINHA SMALLINT NOT NULL, COLUNA SMALLINT NOT NULL, VALOR NUMERIC(4,2) NOT NULL);
CREATE TABLE PROFTGRADUACAO (ID SMALLINT NOT NULL PRIMARY KEY, COD_GRADUACAO VARCHAR(3) NOT NULL,
  NOME_GRADUACAO VARCHAR(40) NOT NULL);
CREATE TABLE PROFTGRUPEXAME (ID_OFTGRUPO INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(100));
CREATE TABLE PROFTEXAME (ID_OFTEXAME SMALLINT NOT NULL PRIMARY KEY, ID_OFTGRUPO INTEGER NOT NULL, NOME VARCHAR(100));
CREATE TABLE PROFTTPACUID (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(35) NOT NULL, TP_EXAME CHAR(1));
CREATE TABLE PROFTTPARQUIV (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(4) NOT NULL);
CREATE TABLE PROPCAOPERIODO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL, STATUS CHAR(1) NOT NULL);
CREATE TABLE PROXIGENOTERAPIA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(60) NOT NULL, ID_DIGITAL VARCHAR(36));
CREATE TABLE PRPADRECEITA (ID_PADRECEITA INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50), RECEITA BLOB SUB_TYPE 1,
  GERAL VARCHAR(1), USUARIO VARCHAR(31) NOT NULL, AGRUPAMENTO INTEGER NOT NULL,
  DATA_HORA_VIGENCIA_INICIAL TIMESTAMP NOT NULL, FUSO_HORARIO_VIGENCIA_INICIAL SMALLINT NOT NULL,
  DATA_HORA_VIGENCIA_INICIAL_UTC VARCHAR(30) NOT NULL, DATA_HORA_VIGENCIA_FINAL TIMESTAMP,
  FUSO_HORARIO_VIGENCIA_FINAL SMALLINT, DATA_HORA_VIGENCIA_FINAL_UTC VARCHAR(30), DATA_HORA_GRAVACAO TIMESTAMP NOT NULL,
  FUSO_HORARIO_GRAVACAO SMALLINT NOT NULL, DATA_HORA_GRAVACAO_UTC VARCHAR(30) NOT NULL,
  TIPO_TEXTO_ESTRUTURADA SMALLINT NOT NULL);
CREATE TABLE PRPARAM_CHECAGEM (ID SMALLINT NOT NULL PRIMARY KEY, LOTE_VALID_OBRIG_MEDICAMENTO CHAR(1),
  LOTE_VALID_OBRIG_SOLUCAO CHAR(1), LOTE_VALID_OBRIG_HEMOCOMPONENTE CHAR(1));
CREATE TABLE PRPARAM_PRESCFUTURA (ID SMALLINT NOT NULL PRIMARY KEY, TEMPO_AVALIACAO TIME, TEMPO_ANTECEDE_AVALIACAO TIME);
CREATE TABLE PRPAROFTALMO (ID SMALLINT NOT NULL PRIMARY KEY, LANCAR_ADICAO SMALLINT, OLD_ID_PRREPORTS_PRESCOCULAR INTEGER);
CREATE TABLE PRPARTAMPADPRESC (ID SMALLINT NOT NULL PRIMARY KEY, TAMANHO SMALLINT NOT NULL);
CREATE TABLE PRPRESC_PRPROTGERAL (ID_PRPRESC INTEGER NOT NULL, ID_PROTGERAL INTEGER NOT NULL,
  PRIMARY KEY (ID_PRPRESC, ID_PROTGERAL));
CREATE TABLE PRPROCESSOPEP (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE PRPROTGERAL (ID_PROTGERAL INTEGER NOT NULL PRIMARY KEY, PROTGERAL VARCHAR(20), DESCRICAO VARCHAR(80),
  VIGENCIAI TIMESTAMP, VIGENCIAF TIMESTAMP, INDICACAO BLOB SUB_TYPE 1, LITERATURA BLOB SUB_TYPE 1, IDADEI SMALLINT,
  IDADEF SMALLINT, PESOI NUMERIC(9,3), PESOF NUMERIC(9,3), SEXO VARCHAR(1), GERAL VARCHAR(1), OBSGERAL BLOB SUB_TYPE 1,
  ATIVO CHAR(1) NOT NULL);
CREATE TABLE PRREAV_MEDICA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ATIVO VARCHAR(1));
CREATE TABLE PRSAE_CLASSIF_META (ID SMALLINT NOT NULL PRIMARY KEY, CLASSIFICACAO VARCHAR(20) NOT NULL);
CREATE TABLE PRSAE_LIKERT (ID SMALLINT NOT NULL PRIMARY KEY, PONTO_LIKERT VARCHAR(2) NOT NULL);
CREATE TABLE PRSENECESSARIO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ID_DIGITAL VARCHAR(36));
CREATE TABLE PRSITAPRAZAM (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE PRSITCHECAGEM (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(35) NOT NULL, COD INTEGER);
"""

PAIS_EXTERNOS = {"TBUSERS": ["medico.exemplo", "enf.exemplo"]}

CARREGADAS = ("PRLOCALINVASIVO", "PRMODELOREL", "PROFTGRUPEXAME", "PROFTEXAME", "PROFTTPACUID",
              "PROPCAOPERIODO", "PROXIGENOTERAPIA", "PRPADRECEITA", "PRPROTGERAL", "PRREAV_MEDICA",
              "PRSAE_CLASSIF_META", "PRSAE_LIKERT", "PRSENECESSARIO", "PRSITAPRAZAM", "PRSITCHECAGEM")
NAO_CARREGADAS = ("PROFTGABARITO", "PROFTGRADUACAO", "PROFTTPARQUIV", "PRPARAM_CHECAGEM", "PRPARAM_PRESCFUTURA",
                  "PRPAROFTALMO",                  "PRPARTAMPADPRESC", "PRPRESC_PRPROTGERAL", "PRPROCESSOPEP")

D = decimal.Decimal
TS = datetime.datetime


def linhas(r, ins):
    # --- fora da carga: só presença na imagem
    for i in range(1, 6):
        ins("PROFTGABARITO", [i, 1 + i % 2, "EFPTO"[i - 1], i, 1, D("0.%d0" % i)])
        ins("PROFTGRADUACAO", [i, "G%d" % i, "Graduação exemplo %d" % i])
        ins("PRPRESC_PRPROTGERAL", [100 + i, i])
    ins("PRPARAM_CHECAGEM", [1, "S", "N", None])
    ins("PRPARAM_PRESCFUTURA", [1, None, None])
    ins("PRPAROFTALMO", [1, 1, None])
    for i, t in [(1, 8), (2, 10), (3, 12)]:
        ins("PRPARTAMPADPRESC", [i, t])
        ins("PRPROCESSOPEP", [i, "Processo exemplo %d" % i])

    # --- locais de acesso invasivo: 3 com ativo fora do domínio (padrão + pendência); 4 nome só espaços (1048)
    for x in [(1, "Jugular   interna", "JI", "S"), (2, "Subclávia", "SC", "N"), (3, "Femoral", "FE", "X"),
              (4, "   ", "PE", "S"), (5, "Periférico", "  ", "S")]:
        ins("PRLOCALINVASIVO", list(x))
    for i in range(1, 5):
        ins("PRMODELOREL", [i, "  Modelo   impressão %d " % i])

    # --- oftalmologia: grupo 3 sem nome (recusado); exame 3 aponta o grupo recusado (pai_pendente), exame 4 um grupo
    # nunca visto (pai_inexistente e NOT NULL), exame 5 sem nome
    for g, n in [(1, "Refração"), (2, "Tonometria"), (3, None), (4, "Fundoscopia")]:
        ins("PROFTGRUPEXAME", [g, n])
    for x in [(1, 1, "Refração  dinâmica"), (2, 2, "Tonometria de aplanação"), (3, 3, "Exame do grupo recusado"),
              (4, 9, "Exame de grupo inexistente"), (5, 4, None), (6, 1, "Biomicroscopia")]:
        ins("PROFTEXAME", list(x))
    for x in [(1, "Snellen  sem correção", "L"), (2, "Snellen com correção", "l"), (3, "Jaeger perto", None),
              (4, "Estenopeico", "E")]:
        ins("PROFTTPACUID", list(x))
    for x in [(1, "PDF"), (2, "JPG"), (3, "PNG"), (4, "  ")]:
        ins("PROFTTPARQUIV", list(x))

    # --- períodos do sumário: 4 com situação fora do domínio; todos com atendimento inteiro presumido
    for x in [(1, "Atendimento inteiro", "A"), (2, "Últimas 24 horas", "A"), (3, "Últimas  48 horas", "I"),
              (4, "Período exemplo", "Z")]:
        ins("PROPCAOPERIODO", list(x))
    for x in [(1, "Cateter nasal", "0f0f0f0f-0000-4000-8000-000000000001"), (2, "Máscara de Venturi", None),
              (3, "Alto fluxo", "  "), (4, "   ", None)]:
        ins("PROXIGENOTERAPIA", list(x))

    # --- receita padrão
    ini, fim = TS(2024, 1, 10, 9, 30), TS(2025, 6, 1, 0, 0)
    txt = "Dipirona 500 mg\r\n  tomar 1 comprimido  se dor\r\n"
    for (i, desc, rec, usu, vi, vf) in [
            (1, "Receita  gripe", txt, "medico.exemplo", ini, None),                       # gravada
            # o literal presumido conta valor_presumido em toda linha lida, inclusive nas recusadas
            (2, "Receita dor", "Paracetamol € “dose”", "usuario.inexistente", ini, fim),  # criado_por NULL + pai_inexistente
            (3, None, txt, "medico.exemplo", ini, None),                                   # nome NULL: 1048
            (4, "Receita sem texto", None, "enf.exemplo", ini, None),                      # CHECK texto: 4025
            (5, "Receita vigência sentinela", txt, "enf.exemplo", TS(1899, 12, 30), None),  # data_sentinela + 1048
            (6, "Receita fim antes", txt, "enf.exemplo", fim, ini),                        # CHECK vigência: 4025
            (7, "Receita vigente", txt.encode("cp1252"), "enf.exemplo", ini, fim)]:        # gravada
        ins("PRPADRECEITA", [i, desc, rec, "S" if i % 2 else "N", usu, i, vi, -3, "2024-01-10T12:30:00Z", vf,
                             None if vf is None else -3, None, TS(2024, 1, 10, 9, 31), -3, "2024-01-10T12:31:00Z", 0])

    # --- protocolos de prescrição
    lit = "Referência exemplo\r\nlinha dois".encode("cp1252")
    for x in [
            (1, "SEPSE", "Protocolo  sepse", TS(2024, 1, 1), None, "Indicação\r\n  exemplo", lit, 0, 0, D("0.000"),
             D("0.000"), "A", "S", None, "T"),                                    # zeros viram NULL
            (2, None, "Protocolo pós-operatório", TS(2024, 2, 1), TS(2025, 2, 1), None, None, 18, 65, D("40.500"),
             D("120.250"), "F", "N", "Obs € exemplo", "F"),  # sexo F: presumido todos
            (3, "DOR", None, None, None, None, None, None, None, None, None, "A", "S", None, "T"),  # nome NULL: 1048
            (4, "IDADE", "Faixa invertida", None, None, None, None, 70, 20, None, None, "A", "S", None, "T"),  # 4025
            (5, "PESO", "Peso fora da faixa", None, None, None, None, None, None, D("1.000"), D("15000.000"), "M",
             "S", None, "S"),                                                       # DECIMAL(7,3): 1264
            (6, "ATV", "Ativo fora do domínio", None, None, None, None, None, None, None, None, None, "S", None,
             "X")]:                                                                 # padrão + valor_fora_do_dominio
        ins("PRPROTGERAL", list(x))

    for x in [(1, "Piora clínica", "S"), (2, "Resultado de exame", None), (3, "Alta  prevista", "N"),
              (4, "Motivo exemplo", "Q")]:
        ins("PRREAV_MEDICA", list(x))
    for x in [(1, "Curto prazo"), (2, "Médio prazo"), (3, "Longo prazo"), (4, "  ")]:
        ins("PRSAE_CLASSIF_META", list(x))
    # Likert: 6 fora de 1..5 (4025); ' 3' repete o ponto 3 (1062)
    for x in [(1, "1"), (2, "2"), (3, "3"), (4, "4"), (5, "5"), (6, "6"), (7, " 3")]:
        ins("PRSAE_LIKERT", list(x))
    for x in [(1, "Dor", None), (2, "Febre", "0f0f0f0f-0000-4000-8000-000000000002"), (3, "Náusea", None),
              (4, "   ", None)]:
        ins("PRSENECESSARIO", list(x))
    for x in [(1, "Pendente"), (2, "Aprazado"), (3, "Reaprazado"), (4, None), (5, "Suspenso")]:
        ins("PRSITAPRAZAM", list(x))
    for i in range(1, 9):
        ins("PRSITCHECAGEM", [i, "  " if i == 6 else "Situação  checagem %d" % i, i * 10])

    return {
        "PRLOCALINVASIVO": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "PRMODELOREL": {"gravados": 4, "pendencias": {}},
        "PROFTGRUPEXAME": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "PROFTEXAME": {"gravados": 3, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                     "restricao_destino_1048": 2}},
        "PROFTTPACUID": {"gravados": 4, "pendencias": {}},
        "PROPCAOPERIODO": {"gravados": 4, "pendencias": {"valor_presumido": 4, "valor_fora_do_dominio": 1}},
        "PROXIGENOTERAPIA": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "PRPADRECEITA": {"gravados": 3, "pendencias": {"valor_presumido": 7, "pai_inexistente": 1,
                                                       "restricao_destino_1048": 2, "restricao_destino_4025": 2,
                                                       "data_sentinela": 1}},
        "PRPROTGERAL": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_4025": 1,
                                                      "restricao_destino_1264": 1, "valor_fora_do_dominio": 1,
                                                      "valor_presumido": 6}},
        "PRREAV_MEDICA": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1}},
        "PRSAE_CLASSIF_META": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "PRSAE_LIKERT": {"gravados": 5, "pendencias": {"restricao_destino_4025": 1, "restricao_destino_1062": 1}},
        "PRSENECESSARIO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "PRSITAPRAZAM": {"gravados": 4, "pendencias": {"valor_presumido": 5, "restricao_destino_1048": 1}},
        "PRSITCHECAGEM": {"gravados": 7, "pendencias": {"valor_presumido": 8, "restricao_destino_1048": 1}},
    }
