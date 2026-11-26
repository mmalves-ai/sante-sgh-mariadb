"""Fatia L7-07 (SADT e suprimentos, módulo SUP): tabelas da origem com os mesmos nomes e tipos do dicionário (só as
colunas lidas pela carga, mais a chave) e dados 100% falsos.

Carregadas (CARREGADAS, 20): as 11 da rodada de cobertura (regra de envio à avaliação farmacêutica, unidade,
insumo, apresentação, unidade do insumo, lote, item do kit rastreável, lote do inventário de abertura, via, item do kit
padrão, saldo do item do kit) e, na rodada 3, balanço (inventário + rodada única) e seus itens, pedido de compra, item
da nota (cria o cabeçalho agrupado por ANO, MES, DOC e o movimento de entrada), cabeçalho da nota (complementa pelo
número), lote por movimento (nota e transferência, pelo destino secundário do pai), consumo do paciente (movimento de
saída) e princípio ativo do insumo (NOME do princípio do hospital no catálogo oficial, `cod:`). Rodada 4: princípio
do cadastro do hospital (principio_ativo_cliente) e saldo do lote por local (saldo_lote). Descartadas (DESCARTADAS, 4)
em `declarado/sem_carga.tsv`; nenhuma bloqueada. TBCENCUS e TBCBOPRO entram só como origem lida pela referência
(ORIGEM_PAIS, fora do plano pelo MAPA_TESTE).
Anomalias cobertas:
- nome nulo (NOT NULL do destino: restricao_destino_1048), literais presumidos (valor_presumido por linha lida);
- código que só difere pela caixa na unidade (codigo_colisao_caixa: o grupo todo recusado) e filhos dele
  (pai_pendente em cadeia: insumo -> apresentação, unidade do insumo, lote, via, kit);
- S/N e A/I fora do domínio (valor_fora_do_dominio, fica o padrão do destino);
- pai nunca visto em coluna anulável (NULL com pai_inexistente) e NOT NULL (pai_inexistente e recusa);
- lote físico repetido em outro local (adotado_existente); chave única do destino repetida (1062; no item do kit é a
  kit rastreável o par kit+insumo repetido ADOTA o item e grava o lote; sem lote, só o item), CHECK violado (4025: estoque máximo < mínimo, dose máxima < mínima, fator
  e quantidade zero, lote do inventário sem lote cadastrado nem informado), texto mais longo que o destino (1406);
- data sentinela na validade do lote (data_sentinela e recusa: datas inválidas a sanear);
- BLOB de texto com quebra de linha e espaços internos preservados; pais de fora da fatia (PAIS_EXTERNOS).
- referência encadeada com pai recusado (pai_pendente) e com lote nunca visto (pai_inexistente nos dois passos);
- complemento de linha recusada (pai_pendente), sem pai (pai_inexistente) e negativo (valor_fora_do_dominio);
- curva fora do domínio (valor_fora_do_dominio, sem recusar o insumo);
- rodada 3: número de balanço repetido em outro mês (1062), item repetido na contagem (1062), balanço recusado e
  nunca visto, pedido sem fornecedor e aprovado sem data (data_sentinela e 4025), nota com dois locais, SEQ
  repetida na nota, QTDE_ARM vazia (coluna concorrente), fator zero (padrão), lote de movimento nunca visto, hora
  inválida, internação fora do cadastro de atendimentos, código DCB vazio e fora do catálogo.
"""
import datetime
import decimal
import re

