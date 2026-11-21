"""Fatia L6-01 (recepção, módulo REC): tabelas da origem com os mesmos nomes e tipos do dicionário e dados 100%
falsos.

Carregadas pelo mapa (12): tipo de painel, modelo de ficha, regras de impressão por fonte pagadora, especialidade,
unidade e grupo (modelo pela chave composta; a regra por grupo entra inativa, o grupo sem destino), tipo de indicação,
ação do fluxo de senha, grupo de atendimento, grupo de prioridade legal, módulo de recepção e procedência (situação e
classificação por de-para de valores). Descartadas (4, `declarado/sem_carga.tsv`): tipo do motivo, procedência padrão,
motivo de cancelamento do recibo (duplicado: o texto entra no recibo) e módulo do motivo (sem consumidor). Sem carga
(3, declaração pronta comentada; regras pedidas ao motor em docs/obra/fatias/f4/saida/L6-01.json): exclusão de
atendimento (trilha de auditoria), herança de campos (destino principal desdobrado) e título da ficha (complemento).
As não carregadas entram na imagem para provar que nada é gravado.
Anomalias: nome nulo e vazio (NOT NULL: recusa só a linha), mesmo número de modelo nas duas variantes (1062), cópias
fora da faixa e zero, ordem negativa, idade máxima menor que a mínima (CHECK), S/N fora do domínio, modelo e pais
inexistentes ou recusados (pai_inexistente, pai_pendente), espaços internos, quebra de linha, acentos CP1252, lacunas
na chave.
"""
import datetime

DDL = """
CREATE TABLE PNTIPO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE RECONFIC (COD SMALLINT NOT NULL, CONV SMALLINT NOT NULL, SELECAO VARCHAR(1), GRAFICA VARCHAR(1) NOT NULL,
  CONSTRAINT PK_RECONFIC PRIMARY KEY (COD, CONV, GRAFICA));
CREATE TABLE REESPFIC (COD SMALLINT NOT NULL, ESP SMALLINT NOT NULL, SELECAO VARCHAR(1), GRAFICA VARCHAR(1) NOT NULL,
  CONSTRAINT PK_REESPFIC PRIMARY KEY (COD, ESP, GRAFICA));
CREATE TABLE REEXCATE (REG INTEGER NOT NULL, ENTRADA DATE NOT NULL, DTCANCEL DATE NOT NULL, HRCANCEL VARCHAR(4) NOT NULL,
  PRONT INTEGER, NOME VARCHAR(70), JUSTIF VARCHAR(80), USUARIO VARCHAR(31), MEDICO VARCHAR(70), CONV SMALLINT,
  ORIGEM VARCHAR(1), TIPOPAC CHAR(1), OTMU CHAR(1), ANAMNESE BLOB SUB_TYPE 1, UNIDADE SMALLINT, CLINICA VARCHAR(1),
  ID_TBMOTCANCCAD INTEGER);
CREATE TABLE REGRPFIC (COD SMALLINT NOT NULL, GRP SMALLINT NOT NULL, SELECAO VARCHAR(1), GRAFICA VARCHAR(1) NOT NULL,
  CONSTRAINT PK_REGRPFIC PRIMARY KEY (COD, GRP, GRAFICA));
CREATE TABLE REMODFIC (COD SMALLINT NOT NULL, NOME VARCHAR(30), QTDE SMALLINT, ORDEM SMALLINT, CLINICA VARCHAR(50),
  RETORNO VARCHAR(1), CFIMP VARCHAR(1), GRAFICA VARCHAR(1) NOT NULL, IMPATE CHAR(1), IMPANA CHAR(1), DUPLEX VARCHAR(1),
  IDADEI INTEGER, IDADEF INTEGER, CONSTRAINT PK_REMODFIC PRIMARY KEY (COD, GRAFICA));
CREATE TABLE REPARATE (%s);
CREATE TABLE RETITFIC (COD SMALLINT NOT NULL, NOME VARCHAR(30), GRAFICA VARCHAR(1) NOT NULL,
  CONSTRAINT PK_RETITFIC PRIMARY KEY (COD, GRAFICA));
CREATE TABLE RETPINDATEND (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20));
CREATE TABLE REUNIFIC (COD SMALLINT NOT NULL, UNID SMALLINT NOT NULL, SELECAO VARCHAR(1), GRAFICA VARCHAR(1) NOT NULL,
  CONSTRAINT PK_REUNIFIC PRIMARY KEY (COD, UNID, GRAFICA));
CREATE TABLE TBACAOFLUXOSENHA (ID SMALLINT NOT NULL PRIMARY KEY, SIGLA VARCHAR(1) NOT NULL,
  DESCRICAO VARCHAR(40) NOT NULL);
CREATE TABLE TBCADGRUPOATEN (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(60) NOT NULL, ATIVO CHAR(1));
CREATE TABLE TBGRUPOPRIORIDADE (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50) NOT NULL);
CREATE TABLE TBMODULO_RECEPCAO (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(20) NOT NULL);
CREATE TABLE TBMOTCANCMOD (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20));
CREATE TABLE TBMOTCANCTP (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20));
CREATE TABLE TBMOTEXC (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE TBPROCEDPADRAO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40) NOT NULL);
CREATE TABLE TBPROCED (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40), UNIDADE VARCHAR(30), DRS SMALLINT,
  MODULO VARCHAR(1), ATO SMALLINT, COD_PRES SMALLINT, SITUACAO VARCHAR(1), PROCED_IAG VARCHAR(50),
  ID_DIGITAL VARCHAR(36), ID_DIGITAL_EXPORTATION_CONFIG VARCHAR(36), ID_TBPROCEDPADRAO SMALLINT);
"""
HERANCA = ["POR_USUARIO", "CONV_ANT", "CRM_ANT", "CDC_ANT", "UNID_ANT", "CID_ANT", "MATRIC_ANT", "GUIA_ANT",
           "PLANO_ANT", "TPCONS_ANT", "TPSAI_ANT", "CARSOL_ANT", "CLIN_ANT", "ESPEC_ANT", "EMPRESA_ANT", "UNIORI_ANT",
           "TPDOENCA_ANT", "TITCONV_ANT", "PESO_ANT", "ALTURA_ANT", "VALCAR_ANT", "PROCTO_ANT", "ACOMP_ANT",
           "MEDRESP_ANT"]
