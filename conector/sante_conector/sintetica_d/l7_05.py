"""Fatia L7-05 (SADT e suprimentos, módulo SUP): tabelas da origem com as colunas de
`conector/mapa/declarado/colunas.d/L7-05.tsv`, dados 100% falsos e as anomalias da fatia.

Carregadas (9): capelas e grupos de manipulação (e a associativa), grupos de insumo (natureza PRESUMIDA 'outro'),
ações da dose, kits padrão, locais de estoque (tipo PRESUMIDO 'outro', local de origem por autorreferência em duas
fases), kits rastreáveis (local, kit padrão e usuário do cadastro) e destinos de entrega de compra (UF pelo catálogo
oficial).
Fora da carga (16, entram na imagem para provar que nada é gravado): saldos mensais, recálculo de saldo, terceiros,
documentos de estoque e seus itens, compras, lotes, descrição de serviço, estoque inicial e seus itens, fechamento,
sequências, horários padrão, consumo por centro de custo e limites por local (motivos em colunas.d e pedidos em
saida/L7-05.json: pais em ordem posterior, competência composta de ANO+MES, desdobramento de colunas em linhas).
Anomalias: nome vazio ou só espaços em destino NOT NULL (1048), S/N e 0/1 fora do domínio (padrão com pendência),
prazo acima de 365 (4025), pai recusado (pai_pendente), pai nunca visto (pai_inexistente, + 1048 se NOT NULL),
autorreferência a local recusado e a local nunca visto (fase 2), login sem usuário (NULL aceito), UF fora do
catálogo (catalogo_codigo_inexistente), 0 como "sem valor" (NULL), nome com espaços repetidos.
"""
import datetime
import decimal

