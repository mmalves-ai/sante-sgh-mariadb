"""Fatia L5-05 (cadastros e administração, módulo CAD): tabelas da origem e anomalias, com dados 100% falsos.

Cobertura total (rodada 3, 2026-11-21): 19 das 21 tabelas carregam; TBPESSOA (índice de identidade) e TBEMPHOSLOGO
(mecanismo do produto) são descarte com motivo de produto (declarado/sem_carga.tsv). TBMUIBGE: a parte oficial nunca é
gravada; a configuração fiscal do cliente por município (ISS) vai à trilha do município. TBUNIDAD liga diretor e
autorizador ao profissional pelo CPF (CNS de reserva; TBPROFIS de fora só com ID, CPF e CNS). TBEMPHOS grava também o
responsável (pessoa física adotada pelo CPF), o tipo de declarante da DMED e o retrato completo na trilha.
TBMEDSOL (solicitante externo) carrega com o conselho pelo de-para oficial `conselho_classe` (sigla guardada no pai
TBCONSPROF, que entra só como origem: catálogo oficial, nunca gravado), a UF pelo `ibge_uf` e a ocupação pela CBO.
TBEMPHOS carrega a mantenedora (principal) e, ANTES dela, a pessoa jurídica (opção `antes`, CNPJ adotado se já
existir), ligadas por `@id:pessoa_juridica`. O DDL de TBEMPHOS traz também as colunas que a L5-12 lê pela referência encadeada (ela usa esta imagem
quando a L5-05 é a dona da tabela).

Anomalias: descrição vazia em destino NOT NULL (1048), código com colisão de caixa (codigo_colisao_caixa), S/N fora do
domínio, texto com espaços repetidos, quebra de linha e acentos CP1252; adoção do que o L3 já criou (sexo pela sigla,
tipo de telefone e de documento pelo código derivado do nome: adotado_existente); código derivado maior que o destino
(codigo_derivado); literal presumido (valor_presumido); de-para de valores pelo nome sem par (valor_fora_do_dominio);
percentual fora da faixa; nome de unidade repetido no estabelecimento (1062); referência encadeada inscrição ->
profissional (resolvida e inexistente); lotação da mesma pessoa e ocupação em duas unidades (adoção); vigência sem fonte; solicitante externo com sigla de conselho fora
do catálogo (catalogo_codigo_inexistente + 1048), sem UF (1048), CBO de id inexistente (pai_inexistente, anulável),
mesmo conselho, UF e número repetido (1062), S/N fora do domínio e nome com espaços repetidos.

PREPARO_DESTINO cria o estabelecimento único do cliente de exemplo, o destino real depois do L3 (DESTINO_L3: sexo
M/F/I, tipo de telefone residencial/celular, tipo de documento rg) e os códigos do catálogo oficial de ocupações usados
(INSERT IGNORE: a L5-06 usa os mesmos). TBCBOPRO e TBCBOSUS (pais de outras fatias) entram aqui só com as colunas que
a referência encadeada atravessa, para a conferência isolada PROVAR a lotação gravada (3 de 4); TBPROFIS e TBCBOPRO
são PAIS_EXTERNOS. O DDL repetido em outras fatias (L5-03, L5-04, L5-06, L7-04) é consolidação do integrador (pedido 5
do L5-05.json: tabelas atravessadas por referência encadeada na imagem comum).
"""

