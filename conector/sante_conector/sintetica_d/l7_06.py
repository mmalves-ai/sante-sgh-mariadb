"""Fatia L7-06 (suprimentos, módulo SUP: cadastros de estoque, compras e fornecedores): tabelas da origem com a forma
do dicionário e dados 100% falsos.

Carregadas pelo mapa (colunas.d/L7-06.tsv): GENIVELSERV (nível de serviço), GEPADRAO_DATAMATRIX_QRCODE (padrão de
leitura, simbologia presumida), GEPORTALCOMPRAS (portal de cotação), GEREFER (categoria contábil do insumo),
GESITUACAOPED (situação do pedido de compra, indicadores presumidos FALSE), GETPLANCTO (tipo de movimento, natureza e sentido presumidos neutros),
TBCATEGO (categoria de fornecimento, tipo presumido), TBFABOPM e TBLABORA (fabricante, duas fontes no mesmo destino),
TBGRUPOUNIDADEMEDIDA (grupo de unidade, grandeza presumida) e TBSITUACAOFARMACIA (situação farmacêutica, indicadores presumidos FALSE).
Todo valor sem origem que muda o comportamento do sistema entra como literal presumido (=~), com valor_presumido.
As outras 14 tabelas entram na imagem só com a forma (2 linhas falsas cada) e ficam fora da carga até o motor ganhar
as regras genéricas pedidas em docs/obra/fatias/f4/saida/L7-06.json (motivo por coluna em colunas.d/L7-06.tsv).
Anomalias: descrição nula ou só com espaços (NOT NULL do destino recusa a linha: restricao_destino_1048), nome com
espaços repetidos, S/N fora do domínio (valor_fora_do_dominio, fica o padrão do destino), percentual 0 e fator
negativo (CHECK do destino: restricao_destino_4025), percentual repetido (UNIQUE: restricao_destino_1062) e literal
presumido (valor_presumido por coluna presumida em cada linha que chega à gravação, inclusive a recusada pelo
destino).
"""
import datetime
import decimal
import re