DDL = """
CREATE TABLE GEARMLOC (ANO SMALLINT NOT NULL, MES SMALLINT NOT NULL, LOCAL SMALLINT NOT NULL, ITEM INTEGER NOT 
  NULL, QTDE NUMERIC(18,3), VALOR NUMERIC(18,2), RELEVAR VARCHAR(1), TRANSICAO VARCHAR(1), PRIMARY KEY 
  (ANO,MES,ITEM,LOCAL));
CREATE TABLE GEATUALIZASALDO (ID_ATUALIZASALDO INTEGER NOT NULL, DATA_INICIO TIMESTAMP NOT NULL, USUARIO 
  VARCHAR(31), TELA SMALLINT, PROCESSO INTEGER, TERMINADO VARCHAR(1), DATA_FIM TIMESTAMP NOT NULL, MES_PROC SMALLINT, 
  ANO_PROC SMALLINT, IP VARCHAR(30), PRIMARY KEY (ID_ATUALIZASALDO));
CREATE TABLE GECADTER (NOME VARCHAR(70) NOT NULL, NASC DATE NOT NULL, COD INTEGER NOT NULL, PRIMARY KEY 
  (NOME,NASC));
CREATE TABLE GECADTRA (ID INTEGER NOT NULL, ANO SMALLINT NOT NULL, MES SMALLINT NOT NULL, DOC INTEGER NOT NULL, 
  DATA DATE, REQ INTEGER, OBS VARCHAR(60), CONSOL VARCHAR(1), LOC_ORI SMALLINT, LOC_DES SMALLINT, REQUISICAO 
  VARCHAR(1), EMIT VARCHAR(1), DATA_GRAV DATE, HORA_GRAV VARCHAR(4), HORA VARCHAR(4), USUARIO VARCHAR(31), MEXENDO 
  VARCHAR(31), USU_CONS VARCHAR(31), DATA_HORA_INCLUSAO TIMESTAMP, DATA_HORA_ULTIMA_ATUALIZACAO TIMESTAMP, ORIGEM 
  VARCHAR(1), PRIMARY KEY (ID));
CREATE TABLE GECAPELAMP (ID_GECAPELAMP INTEGER NOT NULL, NOME VARCHAR(45), FUNCIONAMENTO VARCHAR(1), MANIPULANDO 
  VARCHAR(1), ID_TBUNIDAD SMALLINT, PRIMARY KEY (ID_GECAPELAMP));
CREATE TABLE GECOMPRA (ITEM INTEGER NOT NULL, DATA DATE NOT NULL, FORN INTEGER NOT NULL, NF INTEGER NOT NULL, DOC 
  INTEGER NOT NULL, QTDE NUMERIC(18,3), UNIT NUMERIC(18,4), CUSTO NUMERIC(18,4), MARCA VARCHAR(27), VENDA 
  NUMERIC(18,4), PRIMARY KEY (ITEM,DATA,FORN,NF,DOC));
CREATE TABLE GECONITL (ANO SMALLINT NOT NULL, MES SMALLINT NOT NULL, LOCAL SMALLINT NOT NULL, ITEM INTEGER NOT 
  NULL, ENT NUMERIC(18,3), SAI NUMERIC(18,3), DEV NUMERIC(18,3), VLR_ENT NUMERIC(18,2), VLR_SAI NUMERIC(18,2), 
  VLR_DEV NUMERIC(18,2), PRIMARY KEY (ANO,MES,LOCAL,ITEM));
CREATE TABLE GECTRVMM (ANO SMALLINT NOT NULL, MES SMALLINT NOT NULL, DOC INTEGER NOT NULL, ITEM INTEGER NOT NULL, 
  DATA DATE NOT NULL, QTDE NUMERIC(18,3), LOTE VARCHAR(30) NOT NULL, PRIMARY KEY (ANO,MES,DOC,ITEM,DATA,LOTE));
CREATE TABLE GEDESCOM (COD SMALLINT NOT NULL, NOME VARCHAR(40), ENDERECO VARCHAR(30), NUMERO INTEGER, COMPL 
  VARCHAR(5), BAIRRO VARCHAR(25), CIDADE VARCHAR(25), UF VARCHAR(2), CEP INTEGER, CGC BIGINT, PRIMARY KEY (COD));
CREATE TABLE GEDESPDS (ANO SMALLINT NOT NULL, OQUE VARCHAR(1) NOT NULL, DOC INTEGER NOT NULL, SEQ INTEGER NOT NULL, 
  DESCRICAO BLOB SUB_TYPE 1, PRIMARY KEY (ANO,OQUE,DOC,SEQ));
CREATE TABLE GEESTINI (DOC INTEGER NOT NULL, DATA DATE, ARM SMALLINT, CONS VARCHAR(1), USUARIO VARCHAR(31), MEXENDO 
  VARCHAR(31), PRIMARY KEY (DOC));
CREATE TABLE GEFECMES (ANO SMALLINT NOT NULL, MES SMALLINT NOT NULL, EXPORTADO CHAR(1), PRIMARY KEY (ANO,MES));
CREATE TABLE GEGERSEQ (COD SMALLINT NOT NULL, NOME VARCHAR(50), SEQ INTEGER NOT NULL, MES SMALLINT NOT NULL, ANO 
  SMALLINT NOT NULL, PRIMARY KEY (COD,MES,ANO));
CREATE TABLE GEGRUPOMP (ID_GEGRUPOMP INTEGER NOT NULL, OLD_ID_GECAPELAMP INTEGER, OLD_ID_GECAPELAMPORIGEM INTEGER, 
  NOME VARCHAR(45), PRIMARY KEY (ID_GEGRUPOMP));
CREATE TABLE GECAPELAMP_GEGRUPOMP (ID_GECAPELAMP INTEGER NOT NULL, ID_GEGRUPOMP INTEGER NOT NULL, PRIMARY KEY 
  (ID_GECAPELAMP,ID_GEGRUPOMP));
CREATE TABLE GEGRUPOS (COD SMALLINT NOT NULL, NOME VARCHAR(60), ANTIMI VARCHAR(1), NORMESP VARCHAR(1), INT_COMP 
  SMALLINT, PRAZO_ENT SMALLINT, COD_QUIM_TISS INTEGER, RASTREAR VARCHAR(1) NOT NULL, PRIMARY KEY (COD));
CREATE TABLE GEHORMED (H11 SMALLINT, H21 SMALLINT, H22 SMALLINT, H31 SMALLINT, H32 SMALLINT, H33 SMALLINT, H41 
  SMALLINT, H42 SMALLINT, H43 SMALLINT, H44 SMALLINT, H61 SMALLINT, H62 SMALLINT, H63 SMALLINT, H64 SMALLINT, H65 
  SMALLINT, H66 SMALLINT, H81 SMALLINT, H82 SMALLINT, H83 SMALLINT, H84 SMALLINT, H85 SMALLINT, H86 SMALLINT, H87 
  SMALLINT, H88 SMALLINT, H121 SMALLINT, H122 SMALLINT, H123 SMALLINT, H124 SMALLINT, H125 SMALLINT, H126 SMALLINT, 
  H127 SMALLINT, H128 SMALLINT, H129 SMALLINT, H1210 SMALLINT, H1211 SMALLINT, H1212 SMALLINT);
CREATE TABLE GEITEACAODOSE (ID SMALLINT NOT NULL, NOME VARCHAR(10), PRIMARY KEY (ID));
CREATE TABLE GEKITS (COD SMALLINT NOT NULL, NOME VARCHAR(70), PERMITIR_LANCAR_QTDE_SUPE_ITEM CHAR(1), PRIMARY KEY 
  (COD));
CREATE TABLE GEKONCDC (ANO SMALLINT NOT NULL, MES SMALLINT NOT NULL, CDC INTEGER NOT NULL, DATA DATE NOT NULL, ITEM 
  INTEGER NOT NULL, DOC INTEGER NOT NULL, QTDE NUMERIC(18,3), VALOR NUMERIC(18,2), PRIMARY KEY 
  (ANO,MES,CDC,DATA,ITEM,DOC));
CREATE TABLE GELANESI (ID INTEGER NOT NULL, DOC INTEGER NOT NULL, ITEM INTEGER NOT NULL, QTDE NUMERIC(18,3), VLRMED 
  NUMERIC(18,4), CONS VARCHAR(1), TOTAL NUMERIC(18,2), PRIMARY KEY (ID));
CREATE TABLE GELANTRA (ID_GECADTRA INTEGER NOT NULL, OLD_ANO SMALLINT, OLD_MES SMALLINT, OLD_DOC INTEGER, SEQ 
  SMALLINT NOT NULL, ITEM INTEGER NOT NULL, CONSOL VARCHAR(1), QTDE NUMERIC(18,3), VLRMED NUMERIC(18,2), KIT INTEGER, 
  ID_GELANTRA INTEGER NOT NULL, DETALHEVAL INTEGER NOT NULL, QTDE_REQUISITADA NUMERIC(18,3), DATA_HORA_INCLUSAO 
  TIMESTAMP, DATA_HORA_ULTIMA_ATUALIZACAO TIMESTAMP, PRIMARY KEY (ID_GELANTRA));
CREATE TABLE GELIMLOC (ITEM INTEGER NOT NULL, LOCAL SMALLINT NOT NULL, MINIMO NUMERIC(18,3), MAXIMO NUMERIC(18,3), 
  PRIMARY KEY (ITEM,LOCAL));
CREATE TABLE GELOCARM (COD SMALLINT NOT NULL, NOME VARCHAR(35), GRUPO SMALLINT, SGRUPO SMALLINT, ITEM SMALLINT, 
  UNI_DIG_TRA SMALLINT NOT NULL, UNI_VIS_TRA SMALLINT NOT NULL, MOBILE_ATIVO INTEGER, LOCAL_ORIGEM INTEGER, PRIMARY 
  KEY (COD));
CREATE TABLE GEKITRAS (ID INTEGER NOT NULL, ID_GELOCARM SMALLINT NOT NULL, NOME VARCHAR(70) NOT NULL, EMERGENCIAL 
CHAR(1), DATA_HORA_INCLUSAO TIMESTAMP, ID_GEKITS_PADRAO SMALLINT, ID_USUARIO_CADASTRA_KIT VARCHAR(31), 
  ID_USUARIO_ATUALIZA_KIT VARCHAR(31), UTILIZACAO_TOTAL CHAR(1), PRIMARY KEY (ID));
"""