DDL = """
CREATE TABLE TBEMPHOSLOGO (ID_TBEMPHOS SMALLINT NOT NULL PRIMARY KEY, LOGO_EMPRESA BLOB SUB_TYPE 0, LOGO_PREFEITURA BLOB SUB_TYPE 0);
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
CREATE TABLE TBPROFIS (ID INTEGER NOT NULL PRIMARY KEY, CPF BIGINT, CNS BIGINT);
CREATE TABLE TBMUIBGE (NOME VARCHAR(60) NOT NULL, UF VARCHAR(2) NOT NULL, OLD_CEP VARCHAR(8), COD INTEGER NOT NULL PRIMARY KEY,
  DIGITO SMALLINT, SITUACAO VARCHAR(1), VALOR_MIN_RETENCAO_ISS NUMERIC(9,2), TIPO_VALOR_MIN_RET_ISS VARCHAR(1),
  MUNICIPIO_TOM INTEGER, CALCULO_ACUMULATIVO_ISS VARCHAR(1), COD_DRG INTEGER);
CREATE TABLE TBCONSPROF (ID SMALLINT NOT NULL PRIMARY KEY, COD_CONSELHO_PROF VARCHAR(7) NOT NULL,
  NOME VARCHAR(70) NOT NULL, ID_TBTISSCONSPROF SMALLINT NOT NULL);
CREATE TABLE TBMEDSOL (ID INTEGER NOT NULL PRIMARY KEY, COD_CONSELHO_PROFISSIONAL INTEGER NOT NULL, NOME VARCHAR(70) NOT NULL,
  COD_CONVENIO VARCHAR(14), ID_TBUF VARCHAR(2), ID_TBCONSPROF SMALLINT, ID_TBCBOSUS INTEGER, ATIVO CHAR(1));
CREATE TABLE TBUNIDAD (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40), PERC_REP DOUBLE PRECISION, CNES INTEGER,
  CGC DOUBLE PRECISION, LOCAL VARCHAR(40), NUMERO SMALLINT, BAIRRO VARCHAR(30), CIDADE VARCHAR(30), UF VARCHAR(2),
  CEP INTEGER, NOME_DIR VARCHAR(70), CPF_DIR BIGINT, CNS_DIR BIGINT, PERC_REP_C NUMERIC(9,2), SITUACAO VARCHAR(1),
  TETO_AIH NUMERIC(18,2), NIVEL_HIERARQ SMALLINT, FONE VARCHAR(15), NOME_AUT VARCHAR(70), CPF_AUT BIGINT, CNS_AUT BIGINT,
  TETO_AMB DOUBLE PRECISION, INTEGRAR_TOLIFE CHAR(1), ID_TBCBOPRO_FARM_RESP_MANIPUL INTEGER, COD_REF_AGHU INTEGER,
  ORGAO_EMISSOR VARCHAR(10), ID_TBTIPOATEUNIDADE SMALLINT, NOME_COMP VARCHAR(70), LOGOMARCA BLOB SUB_TYPE 0);
CREATE TABLE TBEMPHOS (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(80), ENDERECO VARCHAR(40), NUM INTEGER,
  COMP VARCHAR(10), BAIRRO VARCHAR(30), CNPJ BIGINT, INS_ESTA VARCHAR(20), INS_MUN VARCHAR(20), CNES INTEGER,
  CNAE_PRED VARCHAR(7), E_MAIL VARCHAR(50), TEL VARCHAR(12), END_SITE VARCHAR(50), CEP VARCHAR(8), COD_IBGE INTEGER,
  ID_FPCLASSIFTRIB VARCHAR(2), ID_TBTPCONSTRUT SMALLINT, ID_TBTPCOOPERAT SMALLINT, OLD_CRC VARCHAR(20),
  REG_CIVIL VARCHAR(11), DATA_REG DATE, NIRE VARCHAR(15), DTNIRE DATE, OPTANTE_SIMPLES VARCHAR(1),
  INCENTIV_CULTURAL VARCHAR(1), NUM_REGISTRO_ANS INTEGER, ATIVO_EMPRESA CHAR(1), RESPONS VARCHAR(70), CPF BIGINT,
  TIPO_DECLARANTE_DMED SMALLINT, CPF_RESP_DMED BIGINT, SPED_INST_RESP VARCHAR(2), TP_RETENCAO_ISSQN SMALLINT,
  DADO_ADICIONAL_EMISSAO_NFSE VARCHAR(254));
CREATE TABLE TBCBOPRO_TBUNIDAD (CBOPRO INTEGER NOT NULL, UNIDAD SMALLINT NOT NULL, CH_AMB INTEGER NOT NULL,
  CH_HOSP INTEGER NOT NULL, CH_OUTROS INTEGER NOT NULL, ATIVO VARCHAR(1), PRIMARY KEY (CBOPRO, UNIDAD));
"""

PAIS_EXTERNOS = {"TBPROFIS": ["100", "101"], "TBCBOPRO": ["10", "11", "12"]}
# tabelas desta fatia (colunas.d/L5-05.tsv): a conferência usa o mapa real só com as declarações delas, porque a imagem
# traz pais de outras fatias (TBCBOPRO, TBCBOSUS, TBPROFIS) só com as colunas que as referências atravessam; com as
# declarações das donas, a conferência tentaria carregá-los (mesmo mecanismo da L6-04)
FATIA = ("TBGENERO_SOCIAL", "TBGRAU_INST", "TBGRUCONVEN", "TBPARENTE", "TBPESQUIPLANO", "TBRELIG", "TBTIPOATEUNIDADE",
         "TBVULNERABILIDADE_SOCIAL", "TBGERSEQ", "TBORGAOEMIS", "TBSEXO", "TBTIPOTELEFONE", "TBTPDOCUMENTO",
         "TBUNID_IDADE", "TBUNIDAD", "TBCBOPRO_TBUNIDAD", "TBMEDSOL", "TBEMPHOS", "TBMUIBGE", "TBEMPHOSLOGO")