DDL = DDL % ", ".join("%s CHAR(1)" % c for c in HERANCA)

CARREGADAS = ["PNTIPO", "REMODFIC", "RECONFIC", "REESPFIC", "REGRPFIC", "RETPINDATEND", "REUNIFIC",
              "TBACAOFLUXOSENHA", "TBCADGRUPOATEN", "TBGRUPOPRIORIDADE", "TBMODULO_RECEPCAO", "TBPROCED"]
DESCARTADAS = ["TBMOTCANCTP", "TBPROCEDPADRAO", "TBMOTEXC", "TBMOTCANCMOD"]
SEM_CARGA = ["REEXCATE", "REPARATE", "RETITFIC"]
NAO_CARREGADAS = DESCARTADAS + SEM_CARGA
PAIS_EXTERNOS = {"TBCONVEN": ["1", "2"], "TBESPEC": ["10"], "TBUNIDAD": ["1", "2"]}

PAINEIS = [(1, "Painel  de   senhas"), (2, "Painel de atendimento"), (3, None)]
# COD, NOME, QTDE, ORDEM, CLINICA, RETORNO, CFIMP, GRAFICA, IMPATE, IMPANA, DUPLEX, IDADEI, IDADEF
MODELOS = [
    (1, "Ficha ambulatorial", 1, 1, "01,02", "N", "S", "N", "S", "N", "N", 0, 0),
    (2, "Ficha  de   pronto atendimento", 0, 2, None, "S", "N", "N", "N", "S", "S", 0, 12),
    (2, "Ficha PA gráfica", 1, 3, None, "N", "N", "S", "N", "N", "N", 0, 0),          # mesmo número: 1062
    (3, "Guia de consulta", 2, 4, None, "X", None, "N", None, None, None, 18, 0),      # S/N fora do domínio
    (4, "Etiqueta", 12, 5, None, "N", None, "N", None, None, None, None, None),       # cópias > 9: CHECK
    (5, None, 1, 6, None, "N", None, "N", None, None, None, None, None),              # título nulo: 1048
    (7, "Pulseira", 1, -1, None, "N", None, "N", None, None, None, None, None),       # ordem negativa
    (8, "Ficha infantil", 1, 7, None, "N", None, "N", None, None, None, 10, 5),       # idade máx < mín: CHECK
]
# regras de impressão (COD, critério, SELECAO, GRAFICA): modelo recusado -> pai_pendente; modelo ou pai inexistente
REGRAS = {
    "RECONFIC": [(1, 1, "S", "N"), (2, 2, "N", "N"), (2, 1, "S", "S"), (1, 9, "S", "N"), (6, 1, "X", "N")],
    "REESPFIC": [(1, 10, "S", "N"), (3, 10, "N", "N"), (5, 10, "S", "N")],
    "REGRPFIC": [(1, 3, "S", "N"), (2, 4, "N", "N"), (5, 3, "S", "N")],
    "REUNIFIC": [(1, 1, "S", "N"), (4, 2, None, "N"), (8, 1, "S", "N")],
}
INDICACOES = [(1, "Médico externo"), (2, "Colaborador"), (3, "  Própria   paciente "), (5, "")]
ACOES = [(1, "C", "Chamar"), (2, "A", "Atender"), (3, "c", "Encaminhar\r\npara outro guichê"), (4, "F", "Finalizar"),
         (6, "X", "   ")]
