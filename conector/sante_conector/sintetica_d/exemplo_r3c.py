"""Fatia `exemplo_r3c`: prova os mecanismos GENÉRICOS da rodada 3 de cobertura do conector (F4), grupo 3 (catálogos
fiscais), com mapa e destino próprios (tabelas inventadas, prefixo EX3C_, fora do mapa real; dados 100% falsos).

Cobre: de-para oficial `cfop` (código de 4 dígitos com ou sem ponto, pela referência encadeada ao código guardado na
tabela de CFOP da origem, `ref:EX3C_CFOP>CODIGO`) e `codigo_fiscal:<tabela>` (código de uma tabela fiscal oficial,
zeros à esquerda não contam, versão vigente preferida); catálogos do padrão TISS: `versao_tiss` (versão de troca
pelo código, '04.03.00' ou '040300') e `tiss:<número da tabela>` (termo da terminologia TISS pelo código). O
catálogo oficial nunca é gravado (regra 7): o preparo do destino faz o papel do carregador versionado; código ausente
ou inválido vira pendência, sem valor.
"""
DDL = """
CREATE TABLE EX3C_CFOP (ID SMALLINT NOT NULL PRIMARY KEY, CODIGO VARCHAR(6));
CREATE TABLE EX3C_NOTA (ID INTEGER NOT NULL PRIMARY KEY, NUM INTEGER, ID_CFOP SMALLINT, MODELO VARCHAR(3),
  VERSAO VARCHAR(10), VIA VARCHAR(5));
"""

_A = (", origem VARCHAR(20) NOT NULL, criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL,"
      " versao INT UNSIGNED NOT NULL DEFAULT 1")
DDL_DESTINO = """
CREATE TABLE cfop (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo_cfop CHAR(4) NOT NULL,
  descricao VARCHAR(500) NOT NULL, CONSTRAINT uq_ex3c_cfop UNIQUE (codigo_cfop));
CREATE TABLE tabela_fiscal_oficial (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, tabela VARCHAR(60) NOT NULL,
  codigo_oficial VARCHAR(10) NOT NULL);
CREATE TABLE codigo_fiscal_oficial (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tabela_fiscal_oficial_id BIGINT UNSIGNED NOT NULL, codigo_oficial VARCHAR(30) NOT NULL,
  vigencia_inicio DATE NOT NULL, vigencia_fim DATE NULL);
CREATE TABLE versao_padrao_tiss (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo_tiss VARCHAR(10) NOT NULL,
  componente VARCHAR(30) NOT NULL);
CREATE TABLE terminologia (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, numero_tabela_tiss VARCHAR(5) NULL);
CREATE TABLE termo_terminologia (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  terminologia_id BIGINT UNSIGNED NOT NULL, codigo_termo VARCHAR(40) NOT NULL);
CREATE TABLE ex3c_nota (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, numero INT NOT NULL,
  cfop_id BIGINT UNSIGNED NULL, modelo_documento_id BIGINT UNSIGNED NULL, versao_tiss_id BIGINT UNSIGNED NULL,
  via_termo_id BIGINT UNSIGNED NULL{a});
""".format(a=_A)

# o papel do carregador oficial: CFOP 1102, 5102 e 1556; modelo de documento 55 e 01 (o 01 com uma versão revogada
# antes da vigente: casa a vigente); outra tabela fiscal com o código 99 (não vale para o modelo de documento)
PREPARO_DESTINO = ";\n".join([
    "INSERT INTO cfop (id, codigo_cfop, descricao) VALUES (11, '1102', 'Compra para comercialização'),"
    " (12, '5102', 'Venda de mercadoria'), (13, '1556', 'Compra de material para uso ou consumo')",
    "INSERT INTO tabela_fiscal_oficial (id, tabela, codigo_oficial) VALUES (1, 'modelo_documento', '00'),"
    " (2, 'cst_pis', '00')",
    "INSERT INTO codigo_fiscal_oficial (id, tabela_fiscal_oficial_id, codigo_oficial, vigencia_inicio, vigencia_fim)"
    " VALUES (21, 1, '55', '2006-01-01', NULL), (22, 1, '01', '1990-01-01', '2005-12-31'),"
    " (23, 1, '01', '2006-01-01', NULL), (24, 2, '99', '2006-01-01', NULL)",
    # padrão TISS: versão 4.03.00 de troca (e a de monitoramento, que não vale para a troca); tabelas 61 e 18 com o
    # mesmo código de termo '01' (o número da tabela decide)
    "INSERT INTO versao_padrao_tiss (id, codigo_tiss, componente) VALUES (31, '4.03.00', 'troca'),"
    " (32, '4.03.00', 'monitoramento')",
    "INSERT INTO terminologia (id, numero_tabela_tiss) VALUES (41, '61'), (42, '18')",
    "INSERT INTO termo_terminologia (id, terminologia_id, codigo_termo) VALUES (51, 41, '01'), (52, 42, '01')"])


