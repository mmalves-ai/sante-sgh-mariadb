"""Fatia L8-14 (faturamento e restantes, módulo SGO): tabelas da origem com a forma do dicionário e dados 100% falsos.

Carregadas pelo mapa (colunas.d/L8-14.tsv): 19 cadastros simples de plano de saúde (chave vira o código, nome a
descrição). Valor sem origem que muda o comportamento entra como literal presumido (=~), com valor_presumido por
coluna presumida em cada linha que chega à gravação (inclusive a recusada pelo destino). Destino já gravado antes por
outra tabela com a chave inteira como código (CDTPLANCAMEN, PSMOTIVO, PSORIGEMCOBR, PSORIGEMGUIA): código com
prefixo de domínio (#codigo_derivado), o nome só na descrição (nome repetido com outra caixa agora grava).
PSATVASS e PSPLNASS (ambas em movimento_cadastral_beneficiario, com #retrato e usuário por ref:TBUSERS): sem o
beneficiário (chave alternativa composta EMP+BEN+DEP pedida ao motor, e PSBENEFI, que hoje não carrega sem o contrato):
toda linha, placeholder de 1899 ou não, é lida
e recusada pelo destino com pendência (nunca some).
Descarte de produto (sem_carga.tsv, mecanismo_do_produto), só com a forma (2 linhas falsas cada): CDTPDESCACR e
PSEMPEMITEOBS (domínios de CHECK do produto).
Anomalias: nome nulo ou só com espaços (NOT NULL do destino: restricao_destino_1048), espaços repetidos e acentos
CP1252, S/N fora do domínio (valor_fora_do_dominio, fica o padrão do destino), data sentinela.
"""
import datetime
import re

DDL = """
CREATE TABLE CDTPDESCACR ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(10) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE CDTPDESPCTAPGCM ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(40), PRIMARY KEY ("ID"));
CREATE TABLE CDTPEMISSAO ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(30) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE CDTPEVTCTAREC ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(35), PRIMARY KEY ("ID"));
CREATE TABLE CDTPFRANQUIA ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(25), PRIMARY KEY ("ID"));
CREATE TABLE CDTPGUIA ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(15) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE CDTPLANCAMEN ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(25) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE CDTPMOVVALOR ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(30), PRIMARY KEY ("ID"));
CREATE TABLE CDTPPERIODO ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(20) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE CDVENDATPREP ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(20), PRIMARY KEY ("ID"));
CREATE TABLE PFPORTALOPCAO ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(60) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE PFTPATEND ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(15) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE PSATVASS ("EMP" INTEGER NOT NULL, "BEN" INTEGER NOT NULL, "DEP" INTEGER NOT NULL, "DATA" TIMESTAMP
  NOT NULL, "PEDIDO" DATE NOT NULL, "SITUACAO" CHAR(1), "OBS" BLOB SUB_TYPE 1, "STATUS" CHAR(1), "MOTIVO" SMALLINT,
  "CORRECAO" CHAR(1), "NUM_PRO_ORIGEM" VARCHAR(9), "USUARIO_AUTORIZADOR" VARCHAR(31), "USUARIO" VARCHAR(31),
  "ID" INTEGER NOT NULL, "ENVIA_VLR_PLN_COL_ADE_DMED" SMALLINT, PRIMARY KEY ("ID"));
CREATE TABLE PSCOPARTTPGUIAQNDO ("ID" INTEGER NOT NULL, "NOME" VARCHAR(50) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE PSCRITICA ("ID" INTEGER NOT NULL, "NOME" VARCHAR(50) NOT NULL, "EXTRA_CONTRATO" VARCHAR(1),
  PRIMARY KEY ("ID"));
CREATE TABLE PSDOCIMPNOMESOCIAL ("ID" INTEGER NOT NULL, "NOME" VARCHAR(30), PRIMARY KEY ("ID"));
CREATE TABLE PSEMPEMITEOBS ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(40), PRIMARY KEY ("ID"));
CREATE TABLE PSFORNEMEMSIT ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(30), PRIMARY KEY ("ID"));
CREATE TABLE PSMOTIVO ("COD" SMALLINT NOT NULL, "NOME" VARCHAR(40), PRIMARY KEY ("COD"));
CREATE TABLE PSNATUREZAPS ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(50) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE PSORIGEMCOBR ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(30), PRIMARY KEY ("ID"));
CREATE TABLE PSORIGEMGUIA ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(30), PRIMARY KEY ("ID"));
CREATE TABLE PSPLNASS ("EMP" INTEGER NOT NULL, "BEN" INTEGER NOT NULL, "DEP" INTEGER NOT NULL, "DATA" DATE NOT NULL,
  "PLANO" INTEGER NOT NULL, "FAIXA" SMALLINT, "NUM_PRO_ORIGEM" VARCHAR(9), "TIPO_ACOMOD" SMALLINT, "CARENCIA_ACOMOD"
  SMALLINT, "TERMINO_CAR_ACOMOD" DATE, "USUARIO" VARCHAR(31), PRIMARY KEY ("EMP","BEN","DEP","DATA","PLANO"));
"""

NAO_CARREGADAS = ("CDTPDESCACR", "PSEMPEMITEOBS")
SEM_BENEFICIARIO = {"PSATVASS": "movimento_cadastral_beneficiario", "PSPLNASS": "movimento_cadastral_beneficiario"}
PAIS_EXTERNOS = {"TBUSERS": ["USR_L814_A"]}
P1899 = datetime.date(1899, 12, 30)


