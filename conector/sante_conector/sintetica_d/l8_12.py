"""Fatia L8-12 (faturamento e restantes, módulo FIN): tabelas da origem e anomalias, com dados 100% falsos.

As 14 tabelas carregáveis pela carga dirigida pelo mapa (rodada de cobertura). Fora daqui: 7 descartes de produto
(declarado/sem_carga.tsv: MFPARAM, TBINTIMP, TBBANCOS e quatro domínios fixos); pedidos em
docs/obra/fatias/f4/saida/L8-12.json. Pais de fora da fatia (empresa, convênio, conta, credor, tipo de lançamento,
movimento, subgrupo, centro de custo) entram como PAIS_EXTERNOS. A nota (GECADNFS, L7-08) NÃO entra: a L7-08 ainda
não a declara, e a conferência mostra o efeito real no complemento SDGECADNFS (toda linha recusada por
pai_inexistente) até a nota carregar. TBGRUDES (grupo, L8-11) e SDTIPODOCTO (modelos de documento, catálogo oficial)
entram só como ORIGEM lida pelas referências encadeadas (tipo da natureza pelo grupo, modelo da nota pelo código
oficial); o grupo também é carregado pelas declarações da L8-11 (só a conciliação dele é conferida aqui).
Anomalias: descrição nula em destino NOT NULL (1048), pai recusado (pai_pendente) e pai inexistente em coluna anulável,
S/N fora do domínio (padrão do destino), banco fora do catálogo oficial, valor presumido (=~) onde a origem não tem
fonte (valor_presumido em toda linha), texto com espaços repetidos e acentos CP1252, referência composta inexistente,
grupo sem classificação (tipo nulo: recusa), código de provisão ligada e de tipo de custo fora do domínio, empresa sem
estabelecimento, complemento sem pai, valor zero em coluna positiva, faixa, finalidade fora do domínio. CNPJ inventado
com dígito verificador calculado.
"""
import datetime
import decimal

DDL = """
CREATE TABLE TBOBSREC (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50));
CREATE TABLE TBORGAOPUBLICO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(70) NOT NULL, CNPJ BIGINT NOT NULL,
  ATIVO CHAR(1));
CREATE TABLE TBORIGEMRECEBIMENTO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(50));
CREATE TABLE TBCADPAG (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20), PADRAO VARCHAR(1), REC_A_VISTA VARCHAR(1),
  ADIANTAMENTO VARCHAR(1), TIPO_PAG VARCHAR(1), RECEBIMENTO_CHEQUE CHAR(1), ID_TBORIGEMRECEBIMENTO INTEGER);
CREATE TABLE TBTIPOLANCVLR (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(25));
CREATE TABLE TBTPCONTA (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(15));
CREATE TABLE TBNATOPE (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(60), ATIVO CHAR(1), ID_TBTPNATOPENF INTEGER);
CREATE TABLE TBTPOCORBANCOPGTO (ID SMALLINT NOT NULL PRIMARY KEY, ID_TBTABBCO VARCHAR(3) NOT NULL, CODIGO VARCHAR(2),
  NOME VARCHAR(150));
CREATE TABLE TBUNIMEN (ID INTEGER NOT NULL, COD INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(50), TIPO VARCHAR(1),
  PESO NUMERIC(9,3), COD_APURASUS BIGINT);
CREATE TABLE TBITEDES (ID INTEGER NOT NULL, GRUPO INTEGER NOT NULL, SUBGRUPO INTEGER NOT NULL, ITEM INTEGER NOT NULL,
  NOME VARCHAR(50), CODCONT VARCHAR(15), CDC INTEGER, PROVISIONADO CHAR(1), TIPO_PROV CHAR(1), PERC NUMERIC(4,2),
  INC_PROV VARCHAR(1), PESO NUMERIC(9,2), ITEMREF SMALLINT, UNIMEN SMALLINT, SGRUPOD INTEGER, ITEMD INTEGER,
  COD_OPE INTEGER, INTEG_CUST VARCHAR(1), DESPESA VARCHAR(1), TIPO_CUSTO VARCHAR(1), SITUACAO VARCHAR(1),
  COD_REDUZIDO INTEGER, ITEMREF_SAIDA SMALLINT, REC_NAO_OPER CHAR(1), COD_APURASUS BIGINT, REINF_R4000 VARCHAR(1),
  PRIMARY KEY (GRUPO, SUBGRUPO, ITEM));
CREATE TABLE MFPARAM_MFTIPOLANC (EMPRESA_MFPARAM INTEGER NOT NULL, ID_MFTIPOLANC SMALLINT NOT NULL,
  PRIMARY KEY (EMPRESA_MFPARAM, ID_MFTIPOLANC));
CREATE TABLE TBTIPOPAGFOR (FORN INTEGER NOT NULL, TIPO_PAG SMALLINT NOT NULL, PRIMARY KEY (FORN, TIPO_PAG));
CREATE TABLE MFCCCONV (ID INTEGER NOT NULL PRIMARY KEY, ID_MFLANCTO INTEGER NOT NULL, EMPRESA INTEGER NOT NULL,
  DATA DATE NOT NULL, DOC INTEGER NOT NULL, HIST VARCHAR(100), VALOR NUMERIC(18,2), DEV CHAR(1) NOT NULL,
  COD BIGINT NOT NULL, BANCO INTEGER NOT NULL, AGENCIA INTEGER NOT NULL, CONTA BIGINT NOT NULL, HIST_CONT SMALLINT,
  ID_MFCABECLANC INTEGER NOT NULL, ID_MFTIPOLANC SMALLINT NOT NULL, TP_PGTO SMALLINT, CPF_CREDITO_N_IDENT VARCHAR(11),
  ID_TBCTABAN INTEGER);
CREATE TABLE SDGECADNFS (ID_GECADNFS INTEGER NOT NULL PRIMARY KEY, ID_SDCFOP SMALLINT, ID_SDTIPODOCTO SMALLINT,
  CHAVE_NFE VARCHAR(44) NOT NULL);
CREATE TABLE TBGRUDES ("COD" INTEGER NOT NULL, "NOME" VARCHAR(40), "CODCONT" VARCHAR(15), "CDC" INTEGER, "CUSTO"
  CHAR(1), "TIPODESP" SMALLINT, "REFCDC" INTEGER, "SITUACAO" VARCHAR(1), "UNIMEN" SMALLINT, "CLASSIF" VARCHAR(1),
  PRIMARY KEY ("COD"));
CREATE TABLE SDTIPODOCTO (ID SMALLINT NOT NULL PRIMARY KEY, CODIGO VARCHAR(2), NOME VARCHAR(100));
"""