def __getattr__(nome):
    """`MAPA_TESTE` (lido pela conferência): o mapa real só com as declarações desta fatia."""
    if nome != "MAPA_TESTE":
        raise AttributeError(nome)
    from .. import mapa
    m = mapa.carregar_execucao()
    m["colunas_decl"] = [c for c in m["colunas_decl"] if c["tabela"] in FATIA]
    return m
AUXILIARES = ["TBCONSPROF"]   # só origem do conselho (catálogo oficial pelo de-para): não carrega

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


def cpf_falso(base9):
    """CPF de 11 dígitos com dígitos verificadores válidos a partir de 9 dígitos inventados."""
    d = [int(x) for x in "%09d" % base9]
    for n in (10, 11):
        r = sum(x * (n - i) for i, x in enumerate(d)) * 10 % 11
        d.append(0 if r == 10 else r)
    return "".join(map(str, d))


CNPJ_NOVO, CNPJ_EXISTENTE = cnpj_falso(112223330001), cnpj_falso(114447770001)
# responsável da mantenedora (novo e já cadastrado) e CPF/CNS dos profissionais de fora (diretor e autorizador)
CPF_RESP_NOVO, CPF_RESP_EXISTENTE = cpf_falso(111444777), cpf_falso(222555888)
CPF_PROF_100, CPF_PROF_101, CPF_SEM_PROF = cpf_falso(333666999), cpf_falso(444777000), cpf_falso(555888111)
CNS_PROF_101 = 700000000000001
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui; a
# pessoa jurídica já cadastrada (CNPJ_EXISTENTE) prova a adoção pelo CNPJ
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
                   + DESTINO_L3 +
                   "INSERT INTO pessoa_juridica (cnpj, razao_social, origem, criado_em) VALUES ('%s',"
                   " 'Pessoa juridica ja cadastrada', 'sistema', UTC_TIMESTAMP(3));" % CNPJ_EXISTENTE
                   + " INSERT IGNORE INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES"
                   " ('225125', 'Ocupação exemplo um', UTC_TIMESTAMP(3)),"
                   " ('225124', 'Ocupação exemplo dois', UTC_TIMESTAMP(3));"
                   # catálogos oficiais do solicitante externo (UF e conselho pela sigla; INSERT IGNORE: a L8-16 usa os
                   # mesmos códigos)
                   " INSERT IGNORE INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em)"
                   " VALUES ('35', 'SP', 'Unidade exemplo SP', 1, UTC_TIMESTAMP(3)),"
                   " ('33', 'RJ', 'Unidade exemplo RJ', 1, UTC_TIMESTAMP(3));"
                   " INSERT IGNORE INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES"
                   " ('06', 'CRM', 'Conselho exemplo um', UTC_TIMESTAMP(3)),"
                   " ('07', 'COREN', 'Conselho exemplo dois', UTC_TIMESTAMP(3));"
                   # município do catálogo oficial (de-para pelos 6 dígitos) e a pessoa física já cadastrada (adoção
                   # do responsável da mantenedora pelo CPF)
                   " INSERT IGNORE INTO municipio_ibge (codigo_ibge, nome, unidade_federativa_id, criado_em) VALUES"
                   " ('3550308', 'Municipio exemplo', 1, UTC_TIMESTAMP(3));"
                   " INSERT INTO pessoa_fisica (nome, cpf, origem, criado_em) VALUES ('Pessoa ja cadastrada', '%s',"
                   " 'sistema', UTC_TIMESTAMP(3));" % CPF_RESP_EXISTENTE)

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
     {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 2, "restricao_destino_1048": 1}}),    # solicitante externo: ID, COD_CONSELHO_PROFISSIONAL, NOME, COD_CONVENIO, ID_TBUF, ID_TBCONSPROF, ID_TBCBOSUS, ATIVO
    # 1 completo; 2 sem CBO e inativo, espaços repetidos; 3 conselho fora do catálogo (catalogo_codigo_inexistente +
    # 1048); 4 sem UF (1048); 5 repete conselho, UF e número do 1 (ADOTA a linha do 1: adotado_existente e nome
    # divergente guardado em historico_mescla_migracao, ADR 0007, 20; antes recusava com 1062); 6 CBO inexistente (pai_inexistente,
    # anulável) e S/N fora do domínio (padrão ativo); 7 mesmo número do 1 em outra UF (gravado); 8 sem conselho na
    # origem (ID_TBCONSPROF nulo): CRM presumido pela evidência (ADR 0007, 18; causa de 3.680 recusas 1048 na carga real)
    ("TBMEDSOL", [[1, 1001, "Solicitante exemplo um", "C1", "SP", 1, 501, "S"],
                  [2, 1002, "Solicitante  exemplo   dois", None, "RJ", 2, None, "N"],
                  [3, 1003, "Solicitante exemplo três", None, "SP", 3, 501, "S"],
                  [4, 1004, "Solicitante exemplo quatro", None, None, 1, 502, "S"],
                  [5, 1001, "Solicitante exemplo cinco", None, "SP", 1, 502, "S"],
                  [6, 1006, "Solicitante exemplo seis", None, "SP", 1, 999, "X"],
                  [7, 1001, "Solicitante exemplo sete", None, "RJ", 1, 502, None],
                  [8, 1008, "Solicitante exemplo oito", None, "SP", None, None, "S"]],
     {"gravados": 6, "pendencias": {"catalogo_codigo_inexistente": 1, "pai_inexistente": 1, "valor_fora_do_dominio": 1,
                                    "valor_presumido": 1,
                                    "restricao_destino_1048": 2, "adotado_existente": 1,
                                    "mescla_conflito_origem_guardada": 1}}),
]