DDL = """
CREATE TABLE TBTP_ENV_LISTA_AVAL_FARM (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(200), ATIVO CHAR(1));
CREATE TABLE TBUNICON (COD VARCHAR(7) NOT NULL PRIMARY KEY, NOME VARCHAR(40), SITUACAO VARCHAR(1), REF_UNIMED SMALLINT,
  ID_TBTISSUNIDMED SMALLINT, SEQ INTEGER);
CREATE TABLE GEITENS (COD INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(60), GRU SMALLINT, SUB SMALLINT, UNI_ARM VARCHAR(7),
  UNI_COMP VARCHAR(7), UNI_CON VARCHAR(7), COD_DCB VARCHAR(10), EST_MIN NUMERIC(18,3), EST_MAX NUMERIC(18,3),
  EST_SEG NUMERIC(18,3), VLR_MAX_SUG DOUBLE PRECISION, INFCOMPL BLOB SUB_TYPE 1, COBRAR VARCHAR(1), PADRONIZADO CHAR(1),
  PRESC_ENF VARCHAR(1), NECES_JUST VARCHAR(1), DIETORAL VARCHAR(1) NOT NULL, DIETENT VARCHAR(1) NOT NULL,
  DIETPARENT VARCHAR(1) NOT NULL, MEDURG VARCHAR(1) NOT NULL, FRAC VARCHAR(1), PSICO VARCHAR(1), ANTIMI VARCHAR(1),
  CONVER NUMERIC(18,3), FATOR_CONV NUMERIC(18,3), UNI_PRESC VARCHAR(7), RASTREAR SMALLINT NOT NULL,
  DOSE VARCHAR(15), MANIPULACAO VARCHAR(1), CURVA VARCHAR(1), CURVA_XYZ CHAR(1), PEP VARCHAR(1), ITEM_DIST_UNICA
  VARCHAR(1), MEDGERAL VARCHAR(1), MAT VARCHAR(1), SOLUCAO VARCHAR(1), PORTARIA VARCHAR(2), CLASSIF SMALLINT, REF
  INTEGER, TIPO_REF SMALLINT, COD_SIMPAS VARCHAR(15), BRASIN INTEGER, DATA_EI DATE, DATA_EM4 DATE, VLRMED NUMERIC(18,4), CUSTO
  NUMERIC(18,4), VENDA NUMERIC(18,4), VLR_UNF NUMERIC(18,4), VLR_USU NUMERIC(18,4), LUCR100 NUMERIC(9,2), CUST100
  NUMERIC(9,2), EST_INI NUMERIC(18,3), ESTOQUE NUMERIC(18,3), TOTAL NUMERIC(18,2), MOVI_E VARCHAR(1), MOVI_S
  VARCHAR(1), MOVI_D VARCHAR(1), MOVI_R VARCHAR(1), MOVI_L VARCHAR(1), MOV_TRANSFERENCIA VARCHAR(1), ATU_FAT
  VARCHAR(1), EMITIDO VARCHAR(1), BARRAS VARCHAR(1), CONTABIL BIGINT, FORMA SMALLINT, ID_TBUNICON_FORM_FARMA
  VARCHAR(7), ITEM_REF VARCHAR(1), PROC_SIA INTEGER, MEDESPAIH VARCHAR(1), ID_MEDESPAIH INTEGER, CALC_MIN_MAX
  VARCHAR(1), PONTO_PEDIDO NUMERIC(18,3), COMPRA VARCHAR(1), COT_APRES VARCHAR(1), COT_REG_MS VARCHAR(1),
  COT_PRAZO VARCHAR(1), COT_MARCA VARCHAR(1), COT_CONDI VARCHAR(1), ITEM_NEC_AUTORIZACAO_ORCAMENTO CHAR(1), DCB
  INTEGER, OLD_PRINC SMALLINT, DATA_CAD DATE, DATA_HORA_INCLUSAO TIMESTAMP, DATA_HORA_ULTIMA_ATUALIZACAO
  TIMESTAMP, SELETIVO VARCHAR(1), UNI_MP VARCHAR(7), FATOR_CONV_MP NUMERIC(18,3), VALIDADE_MP SMALLINT,
  TP_VALIDADE_MP VARCHAR(1), VALIDADE_SOBRA SMALLINT, TP_VALIDADE_SOBRA VARCHAR(1), CARACT_MP BLOB SUB_TYPE 1,
  CUIDADOS_MP BLOB SUB_TYPE 1, ID_GEGRUPOMP INTEGER, PERMITE_EXCLUIR_MANIPUL_SAIDA CHAR(1), ID_GENIVELSERV
  SMALLINT, ID_GETPSALDO INTEGER, VALIDADE_REDUZIDA SMALLINT, PRODUTO_LEITE VARCHAR(1), BUSCARNOMECOMEROBS
  VARCHAR(1), TRANSICAO VARCHAR(1), ID_TBTP_ENV_LISTA_AVAL_FARM SMALLINT);
CREATE TABLE GENOMCOM (ID_NOMCOM INTEGER NOT NULL PRIMARY KEY, ITEM INTEGER NOT NULL, COD SMALLINT NOT NULL,
  NOME VARCHAR(40), LAB SMALLINT, TIPO_REF INTEGER NOT NULL, BRASIN INTEGER NOT NULL, ATIVO VARCHAR(1) NOT NULL,
  BARRA VARCHAR(20));
CREATE TABLE GEUNIPRESC (ID INTEGER NOT NULL PRIMARY KEY, ITEM INTEGER NOT NULL, UNI_PRESC VARCHAR(7) NOT NULL,
  ORDEM SMALLINT, FATOR_CONV NUMERIC(18,3), FATOR_CONV_MP NUMERIC(18,3), DOSE_MINIMA NUMERIC(18,3),
  DOSE_MAXIMA NUMERIC(18,3));
CREATE TABLE GEVALMEM (ID INTEGER NOT NULL PRIMARY KEY, ITEM INTEGER NOT NULL, LOTE VARCHAR(30) NOT NULL,
  DATA DATE NOT NULL, ID_TBLABORA SMALLINT, DATA_ORIGINAL DATE, DATAMATRIX_QRCODE VARCHAR(100), LOCAL SMALLINT NOT NULL,
  QTDE NUMERIC(18,3), QTDE_KIT NUMERIC(18,3) NOT NULL, QTDE_ORIGINAL NUMERIC(18,3) NOT NULL, DATA_REDUCAO DATE,
  ID_SEQ_LOTE_ITEM INTEGER NOT NULL, TIPO_DOC VARCHAR(1) NOT NULL, FORN INTEGER, DOC INTEGER, ANO SMALLINT, MES SMALLINT,
  ID_GENOMCOM INTEGER);
CREATE TABLE GEITEMKITRAS (ID INTEGER NOT NULL PRIMARY KEY, ID_GEKITRAS INTEGER NOT NULL, ID_GEITENS INTEGER NOT NULL,
  ID_GEVALMEM INTEGER, ID_TBUNICON VARCHAR(7) NOT NULL, QUANTIDADE NUMERIC(18,3) NOT NULL, ITEM_OBRIGATORIO CHAR(1));
CREATE TABLE GERASVALESTINI (ID INTEGER NOT NULL PRIMARY KEY, ID_GELANESI INTEGER NOT NULL, QTDE NUMERIC(18,3),
  ID_GEVALMEM INTEGER, DATA DATE, LOTE VARCHAR(30), ID_GERASVALFINAL INTEGER);
CREATE TABLE GEVIASITEM (ITEM INTEGER NOT NULL, VIA VARCHAR(2) NOT NULL, CONSTRAINT PK_GEVIASITEM PRIMARY KEY (ITEM, VIA));
CREATE TABLE GEKITITE (KIT SMALLINT NOT NULL, ITEM INTEGER NOT NULL, QTDE NUMERIC(9,3), ITEM_OBRIG_KIT_RASTREAVEL CHAR(1),
  CONSTRAINT PK_GEKITITE PRIMARY KEY (KIT, ITEM));
CREATE TABLE GESALDOKITRAS (ID_GEITEMKITRAS INTEGER NOT NULL PRIMARY KEY, QTDE_SALDO NUMERIC(18,3));
CREATE TABLE GECADBAL (ANO SMALLINT NOT NULL, MES SMALLINT NOT NULL, DOC INTEGER NOT NULL, DATA DATE, ARM SMALLINT, CDC INTEGER, CONSOL VARCHAR(1), DOCSAI INTEGER, DOCDEV INTEGER, USUARIO VARCHAR(31), MEXENDO VARCHAR(31), OQUE VARCHAR(1), CDC_BK INTEGER, PRIMARY KEY (ANO, MES, DOC));
CREATE TABLE GELANBAL (ID INTEGER NOT NULL, ANO SMALLINT, MES SMALLINT, SEQ SMALLINT, DOC INTEGER, ITEM INTEGER, QTDE NUMERIC(18,3), VLR_UNI NUMERIC(18,4), CONSOL VARCHAR(1), VLR_TOT NUMERIC(18,2), DIFER NUMERIC(18,3), VALIDADE DATE, LOTE VARCHAR(20), ID_NOMCOM INTEGER, PRIMARY KEY (ID));
CREATE TABLE GECADPED (ID INTEGER NOT NULL, OQUE VARCHAR(1), ANO SMALLINT, DOC INTEGER, FORN INTEGER, DATA DATE, CONDICAO VARCHAR(30), PRAZO VARCHAR(30), FRETE VARCHAR(15), OLD_DESCONTO NUMERIC(4,2), PER_IPI NUMERIC(4,2), DEST SMALLINT, SETOR VARCHAR(15), PRACA VARCHAR(15), REQUIS VARCHAR(20), VLR_FRETE NUMERIC(18,2), SOLIC VARCHAR(15), TIPO_COMPRA VARCHAR(1), OBS BLOB SUB_TYPE 1, IPI_INC VARCHAR(1), CONDI SMALLINT, TRANSP VARCHAR(15), MEXENDO VARCHAR(31), CONVITE INTEGER, USUARIO VARCHAR(31), LICIT INTEGER, EMPENHO INTEGER, VAL_PROP VARCHAR(20), LOC_ENT VARCHAR(20), FIN_OBJ VARCHAR(30), DATA_ABER DATE, HORA_ABER VARCHAR(4), STATUS VARCHAR(1), DATA_EMAIL DATE, HORA_EMAIL VARCHAR(4), DATA_VIG DATE, TIP_RESP VARCHAR(3), TIP_DISP VARCHAR(3), PED_ORI INTEGER, ANO_PED_ORI SMALLINT, LOCENTREGA SMALLINT, OBS_INTERNA BLOB SUB_TYPE 1, NOME_RESPONSAVEL VARCHAR(50), TIPO_DOC_RESPONSAVEL VARCHAR(1), DOCUMENTO_RESPONSAVEL VARCHAR(20), EMIS_ORDEM_COMPRA VARCHAR(1), CR INTEGER, CONTA_CONT INTEGER, FONTE SMALLINT, FONTE_PAG SMALLINT, DT_HOMOL DATE, TIP_REG_EXEC SMALLINT, DOCFEC VARCHAR(1), EMITIDO VARCHAR(1), ID_TBCENCUS INTEGER, AUTORIZADO CHAR(1), VLR_OUTRA_DESPESA NUMERIC(18,2), FORNECEDOR_CLASSIFICADO CHAR(1), JUSTIF_FORN_DESCLASSIFICADO VARCHAR(255), VLR_DESCONTO NUMERIC(18,2), NUM_PROCESSO_ADMINISTRATIVO INTEGER, ID_GESITUACAOPED INTEGER, FRETE_INCLUSO CHAR(1), PRIMARY KEY (ID));
CREATE TABLE GECADNFS (ID INTEGER NOT NULL, ANO SMALLINT, MES SMALLINT, DOC INTEGER, NF INTEGER, SERIE VARCHAR(3), FORN INTEGER, DATA DATE, NUM_LANC SMALLINT, FECHA NUMERIC(18,2), DESCONTO NUMERIC(18,2), FRETE NUMERIC(18,2), SEGURO NUMERIC(18,2), OUTROS NUMERIC(18,2), PERC_ICMS NUMERIC(18,2), ICMS NUMERIC(18,2), INC1 VARCHAR(1), INC2 VARCHAR(1), INC3 VARCHAR(1), TOTAL NUMERIC(18,2), CONSOL VARCHAR(1), CONSIS VARCHAR(1), QTDES NUMERIC(18,3), REFERENTE VARCHAR(12), TRANSP SMALLINT, CONHEC VARCHAR(8), EMIS DATE, DATA_GRAV DATE, HORA_GRAV VARCHAR(4), USUARIO VARCHAR(31), MEXENDO VARCHAR(31), DESTINO SMALLINT, EMPRESA SMALLINT, USU_CONS VARCHAR(31), FONTE_PAG SMALLINT, NAT_OP SMALLINT, TIPO_DOC VARCHAR(1), OBS VARCHAR(200), NUM_PROCES VARCHAR(40), TIPO_COMPRA VARCHAR(1), DATA_HORA_INCLUSAO TIMESTAMP, DATA_HORA_ULTIMA_ATUALIZACAO TIMESTAMP, DATA_VENCIMENTO_FRETE DATE, BASE_CALC_ICMS NUMERIC(18,2), NOTA_ENTRADA INTEGER, PRIMARY KEY (ID));
CREATE TABLE GELANNFS (ID_GELANNFS INTEGER NOT NULL, ANO SMALLINT, MES SMALLINT, DOC INTEGER, SEQ SMALLINT, ITEM INTEGER, ARM SMALLINT, PER_ICM NUMERIC(4,2), PER_IPI NUMERIC(9,2), PER_DES NUMERIC(9,2), QTDE NUMERIC(18,3), VLR_UNI NUMERIC(18,4), VLR_MED NUMERIC(18,4), VLR_ICM NUMERIC(18,2), VLR_IPI NUMERIC(18,2), VLR_DES NUMERIC(18,2), DATA_VAL DATE, COD_NOC SMALLINT, LOTE VARCHAR(30), CUSTO NUMERIC(18,4), PEDIDO INTEGER, MARCA VARCHAR(27), VLR_TOT NUMERIC(18,2), VLR_DESC NUMERIC(18,2), CONSOL VARCHAR(1), ANO_PED SMALLINT, LAB SMALLINT, TIPO_PED VARCHAR(1), QTDE_ARM NUMERIC(18,3), FATOR NUMERIC(18,3), DATA_HORA_INCLUSAO TIMESTAMP, DATA_HORA_ULTIMA_ATUALIZACAO TIMESTAMP, ITEM_NOTA_ENTRADA INTEGER, DATAMATRIX_QRCODE VARCHAR(100), PRIMARY KEY (ID_GELANNFS));
CREATE TABLE GERASVALNFS (ID INTEGER NOT NULL, ID_GELANNFS INTEGER, QTDE NUMERIC(18,3), ID_GEVALMEM INTEGER, DATA DATE, LOTE VARCHAR(30), ID_GERASVALFINAL INTEGER, ID_TBLABORA SMALLINT, ID_GENOMCOM INTEGER, PRIMARY KEY (ID));
CREATE TABLE GERASVALTRANSFLOTE (ID INTEGER NOT NULL, ID_GELANTRA INTEGER, QTDE NUMERIC(18,3), ID_GEVALMEM_ORI INTEGER, ID_GEVALMEM_DES INTEGER, DATA DATE, LOTE VARCHAR(30), ARM_ORI SMALLINT, ARM_DES SMALLINT, ID_GERASVALFINAL INTEGER, PRIMARY KEY (ID));
CREATE TABLE GELANPAC (ID INTEGER NOT NULL, TIPO VARCHAR(1), REG INTEGER, DATA DATE, HORA VARCHAR(4), ITEM INTEGER, LOCAL SMALLINT, USUARIO VARCHAR(31), QTDE NUMERIC(18,3), ATO SMALLINT, CDC INTEGER, ORIGEM VARCHAR(1), VALOR NUMERIC(18,2), PERC NUMERIC(9,2), KIT INTEGER, CONSOL VARCHAR(1), DOC_SAI INTEGER, MES_SAI SMALLINT, ANO_SAI SMALLINT, ID_PRESC INTEGER, ID_NOMCOM INTEGER, CRM INTEGER, ID_TBCBOPRO INTEGER, CONTA DOUBLE PRECISION, CDC_BK INTEGER, ID_TBFORNEC INTEGER, PRIMARY KEY (ID));
CREATE TABLE GERASVALFINAL (ID INTEGER NOT NULL PRIMARY KEY, ID_GEVALMEM INTEGER NOT NULL, ITEM INTEGER NOT NULL,
  QTDE NUMERIC(18,3) NOT NULL, DATA TIMESTAMP);
CREATE TABLE GERASVALINICIAL (ID_GEVALMEM INTEGER NOT NULL, ITEM INTEGER NOT NULL, QTDE NUMERIC(18,3) NOT NULL,
  ID INTEGER NOT NULL PRIMARY KEY, DATA TIMESTAMP, ID_GERASVALFINAL INTEGER);
CREATE TABLE GEKITKPI (ITEM_PRI INTEGER NOT NULL, ITEM_SEC INTEGER NOT NULL, QTDE NUMERIC(9,3), PRIMARY KEY (ITEM_PRI, ITEM_SEC));
CREATE TABLE GEUSERS_TBCLASSI (USUARIO_GEUSERS VARCHAR(30) NOT NULL, ID_TBCLASSI SMALLINT NOT NULL, PRIMARY KEY (USUARIO_GEUSERS, ID_TBCLASSI));
CREATE TABLE GEITENS_TBPRINC (ID_GEITENS INTEGER NOT NULL, ID_TBPRINC INTEGER NOT NULL, PRIMARY KEY (ID_GEITENS, ID_TBPRINC));
CREATE TABLE TBPRINC (COD INTEGER NOT NULL, NOME VARCHAR(254), ATIVO CHAR(1), COD_DCB VARCHAR(10), ID_TBTERAPEUTICO INTEGER, ID_TBUNICON_PADRAO VARCHAR(7), PRIMARY KEY (COD));
CREATE TABLE TBCENCUS (COD INTEGER NOT NULL PRIMARY KEY, ID INTEGER);
CREATE TABLE TBCBOPRO (ID INTEGER NOT NULL PRIMARY KEY, ID_TBPROFIS INTEGER);
"""
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');"
                   # cadastros nativos do produto achados pelo código (`cod:`; semente 11_SUP/07_chaves.sql) e o
                   # catálogo oficial DCB (forma mínima, código inventado): o conector só lê
                   " CREATE TABLE IF NOT EXISTS tipo_movimento_estoque (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(40) NOT NULL UNIQUE);"
                   " INSERT IGNORE INTO tipo_movimento_estoque (codigo, descricao, natureza, sentido, afeta_saldo, afeta_custo_medio, sistema, ativo, criado_em) VALUES ('migracao_entrada', 'Entrada trazida de outro sistema', 'entrada', 'entrada', TRUE, FALSE, TRUE, FALSE, UTC_TIMESTAMP(3)), ('migracao_saida', 'Saída trazida de outro sistema', 'saida', 'saida', TRUE, FALSE, TRUE, FALSE, UTC_TIMESTAMP(3));"
                   " CREATE TABLE IF NOT EXISTS tipo_entrada_estoque (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(40) NOT NULL UNIQUE); INSERT IGNORE INTO tipo_entrada_estoque (codigo, descricao, natureza, tipo_movimento_estoque_id, exige_documento_fiscal, atualiza_custo_medio, atualiza_ultimo_preco, exige_fornecedor, ativo, criado_em) SELECT 'migracao', 'Entrada trazida de outro sistema', 'outra', id, FALSE, FALSE, FALSE, FALSE, FALSE, UTC_TIMESTAMP(3) FROM tipo_movimento_estoque WHERE codigo = 'migracao_entrada';"
                   " CREATE TABLE IF NOT EXISTS principio_ativo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo_dcb VARCHAR(10) NOT NULL UNIQUE, descricao VARCHAR(255) NOT NULL,"
                   " versao_fonte VARCHAR(30) NOT NULL, criado_em DATETIME(3) NOT NULL);"
                   " INSERT IGNORE INTO principio_ativo (codigo_dcb, descricao, versao_fonte, criado_em) VALUES"
                   " ('01234', 'Principio falso A', 'exemplo', NOW(3)), ('01235', 'Principio falso B', 'exemplo', NOW(3))")
