"""Fatia L7-06 (suprimentos, módulo SUP: cadastros de estoque, compras e fornecedores): tabelas da origem com a forma
do dicionário e dados 100% falsos.

Cobertura total (colunas.d/L7-06.tsv): 25 tabelas carregadas. Rodada 5 (ADR 0006): GETPSALDO, GEULTDOCGER, GPPARAMG e
TBDISPON deixam o descarte e carregam na trilha (retrato completo; GEULTDOCGER uma linha por tipo e mês com a lista
dos números gerados); TBDISPON continua lida pela referência encadeada do fornecedor.
Rodada 2 da cobertura: GESALDOS (histórico mensal do saldo consolidado) e GESALCON (saldo consignado do fornecedor)
carregam na trilha do insumo (âncora `complementa` no insumo, um valor por linha pelo `desdobrar`); TBFORNEC grava a
conta bancária do credor só com CONTA preenchida (desdobrar) e as retenções na trilha da empresa; GEREFER guarda a
conta e a operação contábil antigas na trilha da categoria.
Carregadas: GENIVELSERV, GEPADRAO_DATAMATRIX_QRCODE, GEPORTALCOMPRAS, GEREFER, GESITUACAOPED, GETPLANCTO, TBCATEGO,
TBFABOPM e TBLABORA (fabricante), TBGRUPOUNIDADEMEDIDA, TBSITUACAOFARMACIA e, nesta rodada: GELOCUSU e GEUSERS
(local_estoque_usuario, par local x usuário ADOTADO entre as duas), GESUBGRU (código derivado do nome),
PRPARVARUNIRESP (unidade_resposta), TBFORNEC (fornecedor: tipo por de-para J/F, CNPJ com adoção, disponibilidade pelo
nome de TBDISPON), TBCATFOR, TBFORNECTEL e GEBARRAS (unidade pela referência encadeada ao insumo).
Anomalias: descrição nula ou só com espaços (NOT NULL: restricao_destino_1048), S/N fora do domínio
(valor_fora_do_dominio), CHECK (4025), UNIQUE (1062), literal presumido (valor_presumido), pai inexistente e pai
recusado (pai_pendente), par repetido adotado (adotado_existente), documento inválido (documento_invalido, inclusive a
regra cruzada CPF x CNPJ da mesma coluna), nome longo (codigo_derivado, texto_resumido), município fora do catálogo
(catalogo_codigo_inexistente). Pais de fora da fatia em PAIS_EXTERNOS; GEITENS não está na imagem, então o código de
barras é recusado (unidade pela referência encadeada ao insumo: pai_inexistente) e a prova do sucesso fica no
mecanismo (sintetica_d/exemplo_cob.py).
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
              "GETPLANCTO", "TBCATEGO", "TBFABOPM", "TBGRUPOUNIDADEMEDIDA", "TBLABORA", "TBSITUACAOFARMACIA",
              "GELOCUSU", "GESUBGRU", "GEUSERS", "PRPARVARUNIRESP", "TBFORNEC", "TBCATFOR", "TBFORNECTEL", "GEBARRAS",
              "GESALDOS", "GESALCON")
# descarte de produto (declarado/sem_carga.tsv): só a forma, 2 linhas falsas cada (TBDISPON com nomes, 3 linhas)
# r5c: GEULTDOCGER PENDENTE (pedido r5b_sequencia_por_competencia); GPPARAMG em parametro_valor
TRILHA_R5 = ("GETPSALDO", "GPPARAMG", "TBDISPON")
TRILHA_R6 = ("GEULTDOCGER",)  # r6: numeração por tipo e competência em sequencia_documento_estoque
BLOQUEADAS = ()  # r6: GEULTDOCGER carrega em sequencia_documento_estoque (agrupado por tipo e mês)
CARREGADAS = CARREGADAS + TRILHA_R5 + TRILHA_R6
DESCARTADAS = ()
PAIS_EXTERNOS = {"TBUSERS": ["almox.exemplo", "farm.exemplo", "novo.exemplo"], "GELOCARM": [1, 2, 3],
                 "GEGRUPOS": [1, 2], "GEITENS": [10, 20], "TBTIPOTELEFONE": [1]}
PREPARO_DESTINO = ("INSERT INTO municipio_ibge (codigo_ibge, nome, unidade_federativa_id, criado_em) VALUES"
                   " ('3550308', 'Municipio exemplo', 1, UTC_TIMESTAMP(3));\n"
                   "INSERT INTO banco (codigo_compensacao, codigo_ispb, descricao, vigencia_inicio, versao_fonte,"
                   " criado_em) VALUES ('237', '00000237', 'Banco ficticio', '2020-01-01', 'exemplo', UTC_TIMESTAMP(3));\n"
                   # o insumo de fora da fatia (PAIS_EXTERNOS GEITENS 10 e 20 recebem os ids 3 e 4, na ordem dos pais) tem
                   # de existir no destino: GESALDOS e GESALCON o complementam (âncora da trilha)
                   "SET FOREIGN_KEY_CHECKS=0;\n"
                   "INSERT INTO insumo (id, codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, criado_em)"
                   " VALUES (3, '10', 'Insumo exemplo dez', 'material', 1, 1, UTC_TIMESTAMP(3)),"
                   " (4, '20', 'Insumo exemplo vinte', 'material', 2, 1, UTC_TIMESTAMP(3));\n"
                   "SET FOREIGN_KEY_CHECKS=1")
# colunas numéricas do fornecedor zeradas na linha genérica (retenções e valores; o teste escolhe as que preenche)
NUMERICAS_FORNECEDOR = ("INSS", "ALIQISS", "COFINS", "CSLL", "ALIQINSS", "PED_MIN", "VLR_MIN_ISS", "HORA_TEC", "PIS",
                        "ALIQUOTA_IR", "ALIQUOTA_AGREGADO", "ALIQUOTA_CBS", "ALIQUOTA_IBS")


def cnpj_falso(base12):
    """CNPJ inventado com dígitos verificadores válidos (inteiro, como a origem guarda)."""
    d = [int(x) for x in "%012d" % base12]
    for w in ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]):
        r = sum(x * p for x, p in zip(d, w)) % 11
        d.append(0 if r < 2 else 11 - r)
    return int("".join(map(str, d)))


def cpf_falso(base9):
    """CPF inventado com dígitos verificadores válidos (inteiro)."""
    d = [int(x) for x in "%09d" % base9]
    for n in (10, 11):
        r = sum(x * p for x, p in zip(d, range(n, 1, -1))) % 11
        d.append(0 if r < 2 else 11 - r)
    return int("".join(map(str, d)))


CNPJ_A, CNPJ_B, CNPJ_C = cnpj_falso(112223330001), cnpj_falso(445556660001), cnpj_falso(778889990001)
CPF_A = cpf_falso(123456780)
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


def _por_nome(tabela, i, **v):
    """Linha genérica e falsa com as colunas nomeadas trocadas."""
    nomes = [n for n, _, _ in colunas(tabela)]
    linha = _generica(tabela, i)
    for k, x in v.items():
        linha[nomes.index(k)] = x
    return linha


def linhas(r, ins):
    D = decimal.Decimal
    # saldo mensal consolidado (sem local): insumo 10 em 12/2025 (3 valores = 3 linhas na trilha, zero conta) e 01/2026
    # sem estoque médio (2 linhas); insumo 20 com mês 13 (competência inválida: NULL, valor_fora_do_dominio e 1048);
    # insumo 30 nunca visto (pai_inexistente, recusa: o complemento exige o insumo)
    for v in [(2025, 12, 10, D("5.000"), D("50.00"), D("4.500")), (2026, 1, 10, D("0.000"), D("0.00"), None),
              (2026, 13, 20, D("1.000"), D("2.00"), D("1.000")), (2026, 1, 30, D("1.000"), D("1.00"), None)]:
        ins("GESALDOS", list(v))
    # saldo consignado: fornecedor 1 e insumo 20 (1 linha com o retrato); insumo 30 nunca visto (pai_inexistente)
    for v in [(1, 20, D("3.000")), (2, 30, D("1.000"))]:
        ins("GESALCON", list(v))
    # r5c: os 3 itens do tipo de saldo (prova derivado por ID 1..3)
    for i in (1, 2, 3):
        ins("GETPSALDO", _generica("GETPSALDO", i))
    # r5c: parâmetros do patrimônio (a origem tem uma linha): 18 colunas, DIAS_GARANTIA vazio não gera item -> 17
    # itens em parametro_valor do estabelecimento (S/N -> sim/nao; códigos como estão; dias; nome)
    ins("GPPARAMG", [1, "S", "N", "S", "S", "N", "S", "L", "1", 30, 15, "Responsavel exemplo", None, "A", "1", "2",
                     "X", "1", "N"])
    # r6: números gerados -> sequencia_documento_estoque por tipo e mês: tipo 1 em 01/2025 (2 linhas, um grupo:
    # próximo 12), tipo 2 em 02/2025 (próximo 6), tipo 9 nunca visto (NOT NULL recusa) e mês 13 (competência
    # inválida: ano e mês valor_fora_do_dominio, o CHECK do período recusa)
    for v in [(1, 202501, 10), (1, 202501, 11), (2, 202502, 5), (9, 202503, 1), (3, 202513, 1)]:
        ins("GEULTDOCGER", list(v))
    for v in [(1, "COMERCIAL"), (2, "Plantão 24 horas")]:
        ins("TBDISPON", list(v))
    # usuário x local: 1|1 criado e adotado pelo segundo tipo de movimento; usuário e local inexistentes (1048)
    for v in [("almox.exemplo", 1, "EN"), ("almox.exemplo", 1, "SA"), ("almox.exemplo", 2, "EN"),
              ("farm.exemplo", 1, "EN"), ("ninguem.exemplo", 1, "EN"), ("almox.exemplo", 9, "EN")]:
        ins("GELOCUSU", list(v))
    # local padrão: almox|1 já criado por GELOCUSU (adotado); farm|3 com S/N inválido; novo sem local (1048)
    ins("GEUSERS", _por_nome("GEUSERS", 1, USUARIO="almox.exemplo", LOC_ARM=1))
    ins("GEUSERS", _por_nome("GEUSERS", 2, USUARIO="farm.exemplo", LOC_ARM=3, VISUAL_PRECO="X"))
    ins("GEUSERS", _por_nome("GEUSERS", 3, USUARIO="novo.exemplo", LOC_ARM=None))
    # subgrupo: mesmo COD em grupos diferentes (ok); nome repetido entre grupos (1062); nome longo (codigo_derivado);
    # grupo inexistente e nome nulo (1048)
    for v in [(1, 1, "Comprimidos exemplo", 0), (2, 1, "Ampolas exemplo", 5), (2, 2, "Comprimidos exemplo", None),
              (1, 2, "Subgrupo de nome comprido demais ex", None), (9, 1, "Grupo inexistente exemplo", None),
              (1, 3, None, None)]:
        ins("GESUBGRU", list(v))
    for v in [(1, "kg exemplo"), (2, "Dias de tratamento exemplo longo"), (3, "   ")]:
        ins("PRPARVARUNIRESP", list(v))
    # fornecedor: 1 jurídica, 2 física, 3 mesmo CNPJ de 1 (adotado), 4 tipo inválido (1048), 5 CNPJ inválido
    # (CHECK 4025), 6 disponibilidade sem par e município fora do catálogo. A regra cruzada da mesma coluna (CPF x
    # CNPJ) deixa um documento_invalido por linha até o destino condicional pelo tipo de pessoa.
    f = [dict(PESSOA="J", CGC=CNPJ_A, NOME="Fornecedor exemplo um", CEP=1310100, IBGE=3550308, DISPONIB=1,
              EMAIL="compras@exemplo.invalid", NUMERO=100),
         dict(PESSOA="F", CGC=CPF_A, NOME="Fornecedora pessoa exemplo", CEP=None, IBGE=3550308, DISPONIB=2, NUMERO=0),
         dict(PESSOA="J", CGC=CNPJ_A, NOME="Fornecedor exemplo filial", IBGE=3550308, DISPONIB=1),
         dict(PESSOA="X", CGC=CNPJ_B, NOME="Fornecedor tipo errado", IBGE=3550308, DISPONIB=1),
         dict(PESSOA="J", CGC=12345678000199, NOME="Fornecedor documento errado", IBGE=3550308, DISPONIB=1),
         dict(PESSOA="J", CGC=CNPJ_C, NOME="  Fornecedor   seis  ", CEP=None, IBGE=9999999, DISPONIB=3)]
    D = decimal.Decimal
    # conta do credor: 1 com banco do catálogo (gravada); 2 (pessoa física) com conta zero (sem conta); 6 com banco
    # fora do catálogo e sem conta (catalogo_codigo_inexistente, sem conta); os demais sem conta (nenhuma linha)
    # retenções: 1 com ISS, PIS, Cofins e CSLL (4 linhas na trilha); 2 com IR (1 linha); zeros não geram linha
    banco = {1: dict(BANCO=237, CONTA=123456, AGENCIA="1234", DIGITO_AGE="5", DIGITO="0"),
             2: dict(BANCO=237, CONTA=0, AGENCIA="99", DIGITO_AGE=None, DIGITO=None),
             6: dict(BANCO=999, CONTA=None, AGENCIA=None, DIGITO_AGE=None, DIGITO=None)}
    ret = {1: dict(ALIQISS=D("2.00000000"), PIS=D("0.65"), COFINS=D("3.00"), CSLL=D("1.00")),
           2: dict(ALIQUOTA_IR=D("1.50"))}
    for i, v in enumerate(f, 1):
        z = {c: D(0) for c in NUMERICAS_FORNECEDOR}
        z.update(dict(BANCO=None, CONTA=None, AGENCIA=None, DIGITO_AGE=None, DIGITO=None))
        z.update(banco.get(i, {}))
        z.update(ret.get(i, {}))
        z.update(v)
        ins("TBFORNEC", _por_nome("TBFORNEC", i, COD=i, **z))
    # categoria: 3|1 repete o par de 1|1 (fornecedor adotado); categoria 2 e fornecedor 5 recusados (pai_pendente);
    # fornecedor 9 inexistente (1048)
    for v in [(1, 1), (3, 1), (2, 2), (5, 3), (9, 3)]:
        ins("TBCATFOR", list(v))
    # contato: tipo 2 inexistente (gravado sem tipo); fornecedor 5 recusado; número vazio (CHECK 4025)
    for v in [(1, 1, 1, "3333-0001", 11, "Contato exemplo", 12), (2, 1, 1, "99999-0002", 11, None, 0),
              (3, 2, 2, "3333-0003", None, None, None), (4, 5, 1, "3333-0004", None, None, None),
              (5, 6, 1, "  ", None, None, None)]:
        ins("TBFORNECTEL", list(v))
    # código de barras: GEITENS fora da imagem, a unidade (encadeada) é pai_inexistente e a linha é recusada (1048);
    # insumo 30 também inexistente. Na carga real o insumo vem DEPOIS (ordem do mapa): a aresta GEBARRAS -> GEITENS
    # está pedida em saida/L7-06.json; até ela, nenhum código de barras carrega (esperado 0, visível)
    for v in [(10, "7890000000017", 1, 1), (10, "7890000000024", None, None), (30, "7890000000031", None, None)]:
        ins("GEBARRAS", list(v))
    # nível de serviço: 3 com percentual 0 e 5 com fator negativo (CHECK: 4025); 4 repete o percentual de 1 (1062)
    for v in [(1, D("95.00"), D("1.645")), (2, D("90.00"), D("1.282")), (3, D("0.00"), D("1.000")),
              (4, D("95.00"), D("0.500")), (5, D("99.90"), D("-0.100"))]:
        ins("GENIVELSERV", list(v))
    # padrão de leitura: 2 com espaços internos (preservados); 3 só com espaços (1048)
    for v in [(1, "Padrão exemplo (01)(17)(10)"), (2, "  Padrão  QR exemplo  "), (3, "   ")]:
        ins("GEPADRAO_DATAMATRIX_QRCODE", list(v))
    for v in [(1, "Portal de cotação exemplo"), (2, "Portal ação exemplo"), (3, "")]:
        ins("GEPORTALCOMPRAS", list(v))
    # categoria contábil: 2 com espaços repetidos; 3 com S/N inválido; 4 sem nome (1048); 5 com S/N nulo e operação
    # contábil 0 (só a conta antiga vai para a trilha: 7 linhas nas 4 gravadas)
    for v in [(1, "Medicamentos exemplo", "UN", "S", 1, 10, 1), (2, "  Material   médico  ", "CX", "N", 2, 20, 1),
              (3, "Consignados exemplo", "UN", "X", 3, 30, 2), (4, None, "UN", "S", 4, 40, 1),
              (5, "Órteses exemplo", None, None, 0, 50, 2)]:
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
        # r6: 3 linhas da origem em 2 sequências (tipo 1/01-2025 próximo 12; tipo 2/02-2025 próximo 6)
        "GEULTDOCGER": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1,
                                                      "valor_fora_do_dominio": 2, "restricao_destino_4025": 1}},
        "TBCATEGO": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "TBFABOPM": {"gravados": 2, "pendencias": {"valor_presumido": 6, "restricao_destino_1048": 1,
                                                   "documento_invalido": 1}},
        "TBGRUPOUNIDADEMEDIDA": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "TBLABORA": {"gravados": 3, "pendencias": {"valor_presumido": 8, "restricao_destino_1048": 1}},
        "TBSITUACAOFARMACIA": {"gravados": 4, "pendencias": {"valor_presumido": 8, "valor_fora_do_dominio": 1}},
        # rodada 2: com a aresta GELOCUSU -> GEUSERS (pedida pela fatia), GEUSERS grava antes e o local por usuário
        # adota as duas linhas de usuário_local que já existem
        # recusas fase 2 (A08): o local 9 nunca visto é criado inativo (secundário) e a linha grava; sobra o usuário
        # nunca visto (pai_inexistente + 1048). valor_presumido: as 2 presumidas do local secundário em cada linha (6)
        "GELOCUSU": {"gravados": 5, "pendencias": {"adotado_existente": 3, "pai_inexistente": 1,
                                                   "restricao_destino_1048": 1, "valor_presumido": 12}},
        # recusas fase 2 (A10): sem LOC_ARM o usuário 3 vai ao ARM1 (concorrente, padrão falso) e grava; a condição
        # se:LOC_ARM>GELOCARM>COD lê o local na origem, que esta imagem não tem (pai externo): pai_inexistente nas 2
        # linhas com LOC_ARM
        "GEUSERS": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "pai_inexistente": 2}},
        # recusas fase 2 (A05): o código vem de GRU+COD (único na tabela toda): o nome repetido entre grupos e o nome
        # comprido gravam (sem 1062 nem codigo_derivado)
        "GESUBGRU": {"gravados": 4, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 2}},
        "PRPARVARUNIRESP": {"gravados": 2, "pendencias": {"texto_resumido": 1, "restricao_destino_1048": 1}},
        # documento_invalido: a regra cruzada CPF x CNPJ da mesma coluna (6) + o CNPJ errado da linha 5 na empresa e
        # no titular da conta (2); catálogo: município da linha 6 e banco 999 da linha 6 (sem conta: nada gravado)
        "TBFORNEC": {"gravados": 4, "pendencias": {"documento_invalido": 8, "adotado_existente": 1,
                                                   "mescla_conflito_origem_guardada": 1,
                                                   # r6: disponibilidade 3 sem linha na lista do cliente (TBDISPON):
                                                   # pai_inexistente pela encadeada (antes valor_fora_do_dominio)
                                                   "pai_inexistente": 1, "valor_fora_do_dominio": 1, "restricao_destino_1048": 1,
                                                   "restricao_destino_4025": 1, "catalogo_codigo_inexistente": 2}},
        "TBCATFOR": {"gravados": 2, "pendencias": {"adotado_existente": 1, "pai_pendente": 2, "pai_inexistente": 1,
                                                   "restricao_destino_1048": 1}},
        "TBFORNECTEL": {"gravados": 3, "pendencias": {"valor_presumido": 4, "pai_inexistente": 1, "pai_pendente": 1,
                                                      "restricao_destino_4025": 1}},
        "GEBARRAS": {"gravados": 0, "pendencias": {"pai_inexistente": 4, "restricao_destino_1048": 3}},
        "GESALDOS": {"gravados": 2, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1,
                                                   "pai_inexistente": 1}},
        "GESALCON": {"gravados": 1, "pendencias": {"pai_inexistente": 1}},
        "GETPSALDO": {"gravados": 3, "pendencias": {}},
        "GPPARAMG": {"gravados": 17, "pendencias": {"vigencia_sem_fonte": 1}},  # r6: linha sem evidência de data (ADR 0007, 16): pendência baixa
        "TBDISPON": {"gravados": 2, "pendencias": {}},
    }


# r5c: catálogo de parâmetros do patrimônio NA IMAGEM DE TESTE (no produto é semente, pedido r5b_parametros_patrimonio;
# sem ela cada item recusa com codigo_inexistente_destino). Prova positiva do desdobrar em parametro_valor.
PREPARO_DESTINO = PREPARO_DESTINO + (
    ";\nINSERT INTO estabelecimento (id, codigo) SELECT 1, 'exemplo' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento)"
    # r6: o único estabelecimento do cliente (@estabelecimento de GPPARAMG e GEULTDOCGER), como nas outras fatias
    ";\nINSERT IGNORE INTO modulo_sistema (codigo, descricao, ativo, criado_em) VALUES"
    " ('patrimonio', 'Patrimonio', 1, UTC_TIMESTAMP(3));\n"
    "INSERT IGNORE INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, permite_estabelecimento,"
    " criado_em) SELECT d.chave, m.id, d.chave, d.tipo, 1, UTC_TIMESTAMP(3) FROM modulo_sistema m JOIN (\n"
    "SELECT 'x' AS chave, 'texto' AS tipo FROM DUAL WHERE 1 = 0" + "".join(
        "\nUNION ALL SELECT '%s', '%s'" % kt for kt in [
  ('patrimonio.apuracao_por_centro_custo', 'booleano'),
  ('patrimonio.integra_contabilidade', 'booleano'),
  ('patrimonio.integra_custos', 'booleano'),
  ('patrimonio.depreciar', 'booleano'),
  ('patrimonio.integra_financeiro', 'booleano'),
  ('patrimonio.aviso_seguro_revisao', 'booleano'),
  ('patrimonio.tipo_depreciacao', 'texto'),
  ('patrimonio.responsavel', 'texto'),
  ('patrimonio.dias_aviso_revisao', 'inteiro'),
  ('patrimonio.dias_aviso_seguro', 'inteiro'),
  ('patrimonio.nome_responsavel', 'texto'),
  ('patrimonio.dias_garantia', 'inteiro'),
  ('patrimonio.apurar_centro_custo_por', 'texto'),
  ('patrimonio.forma_integracao', 'texto'),
  ('patrimonio.coeficiente_depreciacao_acelerada', 'texto'),
  ('patrimonio.aplicar_coeficiente', 'texto'),
  ('patrimonio.tipo_calculo_depreciacao', 'texto'),
  ('patrimonio.considera_valor_residual', 'booleano')
    ]) + ") d WHERE m.codigo = 'patrimonio'")