DDL = """
CREATE TABLE GELOCUSU ("USUARIO" VARCHAR(31) NOT NULL, "ARM" SMALLINT NOT NULL, "TIPO_MOV" VARCHAR(2) NOT NULL,
  PRIMARY KEY ("USUARIO","ARM","TIPO_MOV"));
CREATE TABLE GENIVELSERV ("ID" SMALLINT NOT NULL, "NIVEL_SERVICO" NUMERIC(4,2) NOT NULL, "FATOR_SEGURANCA"
  NUMERIC(4,3) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE GEPADRAO_DATAMATRIX_QRCODE ("ID" INTEGER NOT NULL, "PADRAO" VARCHAR(100) NOT NULL, PRIMARY KEY
  ("ID"));
CREATE TABLE GEPORTALCOMPRAS ("ID" SMALLINT NOT NULL, "DESCRICAO" VARCHAR(40) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE GEREFER ("COD" INTEGER NOT NULL, "NOME" VARCHAR(40), "UNID" VARCHAR(6), "CONSIG" VARCHAR(1),
  "COD_OPE" INTEGER NOT NULL, "CTA_EMP" INTEGER NOT NULL, "ID_COTIPOITEM" SMALLINT NOT NULL, PRIMARY KEY ("COD"));
CREATE TABLE GESALCON ("FORN" INTEGER NOT NULL, "ITEM" INTEGER NOT NULL, "QTDE" NUMERIC(18,3), PRIMARY KEY
  ("FORN","ITEM"));
CREATE TABLE GESALDOS ("ANO" SMALLINT NOT NULL, "MES" SMALLINT NOT NULL, "ITEM" INTEGER NOT NULL, "QTDE"
  NUMERIC(18,3), "VALOR" NUMERIC(18,2), "ESTOQUE_MEDIO" NUMERIC(18,3), PRIMARY KEY ("ANO","MES","ITEM"));
CREATE TABLE GESITUACAOPED ("ID" INTEGER NOT NULL, "NOME" VARCHAR(25), PRIMARY KEY ("ID"));
CREATE TABLE GESUBGRU ("GRU" SMALLINT NOT NULL, "COD" SMALLINT NOT NULL, "NOME" VARCHAR(40), "COD_QUIM_TISS"
  INTEGER, PRIMARY KEY ("GRU","COD"));
CREATE TABLE GETPLANCTO ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(15) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE GETPSALDO ("ID" INTEGER NOT NULL, "NOME" VARCHAR(30) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE GEULTDOCGER ("ID_GETPLANCTO" SMALLINT NOT NULL, "ANO_MES" INTEGER NOT NULL, "ULT_NUM_DOC_GERADO"
  INTEGER NOT NULL, PRIMARY KEY ("ID_GETPLANCTO","ANO_MES","ULT_NUM_DOC_GERADO"));
CREATE TABLE GEUSERS ("USUARIO" VARCHAR(31) NOT NULL, "NOME" VARCHAR(70), "FUNCAO" VARCHAR(20), "OLD_SENHA"
  INTEGER, "ATIVO" VARCHAR(1), "LOC_ARM" SMALLINT, "ARM1" SMALLINT, "ARM2" SMALLINT, "ARM3" SMALLINT, "ARM4"
  SMALLINT, "ARM5" SMALLINT, "ARM6" SMALLINT, "ARM7" SMALLINT, "ARM8" SMALLINT, "ARM9" SMALLINT, "ARM10" SMALLINT,
  "OLD_CRM" INTEGER, "OLD_CONS_LOTE" VARCHAR(1), "GER_ITENS" VARCHAR(1), "NIVEL" SMALLINT, "IMP_NF" VARCHAR(1),
  "PAR_GER" VARCHAR(1), "DIG_VLR_LAN" VARCHAR(1), "OLD_FEC_INC" VARCHAR(1), "DESB_PED" VARCHAR(1), "EMAIL"
  VARCHAR(100), "EMAIL_SERV" VARCHAR(100), "EMAIL_USER" VARCHAR(100), "AUT_REQ" VARCHAR(1), "EMAIL_POP"
  VARCHAR(100), "EMAIL_AUTENT" VARCHAR(1), "EMAIL_POP3" VARCHAR(100), "VISUAL_PRECO" VARCHAR(1), "ASSINATURA" BLOB
  SUB_TYPE 0, "PERM_LAN_MAT_MED_CONT" VARCHAR(1) NOT NULL, "PORTA_SMTP" INTEGER NOT NULL, "PORTA_POP3" INTEGER NOT
  NULL, "SSL" VARCHAR(1) NOT NULL, "PERM_INC_ANTIMI" VARCHAR(1) NOT NULL, "PERM_ALT_ANTIMI" VARCHAR(1) NOT NULL,
  "PERM_EXC_ANTIMI" VARCHAR(1) NOT NULL, "OLD_PERM_GERA_SALDO_MES_FECH" VARCHAR(1), "PERM_VIS_ACOMP_CAD_ITENS"
  VARCHAR(1), "PERM_VIS_PREC_VAL_CAD_ITENS" VARCHAR(1), "VISUAL_QTDE" VARCHAR(1), "PERM_FEC" VARCHAR(1),
  "OCULTAR_FAT" VARCHAR(1) NOT NULL, "OLD_CONS_DOC_SEM_QTDE" VARCHAR(1), "PERM_CAD_PACIENTE" VARCHAR(1) NOT NULL,
  "OLD_PERMITIR_MOV_CDC_ACERTO" CHAR(1), "EMAIL_UTIL_CERT_TLS" CHAR(1), "PERMITIR_AUTORIZAR_PEDIDO" CHAR(1),
  "PERMITIR_AUTORIZAR_NEC_COMPRA" CHAR(1), "PERMITIR_GER_ITEM_REQ_TRANSF" CHAR(1),
  "PERM_INC_ALT_EXC_ITEM_REQ_TRANS" CHAR(1), "SENHA" BLOB SUB_TYPE 1, "PERMITIR_GEREN_APENAS_PED_USU" CHAR(1) NOT
  NULL, "PERMITIR_DESBLOQUEIO_FECHAMENTO" CHAR(1) NOT NULL, PRIMARY KEY ("USUARIO"));
CREATE TABLE GPPARAMG ("EMPRESA" SMALLINT NOT NULL, "APURACAOPORCDC" VARCHAR(1) NOT NULL, "CONTABILIDADE"
  VARCHAR(1) NOT NULL, "CUSTOS" VARCHAR(1) NOT NULL, "DEPRECIAR" VARCHAR(1) NOT NULL, "FINANCEIRO" VARCHAR(1) NOT
  NULL, "AVSEGREV" VARCHAR(1) NOT NULL, "TIPODEPRECIACAO" CHAR(1) NOT NULL, "RESPONSAVEL" CHAR(1) NOT NULL,
  "DIASREV" SMALLINT NOT NULL, "DIASSEG" SMALLINT NOT NULL, "NOMERESPONSAVEL" VARCHAR(70) NOT NULL,
  "DIAS_GARANTIA" SMALLINT, "APURARCDCPOR" CHAR(1), "FORMA_INTEGRACAO" CHAR(1) NOT NULL, "COEFIC_DEPREC_ACELERADA"
  CHAR(1), "APLICAR_COEFICIENTE" CHAR(1), "TIPO_CALCULO_DEPRECIACAO" CHAR(1) NOT NULL, "CONSIDERA_VALOR_RESIDUAL"
  CHAR(1), PRIMARY KEY ("EMPRESA"));
CREATE TABLE PRPARVARUNIRESP ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(40) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBCATEGO ("COD" SMALLINT NOT NULL, "NOME" VARCHAR(40), PRIMARY KEY ("COD"));
CREATE TABLE TBDISPON ("COD" SMALLINT NOT NULL, "NOME" VARCHAR(40), PRIMARY KEY ("COD"));
CREATE TABLE TBFABOPM ("ID" INTEGER NOT NULL, "COD" SMALLINT NOT NULL, "NOME" VARCHAR(50), "CNPJ" BIGINT, PRIMARY
  KEY ("ID"));
CREATE TABLE TBFORNEC ("COD" INTEGER NOT NULL, "NOME" VARCHAR(82), "EMAIL" BLOB SUB_TYPE 1, "CGC" BIGINT, "REPRE"
  SMALLINT, "ENDERECO" VARCHAR(82), "BAIRRO" VARCHAR(40), "CIDADE" VARCHAR(40), "ID_TBUF" VARCHAR(2),
  "OLD_CONTATO" VARCHAR(25), "INSC_MUN" VARCHAR(15), "OLD_FONE" VARCHAR(15), "INSC_EST" VARCHAR(15), "OLD_FAX"
  VARCHAR(15), "TIPO" VARCHAR(1), "CONTABIL" VARCHAR(18), "CEP" INTEGER, "FANTASIA" VARCHAR(80), "ATIVIDADE"
  VARCHAR(50), "CORRESP" VARCHAR(1), "CERTIFICADO" INTEGER, "DT_CAD" DATE, "OBS" BLOB SUB_TYPE 1, "BANCO"
  SMALLINT, "AGENCIA" VARCHAR(9), "INSS" NUMERIC(9,2), "CORRENTE" VARCHAR(15), "JATROCOU" VARCHAR(1), "ALIQISS"
  NUMERIC(18,8), "ANOCERT" SMALLINT, "IR" VARCHAR(1), "PESSOA" VARCHAR(1), "COFINS" NUMERIC(9,2), "CSLL"
  NUMERIC(9,2), "IMP_INSS" VARCHAR(1), "DESC_PIS" CHAR(1), "ALIQINSS" NUMERIC(4,2), "PED_MIN" NUMERIC(9,2),
  "COD_OPE" INTEGER, "NOMEBCO" VARCHAR(40), "CONTA" BIGINT, "OPT_SIMPLES" VARCHAR(1), "VLR_MIN_ISS" NUMERIC(9,2),
  "HORA_TEC" NUMERIC(18,2), "N_VISITAS" SMALLINT, "DISPONIB" SMALLINT NOT NULL, "VENC_CERTIF" DATE, "DIGITO"
  VARCHAR(2), "CAT_SEFIP" INTEGER, "OCOR_SEFIP" INTEGER, "HEMOTERAPIA" VARCHAR(1), "NUMERO_INSS" VARCHAR(12),
  "COD_DISP" INTEGER, "ID_FPCBO" INTEGER, "IDENTIDADE" VARCHAR(15), "NUMERO" INTEGER, "COMPLEMENTO" VARCHAR(10),
  "DIGITO_AGE" VARCHAR(2), "NDEP" SMALLINT, "TEMPO_ENTREGA" SMALLINT, "FRETE" VARCHAR(15), "COD_BANCO_SANGUE"
  SMALLINT, "OLD_NUMERO_DDD_CELULAR" SMALLINT, "OLD_NUMERO_CELULAR" VARCHAR(15), "REGISTRO_VIGILANCIA_SANITARIA"
  VARCHAR(30), "IBGE" INTEGER NOT NULL, "PRIORIDADE_PGTO_CREDOR_FIN" SMALLINT, "ID_TBCBOPRO" INTEGER, "PIS"
  NUMERIC(9,2), "DATA_NASCIMENTO" DATE, "ID_FPTIPO_TRABALHADOR" INTEGER, "ID_FPCATEGTRAB" SMALLINT,
  "CONT_PREV_FOLHA_PAG" CHAR(1), "IMPOSTOS10REAIS" CHAR(1), "DIGITARIMPOSTOS" CHAR(1), "ID_TBPESSOA" INTEGER,
  "ENDERECO_EXTERIOR" VARCHAR(1), "ALIQUOTA_IR" NUMERIC(4,2), "ALIQUOTA_AGREGADO" NUMERIC(4,2), "INFO_ISEN_IMUN"
  SMALLINT, "BASE_CALCULO_REDUZIDA" VARCHAR(1), "PERCENTUAL_FIXO" CHAR(1), "ALIQUOTA_CBS" NUMERIC(9,2),
  "ALIQUOTA_IBS" NUMERIC(9,2), PRIMARY KEY ("COD"));
CREATE TABLE TBCATFOR ("FORN" INTEGER NOT NULL, "CATEG" SMALLINT NOT NULL, PRIMARY KEY ("FORN","CATEG"));
CREATE TABLE TBFORNECTEL ("ID" INTEGER NOT NULL, "ID_TBFORNEC" INTEGER NOT NULL, "ID_TBTIPOTELEFONE" SMALLINT NOT
  NULL, "NUMERO_TELEFONE" VARCHAR(15) NOT NULL, "ID_TBDDD" SMALLINT, "CONTATO" VARCHAR(50), "RAMAL" SMALLINT,
  PRIMARY KEY ("ID"));
CREATE TABLE TBGRUPOUNIDADEMEDIDA ("ID" INTEGER NOT NULL, "NOME" VARCHAR(20), PRIMARY KEY ("ID"));
CREATE TABLE TBLABORA ("COD" SMALLINT NOT NULL, "NOME" VARCHAR(150), "COD_LAB_BRASINDICE" SMALLINT, PRIMARY KEY
  ("COD"));
CREATE TABLE GEBARRAS ("ITEM" INTEGER NOT NULL, "BARRA" VARCHAR(20) NOT NULL, "FORN" INTEGER, "LAB" SMALLINT,
  PRIMARY KEY ("ITEM","BARRA"));
CREATE TABLE TBSITUACAOFARMACIA ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(50) NOT NULL, "ATIVO" CHAR(1), PRIMARY KEY
  ("ID"));
"""
CARREGADAS = ("GENIVELSERV", "GEPADRAO_DATAMATRIX_QRCODE", "GEPORTALCOMPRAS", "GEREFER", "GESITUACAOPED",
              "GETPLANCTO", "TBCATEGO", "TBFABOPM", "TBGRUPOUNIDADEMEDIDA", "TBLABORA", "TBSITUACAOFARMACIA")