PAIS_EXTERNOS = {"GEGRUPOS": ["1", "2"], "TBLABORA": ["1", "2"], "GEKITRAS": ["1", "2"], "GETABVIA": ["VO", "IV"],
                 "GELANESI": ["1", "2", "3"], "GEKITS": ["1", "2"], "GELOCARM": ["1", "2"], "TBUSERS": ["ADMIN"],
                 "TBFORNEC": ["1", "2"], "TBNATOPE": ["5"], "TBCENCUS": ["10", "20"], "RECADATE": ["7001", "7002"],
                 "GELANTRA": ["1/movimento_estoque", "2/movimento_estoque"], "TBPROFIS": ["501"],
                 "TBCLASSI": ["7"]}  # r6: classificação de despesa (L8), dada como já carregada
# pais lidos na ORIGEM só para a referência (chave alternativa ou encadeada): fora do plano (MAPA_TESTE), já carregados
ORIGEM_PAIS = ("TBCENCUS", "TBCBOPRO")
CARREGADAS = ("TBTP_ENV_LISTA_AVAL_FARM", "TBUNICON", "GEITENS", "GENOMCOM", "GEUNIPRESC", "GEVALMEM",
              "GEITEMKITRAS", "GERASVALESTINI", "GEVIASITEM", "GEKITITE", "GESALDOKITRAS", "GECADBAL", "GELANBAL",
              "GECADPED", "GELANNFS", "GECADNFS", "GERASVALNFS", "GERASVALTRANSFLOTE", "GELANPAC", "TBPRINC",
              "GEITENS_TBPRINC", "GERASVALFINAL", "GERASVALINICIAL", "GEKITKPI", "GEUSERS_TBCLASSI")
