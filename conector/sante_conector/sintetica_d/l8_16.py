"""Fatia L8-16 (faturamento e restantes, módulo INTG): tabelas da origem e anomalias, com dados 100% falsos.

Carregadas pela carga dirigida pelo mapa: perfil de prioridade da triagem externa, pedido de compra ligado à cotação
no portal, equivalência de exame por interface de equipamento e pedido de vínculo do profissional externo
(autocadastro no portal, conselho pelo de-para oficial `conselho_classe`). As outras 18 tabelas da fatia são descarte
de produto (`declarado/sem_carga.tsv`). TBCONSPROF entra só como origem do conselho (catálogo oficial: de-para pela
sigla guardada no pai, nunca gravado).
Anomalias: nome só de espaços (1048), espaços repetidos colapsados, acentos CP1252, código repetido na chave única
(1062), pai inexistente (pedido, interface, exame e solicitante), código do exame no equipamento ausente (1048), CPF
inválido (documento_invalido + 1048), sigla de conselho fora do catálogo (catalogo_codigo_inexistente + 1048), e-mail
ausente (1048), data do pedido presumida (valor_presumido por linha lida, inclusive a recusada), senha nunca migrada.
Pais de fora da fatia: PAIS_EXTERNOS (contrato da conferência por fatia). GECADPED (L7-07) e SITPEQV (L7-03) ainda
estão BLOQUEADOS na cobertura global: na imagem real GEINTAPOIOCOT e SITBEXEQ só gravam depois que eles carregarem.
"""
import datetime

DDL = """
CREATE TABLE RETPPROTOLIFE (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE GEINTAPOIOCOT (ID_GECADPED INTEGER NOT NULL PRIMARY KEY, COD_APOIO_COTACAO INTEGER NOT NULL,
  ID_GEPORTALCOMPRAS SMALLINT NOT NULL);
CREATE TABLE SITBEXEQ (TIPO SMALLINT NOT NULL, ATO SMALLINT NOT NULL, CODALF VARCHAR(4) NOT NULL,
  COD_EXAME VARCHAR(20), CODMATERIAL VARCHAR(8) NOT NULL, ENVIAR_ELEMENTO_ARQ_EXP CHAR(1),
  PRIMARY KEY (TIPO, ATO, CODALF, CODMATERIAL));
CREATE TABLE TBCONSPROF (ID SMALLINT NOT NULL PRIMARY KEY, COD_CONSELHO_PROF VARCHAR(7) NOT NULL,
  NOME VARCHAR(70) NOT NULL, ID_TBTISSCONSPROF SMALLINT NOT NULL);
CREATE TABLE TBMEDSOLWEBCAD (ID INTEGER NOT NULL PRIMARY KEY, DATA_NASC DATE, TELCEL VARCHAR(12), TELFIXO VARCHAR(12),
  EMAIL VARCHAR(100), CPF BIGINT, SEXO VARCHAR(1), ID_TBCONSPROF SMALLINT, SENHA VARCHAR(100), ATIVO VARCHAR(1),
  ID_TBMEDSOL INTEGER, ID_TBCBOPRO INTEGER, COD_CONSELHO_PROFISSIONAL INTEGER NOT NULL, NOME VARCHAR(70) NOT NULL,
  ID_TBUF VARCHAR(2));
"""

AUXILIARES = ["TBCONSPROF"]   # só origem (catálogo oficial pelo de-para): não carrega
PAIS_EXTERNOS = {"GECADPED": ["1", "2", "3"], "GEPORTALCOMPRAS": ["1", "2"], "SITABPRO": ["1|GL", "1|HB"],
                 "SITPEQV": ["1"]}
PREPARO_DESTINO = (
    "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
    " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
    " INSERT IGNORE INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES"
    " ('35', 'SP', 'Unidade exemplo SP', 1, UTC_TIMESTAMP(3)), ('33', 'RJ', 'Unidade exemplo RJ', 1, UTC_TIMESTAMP(3));"
    " INSERT IGNORE INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES"
    " ('06', 'CRM', 'Conselho exemplo um', UTC_TIMESTAMP(3)), ('07', 'COREN', 'Conselho exemplo dois', UTC_TIMESTAMP(3))")


