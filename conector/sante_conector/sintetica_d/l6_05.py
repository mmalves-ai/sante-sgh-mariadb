"""Fatia L6-05 (prontuário, assinatura e assistência, módulo PEP): tabelas da origem e anomalias, com dados 100% falsos.

As 24 tabelas carregadas pela carga dirigida pelo mapa (rodada 5, ADR 0006: respostas padrão, opções de e-mail e
leiautes da prescrição, antes descarte, carregam como opções dos parâmetros de lista do produto, parametro_opcao).
GECADANTIMI grava a ficha do antimicrobiano migrada (origem 'migracao', 06_PEP/18): atendimento pelo registro, paciente
pela encadeada RECADATE > PRONT > RICADPAC (pais de L3 na imagem só com as colunas da referência), prescritor pela
inscrição no conselho (TBCBOPRO > profissional), convênio e finalidade nativa pela inicial do tipo; anomalias: convênio e
profissional nunca carregados (NULL com pai_inexistente, a ficha migrada aceita), tipo sem par (valor_fora_do_dominio),
atendimento nunca carregado e atendimento sem paciente (pai_inexistente e recusa 1048). PRFICHAREL grava um leiaute de impressão por
COD (agrupar no principal), com os componentes numa lista JSON e o tipo de migração criado antes e adotado. PRDADOSENVIOOPERADORA grava a informação clínica com o grupo padrão gravado ANTES (criado
pela primeira linha, adotado pelas seguintes). PRLOCPACDEFAULT (L5-01) entra só como origem do pai da preferência, lida pela ref: encadeada
de PRFAVORITO_EXIBIR (preferência -> login -> usuário). Anomalias: descrição vazia em destino NOT NULL (1048), código com
colisão de caixa (codigo_colisao_caixa nas duas linhas), S/N fora do domínio (padrão do destino), pai recusado
(pai_pendente), pai nunca visto (pai_inexistente + 1048), chave única repetida (1062), fórmula migrada
inativa (valor_presumido), texto com espaços repetidos, quebra de linha e acentos CP1252; de-para de valores pelo nome
sem par (valor_fora_do_dominio + 1048, nada presumido), frequência sem número de doses (a critério médico), número de
doses acima de 48, hora relativa guardada com data (hora_com_data), sequência repetida (1062), preferência ou login
inexistente na referência encadeada (pai_inexistente + 1048), escopo do filtro fora do domínio (padrão 'atual'),
código da via na prescrição digital.
"""
import datetime

from .l6_06 import preparo_parametros