# rodada 5 (ADR 0006): GEKITKPI carrega como kit do item principal; GEUSERS_TBCLASSI na trilha do usuário
DESCARTADAS = ()
# rodada 4: nenhuma bloqueada (o princípio do hospital carrega em principio_ativo_cliente; as fotografias do saldo
# do lote carregam como histórico na trilha_auditoria, correção da rodada 4)
# r5c: GEUSERS_TBCLASSI PENDENTE (pedido r5b_classificacao_usuario)
BLOQUEADAS = ()  # r6: GEUSERS_TBCLASSI carrega em usuario_estoque_classificacao.classificacao_despesa_id
NAO_CARREGADAS = DESCARTADAS + BLOQUEADAS
COLS = {m.group(1): [c.split()[0] for c in re.split(r",\s+(?![0-9]+\))", re.sub(r",\s*(PRIMARY KEY|CONSTRAINT).*$", "", m.group(2))) if c.split()[0] not in ("PRIMARY", "CONSTRAINT")]
        for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\);", " ".join(DDL.split()))}


def __getattr__(nome):
    """`MAPA_TESTE`: o mapa REAL sem as declarações dos pais de ORIGEM_PAIS (eles estão na imagem só para a referência
    ler a origem; o pai externo já conta como carregado), como no L6-13 e no L7-08."""
    if nome != "MAPA_TESTE":
        raise AttributeError(nome)
    from .. import mapa
    m = mapa.carregar_execucao()
    return dict(m, colunas_decl=[c for c in m["colunas_decl"] if c["tabela"] not in ORIGEM_PAIS])


