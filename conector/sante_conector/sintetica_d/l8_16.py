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
CREATE TABLE SIMATHP (ID INTEGER NOT NULL PRIMARY KEY, TIPO SMALLINT NOT NULL, CODIGO VARCHAR(8) NOT NULL,
  NOME VARCHAR(30));
CREATE TABLE SITBELHP (COD VARCHAR(18) NOT NULL, COD_EXAME INTEGER NOT NULL, ELEMENTO_NOME VARCHAR(80),
  ID_SIMATHP INTEGER, PRIMARY KEY (COD, COD_EXAME));
CREATE TABLE TBDIGITAL_ESPECIALIDADE (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(100) NOT NULL,
  ID_DIGITAL VARCHAR(36) NOT NULL);
CREATE TABLE TBESPEC (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40), CRED VARCHAR(1), REFEXP SMALLINT,
  SIGLA VARCHAR(6), IDADE_INICIAL SMALLINT, IDADE_FINAL SMALLINT, SEXO VARCHAR(1), ID_TBDIGITAL_ESPECIALIDADE INTEGER);
CREATE TABLE FPESOCTPAMB ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(40), "ENDERECO_WS_PRODUCAO_ESOCIAL" VARCHAR(200),
  "SOAPACTION" VARCHAR(130), "ENDERECO_WS_CONSULTA_ESOCIAL" VARCHAR(200), "ENDERECO_WS_PRODUCAO_EFDREINF" VARCHAR(200),
  "SOAPACTION_EFDREINF" VARCHAR(130), "ENDERECO_WS_CONSULTA_EFDREINF" VARCHAR(200), PRIMARY KEY ("ID"));
CREATE TABLE PRCABEARQINTEGRAQT ("ID" INTEGER NOT NULL, "ID_PRCABAUTORIZ" INTEGER, "CAMPOS_DEFAULT" VARCHAR(255),
  "CAMPOS_SELECIONADOS" VARCHAR(255), PRIMARY KEY ("ID"));
CREATE TABLE SIMODULO_SIWEBATOS ("ID" INTEGER NOT NULL, "ID_SIMODULO" SMALLINT NOT NULL, "ATIVO" VARCHAR(1),
  PRIMARY KEY ("ID"));
CREATE TABLE TBCID10 ("ID" INTEGER NOT NULL, "ID_TBVERSAOCID" SMALLINT NOT NULL, "COD" VARCHAR(6) NOT NULL,
  "NOME" VARCHAR(270) NOT NULL, "CLASSIF" VARCHAR(1) NOT NULL, "CAT" VARCHAR(1) NOT NULL, "SUBCAT" VARCHAR(1) NOT NULL,
  "SEXO" VARCHAR(1) NOT NULL, "COBRAR" VARCHAR(1) NOT NULL, "ONCO" VARCHAR(1) NOT NULL, "CRAD" SMALLINT,
  "ESTADIO" VARCHAR(1), "VIG_SANITARIA" VARCHAR(1), "TP_AGRAVO" SMALLINT, "ID_TBTPNOTAGRAVO" SMALLINT NOT NULL,
  "ID_TBTPAUTORIDADE_SMS" SMALLINT, "ID_TBTPAUTORIDADE_SES" SMALLINT, "ID_TBTPAUTORIDADE_MS" SMALLINT,
  "ID_DIGITAL" VARCHAR(36), PRIMARY KEY ("ID"));
CREATE TABLE TBDIGITAL_INTEG_TYPE ("ID" INTEGER NOT NULL, "INTEGRATION_TYPE" VARCHAR(50) NOT NULL,
  "TABLE_NAME" VARCHAR(50) NOT NULL, "FIELDNAME_ID" VARCHAR(50) NOT NULL, "TABLE_NAME_SECONDARY" VARCHAR(50),
  PRIMARY KEY ("ID"));
