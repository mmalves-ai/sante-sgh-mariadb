"""Fatia L8-12 (faturamento e restantes, módulo FIN): tabelas da origem e anomalias, com dados 100% falsos.

As 15 tabelas carregáveis pela carga dirigida pelo mapa (rodada de cobertura). Fora daqui: 4 descartes de produto
(declarado/sem_carga.tsv: quatro domínios fixos; MFPARAM e TBINTIMP passaram à L8-11); pedidos em
docs/obra/fatias/f4/saida/L8-12.json. Pais de fora da fatia (empresa, convênio, conta, credor, tipo de lançamento,
movimento, subgrupo, centro de custo) entram como PAIS_EXTERNOS. A nota (GECADNFS, L7-08) NÃO entra: a L7-08 ainda
não a declara, e a conferência mostra o efeito real no complemento SDGECADNFS (toda linha recusada por
pai_inexistente) até a nota carregar. TBGRUDES (grupo, L8-11) e SDTIPODOCTO (modelos de documento, catálogo oficial)
entram só como ORIGEM lida pelas referências encadeadas (tipo da natureza pelo grupo, modelo da nota pelo código
oficial); o grupo também é carregado pelas declarações da L8-11 (só a conciliação dele é conferida aqui). A conta
(TBCTABAN, L8-11) entra do mesmo jeito: origem lida pela chave alternativa composta do contrato de cobrança (TBBANCOS)
e carregada pelas declarações da L8-11 (a do crédito de convênio também a usa). A EMPRESA do financeiro é a
mantenedora (9, fora do cadastro de estabelecimentos): o estabelecimento é o único do cliente (@estabelecimento).
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
CREATE TABLE TBBANCOS (EMPRESA INTEGER NOT NULL, COD SMALLINT NOT NULL, NOME VARCHAR(40), AGENCIA VARCHAR(20),
  CONTA VARCHAR(20), OLD_TIPO CHAR(1), NOME_AGE VARCHAR(40), ENDERECO VARCHAR(80), BAIRRO VARCHAR(30),
  CIDADE VARCHAR(30), UF VARCHAR(2), FONE VARCHAR(15), CEP INTEGER, CHE_ESP NUMERIC(18,2), COD_OPE INTEGER,
  MOD_CHEQUE SMALLINT, CARTEIRA SMALLINT, CODBCOCENTRAL VARCHAR(4), CODCEDENTE VARCHAR(18), NOMEEMPBCO VARCHAR(50),
  SITUACAO VARCHAR(1), CODCEDENTEEXP VARCHAR(18), LAYOUT_EXP_COB SMALLINT, LAYOUT_RET_COB SMALLINT,
  CEDENTE_DEBITO_AUTO VARCHAR(18), OLD_COBRANCA VARCHAR(10), ID_TBTPCONTA SMALLINT, LAYOUT_COBRANCA SMALLINT,
  LAYOUT_BOLETO SMALLINT, VARIACAO_CARTEIRA SMALLINT, PRIMARY KEY (EMPRESA, COD));
CREATE TABLE TBCTABAN ("ID" INTEGER NOT NULL, "COD" BIGINT NOT NULL, "BANCO" INTEGER NOT NULL, "AGENCIA" INTEGER NOT
  NULL, "EMPRESA" INTEGER NOT NULL, "DESCRICAO" VARCHAR(30), "TP_CONTA" CHAR(1), "CHE_ESP" NUMERIC(18,2), "ID_CTABAN"
  SMALLINT NOT NULL, "ULTIMO_CHEQUE" INTEGER, "DIGITO" VARCHAR(2), "SITUACAO" VARCHAR(1), "INTEGRAR_CONTABILIDADE"
  CHAR(1), "CONTA_RESTRICAO" CHAR(1), "NUMERO_SEQ_REMESSA_COBRANCA" INTEGER NOT NULL, "DIG_VERIFICADOR_AGENCIA_CONTA"
  SMALLINT, "NUMERO_SEQ_REMESSA_FOLHA" INTEGER, "NUMERO_SEQ_ENVIO_COBRANCA" INTEGER, PRIMARY KEY ("ID"));
CREATE TABLE MFCONPAG (ID INTEGER NOT NULL, EMPRESA SMALLINT NOT NULL, FORN INTEGER NOT NULL,
  DOC INTEGER NOT NULL, PARC SMALLINT NOT NULL, TIPO VARCHAR(1) NOT NULL, SERIE VARCHAR(3) NOT NULL, VENC DATE,
  DT_PGTO DATE, DOC_EST INTEGER, VALOR NUMERIC(18,2), PAGO NUMERIC(18,2), ACRESCIMO NUMERIC(18,2),
  DOC_USADO VARCHAR(15), EMISSAO DATE, REFERENTE VARCHAR(60), PERC NUMERIC(4,2), DESCONTO NUMERIC(18,2),
  CONSOL VARCHAR(1), ONDE VARCHAR(1), EMI_NF DATE, DATADO DATE, OBS VARCHAR(100), BANCO SMALLINT, CHEQUE INTEGER,
  STATUS SMALLINT, PAGO_COM VARCHAR(1), USUARIO VARCHAR(31), FAVORECIDO CHAR(1), TP_PGTO SMALLINT, CONV SMALLINT,
  GLOSAS NUMERIC(18,2), HIST_CONT SMALLINT, TP_FORNPRES CHAR(1), SEQ_AP INTEGER, MES_CONT SMALLINT,
  ANO_CONT SMALLINT, DOC_CONT INTEGER, ANO_CONTB SMALLINT, MES_CONTB SMALLINT, DOC_CONTB INTEGER,
  AGENCIA INTEGER, CONTA BIGINT, VLR_DOC_TOT NUMERIC(18,2), NF INTEGER NOT NULL, BORDERO INTEGER NOT NULL,
  OBS_RPA VARCHAR(100), OLD_AUTORIZADO CHAR(1), TP_DOCTO CHAR(1), DOC_CONT_CHE INTEGER, HIST_CONTB SMALLINT,
  VLR_GLOSAS NUMERIC(18,2), EMPENHO INTEGER, SUBEMPENHO INTEGER, PROCESSO INTEGER, ANO_PROCESSO SMALLINT,
  PARC_DIF CHAR(1), ID_MFCONPAG INTEGER NOT NULL, NUMERO_RPA INTEGER, ID_RPRPA INTEGER, OLD_ID_TBCBOPRO INTEGER,
  PARC_ORIG SMALLINT NOT NULL, ID_MFPAGADF INTEGER, ENTRADA DATE, DATA_HORA_INCLUSAO TIMESTAMP,
  DATA_HORA_ULTIMA_ATUALIZACAO TIMESTAMP, DATA_PREVISTA_PGTO DATE, OLD_VLR_PREVISTO_PGTO NUMERIC(18,2),
  ID_MFCABECLANC INTEGER NOT NULL, ID_MFTIPOLANC SMALLINT NOT NULL, AUTORIZADO_PGTO_PARA DATE,
  ID_MFCABECRENEGO INTEGER, ID_FPESOCFECEVT INTEGER, DATA_HORA_INC_ULT_ALT_ESOC TIMESTAMP,
  ID_ESHSTFECREABREINF INTEGER, CODIGO_BARRA_BOLETO VARCHAR(44), ID_MFREMESSA INTEGER,
  BANCO_NOSSO_NUMERO VARCHAR(15), BANCO_NUM_DOC INTEGER, FLUXO INTEGER NOT NULL,
  RENDIMENTO_SEM_RENTENCAO CHAR(1), EMISSAO_NF DATE, SERIE_NF VARCHAR(5), COMPOSICAO_BASE VARCHAR(1),
  PERAPUR VARCHAR(7), ID_TBCTABAN INTEGER, PRIMARY KEY (ID));
CREATE TABLE MFCONPAG_TBCBOPRO (ID_MFCONPAG INTEGER NOT NULL, ID_TBCBOPRO INTEGER NOT NULL,
  PRIMARY KEY (ID_MFCONPAG));
CREATE TABLE MFPAGADF (ID_MFADIFOR INTEGER NOT NULL, ID_MFCONPAG INTEGER NOT NULL,
  PARC_MFCONPAG SMALLINT NOT NULL, VLR_UTIL NUMERIC(18,2) NOT NULL, HIST SMALLINT, DATA_COMP DATE,
  ID_MFPAGADF INTEGER NOT NULL, PRIMARY KEY (ID_MFADIFOR,ID_MFCONPAG,PARC_MFCONPAG));
CREATE TABLE MFDESACR (ID INTEGER NOT NULL, EMPRESA INTEGER NOT NULL, COD BIGINT NOT NULL, TIPO CHAR(1) NOT NULL,
  DOC INTEGER NOT NULL, TP_LAN SMALLINT NOT NULL, SEQ SMALLINT NOT NULL, TPDES_ACR SMALLINT NOT NULL,
  CONTA INTEGER, VALOR NUMERIC(18,2), PARC INTEGER NOT NULL, DATA DATE NOT NULL, SERIE VARCHAR(3) NOT NULL,
  ID_MFCONPAG_DARF INTEGER, TP_ACRESCIMO_GER_EMI_DARF SMALLINT, COMPOSICAO_BASE CHAR(1), PRIMARY KEY (ID));
CREATE TABLE SDMFCONPAG (ID_MFCONPAG INTEGER NOT NULL, ID_SDNATCREDITO SMALLINT, ID_SDCSTCOFINS SMALLINT,
  ID_SDCSTPIS SMALLINT, ID_SDTIPODOCTO SMALLINT, ID_SDITEMSERVICO SMALLINT, CHAVE_NFE VARCHAR(60),
  PRIMARY KEY (ID_MFCONPAG));
CREATE TABLE MFLANGSI (EMPRESA INTEGER NOT NULL, FORN BIGINT NOT NULL, DOC INTEGER NOT NULL,
  TIPO CHAR(1) NOT NULL, GRUPO INTEGER NOT NULL, SUBGRUPO INTEGER NOT NULL, ITEM INTEGER NOT NULL,
  VALOR NUMERIC(18,2) NOT NULL, CDC INTEGER, TP_LAN SMALLINT NOT NULL, DATA DATE NOT NULL,
  SERIE VARCHAR(3) NOT NULL, PERAPUR VARCHAR(7),
  PRIMARY KEY (EMPRESA,TP_LAN,FORN,DATA,DOC,TIPO,SERIE,GRUPO,SUBGRUPO,ITEM));
CREATE TABLE TBCBOPRO (ID INTEGER NOT NULL, ID_TBCBOSUS INTEGER NOT NULL, UF VARCHAR(2) NOT NULL,
  COD INTEGER NOT NULL, ID_TBPROFIS INTEGER NOT NULL, VINC_EMPR VARCHAR(1) NOT NULL, CONS_PROF VARCHAR(7),
  ATIVO VARCHAR(1), VINCULO SMALLINT, COMP_INICIAL INTEGER, COMP_FINAL INTEGER, ATENDE_SUS CHAR(1),
  CRM_DIGITO VARCHAR(1), REGIONAL INTEGER, ID_TBSIGLACONSPROF SMALLINT, REG_QUALIF_ESPECIALISTA VARCHAR(9),
  AXREG_ID_ANESTHESIOLOGISTS BIGINT, ID_DIGITAL VARCHAR(36), PRIMARY KEY (ID));
CREATE TABLE MFREFDES (EMPRESA SMALLINT NOT NULL, COD INTEGER NOT NULL, DESCRICAO VARCHAR(40), CDC INTEGER,
  HISTPR SMALLINT, TIPO INTEGER NOT NULL, GRUPO INTEGER, SUBGRUPO INTEGER, ITEM INTEGER,
  SITUACAO CHAR(1) NOT NULL, INTEGRAR_IMPOSTO_CTA_PAG SMALLINT, INTEGRAR_IMPOSTO_CTA_REC SMALLINT,
  ID_TBFINCODRECOL SMALLINT, FATO_GERADOR_PAGAR SMALLINT, FATO_GERADOR_RECEBER SMALLINT,
  PRIMARY KEY (EMPRESA,COD));
CREATE TABLE MFCTAREC (ID INTEGER NOT NULL, EMPRESA SMALLINT NOT NULL, DEV CHAR(1), COD BIGINT NOT NULL,
  DOC INTEGER NOT NULL, SERIE VARCHAR(3), PARC SMALLINT NOT NULL,
  VENC DATE, APRES DATE, VALOR NUMERIC(18,2), DESCONTO NUMERIC(18,2), ACRESCIMO NUMERIC(18,2), JUROS
  NUMERIC(18,2), VLR_GLO NUMERIC(18,2), GLOSA_ACEITA NUMERIC(18,2), VLR_PAG NUMERIC(18,2), PGTO DATE,
  DATA_HORA_INCLUSAO TIMESTAMP, ID_MFCABECLANC INTEGER, REFERENTE VARCHAR(50), OBS VARCHAR(100), TIPO_DOC
  VARCHAR(1), PRIMARY KEY (ID));
"""

