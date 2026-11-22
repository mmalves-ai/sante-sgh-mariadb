"""Fatia L7-05 (SADT e suprimentos, módulo SUP): tabelas da origem com as colunas de
`conector/mapa/declarado/colunas.d/L7-05.tsv`, dados 100% falsos e as anomalias da fatia.

Carregadas (15): capelas e grupos de manipulação (e a associativa), grupos de insumo (natureza PRESUMIDA 'outro'),
ações da dose, kits padrão, locais de estoque (tipo PRESUMIDO 'outro', local de origem por autorreferência em duas
fases), kits rastreáveis, destinos de entrega de compra, recálculo de saldo (competência ANO+MES), documentos de
transferência (situação pela consolidação) e seus itens (unidade pelo insumo, encadeada), estoque inicial como
inventário de abertura, sequências de documento e parâmetros de
reposição por local.
Rodada 3: fechamento mensal (sempre 'fechado', data do fechamento presumida), saldo mensal por local e insumo (o
saldo do local e insumo gravado antes e adotado nos meses seguintes), movimento do mês completando o saldo mensal,
itens do estoque inicial (rodada de contagem do cabeçalho) e descrição do serviço completando o item de compra.
Rodada 3 (revisão): o item de transferência grava também o movimento de SAÍDA do local de origem (razão do estoque,
contrapartida no local de destino); a sequência do ano (MES 0) entra com reinício anual; o saldo do local e insumo e a
classificação das saídas do mês entram PRESUMIDOS (valor_presumido visível).
Rodada 3 (conferidor): horários padrão por número de doses (GEHORMED, uma linha por coluna H<doses><posição> em
horario_padrao_dose) e lote dispensado por documento (GECTRVMM: movimento_lote do movimento de saída, com o lote
físico adotado pelo insumo e número em lote_insumo). O movimento (GELANSAI) e o lote (GEVALMEM) são de outras fatias e
não estão nesta imagem: recusa visível; a prova positiva vem na carga integrada.
Rodada 4: consumo por centro de custo (GEKONCDC) somado por ano, mês, centro de custo e insumo (`agrupar:` no destino
principal, documentos no retrato do grupo). O centro de custo (L8-11) e o documento de saída (L7-07) não estão nesta
imagem: recusa visível (pai_inexistente + 1048 do local NOT NULL); a prova positiva do agrupamento é a do motor
(exemplo_r4, EX4_KON) e a carga integrada.
Fora da carga (2, entram na imagem para provar que nada é gravado): compras e terceiros (descarte).
Itens do estoque inicial e descrição do serviço: o insumo (unidade) e o item de compra são de outras fatias e não
estão nesta imagem: recusa visível (pai_inexistente); a prova positiva vem na carga integrada.
Ordem: o local de estoque (GELOCARM) vem hoje DEPOIS de documentos, estoque inicial e reposição (aresta pedida); o
esperado dessas tabelas sai das duas ordens (`_local_antes`), para a conferência valer antes e depois da integração.
Anomalias: nome vazio ou só espaços em destino NOT NULL (1048), S/N e 0/1 fora do domínio (padrão com pendência),
prazo acima de 365 (4025), pai recusado (pai_pendente), pai nunca visto (pai_inexistente, + 1048 se NOT NULL),
autorreferência a local recusado e a local nunca visto (fase 2), login sem usuário (NULL aceito), UF fora do
catálogo (catalogo_codigo_inexistente), 0 como "sem valor" (NULL), nome com espaços repetidos.
"""
import datetime
import re
import decimal
from pathlib import Path