DDL = """
CREATE TABLE PRCADRESP (COD INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(255));
CREATE TABLE PREMAILOPCAO (ID SMALLINT NOT NULL PRIMARY KEY, NOME_OPCAO VARCHAR(45) NOT NULL, ID_PREMAILMODULO SMALLINT);
CREATE TABLE PRLAYIMPPRESC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE GETABVIA (COD VARCHAR(2) NOT NULL PRIMARY KEY, NOME VARCHAR(35), ATIVO CHAR(1), ID_TBTISSVIAADMIN SMALLINT,
  ID_DIGITAL VARCHAR(36));
CREATE TABLE PRAGRAVOTPARQUETIPO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE PRAGRAVOPERGUNTA (ID INTEGER NOT NULL PRIMARY KEY, ID_PRAGRAVOTPARQUETIPO INTEGER NOT NULL,
  CODIGO INTEGER NOT NULL, SUBCODIGO INTEGER NOT NULL, NOME VARCHAR(255) NOT NULL);
CREATE TABLE PRBHINTENSIDADE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE PRBHTPELIMINA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL, DIGITAR_VOLUME_ELIMINADO CHAR(1),
  DIGITAR_VOLUME_ESTIMADO CHAR(1), DIGITAR_INTENSIDADE CHAR(1), DIGITAR_ASPECTO CHAR(1), DIGITAR_ITEM_PRESCRITO CHAR(1),
  ATIVO CHAR(1));
CREATE TABLE PRCAB_IDENTIFIC_PAC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(200), ATIVO CHAR(1));
CREATE TABLE PRCAMPOSLOCALIZACAOPACIENTE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE PRFA_UTILIZACAO (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(100) NOT NULL, ATIVO CHAR(1) NOT NULL);
CREATE TABLE PRFILTROCLASSIF (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE PRFILTROUSUARIO (ID SMALLINT NOT NULL PRIMARY KEY, ID_TBUSERS VARCHAR(31) NOT NULL, ATENDIMENTO CHAR(1),
  SITUACAO_NAO_EMITIDOS CHAR(1), RESULTADO_LIBERADO CHAR(1), TODOS_REGISTROS CHAR(1), SOMENTE_MEUS_PEDIDOS CHAR(1));
CREATE TABLE PRFINALIDADETRAT (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(80), ID_TBTISSFINTRAT SMALLINT);
CREATE TABLE PRFORMULA (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30), FORMULA VARCHAR(1000), ATIVO CHAR(1));
CREATE TABLE PRAGRUPBALANCO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE PRASSINANTE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(100), ATIVO CHAR(1));
CREATE TABLE PRBHTIPOFECHAMENTO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE PRFREQUENCIA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, NUM_DOSE SMALLINT,
  TP_PRESCRICAO CHAR(1) NOT NULL, ESTOQUE CHAR(1) NOT NULL, RECEITA_ESTRUTURADA CHAR(1) NOT NULL, ORDEM SMALLINT);
CREATE TABLE PRHRRELATIVA (ID SMALLINT NOT NULL PRIMARY KEY, ID_PRFREQUENCIA SMALLINT NOT NULL, NOME VARCHAR(30) NOT NULL,
  ORDEM SMALLINT NOT NULL, HORARIO TIMESTAMP NOT NULL);
CREATE TABLE PRLOCPACDEFAULT (ID INTEGER NOT NULL PRIMARY KEY, USUARIO VARCHAR(31) NOT NULL, TP_ATENDIMENTO_DEFAULT CHAR(1),
  ZOOM_PADRAO_VISUALIZACAO_LANC SMALLINT, INICIAR_TELA_CFG_LOCAL_PAINEL CHAR(1), INICIAR_TELA_LOC_ACESSAR_PEP CHAR(1),
  PERMITE_ASSINATURA_DIGITAL CHAR(1), PERMITE_ASSINATURA_DIG_EM_LOTE CHAR(1), PERMITE_LANC_RETROATIVO CHAR(1),
  PERMITE_SOMENTE_SALVAR VARCHAR(1), PERMITE_AVALIAR VARCHAR(1), ALERTAR_EXAMES_LIBERADOS VARCHAR(1),
  ALERTAR_EXAMES_LIB_PERIODO TIME, ALERTAR_PEND_AVAL_PRESC_O_PROF VARCHAR(1), PERMITE_CRIAR_EXCL_PRESC_FUTURA CHAR(1),
  ALE_EXA_REP_D4H_CON CHAR(1));
CREATE TABLE PRDADOSENVIOOPERADORA (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(80));
CREATE TABLE PRFAVORITO_EXIBIR (ID INTEGER NOT NULL PRIMARY KEY, LOCPACDEFAULT INTEGER NOT NULL,
  CAMPOSLOCALIZACAOPACIENTE SMALLINT NOT NULL, ORDEM SMALLINT, EXIBIR CHAR(1));
CREATE TABLE PRFICHAREL (ID_FICHAREL INTEGER NOT NULL PRIMARY KEY, COD SMALLINT NOT NULL, NOMECOMP VARCHAR(30) NOT NULL,
  NOMECLASSE VARCHAR(30), NOME VARCHAR(50), COMPONENTE BLOB SUB_TYPE 1, CONTEUDO BLOB SUB_TYPE 1, PARENT VARCHAR(30),
  TIPO SMALLINT NOT NULL, SEQUENCIA SMALLINT);
CREATE TABLE GECADANTIMI (ID_GECADANTIMI INTEGER NOT NULL PRIMARY KEY, REG INTEGER NOT NULL, TIPO VARCHAR(1) NOT NULL,
  CRM INTEGER NOT NULL, ID_TBCBOPRO INTEGER NOT NULL, CONV SMALLINT NOT NULL);
CREATE TABLE RICADPAC ("ID" INTEGER NOT NULL, "PRONT" INTEGER NOT NULL, CONSTRAINT PK_L605_RICADPAC PRIMARY KEY ("ID"));
CREATE TABLE RECADATE ("REG" INTEGER NOT NULL, "PRONT" INTEGER, CONSTRAINT PK_L605_RECADATE PRIMARY KEY ("REG"));
CREATE TABLE TBCBOPRO ("ID" INTEGER NOT NULL, "ID_TBCBOSUS" INTEGER NOT NULL, "UF" VARCHAR(2) NOT NULL, "COD"
  INTEGER NOT NULL, "ID_TBPROFIS" INTEGER NOT NULL, "VINC_EMPR" VARCHAR(1) NOT NULL, "CONS_PROF" VARCHAR(7), "ATIVO"
  VARCHAR(1), "VINCULO" SMALLINT, "COMP_INICIAL" INTEGER, "COMP_FINAL" INTEGER, "ATENDE_SUS" CHAR(1), "CRM_DIGITO"
  VARCHAR(1), "REGIONAL" INTEGER, "ID_TBSIGLACONSPROF" SMALLINT, "REG_QUALIF_ESPECIALISTA" VARCHAR(9),
  "AXREG_ID_ANESTHESIOLOGISTS" BIGINT, "ID_DIGITAL" VARCHAR(36), CONSTRAINT PK_L605_TBCBOPRO PRIMARY KEY ("ID"));
"""