# pais de fora da fatia, como já carregados (chave do mapa; composta separada por |)
PAIS_EXTERNOS = {"TBHOSPIT": [1], "MFTIPOLANC": [1, 2], "TBFORNEC": [10, 11], "TBCONVEN": [5],
                 "MFCABECLANC": [1], "MFADIFOR": [1], "TBPROFIS": [501],
                 "MFLANCTO": [100], "TBSUBDES": ["1|10", "2|20", "4|40"], "TBCENCUS": [0],
                 "TBAGEBAN": ["9|1|1234", "9|237|55", "9|2|55", "9|3|1234"]}

PREPARO_DESTINO = """
CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(40) NOT NULL);
INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');
INSERT INTO banco (codigo_compensacao, codigo_ispb, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES
  ('001', '00000001', 'Banco fictício um', '2020-01-01', 'exemplo', UTC_TIMESTAMP(3)),
  ('237', '00000237', 'Banco fictício dois', '2020-01-01', 'exemplo', UTC_TIMESTAMP(3));
INSERT IGNORE INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES
  ('35', 'SP', 'Unidade exemplo SP', 1, UTC_TIMESTAMP(3));
INSERT IGNORE INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES
  ('06', 'CRM', 'Conselho exemplo um', UTC_TIMESTAMP(3));
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


def bancos(cod, nome, ag, conta, cbc, ced=None, exp=None, cart=None, var=None, sit="A", deb=None):
    """Cadastro de banco por empresa (mantenedora 9); leiautes e modelo de cheque com números internos inventados."""
    return [9, cod, nome, ag, conta, None, "Agência exemplo", "Rua Inventada 1", "Bairro falso", "Cidade falsa", "SP",
            None, 1000000, None, None, 1, cart, cbc, ced, "Hospital exemplo", sit, exp, 3, 4, deb, None, 1, 5, 6, var]


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
    # natureza pela palavra da descrição; 4: descrição fora da lista (valor_fora_do_dominio, vale a sobra 'corrente'
    # presumida); o motor marca valor_presumido em toda linha da coluna concorrente (pedido 25)
    ("TBTPCONTA", [[1, "Corrente"], [2, "Aplicação"], [3, "Poupança"], [4, "Conta salário"]],
     {"gravados": 4, "pendencias": {"valor_presumido": 1, "valor_fora_do_dominio": 1}}),
    # contrato de cobrança: um por código de beneficiário (cobrança registrada e débito automático). 1: os dois (2
    # contratos); 2: só cobrança, inativo (suspenso); 3: sem nenhum (sem_item_a_gravar); 4: sem conta igual
    # (pai_inexistente, NOT NULL recusa); 5: sem nome (NOT NULL recusa) e situação fora do domínio
    ("TBBANCOS", [bancos(1, "Banco fictício um", "1234", "11111", "001", "123456", "654321", 17, 19, deb="998877"),
                  bancos(237, "Banco fictício dois", "55", "22222", "237", "555000", sit="I"),
                  bancos(3, "Banco sem cobrança", "1234", "77777", "001"),
                  bancos(104, "Banco sem conta", "20", "55555", "104", "777000"),
                  bancos(2, None, "55", "33333", "237", "888000", sit="X")],
     {"gravados": 3, "pendencias": {"sem_item_a_gravar": 1, "pai_inexistente": 1, "restricao_destino_1048": 2,
                                    "valor_fora_do_dominio": 1}}),
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
    # empresa = mantenedora (9 e 8, fora do cadastro de estabelecimentos): estabelecimento único; 8|1: o mesmo tipo em
    # outra empresa é adotado; 9|9: tipo de lançamento inexistente (NOT NULL: recusada)
    ("MFPARAM_MFTIPOLANC", [[9, 1], [9, 2], [8, 1], [9, 9]],
     {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1, "adotado_existente": 1}}),
    # forma 4 (pai_pendente na TBCADPAG) e 7 (recusada sem nome): pai_pendente; credor 12 inexistente
    ("TBTIPOPAGFOR", [[10, 1], [11, 2], [10, 4], [12, 1], [11, 7]],
     {"gravados": 2, "pendencias": {"pai_pendente": 2, "pai_inexistente": 1, "restricao_destino_1048": 1}}),
    # situação 'aplicado' presumida em toda linha (valor_aplicado = valor); 2: código DEV diferente (sem destino);
    # 3: sem conta; 4: valor zero (VALOR vai a valor e valor_aplicado: valor_fora_do_dominio uma vez por coluna de
    # destino); 5: convênio inexistente (as três recusadas); 6: movimento inexistente (anulável, gravada)
    ("MFCCCONV", [ccconv(1, emp=9), ccconv(2, dev="S", valor=D("200.00")), ccconv(3, conta=None), ccconv(4, valor=D("0")),
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
    # contas (TBCTABAN, L8-11; mantenedora 9): 1, 2 e 3 casam com os cadastros de cobrança; 7 é a do crédito
    ("TBCTABAN", [[i, cod, bco, ag, 9, "Conta exemplo %d" % i, "C", None, 40 + i, 100 + i, str(i), "A", "N", "F", i,
                   None, None, None] for i, cod, bco, ag in ((1, 11111, 1, 1234), (2, 22222, 237, 55),
                                                             (3, 33333, 2, 55), (7, 77777, 3, 1234))]),
    ("SDTIPODOCTO", [[1, "01", "Modelo papel exemplo"], [4, "2D", "Cupom exemplo"], [31, "55", "Eletrônica exemplo"],
                     [32, "57", "Transporte exemplo"]]),
]



# títulos a pagar (rodada 4): colunas na ordem da origem; o resto nulo
COLUNAS = {'MFCONPAG': ['ID', 'EMPRESA', 'FORN', 'DOC', 'PARC', 'TIPO', 'SERIE', 'VENC', 'DT_PGTO', 'DOC_EST', 'VALOR', 'PAGO', 'ACRESCIMO', 'DOC_USADO', 'EMISSAO', 'REFERENTE', 'PERC', 'DESCONTO', 'CONSOL', 'ONDE', 'EMI_NF', 'DATADO', 'OBS', 'BANCO', 'CHEQUE', 'STATUS', 'PAGO_COM', 'USUARIO', 'FAVORECIDO', 'TP_PGTO', 'CONV', 'GLOSAS', 'HIST_CONT', 'TP_FORNPRES', 'SEQ_AP', 'MES_CONT', 'ANO_CONT', 'DOC_CONT', 'ANO_CONTB', 'MES_CONTB', 'DOC_CONTB', 'AGENCIA', 'CONTA', 'VLR_DOC_TOT', 'NF', 'BORDERO', 'OBS_RPA', 'OLD_AUTORIZADO', 'TP_DOCTO', 'DOC_CONT_CHE', 'HIST_CONTB', 'VLR_GLOSAS', 'EMPENHO', 'SUBEMPENHO', 'PROCESSO', 'ANO_PROCESSO', 'PARC_DIF', 'ID_MFCONPAG', 'NUMERO_RPA', 'ID_RPRPA', 'OLD_ID_TBCBOPRO', 'PARC_ORIG', 'ID_MFPAGADF', 'ENTRADA', 'DATA_HORA_INCLUSAO', 'DATA_HORA_ULTIMA_ATUALIZACAO', 'DATA_PREVISTA_PGTO', 'OLD_VLR_PREVISTO_PGTO', 'ID_MFCABECLANC', 'ID_MFTIPOLANC', 'AUTORIZADO_PGTO_PARA', 'ID_MFCABECRENEGO', 'ID_FPESOCFECEVT', 'DATA_HORA_INC_ULT_ALT_ESOC', 'ID_ESHSTFECREABREINF', 'CODIGO_BARRA_BOLETO', 'ID_MFREMESSA', 'BANCO_NOSSO_NUMERO', 'BANCO_NUM_DOC', 'FLUXO', 'RENDIMENTO_SEM_RENTENCAO', 'EMISSAO_NF', 'SERIE_NF', 'COMPOSICAO_BASE', 'PERAPUR', 'ID_TBCTABAN'], 'MFCONPAG_TBCBOPRO': ['ID_MFCONPAG', 'ID_TBCBOPRO'], 'MFPAGADF': ['ID_MFADIFOR', 'ID_MFCONPAG', 'PARC_MFCONPAG', 'VLR_UTIL', 'HIST', 'DATA_COMP', 'ID_MFPAGADF'], 'MFDESACR': ['ID', 'EMPRESA', 'COD', 'TIPO', 'DOC', 'TP_LAN', 'SEQ', 'TPDES_ACR', 'CONTA', 'VALOR', 'PARC', 'DATA', 'SERIE', 'ID_MFCONPAG_DARF', 'TP_ACRESCIMO_GER_EMI_DARF', 'COMPOSICAO_BASE'], 'SDMFCONPAG': ['ID_MFCONPAG', 'ID_SDNATCREDITO', 'ID_SDCSTCOFINS', 'ID_SDCSTPIS', 'ID_SDTIPODOCTO', 'ID_SDITEMSERVICO', 'CHAVE_NFE'], 'MFLANGSI': ['EMPRESA', 'FORN', 'DOC', 'TIPO', 'GRUPO', 'SUBGRUPO', 'ITEM', 'VALOR', 'CDC', 'TP_LAN', 'DATA', 'SERIE', 'PERAPUR'], 'TBCBOPRO': ['ID', 'ID_TBCBOSUS', 'UF', 'COD', 'ID_TBPROFIS', 'VINC_EMPR', 'CONS_PROF', 'ATIVO', 'VINCULO', 'COMP_INICIAL', 'COMP_FINAL', 'ATENDE_SUS', 'CRM_DIGITO', 'REGIONAL', 'ID_TBSIGLACONSPROF', 'REG_QUALIF_ESPECIALISTA', 'AXREG_ID_ANESTHESIOLOGISTS', 'ID_DIGITAL'], 'MFREFDES': ['EMPRESA', 'COD', 'DESCRICAO', 'CDC', 'HISTPR', 'TIPO', 'GRUPO', 'SUBGRUPO', 'ITEM', 'SITUACAO', 'INTEGRAR_IMPOSTO_CTA_PAG', 'INTEGRAR_IMPOSTO_CTA_REC', 'ID_TBFINCODRECOL', 'FATO_GERADOR_PAGAR', 'FATO_GERADOR_RECEBER'], 'MFCTAREC': ['ID', 'EMPRESA', 'DEV', 'COD', 'DOC', 'SERIE', 'PARC', 'VENC', 'APRES', 'VALOR', 'DESCONTO', 'ACRESCIMO', 'JUROS', 'VLR_GLO', 'GLOSA_ACEITA', 'VLR_PAG', 'PGTO', 'DATA_HORA_INCLUSAO', 'ID_MFCABECLANC', 'REFERENTE', 'OBS', 'TIPO_DOC']}


def _linha(t, **v):
    return [v.get(c) for c in COLUNAS[t]]


def conpag(id_, forn, doc, parc, valor, pago=D("0.00"), dt_pgto=DT(1899, 12, 30), cta=None, tit=None, tp_docto="F",
           emissao=None):
    return _linha("MFCONPAG", ID=id_, EMPRESA=9, FORN=forn, DOC=doc, PARC=parc, TIPO="N", SERIE="1",
                  VENC=DT(2026, 2, 10) if parc == 1 else DT(2026, 3, 10), DT_PGTO=dt_pgto, VALOR=valor, PAGO=pago,
                  EMISSAO=emissao or DT(2026, 1, 5), ENTRADA=DT(2026, 1, 6), REFERENTE="Compra  exemplo",
                  DATA_HORA_INCLUSAO=datetime.datetime(2026, 1, 6, 10, 0), NF=0, BORDERO=0, TP_DOCTO=tp_docto,
                  ID_MFCONPAG=tit or id_, PARC_ORIG=parc, ID_MFCABECLANC=1, ID_MFTIPOLANC=1, FLUXO=0, ID_TBCTABAN=cta)


def langsi(forn, doc, grupo, sub, item, valor):
    return _linha("MFLANGSI", EMPRESA=9, FORN=forn, DOC=doc, TIPO="N", GRUPO=grupo, SUBGRUPO=sub, ITEM=item,
                  VALOR=valor, TP_LAN=0, DATA=DT(2026, 1, 5), SERIE="1")


def refdes(cod, desc, tipo):
    return _linha("MFREFDES", EMPRESA=9, COD=cod, DESCRICAO=desc, TIPO=tipo, GRUPO=1, SUBGRUPO=10, ITEM=1, SITUACAO="A")


def desacr(id_, seq, tpdes, valor, parc, comp="N", tp_lan=0, cod=10, doc=500):
    return _linha("MFDESACR", ID=id_, EMPRESA=9, COD=cod, TIPO="N", DOC=doc, TP_LAN=tp_lan, SEQ=seq, TPDES_ACR=tpdes,
                  VALOR=valor, PARC=parc, DATA=DT(2026, 1, 20), SERIE="1", COMPOSICAO_BASE=comp)


# rateio (só ORIGEM lida pela natureza do título: o maior rateio do documento) e origens das cadeias (motivo do
# ajuste e inscrição do profissional, carregados pelas declarações da L8-11 e da L5-04: só a conciliação deles)
AUXILIARES += [
    ("MFLANGSI", [langsi(10, 500, 1, 10, 1, D("150.00")), langsi(10, 500, 1, 10, 2, D("50.00")),
                  langsi(99, 700, 1, 10, 1, D("80.00")), langsi(10, 800, 1, 10, 1, D("60.00")),
                  langsi(10, 900, 1, 10, 2, D("10.00"))]),
    ("MFREFDES", [refdes(101, "Desconto exemplo", 0), refdes(102, "Acréscimo exemplo", 1), refdes(103, "Retenção exemplo", 2)]),
    ("TBCBOPRO", [_linha("TBCBOPRO", ID=70, ID_TBCBOSUS=1, UF="SP", COD=1234, ID_TBPROFIS=501, VINC_EMPR="N", CONS_PROF="CRM",
                           ATIVO="S"),
                  _linha("TBCBOPRO", ID=71, ID_TBCBOSUS=1, UF="SP", COD=4321, ID_TBPROFIS=999, VINC_EMPR="N", CONS_PROF="CRM",
                           ATIVO="S")]),
]

# EFEITO REAL hoje (pedido 26 em saida/L8-12.json): o motor grava os secundários `antes` na ordem de tabelas_destino
# (título antes do tipo de documento), o título sai sem o tipo (1048) e toda parcela é recusada; as filhas caem em
# pai_pendente. COM_ORDEM_POR_ID: efeito medido numa cópia isolada do conector com o motor corrigido (ordem dos `antes`
# pela dependência @id:), a trocar pelo real quando o pedido 26 for aplicado.
ESP_MFCONPAG = {"gravados": 0, "pendencias": {"data_sentinela": 8, "escolha_pelo_maior": 2, "pai_inexistente": 1,
                                              "restricao_destino_1048": 7, "valor_presumido": 8}}
ESP_BENEF = {"gravados": 0, "pendencias": {"pai_inexistente": 5, "restricao_destino_1048": 4}}
ESP_FISCAL = {"gravados": 0, "pendencias": {"pai_pendente": 3}}
ESP_AJUSTE = {"gravados": 0, "pendencias": {"pai_inexistente": 1, "pai_pendente": 4, "restricao_destino_4025": 1}}
ESP_COMP = {"gravados": 0, "pendencias": {"pai_pendente": 3}}
COM_ORDEM_POR_ID = {
    "MFCONPAG": {"gravados": 4, "pendencias": {"adotado_existente": 2, "data_sentinela": 8, "escolha_pelo_maior": 2,
                                               "pai_inexistente": 1, "restricao_destino_1048": 2,
                                               "restricao_destino_4025": 1, "valor_presumido": 8}},
    "MFCONPAG_TBCBOPRO": {"gravados": 2, "pendencias": {"adotado_existente": 1, "pai_inexistente": 2,
                                                        "restricao_destino_1048": 2}},
    "SDMFCONPAG": {"gravados": 1, "pendencias": {"pai_pendente": 1, "restricao_destino_4025": 1}},
    "MFDESACR": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_4025": 1,
                                               "valor_fora_do_dominio": 1}},
    "MFPAGADF": {"gravados": 1, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 2}},
}
DADOS += [
    # parcelas (sem pagamento: a origem guarda a data sentinela 1899-12-30 e PAGO 0): 1 e 2 formam o título A (credor
    # 10, documento 500; natureza do MAIOR rateio, 150 x 50); 1 paga com conta (baixa; compensada em parte por
    # adiantamento: o PAGO já inclui a compensação); 2 aberta (sem baixa, saldo = valor); 3: documento sem rateio
    # (natureza pai_inexistente + 1048 do título); 4: credor 99 inexistente (CHECK do credor); 5: paga sem conta (CHECK
    # do meio da baixa recusa: visível; 0 na referência); 6: tipo de documento ausente (tipo presumido) e pago a maior,
    # paga com conta (saldo 0); 7: aberta com conta prevista (181 na referência): a baixa sem data recusa (pedido 29)
    ("MFCONPAG", [conpag(1, 10, 500, 1, D("100.00"), D("100.00"), DT(2026, 2, 10), 1),
                  conpag(2, 10, 500, 2, D("100.00"), tit=1),
                  conpag(3, 11, 600, 1, D("50.00")),
                  conpag(4, 99, 700, 1, D("80.00")),
                  conpag(5, 10, 800, 1, D("60.00"), D("60.00"), DT(2026, 2, 11)),
                  conpag(6, 10, 900, 1, D("10.00"), D("15.00"), DT(2026, 2, 12), 2, tp_docto=None),
                  conpag(7, 10, 900, 2, D("20.00"), cta=1, tit=6)],
     ESP_MFCONPAG),
    # beneficiário: 1 e 2 (mesmo título e profissional: adotado); 3: parcela recusada (pai_pendente); 6: inscrição
    # 71 de profissional inexistente (pai_inexistente + 1048)
    ("MFCONPAG_TBCBOPRO", [[1, 70], [2, 70], [3, 70], [6, 71]], ESP_BENEF),
    # dado fiscal: 1 (modelo 55, chave válida); 2: chave fora do formato (CHECK); 3: parcela recusada (pai_pendente)
    ("SDMFCONPAG", [_linha("SDMFCONPAG", ID_MFCONPAG=1, ID_SDTIPODOCTO=31, CHAVE_NFE=chave_nfe(7)),
                    _linha("SDMFCONPAG", ID_MFCONPAG=2, ID_SDTIPODOCTO=1, CHAVE_NFE="123"),
                    _linha("SDMFCONPAG", ID_MFCONPAG=3, CHAVE_NFE=chave_nfe(8))],
     ESP_FISCAL),
    # ajustes (a natureza é o próprio TPDES_ACR): 1 desconto (parcela 1), 2 acréscimo (parcela 2, compõe a base),
    # 3 retenção natureza 4 (abatimento com motivo), 4 parcela 9 inexistente (pai_inexistente + CHECK do pai),
    # 6 natureza 20 fora do domínio (recusa). O ajuste a receber (TP_LAN 1) vai à parcela a receber da L8-11: provado
    # no teste da declaração (a imagem da fatia não carrega o contas a receber)
    ("MFDESACR", [desacr(1, 1, 0, D("5.00"), 1), desacr(2, 1, 1, D("3.00"), 2, "S"), desacr(3, 2, 4, D("4.00"), 1),
                  desacr(4, 3, 0, D("2.00"), 9), desacr(6, 4, 20, D("1.00"), 1)],
     ESP_AJUSTE),
    # compensação (ID_MFCONPAG = chave da PARCELA): adiantamento 1 na parcela 1 paga (liga à baixa dela);
    # adiantamento 9 inexistente na parcela 6; adiantamento 1 na parcela 2 aberta (sem baixa: NOT NULL recusa)
    ("MFPAGADF", [[1, 1, 1, D("40.00"), None, DT(2026, 2, 20), 1], [9, 6, 1, D("10.00"), None, DT(2026, 2, 21), 2],
                  [1, 2, 2, D("5.00"), None, DT(2026, 2, 22), 3]],
     ESP_COMP),
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