# pais de fora da fatia, como já carregados (chave do mapa; composta separada por |)
PAIS_EXTERNOS = {"TBHOSPIT": [1], "MFTIPOLANC": [1, 2], "TBFORNEC": [10, 11], "TBCONVEN": [5], "TBCTABAN": [7],
                 "MFLANCTO": [100], "TBSUBDES": ["1|10", "2|20", "4|40"], "TBCENCUS": [0]}

PREPARO_DESTINO = """
CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(40) NOT NULL);
INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');
INSERT INTO banco (codigo_compensacao, codigo_ispb, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES
  ('001', '00000001', 'Banco fictício um', '2020-01-01', 'exemplo', UTC_TIMESTAMP(3)),
  ('237', '00000237', 'Banco fictício dois', '2020-01-01', 'exemplo', UTC_TIMESTAMP(3));
"""


def cnpj_falso(base12):
    """CNPJ inventado (base de 12 dígitos) com os dois dígitos verificadores calculados."""
    d = [int(x) for x in "%012d" % base12]
    for pesos in ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]):
        s = sum(a * b for a, b in zip(d, pesos)) % 11
        d.append(0 if s < 2 else 11 - s)
    return int("".join(map(str, d)))


D = decimal.Decimal
DT = datetime.date


def chave_nfe(n):
    """Chave de acesso inventada de 44 dígitos (não confere dígito verificador: o destino só exige o formato)."""
    return "35%042d" % n


def itedes(id_, grupo, sub, item, nome, perc=None, peso=None, integ="S", despesa=None, situacao="A", rec_nao="N",
           apura=None, reinf="N", prov="F", tipo_prov=None, tipo_custo=None, cdc=0):
    return [id_, grupo, sub, item, nome, "1.1.01", cdc, prov, tipo_prov, perc, "F", peso, None, None, None, None, None,
            integ, despesa, tipo_custo, situacao, None, None, rec_nao, apura, reinf]