# rodada 5: listas do hospital como opções de parâmetro do produto (definição semeada pelo produto, pedido)
PARAMETROS_LISTA = {"PRCADRESP": "pep.formulario.respostaPadrao", "PREMAILOPCAO": "pep.email.opcaoEnvio",
                    "PRLAYIMPPRESC": "pep.impressaoPrescricao.leiaute"}
# logins inventados de usuários já carregados (L3)
PAIS_EXTERNOS = {"TBUSERS": ["usuario.exemplo.um", "usuario.exemplo.dois"],
                 # atendimentos e pacientes (L3), convênio e profissional (L3/L5) já carregados; 5002 nunca carregado
                 "RECADATE": ["5000", "5001", "5003"], "RICADPAC": ["1", "2"], "TBCONVEN": ["3"], "TBPROFIS": ["900"]}
# pais de outras fatias na imagem só como origem das ref: encadeadas (sem esperado desta fatia)
PAIS_ORIGEM = ("PRLOCPACDEFAULT", "RECADATE", "RICADPAC", "TBCBOPRO")
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo e as finalidades
# nativas do antimicrobiano (semente de 06_PEP/18_chaves.sql) vêm daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');"
                   " CREATE TABLE IF NOT EXISTS finalidade_terapeutica (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(30) NOT NULL UNIQUE, descricao VARCHAR(150) NOT NULL);"
                   " INSERT INTO finalidade_terapeutica (codigo, descricao) VALUES ('profilatica', 'Profilática'),"
                   " ('empirica', 'Empírica'), ('terapeutica', 'Terapêutica'); "
                   + preparo_parametros())


U1, U2 = PAIS_EXTERNOS["TBUSERS"]
H = datetime.datetime


def _pref(i, login):
    """Preferência do usuário (tabela da L5-01), só para a ref: encadeada; colunas opcionais vazias."""
    return [i, login, None, None, None, None, None, None, "S", None, None, "N", None, None, None, "N"]

