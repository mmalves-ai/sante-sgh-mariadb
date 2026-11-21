"""Fatia L8-17 (faturamento e restantes, módulo INTG): tabelas da origem com a forma do dicionário e dados 100% falsos.

Carregadas pelo mapa (colunas.d/L8-17.tsv): códigos de erro e situações de entrega da mensageria (mesmo destino,
codigo_retorno_mensageria), transações do padrão TISS (tipo pelo de-para de valores do domínio público,
valores.d/L8-17.tsv) e padrões de serviço web. Valor sem origem que muda o comportamento entra como literal presumido
(=~), com valor_presumido por coluna presumida em cada linha que chega à gravação (inclusive a recusada pelo destino).
Complemento (complementa): o endereço do serviço por transação TISS grava caminho_padrao na transação já gravada
(UPDATE, sem linha nova); transação recusada: pai_pendente; nunca vista: pai_inexistente.
Fora da carga, só com a forma (linhas falsas): descartes de produto em declarado/sem_carga.tsv (listas fixas que são
CHECK do modelo, parâmetros do adaptador de provedor, catálogo oficial e seus históricos, registros sem valor).
Anomalias: descrição nula ou só com espaços (NOT NULL do destino: restricao_destino_1048), código repetido com outra
caixa (chave única sem distinção de caixa: restricao_destino_1062), espaços repetidos e acentos CP1252, tipo de
transação fora do domínio (valor_fora_do_dominio e recusa pelo NOT NULL), tipo nulo (recusa pelo NOT NULL) e
complemento de transação recusada ou inexistente.
"""
import datetime

