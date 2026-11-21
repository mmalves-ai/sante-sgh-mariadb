"""Fatia L5-05 (cadastros e administração, módulo CAD): tabelas da origem e anomalias, com dados 100% falsos.

Cobertura total (rodada de 2026-11-21): 17 das 20 tabelas carregam; TBMUIBGE (catálogo oficial) e TBPESSOA (índice de
identidade) são descarte com motivo de produto (declarado/sem_carga.tsv); TBMEDSOL está declarada e comentada até o
motor ter o de-para oficial do conselho (pedido 1 em docs/obra/fatias/f4/saida/L5-05.json) e fica fora desta imagem.
TBEMPHOS carrega a pessoa jurídica (CNPJ adotado se já existir); a mantenedora aguarda o principal pessoa_juridica
(pedido 2). O DDL de TBEMPHOS traz também as colunas que a L5-12 lê pela referência encadeada (ela usa esta imagem
quando a L5-05 é a dona da tabela).

Anomalias: descrição vazia em destino NOT NULL (1048), código com colisão de caixa (codigo_colisao_caixa), S/N fora do
domínio, texto com espaços repetidos, quebra de linha e acentos CP1252; adoção do que o L3 já criou (sexo pela sigla,
tipo de telefone e de documento pelo código derivado do nome: adotado_existente); código derivado maior que o destino
(codigo_derivado); literal presumido (valor_presumido); de-para de valores pelo nome sem par (valor_fora_do_dominio);
percentual fora da faixa; nome de unidade repetido no estabelecimento (1062); referência encadeada inscrição ->
profissional (resolvida e inexistente); lotação da mesma pessoa e ocupação em duas unidades (adoção); vigência sem fonte.

PREPARO_DESTINO cria o estabelecimento único do cliente de exemplo, o destino real depois do L3 (DESTINO_L3: sexo
M/F/I, tipo de telefone residencial/celular, tipo de documento rg) e os códigos do catálogo oficial de ocupações usados
(INSERT IGNORE: a L5-06 usa os mesmos). TBCBOPRO e TBCBOSUS (pais de outras fatias) entram aqui só com as colunas que
a referência encadeada atravessa, para a conferência isolada PROVAR a lotação gravada (3 de 4); TBPROFIS e TBCBOPRO
são PAIS_EXTERNOS. O DDL repetido em outras fatias (L5-03, L5-04, L5-06, L7-04) é consolidação do integrador (pedido 5
do L5-05.json: tabelas atravessadas por referência encadeada na imagem comum).
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
CREATE TABLE TBGERSEQ (TIPO SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50), SEQ INTEGER);
CREATE TABLE TBORGAOEMIS (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(80));
CREATE TABLE TBSEXO (CODIGO INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(20), SIGLA CHAR(1));
CREATE TABLE TBTIPOTELEFONE (ID SMALLINT NOT NULL PRIMARY KEY, TIPO_TELEFONE VARCHAR(45) NOT NULL);
CREATE TABLE TBTPDOCUMENTO (ID SMALLINT NOT NULL PRIMARY KEY, COD_DOCUMENTO SMALLINT NOT NULL, NOME VARCHAR(30) NOT NULL);
CREATE TABLE TBUNID_IDADE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE TBCBOPRO (ID INTEGER NOT NULL PRIMARY KEY, ID_TBCBOSUS INTEGER NOT NULL, ID_TBPROFIS INTEGER NOT NULL);
CREATE TABLE TBCBOSUS (ID INTEGER NOT NULL PRIMARY KEY, COD VARCHAR(6));
CREATE TABLE TBUNIDAD (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40), PERC_REP DOUBLE PRECISION, CNES INTEGER,
  CGC DOUBLE PRECISION, LOCAL VARCHAR(40), NUMERO SMALLINT, BAIRRO VARCHAR(30), CIDADE VARCHAR(30), UF VARCHAR(2),
  CEP INTEGER, NOME_DIR VARCHAR(70), CPF_DIR BIGINT, CNS_DIR BIGINT, PERC_REP_C NUMERIC(9,2), SITUACAO VARCHAR(1),
  TETO_AIH NUMERIC(18,2), NIVEL_HIERARQ SMALLINT, FONE VARCHAR(15), NOME_AUT VARCHAR(70), CPF_AUT BIGINT, CNS_AUT BIGINT,
  TETO_AMB DOUBLE PRECISION, INTEGRAR_TOLIFE CHAR(1), ID_TBCBOPRO_FARM_RESP_MANIPUL INTEGER, COD_REF_AGHU INTEGER,
  ORGAO_EMISSOR VARCHAR(10), ID_TBTIPOATEUNIDADE SMALLINT, NOME_COMP VARCHAR(70), LOGOMARCA BLOB SUB_TYPE 0);
CREATE TABLE TBEMPHOS (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(80), ENDERECO VARCHAR(40), NUM INTEGER,
  COMP VARCHAR(10), BAIRRO VARCHAR(30), CNPJ BIGINT, INS_ESTA VARCHAR(20), INS_MUN VARCHAR(20), CNES INTEGER,
  CNAE_PRED VARCHAR(7), E_MAIL VARCHAR(50), TEL VARCHAR(12), END_SITE VARCHAR(50), CEP VARCHAR(8), COD_IBGE INTEGER,
  ID_FPCLASSIFTRIB VARCHAR(2), ID_TBTPCONSTRUT SMALLINT, ID_TBTPCOOPERAT SMALLINT);
CREATE TABLE TBCBOPRO_TBUNIDAD (CBOPRO INTEGER NOT NULL, UNIDAD SMALLINT NOT NULL, CH_AMB INTEGER NOT NULL,
  CH_HOSP INTEGER NOT NULL, CH_OUTROS INTEGER NOT NULL, ATIVO VARCHAR(1), PRIMARY KEY (CBOPRO, UNIDAD));
"""