def _cpf(base9):
    """CPF falso com dígitos verificadores válidos (inteiro, como a origem guarda)."""
    d = [int(x) for x in base9]
    for n in (10, 11):
        r = sum(v * (n - i) for i, v in enumerate(d)) * 10 % 11
        d.append(0 if r == 10 else r)
    return int("".join(map(str, d)))


CONSELHOS = [[1, "CRM", "Conselho exemplo um", 6], [2, "COREN", "Conselho exemplo dois", 7],
             [3, "XYZ", "Conselho exemplo fora", 9]]

# (tabela, linhas, esperado, recusadas)
DADOS = [
    # 3 só de espaços: recusada (1048); 2 com espaços repetidos; 5 com acento
    ("RETPPROTOLIFE", [[1, "Perfil exemplo um"], [2, "Perfil  exemplo   dois"], [3, "   "],
                       [4, "Perfil exemplo quatro"], [5, "Perfil exemplo ação"]],
     {"gravados": 4, "pendencias": {"restricao_destino_1048": 1}}, 1),
    # 2 repete o código da cotação de 1 no mesmo portal (1062); pedido 9 inexistente (pai_inexistente + 1048)
    ("GEINTAPOIOCOT", [[1, 5001, 1], [2, 5001, 1], [3, 5004, 2], [9, 5009, 1]],
     {"gravados": 2, "pendencias": {"restricao_destino_1062": 1, "pai_inexistente": 1,
                                    "restricao_destino_1048": 1}}, 2),
    # 3: sem código no equipamento (1048); 4 e 5: interface 2 e exame 2|XX inexistentes (pai_inexistente + 1048);
    # 6: repete interface, código do exame e do material da 2 (1062)
    ("SITBEXEQ", [[1, 1, "HB", "HGB", "SG", "S"], [1, 1, "GL", "GLU", "SR", "N"], [1, 1, "HB", None, "PL", "N"],
                  [2, 1, "GL", "GLU2", "SR", "S"], [1, 2, "XX", "ZZZ", "SG", None], [1, 1, "HB", "GLU", "SR", "N"]],
     {"gravados": 2, "pendencias": {"restricao_destino_1048": 3, "pai_inexistente": 2,
                                    "restricao_destino_1062": 1}}, 4),
    # ID, DATA_NASC, TELCEL, TELFIXO, EMAIL, CPF, SEXO, ID_TBCONSPROF, SENHA, ATIVO, ID_TBMEDSOL, ID_TBCBOPRO,
    # COD_CONSELHO_PROFISSIONAL, NOME, ID_TBUF
    # 1 e 2 entram (2 com espaços repetidos e acento); 3 CPF inválido; 4 conselho fora do catálogo; 5 solicitante
    # inexistente (entra sem o vínculo); 6 sem e-mail. Data do pedido presumida nas 6 (valor_presumido)
    ("TBMEDSOLWEBCAD", [
        [1, datetime.date(1980, 1, 2), "11900000001", None, "um@exemplo.invalid", _cpf("123456789"), "M", 1, "segredo-falso", "S",
         None, None, 1001, "Pessoa exemplo um", "SP"],
        [2, None, None, "1130000002", "dois@exemplo.invalid", _cpf("987654321"), "F", 2, None, "S",
         None, None, 1002, "Pessoa  exemplo   ação", "RJ"],
        [3, None, None, None, "tres@exemplo.invalid", 11111111111, None, 1, None, "S", None, None, 1003,
         "Pessoa exemplo tres", "SP"],
        [4, None, None, None, "quatro@exemplo.invalid", _cpf("111444777"), None, 3, None, "S", None, None, 1004,
         "Pessoa exemplo quatro", "SP"],
        [5, None, None, None, "cinco@exemplo.invalid", _cpf("222555888"), None, 2, None, "N", 99, None, 1005,
         "Pessoa exemplo cinco", "SP"],
        [6, None, None, None, None, _cpf("333666999"), None, 1, None, "S", None, None, 1006,
         "Pessoa exemplo seis", "SP"]],
     {"gravados": 3, "pendencias": {"documento_invalido": 1, "catalogo_codigo_inexistente": 1, "pai_inexistente": 1,
                                    "restricao_destino_1048": 3, "valor_presumido": 6}}, 3),
]


def linhas(r, ins):
    for v in CONSELHOS:
        ins("TBCONSPROF", list(v))
    esperado = {}
    for tab, ls, esp, _ in DADOS:
        for v in ls:
            ins(tab, list(v))
        esperado[tab] = esp
    return esperado