DDL = """
CREATE TABLE TBSAFEWEB_FORMA_ASSIN_ICP ("ID" SMALLINT NOT NULL, "CODIGO" SMALLINT NOT NULL, "NOME" VARCHAR(20) NOT NULL,
  "ID_TBFORMA_ASSINATURA_ICP" SMALLINT, PRIMARY KEY ("ID"));
CREATE TABLE TBSAFEWEB_SITAUTORIZA ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(30), PRIMARY KEY ("ID"));
CREATE TABLE TBSAFEWEB_TIPOATENDIMENTO ("ID" SMALLINT NOT NULL, "DESCRICAO" VARCHAR(40) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBSEXO_PIXPDQ ("CODIGO" VARCHAR(1) NOT NULL, "DESCRICAO" VARCHAR(10) NOT NULL, "ID_DIGITAL" VARCHAR(36),
  PRIMARY KEY ("CODIGO"));
CREATE TABLE TBSGHINTEGRADOR_PARAM ("ID" SMALLINT NOT NULL, "ATIVADO" CHAR(1) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBSGHINTEGRADOR_TABELA ("ID" INTEGER NOT NULL, "NOME" VARCHAR(50) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBSIPANSPROC ("COD_PROCEDIMENTO" INTEGER NOT NULL, "ID_TBSIPANSATO" SMALLINT NOT NULL,
  "DATA_VIGENCIA_INICIAL" DATE NOT NULL, "DATA_VIGENCIA_FINAL" DATE NOT NULL,
  PRIMARY KEY ("COD_PROCEDIMENTO","ID_TBSIPANSATO","DATA_VIGENCIA_INICIAL"));
CREATE TABLE TBSMSTPAGENDA ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(10), PRIMARY KEY ("ID"));
CREATE TABLE TBSMSTPERRO ("ID" SMALLINT NOT NULL, "COD_TP_ERRO" VARCHAR(7) NOT NULL, "NOME" VARCHAR(80),
  PRIMARY KEY ("ID"));
CREATE TABLE TBSMSTPRETMSG ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(11), PRIMARY KEY ("ID"));
CREATE TABLE TBTISSREMUNERAOPERPS ("ID" INTEGER NOT NULL, "NOME" VARCHAR(50), "DATA_VIGENCIA_INICIAL" DATE,
  "DATA_VIGENCIA_FINAL" DATE, PRIMARY KEY ("ID"));
CREATE TABLE TBTISSSCHEMA ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(50), "TP_TRANSACAO" VARCHAR(30), PRIMARY KEY ("ID"));
CREATE TABLE TBTISSURLWSSGH ("ID_TBTISSSCHEMA" SMALLINT NOT NULL, "URL_SERVICO" VARCHAR(150) NOT NULL,
  PRIMARY KEY ("ID_TBTISSSCHEMA"));
CREATE TABLE TBTPEXPIPERGS ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(30) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBTPWEBSERV ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(40) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBVIDAAS_FORMA_ASSIN_ICP ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(20) NOT NULL,
  "ID_TBFORMA_ASSINATURA_ICP" SMALLINT, PRIMARY KEY ("ID"));
CREATE TABLE PRCABNEXODATA ("ID" INTEGER NOT NULL, "ID_HTATENDIMENTO" BIGINT NOT NULL, "ID_HTPACIENTE" BIGINT NOT NULL,
  "REFERENCIA_NEXODATA" VARCHAR(30), "JSON_ORIGINAL_NEXODATA" BLOB SUB_TYPE 0, "IDPRESCRICAO_NEXODATA" INTEGER,
  "IDPRESCRICAOSTATUS_NEXODATA" INTEGER, "REGISTRO_VALIDO" CHAR(1), "DATA_HORA_EXCLUSAO" TIMESTAMP,
  "DATA_HORA_EVENTO_TMP" TIMESTAMP, "ID_TBCBOPRO_TMP" INTEGER NOT NULL, "VERSAO_API" SMALLINT NOT NULL,
  PRIMARY KEY ("ID"));
CREATE TABLE PRLANCNEXODATA ("ID" INTEGER NOT NULL, "ID_PRCABNEXODATA" INTEGER NOT NULL, "HASH_BUSCA" VARCHAR(254),
  "ID_PRTPASSINATURA" INTEGER NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE SIWSLANCETQTA ("ID" INTEGER NOT NULL, "ID_SILANEXA" DOUBLE PRECISION NOT NULL,
  "DATA_HORA_RETORNO" TIMESTAMP, "IDENT_LIS" VARCHAR(12), "ID_SIWSETIQUETA" INTEGER NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE HTCID ("ID" INTEGER NOT NULL, "ID_TBCID10" INTEGER NOT NULL, "DATA_HORA_HISTORICO" TIMESTAMP NOT NULL,
  "NOME" VARCHAR(270), "CLASSIFICACAO" CHAR(1), "CATEGORIA" CHAR(1), "SUB_CATEGORIA" CHAR(1), "SEXO" SMALLINT,
  "VIG_SANITARIA" CHAR(1), "TP_AGRAVO" SMALLINT, "ID_TBVERSAOCID" SMALLINT, PRIMARY KEY ("ID"));
CREATE TABLE HTCIAP ("ID" INTEGER NOT NULL, "ID_TBCIAP" INTEGER NOT NULL, "CODIGO" VARCHAR(4) NOT NULL,
  "NOME_ORIGINAL" VARCHAR(100) NOT NULL, "NOME_LEIGO" VARCHAR(100) NOT NULL, "COMPETENCIA_INICIAL" VARCHAR(6) NOT NULL,
  "ID_TBUSERS" VARCHAR(31) NOT NULL, "DATA_HORA_GRAVACAO" TIMESTAMP NOT NULL, "ID_TBVERSAOCIAP" SMALLINT NOT NULL,
  "ATIVO" CHAR(1) NOT NULL, "SEXO" VARCHAR(1) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBCID10 ("ID" INTEGER NOT NULL, "COD" VARCHAR(6), PRIMARY KEY ("ID"));
"""

CARREGADAS = ("TBSMSTPERRO", "TBSMSTPRETMSG", "TBTISSSCHEMA", "TBTPWEBSERV", "TBTISSURLWSSGH")
# rodada 5 (ADR 0006): listas do hospital (parametro_opcao), envio de receita digital e etiqueta do apoio
LISTAS = ("TBSAFEWEB_FORMA_ASSIN_ICP", "TBSAFEWEB_SITAUTORIZA", "TBSAFEWEB_TIPOATENDIMENTO", "TBSGHINTEGRADOR_PARAM",
          "TBSGHINTEGRADOR_TABELA", "TBSMSTPAGENDA", "TBTPEXPIPERGS", "TBVIDAAS_FORMA_ASSIN_ICP")
