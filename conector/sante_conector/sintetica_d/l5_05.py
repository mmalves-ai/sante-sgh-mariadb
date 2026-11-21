"""Fatia L5-05 (cadastros e administração, módulo CAD): tabelas da origem e anomalias, com dados 100% falsos.

Só as 8 tabelas carregáveis hoje pela carga dirigida pelo mapa (as outras 12 da fatia aguardam regra genérica do
motor; ver docs/obra/fatias/f4/saida/L5-05.md). Anomalias: descrição vazia em destino NOT NULL (1048), código com
colisão de caixa (codigo_colisao_caixa nas duas linhas do par, pelo motor), S/N fora do
domínio (padrão do destino), texto com espaços repetidos, quebra de linha interna e acentos CP1252.

DESTINO_L3 guarda o destino real depois do L3 (sexo M/F/I, tipo de telefone residencial/celular, tipo de documento
rg). Ele vira PREPARO_DESTINO quando TBSEXO, TBTIPOTELEFONE e TBTPDOCUMENTO voltarem a ser carregadas (adoção pela
chave natural no motor): hoje esses destinos nem são criados no banco da conferência.
"""

DDL = """
CREATE TABLE TBGENERO_SOCIAL (ID SMALLINT NOT NULL PRIMARY KEY, CODIGO SMALLINT NOT NULL, NOME VARCHAR(30), ATIVO CHAR(1));
CREATE TABLE TBGRAU_INST (COD_GRAU VARCHAR(1) NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(150), DESCRICAO_ESOCIAL VARCHAR(150),
  COD_ESOCIAL VARCHAR(2));
CREATE TABLE TBGRUCONVEN (ID INTEGER NOT NULL PRIMARY KEY, COD SMALLINT NOT NULL, NOME VARCHAR(40));
CREATE TABLE TBPARENTE (COD_PAR SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20), ID_DIGITAL VARCHAR(36));
CREATE TABLE TBPESQUIPLANO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40) NOT NULL);
CREATE TABLE TBRELIG (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE TBTIPOATEUNIDADE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50), ID_DIGITAL VARCHAR(36));
CREATE TABLE TBVULNERABILIDADE_SOCIAL (ID SMALLINT NOT NULL PRIMARY KEY, CODIGO SMALLINT NOT NULL, DESCRICAO VARCHAR(40),
  ATIVO CHAR(1) NOT NULL);
"""

# destino real depois da carga do L3 (carga.py SEXOS e TIPOS_PROPRIOS): a adoção pela chave natural será conferida sobre ele
DESTINO_L3 = """
INSERT IGNORE INTO sexo (codigo, descricao, sigla, criado_em) VALUES ('masculino', 'Masculino', 'M', UTC_TIMESTAMP(3)),
  ('feminino', 'Feminino', 'F', UTC_TIMESTAMP(3)), ('indeterminado', 'Indeterminado', 'I', UTC_TIMESTAMP(3));
INSERT IGNORE INTO tipo_telefone (codigo, descricao, criado_em) VALUES ('residencial', 'Residencial', UTC_TIMESTAMP(3)),
  ('celular', 'Celular', UTC_TIMESTAMP(3));
INSERT IGNORE INTO tipo_documento_identificacao (codigo, descricao, criado_em)
  VALUES ('rg', 'Registro geral (identidade)', UTC_TIMESTAMP(3));
"""

# (tabela, linhas, esperado)
DADOS = [
    ("TBGENERO_SOCIAL", [[1, 1, "Mulher  trans", "S"], [2, 2, "Homem trans", "N"], [3, 3, None, "S"],
                         [4, 4, "Não binário", "X"]],
     {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "valor_fora_do_dominio": 1}}),
    ("TBGRAU_INST", [["1", "Sem escolaridade", "Analfabeto", "01"],
                     ["2", " Fundamental\r\nincompleto ", "Fundamental incompleto", " 2"],
                     ["A", "Superior completo", None, "09"], ["a", "Superior (caixa baixa)", None, "10"],
                     ["9", None, None, None]],
     {"gravados": 2, "pendencias": {"codigo_colisao_caixa": 2, "restricao_destino_1048": 1}}),
    ("TBGRUCONVEN", [[1, 1, "Convênios   privados"], [2, 2, "Público"], [5, 3, "  Particular  "]],
     {"gravados": 3, "pendencias": {}}),
    ("TBPARENTE", [[1, "Pai", "00000000-0000-0000-0000-000000000001"], [2, "Mãe", None], [3, "Cônjuge", None],
                   [4, "Irmão", None]],
     {"gravados": 4, "pendencias": {}}),
    ("TBPESQUIPLANO", [[1, "Possui plano"], [2, "Não possui"], [3, "Cartão de desconto"]],
     {"gravados": 3, "pendencias": {}}),
    ("TBRELIG", [[1, "Crença exemplo um"], [2, "Crença exemplo dois"], [3, None], [4, "Crença  exemplo   três"]],
     {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}}),
    ("TBTIPOATEUNIDADE", [[1, "Ambulatório", None], [2, "Pronto atendimento", None], [3, "Internação", None]],
     {"gravados": 3, "pendencias": {}}),
    ("TBVULNERABILIDADE_SOCIAL", [[1, 1, "Situação exemplo", "S"], [2, 2, "Outra situação", "N"]],
     {"gravados": 2, "pendencias": {}}),
]


def linhas(r, ins):
    esperado = {}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        esperado[tab] = esp
    return esperado