# (tabela, linhas, esperado)
DADOS = [
    # rodada 5: resposta sem descrição usa o código como rótulo; código acima de SMALLINT na sequência (1264)
    ("PRCADRESP", [[1, "Sim"], [2, "Não  sei €"], [3, None], [70000, "Resposta fora da faixa"]],
     {"gravados": 3, "pendencias": {"restricao_destino_1264": 1}}),
    ("PREMAILOPCAO", [[1, "Enviar resumo de alta", 1], [2, "Enviar laudo", None]], {"gravados": 2, "pendencias": {}}),
    ("PRLAYIMPPRESC", [[1, "Horários em colunas"], [2, "Compacto"], [3, "   "]],
     {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}}),
    ("GETABVIA", [["VO", "Via oral", "S", 1, None], ["IV", "Intravenosa", "S", 2, None],
                  ["SC", " Subcutânea  ", "N", None, "00000000-0000-0000-0000-000000000001"],
                  ["Ab", "Via exemplo caixa mista", "S", None, None], ["AB", "Via exemplo caixa alta", "S", None, None],
                  ["SN", None, "S", None, None], ["IM", "Intramuscular", "X", None, None]],
     {"gravados": 4, "pendencias": {"codigo_colisao_caixa": 2, "restricao_destino_1048": 1,
                                    "valor_fora_do_dominio": 1}}),
    ("PRAGRAVOTPARQUETIPO", [[1, "Agravo exemplo um"], [2, "Agravo  exemplo   dois"], [3, "   "],
                             [4, "Agravo exemplo quatro"]],
     {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}}),
    # sequência = id da origem (nunca muda: apagar a 2 e criar a 8 no diferencial não colide nem desloca a 3);
    # agravo 1: ids 1, 2, 3, 6; 6 repete campo e subcódigo do 2 (1062); 5 aponta o agravo recusado; 7 aponta agravo
    # nunca visto; 8 entra com lacuna na chave (sequência 8, depois da 3)
    ("PRAGRAVOPERGUNTA", [[1, 1, 10, 0, "Data dos primeiros sintomas"], [2, 1, 11, 0, "Febre?"],
                          [3, 1, 11, 1, "Temperatura  aferida"], [4, 2, 10, 0, "Pergunta exemplo"],
                          [5, 3, 10, 0, "Pergunta do agravo recusado"], [6, 1, 11, 0, "Febre repetida"],
                          [7, 9, 1, 0, "Pergunta de agravo inexistente"], [8, 1, 12, 0, "Pergunta nova depois de lacuna"]],
     {"gravados": 5, "pendencias": {"pai_pendente": 1, "restricao_destino_1062": 1, "pai_inexistente": 1,
                                    "restricao_destino_1048": 1}}),
    ("PRBHINTENSIDADE", [[1, "Pequena"], [2, "Moderada"], [3, "Grande"], [4, "  Muito\r\ngrande "]],
     {"gravados": 4, "pendencias": {}}),
    ("PRBHTPELIMINA", [[1, "Diurese", "S", "N", "N", "S", "N", "S"], [2, "Vômito", "N", "S", "S", "S", "N", "S"],
                       [3, "Dreno", "S", None, None, None, None, "N"], [4, "Evacuação", "X", "N", "N", "N", "N", "S"]],
     {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1}}),
    ("PRCAB_IDENTIFIC_PAC", [[1, "Dados atuais do paciente", "S"], [2, "Dados da emissão", "S"], [3, None, "N"]],
     {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}}),
    # chave do atributo do produto pelo nome (valores.d): 4 sem par entra com chave própria derivada do id, presumida
    # (recusas-fase2 P3a; não é situação nem papel clínico); 6 é a mesma chave da 3
    # (alergias) e recusa pela chave única
    ("PRCAMPOSLOCALIZACAOPACIENTE", [[1, "Leito"], [2, "Dias de internação"], [3, "Alergia"], [4, "Coluna exemplo"],
                                     [5, "MÉDICO"], [6, "Alergias"]],
     {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 1, "valor_presumido": 1,
                                    "restricao_destino_1062": 1}}),
    ("PRFA_UTILIZACAO", [[1, "Medicamento", "S"], [2, "Uso em bomba de infusão", "S"], [3, "Material", "N"]],
     {"gravados": 3, "pendencias": {}}),
    ("PRFILTROCLASSIF", [[1, "Classificação exemplo"]], {"gravados": 1, "pendencias": {}}),
    # 4: login nunca visto (pai_inexistente + NOT NULL)
    # escopo por TODOS_REGISTROS (S todos, N atual, vazio padrão atual); 5 fora do domínio fica o padrão
    ("PRFILTROUSUARIO", [[1, U1, "S", "N", "S", "N", "S"], [2, U1, "N", "S", "N", "S", "N"],
                         [3, U2, None, None, None, None, None], [4, "usuario.exemplo.tres", "S", "N", "S", "N", "N"],
                         [5, U2, "S", "N", "S", "X", "N"]],
     {"gravados": 4, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1,
                                    "valor_fora_do_dominio": 1}}),
    ("PRFINALIDADETRAT", [[1, "Curativa", 1], [2, "Paliativa", 2], [3, "Adjuvante", None]],
     {"gravados": 3, "pendencias": {}}),
    # expressão na sintaxe da origem (não validada): as duas entram inativas; valor_presumido por coluna (base e ativo)
    ("PRFORMULA", [[1, "Superfície corporal", "peso * 0,1 + altura", "S"], [2, "Dose por peso", "peso * 10", "N"]],
     {"gravados": 2, "pendencias": {"valor_presumido": 4}}),
    # lado do balanço pelo nome (valores.d): 4 sem par recusa (nada presumido)
    ("PRAGRUPBALANCO", [[1, "GANHOS"], [2, "Perdas"], [3, "PERDAS INSENSÍVEIS"], [4, "Grupo exemplo"]],
     {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}}),
    # papel pelo nome: 4 sem par recusa; 5 sem nome (papel e descrição nulos) recusa sem valor_fora_do_dominio
    ("PRASSINANTE", [[1, "Profissional", "S"], [2, "Paciente", "S"], [3, "Testemunha", "N"],
                     [4, "Papel exemplo", "S"], [5, None, "S"]],
     {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 2}}),
    # 'Parcial' não diz a duração: nunca presume 24 horas; tipo migrado entra sem período (recusas-fase2 P3a: CHECK
    # relaxado só no migrado), com valor_fora_do_dominio visível (parcial tem par: sem pendência nele)
    ("PRBHTIPOFECHAMENTO", [[1, "24 HORAS"], [2, "12 horas"], [3, "Parcial"]],
     {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1}}),
    # 3 e 4 sem número de doses (nulo, 0): a critério médico; 5 acima de 48 recusa; 6 S/N fora do domínio (padrão)
    ("PRFREQUENCIA", [[1, "De 6 em 6 horas", 4, "M", "S", "S", 1], [2, "Uma vez ao dia", 1, "M", "S", "N", 2],
                      [3, "A critério médico", None, "M", "N", "S", 3], [4, "Se necessário", 0, "M", "S", "S", None],
                      [5, "Frequência exemplo", 60, "M", "S", "S", 5], [6, "Contínuo", None, "M", "X", "S", 6]],
     {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 2, "restricao_destino_1048": 1}}),
    # 3 hora com data (hora usada); 4 frequência recusada; 5 frequência nunca vista; 6 descrição vazia; 7 sequência
    # repetida na frequência 1
    ("PRHRRELATIVA", [[1, 1, "Em jejum", 1, H(1899, 12, 30, 6, 0)], [2, 1, "Antes do almoço", 2, H(1899, 12, 30, 11, 30)],
                      [3, 1, "Ao deitar", 3, H(2020, 5, 1, 22, 0)], [4, 5, "Horário exemplo", 1, H(1899, 12, 30, 8, 0)],
                      [5, 9, "Horário sem frequência", 1, H(1899, 12, 30, 8, 0)],
                      [6, 2, "   ", 1, H(1899, 12, 30, 8, 0)], [7, 1, "Repetida", 2, H(1899, 12, 30, 9, 0)]],
     {"gravados": 3, "pendencias": {"hora_com_data": 1, "pai_pendente": 1, "pai_inexistente": 1,
                                    "restricao_destino_1048": 2, "restricao_destino_1062": 1}}),
    # informação enviada à operadora: grupo padrão criado pela 1, adotado por 2 e 4 (adotado_existente); a 3, de
    # descrição vazia, é recusada (1048) e não deixa adoção
    ("PRDADOSENVIOOPERADORA", [[1, "Indicação clínica"], [2, "  Estadiamento   do tumor "], [3, "   "],
                               [4, "Peso exemplo"]],
     {"gravados": 3, "pendencias": {"adotado_existente": 2, "restricao_destino_1048": 1}}),
    # usuário pela preferência (10, 20) e o login dela; 30 tem login nunca visto; 99 não existe; 4 S/N fora do domínio;
    # coluna da tela = chave do atributo gravada pela coluna do painel; 7 aponta a coluna 4, recusada (pai_pendente)
    ("PRFAVORITO_EXIBIR", [[1, 10, 1, 1, "S"], [2, 10, 2, 2, "N"], [3, 20, 1, 1, "S"], [4, 20, 3, None, "X"],
                           [5, 30, 1, 1, "S"], [6, 99, 1, 1, "S"], [7, 10, 4, 3, "S"]],
     {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1, "pai_inexistente": 2, "restricao_destino_1048": 2,
                                    "pai_pendente": 1}}),
    # leiaute de impressão: COD 1 com três componentes fora da ordem da chave (sequência 2, 1 e uma sem sequência)
    # e propriedades com quebra de linha e acento; COD 2 com um componente; o tipo de migração é criado pela
    # primeira linha e adotado pelas seguintes; o leiaute entra inativo
    ("PRFICHAREL", [[1, 1, "Painel1", "TPanel", "Cabeçalho exemplo", b"Left = 8\r\nTop = 4", "Título falso".encode("cp1252"), None, 1, 2],
                    [2, 1, "Label1", "TLabel", None, b"Caption = 'Nome'", None, "Painel1", 2, 1],
                    [3, 2, "Memo1", "TMemo", "Observação", None, "Texto de exemplo\nlinha 2".encode("cp1252"), None, 3, 1],
                    [4, 1, "Image1", "TImage", None, None, None, "Painel1", 4, None]],
     {"gravados": 4, "pendencias": {"adotado_existente": 3}}),
]
# pai de fora da fatia (L5-01) presente na imagem só para a ref: encadeada; o esperado dele não é desta fatia
PREFERENCIAS = [_pref(10, U1), _pref(20, U2), _pref(30, "usuario.exemplo.nunca")]