PAIS_EXTERNOS = {"TBPROFIS": ["100", "101"], "TBCBOPRO": ["10", "11", "12"]}

# destino real depois da carga do L3 (carga.py SEXOS e TIPOS_PROPRIOS): a adoção pela chave natural é conferida sobre ele
DESTINO_L3 = """
INSERT IGNORE INTO sexo (codigo, descricao, sigla, criado_em) VALUES ('masculino', 'Masculino', 'M', UTC_TIMESTAMP(3)),
  ('feminino', 'Feminino', 'F', UTC_TIMESTAMP(3)), ('indeterminado', 'Indeterminado', 'I', UTC_TIMESTAMP(3));
INSERT IGNORE INTO tipo_telefone (codigo, descricao, criado_em) VALUES ('residencial', 'Residencial', UTC_TIMESTAMP(3)),
  ('celular', 'Celular', UTC_TIMESTAMP(3));
INSERT IGNORE INTO tipo_documento_identificacao (codigo, descricao, criado_em)
  VALUES ('rg', 'Registro geral (identidade)', UTC_TIMESTAMP(3));
"""


def cnpj_falso(base12):
    """CNPJ de 14 dígitos com dígitos verificadores válidos a partir de 12 dígitos inventados."""
    d = [int(x) for x in "%012d" % base12]
    for pesos in ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]):
        r = sum(x * p for x, p in zip(d, pesos)) % 11
        d.append(0 if r < 2 else 11 - r)
    return "".join(map(str, d))