# fora da carga (todas as colunas declaradas sem destino, com motivo): 2 linhas falsas cada. Quando o motor ganhar a
# pendência por tabela (tabela_nao_carregada, pedida na L6-03), entram no esperado.
NAO_CARREGADAS = ("GELOCUSU", "GESALCON", "GESALDOS", "GESUBGRU", "GETPSALDO", "GEULTDOCGER", "GEUSERS", "GPPARAMG",
                  "PRPARVARUNIRESP", "TBDISPON", "TBFORNEC", "TBCATFOR", "TBFORNECTEL", "GEBARRAS")
_COL = re.compile(r'"(\w+)"\s+([A-Z]+)(?:\((\d+)(?:,(\d+))?\))?')


def colunas(tabela):
    """(nome, tipo, tamanho) das colunas da tabela, na ordem do DDL."""
    corpo = " ".join(DDL.split()).split("CREATE TABLE %s (" % tabela)[1].split(", PRIMARY KEY")[0]
    return [(m.group(1), m.group(2), int(m.group(3) or 0)) for m in _COL.finditer(corpo)]


def _generica(tabela, i):
    """Linha genérica e falsa de tabela não carregada: valor inventado pelo tipo de cada coluna."""
    v = []
    for _, tipo, tam in colunas(tabela):
        if tipo in ("INTEGER", "SMALLINT", "BIGINT"):
            v.append(i)
        elif tipo == "DATE":
            v.append(datetime.date(2026, 1, i))
        elif tipo == "NUMERIC":
            v.append(decimal.Decimal(i))
        elif tipo in ("VARCHAR", "CHAR"):
            v.append(("S" if tam == 1 else "X%d" % i)[:tam])
        else:
            v.append(None)
    return v