# ficha do antimicrobiano (ID, REG, TIPO, CRM, ID_TBCBOPRO, CONV): 1 completa; 2 convênio nunca carregado; 3 tipo sem
# par e profissional nunca carregado (inscrição 51); 4 atendimento nunca carregado (recusa); 5 atendimento sem paciente
FICHAS = [[1, 5000, "P", 1234, 50, 3], [2, 5001, "E", 1234, 50, 9], [3, 5001, "X", 4321, 51, 3],
          [4, 5002, "T", 1234, 50, 3], [5, 5003, "T", 1234, 50, 3]]


def linhas(r, ins):
    esperado = {}
    for v in PREFERENCIAS:
        ins("PRLOCPACDEFAULT", list(v))
    for v in [(5000, 700), (5001, 701), (5002, 700), (5003, 702)]:   # 702: prontuário sem paciente
        ins("RECADATE", list(v))
    for v in [(1, 700), (2, 701)]:
        ins("RICADPAC", list(v))
    for i, prof in [(50, 900), (51, 999)]:                           # 999: profissional nunca carregado
        ins("TBCBOPRO", [i, 1, "SP", 1000 + i, prof, "N"] + [None] * 12)
    for v in FICHAS:
        ins("GECADANTIMI", list(v))
    esperado["GECADANTIMI"] = {"gravados": 3, "pendencias": {"pai_inexistente": 4, "valor_fora_do_dominio": 1,
                                                             "restricao_destino_1048": 2}}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        esperado[tab] = esp
    return esperado