from .. import mapa

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
CREATE TABLE TBCENCUS ("COD" INTEGER NOT NULL, "NOME" VARCHAR(50), "SIGLA" VARCHAR(8), "LOCCON" SMALLINT, "ENDERECO"
  VARCHAR(45), "BAIRRO" VARCHAR(30), "CIDADE" VARCHAR(30), "UF" VARCHAR(2), "FONE" VARCHAR(15), "CEP" INTEGER, "INSCR"
  VARCHAR(15), "PERC_MEDC" DOUBLE PRECISION, "PERC_MEDO" DOUBLE PRECISION, "RC_INI" INTEGER, "RC_FIN" INTEGER,
  "REF_CONT" VARCHAR(10), "GRUPO" SMALLINT, "FORMULA" SMALLINT, "CLASSIF" SMALLINT, "SITUACAO" VARCHAR(1), "PRODUTIVO"
  VARCHAR(1), "UNIDADE" SMALLINT, "CGC" BIGINT, "REP_MAT" NUMERIC(9,2), "REP_MED" NUMERIC(9,2), "CONTABIL" BIGINT,
  "TIP_PRECO" VARCHAR(1), "UNIMEN" SMALLINT, "MOVIMENTACAO" VARCHAR(1), "LUCRO_ESP" NUMERIC(9,2), "INVEST"
  NUMERIC(9,2), "RISCOS" NUMERIC(9,2), "LOCARM" SMALLINT, "COB_PERC" VARCHAR(1), "ID" INTEGER NOT NULL,
  "DATA_HORA_GRAV" TIMESTAMP, "CUSTO_VAR_COMPOE_ITEM_PROD" CHAR(1), "ID_CHCRITICIDADE" SMALLINT,
  "PERMITIR_EVOLUCAO_GRUPO_PEP" CHAR(1), "COD_APURASUS" BIGINT, "INDICADOR_PRODUCAO" INTEGER,
  "CODIGO_EXTERNO_ITEM_PRODUCAO" BIGINT, PRIMARY KEY ("COD"));
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

# centro de custo (L8-11) carregado AQUI pela declaração de lá (mesma forma e as mesmas linhas da imagem da L8-11, mais
# o local de estoque padrão do 11): só para a prova positiva do consumo por centro de custo; conferido pela conciliação
PAIS_NA_IMAGEM = ("TBCENCUS",)
_COLS_TBCENCUS = re.findall(r'"(\w+)"\s+[A-Z]', DDL[DDL.index("CREATE TABLE TBCENCUS"):DDL.index("CREATE TABLE GEKONCDC")])
PAIS_EXTERNOS = {"TBUSERS": ["almox.exemplo", "farm.exemplo"], "GEITENS": ["1", "2"], "GETPLANCTO": ["1", "2"]}
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
                   " INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES"
                   " ('35', 'SP', 'Unidade exemplo SP', 1, UTC_TIMESTAMP(3)),"
                   " ('33', 'RJ', 'Unidade exemplo RJ', 1, UTC_TIMESTAMP(3));"
                   # tipo NATIVO de migração (semente de db/migracoes/11_SUP/07_chaves.sql): saída da transferência
                   " CREATE TABLE IF NOT EXISTS tipo_movimento_estoque (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(30) NOT NULL UNIQUE);"
                   " INSERT IGNORE INTO tipo_movimento_estoque (codigo, descricao, natureza, sentido, afeta_saldo, afeta_custo_medio,"
                   " sistema, ativo, criado_em) VALUES ('migracao_entrada', 'Entrada trazida de outro sistema', 'entrada',"
                   " 'entrada', TRUE, FALSE, TRUE, FALSE, UTC_TIMESTAMP(3)), ('migracao_saida', 'Saída trazida de outro"
                   " sistema', 'saida', 'saida', TRUE, FALSE, TRUE, FALSE, UTC_TIMESTAMP(3))")

CARREGADAS = ("GECAPELAMP", "GEDESCOM", "GEGRUPOMP", "GECAPELAMP_GEGRUPOMP", "GEGRUPOS", "GEITEACAODOSE", "GEKITS",
              "GELOCARM", "GEKITRAS", "GEATUALIZASALDO", "GECADTRA", "GEESTINI", "GEGERSEQ", "GELIMLOC",
              "GELANTRA", "GEFECMES", "GEARMLOC", "GECONITL", "GELANESI", "GEDESPDS", "GEHORMED", "GECTRVMM",
              "GEKONCDC", "GECADTER")
# rodada 5 (ADR 0006): GECADTER e GECOMPRA deixam o descarte e carregam na trilha (retrato completo da linha)
FORMAS_BLOQUEADAS = {}
# r5c: GECOMPRA PENDENTE (pedido r5b_historico_compra): na imagem, nada esperado no destino
# r5c: GECOMPRA PENDENTE (pedido r5b_historico_compra): na imagem, nada esperado no destino
BLOQUEADAS = tuple(FORMAS_BLOQUEADAS) + ("GECOMPRA",) + ("GECOMPRA",)

D = decimal.Decimal


