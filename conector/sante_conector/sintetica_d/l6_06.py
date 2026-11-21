"""Fatia L6-06 (prontuário, assinatura e assistência, módulo PEP): tabelas de domínio da origem com as colunas de
`conector/mapa/declarado/colunas.d/L6-06.tsv` e os pares de `valores.d/L6-06.tsv`, dados 100% falsos e as anomalias.

Carregadas (14): locais de acesso invasivo, tipos de modelo de impressão, grupos e exames oftalmológicos (referência
declarada na via), tipos de acuidade, períodos do sumário de alta (atendimento inteiro e horas pelo nome), oxigenoterapia,
receita padrão (texto livre; abrangência pelo GERAL; dono profissional pelo login -> TBPROFIS.ID_TBUSERS), protocolos de
prescrição (sexo pelo de-para A/F/M), motivos de reavaliação, classificação de metas, escala Likert (ponto e rótulo
pelo de-para), condições se necessário e situações de aprazamento (categoria pelo nome).
Descartadas com motivo de produto (`declarado/sem_carga.tsv`; entram na imagem para provar que nada é gravado):
gabarito e graduação da acuidade, extensões de arquivo, os três parâmetros de linha única, tamanhos de fonte da
prescrição, processos do prontuário e as situações de checagem antigas (duplicado de PRSITUACAOCHECAGEM, L6-07).
Intermediária: TBPROFIS (forma completa do dicionário), carregada pela declaração da L5-06 e lida pela chave
alternativa do login (ID_TBUSERS); a pessoa do profissional é pai externo.
Anomalias: nome vazio em destino NOT NULL (1048), S/N e A/I fora do domínio, pai recusado e pai nunca visto, login
sem usuário, login sem profissional (geral grava com pai_inexistente; pessoal recusa pelo CHECK de dono), login em dois
profissionais (pai_ambiguo), data sentinela, fim antes do início e idade invertida (4025), peso acima de DECIMAL(7,3)
(1264), sexo fora do domínio (padrão 'todos' com pendência), nome de período e de situação sem par (recusa),
ponto Likert fora de 1..5 (1048) e repetido (1062), 0 como "sem limite", BLOB de texto com CP1252.
"""
import csv
import datetime
import decimal
import os

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

_MAPA = os.path.join(os.path.dirname(__file__), "..", "..", "mapa")