PAIS_EXTERNOS = {"TBUSERS": ["almox.exemplo", "farm.exemplo"]}
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
                   " INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES"
                   " ('35', 'SP', 'Unidade exemplo SP', 1, UTC_TIMESTAMP(3)),"
                   " ('33', 'RJ', 'Unidade exemplo RJ', 1, UTC_TIMESTAMP(3))")

CARREGADAS = ("GECAPELAMP", "GEDESCOM", "GEGRUPOMP", "GECAPELAMP_GEGRUPOMP", "GEGRUPOS", "GEITEACAODOSE", "GEKITS",
              "GELOCARM", "GEKITRAS")
FORMAS_BLOQUEADAS = {
    'GEARMLOC': ('SMALLINT', 'SMALLINT', 'SMALLINT', 'INTEGER', 'NUMERIC', 'NUMERIC', 'VARCHAR', 'VARCHAR'),
    'GEATUALIZASALDO': ('INTEGER', 'TIMESTAMP', 'VARCHAR', 'SMALLINT', 'INTEGER', 'VARCHAR', 'TIMESTAMP', 'SMALLINT', 'SMALLINT', 'VARCHAR'),
    'GECADTER': ('VARCHAR', 'DATE', 'INTEGER'),
    'GECADTRA': ('INTEGER', 'SMALLINT', 'SMALLINT', 'INTEGER', 'DATE', 'INTEGER', 'VARCHAR', 'VARCHAR', 'SMALLINT', 'SMALLINT', 'VARCHAR', 'VARCHAR', 'DATE', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'TIMESTAMP', 'TIMESTAMP', 'VARCHAR'),
    'GECOMPRA': ('INTEGER', 'DATE', 'INTEGER', 'INTEGER', 'INTEGER', 'NUMERIC', 'NUMERIC', 'NUMERIC', 'VARCHAR', 'NUMERIC'),
    'GECONITL': ('SMALLINT', 'SMALLINT', 'SMALLINT', 'INTEGER', 'NUMERIC', 'NUMERIC', 'NUMERIC', 'NUMERIC', 'NUMERIC', 'NUMERIC'),
    'GECTRVMM': ('SMALLINT', 'SMALLINT', 'INTEGER', 'INTEGER', 'DATE', 'NUMERIC', 'VARCHAR'),
    'GEDESPDS': ('SMALLINT', 'VARCHAR', 'INTEGER', 'INTEGER', 'BLOB'),
    'GEESTINI': ('INTEGER', 'DATE', 'SMALLINT', 'VARCHAR', 'VARCHAR', 'VARCHAR'),
    'GEFECMES': ('SMALLINT', 'SMALLINT', 'CHAR'),
    'GEGERSEQ': ('SMALLINT', 'VARCHAR', 'INTEGER', 'SMALLINT', 'SMALLINT'),
    'GEHORMED': ('SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT', 'SMALLINT'),
    'GEKONCDC': ('SMALLINT', 'SMALLINT', 'INTEGER', 'DATE', 'INTEGER', 'INTEGER', 'NUMERIC', 'NUMERIC'),
    'GELANESI': ('INTEGER', 'INTEGER', 'INTEGER', 'NUMERIC', 'NUMERIC', 'VARCHAR', 'NUMERIC'),
    'GELANTRA': ('INTEGER', 'SMALLINT', 'SMALLINT', 'INTEGER', 'SMALLINT', 'INTEGER', 'VARCHAR', 'NUMERIC', 'NUMERIC', 'INTEGER', 'INTEGER', 'INTEGER', 'NUMERIC', 'TIMESTAMP', 'TIMESTAMP'),
    'GELIMLOC': ('INTEGER', 'SMALLINT', 'NUMERIC', 'NUMERIC'),
}
BLOQUEADAS = tuple(FORMAS_BLOQUEADAS)