CNPJ_NOVO, CNPJ_EXISTENTE = cnpj_falso(112223330001), cnpj_falso(114447770001)
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui; a
# pessoa jurídica já cadastrada (CNPJ_EXISTENTE) prova a adoção pelo CNPJ
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
                   + DESTINO_L3 +
                   "INSERT INTO pessoa_juridica (cnpj, razao_social, origem, criado_em) VALUES ('%s',"
                   " 'Pessoa juridica ja cadastrada', 'sistema', UTC_TIMESTAMP(3));" % CNPJ_EXISTENTE
                   + " INSERT IGNORE INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES"
                   " ('225125', 'Ocupação exemplo um', UTC_TIMESTAMP(3)),"
                   " ('225124', 'Ocupação exemplo dois', UTC_TIMESTAMP(3));")

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
     {"gravados": 3, "pendencias": {"valor_presumido": 3}}),
    ("TBVULNERABILIDADE_SOCIAL", [[1, 1, "Situação exemplo", "S"], [2, 2, "Outra situação", "N"]],
     {"gravados": 2, "pendencias": {}}),
    # gerador de números: valor negativo vira o padrão do destino; todas entram inativas e presumidas
    ("TBGERSEQ", [[1, "Prontuário", 15000], [2, "Atendimento", None], [3, "Conta", -5]],
     {"gravados": 3, "pendencias": {"valor_presumido": 3, "valor_fora_do_dominio": 1}}),
    # sigla derivada do nome: cabe (SSP) ou resumo estável (codigo_derivado); nome vazio recusa
    ("TBORGAOEMIS", [[1, "SSP"], [2, "Secretaria de Segurança Pública"], [3, None]],
     {"gravados": 2, "pendencias": {"codigo_derivado": 1, "restricao_destino_1048": 1}}),
    # M e F adotam o que o L3 criou; X é nova; sem sigla recusa
    ("TBSEXO", [[1, "Masculino", "M"], [2, "Feminino", "F"], [3, "Intersexo", "X"], [4, None, None]],
     {"gravados": 3, "pendencias": {"adotado_existente": 2, "restricao_destino_1048": 1}}),
    # Residencial e CELULAR adotam (colação sem caixa); nome só de espaços recusa
    ("TBTIPOTELEFONE", [[1, "Residencial"], [2, "CELULAR"], [3, "Comercial"], [4, "Recado"], [5, "   "]],
     {"gravados": 4, "pendencias": {"adotado_existente": 2, "restricao_destino_1048": 1}}),
    # RG adota o rg do L3 (colação sem caixa); os outros são novos
    ("TBTPDOCUMENTO", [[1, 1, "RG"], [2, 2, "CPF"], [3, 3, "Certidão de nascimento"],
                       [4, 4, "Carteira nacional habilitação"], [5, 5, "Registro nacional estrangeiro"]],
     {"gravados": 5, "pendencias": {"adotado_existente": 1}}),
    # unidade de cálculo e sigla pelo nome; nome sem par recusa (NOT NULL)
    ("TBUNID_IDADE", [[1, "Anos"], [2, "Meses"], [3, "DIAS"], [4, "Décadas"]],
     {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 2, "restricao_destino_1048": 1}}),
]

# pais de outras fatias: só as colunas da referência encadeada (inscrição -> CBO, profissional; CBO -> código oficial)
PAIS_ORIGEM = [("TBCBOPRO", [[10, 501, 100], [11, 502, 101], [12, 501, 999]]),
               ("TBCBOSUS", [[501, "225125"], [502, "225124"]])]

_UN = dict(PERC_REP=None, CNES=None, CGC=None, LOCAL=None, NUMERO=None, BAIRRO=None, CIDADE=None, UF=None, CEP=None,
           NOME_DIR=None, CPF_DIR=None, CNS_DIR=None, PERC_REP_C=None, SITUACAO=None, TETO_AIH=None, NIVEL_HIERARQ=None,
           FONE=None, NOME_AUT=None, CPF_AUT=None, CNS_AUT=None, TETO_AMB=None, INTEGRAR_TOLIFE=None,
           ID_TBCBOPRO_FARM_RESP_MANIPUL=None, COD_REF_AGHU=None, ORGAO_EMISSOR=None, ID_TBTIPOATEUNIDADE=None,
           NOME_COMP=None, LOGOMARCA=None)
_COLS_UN = ["COD", "NOME"] + list(_UN)