def _forma_tbprofis():
    cols = []
    with open(os.path.join(_MAPA, "colunas.tsv"), encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            if r["tabela"] == "TBPROFIS":
                forma = r["forma"]
                if forma == "BLOB":
                    forma = "BLOB SUB_TYPE 1" if r["regra"] == "texto_longo" else "BLOB SUB_TYPE 0"
                elif forma == "DOUBLE":
                    forma = "DOUBLE PRECISION"
                cols.append((r["coluna"], forma))
    return cols


COLS_TBPROFIS = _forma_tbprofis()
DDL += "CREATE TABLE TBPROFIS (%s, PRIMARY KEY (ID));\n" % ", ".join(
    '"%s" %s%s' % (c, f, " NOT NULL" if c == "ID" else "") for c, f in COLS_TBPROFIS)

# o profissional (TBPROFIS) é carregado pela declaração da L5-06 junto com a fatia; a pessoa dele é pai externo
PAIS_EXTERNOS = {"TBUSERS": ["medico.exemplo", "enf.exemplo", "dup.exemplo", "recep.exemplo"],
                 "TBPESSOA": [1, 2, 3, 4]}
INTERMEDIARIAS = ("TBPROFIS",)

CARREGADAS = ("PRLOCALINVASIVO", "PRMODELOREL", "PROFTGRUPEXAME", "PROFTEXAME", "PROFTTPACUID",
              "PROPCAOPERIODO", "PROXIGENOTERAPIA", "PRPADRECEITA", "PRPROTGERAL", "PRREAV_MEDICA",
              "PRSAE_CLASSIF_META", "PRSAE_LIKERT", "PRSENECESSARIO", "PRSITAPRAZAM")
DESCARTADAS = ("PROFTGABARITO", "PROFTGRADUACAO", "PROFTTPARQUIV", "PRPARAM_CHECAGEM", "PRPARAM_PRESCFUTURA",
               "PRPAROFTALMO", "PRPARTAMPADPRESC", "PRPROCESSOPEP", "PRSITCHECAGEM")

D = decimal.Decimal
TS = datetime.datetime


def linhas(r, ins):
    # --- intermediária: profissional pelo login (3 e 4 com o mesmo login: pai_ambiguo); recep.exemplo sem profissional
    for i, login in ((1, "medico.exemplo"), (2, "enf.exemplo"), (3, "dup.exemplo"), (4, "dup.exemplo")):
        v = {"ID": i, "ID_TBPESSOA": i, "NOME": "Profissional falso %d" % i, "APELIDO": "Dr. Exemplo %d" % i,
             "ID_TBUSERS": login, "SITUACAO": "A", "DATA_INICIO": datetime.date(2020, 1, i)}
        ins("TBPROFIS", [v.get(c) for c, _ in COLS_TBPROFIS])

    # --- descartadas (mecanismo do produto): só presença na imagem; parâmetro nulo e tamanho fora da faixa do produto
    for i in range(1, 6):
        ins("PROFTGABARITO", [i, 1 + i % 2, "EFPTO"[i - 1], i, 1, D("0.%d0" % i)])
        ins("PROFTGRADUACAO", [i, "G%d" % i, "Graduação exemplo %d" % i])
    ins("PRPARAM_CHECAGEM", [1, "S", "N", None])
    ins("PRPARAM_PRESCFUTURA", [1, None, None])
    ins("PRPAROFTALMO", [1, 1, None])
    for i, t in [(1, 8), (2, 10), (3, 24)]:
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

    # --- períodos do sumário: janela pelo nome; 4 sem par no nome (recusa 4025) e com situação fora do domínio
    for x in [(1, "Atendimento inteiro", "A"), (2, "Últimas 24 horas", "A"), (3, "Últimas  48 horas", "I"),
              (4, "Período exemplo", "Z"), (5, "ULTIMAS 12 HORAS", "A")]:
        ins("PROPCAOPERIODO", list(x))
    for x in [(1, "Cateter nasal", "0f0f0f0f-0000-4000-8000-000000000001"), (2, "Máscara de Venturi", None),
              (3, "Alto fluxo", "  "), (4, "   ", None)]:
        ins("PROXIGENOTERAPIA", list(x))

    # --- receita padrão: GERAL S -> geral, N -> profissional (dono pelo login -> TBPROFIS.ID_TBUSERS)
    ini, fim = TS(2024, 1, 10, 9, 30), TS(2025, 6, 1, 0, 0)
    txt = "Dipirona 500 mg\r\n  tomar 1 comprimido  se dor\r\n"
    for (i, desc, rec, geral, usu, vi, vf) in [
            (1, "Receita  gripe", txt, "S", "medico.exemplo", ini, None),                  # gravada, geral
            (2, "Receita dor", "Paracetamol € “dose”", "N", "usuario.inexistente", ini, fim),  # pai_inexistente + 4025
            (3, None, txt, "S", "medico.exemplo", ini, None),                              # nome NULL: 1048
            (4, "Receita sem texto", None, "N", "enf.exemplo", ini, None),                 # CHECK texto: 4025
            (5, "Receita vigência sentinela", txt, "S", "enf.exemplo", TS(1899, 12, 30), None),  # data_sentinela + 1048
            (6, "Receita fim antes", txt, "N", "enf.exemplo", fim, ini),                   # CHECK vigência: 4025
            (7, "Receita vigente", txt.encode("cp1252"), "N", "enf.exemplo", ini, fim),    # gravada, pessoal
            (8, "Receita ambígua", txt, "N", "dup.exemplo", ini, None),                    # pai_ambiguo + 4025 (dono)
            (9, "Receita da recepção", txt, "S", "recep.exemplo", ini, None),              # geral sem profissional
            (10, "Receita sem marca", txt, None, "medico.exemplo", ini, None),             # padrão profissional
            (11, "Receita marca errada", txt, "X", "medico.exemplo", ini, None)]:          # fora do domínio
        ins("PRPADRECEITA", [i, desc, rec, geral, usu, i, vi, -3, "2024-01-10T12:30:00Z", vf,
                             None if vf is None else -3, None, TS(2024, 1, 10, 9, 31), -3, "2024-01-10T12:31:00Z", 0])

    # --- protocolos de prescrição
    lit = "Referência exemplo\r\nlinha dois".encode("cp1252")
    for x in [
            (1, "SEPSE", "Protocolo  sepse", TS(2024, 1, 1), None, "Indicação\r\n  exemplo", lit, 0, 0, D("0.000"),
             D("0.000"), "A", "S", None, "T"),                                    # zeros viram NULL
            (2, None, "Protocolo pós-operatório", TS(2024, 2, 1), TS(2025, 2, 1), None, None, 18, 65, D("40.500"),
             D("120.250"), "F", "N", "Obs € exemplo", "F"),  # sexo F: feminino
            (3, "DOR", None, None, None, None, None, None, None, None, None, "A", "S", None, "T"),  # nome NULL: 1048
            (4, "IDADE", "Faixa invertida", None, None, None, None, 70, 20, None, None, "A", "S", None, "T"),  # 4025
            (5, "PESO", "Peso fora da faixa", None, None, None, None, None, None, D("1.000"), D("15000.000"), "M",
             "S", None, "S"),                                                       # DECIMAL(7,3): 1264
            (6, "ATV", "Ativo fora do domínio", None, None, None, None, None, None, None, None, None, "S", None,
             "X"),                                                                  # padrão + valor_fora_do_dominio
            (7, "SEXOZ", "Sexo fora do domínio", None, None, None, None, None, None, None, None, "Z", "S", None,
             "T")]:                                                                 # padrão todos + valor_fora_do_dominio
        ins("PRPROTGERAL", list(x))

    for x in [(1, "Piora clínica", "S"), (2, "Resultado de exame", None), (3, "Alta  prevista", "N"),
              (4, "Motivo exemplo", "Q")]:
        ins("PRREAV_MEDICA", list(x))
    for x in [(1, "Curto prazo"), (2, "Médio prazo"), (3, "Longo prazo"), (4, "  ")]:
        ins("PRSAE_CLASSIF_META", list(x))
    # Likert: 6 sem par no de-para (NULL: 1048); ' 3' repete o ponto 3 (1062)
    for x in [(1, "1"), (2, "2"), (3, "3"), (4, "4"), (5, "5"), (6, "6"), (7, " 3")]:
        ins("PRSAE_LIKERT", list(x))
    for x in [(1, "Dor", None), (2, "Febre", "0f0f0f0f-0000-4000-8000-000000000002"), (3, "Náusea", None),
              (4, "   ", None)]:
        ins("PRSENECESSARIO", list(x))
    for x in [(1, "Pendente"), (2, "Aprazado"), (3, "REAPRAZADO"), (4, None), (5, "Suspensa"), (6, "Situação exemplo")]:
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
        "PROPCAOPERIODO": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 3, "restricao_destino_4025": 1}},
        "PROXIGENOTERAPIA": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "PRPADRECEITA": {"gravados": 5, "pendencias": {"pai_inexistente": 3, "pai_ambiguo": 1,
                                                       "restricao_destino_1048": 2, "restricao_destino_4025": 4,
                                                       "data_sentinela": 1, "valor_fora_do_dominio": 1}},
        "PRPROTGERAL": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_4025": 1,
                                                      "restricao_destino_1264": 1, "valor_fora_do_dominio": 2}},
        "PRREAV_MEDICA": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1}},
        "PRSAE_CLASSIF_META": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "PRSAE_LIKERT": {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 2, "restricao_destino_1048": 1,
                                                       "restricao_destino_1062": 1}},
        "PRSENECESSARIO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "PRSITAPRAZAM": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 2}},
    }