def _ordem():
    p = Path(__file__).resolve().parents[2] / "mapa" / "tabelas.tsv"
    return {r["tabela"]: int(r["ordem"]) for r in mapa.ler_tsv(p) if (r.get("ordem") or "").isdigit()}


def _local_antes(filho):
    """O local de estoque (GELOCARM, desta fatia) é carregado antes de `filho` na ordem do mapa?"""
    o = _ordem()
    return o.get("GELOCARM", 0) < o.get(filho, 0)


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

    # --- recálculo de saldo: 3 sem mês (competência vazia: 1048), 4 mês 13 (valor_fora_do_dominio nas duas
    # competências + 1048), 5 marca de término fora do domínio (padrão + pendência), 6 login sem usuário
    di, df = datetime.datetime(2025, 4, 1, 22, 0), datetime.datetime(2025, 4, 1, 23, 15)
    for x in [(1, di, "almox.exemplo", 5, 7, "S", df, 3, 2025, "10.0.0.1"),
              (2, di, None, 5, 8, "N", df, 4, 2025, None),
              (3, di, "almox.exemplo", 5, 9, "S", df, None, 2025, None),
              (4, di, "almox.exemplo", 5, 10, "S", df, 13, 2025, None),
              (5, di, "farm.exemplo", 5, 11, "Z", df, 5, 2025, None),
              (6, di, "usuario.inexistente", 5, 12, "S", df, 6, 2025, None)]:
        ins("GEATUALIZASALDO", list(x))

    # --- documentos de transferência (tipo transferência, fato da tabela; situação pela consolidação: 10 S concluido,
    # 11 N aberto; 16 X: padrão aberto + valor_fora_do_dominio na situação e no consolidado):
    # 12 sem data (1048), 13 origem = destino (4025), 14 destino recusado (pai_pendente), 15 destino nunca visto
    # (pai_inexistente + 4025), 16 consolidado fora do domínio e login sem usuário (gravado)
    d0, dh = datetime.date(2025, 5, 2), datetime.datetime(2025, 5, 2, 9, 0)
    for (i, data, ori, des, cons, obs, usu) in [(10, d0, 1, 2, "S", "Reposição  semanal", "almox.exemplo"),
                                                 (11, d0, 2, 1, "N", "  Devolução ", None),
                                                 (12, None, 1, 2, "S", None, "almox.exemplo"),
                                                 (13, d0, 1, 1, "S", None, "almox.exemplo"),
                                                 (14, d0, 1, 3, "S", None, "almox.exemplo"),
                                                 (15, d0, 1, 99, "S", None, "almox.exemplo"),
                                                 (16, d0, 2, 4, "X", None, "usuario.inexistente")]:
        ins("GECADTRA", [i, 2025, 5, i - 9, data, None, obs, cons, ori, des, "N", "S", d0, "0900", "0900", usu,
                         None, None, dh, dh, "T"])
    # --- itens do documento: a unidade vem do insumo (encadeada) e o insumo é de outra fatia (GEITENS não está
    # nesta imagem): pai_inexistente na unidade + 1048; 101 de documento recusado (pai_pendente); 102 de documento
    # nunca visto (pai_inexistente no documento e na unidade + 1048)
    for (i, doc, seq) in [(100, 10, 1), (101, 14, 1), (102, 999, 1)]:
        ins("GELANTRA", [doc, None, None, None, seq, 1, "S", D("5.000"), D("2.50"), None, i, 0, D("5.000"), dh, dh])

    # --- estoque inicial: 3 sem usuário (1048), 4 local recusado (pai_pendente), 5 consolidação fora do domínio
    # (padrão 'aberto' + pendência)
    for x in [(1, d0, 1, "S", "almox.exemplo", None), (2, d0, 2, "N", "farm.exemplo", None),
              (3, d0, 1, "S", None, None), (4, d0, 3, "S", "almox.exemplo", None),
              (5, d0, 1, "X", "farm.exemplo", None)]:
        ins("GEESTINI", list(x))

    # --- fechamento mensal: sempre 'fechado' com a data do fechamento presumida (valor_presumido em toda linha
    # lida); mês 13 (valor_fora_do_dominio + 1048); exportado fora do domínio (padrão FALSE + pendência)
    for x in [(2025, 1, "S"), (2025, 2, "N"), (2025, 3, None), (2025, 13, "S"), (2025, 4, "X")]:
        ins("GEFECMES", list(x))

    # --- saldo mensal por local e insumo (ANO, MES, LOCAL, ITEM, QTDE, VALOR, RELEVAR, TRANSICAO): a cria o saldo
    # (1,1), b o adota no mês seguinte (adotado_existente), c e d criam (2,1) e (1,2); e local recusado (pai_pendente);
    # f local nunca visto e g insumo nunca visto (pai_inexistente + 1048); h mês 13 (valor_fora_do_dominio na
    # competência e no instante + 1048)
    for x in [(2025, 1, 1, 1, D("10.000"), D("100.00"), "N", "N"), (2025, 2, 1, 1, D("12.000"), D("120.00"), "N", "N"),
              (2025, 1, 2, 1, D("5.000"), D("50.00"), None, None), (2025, 1, 1, 2, None, None, "S", "S"),
              (2025, 1, 3, 1, D("1.000"), D("1.00"), None, None), (2025, 1, 99, 1, D("1.000"), D("1.00"), None, None),
              (2025, 1, 1, 77, D("1.000"), D("1.00"), None, None), (2025, 13, 2, 2, D("1.000"), D("1.00"), None, None)]:
        ins("GEARMLOC", list(x))
    # --- movimento do mês (ANO, MES, LOCAL, ITEM, ENT, SAI, DEV, VLR_ENT, VLR_SAI, VLR_DEV): completa o saldo mensal
    # de mesma chave: p e q completam a e b; r e t de saldo recusado (pai_pendente); s sem saldo mensal (pai_inexistente)
    for x in [(2025, 1, 1, 1, D("5.000"), D("3.000"), D("1.000"), D("50.00"), D("30.00"), D("10.00")),
              (2025, 2, 1, 1, None, None, None, None, None, None),
              (2025, 1, 3, 1, D("1.000"), None, None, D("1.00"), None, None),
              (2025, 5, 1, 1, D("1.000"), None, None, D("1.00"), None, None),
              (2025, 13, 2, 2, D("1.000"), None, None, D("1.00"), None, None)]:
        ins("GECONITL", list(x))
    # --- itens do estoque inicial (ID, DOC, ITEM, QTDE, VLRMED, CONS, TOTAL): a unidade vem do insumo (encadeada,
    # GEITENS fora desta imagem): pai_inexistente + 1048; 3 de documento recusado (pai_pendente); 4 de documento nunca
    # visto (pai_inexistente no inventário, na rodada, no usuário, na data e na unidade + 1048)
    for x in [(1, 1, 1, D("10.000"), D("2.5000"), "S", D("25.00")), (2, 1, 2, D("5.000"), D("1.0000"), "N", D("5.00")),
              (3, 4, 1, D("1.000"), D("1.0000"), "S", D("1.00")), (4, 9, 1, D("1.000"), D("1.0000"), "S", D("1.00"))]:
        ins("GELANESI", list(x))
    # --- descrição do serviço (ANO, OQUE, DOC, SEQ, DESCRICAO): o item de compra (GELANPED) é de outra fatia e não
    # está nesta imagem: pai_inexistente e recusa (complementa)
    for x in [(2025, "P", 1, 1, "Manutenção  preventiva\r\n  do equipamento".encode("cp1252")),
              (2025, "L", 2, 1, None)]:
        ins("GEDESPDS", list(x))

    # --- sequências: 0 elevado a 1, ano 1999 (CHECK do período: 4025), tipo de movimento nunca visto (1048);
    # MES 0 = sequência do ano (reinício anual, mês 0)
    for x in [(1, "Transferência", 15, 1, 2025), (1, "Transferência", 0, 2, 2025), (2, "Saída", 7, 1, 1999),
              (9, "Tipo exemplo", 3, 1, 2025), (2, "Sequência do ano", 4, 0, 2025)]:
        ins("GEGERSEQ", list(x))

    # --- reposição por local: (1,3) local recusado, (1,2) máximo menor que o mínimo (4025), (77,1) insumo nunca
    # visto (1048), (2,1) mínimo negativo (padrão 0 + pendência)
    for x in [(1, 1, D("10.000"), D("20.000")), (2, 2, D("0.000"), None), (1, 3, D("1.000"), D("2.000")),
              (1, 2, D("30.000"), D("10.000")), (77, 1, D("1.000"), D("2.000")), (2, 1, D("-5.000"), D("5.000"))]:
        ins("GELIMLOC", list(x))

    # --- horários padrão por número de doses (H<doses><posição>, HHMM inteiro): a grade de 1, 2, 3 e 4 doses (0 =
    # 00:00, válido) grava 10 horários; H61 com minuto 75 (hora_invalida, sem linha); a 2.ª linha só tem um horário
    # inválido e nenhum item: recusa com sem_item_a_gravar (a hora inválida da linha recusada não conta à parte)
    horas = [800, 800, 2000, 600, 1400, 2200, 600, 1200, 1800, 0, 2575] + [None] * 25
    ins("GEHORMED", horas)
    ins("GEHORMED", [2575] + [None] * 35)

    # --- lote dispensado por documento (ANO, MES, DOC, ITEM, DATA, QTDE, LOTE): o movimento de saída (GELANSAI) e o
    # lote (GEVALMEM) são de outras fatias e não estão nesta imagem: movimento e validade pai_inexistente, o lote não
    # existe para adotar e a criação recusa por validade nula (1048); insumo 77 nunca visto (mais um pai_inexistente)
    dd = datetime.date(2025, 5, 2)
    for x in [(2025, 5, 10, 1, dd, D("3.000"), "LOTE-A1"), (2025, 5, 10, 2, dd, D("1.000"), "LOTE-B1"),
              (2025, 5, 11, 77, dd, D("2.000"), "LOTE-C1")]:
        ins("GECTRVMM", list(x))

    loc_doc, loc_inv, loc_rep = _local_antes("GECADTRA"), _local_antes("GEESTINI"), _local_antes("GELIMLOC")
    loc_sal = _local_antes("GEARMLOC")
    esp = {
        "GEATUALIZASALDO": {"gravados": 4, "pendencias": {"restricao_destino_1048": 2, "valor_fora_do_dominio": 3,
                                                          "pai_inexistente": 1}},
        "GEGERSEQ": {"gravados": 3, "pendencias": {"valor_elevado_ao_minimo": 1, "restricao_destino_4025": 1,
                                                   "pai_inexistente": 1, "restricao_destino_1048": 1}},
    }
    if loc_doc:
        esp["GECADTRA"] = {"gravados": 3, "pendencias": {"restricao_destino_1048": 1,
                                                         "restricao_destino_4025": 2, "pai_pendente": 1,
                                                         "pai_inexistente": 2, "valor_fora_do_dominio": 2}}
        # o movimento de saída (secundário) repete as referências pelo documento e pela unidade: 2 na linha 100 e
        # 9 na linha 102 (documento nunca visto: documento, locais, data, competência, usuário e as duas unidades)
        esp["GELANTRA"] = {"gravados": 0, "pendencias": {"pai_inexistente": 11, "restricao_destino_1048": 2,
                                                         "pai_pendente": 1}}
    else:  # local ainda não carregado: o local de origem é NOT NULL e toda transferência recusa (1048)
        esp["GECADTRA"] = {"gravados": 0, "pendencias": {"pai_inexistente": 15,
                                                         "restricao_destino_1048": 7, "valor_fora_do_dominio": 2}}
        esp["GELANTRA"] = {"gravados": 0, "pendencias": {"pai_pendente": 2, "pai_inexistente": 9,
                                                         "restricao_destino_1048": 1}}
    esp["GEESTINI"] = {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "pai_pendente": 1,
                                                     "valor_fora_do_dominio": 1}} if loc_inv else \
        {"gravados": 0, "pendencias": {"pai_inexistente": 5, "restricao_destino_1048": 5, "valor_fora_do_dominio": 1}}
    esp["GELIMLOC"] = {"gravados": 3, "pendencias": {"pai_pendente": 1, "restricao_destino_4025": 1,
                                                     "pai_inexistente": 1, "restricao_destino_1048": 1,
                                                     "valor_fora_do_dominio": 1}} if loc_rep else \
        {"gravados": 0, "pendencias": {"pai_inexistente": 7, "restricao_destino_1048": 6, "valor_fora_do_dominio": 1}}

    esp["GEFECMES"] = {"gravados": 4, "pendencias": {"valor_presumido": 5, "valor_fora_do_dominio": 2,
                                                     "restricao_destino_1048": 1}}
    if loc_sal:
        esp["GEARMLOC"] = {"gravados": 4, "pendencias": {"adotado_existente": 1, "pai_pendente": 1,
                                                         "pai_inexistente": 2, "restricao_destino_1048": 3,
                                                         "valor_fora_do_dominio": 2, "valor_presumido": 7}}
        esp["GECONITL"] = {"gravados": 2, "pendencias": {"pai_pendente": 2, "pai_inexistente": 1,
                                                         "valor_presumido": 2}}
    else:  # local ainda não carregado: o saldo exige o local (NOT NULL) e todo saldo mensal recusa
        esp["GEARMLOC"] = {"gravados": 0, "pendencias": {"pai_inexistente": 9, "restricao_destino_1048": 8,
                                                         "valor_fora_do_dominio": 2, "valor_presumido": 8}}
        esp["GECONITL"] = {"gravados": 0, "pendencias": {"pai_pendente": 4, "pai_inexistente": 1}}
    esp["GELANESI"] = {"gravados": 0, "pendencias": {"pai_inexistente": 7, "restricao_destino_1048": 3,
                                                     "pai_pendente": 1}} if loc_inv else \
        {"gravados": 0, "pendencias": {"pai_pendente": 3, "pai_inexistente": 5, "restricao_destino_1048": 1}}
    esp["GEDESPDS"] = {"gravados": 0, "pendencias": {"pai_inexistente": 2}}
    esp["GEHORMED"] = {"gravados": 10, "pendencias": {"hora_invalida": 1, "sem_item_a_gravar": 1}}
    # --- consumo por centro de custo: centros como na L8-11 (11 com o local 1 como estoque padrão; 12 sem local; 13
    # sem nome, recusado lá); dois documentos do mesmo grupo (2025/3, centro 11, insumo 1: soma 3.500 e 17.50, os dois
    # documentos no JSON), um de outro insumo e um de outro mês (3 grupos gravados); 5: centro 12 sem local padrão e o
    # documento de saída fora da imagem (local NOT NULL: 1048)
    for c, n, sit, um, ap, loc in [(11, "Centro  Administrativo", "A", 7, 0, 1), (12, "Centro Cirúrgico", "I", 0, 1234567, None),
                                   (13, None, "A", 0, None, None), (14, "Centro Lavanderia", "X", 0, None, None)]:
        v = dict(COD=c, NOME=n, SIGLA="C%d" % c, SITUACAO=sit, ID=500 + c, UNIMEN=um, COD_APURASUS=ap, LOCARM=loc)
        ins("TBCENCUS", [v.get(k) for k in _COLS_TBCENCUS])
    for x in [(2025, 3, 11, datetime.date(2025, 3, 5), 1, 100, D("2.000"), D("10.00")),
              (2025, 3, 11, datetime.date(2025, 3, 9), 1, 101, D("1.500"), D("7.50")),
              (2025, 3, 11, datetime.date(2025, 3, 9), 2, 101, D("4.000"), D("8.00")),
              (2025, 4, 11, datetime.date(2025, 4, 2), 1, 102, D("1.000"), D("5.00")),
              (2025, 4, 12, datetime.date(2025, 4, 3), 1, 103, D("2.000"), D("4.00"))]:
        ins("GEKONCDC", list(x))
    # "gravados" conta as linhas da origem gravadas (4, em 3 grupos: test_l7_05 confere as somas)
    esp["GEKONCDC"] = {"gravados": 4, "pendencias": {"pai_inexistente": 5, "restricao_destino_1048": 1}}
    esp["GECTRVMM"] = {"gravados": 0, "pendencias": {"pai_inexistente": 7, "restricao_destino_1048": 3}}

    # --- rodada 5 (ADR 0006): terceiros só com nome e nascimento e histórico de compra na trilha (retrato completo);
    # compra do insumo 9 (nunca visto): entidade_id NULL com pai_inexistente, a linha fica
    for x in [("Terceiro Exemplo Um", datetime.date(1980, 1, 2), 1), ("Terceiro Exemplo Dois", datetime.date(1975, 5, 6), 2)]:
        ins("GECADTER", list(x))
    for x in [(1, datetime.date(2025, 3, 5), 10, 100, 1000, D("2.000"), D("5.0000"), D("10.0000"), "Marca exemplo", None),
              (2, datetime.date(2025, 3, 6), 11, 101, 1001, D("1.000"), D("3.5000"), D("3.5000"), None, D("4.0000"))]:
        ins("GECOMPRA", list(x))
    esp["GECADTER"] = {"gravados": 2, "pendencias": {}}

    return dict(esp, **{
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
    })