# pais de outras fatias: só as colunas da referência encadeada (inscrição -> CBO, profissional; CBO -> código oficial)
PAIS_ORIGEM = [("TBCBOPRO", [[10, 501, 100], [11, 502, 101], [12, 501, 999]]),
               # profissionais de fora (PAIS_EXTERNOS): só CPF e CNS, lidos pela chave alternativa do diretor e do
               # autorizador da unidade
               ("TBPROFIS", [[100, int(CPF_PROF_100), None], [101, None, CNS_PROF_101]]),
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
                 NOME_COMP="Unidade Centro de Exemplo", NOME_DIR="Diretor Exemplo", CPF_DIR=int(CPF_PROF_100),
                 NOME_AUT="Autorizador Exemplo", CPF_AUT=int(CPF_SEM_PROF), CNS_AUT=CNS_PROF_101),
        # percentual fora da faixa, inativa, farmacêutico de inscrição inexistente (pai_inexistente, anulável)
        # diretor só com o CNS de um profissional (reserva: resolve sem pendência)
        _unidade(2, "Unidade Norte", PERC_REP=150.0, SITUACAO="I", ID_TBCBOPRO_FARM_RESP_MANIPUL=77,
                 CNS_DIR=CNS_PROF_101),
        # sem nome (1048) e nome repetido no estabelecimento (1062)
        _unidade(3, None),
        _unidade(4, "Unidade Centro"),
    ]


# lotação: (10,1) e (10,2) são a mesma inscrição em duas unidades; (12,1) tem profissional inexistente
LOTACOES = [[10, 1, 20, 10, 0, "S"], [10, 2, 10, 0, 0, "S"], [11, 1, 30, 0, 4, "N"], [12, 1, 10, 0, 0, "S"]]


# conselhos da origem (só a sigla é lida, pela referência encadeada); XYZ fora do catálogo oficial
CONSELHOS = [[1, "CRM", "Conselho exemplo um", 6], [2, "COREN", "Conselho exemplo dois", 7],
             [3, "XYZ", "Conselho exemplo fora", 9]]