# r5c (ADR 0006, 1 e 4): históricos e listas de catálogo usadas pelo hospital entram na trilha com o retrato
TRILHA = ("HTCID", "HTCIAP", "TBSIPANSPROC", "TBSEXO_PIXPDQ", "TBTISSREMUNERAOPERPS")
NOVAS = LISTAS + ("PRCABNEXODATA", "PRLANCNEXODATA", "SIWSLANCETQTA") + TRILHA
# linhas recusadas por tabela nova (uma linha recusada pode levar várias pendências): gravados + recusadas = linhas
RECUSADAS = {"PRCABNEXODATA": 3, "PRLANCNEXODATA": 1, "SIWSLANCETQTA": 1}
# sem nenhuma linha gravada até o DDL pedido (r5b-1 em saida/L8-17.json) e os pais de outras fatias
AGUARDAM_DDL = ("PRCABNEXODATA", "PRLANCNEXODATA", "SIWSLANCETQTA")
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
                   # r5b: termo oficial da CID-10 usado pelo histórico HTCID (catálogo oficial: só o código de exemplo)
                   " INSERT INTO terminologia (id, codigo, nome, tipo, origem, criado_em) SELECT 9170, 'cid10', 'CID-10',"
                   " 'diagnostico', 'sistema', UTC_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS"
                   " (SELECT 1 FROM terminologia WHERE codigo = 'cid10');"
                   " INSERT INTO termo_terminologia (id, terminologia_id, codigo_termo, descricao, criado_em)"
                   " SELECT 9171, (SELECT id FROM terminologia WHERE codigo = 'cid10'), 'A00', 'Termo de exemplo',"
                   " UTC_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM termo_terminologia WHERE id = 9171)")
# r5b: o CID do histórico vem da origem (pai de L8-16, descarte catalogo_oficial: lido pela encadeada até o código)
PAIS_EXTERNOS = {"TBCID10": ["1", "2"]}
R1048, R1062, VP, VFD = "restricao_destino_1048", "restricao_destino_1062", "valor_presumido", "valor_fora_do_dominio"
PP, PI = "pai_pendente", "pai_inexistente"
A = "adotado_existente"  # lista: módulo e definição criados pela 1.ª linha, adotados depois (baixa)
D = datetime.date(2025, 1, 2)
T = datetime.datetime(2025, 1, 2, 8, 30)

