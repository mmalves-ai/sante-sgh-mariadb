"""Fatia L8-18 (relatórios: catálogo, triagem, agrupamentos, parâmetros e permissões): imagem sintética.

Dados 100% falsos (nomes e logins inventados, e-mails em domínio .invalid). 7 tabelas carregadas; 9 ficam na
imagem e NÃO são carregadas (motivos em colunas.d/L8-18.tsv; pedidos em docs/obra/fatias/f4/saida/L8-18.json).
Anomalias cobertas:
- nome nulo em coluna obrigatória do destino (restricao_destino_1048, recusa só a linha);
- código e ordem repetidos em chave única do destino (restricao_destino_1062);
- S/N fora do domínio (valor_fora_do_dominio; fica o padrão do destino);
- versão 0 (padrão do destino, sem pendência);
- módulo, usuário e perfil nunca vistos (pai_inexistente; em coluna obrigatória ou no CHECK de alvo, recusa);
- filho de relatório ou agrupamento recusado (pai_pendente);
- relatório nulo no parâmetro (recusa pelo NOT NULL);
- consulta de origem com quebras de linha e espaços (texto_longo preserva);
- tipo do parâmetro e nome da categoria sem origem (literal presumido: valor_presumido por linha, inclusive nas
  linhas recusadas pela restrição do destino, que já passaram pelo literal);
- quantidade de parâmetros e acesso restrito da triagem presumidos (=~0: valor_presumido por coluna e linha,
  8 x 2 = 16), pois vêm das filhas e o motor não agrega;
- parâmetro oculto (VISIVEL='N', id 3) entra como comum: perda declarada;
- módulo nunca visto numa linha com dois destinos: pai_inexistente uma vez por destino (TBEDITREL 4: 2 + 5: 1).
"""
import datetime

DDL = """
CREATE TABLE PNCONFIGPORTAL (ID_PNCONFIG SMALLINT NOT NULL, ORDEM SMALLINT NOT NULL, NOME VARCHAR(50) NOT NULL,
  CONFIGURACAO BLOB SUB_TYPE 1, CONSTRAINT PK_PNCONFIGPORTAL PRIMARY KEY (ID_PNCONFIG, ORDEM));
CREATE TABLE TBAGRUPRELAT (ID SMALLINT NOT NULL PRIMARY KEY, COD_AGRUPAMENTO SMALLINT NOT NULL, NOME VARCHAR(50),
  INTERCALAR_IMPRESSAO_PAGINA CHAR(1));
CREATE TABLE TBEDITREL (ID_EDITREL INTEGER NOT NULL PRIMARY KEY, MODULO SMALLINT NOT NULL, TIPO SMALLINT NOT NULL,
  NOME VARCHAR(50), TEXTOSQL BLOB SUB_TYPE 1, USUARIO VARCHAR(31), VERSAO SMALLINT NOT NULL, ID_TBOPCOES INTEGER);
CREATE TABLE TBAGRUPRELAT_TBEDITREL (ID_TBAGRUPRELAT SMALLINT NOT NULL, ID_TBEDITREL INTEGER NOT NULL,
  ORDEM_IMPRESSAO SMALLINT NOT NULL, ID_FPESOCTVERSAOESOCIAL INTEGER,
  CONSTRAINT PK_TBAGRUPRELAT_TBEDITREL PRIMARY KEY (ID_TBAGRUPRELAT, ID_TBEDITREL));
CREATE TABLE TBEDITPARAM (ID SMALLINT NOT NULL PRIMARY KEY, ID_TBEDITREL INTEGER, PARAMETRO VARCHAR(50) NOT NULL,
  NOME VARCHAR(50) NOT NULL, TIPO SMALLINT, VALOR_DEFAULT VARCHAR(50), TIPO_DEFAULT SMALLINT, VISIVEL CHAR(1),
  ORDEM SMALLINT, ID_TBSMSCENARIO INTEGER);
CREATE TABLE TBEDITPESQ (ID_TBEDITPARAM SMALLINT NOT NULL PRIMARY KEY, BROWSER BLOB SUB_TYPE 1 NOT NULL,
  TIPO_RETORNO SMALLINT NOT NULL);
CREATE TABLE TBEDITQRP (ID_EDITREL INTEGER NOT NULL, NOMECOMP VARCHAR(150) NOT NULL, SEQUENCIA SMALLINT,
  NOMECLASSE VARCHAR(30) NOT NULL, COMPONENTE BLOB SUB_TYPE 1, CONTEUDO BLOB SUB_TYPE 1, PARENT VARCHAR(150) NOT NULL,
  FIELD_NAME VARCHAR(50), CONSTRAINT PK_TBEDITQRP PRIMARY KEY (ID_EDITREL, NOMECOMP));
CREATE TABLE TBEDITREL_AGENDA (ID_TBEDITREL INTEGER NOT NULL, HORARIO TIMESTAMP NOT NULL,
  DIAS_ESPECIFICOS VARCHAR(50), CONDICOES VARCHAR(50), EMAILS_DESTINO VARCHAR(255) NOT NULL,
  CONSTRAINT PK_TBEDITREL_AGENDA PRIMARY KEY (ID_TBEDITREL, HORARIO));
CREATE TABLE TBEDITREL_AGENDA_SITUACAO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(50));
CREATE TABLE TBEDITREL_GRUUSU (ID_EDITREL INTEGER NOT NULL, NOME_GRUPO VARCHAR(50) NOT NULL,
  CONSTRAINT PK_TBEDITREL_GRUUSU PRIMARY KEY (ID_EDITREL, NOME_GRUPO));
CREATE TABLE TBEDITREL_PRMODELOREL (ID_TBEDITREL INTEGER NOT NULL, ID_PRMODELOREL SMALLINT NOT NULL,
  CONSTRAINT PK_TBEDITREL_PRMODELOREL PRIMARY KEY (ID_TBEDITREL, ID_PRMODELOREL));
CREATE TABLE TBEDITREL_TBUSERS (ID_TBEDITREL INTEGER NOT NULL, USUARIO VARCHAR(31) NOT NULL,
  CONSTRAINT PK_TBEDITREL_TBUSERS PRIMARY KEY (ID_TBEDITREL, USUARIO));
CREATE TABLE TBOPCAOREL (ID INTEGER NOT NULL PRIMARY KEY, ID_TBMODULO INTEGER NOT NULL, ID_TBOPCOES INTEGER NOT NULL);
CREATE TABLE TBBTNOPREL (ID INTEGER NOT NULL PRIMARY KEY, ID_TBOPCAOREL INTEGER NOT NULL, BOTAO VARCHAR(20),
  ID_TBEDITREL INTEGER, ID_TBAGRUPRELAT SMALLINT);
CREATE TABLE TBPARAMOPREL (ID INTEGER NOT NULL PRIMARY KEY, ID_TBBTNOPREL INTEGER NOT NULL,
  NOME_COMPONENTE VARCHAR(15), PARAMETRO VARCHAR(50));
CREATE TABLE TBEDITREL_AGENDA_LOG (ID_TBEDITREL INTEGER NOT NULL, DATA_HORA_ENVIO TIMESTAMP NOT NULL,
  REMETENTE VARCHAR(100) NOT NULL, EMAILS_DESTINO VARCHAR(255) NOT NULL, ID_TBEDITREL_AGENDA_SITUACAO SMALLINT NOT NULL,
  CONTEUDO_EMAIL BLOB SUB_TYPE 1 NOT NULL, ANEXO_EMAIL BLOB SUB_TYPE 1, MENSAGEM_ERRO VARCHAR(255),
  CONSTRAINT PK_TBEDITREL_AGENDA_LOG PRIMARY KEY (ID_TBEDITREL, DATA_HORA_ENVIO));
"""
CARREGADAS = ("TBAGRUPRELAT", "TBEDITREL", "TBAGRUPRELAT_TBEDITREL", "TBEDITPARAM", "TBEDITREL_GRUUSU",
              "TBEDITREL_TBUSERS", "TBOPCAOREL")