def _g(t, c, regra):
    return {"tabela": t, "coluna": c, "regra": regra, "referencia": "", "depara": ""}


def _d(t, c, destino, regra="", via="", depara=""):
    return {"tabela": t, "coluna": c, "destino": destino, "regra": regra, "depara": depara, "via": via,
            "motivo": "exemplo"}


CFOP, NOTA = "EX3C_CFOP", "EX3C_NOTA"
MAPA_TESTE = {
    "tabelas": [
        # a tabela de CFOP da origem é catálogo oficial: nunca gravada, só lida pela referência encadeada
        {"tabela": CFOP, "tabelas_destino": "", "ordem": "0", "chave": "ID", "estrategia": "depara_catalogo_oficial"},
        {"tabela": NOTA, "tabelas_destino": "ex3c_nota", "ordem": "1", "chave": "ID", "estrategia": "hash_linha"}],
    "colunas": [
        _g(CFOP, "ID", "inteiro"), _g(CFOP, "CODIGO", "texto"),
        _g(NOTA, "ID", "inteiro"), _g(NOTA, "NUM", "inteiro"), _g(NOTA, "ID_CFOP", "inteiro"),
        _g(NOTA, "MODELO", "texto"), _g(NOTA, "VERSAO", "texto"), _g(NOTA, "VIA", "texto")],
    "colunas_decl": [
        _d(NOTA, "NUM", "ex3c_nota.numero", regra="inteiro"),
        _d(NOTA, "ID_CFOP", "ex3c_nota.cfop_id", regra="texto", via="ref:EX3C_CFOP>CODIGO", depara="cfop"),
        _d(NOTA, "MODELO", "ex3c_nota.modelo_documento_id", regra="texto",
           depara="codigo_fiscal:modelo_documento"),
        _d(NOTA, "VERSAO", "ex3c_nota.versao_tiss_id", regra="texto", depara="versao_tiss"),
        _d(NOTA, "VIA", "ex3c_nota.via_termo_id", regra="texto", depara="tiss:61")],
    "valores": [], "deps": [], "descartes": [],
}


def linhas(r, ins):
    # CFOP da origem: com ponto, sem ponto, válido mas fora do catálogo, inválido (9.º grupo não existe), sem código
    for k, cod in ((1, "1.102"), (2, "5102"), (3, "2102"), (4, "9102"), (5, "1556"), (6, None)):
        ins(CFOP, [k, cod])
    # notas: 1 CFOP com ponto e modelo 55; 2 sem ponto e modelo '1' (zero à esquerda não conta: casa o 01 vigente);
    # 3 CFOP fora do catálogo e modelo de outra tabela fiscal (inexistentes); 4 CFOP inválido e modelo 'AB'
    # (inexistente); 5 pai de CFOP inexistente; 6 tudo vazio; 7 CFOP sem código no pai (vazio, sem pendência)
    # versão TISS: '04.03.00' e '040300' casam a 4.03.00 de troca; 3.05.00 inexistente; 'x' inválida. Termo da
    # tabela 61: '1' e '01' casam o 51 (nunca o 52, da tabela 18); '99' inexistente
    ins(NOTA, [1, 101, 1, "55", "04.03.00", "1"])
    ins(NOTA, [2, 102, 2, "1", "040300", "01"])
    ins(NOTA, [3, 103, 3, "99", "3.05.00", "99"])
    ins(NOTA, [4, 104, 4, "AB", "x", None])
    ins(NOTA, [5, 105, 9, None, None, None])
    ins(NOTA, [6, 106, None, None, None, None])
    ins(NOTA, [7, 107, 6, "01", None, None])
    return {
        NOTA: {"gravados": 7, "pendencias": {"catalogo_codigo_inexistente": 5, "catalogo_codigo_invalido": 2,
                                             "pai_inexistente": 1}},
    }