GRUPOS = [(1, "Grupo  geral", "S"), (2, "Grupo B", "N"), (3, "Grupo C", "X")]
PRIORIDADES = [(1, "Idoso"), (2, "Idoso acima de 80 anos"), (3, "Gestante"), (4, "Pessoa com deficiência")]
MODULOS = [(1, "Recepção interna"), (2, "Recepção externa"), (3, "Diagnóstico")]
MOTIVOS = [(1, "Paciente desistiu"), (2, "Erro de cadastro"), (3, "  Duplicidade  de   lançamento "), (4, "Óbito"),
           (9, "  ")]
PROCEDENCIAS = [(1, "Residência", "S", 1), (2, None, "A", 2), (4, "Outro  serviço", "I", 3),
                (5, "Via pública", "Z", None)]                                  # situação fora do domínio


def linhas(r, ins):
    for row in PAINEIS:
        ins("PNTIPO", list(row))
    for row in MODELOS:
        ins("REMODFIC", list(row))
    for cod, grafica in [(1, "N"), (2, "S")]:
        ins("RETITFIC", [cod, "Título %d" % cod, grafica])
    for row in INDICACOES:
        ins("RETPINDATEND", list(row))
    for row in ACOES:
        ins("TBACAOFLUXOSENHA", list(row))
    for row in GRUPOS:
        ins("TBCADGRUPOATEN", list(row))
    for row in PRIORIDADES:
        ins("TBGRUPOPRIORIDADE", list(row))
    for row in MODULOS:
        ins("TBMODULO_RECEPCAO", list(row))
    for row in MOTIVOS:
        ins("TBMOTEXC", list(row))
    for i, n in [(1, "Reconhecido"), (2, "Encaminhado"), (3, "Espontâneo"), (4, "Outro")]:
        ins("TBPROCEDPADRAO", [i, n])
    for cod, nome, sit, padrao in PROCEDENCIAS:
        ins("TBPROCED", [cod, nome, "Unidade %d" % cod, 1, "A", None, None, sit, None, None, None, padrao])
    for t, rows in REGRAS.items():
        for row in rows:
            ins(t, list(row))
    ins("REPARATE", [r.choice(["S", "N"]) for _ in HERANCA])
    for i, n in [(1, "Interna"), (2, "Externa"), (3, "Diagnóstico"), (4, "Pronto-socorro"), (5, None)]:
        ins("TBMOTCANCMOD", [i, n])
    for i, n in [(1, "Atendimento"), (2, "Marcação")]:
        ins("TBMOTCANCTP", [i, n])
    for k in range(1, 4):
        ins("REEXCATE", [1000 + k, datetime.date(2026, 4, k), datetime.date(2026, 4, k + 1), "0930", 500 + k,
                         "Paciente Fictício %d" % k, "Cadastro em duplicidade", "usuario1", "Médico Fictício", 1,
                         "A", "E", "A", ("anamnese fictícia %d\r\n" % k).encode("cp1252"), 1, "A", 1])
    # valor_presumido: uma por literal presumido em cada linha lida (inclusive as recusadas)
    return {
        "PNTIPO": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 3}},
        "RETPINDATEND": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 4}},
        "TBACAOFLUXOSENHA": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        "TBCADGRUPOATEN": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1}},
        "TBGRUPOPRIORIDADE": {"gravados": 4, "pendencias": {}},
        "TBMODULO_RECEPCAO": {"gravados": 3, "pendencias": {}},
        "TBPROCED": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "valor_fora_do_dominio": 4}},
        # modelo: (2,'S') colide com (2,'N') no código (1062); 5 sem título; 8 com idade máxima menor (CHECK)
        "REMODFIC": {"gravados": 5, "pendencias": {"valor_presumido": 8, "valor_fora_do_dominio": 4,
                                                   "restricao_destino_1062": 1, "restricao_destino_1048": 1,
                                                   "restricao_destino_4025": 1}},
        "RECONFIC": {"gravados": 3, "pendencias": {"pai_pendente": 1, "pai_inexistente": 2, "valor_fora_do_dominio": 1,
                                                   "restricao_destino_1048": 1}},
        "REESPFIC": {"gravados": 2, "pendencias": {"pai_pendente": 1}},
        "REUNIFIC": {"gravados": 2, "pendencias": {"pai_pendente": 1}},
        # regra por grupo: inativa e presumida; modelo 5 recusado (sem título): pai_pendente
        "REGRPFIC": {"gravados": 2, "pendencias": {"valor_presumido": 2, "pai_pendente": 1}},
    }