CREATE TABLE TBDIGITAL_INTEG_FIELD ("ID" INTEGER NOT NULL, "ID_TBDIGITAL_INTEG_TYPE" INTEGER NOT NULL,
  "FIELD_NAME" VARCHAR(50) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBFORMA_ASSINATURA_ICP ("ID" SMALLINT NOT NULL, "DESCRICAO" VARCHAR(40) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBIDENTIFICACAOENDPOINT ("ID" SMALLINT NOT NULL, "COD" SMALLINT NOT NULL, "DESCRICAO" VARCHAR(50) NOT NULL,
  "PORTA_DOCKER_INTERNO" SMALLINT, PRIMARY KEY ("ID"));
CREATE TABLE TBENDPOINT ("ID" SMALLINT NOT NULL, "IDENTIFICACAOENDPOINT" SMALLINT NOT NULL, "URL" VARCHAR(400) NOT NULL,
  "STATUS" CHAR(1), PRIMARY KEY ("ID"));
CREATE TABLE TBENDPOINTURI ("ID" SMALLINT NOT NULL, "ID_TBIDENTIFICACAOENDPOINT" SMALLINT NOT NULL,
  "URI" VARCHAR(255) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBINFBANCO ("BANCO" SMALLINT NOT NULL, "CAMINHO" VARCHAR(120) NOT NULL, "SENHA" VARCHAR(20) NOT NULL,
  PRIMARY KEY ("BANCO"));
CREATE TABLE TBOPERSCHEMA ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(40) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBREGUL_ENDPOINT ("ID" INTEGER NOT NULL, "ID_TBREGUL_SERVICO" INTEGER, "DESCRICAO" VARCHAR(50),
  "ENDPOINT" VARCHAR(254), "METODO" VARCHAR(10), PRIMARY KEY ("ID"));
"""

AUXILIARES = ["TBCONSPROF", "TBESPEC"]   # só origem (catálogo oficial pelo de-para; especialidade lida pela
# chave alternativa do mapeamento do parceiro): não carregam aqui
PAIS_EXTERNOS = {"GECADPED": ["1", "2", "3"], "GEPORTALCOMPRAS": ["1", "2"], "SITABPRO": ["1|GL", "1|HB"],
                 "SITPEQV": ["1", "1/laboratorio_apoio"], "SITBEXHP": ["10", "11"]}
PREPARO_DESTINO = (
    "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
    " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
    # r5c: termo oficial da CID-10 de exemplo (catálogo oficial: só o código usado), para a ligação pelo código
    " INSERT INTO terminologia (id, codigo, nome, tipo, origem, criado_em) SELECT 9160, 'cid10', 'CID-10',"
    " 'diagnostico', 'sistema', UTC_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS"
    " (SELECT 1 FROM terminologia WHERE codigo = 'cid10');"
    " INSERT INTO termo_terminologia (id, terminologia_id, codigo_termo, descricao, criado_em)"
    " SELECT 9161, (SELECT id FROM terminologia WHERE codigo = 'cid10'), 'A00', 'Termo de exemplo',"
    " UTC_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM termo_terminologia WHERE id = 9161);"
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


# especialidades do hospital (só a ligação ao código do parceiro): 100 e 101 apontam o código 1, 102 o 2, 103 nenhum
ESPECIALIDADES = [[c, "Especialidade exemplo %d" % c, None, None, None, None, None, None, d]
                  for c, d in ((100, 1), (101, 1), (102, 2), (103, None))]

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
    # material do apoio: 1 e 2 entram (2 com espaços repetidos e acento); 3: interface 2 inexistente (pai_inexistente
    # + 1048); 4 repete o código de 1 no mesmo apoio (1062); 5: código só de espaços (1048)
    ("SIMATHP", [[1, 1, "SG", "Sangue exemplo"], [2, 1, "SR", "Soro  exemplo   ação"], [3, 2, "UR", "Urina exemplo"],
                 [4, 1, "SG", "Repetido exemplo"], [5, 1, "  ", None]],
     {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 2,
                                    "restricao_destino_1062": 1}}, 3),
    # elemento do exame do apoio: HGB e HCT entram (HCT sem material); GLU entra sem o material 99 (pai_inexistente,
    # coluna anulável); XX: exame 77 inexistente (pai_inexistente + 1048)
    ("SITBELHP", [["HGB", 10, "Hemoglobina exemplo", 1], ["HCT", 10, "Hematócrito  exemplo", None],
                  ["GLU", 11, "Glicose exemplo", 99], ["XX", 77, None, None]],
     {"gravados": 3, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 1}}, 1),
    # especialidades do parceiro: 1 vira duas equivalências (especialidades 100 e 101), 2 uma (102); 3 sem
    # especialidade ligada (pai_inexistente). A referência vai do pai para o filho (TBESPEC.ID_TBDIGITAL_ESPECIALIDADE):
    # a dependência de ordem TBDIGITAL_ESPECIALIDADE -> TBESPEC (declarado/dependencias.tsv, ciclo em duas fases em
    # declarado/ciclos.tsv) põe a especialidade antes. Parceiro e domínio criados na 1ª equivalência e adotados nas 2
    # seguintes (adotado_existente 2); parceiro presumido (valor_presumido) em cada linha gravada
    ("TBDIGITAL_ESPECIALIDADE", [[1, "Cardiologia exemplo", "00000000-falso-0001"],
                                 [2, "Pediatria  exemplo", "00000000-falso-0002"],
                                 [3, "Sem uso exemplo", "00000000-falso-0003"]],
     {"gravados": 3, "pendencias": {"pai_inexistente": 1, "adotado_existente": 2, "valor_presumido": 2}}, 1),
]

A = "adotado_existente"  # lista/padrão/sistema já criado por linha anterior: adotado (baixa)
# rodada 5 (ADR 0006): configuração de integração e listas do hospital passam a carregar (antes: descarte)
DADOS += [
    # serviço 3 só de espaços: o sistema externo recusa (1048)
    ("TBIDENTIFICACAOENDPOINT", [[1, 10, "Serviço exemplo um", 8080], [2, 11, "Serviço  exemplo ação", None],
                                 [3, 12, "   ", None]], {"gravados": 2, "pendencias": {"restricao_destino_1048": 1, A: 1}}, 1),
    # endereço 2 aponta serviço inexistente (pai_inexistente; sistema externo NOT NULL)
    ("TBENDPOINT", [[1, 10, "https://um.exemplo.invalid/api", "A"], [2, 99, "https://orfa.exemplo.invalid/x", None]],
     {"gravados": 1, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 1, A: 1}}, 1),
    # rotas 1 e 2 no serviço 1, 3 no 2; 4 em serviço inexistente
    ("TBENDPOINTURI", [[1, 1, "/rota/um"], [2, 1, "/rota/dois"], [3, 2, "/rota/tres"], [4, 77, "/rota/orfa"]],
     {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}}, 1),
    # 2: sem serviço nem descrição, verbo fora do domínio (operação sem verbo)
    ("TBREGUL_ENDPOINT", [[1, 5, "Serviço regulação exemplo", "https://reg.exemplo.invalid/ws", "POST"],
                          [2, None, None, "https://reg.exemplo.invalid/b", "get"]], {"gravados": 2, "pendencias": {A: 3}}, 0),
    ("FPESOCTPAMB", [[1, "Produção exemplo", "https://gov.exemplo.invalid/env", "acao/enviar",
                      "https://gov.exemplo.invalid/cons", "https://gov2.exemplo.invalid/env", "acao/dois", None],
                     [2, "Restrita  exemplo", "https://gov.exemplo.invalid/r", None, None, None, None, None]],
     {"gravados": 2, "pendencias": {A: 2}}, 0),
    ("TBINFBANCO", [[1, "/dados/exemplo/banco.ex", "senha-falsa"], [2, "/dados/exemplo/outro.ex", "outra-falsa"]],
     {"gravados": 2, "pendencias": {"segredo_aguarda_cofre": 2}}, 0),
    # r5c (ADR 0006, 4): CID-10 do hospital na trilha com o retrato; A00 liga ao termo oficial, Z999 é código local
    # (catalogo_codigo_inexistente, visível; a linha entra)
    ("TBCID10", [[1, 1, "A00", "Termo exemplo", "A", "B", "C", "I", "S", "N", None, None, None, None, 1, None, None, None, None],
                 [2, 1, "Z999", "Termo local exemplo", "A", "B", "C", "I", "N", "N", None, None, None, None, 1, None, None, None,
                  "id-falso-ex"]], {"gravados": 2, "pendencias": {"catalogo_codigo_inexistente": 1}}, 0),
    ("TBDIGITAL_INTEG_TYPE", [[1, "TIPO_EXEMPLO_A", "ENTIDADE_EX", "ID", None],
                              # r5c (regra 1): a 2.ª linha tem tabelas sem par no de-para: entidade NULL com
                              # valor_fora_do_dominio e a presumida '~prescricao' (valor_presumido); a secundária fica nula
                              [2, "TIPO_EXEMPLO_B", "ENTIDADE_EX2", "ID", "ENTIDADE_EX3"]],
     {"gravados": 2, "pendencias": {"valor_fora_do_dominio": 2, "valor_presumido": 1}}, 0),
    ("TBDIGITAL_INTEG_FIELD", [[1, 1, "CAMPO_EX_A"], [2, 1, "CAMPO_EX_B"], [3, 2, "CAMPO_EX_A"]],
     {"gravados": 3, "pendencias": {A: 5}}, 0),
    ("PRCABEARQINTEGRAQT", [[1, None, "CAMPO_EX_A;CAMPO_EX_B", "CAMPO_EX_A"]], {"gravados": 1, "pendencias": {"vigencia_sem_fonte": 1}}, 0),
    ("SIMODULO_SIWEBATOS", [[1, 3, "S"], [2, 4, "N"]], {"gravados": 2, "pendencias": {A: 2}}, 0),
    ("TBFORMA_ASSINATURA_ICP", [[1, "Formato exemplo A"], [2, "Formato  exemplo B"]], {"gravados": 2, "pendencias": {A: 3}}, 0),
    ("TBOPERSCHEMA", [[1, "OperacaoExemplo"], [2, "Outra  operação"]], {"gravados": 2, "pendencias": {A: 3}}, 0),
]
# linhas lidas por tabela quando "gravados" conta itens (uma equivalência por especialidade ligada: `por_pai`)
LIDAS_POR_ITEM = {"TBDIGITAL_ESPECIALIDADE": 2}  # linhas 1 e 2 geram 3 itens; a linha 3 é recusada



def linhas(r, ins):
    for v in CONSELHOS:
        ins("TBCONSPROF", list(v))
    esperado = {}
    for tab, ls, esp, _ in DADOS:
        for v in ls:
            ins(tab, list(v))
        esperado[tab] = esp
    for v in ESPECIALIDADES:
        ins("TBESPEC", list(v))
    # a especialidade (L5-06) carrega pelas declarações dela antes do mapeamento: só a conciliação é conferida aqui
    esperado["TBESPEC"] = {"gravados": 4, "pendencias": {}}
    return esperado