def linhas(r, ins):
    esperado = {}
    for v in CONSELHOS:
        ins("TBCONSPROF", list(v))
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        esperado[tab] = esp
    for tab, ls in PAIS_ORIGEM:
        for v in ls:
            ins(tab, list(v))
    for v in unidades():
        ins("TBUNIDAD", v)
    # unidade 1: diretor pelo CPF do profissional 100; autorizador com CPF sem profissional (pai_inexistente) e o
    # CNS do 101 de reserva; unidade 2: diretor só pelo CNS
    # r5 (ADR 0007, 20): adotar agora MESCLA; o conflito com a linha já cadastrada guarda o valor da origem no
    # histórico da mescla (pendência baixa, sem valor)
    for _t, _n in [("TBSEXO", 2), ("TBTIPOTELEFONE", 2), ("TBTPDOCUMENTO", 1)]:
        esperado[_t]["pendencias"]["mescla_conflito_origem_guardada"] = _n
    esperado["TBUNIDAD"] = {"gravados": 2, "pendencias": {
        "valor_presumido": 4, "valor_fora_do_dominio": 1, "pai_inexistente": 2,
        "restricao_destino_1048": 1, "restricao_destino_1062": 1}}
    # empresa: nova (gravada), CNPJ inválido (NULL com documento_invalido; gravada: o CHECK do destino deixa passar o
    # CNPJ nulo de empresa nacional, medido; pedido à F2.2 no L5-05.json), CNPJ já cadastrado (adotada)
    import datetime as dt
    vazio = [None] * 9
    ins("TBEMPHOS", [1, "Mantenedora  Exemplo", "Rua Exemplo", 10, "Sala 1", "Centro", int(CNPJ_NOVO), "ISENTO", None,
                     1234567, "8610101", "contato@exemplo.invalid", "1130000000", None, "01310100", None, None, None, None,
                     "SP-000000/O-0", "12345", dt.date(2001, 2, 3), "35300000000", dt.date(2001, 1, 2), "S", "N",
                     123456, "S", "Responsavel  Exemplo", int(CPF_RESP_NOVO), 1, int(CPF_RESP_NOVO), "01", 2,
                     "Texto adicional da nota exemplo"])
    ins("TBEMPHOS", [2, "Outra Mantenedora", None, None, None, None, 11111111111111, None, None, None, None, None, None,
                     None, None, None, None, None, None] + [None] * 5 + ["X", None, None, "N"]
        + ["Responsavel Ja Cadastrado", int(CPF_RESP_EXISTENTE), None, None, None, None, None])
    ins("TBEMPHOS", [3, "Mantenedora ja conhecida", None, None, None, None, int(CNPJ_EXISTENTE), None, None, None, None,
                     None, None, None, None, None, None, None, None] + vazio + [None, None, 7, None, None, None, None])
    # mantenedora gravada nas 3 (a pessoa jurídica gravada ANTES: nova, CNPJ inválido nulo, adotada pelo CNPJ);
    # optante do Simples fora do domínio fica com o padrão do destino (FALSE)
    # responsável: novo na 1 (com o retrato fiscal), ADOTADO pelo CPF na 2, nenhum na 3 (opcional); DMED 1 ->
    # prestador_saude, 7 fora do domínio (NULL); toda mantenedora gravada tem a trilha com o retrato completo
    # r6 (DDL 03_CAD/08, ck_pessoa_juridica_cnpj): empresa nacional sem CNPJ válido é RECUSADA pelo CHECK (4025), e
    # com ela o responsável adotado da linha 2; a 3 adota a pessoa jurídica pelo CNPJ e o nome diferente da origem
    # fica no histórico da mescla (ADR 0007, 20)
    esperado["TBEMPHOS"] = {"gravados": 2, "pendencias": {"documento_invalido": 1, "adotado_existente": 1,
                                                          "valor_fora_do_dominio": 2, "restricao_destino_4025": 1,
                                                          "mescla_conflito_origem_guardada": 1}}
    # municípios: parte fiscal do cliente na trilha do município; código fora do catálogo oficial fica sem
    # entidade_id (catalogo_codigo_inexistente) e a linha da trilha é gravada; sem configuração também grava
    from decimal import Decimal as D
    for v in [["Municipio exemplo", "SP", None, 355030, 8, "A", D("50.00"), "V", 7107, "S", 123],
              ["Municipio fora", "RJ", None, 999999, 1, "A", D("10.00"), "B", None, "N", None],
              ["Municipio sem parametro", "SP", None, 355031, 1, "A", None, None, None, None, None]]:
        ins("TBMUIBGE", v)
    esperado["TBMUIBGE"] = {"gravados": 3, "pendencias": {"catalogo_codigo_inexistente": 2}}
    for v in LOTACOES:
        ins("TBCBOPRO_TBUNIDAD", list(v))
    # (10,1) e (11,1) gravadas; (10,2) mesma pessoa, estabelecimento e ocupação: adota a (10,1); (12,1) profissional
    # nunca carregado: pai_inexistente e recusa pelo NOT NULL (1048)
    esperado["TBCBOPRO_TBUNIDAD"] = {"gravados": 3, "pendencias": {"mescla_conflito_origem_guardada": 1, 
        "adotado_existente": 1, "pai_inexistente": 1, "vigencia_sem_fonte": 4, "restricao_destino_1048": 1}}
    # r5 (ADR 0006): logotipo ao armazenamento de arquivos (#arquivo); sem nenhum logotipo: recusa (NOT NULL)
    _png = lambda n: b"\x89PNG\r\n\x1a\n" + bytes([n]) * 32
    for row in [[1, _png(1), _png(2)], [2, None, _png(3)], [3, None, None]]:
        ins("TBEMPHOSLOGO", row)
    esperado["TBEMPHOSLOGO"] = {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}}
    return esperado