def _unidade(cod, nome, **kw):
    v = dict(_UN, COD=cod, NOME=nome)
    v.update(kw)
    return [v[c] for c in _COLS_UN]


def unidades():
    from decimal import Decimal as D
    return [
        # completa: farmacêutico pela inscrição 10 -> profissional 100 (pai externo)
        _unidade(1, "Unidade  Centro", PERC_REP=10.5, CNES=1234567, CGC=11222333000181.0, LOCAL="Rua Exemplo",
                 NUMERO=100, BAIRRO="Centro", CIDADE="Cidade Exemplo", UF="SP", CEP=1310100, PERC_REP_C=D("5.25"),
                 SITUACAO="A", TETO_AIH=D("1000.00"), NIVEL_HIERARQ=2, FONE="1130000000", TETO_AMB=500.5,
                 ID_TBCBOPRO_FARM_RESP_MANIPUL=10, ORGAO_EMISSOR="M", ID_TBTIPOATEUNIDADE=1,
                 NOME_COMP="Unidade Centro de Exemplo"),
        # percentual fora da faixa, inativa, farmacêutico de inscrição inexistente (pai_inexistente, anulável)
        _unidade(2, "Unidade Norte", PERC_REP=150.0, SITUACAO="I", ID_TBCBOPRO_FARM_RESP_MANIPUL=77),
        # sem nome (1048) e nome repetido no estabelecimento (1062)
        _unidade(3, None),
        _unidade(4, "Unidade Centro"),
    ]


# lotação: (10,1) e (10,2) são a mesma inscrição em duas unidades; (12,1) tem profissional inexistente
LOTACOES = [[10, 1, 20, 10, 0, "S"], [10, 2, 10, 0, 0, "S"], [11, 1, 30, 0, 4, "N"], [12, 1, 10, 0, 0, "S"]]


def linhas(r, ins):
    esperado = {}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        esperado[tab] = esp
    for tab, ls in PAIS_ORIGEM:
        for v in ls:
            ins(tab, list(v))
    for v in unidades():
        ins("TBUNIDAD", v)
    esperado["TBUNIDAD"] = {"gravados": 2, "pendencias": {
        "valor_presumido": 4, "valor_fora_do_dominio": 1, "pai_inexistente": 1,
        "restricao_destino_1048": 1, "restricao_destino_1062": 1}}
    # empresa: nova (gravada), CNPJ inválido (NULL com documento_invalido; gravada: o CHECK do destino deixa passar o
    # CNPJ nulo de empresa nacional, medido; pedido à F2.2 no L5-05.json), CNPJ já cadastrado (adotada)
    ins("TBEMPHOS", [1, "Mantenedora  Exemplo", "Rua Exemplo", 10, "Sala 1", "Centro", int(CNPJ_NOVO), "ISENTO", None,
                     1234567, "8610101", "contato@exemplo.invalid", "1130000000", None, "01310100", None, None, None, None])
    ins("TBEMPHOS", [2, "Outra Mantenedora", None, None, None, None, 11111111111111, None, None, None, None, None, None,
                     None, None, None, None, None, None])
    ins("TBEMPHOS", [3, "Mantenedora ja conhecida", None, None, None, None, int(CNPJ_EXISTENTE), None, None, None, None,
                     None, None, None, None, None, None, None, None])
    esperado["TBEMPHOS"] = {"gravados": 3, "pendencias": {"documento_invalido": 1, "adotado_existente": 1}}
    for v in LOTACOES:
        ins("TBCBOPRO_TBUNIDAD", list(v))
    # (10,1) e (11,1) gravadas; (10,2) mesma pessoa, estabelecimento e ocupação: adota a (10,1); (12,1) profissional
    # nunca carregado: pai_inexistente e recusa pelo NOT NULL (1048)
    esperado["TBCBOPRO_TBUNIDAD"] = {"gravados": 3, "pendencias": {
        "adotado_existente": 1, "pai_inexistente": 1, "vigencia_sem_fonte": 4, "restricao_destino_1048": 1}}
    return esperado