def linhas(r, ins):
    for t in NAO_CARREGADAS:
        for i in (1, 2):
            ins(t, _generica(t, i))
    D = decimal.Decimal
    # nível de serviço: 3 com percentual 0 e 5 com fator negativo (CHECK: 4025); 4 repete o percentual de 1 (1062)
    for v in [(1, D("95.00"), D("1.645")), (2, D("90.00"), D("1.282")), (3, D("0.00"), D("1.000")),
              (4, D("95.00"), D("0.500")), (5, D("99.90"), D("-0.100"))]:
        ins("GENIVELSERV", list(v))
    # padrão de leitura: 2 com espaços internos (preservados); 3 só com espaços (1048)
    for v in [(1, "Padrão exemplo (01)(17)(10)"), (2, "  Padrão  QR exemplo  "), (3, "   ")]:
        ins("GEPADRAO_DATAMATRIX_QRCODE", list(v))
    for v in [(1, "Portal de cotação exemplo"), (2, "Portal ação exemplo"), (3, "")]:
        ins("GEPORTALCOMPRAS", list(v))
    # categoria contábil: 2 com espaços repetidos; 3 com S/N inválido; 4 sem nome (1048); 5 com S/N nulo
    for v in [(1, "Medicamentos exemplo", "UN", "S", 1, 10, 1), (2, "  Material   médico  ", "CX", "N", 2, 20, 1),
              (3, "Consignados exemplo", "UN", "X", 3, 30, 2), (4, None, "UN", "S", 4, 40, 1),
              (5, "Órteses exemplo", None, None, 5, 50, 2)]:
        ins("GEREFER", list(v))
    for v in [(1, "Aberto exemplo"), (2, "Autorizado   exemplo"), (3, None)]:
        ins("GESITUACAOPED", list(v))
    for v in [(1, "Entrada exemplo"), (2, "Saída exemplo"), (3, "Ajuste exemplo")]:
        ins("GETPLANCTO", list(v))
    for v in [(1, "Medicamentos exemplo"), (2, None), (3, "Serviços exemplo")]:
        ins("TBCATEGO", list(v))
    # CNPJ fictício: 1 com dígito verificador certo (volta a 14 dígitos), 3 errado (NULL + documento_invalido)
    for v in [(1, 1, "Fabricante OPM exemplo", 11222333000181), (2, 2, "   ", None),
              (3, 3, "Fabricante OPM três", 12345678000199)]:
        ins("TBFABOPM", list(v))
    for v in [(1, "Massa exemplo"), (2, "Volume  exemplo"), (3, None)]:
        ins("TBGRUPOUNIDADEMEDIDA", list(v))
    for v in [(1, "Laboratório exemplo um", 101), (2, "  Laboratório   dois  ", None), (3, "L" * 150, 7),
              (4, None, 5)]:
        ins("TBLABORA", list(v))
    for v in [(1, "Liberado exemplo", "S"), (2, "Suspenso exemplo", "N"), (3, "Aguardando exemplo", "X"),
              (4, "Substituído exemplo", None)]:
        ins("TBSITUACAOFARMACIA", list(v))
    return {
        "GENIVELSERV": {"gravados": 2, "pendencias": {"restricao_destino_4025": 2, "restricao_destino_1062": 1}},
        "GEPADRAO_DATAMATRIX_QRCODE": {"gravados": 2, "pendencias": {"valor_presumido": 3,
                                                                     "restricao_destino_1048": 1}},
        "GEPORTALCOMPRAS": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "GEREFER": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "GESITUACAOPED": {"gravados": 2, "pendencias": {"valor_presumido": 9, "restricao_destino_1048": 1}},
        "GETPLANCTO": {"gravados": 3, "pendencias": {"valor_presumido": 9}},
        "TBCATEGO": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "TBFABOPM": {"gravados": 2, "pendencias": {"valor_presumido": 6, "restricao_destino_1048": 1,
                                                   "documento_invalido": 1}},
        "TBGRUPOUNIDADEMEDIDA": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "TBLABORA": {"gravados": 3, "pendencias": {"valor_presumido": 8, "restricao_destino_1048": 1}},
        "TBSITUACAOFARMACIA": {"gravados": 4, "pendencias": {"valor_presumido": 8, "valor_fora_do_dominio": 1}},
    }
