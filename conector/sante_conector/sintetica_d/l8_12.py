"""Fatia L8-12 (faturamento e restantes, módulo FIN): tabelas da origem e anomalias, com dados 100% falsos.

Só as 9 tabelas carregáveis hoje pela carga dirigida pelo mapa; as outras 12 da fatia estão bloqueadas ou não viram
linha (motivos em conector/mapa/declarado/colunas.d/L8-12.tsv; pedidos em docs/obra/fatias/f4/saida/L8-12.json).
Anomalias: descrição nula em destino NOT NULL (1048), pai recusado (pai_pendente) e pai inexistente em coluna anulável,
S/N fora do domínio (padrão do destino), banco fora do
catálogo oficial, coluna NOT NULL sem fonte (1364, todas as linhas do órgão arrecadador), valor presumido (=~) onde a
origem não tem de-para (tipo da natureza, uso da forma, categoria da unidade: valor_presumido em toda linha),
texto com espaços repetidos e acentos CP1252. CNPJ inventado com dígito verificador calculado.
"""
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
"""

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
# (tabela, linhas, esperado)
DADOS = [
    ("TBOBSREC", [[1, "Bandeira  exemplo"], [2, "Cartão fictício"], [3, None], [4, "Bandeira quatro"]],
     {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}}),
    # esfera NOT NULL sem fonte: todas recusadas (1364)
    ("TBORGAOPUBLICO", [[1, "Órgão  federal exemplo", cnpj_falso(123456780001), "S"],
                        [2, "Órgão municipal exemplo", cnpj_falso(987654320001), "N"],
                        [3, "Órgão estadual exemplo", cnpj_falso(111222330001), None]],
     {"gravados": 0, "pendencias": {"restricao_destino_1364": 3}}),
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
    # 2: tipo de entrada da origem: tipo_nota 'ambos' presumido (nunca 'saida' em silêncio), valor_presumido em toda linha
    ("TBNATOPE", [[1, "Venda exemplo", "S", 1], [2, "Devolução  exemplo", "N", 2], [3, None, "S", None],
                  [4, "Remessa exemplo", "X", 1]],
     {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "valor_fora_do_dominio": 1, "valor_presumido": 4}}),
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
]


def linhas(r, ins):
    esperado = {}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        esperado[tab] = esp
    return esperado