def colunas(t):
    """[(nome, tipo, not_null)] da tabela no DDL acima."""
    corpo = re.search(r"CREATE TABLE %s \((.*?)\);" % t, DDL, re.S).group(1)
    corpo = corpo.split(", PRIMARY KEY")[0]
    return [(m.group(1), m.group(2), bool(m.group(3)))
            for m in re.finditer(r'"(\w+)"\s+([A-Z]+(?: PRECISION| SUB_TYPE \d)?(?:\(\d+(?:,\d+)?\))?)(\s+NOT NULL)?', corpo)]


def _n(*nomes):
    return [[i, n] for i, n in enumerate(nomes, 1)]


R1048, R1062, VP, VFD = "restricao_destino_1048", "restricao_destino_1062", "valor_presumido", "valor_fora_do_dominio"
DADOS = [
    ("CDTPDESCACR", _n("Desc ex", "Acres ex"), None),
    ("CDTPDESPCTAPGCM", _n("Despesa  exemplo   médica", None, "Despesa exemplo ação"),
     {"gravados": 2, "pendencias": {R1048: 1}}),
    ("CDTPEMISSAO", _n("Boleto exemplo", "  Cartão   exemplo ", "E-mail exemplo", "   "),
     {"gravados": 3, "pendencias": {R1048: 1, VP: 4}}),
    ("CDTPEVTCTAREC", _n("Evento exemplo um", "Evento exemplo dois", None, "Evento exemplo cobrança"),
     {"gravados": 3, "pendencias": {R1048: 1, VP: 4}}),
    ("CDTPFRANQUIA", _n("Franquia exemplo", None, "Franquia  por período", "Franquia internação"),
     {"gravados": 3, "pendencias": {R1048: 1, VP: 4}}),
    ("CDTPGUIA", _n("Guia exemplo", "Guia  SADT ex", "Guia internação"), {"gravados": 3, "pendencias": {}}),
    # código com prefixo: o terceiro repete o nome do primeiro com outra caixa e espaços (só a descrição; grava)
    ("CDTPLANCAMEN", _n("Mensalidade exemplo", "Taxa exemplo", "MENSALIDADE  exemplo", "Adicional exemplo"),
     {"gravados": 4, "pendencias": {VP: 4}}),
    ("CDTPMOVVALOR", _n("Reajuste exemplo", "Faixa exemplo", None, "Adicional  exemplo"),
     {"gravados": 3, "pendencias": {R1048: 1}}),
    ("CDTPPERIODO", _n("Dia exemplo", "Mês exemplo"), {"gravados": 2, "pendencias": {VP: 2}}),
    ("CDVENDATPREP", _n("Vendedor exemplo", "Supervisor exemplo", "", "Corretora exemplo"),
     {"gravados": 3, "pendencias": {R1048: 1}}),
    ("PFPORTALOPCAO", _n("Autorização exemplo", "Faturamento  exemplo", "Protocolo exemplo"),
     {"gravados": 3, "pendencias": {VP: 3}}),
    ("PFTPATEND", _n("Clínica ex", "Hospital ex", "Laboratório ex"), {"gravados": 3, "pendencias": {}}),
    ("PSATVASS", [
        [1, 1, 0, datetime.datetime(1899, 12, 30), P1899, None, None, None, None, None, None, None, None, 1, None],
        [9, 9, 9, datetime.datetime(2025, 1, 2, 8, 0), datetime.date(2025, 1, 2), "A", b"obs exemplo", "S", 1, "N",
         None, "USR_L814_A", "USR_L814_A", 2, 0]], {"gravados": 0, "pendencias": {"restricao_destino_1364": 2, VP: 4, "data_sentinela": 2}}),
    ("PSCOPARTTPGUIAQNDO", _n("Com diária exemplo", "Com taxa  exemplo", "Com material exemplo"),
     {"gravados": 3, "pendencias": {}}),
    ("PSCRITICA", [[1, "Carência exemplo", "S"], [2, "Cobertura exemplo", "N"], [3, "Limite  exemplo", "X"],
                   [4, "Rede exemplo", None]],
     {"gravados": 4, "pendencias": {VFD: 1, VP: 4}}),
    ("PSDOCIMPNOMESOCIAL", _n("Cartão exemplo", "Guia exemplo", None, "Carta  exemplo"),
     {"gravados": 3, "pendencias": {R1048: 1, VP: 8}}),
    ("PSEMPEMITEOBS", _n("Todos exemplo", "Titulares exemplo"), None),
    ("PSFORNEMEMSIT", _n("Solicitado exemplo", None, "Entregue exemplo", "Cancelado  exemplo"),
     {"gravados": 3, "pendencias": {R1048: 1}}),
    ("PSMOTIVO", _n("Óbito exemplo", None, "Pedido  do titular"), {"gravados": 2, "pendencias": {R1048: 1, VP: 3}}),
    ("PSNATUREZAPS", _n("Contratada exemplo", "Própria exemplo", "Reembolso exemplo"),
     {"gravados": 3, "pendencias": {}}),
    ("PSORIGEMCOBR", _n("Mensalidade exemplo", "Coparticipação ex", "Avulsa exemplo"),
     {"gravados": 3, "pendencias": {VP: 3}}),
    ("PSORIGEMGUIA", _n("Portal exemplo", "Balcão exemplo", "Central  exemplo"),
     {"gravados": 3, "pendencias": {VP: 3}}),
    ("PSPLNASS", [[1, 1, 0, P1899, 1, None, None, None, None, None, None],
                  [9, 9, 9, datetime.date(2025, 1, 2), 3, 1, None, 1, 0, None, "USR_L814_A"]],
     {"gravados": 0, "pendencias": {"restricao_destino_1364": 2, "data_sentinela": 2, VP: 2}}),
]


def linhas(r, ins):
    esperado = {}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        if esp is not None:
            esperado[tab] = {"gravados": esp["gravados"], "pendencias": dict(esp["pendencias"])}
    return esperado