def ccconv(id_, lancto=100, emp=1, valor=D("1500.00"), dev="C", cod=5, conta=7):
    return [id_, lancto, emp, DT(2026, 3, id_), 500 + id_, "Crédito  convênio exemplo", valor, dev, cod, 1, 1234,
            998877, None, 1, 1, None, None, conta]

# (tabela, linhas, esperado)
DADOS = [
    ("TBOBSREC", [[1, "Bandeira  exemplo"], [2, "Cartão fictício"], [3, None], [4, "Bandeira quatro"]],
     {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}}),
    # esfera NOT NULL sem fonte: 'federal' presumida em toda linha
    ("TBORGAOPUBLICO", [[1, "Órgão  federal exemplo", cnpj_falso(123456780001), "S"],
                        [2, "Órgão municipal exemplo", cnpj_falso(987654320001), "N"],
                        [3, "Órgão estadual exemplo", cnpj_falso(111222330001), None]],
     {"gravados": 3, "pendencias": {"valor_presumido": 3}}),
    ("TBORIGEMRECEBIMENTO", [[1, "À vista"], [2, "Cartão  débito"], [3, None], [4, "Convênio exemplo"]],
     {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}}),
    # 4: origem 3 recusada (pai_pendente); 5: S/N fora do domínio; 6: origem inexistente (anulável, gravada); 7: sem nome;
    # TIPO_PAG ('R', 'A', 'P') sem de-para: uso 'ambos' presumido, valor_presumido em toda linha que passa da
    # resolução dos pais (a 4, recusada por pai_pendente antes, fica só com essa pendência)
    ("TBCADPAG", [[1, "Dinheiro", "S", "S", "N", "R", "N", 1], [2, "Cheque", "N", "N", "N", "R", "S", 1],
                  [3, "Cartão", "N", "S", "N", "A", "N", 2], [4, "Adiantamento", "N", "S", "S", "P", "N", 3],
                  [5, "Boleto", "X", "N", "N", "R", "N", None], [6, "Pix  exemplo", "N", "S", "N", "R", "N", 9],
                  [7, None, "N", "S", "N", "R", "N", 1]],
     {"gravados": 5, "pendencias": {"pai_pendente": 1, "valor_fora_do_dominio": 1, "pai_inexistente": 1,
                                    "restricao_destino_1048": 1, "valor_presumido": 6}}),
    ("TBTIPOLANCVLR", [[1, "Faturado"], [2, "Pago"], [3, "Glosado"], [4, None]],
     {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}}),
    ("TBTPCONTA", [[1, "Corrente"], [2, "Aplicação"], [3, "Poupança"]],
     {"gravados": 3, "pendencias": {"valor_presumido": 3}}),
    # finalidade pelo tipo da origem (1 nenhum: outra, 2 simples remessa, 3 venda; nulo: outra); 5: tipo 9 fora do
    # domínio (finalidade NOT NULL sem padrão: recusada); tipo_nota 'ambos' presumido em toda linha
    ("TBNATOPE", [[1, "Venda exemplo", "S", 3], [2, "Devolução  exemplo", "N", 2], [3, None, "S", None],
                  [4, "Remessa exemplo", "X", 1], [5, "Tipo inválido", "S", 9]],
     {"gravados": 3, "pendencias": {"restricao_destino_1048": 2, "valor_fora_do_dominio": 2, "valor_presumido": 5}}),
    # 3: banco fora do catálogo oficial (banco_id NOT NULL: recusada); 4: sem código de ocorrência; valor_presumido
    # fica também nas duas recusadas (o motor registra a presunção antes da gravação)
    ("TBTPOCORBANCOPGTO", [[1, "001", "02", "Entrada confirmada"], [2, "237", "06", "Liquidação  exemplo"],
                           [3, "999", "02", "Banco inexistente"], [4, "001", None, "Sem código"],
                           [5, "001", "09", "Baixa exemplo"]],
     {"gravados": 3, "pendencias": {"valor_presumido": 5, "catalogo_codigo_inexistente": 1,
                                    "restricao_destino_1048": 2}}),
    ("TBUNIMEN", [[1, 1, "Paciente-dia", "P", D("1.500"), 123456], [2, 2, "Refeição", None, None, None],
                  [3, 3, None, "P", D("2.000"), None]],
     {"gravados": 2, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 3}}),
    # tipo pelo grupo (TBGRUDES.CLASSIF: 1 D, 2 R, 4 nulo); DESPESA (nulo, E, P) sem destino. 3: provisão ligada (T)
    # fica desligada com valor_fora_do_dominio; 4: subgrupo 3|30 e grupo 3 inexistentes (NOT NULL: recusada);
    # 5: sem nome; 6: peso fora da faixa, tipo de custo X fora do domínio e centro de custo 77 inexistente (gravada);
    # 7: grupo sem classificação (tipo nulo: recusada)
    ("TBITEDES", [itedes(1, 1, 10, 1, "Material  de escritório", D("10.00"), D("1.50"), apura=123, tipo_prov="D",
                         tipo_custo="F"),
                  itedes(2, 1, 10, 2, "Aluguel exemplo", despesa="E", situacao="I", rec_nao="S", tipo_custo="V"),
                  itedes(3, 2, 20, 1, "Receita de serviço", despesa="P", prov="T"),
                  itedes(4, 3, 30, 1, "Subgrupo inexistente"),
                  itedes(5, 2, 20, 2, None),
                  itedes(6, 2, 20, 3, "Peso fora da faixa", peso=D("5000.00"), reinf="S", tipo_custo="X", cdc=77),
                  itedes(7, 4, 40, 1, "Grupo sem classificação")],
     {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 3, "pai_inexistente": 3, "restricao_destino_1048": 3}}),
    # 2|1: empresa sem estabelecimento; 1|9: tipo de lançamento inexistente (os dois NOT NULL: recusadas)
    ("MFPARAM_MFTIPOLANC", [[1, 1], [1, 2], [2, 1], [1, 9]],
     {"gravados": 2, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 2}}),
    # forma 4 (pai_pendente na TBCADPAG) e 7 (recusada sem nome): pai_pendente; credor 12 inexistente
    ("TBTIPOPAGFOR", [[10, 1], [11, 2], [10, 4], [12, 1], [11, 7]],
     {"gravados": 2, "pendencias": {"pai_pendente": 2, "pai_inexistente": 1, "restricao_destino_1048": 1}}),
    # situação 'aplicado' presumida em toda linha (valor_aplicado = valor); 2: código DEV diferente (sem destino);
    # 3: sem conta; 4: valor zero (VALOR vai a valor e valor_aplicado: valor_fora_do_dominio uma vez por coluna de
    # destino); 5: convênio inexistente (as três recusadas); 6: movimento inexistente (anulável, gravada)
    ("MFCCCONV", [ccconv(1), ccconv(2, dev="S", valor=D("200.00")), ccconv(3, conta=None), ccconv(4, valor=D("0")),
                  ccconv(5, cod=6), ccconv(6, lancto=555)],
     {"gravados": 3, "pendencias": {"restricao_destino_1048": 3, "pai_inexistente": 2, "valor_fora_do_dominio": 2,
                                    "valor_presumido": 6}}),
    # complemento da nota: a nota (GECADNFS, L7-08) ainda não carrega, por isso TODA linha é recusada por
    # pai_inexistente (efeito real). Modelos pelo código oficial: 31 '55', 1 '01', 4 '2D', 32 '57' (fora do de-para)
    ("SDGECADNFS", [[1, 5102, 31, chave_nfe(1)], [2, None, None, "123ABC"], [9, None, 1, chave_nfe(9)],
                    [3, None, 4, chave_nfe(3)], [4, None, 32, chave_nfe(4)]],
     {"gravados": 0, "pendencias": {"pai_inexistente": 5}}),
]

# só ORIGEM lida pelas referências encadeadas (não entram no esperado): grupo (1 despesa, 2 receita, 4 sem
# classificação) e modelos de documento fiscal (código oficial)
AUXILIARES = [
    ("TBGRUDES", [[1, "Grupo despesa exemplo", None, 0, "N", None, None, "A", None, "D"],
                  [2, "Grupo receita exemplo", None, 0, "N", None, None, "A", None, "R"],
                  [4, "Grupo sem classe exemplo", None, 0, "N", None, None, "A", None, None]]),
    ("SDTIPODOCTO", [[1, "01", "Modelo papel exemplo"], [4, "2D", "Cupom exemplo"], [31, "55", "Eletrônica exemplo"],
                     [32, "57", "Transporte exemplo"]]),
]


def linhas(r, ins):
    for tab, ls in AUXILIARES:
        for v in ls:
            ins(tab, list(v))
    esperado = {}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        esperado[tab] = esp
    return esperado