NAO_CARREGADAS = ("PNCONFIGPORTAL", "TBEDITPESQ", "TBEDITQRP", "TBEDITREL_AGENDA", "TBEDITREL_AGENDA_SITUACAO",
                  "TBEDITREL_AGENDA_LOG", "TBEDITREL_PRMODELOREL", "TBBTNOPREL", "TBPARAMOPREL")
PAIS_EXTERNOS = {"TBMODULO": ["1", "2", "3"], "TBUSERS": ["rel.exemplo", "adm.exemplo"],
                 "TBGRUUSU": ["GRUPO EXEMPLO A", "GRUPO EXEMPLO B"]}
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento)")
CONSULTA = "SELECT campo_falso\r\n  FROM tabela_falsa\r\n WHERE   x = :DATA_INI"


def linhas(r, ins):
    # agrupamentos: 3 sem nome (1048), 4 com S/N inválido, 5 com código repetido do 1 (1062), 6 com S/N nulo
    for a in [(1, 10, "Agrupamento exemplo A", "S"), (2, 20, "  Agrupamento   exemplo B ", "N"), (3, 30, None, "S"),
              (4, 40, "Agrupamento exemplo D", "X"), (5, 10, "Agrupamento exemplo E", "N"),
              (6, 60, "Agrupamento exemplo F", None)]:
        ins("TBAGRUPRELAT", list(a))
    # relatórios: 2 versão 0 (padrão 1); 3 sem nome (recusa); 4 módulo nunca visto (recusa); 5 usuário nunca visto
    for e in [(1, 1, 1, "Relatório exemplo um", CONSULTA.encode("cp1252"), "rel.exemplo", 3, None),
              (2, 2, 1, "Relatório exemplo dois", b"SELECT 1 FROM tabela_falsa", "adm.exemplo", 0, 10),
              (3, 1, 2, None, b"SELECT 2", "rel.exemplo", 1, None),
              (4, 99, 1, "Relatório exemplo quatro", b"SELECT 4", "rel.exemplo", 1, None),
              (5, 3, 1, "Relatório exemplo cinco", None, "fantasma.exemplo", 2, None),
              (6, 3, 2, "Relatório exemplo seis", None, None, 1, None),
              (7, 2, 1, "  Relatório   exemplo   sete ", "Ação á é ç\r\n".encode("cp1252"), "adm.exemplo", 4, 11),
              (8, 1, 1, "Relatório exemplo oito", b"SELECT 8", "rel.exemplo", 1, None)]:
        ins("TBEDITREL", list(e))
    # itens de agrupamento: relatório 3 recusado (pai_pendente); agrupamento 3 recusado; relatório 99 nunca visto
    # (NOT NULL: recusa); ordem repetida no agrupamento 2 (1062)
    for g in [(1, 1, 1, None), (1, 2, 2, None), (2, 1, 1, None), (2, 7, 2, 5), (1, 3, 3, None), (3, 1, 1, None),
              (1, 99, 4, None), (2, 8, 1, None)]:
        ins("TBAGRUPRELAT_TBEDITREL", list(g))
    for p in [(1, 1, "DATA_INI", "Data inicial", 1, "01/01/2026", 0, "S", 1, None),
              (2, 1, "DATA_FIM", "Data  final", 1, None, 0, "S", 2, None),
              (3, 2, "SETOR", "Setor", 2, None, None, "N", None, None),
              (4, None, "SEM_RELATORIO", "Sem relatório", 2, None, None, "S", 1, None),
              (5, 3, "DATA_INI", "Data do recusado", 1, None, None, "S", 1, None),
              (6, 1, "DATA_INI", "Campo repetido", 1, None, None, "S", 3, None),
              (7, 8, "CONVENIO", "Convênio", 3, None, None, "S", 1, 7)]:
        ins("TBEDITPARAM", list(p))
    for u in [(1, "GRUPO EXEMPLO A"), (1, "GRUPO EXEMPLO B"), (2, "GRUPO EXEMPLO A"), (3, "GRUPO EXEMPLO A"),
              (1, "GRUPO FANTASMA")]:
        ins("TBEDITREL_GRUUSU", list(u))
    for u in [(1, "rel.exemplo"), (2, "adm.exemplo"), (3, "rel.exemplo"), (7, "fantasma.exemplo")]:
        ins("TBEDITREL_TBUSERS", list(u))
    for o in [(1, 1, 10), (2, 2, 11), (3, 99, 12)]:
        ins("TBOPCAOREL", list(o))
    # não carregadas (só presença na imagem; dados falsos)
    ins("PNCONFIGPORTAL", [1, 1, "Portal exemplo", b'{"cor": "azul"}'])
    ins("PNCONFIGPORTAL", [1, 2, "Portal exemplo dois", None])
    ins("TBEDITPESQ", [3, b"SELECT id, nome FROM tabela_falsa", 1])
    for i, c in enumerate(["Titulo", "Banda", "Campo"], 1):
        ins("TBEDITQRP", [1, "Componente%d" % i, i, "TClasseFalsa", b"prop=1", None, "Raiz", None])
    ins("TBEDITREL_AGENDA", [1, datetime.datetime(1899, 12, 30, 7, 30), "2,4", None, "destino@exemplo.invalid"])
    for i, n in [(1, "Enviado exemplo"), (2, "Falha exemplo")]:
        ins("TBEDITREL_AGENDA_SITUACAO", [i, n])
    ins("TBEDITREL_AGENDA_LOG", [1, datetime.datetime(2026, 1, 5, 7, 30), "origem@exemplo.invalid",
                                 "destino@exemplo.invalid", 1, b"Conteudo falso", None, None])
    ins("TBEDITREL_PRMODELOREL", [1, 1])
    ins("TBBTNOPREL", [1, 1, "Imprimir", 1, None])
    ins("TBBTNOPREL", [2, 1, "Agrupado", None, 1])
    ins("TBPARAMOPREL", [1, 1, "edtData", "DATA_INI"])
    ins("TBPARAMOPREL", [2, 1, "edtSetor", "SETOR"])
    return {
        "TBAGRUPRELAT": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1062": 1,
                                                       "valor_fora_do_dominio": 1}},
        "TBEDITREL": {"gravados": 6, "pendencias": {"restricao_destino_1048": 2, "pai_inexistente": 3,
                                                    "valor_presumido": 16}},
        "TBAGRUPRELAT_TBEDITREL": {"gravados": 4, "pendencias": {"pai_pendente": 2, "restricao_destino_1048": 1,
                                                                 "restricao_destino_1062": 1, "pai_inexistente": 1}},
        "TBEDITPARAM": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "pai_pendente": 1,
                                                      "restricao_destino_1062": 1, "valor_presumido": 6}},
        "TBEDITREL_GRUUSU": {"gravados": 3, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                           "restricao_destino_4025": 1}},
        "TBEDITREL_TBUSERS": {"gravados": 2, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                            "restricao_destino_4025": 1}},
        "TBOPCAOREL": {"gravados": 3, "pendencias": {"valor_presumido": 3, "pai_inexistente": 1}},
    }