DADOS = [
    # código de erro: 3 repete o 1 com outra caixa (1062); 2 sem descrição (1048); 4 com pontas e acento
    ("TBSMSTPERRO", [[1, "EX01", "Erro  exemplo   um"], [2, "EX02", None], [3, "ex01", "Erro exemplo repetido"],
                     [4, " EX04 ", "Número inválido ação"]],
     {"gravados": 2, "pendencias": {R1062: 1, R1048: 1, VP: 4}}),
    # situação: nome vira o código e, pelo de-para, a situação resultante; 3 sem nome (1048); 4 com pontas;
    # 5 nome sem par (VFD + 1048; sem curinga no motor); 6 falha da origem vira falha_definitiva, nunca enviada
    ("TBSMSTPRETMSG", [[1, "Enviada"], [2, "ENTREGUE"], [3, None], [4, " Lida "], [5, "Estado ex"], [6, "Erro"]],
     {"gravados": 4, "pendencias": {R1048: 2, VFD: 1}}),
    # transação TISS: código = nome no padrão; 3 fora do domínio (VFD + 1048; sem curinga no motor); 4 sem nome (1048);
    # 5 sem tipo (1048); 7 e 8 grafias do esquema da ANS; 9 repete o nome do 1 (1062)
    ("TBTISSSCHEMA", [[1, "tissLoteExemplo", "ENVIO_LOTE_GUIAS"], [2, "tissElegibExemplo", " VERIFICA_ELEGIBILIDADE "],
                      [3, "tissInventadoEx", "TRANSACAO_FALSA_EX"], [4, None, "CANCELA_GUIA"],
                      [5, "tissSemTipoEx", None], [6, "tissRecurso  exemplo", "RECURSO_GLOSA"],
                      [7, "tissStatusAutorizEx", "SOLICITA_STATUS_AUTORIZACAO"],
                      [8, "tissRespostaRecursoEx", "RESPOSTA_RECURSO_GLOSA"],
                      [9, "tissLoteExemplo", "PROTOCOLO_RECEBIMENTO"]],
     {"gravados": 5, "pendencias": {VFD: 1, R1048: 3, R1062: 1, VP: 9}}),
    ("TBTPWEBSERV", [[1, "Serviço exemplo um"], [2, "Serviço  exemplo dois"], [3, "   "]],
     {"gravados": 2, "pendencias": {R1048: 1, VP: 3}}),
    # complemento da transação: 1, 2 e 6 completam (6 com pontas); 3 aponta transação recusada (pai_pendente);
    # 77 aponta transação nunca vista (pai_inexistente)
    ("TBTISSURLWSSGH", [[1, "https://servico.exemplo.invalid/tiss/lote"], [2, "https://servico.exemplo.invalid/eleg"],
                        [3, "https://servico.exemplo.invalid/falsa"], [6, "  https://servico.exemplo.invalid/rec  "],
                        [77, "https://servico.exemplo.invalid/orfa"]],
     {"gravados": 3, "pendencias": {PP: 1, PI: 1}}),
    # fora da carga (descarte de produto em declarado/sem_carga.tsv): só a forma
    ("TBSAFEWEB_FORMA_ASSIN_ICP", [[1, 10, "Formato ex A", 1], [2, 11, "Formato ex B", None]], {"gravados": 2, "pendencias": {A: 2}}),
    ("TBSAFEWEB_SITAUTORIZA", [[1, "Situação ex"], [2, None]], {"gravados": 2, "pendencias": {A: 3}}),
    ("TBSAFEWEB_TIPOATENDIMENTO", [[1, "Atendimento ex"]], {"gravados": 1, "pendencias": {A: 1}}),
    ("TBSEXO_PIXPDQ", [["X", "Sexo ex", None], ["Y", "Outro ex", "id-falso-ex"]], {"gravados": 2, "pendencias": {}}),
    ("TBSGHINTEGRADOR_PARAM", [[1, "S"]], {"gravados": 1, "pendencias": {A: 1}}),
    ("TBSGHINTEGRADOR_TABELA", [[1, "ENTIDADE_EXEMPLO"]], {"gravados": 1, "pendencias": {A: 1}}),
    ("TBSIPANSPROC", [[99990001, 1, D, datetime.date(2099, 12, 31)]], {"gravados": 1, "pendencias": {}}),
    ("TBSMSTPAGENDA", [[1, "Diária ex"], [2, None]], {"gravados": 2, "pendencias": {A: 3}}),
    ("TBTISSREMUNERAOPERPS", [[1, "Modelo ex", D, None]], {"gravados": 1, "pendencias": {}}),
    ("TBTPEXPIPERGS", [[1, "Prestador ex"]], {"gravados": 1, "pendencias": {A: 1}}),
    ("TBVIDAAS_FORMA_ASSIN_ICP", [[1, "Formato ex C", 1]], {"gravados": 1, "pendencias": {A: 1}}),
    # envio de receita digital: atendimento, paciente e prescritor de outras fatias, ausentes aqui (pai_inexistente)
    # r5b: a situação sai da origem (excluído = cancelada, inválido = rejeitada, senão enviada); recusadas pelo CHECK
    # do documento até o DDL pedido (r5b-1 em saida/L8-17.json): pendência visível, nenhuma some
    ("PRCABNEXODATA", [[1, 1, 1, "ref-ex", b"{}", 1, 1, "S", None, T, 1, 1],
                       [2, 1, 1, "ref-ex2", b"{}", 2, 2, "N", None, T, 1, 1],
                       [3, 1, 1, "ref-ex3", b"{}", 3, 3, "S", T, T, 1, 1]],
     {"gravados": 0, "pendencias": {PI: 9, R1048: 3, VP: 3}}),
    ("PRLANCNEXODATA", [[1, 1, "hash-ex", 1]], {"gravados": 0, "pendencias": {PP: 1}}),
    ("SIWSLANCETQTA", [[1, 1.0, T, "LIS-EX-1", 1]], {"gravados": 0, "pendencias": {PI: 3, R1048: 1}}),
    ("TBCID10", [[1, "A00"], [2, "Z999"]], None),
    # r5b (ADR 0007 21): histórico do termo vira versão com retrato; 2 aponta código fora do catálogo (visível, recusado)
    ("HTCID", [[1, 1, T, "Termo exemplo", "A", "B", "C", 1, "N", 1, 1], [2, 2, T, "Termo local ex", "A", "B", "C", 1, "N", 1, 1]],
     {"gravados": 2, "pendencias": {"catalogo_codigo_inexistente": 1}}),
    ("HTCIAP", [[1, 1, "X99", "Termo ex", "Termo leigo ex", "202501", "USR_L817_A", T, 1, "S", "A"]], {"gravados": 1, "pendencias": {}}),
]


def linhas(r, ins):
    esperado = {}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        if esp is not None:
            esperado[tab] = {"gravados": esp["gravados"], "pendencias": dict(esp["pendencias"])}
    return esperado