def _l(ins, tab, **v):
    ins(tab, [v.get(c) for c in COLS[tab]])


D = decimal.Decimal
EXTRA_GEITENS = [x.split()[0] for x in " ".join(DDL.split("RASTREAR SMALLINT NOT NULL,")[1].split(");")[0].split()).split(", ")]


def linhas(r, ins):
    # r6: permissão por classificação: ADMIN/7 grava; usuário nunca visto (NOT NULL recusa); classificação 8 nunca
    # vista (sem grupo nem classificação: o CHECK do alvo recusa)
    for x in [("ADMIN", 7), ("NAOVISTO", 7), ("ADMIN", 8)]:
        ins("GEUSERS_TBCLASSI", list(x))
    T = "TBTP_ENV_LISTA_AVAL_FARM"
    for x in [(1, "Antes  da dispensação", "S"), (2, "Depois da dispensação", "N"), (3, None, "S")]:
        ins(T, list(x))
    # unidades: 'cp'/'CP' colidem pela caixa (as duas recusadas); UN sem nome; X com situação fora do domínio
    for x in [("CX", "Caixa", "A", 1), ("AMP", "Ampola", "A", 2), ("FR", "Frasco", "I", 3), ("ML", "Mililitro", "A", 4),
              ("cp", "Comprimido menor", "A", 5), ("CP", "Comprimido", "A", 6), ("UN", None, "A", 7),
              ("X", "Unidade xis", "Z", None)]:
        ins("TBUNICON", [x[0], x[1], x[2], None, r.choice([None, 1]), x[3]])
    for cod in range(101, 113):
        nome, gru, arm, comp, emin, emax, cobrar = "Insumo exemplo %d" % cod, 1 + cod % 2, "CX", "AMP", D(2), D(20), "S"
        if cod == 102:
            arm = "AMP"
        if cod == 107:
            nome = None                      # 1048
        if cod == 108:
            arm = "CP"                       # unidade recusada (colisão de caixa): pai_pendente
        if cod == 109:
            gru = 9                          # grupo nunca visto: pai_inexistente e 1048
        if cod == 110:
            emin, emax = D(10), D(5)         # 4025
        if cod == 111:
            cobrar = "X"                     # valor_fora_do_dominio
        if cod == 112:
            comp = "ZZ"                      # unidade de compra nunca vista: NULL com pai_inexistente
        # fatores: CONVER 0 = 'sem conversão' (fica o padrão 1); estoque -> consumo presumido; rastreável por lote
        conver = D(0) if cod % 3 == 0 else (D(10) if cod == 105 else D(1))
        presc = "ZZ" if cod == 104 else "ML"   # unidade de prescrição nunca vista: NULL com pai_inexistente
        rastrear = 1 if cod in (101, 102) else (2 if cod == 103 else 0)  # 2: valor_fora_do_dominio
        ins("GEITENS", [cod, nome, gru, 1, arm, comp, "ML", "DCB%d" % cod, emin, emax, D(r.randint(0, 9)),
                        r.randint(1, 9999) / 4.0, ("uso exemplo %d\r\n  segunda linha  " % cod).encode("cp1252"),
                        cobrar, "S", "N", r.choice("SN"), "N", "N", "N", "S", "S", "N", "N",
                        conver, D(1), presc, rastrear,
                        "%d mg" % (cod * 5), "N", "Q" if cod == 101 else "ABC"[cod % 3], "XYZ"[cod % 3],
                        "S", "N", "S" if cod % 2 else "N", "N" if cod % 2 else "S", "N", None]
                        + [None] * (len(EXTRA_GEITENS) - 10))
    for x in [(1, 101, "Nome comercial A", 1, "S", "7890000000017"), (2, 102, "Nome comercial B", 2, "N", None),
              (3, 107, "Nome comercial C", 1, "S", None),          # insumo recusado: pai_pendente
              (4, 101, None, 1, "S", None),                        # 1048
              (5, 103, "Nome comercial E", 1, "S", "78900000000171234567"),  # 1406
              (6, 104, "Nome comercial F", 77, "S", None)]:        # fabricante nunca visto: NULL
        ins("GENOMCOM", [x[0], x[1], x[0], x[2], x[3], 0, 0, x[4], x[5]])
    for x in [(1, 101, "ML", D(10), D(1), D(5)), (2, 101, "CX", D(1), None, None),
              (3, 102, "ML", None, None, None),                    # 1048
              (4, 101, "ML", D(10), None, None),                   # 1062
              (5, 103, "AMP", D(1), D(5), D(1)),                   # 4025 (dose)
              (6, 108, "ML", D(1), None, None),                    # pai_pendente
              (7, 104, "FR", D(0), None, None)]:                   # 4025 (fator)
        ins("GEUNIPRESC", [x[0], x[1], x[2], x[0], x[3], None, x[4], x[5]])
    dt = datetime.date
    for x in [(1, 101, "L001", dt(2027, 5, 1), 1, None), (2, 101, "L002", dt(2027, 6, 1), None, None),
              (3, 102, "L003", dt(2027, 7, 1), 2, dt(2027, 9, 1)),
              (4, 101, "L001", dt(2027, 5, 1), 1, None),           # mesmo lote físico em OUTRO local: adota a
                                                                   # linha do lote 1 (adotado_existente)
              (5, 103, "L005", dt(1899, 12, 30), None, None),      # data_sentinela: validade NULL (K1b, lote
                                                                   # migrado sem validade conhecida) e grava
              (6, 107, "L006", dt(2027, 1, 1), None, None),        # pai_pendente
              (7, 104, "L007", dt(2028, 1, 1), 77, None)]:         # fabricante nunca visto: NULL
        ins("GEVALMEM", [x[0], x[1], x[2], x[3], x[4], x[5], None, 2 if x[0] == 4 else 1, D(5), D(0), D(10), None,
                         x[0], "N", 1, 100 + x[0], 2026, 10, None])
    # item do kit rastreável: uma linha por insumo E LOTE; o par (kit, insumo) repetido ADOTA o item e grava o lote
    for x in [(1, 1, 101, 1, "CX", D(2), "S"), (2, 1, 102, None, "AMP", D(1), "N"),   # sem lote: só o item
              (3, 2, 101, None, "CX", D(3), None),
              (4, 1, 101, 2, "CX", D(1), "S"),                     # mesmo insumo em OUTRO lote: adota o item 1
              (5, 2, 103, 1, "CX", D(0), "S"),                     # 4025
              (6, 2, 107, 1, "CX", D(1), "S"),                     # pai_pendente
              (7, 9, 101, 1, "CX", D(1), "S"),                     # kit nunca visto: 1048
              (8, 2, 104, 7, "ZZ", D(1), "S"),                     # unidade nunca vista: 1048
              (9, 1, 102, 99, "AMP", D(1), "N"),                   # adota o item 2; lote nunca visto: sem lote
              (10, 2, 102, 3, "AMP", D(1), "S")]:                  # item e lote
        ins("GEITEMKITRAS", [x[0], x[1], x[2], x[3], x[4], x[5], x[6]])
    for x in [(1, 1, D(10), 1, None, None), (2, 1, D(5), 2, None, None), (3, 2, D(3), None, dt(2027, 1, 1), "L900"),
              (4, 2, D(2), None, None, None),                      # 4025 (sem lote)
              (5, 3, None, 1, None, None),                         # 1048
              (6, 3, D(1), 5, None, None),                         # lote sem validade (K1b): grava
              (7, 3, D(4), 1, None, None), (8, 99, D(1), 1, None, None)]:  # inventário nunca visto: 1048
        ins("GERASVALESTINI", [x[0], x[1], x[2], x[3], x[4], x[5], None])
    for x in [(101, "VO"), (101, "IV"), (102, "VO"), (107, "VO"), (103, "XX")]:
        ins("GEVIASITEM", list(x))
    # item do kit padrão: unidade = unidade de estoque do insumo (referência encadeada GEITENS>UNI_ARM>TBUNICON)
    for x in [(1, 101, D(2), "S"), (1, 102, D(1), "N"), (2, 101, D(1), None),
              (2, 108, D(1), "S"),                                 # insumo recusado: pai_pendente
              (2, 103, D(0), "S"),                                 # 4025 (quantidade > 0)
              (9, 101, D(1), "S"),                                 # kit nunca visto: pai_inexistente e 1048
              (1, 104, None, "S"),                                 # 1048 (quantidade)
              (2, 105, D(1), "X"),                                 # valor_fora_do_dominio, fica FALSE
              (1, 199, D(1), "S")]:                                # insumo nunca visto: pai_inexistente x2 e 1048
        ins("GEKITITE", list(x))
    # saldo do LOTE no kit: complementa o kit_rastreavel_lote gravado pela linha (lotes gravados: 1, 4, 10)
    for x in [(1, D(5)), (4, D("2.5")), (10, D(-1)),               # -1: valor_fora_do_dominio, fica o gravado
              (2, D(1)),                                           # linha sem lote: pai_inexistente
              (6, D(1)),                                           # linha recusada: pai_pendente (o motor
                                                                   # distingue o pai recusado pelo secundário)
              (99, D(1))]:                                         # linha nunca vista: pai_inexistente
        ins("GESALDOKITRAS", list(x))
    # ---- rodada 3: suprimentos (balanço, pedido, nota de entrada, consumo do paciente, lote por movimento)
    ins("TBCENCUS", [10, 1])
    ins("TBCENCUS", [20, 2])
    # princípio do hospital SEM código DCB (como nas 138 linhas da referência): casa pelo NOME com o catálogo oficial
    for x in [(1, "Principio falso A", "S", None), (2, "  Principio   falso B ", "S", None),  # espaços colapsados
              (3, "Principio proprio do hospital", "S", None),                             # sem par no catálogo
              (4, "Principio com codigo", "N", "1234"),            # DCB com zeros à esquerda: liga ao oficial
              (5, "Principio codigo falso", "S", "99999"),         # DCB fora do oficial: tenta o nome, sem par
              (6, None, "S", None),                                # sem nome: 1048
              (7, "Principio falso A ", "S", None)]:               # nome repetido: ADOTA o 1 (A04)
        ins("TBPRINC", list(x) + [7, "ZZ" if x[0] == 3 else "ML"])   # 3: unidade nunca vista (NULL)
    ins("TBCBOPRO", [1, 501])
    for x in [(101, 1), (102, 1), (102, 2),
              (101, 3),                                            # sem DCB: o princípio do hospital
              (101, 4),                                            # com DCB achado: o do hospital, ligado ao oficial
              (102, 5),                                            # DCB fora do oficial: o princípio do hospital
              (107, 1)]:                                           # insumo recusado: pai_pendente
        _l(ins, "GEITENS_TBPRINC", ID_GEITENS=x[0], ID_TBPRINC=x[1])
    # fotografias do saldo do lote (histórico na trilha_auditoria): duas do mesmo lote, lote recusado (pai_pendente:
    # a foto espera o lote), lote nunca visto (pai_inexistente, NULL), sem data (1048); saldo inicial ligado ou não à foto
    dth = datetime.datetime
    for x in [(1, 1, 101, D(5), dth(2025, 1, 31, 23, 0)), (2, 1, 101, D(3), dth(2025, 2, 28, 23, 0)),
              (3, 3, 102, D(2), dth(2025, 2, 28, 23, 0)),
              (4, 5, 103, D(1), dth(2025, 2, 28, 23, 0)),          # lote sem validade (K1b): grava
              (5, 99, 101, D(1), dth(2025, 2, 28, 23, 0)),         # lote nunca visto: pai_inexistente
              (6, 2, 101, D(4), None)]:                            # sem data: 1048
        _l(ins, "GERASVALFINAL", ID=x[0], ID_GEVALMEM=x[1], ITEM=x[2], QTDE=x[3], DATA=x[4])
    for x in [(1, 1, 101, D(4), dth(2025, 1, 1, 0, 0), 1), (2, 2, 101, D(7), dth(2025, 1, 1, 0, 0), None)]:
        _l(ins, "GERASVALINICIAL", ID=x[0], ID_GEVALMEM=x[1], ITEM=x[2], QTDE=x[3], DATA=x[4], ID_GERASVALFINAL=x[5])
    # balanço: o número leva o prefixo de domínio com ANO, MES e DOC (A04, recusas-fase2): o mesmo DOC em outro mês
    # grava
    for x in [(1, 10, dt(2026, 1, 31), 1, "T"), (2, 10, dt(2026, 2, 28), 1, "T"),
              (2, 11, dt(2026, 2, 28), 2, "F"),
              (3, 12, None, 1, "T"),                                                 # sem data: 1048
              (3, 13, dt(2026, 3, 31), 9, "T"),                                      # local nunca visto
              (3, 14, dt(2026, 3, 31), 1, "X")]:                                     # fora do domínio
        _l(ins, "GECADBAL", ANO=2026, MES=x[0], DOC=x[1], DATA=x[2], ARM=x[3], CONSOL=x[4], USUARIO="ADMIN",
           OQUE="B", CDC=1)
    for x in [(1, 1, 1, 10, 101, D(5), "T"), (2, 1, 1, 10, 102, D(3), "F"),  # SEQ repetido: sequência própria
              (3, 1, 2, 10, 101, D(1), "T"),                       # mesmo insumo na mesma contagem: 1062
              (4, 2, 1, 10, 101, D(1), "T"),                       # balanço do mesmo DOC em outro mês (A04)
              (5, 9, 1, 99, 101, D(1), "T"),                       # balanço nunca visto: pai_inexistente e 1048
              (6, 2, 1, 11, 103, D(-1), "T"),                      # contagem negativa: 4025
              (7, 2, 2, 11, 107, D(1), "T")]:                      # insumo recusado: pai_pendente
        _l(ins, "GELANBAL", ID=x[0], ANO=2026, MES=x[1], SEQ=x[2], DOC=x[3], ITEM=x[4], QTDE=x[5], VLR_UNI=D(2),
           CONSOL=x[6], DIFER=D(0), ID_NOMCOM=1)
    # centro de custo pela chave do pai, o COD (A08, recusas-fase2: na origem ID_TBCENCUS casa com o COD)
    for x in [(1, 100, 1, 10, "P", 1, dt(2026, 1, 5)), (2, 100, 2, 10, "E", 5, dt(2026, 1, 6)),  # DOC repetido no ano
              (3, 101, 0, 10, "P", 2, dt(2026, 1, 7)),             # sem fornecedor: 1048 (pedido de modelo)
              (4, 102, 1, 10, "P", 5, dt(1899, 12, 30)),           # aprovado sem data: data_sentinela e 4025
              (5, 103, 1, 20, "Z", None, dt(2026, 1, 8)),          # tipo fora do domínio; sem situação: rascunho
              (6, 104, 1, 999, "P", 1, dt(2026, 1, 9))]:           # centro de custo nunca visto: 1048
        _l(ins, "GECADPED", ID=x[0], OQUE="P", ANO=2026, DOC=x[1], FORN=x[2], ID_TBCENCUS=x[3], TIPO_COMPRA=x[4],
           ID_GESITUACAOPED=x[5], DT_HOMOL=x[6], DATA=dt(2026, 1, 4), USUARIO="ADMIN", VLR_FRETE=D(1),
           VLR_DESCONTO=D(0), FRETE_INCLUSO="N", OBS=("pedido exemplo\r\n  linha 2" if x[0] == 1 else None).encode(
               "cp1252") if x[0] == 1 else None)
    # nota: os itens criam o cabeçalho (agrupado por ANO, MES, DOC) e o cabeçalho da origem o completa pelo número
    # (cabeçalho sem nota criada pelos itens: o complemento espera o pedido complementa_cod do saida/L7-07.json)
    for x in [(501, 1, 1, dt(2026, 1, 10), dt(2026, 1, 8), "T"), (502, 1, 2, dt(2026, 1, 11), dt(2026, 1, 11), "F")]:
        _l(ins, "GECADNFS", ID=x[0], ANO=2026, MES=x[1], DOC=x[2], NF=9000 + x[2], SERIE="1", FORN=1, DATA=x[3],
           EMIS=x[4], CONSOL=x[5], NAT_OP=5, TOTAL=D(100), DESCONTO=D(0), FRETE=D(2), USUARIO="ADMIN",
           DATA_GRAV=x[3], HORA_GRAV="0930", EMPRESA=1, DESTINO=0)
    for x in [(11, 1, 1, 101, 1, D(10), D(10)), (12, 1, 2, 102, 1, D(5), None),  # sem QTDE_ARM: vale QTDE
              (13, 2, 1, 101, 2, D(4), D(4)), (14, 2, 2, 103, 1, D(2), D(2)),     # nota com dois locais
              (15, 2, 2, 102, 2, D(1), D(1)),                      # SEQ repetida na nota: próximo livre
                                                                   # (sequencia_renumerada, A04 e M3 do C1)
              (17, 1, 3, 107, 1, D(1), D(1)),                      # insumo recusado: pai_pendente
              (18, 1, 4, 101, 1, D(0), D(0))]:                     # quantidade zero: 4025
        _l(ins, "GELANNFS", ID_GELANNFS=x[0], ANO=2026, MES=1, DOC=x[1], SEQ=x[2], ITEM=x[3], ARM=x[4], QTDE=x[5],
           QTDE_ARM=x[6], FATOR=D(0) if x[0] == 12 else D(1), VLR_UNI=D(2), CUSTO=D(2), VLR_TOT=D(4), LAB=1,
           ITEM_NOTA_ENTRADA=x[2])
    for x in [(1, 11, D(10), 1), (2, 13, D(3), 2), (3, 13, D(1), 3),
              (5, 11, D(1), 5),                                    # lote sem validade (K1b): grava
              (6, 99, D(1), 1),                                    # item nunca visto: pai_inexistente e 1048
              (7, 12, D(0), 1)]:                                   # quantidade zero: 4025
        _l(ins, "GERASVALNFS", ID=x[0], ID_GELANNFS=x[1], QTDE=x[2], ID_GEVALMEM=x[3], LOTE="L", ID_TBLABORA=1)
    for x in [(1, 1, D(2), 1), (2, 1, D(1), 2), (3, 2, D(3), 3),
              (4, 3, D(1), 1),                                     # movimento nunca visto: pai_inexistente e 1048
              (5, 2, D(1), 3)]:                                    # mesmo lote no mesmo movimento: 1062
        _l(ins, "GERASVALTRANSFLOTE", ID=x[0], ID_GELANTRA=x[1], QTDE=x[2], ID_GEVALMEM_ORI=x[3], ID_GEVALMEM_DES=x[3],
           ARM_ORI=1, ARM_DES=2)
    for x in [(1, "E", 7001, "0815", 101, "ADMIN", D(2), 10),
              (2, "I", 8001, "0900", 101, "ADMIN", D(1), 10),       # internação: atendimento NULL (pai_inexistente)
              (3, "E", 7002, "2575", 101, "ADMIN", D(1), 10),       # hora inválida: 1048
              (4, "E", 7001, "1000", 107, "ADMIN", D(1), 10),       # insumo recusado: pai_pendente
              (5, "E", 7001, "1100", 101, "NINGUEM", D(1), 10),     # usuário nunca visto: 1048
              (6, "E", 7001, "1200", 102, "ADMIN", D(0), 10),       # quantidade zero: 4025
              (7, "E", 7001, "1300", 103, "ADMIN", D(3), 30)]:      # centro de custo nunca visto: NULL
        _l(ins, "GELANPAC", ID=x[0], TIPO=x[1], REG=x[2], DATA=dt(2026, 3, 5), HORA=x[3], ITEM=x[4], LOCAL=1,
           USUARIO=x[5], QTDE=x[6], CDC=x[7], VALOR=D(4), ATO=1, KIT=0, ID_PRESC=1, ID_NOMCOM=1, CRM=1,
           ID_TBCBOPRO=9 if x[0] == 7 else 1,
           CONTA=1.0, ID_TBFORNEC=2 if x[0] == 7 else None)
    # (linha 7: inscrição no conselho nunca vista: solicitante NULL com pai_inexistente)
    # rodada 5: kit do item principal 101 com dois secundários; 102 com secundário nunca visto (insumo e unidade
    # pai_inexistente, 1048: o cabeçalho do kit é desfeito)
    for x in [(101, 102, D(2)), (101, 105, D(1)), (102, 199, D(1))]:
        _l(ins, "GEKITKPI", ITEM_PRI=x[0], ITEM_SEC=x[1], QTDE=x[2])
    return {
        "GEUSERS_TBCLASSI": {"gravados": 1, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 1,
                                                           "restricao_destino_4025": 1, "vigencia_sem_fonte": 3}},
        "GEKITKPI": {"gravados": 2, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 1}},
        # A04: o nome repetido (7) adota o princípio 1; a 4, ligada pelo DCB, não tenta o nome (concorrente com a
        # coluna já preenchida: sem codigo_inexistente_destino de ruído)
        "TBPRINC": {"gravados": 6, "pendencias": {"restricao_destino_1048": 1, "adotado_existente": 1,
                                                  "codigo_inexistente_destino": 3, "pai_inexistente": 1}},
        "GEITENS_TBPRINC": {"gravados": 6, "pendencias": {"pai_pendente": 1}},
        "GERASVALFINAL": {"gravados": 5, "pendencias": {"pai_inexistente": 1,
                                                        "restricao_destino_1048": 1}},
        "GERASVALINICIAL": {"gravados": 2, "pendencias": {}},
        "GECADBAL": {"gravados": 4, "pendencias": {"valor_presumido": 6,
                                                   "restricao_destino_1048": 2, "pai_inexistente": 1,
                                                   "valor_fora_do_dominio": 1}},
        "GELANBAL": {"gravados": 3, "pendencias": {"restricao_destino_1062": 1, "pai_pendente": 1,
                                                   "pai_inexistente": 4, "restricao_destino_1048": 1,
                                                   "restricao_destino_4025": 1}},
        "GECADPED": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "pai_inexistente": 1,
                                                   "data_sentinela": 1, "restricao_destino_4025": 2,
                                                   "valor_fora_do_dominio": 1}},
        "GECADNFS": {"gravados": 2, "pendencias": {}},
        "GELANNFS": {"gravados": 5, "pendencias": {"sequencia_renumerada": 1, "restricao_destino_4025": 1,
                                                   "pai_pendente": 1}},
        "GERASVALNFS": {"gravados": 4, "pendencias": {"pai_inexistente": 1,
                                                      "restricao_destino_1048": 1, "restricao_destino_4025": 1}},
        "GERASVALTRANSFLOTE": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1,
                                                             "restricao_destino_1062": 1}},
        # A08: o local 1 é criado pela primeira linha (nome e tipo presumidos) e adotado pelas outras gravadas;
        # valor_presumido conta nas duas colunas em toda linha lida que chega ao secundário (6 linhas)
        "GELANPAC": {"gravados": 3, "pendencias": {"pai_inexistente": 4, "hora_invalida": 1,
                                                   "restricao_destino_1048": 2, "pai_pendente": 1,
                                                   "restricao_destino_4025": 1, "adotado_existente": 2,
                                                   "valor_presumido": 12}},
        "GEKITITE": {"gravados": 4, "pendencias": {"pai_pendente": 1, "restricao_destino_4025": 1,
                                                   "pai_inexistente": 3, "restricao_destino_1048": 3,
                                                   "valor_fora_do_dominio": 1}},
        "GESALDOKITRAS": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "pai_inexistente": 2,
                                                        "pai_pendente": 1}},
        "TBTP_ENV_LISTA_AVAL_FARM": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "TBUNICON": {"gravados": 5, "pendencias": {"codigo_colisao_caixa": 2, "restricao_destino_1048": 1,
                                                   "valor_fora_do_dominio": 1}},
        "GEITENS": {"gravados": 8, "pendencias": {"valor_presumido": 22, "restricao_destino_1048": 2,
                                                  "pai_pendente": 1, "pai_inexistente": 3,
                                                  "restricao_destino_4025": 1, "valor_fora_do_dominio": 4}},
        "GENOMCOM": {"gravados": 3, "pendencias": {"pai_pendente": 1, "restricao_destino_1048": 1,
                                                   "restricao_destino_1406": 1, "pai_inexistente": 1}},
        "GEUNIPRESC": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1062": 1,
                                                     "restricao_destino_4025": 2, "pai_pendente": 1}},
        "GEVALMEM": {"gravados": 6, "pendencias": {"adotado_existente": 1, "data_sentinela": 1,
                                                   "pai_pendente": 1,
                                                   "pai_inexistente": 1}},
        "GEITEMKITRAS": {"gravados": 6, "pendencias": {"adotado_existente": 2, "mescla_conflito_origem_guardada": 2,
                                                       "restricao_destino_4025": 1,
                                                       "pai_pendente": 1, "pai_inexistente": 3,
                                                       "restricao_destino_1048": 2}},
        "GERASVALESTINI": {"gravados": 5, "pendencias": {"restricao_destino_4025": 1, "restricao_destino_1048": 2,
                                                         "pai_inexistente": 1}},
        "GEVIASITEM": {"gravados": 3, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                     "restricao_destino_1048": 1}},
    }
