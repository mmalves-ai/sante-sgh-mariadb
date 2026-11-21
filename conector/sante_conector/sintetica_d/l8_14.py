"""Fatia L8-14 (faturamento e restantes, módulo SGO): tabelas da origem com a forma do dicionário e dados 100% falsos.

Carregadas pelo mapa (colunas.d/L8-14.tsv): 19 cadastros simples de plano de saúde (chave vira o código, nome a
descrição). Valor sem origem que muda o comportamento entra como literal presumido (=~), com valor_presumido por
coluna presumida em cada linha que chega à gravação (inclusive a recusada pelo destino). Destino já gravado antes por
outra tabela com a chave inteira como código (CDTPLANCAMEN, PSMOTIVO, PSORIGEMCOBR, PSORIGEMGUIA): código com
prefixo de domínio (#codigo_derivado), o nome só na descrição (nome repetido com outra caixa agora grava).
PSATVASS e PSPLNASS (ambas em movimento_cadastral_beneficiario, com #retrato e usuário por ref:TBUSERS): beneficiário
pela chave natural EMP+BEN+DEP de PSBENEFI (chave alternativa composta). PSBENEFI (fatia L8-15) entra aqui só com a
chave natural (o dicionário inteiro, as demais colunas vazias), como pai externo já carregado (PAIS_EXTERNOS), para a conferência isolada
PROVAR a gravação: beneficiário achado grava; ausente (pai_inexistente) ou repetido na origem (pai_ambiguo) recusa
pelo NOT NULL do destino, com pendência (nunca some). Motivo do movimento por ref:PSMOTIVO (desta fatia).
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
CREATE TABLE PSBENEFI ("ID" BIGINT NOT NULL, "EMP" INTEGER NOT NULL, "BEN" INTEGER NOT NULL, "DEP" INTEGER NOT NULL,
  "DIG" SMALLINT, "NOME" VARCHAR(70), "SEXO" VARCHAR(1), "NASC" DATE, "ECIV" SMALLINT, "IDENT" VARCHAR(15),
  "CPF" BIGINT, "CNPJ" BIGINT, "PISPASEP" BIGINT, "ADESAO" DATE, "DT_VENC" DATE, "DT_STAT" DATE, "APARTIR" DATE,
  "FONE" VARCHAR(15), "PLANO" SMALLINT, "REAJUSTE" SMALLINT, "REPRES" SMALLINT, "EMPRESA" VARCHAR(40),
  "FONE_EMP" VARCHAR(15), "CARGO" VARCHAR(30), "ANOS_T" SMALLINT, "MESES_T" SMALLINT, "EMI_CAR" VARCHAR(1),
  "ENDER" VARCHAR(45), "NUM" INTEGER, "COMPL" VARCHAR(30), "BAIRRO" VARCHAR(30), "CIDADE" VARCHAR(30), "CEP" INTEGER,
  "UF" VARCHAR(2), "IBGE" INTEGER, "REGIAO" SMALLINT, "VER_CAREN" VARCHAR(1), "USU" VARCHAR(1), "MAE" VARCHAR(70),
  "COR" SMALLINT, "DEFICIENTE" VARCHAR(1), "FAIXA" SMALLINT, "GRP_ASSOC" SMALLINT, "STATUS" CHAR(1),
  "TIP_PAG" CHAR(1), "CARENCIA" CHAR(1), "TIP_PERC" CHAR(1), "CALC_PARC" CHAR(1), "PERC_PARC" NUMERIC(9,2),
  "TX_ADESAO" NUMERIC(9,2), "VLR_REPAS" NUMERIC(9,2), "COD_ANT" VARCHAR(30), "CELULAR" VARCHAR(15),
  "EMAIL" VARCHAR(50), "EMISSOR" SMALLINT, "CPF_PROPRIO" CHAR(1), "PAIS" SMALLINT, "USU_REP" CHAR(1),
  "CO_PART" CHAR(1), "COB_TEMP" CHAR(1), "TX_ADM" NUMERIC(9,2), "PAI" VARCHAR(70), "PARENTE" SMALLINT,
  "TIPO_DEP" CHAR(1), "ESTUDANTE" CHAR(1), "VENC_CO" DATE, "DT_CESC" DATE, "DT_VESC" DATE, "PERMANENTE" CHAR(1),
  "CEI" DOUBLE PRECISION, "INSCEST" VARCHAR(15), "TP_NOTA" SMALLINT, "ATIVIDADE" VARCHAR(40), "EXPEDICAO" DATE,
  "REPEMP" VARCHAR(50), "RGR" VARCHAR(15), "CPFR" DOUBLE PRECISION, "ENDR" VARCHAR(40), "NUMR" INTEGER,
  "COMPLR" VARCHAR(30), "BAIRROR" VARCHAR(30), "IBGER" INTEGER, "CIDADER" VARCHAR(30), "CEPR" INTEGER,
  "UFR" VARCHAR(2), "FONER" VARCHAR(15), "EMAILR" VARCHAR(50), "QUALIFIC" VARCHAR(30), "BOLEMP" CHAR(1),
  "CNPJE" BIGINT, "COD_EXT" VARCHAR(19), "SENHA_WEB" VARCHAR(40), "EXPNAOBENEF" CHAR(1), "MESREAJ" SMALLINT,
  "ANOREAJ" SMALLINT, "CAR_EMP" CHAR(1), "PLANOA" VARCHAR(10), "BANCO" SMALLINT, "AGENCIA" INTEGER, "CONTA" INTEGER,
  "TITCOB" VARCHAR(45), "ENDCOB" VARCHAR(45), "NUMCOB" INTEGER, "COMPLCOB" VARCHAR(30), "BAICOB" VARCHAR(30),
  "CIDCOB" VARCHAR(30), "UFCOB" VARCHAR(2), "CEPCOB" INTEGER, "IBGECOB" INTEGER, "FISICO" CHAR(1),
  "CONFERIDO" CHAR(1), "DIAVENCTO" SMALLINT, "VALCAR" DATE, "CONCESSIONARIA" INTEGER, "GERENTE" INTEGER,
  "SUPERVISOR" INTEGER, "VENDEDOR" INTEGER, "INDICADOR" INTEGER, "VLRULTVIG" CHAR(1), "FANTASIA" VARCHAR(50),
  "CONTATO" VARCHAR(45), "FONE_CONT" VARCHAR(15), "FONVENDA" SMALLINT, "APLIC_DESC_DEP" VARCHAR(1),
  "DESC_DEP" SMALLINT, "STATUS_CTO" SMALLINT, "REF_CAR" SMALLINT, "INI_VIG" DATE, "FIM_VIG" DATE, "STA_CAD" SMALLINT,
  "BENEFNAOEXP" CHAR(1), "POSVENDA" INTEGER, "DATA_VENDA" DATE, "PERC_VLR_TXADESAO" CHAR(1),
  "TIPO_DE_COBRANCA" SMALLINT, "GERAR_COB_INATIVOS" CHAR(1), "COBRAR_TX_BANCARIA" CHAR(1),
  "INCLUIR_COPART_COBRANCA" CHAR(1), "INCLUIR_SEGUROS_COBRANCA" CHAR(1), "INCLUIR_PRORATA_COBRANCA" CHAR(1),
  "TAXA_BANCARIA" NUMERIC(9,2), "TIPO_VENDA" SMALLINT, "CALC_ISS" CHAR(1), "PERC_ISS" DOUBLE PRECISION,
  "SINDICATO" CHAR(1), "PERC_VITA_FONTE" DOUBLE PRECISION, "PERC_VITA_VENDEDOR" DOUBLE PRECISION,
  "PERC_VITA_SUPERVISOR" DOUBLE PRECISION, "PERC_VITA_GERENTE" DOUBLE PRECISION,
  "PERC_VITA_INDICADOR" DOUBLE PRECISION, "PERC_VITA_CONCESSIONARIA" DOUBLE PRECISION, "VIDAS_VITALICIO" INTEGER,
  "LOTEDIG" VARCHAR(12), "SIB" CHAR(1), "TESTA_CAR_EXP_SEG" CHAR(1), "BCO_DEBITO" INTEGER, "AGE_DEBITO" INTEGER,
  "CTA_DEBITO" VARCHAR(14), "CCO" BIGINT, "DT_RECEBIMENTO" DATE, "NOME_CARTEIRINHA" VARCHAR(50),
  "HORA_VENDA" VARCHAR(4), "APOLICE" VARCHAR(20), "COD_EXP_PEC" INTEGER, "NOVO_CODIGO" VARCHAR(15),
  "CPFTITFIN" BIGINT, "OBSPERC" BLOB SUB_TYPE 1, "RETRATO" BLOB SUB_TYPE 1, "VENCCTR" SMALLINT,
  "ARTIGO_TRINTA" CHAR(1), "ID_TBTIPLGR_RESID" INTEGER, "ID_TBTIPLGR_COB" INTEGER, "RESIDE_EXTERIOR" CHAR(1),
  "NUM_DECLARACAO_NASCIDO_VIVO" BIGINT, "CNS" VARCHAR(15), "DATA_HORA_INCLUSAO" TIMESTAMP,
  "DATA_HORA_ULTIMA_ATUALIZACAO" TIMESTAMP, "ID_PFGUIAS_OBITO" DOUBLE PRECISION, "ID_TBCID10_OBITO" INTEGER,
  "NUM_DECLARACAO_OBITO" VARCHAR(11), "USUARIO" VARCHAR(31), "DATA_ADMISSAO" DATE, "DESCONTO_PROMOCIONAL" CHAR(1),
  "ID_TBENVCOBEMAIL" SMALLINT, "NUMERO_FUNCIONAL" INTEGER, "NUMERO_VINCULO" SMALLINT, "NUMERO_PENSIONISTA" SMALLINT,
  "COD_UNIDADE" VARCHAR(5), "UNID_ORCAMENTARIA" VARCHAR(60), "ID_PSBENEFI_VINCULO" BIGINT,
  "NRO_PARCELAS_RECOMP_MENSAL" SMALLINT, "NOME_SOCIAL" VARCHAR(70), "EMI_NOME_CART" CHAR(1), "ID_TBCTABAN" INTEGER,
  PRIMARY KEY ("ID"));
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
MOVIMENTOS = {"PSATVASS": "movimento_cadastral_beneficiario", "PSPLNASS": "movimento_cadastral_beneficiario"}
# pai de outra fatia (L8-15): só a chave e a chave natural; 503 e 504 repetem 7+7+0 (pai_ambiguo)
_VAZIAS = [None] * 190  # demais colunas do dicionário do pai (L8-15), sem valor: a referência só usa a chave natural
PAIS_ORIGEM = [("PSBENEFI", [[501, 9, 9, 9] + _VAZIAS, [502, 9, 9, 0] + _VAZIAS, [503, 7, 7, 0] + _VAZIAS,
                             [504, 7, 7, 0] + _VAZIAS])]
PAIS_EXTERNOS = {"TBUSERS": ["USR_L814_A"], "PSBENEFI": ["501", "502", "503", "504"]}


def __getattr__(nome):
    """MAPA_TESTE (lido só pela conferência isolada): o mapa do repositório sem as declarações do pai lido na origem
    (PAIS_ORIGEM, de outra fatia), que já entra como carregado (PAIS_EXTERNOS) e não é recarregado aqui: a referência
    por chave alternativa só lê a origem dele. Nada mais muda (mesma ordem, colunas e regras). Ver o pedido em
    saida/L8-14.json para a conferência fazer isso sozinha."""
    if nome != "MAPA_TESTE":
        raise AttributeError(nome)
    from sante_conector import mapa
    m = mapa.carregar_execucao()
    so = {t for t, _ in PAIS_ORIGEM}
    m["colunas_decl"] = [c for c in m["colunas_decl"] if c["tabela"] not in so]
    return m
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
        # placeholder de 1899: sem beneficiário (pai_inexistente), datas sentinela, recusado pelo NOT NULL
        [1, 1, 0, datetime.datetime(1899, 12, 30), P1899, None, None, None, None, None, None, None, None, 1, None],
        # completo: beneficiário 9+9+9, motivo 1, usuário externo
        [9, 9, 9, datetime.datetime(2025, 1, 2, 8, 0), datetime.date(2025, 1, 2), "A", b"obs exemplo", "S", 1, "N",
         None, "USR_L814_A", "USR_L814_A", 2, 0],
        # beneficiário repetido na origem (pai_ambiguo): recusado
        [7, 7, 0, datetime.datetime(2025, 2, 3, 9, 30), datetime.date(2025, 2, 1), "A", None, "S", None, None, None,
         None, None, 3, None],
        # motivo inexistente (pai_inexistente, anulável): grava sem motivo
        [9, 9, 0, datetime.datetime(2025, 3, 4, 10, 0), datetime.date(2025, 3, 4), "E", None, "S", 99, None, None,
         None, "USR_L814_A", 4, 1]],
     {"gravados": 2, "pendencias": {R1048: 2, VP: 8, "data_sentinela": 2, "pai_inexistente": 2, "pai_ambiguo": 1}}),
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
                  [9, 9, 9, datetime.date(2025, 1, 2), 3, 1, None, 1, 0, None, "USR_L814_A"],
                  [9, 9, 0, datetime.date(2025, 3, 1), 4, 2, "P00000001", 2, 180, datetime.date(2025, 8, 28), None],
                  [7, 7, 0, datetime.date(2025, 4, 1), 3, None, None, None, None, None, None]],
     {"gravados": 2, "pendencias": {R1048: 2, "data_sentinela": 2, VP: 4, "pai_inexistente": 1, "pai_ambiguo": 1}}),
]


def linhas(r, ins):
    esperado = {}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        if esp is not None:
            esperado[tab] = {"gravados": esp["gravados"], "pendencias": dict(esp["pendencias"])}
    for tab, ls in PAIS_ORIGEM:
        for v in ls:
            ins(tab, list(v))
    return esperado