D = decimal.Decimal


def _valor(forma, i, k):
    """Valor falso para a forma da coluna (só presença na imagem)."""
    if forma in ("SMALLINT", "INTEGER", "BIGINT"):
        return i + k
    if forma == "NUMERIC":
        return D("%d.%02d" % (i + k, k))
    if forma == "DATE":
        return datetime.date(2025, 1 + i % 12, 1 + k % 28)
    if forma == "TIMESTAMP":
        return datetime.datetime(2025, 1 + i % 12, 1 + k % 28, 8, 30)
    if forma == "BLOB":
        return ("Descrição exemplo %d\r\n  linha dois" % i).encode("cp1252")
    return "S"  # CHAR/VARCHAR: cabe em qualquer tamanho da fatia


def linhas(r, ins):
    # --- fora da carga: duas linhas por tabela (só presença)
    for t, formas in FORMAS_BLOQUEADAS.items():
        for i in (1, 2):
            ins(t, [_valor(f, i, k) for k, f in enumerate(formas)])

    # --- capelas: 2 fora de funcionamento (N: inativa), 3 sem nome (1048), 4 funcionamento fora do domínio
    # (padrão disponivel + valor_fora_do_dominio)
    for x in [(1, "Capela  fluxo laminar 1", "S", "N", 1), (2, "Capela 2", "N", "N", None), (3, "   ", "S", "S", 1),
              (4, "Capela quatro", "X", "N", 1)]:
        ins("GECAPELAMP", list(x))
    # --- grupos de manipulação: 3 sem nome (1048)
    for x in [(1, None, None, "Quimioterapia"), (2, 1, None, "Nutrição   parenteral"), (3, None, None, None)]:
        ins("GEGRUPOMP", list(x))
    # --- capela x grupo: (3,1) e (1,3) com pai recusado; (9,1) capela nunca vista (pai_inexistente + 1048)
    for x in [(1, 1), (2, 2), (1, 2), (3, 1), (1, 3), (9, 1)]:
        ins("GECAPELAMP_GEGRUPOMP", list(x))

    # --- grupos de insumo: 2 prazo 400 (acima do CHECK: NULL + valor_fora_do_dominio, gravado), 3 sem nome (1048), 4 S/N fora do domínio, 6 prazo negativo
    # (NULL + valor_fora_do_dominio, gravado); natureza presumida
    for x in [(1, "Medicamentos", "S", "N", 0, 10, 0, "S"), (2, "Material  médico", "N", "N", 0, 400, 0, "N"),
              (3, None, "N", "N", 0, 5, 0, "N"), (4, "Dietas", "X", "N", 0, 3, 0, "N"),
              (5, "Gases medicinais", "N", "S", 1, 0, 12345, "S"), (6, "Grupo exemplo", "N", "N", 0, -5, 0, "N")]:
        ins("GEGRUPOS", list(x))
    # --- ações da dose: 4 só espaços (1048); notifica e bloqueia presumidos (valor_presumido por coluna em toda linha lida: 2 x 4)
    for x in [(1, "Nenhuma"), (2, "Avisar"), (3, "Bloquear"), (4, "   ")]:
        ins("GEITEACAODOSE", list(x))
    # --- kits padrão: 3 sem nome (1048), 4 S/N fora do domínio
    for x in [(1, "Kit  curativo", "S"), (2, "Kit sutura", "N"), (3, None, "S"), (4, "Kit punção", "X")]:
        ins("GEKITS", list(x))

    # --- locais de estoque (tipo presumido em toda linha lida): 3 sem nome (1048); 4 com origem no local 3
    # (recusado: gravado, pai_pendente na fase 2); 5 com origem nunca vista (NULL, pai_inexistente); 6 com 0/1 fora
    # do domínio; 7 com origem no 8 (vem depois: fase 2)
    for x in [(1, "Almoxarifado  central", None, None, None, 1, 1, 1, None),
              (2, "Farmácia central", 1, 1, 1, 1, 1, 0, 1),
              (3, "  ", None, None, None, 1, 1, 0, None),
              (4, "Farmácia satélite", None, None, None, 1, 2, 1, 3),
              (5, "Posto exemplo", None, None, None, 2, 2, None, 99),
              (6, "Carrinho exemplo", None, None, None, 1, 1, 7, 1),
              (7, "Farmácia  cirúrgica", None, None, None, 1, 1, 1, 8),
              (8, "Depósito exemplo", None, None, None, 1, 1, 0, None)]:
        ins("GELOCARM", list(x))

    # --- kits rastreáveis: 3 local recusado (pai_pendente), 4 local nunca visto (pai_inexistente + 1048), 5 kit
    # padrão recusado (pai_pendente), 6 login sem usuário (NULL + pai_inexistente), 7 S/N fora do domínio
    dh = datetime.datetime(2025, 3, 10, 14, 5)
    for x in [(1, 1, "Carrinho de  emergência 1", "S", dh, 1, "almox.exemplo", "farm.exemplo", "N"),
              (2, 2, "Kit parada", "N", None, None, None, None, "S"),
              (3, 3, "Kit do local recusado", "N", dh, 1, "almox.exemplo", None, "N"),
              (4, 9, "Kit de local inexistente", "N", dh, 1, "almox.exemplo", None, "N"),
              (5, 1, "Kit de padrão recusado", "N", dh, 3, "farm.exemplo", None, "N"),
              (6, 1, "Kit de usuário desconhecido", "S", dh, 2, "usuario.inexistente", None, "N"),
              (7, 2, "Kit uso total inválido", "N", dh, 2, "farm.exemplo", None, "Z")]:
        ins("GEKITRAS", list(x))

    # --- destinos de entrega: 2 UF fora do catálogo, 3 sem nome (1048), 4 número 0 (NULL)
    # CEP inteiro volta a 8 dígitos (1: zero à esquerda; 2: 9 dígitos, valor_fora_do_dominio); CNPJ fictício com
    # dígito verificador certo (1) e errado (4: documento_invalido); 0 é 'sem documento' (3)
    for x in [(1, "Almoxarifado  central", "Rua Exemplo", 100, "A", "Centro", "Cidade Exemplo", "SP", 1000000,
               11222333000181),
              (2, "Doca dois", "Avenida Exemplo", 25, None, "Bairro Exemplo", "Cidade Exemplo", "XX", 123456789, None),
              (3, None, "Rua Sem Nome", 1, None, None, None, "SP", None, 0),
              (4, "Entrega quatro", "Travessa Exemplo", 0, None, None, None, "RJ", None, 12345678000199)]:
        ins("GEDESCOM", list(x))

    return {
        "GECAPELAMP": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "valor_fora_do_dominio": 1}},
        "GEGRUPOMP": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        "GECAPELAMP_GEGRUPOMP": {"gravados": 3, "pendencias": {"pai_pendente": 2, "pai_inexistente": 1,
                                                               "restricao_destino_1048": 1}},
        "GEGRUPOS": {"gravados": 5, "pendencias": {"valor_presumido": 6,
                                                   "restricao_destino_1048": 1, "valor_fora_do_dominio": 3}},
        "GEITEACAODOSE": {"gravados": 3, "pendencias": {"valor_presumido": 8, "restricao_destino_1048": 1}},
        "GEKITS": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "valor_fora_do_dominio": 1}},
        "GELOCARM": {"gravados": 7, "pendencias": {"valor_presumido": 8, "restricao_destino_1048": 1,
                                                   "pai_pendente": 1, "pai_inexistente": 1,
                                                   "valor_fora_do_dominio": 1}},
        "GEKITRAS": {"gravados": 4, "pendencias": {"pai_pendente": 2, "pai_inexistente": 2,
                                                   "restricao_destino_1048": 1, "valor_fora_do_dominio": 1}},
        "GEDESCOM": {"gravados": 3, "pendencias": {"catalogo_codigo_inexistente": 1, "restricao_destino_1048": 1,
                                                   "valor_fora_do_dominio": 1, "documento_invalido": 1}},
    }
