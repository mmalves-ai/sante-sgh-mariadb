"""Fatia L7-07 (SADT e suprimentos, módulo SUP): tabelas da origem com os mesmos nomes e tipos do dicionário (só as
colunas lidas pela carga, mais a chave) e dados 100% falsos.

Carregadas (CARREGADAS, 11): regra de envio à avaliação farmacêutica, unidade de medida, insumo (todas as colunas da
origem declaradas; curvas por de-para de valores), apresentação comercial, unidade do insumo (prescrição), lote do
insumo (o mesmo lote em outro local ADOTA o lote físico), item do kit rastreável, lote do inventário de abertura, via
de uso do insumo, item do kit padrão (unidade pela referência encadeada ao insumo) e saldo do item do kit rastreável
(complementa). Descartadas (DESCARTADAS, 5, `declarado/sem_carga.tsv`, entre elas as fotografias de saldo do lote) e
bloqueadas por mecanismo do motor (BLOQUEADAS, 9, declaração pronta e comentada em colunas.d/L7-07.tsv; pedidos em
saida/L7-07.json) ficam fora da imagem.
Anomalias cobertas:
- nome nulo (NOT NULL do destino: restricao_destino_1048), literais presumidos (valor_presumido por linha lida);
- código que só difere pela caixa na unidade (codigo_colisao_caixa: o grupo todo recusado) e filhos dele
  (pai_pendente em cadeia: insumo -> apresentação, unidade do insumo, lote, via, kit);
- S/N e A/I fora do domínio (valor_fora_do_dominio, fica o padrão do destino);
- pai nunca visto em coluna anulável (NULL com pai_inexistente) e NOT NULL (pai_inexistente e recusa);
- lote físico repetido em outro local (adotado_existente); chave única do destino repetida (1062; no item do kit é a
  linha por lote da origem, não erro do cliente: 1062 só até o pedido de agregação no L7-07.json), CHECK violado (4025: estoque máximo < mínimo, dose máxima < mínima, fator
  e quantidade zero, lote do inventário sem lote cadastrado nem informado), texto mais longo que o destino (1406);
- data sentinela na validade do lote (data_sentinela e recusa: datas inválidas a sanear);
- BLOB de texto com quebra de linha e espaços internos preservados; pais de fora da fatia (PAIS_EXTERNOS).
- referência encadeada com pai recusado (pai_pendente) e com lote nunca visto (pai_inexistente nos dois passos);
- complemento de linha recusada (pai_pendente), sem pai (pai_inexistente) e negativo (valor_fora_do_dominio);
- curva fora do domínio (valor_fora_do_dominio, sem recusar o insumo).
"""
import datetime
import decimal

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
  INTEGER, TIPO_REF SMALLINT, COD_SIMPAS VARCHAR(15), DATA_EI DATE, DATA_EM4 DATE, VLRMED NUMERIC(18,4), CUSTO
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
"""
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')")
PAIS_EXTERNOS = {"GEGRUPOS": ["1", "2"], "TBLABORA": ["1", "2"], "GEKITRAS": ["1", "2"], "GETABVIA": ["VO", "IV"],
                 "GELANESI": ["1", "2", "3"], "GEKITS": ["1", "2"], "GELOCARM": ["1", "2"]}
CARREGADAS = ("TBTP_ENV_LISTA_AVAL_FARM", "TBUNICON", "GEITENS", "GENOMCOM", "GEUNIPRESC", "GEVALMEM",
              "GEITEMKITRAS", "GERASVALESTINI", "GEVIASITEM", "GEKITITE", "GESALDOKITRAS")
DESCARTADAS = ("TBPRINC", "GEKITKPI", "GEUSERS_TBCLASSI", "GERASVALFINAL", "GERASVALINICIAL")
# bloqueadas por mecanismo genérico do motor ainda não disponível (saida/L7-07.json): M1 id de destino secundário do
# pai, M2 id pelo código no destino, DATE em DATETIME na soma de controle, M4 identificação natural de várias
# colunas, catálogo dcb, destino condicional
BLOQUEADAS = ("GECADBAL", "GELANNFS", "GERASVALNFS", "GERASVALTRANSFLOTE", "GEITENS_TBPRINC", "GELANBAL", "GECADPED",
              "GELANPED", "GELANPAC")
NAO_CARREGADAS = DESCARTADAS + BLOQUEADAS

D = decimal.Decimal
EXTRA_GEITENS = [x.split()[0] for x in " ".join(DDL.split("RASTREAR SMALLINT NOT NULL,")[1].split(");")[0].split()).split(", ")]


def linhas(r, ins):
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
              (5, 103, "L005", dt(1899, 12, 30), None, None),      # data_sentinela e 1048
              (6, 107, "L006", dt(2027, 1, 1), None, None),        # pai_pendente
              (7, 104, "L007", dt(2028, 1, 1), 77, None)]:         # fabricante nunca visto: NULL
        ins("GEVALMEM", [x[0], x[1], x[2], x[3], x[4], x[5], None, 2 if x[0] == 4 else 1, D(5), D(0), D(10), None,
                         x[0], "N", 1, 100 + x[0], 2026, 10, None])
    for x in [(1, 1, 101, "CX", D(2), "S"), (2, 1, 102, "AMP", D(1), "N"), (3, 2, 101, "CX", D(3), None),
              (4, 1, 101, "CX", D(1), "S"),                        # mesmo insumo em OUTRO lote: 1062 até a
                                                                   # agregação por insumo no kit (pedido)
              (5, 2, 103, "CX", D(0), "S"),                        # 4025
              (6, 2, 107, "CX", D(1), "S"),                        # pai_pendente
              (7, 9, 101, "CX", D(1), "S"),                        # kit nunca visto: 1048
              (8, 2, 104, "ZZ", D(1), "S")]:                       # unidade nunca vista: 1048
        ins("GEITEMKITRAS", [x[0], x[1], x[2], {1: 1, 4: 2}.get(x[0]), x[3], x[4], x[5]])
    for x in [(1, 1, D(10), 1, None, None), (2, 1, D(5), 2, None, None), (3, 2, D(3), None, dt(2027, 1, 1), "L900"),
              (4, 2, D(2), None, None, None),                      # 4025 (sem lote)
              (5, 3, None, 1, None, None),                         # 1048
              (6, 3, D(1), 5, None, None),                         # lote recusado: pai_pendente
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
    # saldo do item do kit rastreável: complementa a linha gravada por GEITEMKITRAS (gravadas: 1, 2, 3)
    for x in [(1, D(5)), (2, D("2.5")), (3, D(-1)),                # -1: valor_fora_do_dominio, fica o gravado
              (4, D(1)),                                           # item recusado (1062): pai_pendente
              (99, D(1))]:                                         # item nunca visto: pai_inexistente
        ins("GESALDOKITRAS", list(x))
    return {
        "GEKITITE": {"gravados": 4, "pendencias": {"pai_pendente": 1, "restricao_destino_4025": 1,
                                                   "pai_inexistente": 3, "restricao_destino_1048": 3,
                                                   "valor_fora_do_dominio": 1}},
        "GESALDOKITRAS": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "pai_pendente": 1,
                                                        "pai_inexistente": 1}},
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
        "GEVALMEM": {"gravados": 5, "pendencias": {"adotado_existente": 1, "data_sentinela": 1,
                                                   "restricao_destino_1048": 1, "pai_pendente": 1,
                                                   "pai_inexistente": 1}},
        "GEITEMKITRAS": {"gravados": 3, "pendencias": {"restricao_destino_1062": 1, "restricao_destino_4025": 1,
                                                       "pai_pendente": 1, "pai_inexistente": 2,
                                                       "restricao_destino_1048": 2}},
        "GERASVALESTINI": {"gravados": 4, "pendencias": {"restricao_destino_4025": 1, "restricao_destino_1048": 2,
                                                         "pai_pendente": 1, "pai_inexistente": 1}},
        "GEVIASITEM": {"gravados": 3, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                     "restricao_destino_1048": 1}},
    }
