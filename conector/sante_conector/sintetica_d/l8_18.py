"""Fatia L8-18 (relatórios: catálogo, triagem, agrupamentos, parâmetros e permissões): imagem sintética.

Dados 100% falsos (nomes e logins inventados, e-mails em domínio .invalid). 12 tabelas carregadas; 4 ficam na
imagem e são descartadas com motivo de produto (declarado/sem_carga.tsv; decisões em F4-decisoes-destino.md).
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
- parâmetro oculto (VISIVEL='N', id 3) entra com visivel = FALSE (coluna do modelo, 19_REL/04);
- portal de configuração de painel nunca vista (PNCONFIG 2): pai_inexistente pela ligação ao painel de chamada;
- módulo nunca visto numa linha com dois destinos: pai_inexistente uma vez por destino (TBEDITREL 4: 2 + 5: 1);
- vínculo opcional do relatório com a tela do menu (relatorio_tela): tela nunca vista não grava o vínculo nem recusa
  o relatório (TBEDITREL 8: pai_inexistente);
- rodada de cobertura: pesquisa ligada ao parâmetro por complemento (pai recusado ou nunca visto), agendamento com
  nome e dono pela referência encadeada ao relatório (nome repetido, criador desconhecido, lista de e-mails longa),
  log de envio pela chave alternativa (dois agendamentos do relatório: pai_ambiguo; situação pelo nome da lista
  fixa, sem par ou sem conexão sem mensagem), botão pela
  tela da opção (encadeada; tela nunca vista, só agrupamento, sem rótulo) e parâmetro do botão pelo nome (repetido:
  pai_ambiguo).
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
              "TBEDITREL_TBUSERS", "TBOPCAOREL", "TBEDITPESQ", "TBEDITREL_AGENDA", "TBEDITREL_AGENDA_LOG",
              "TBBTNOPREL", "TBPARAMOPREL", "PNCONFIGPORTAL", "TBEDITQRP", "TBEDITREL_PRMODELOREL",
              "TBEDITREL_AGENDA_SITUACAO")
# descartadas com motivo de produto em declarado/sem_carga.tsv (ficam na imagem e não são carregadas)
NAO_CARREGADAS = ()
# recusa da linha por regra que não é restrição nem pai_pendente (complemento sem pai: pai_inexistente)
RECUSAS_POR_REGRA = {"TBEDITPESQ": {"pai_inexistente": 1}}
PAIS_EXTERNOS = {"TBMODULO": ["1", "2", "3"], "TBUSERS": ["rel.exemplo", "adm.exemplo"],
                 "TBGRUUSU": ["GRUPO EXEMPLO A", "GRUPO EXEMPLO B"], "TBOPCOES": ["10", "11"], "PRMODELOREL": ["1"],
                 "PNCONFIG": ["1"]}
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento)")
CONSULTA = "SELECT campo_falso\r\n  FROM tabela_falsa\r\n WHERE   x = :DATA_INI"


def linhas(r, ins):
    # agrupamentos: 3 sem nome (1048), 4 com S/N inválido, 5 com código repetido do 1 (1062), 6 com S/N nulo
    for a in [(1, 10, "Agrupamento exemplo A", "S"), (2, 20, "  Agrupamento   exemplo B ", "N"), (3, 30, None, "S"),
              (4, 40, "Agrupamento exemplo D", "X"), (5, 10, "Agrupamento exemplo E", "N"),
              (6, 60, "Agrupamento exemplo F", None)]:
        ins("TBAGRUPRELAT", list(a))
    # relatórios: 2 versão 0 (padrão 1); 3 sem nome (recusa); 4 módulo nunca visto (recusa); 5 usuário nunca visto;
    # 2 e 7 com tela (vínculo relatorio_tela opcional); 8 com tela nunca vista (pai_inexistente, o relatório entra)
    for e in [(1, 1, 1, "Relatório exemplo um", CONSULTA.encode("cp1252"), "rel.exemplo", 3, None),
              (2, 2, 1, "Relatório exemplo dois", b"SELECT 1 FROM tabela_falsa", "adm.exemplo", 0, 10),
              (3, 1, 2, None, b"SELECT 2", "rel.exemplo", 1, None),
              (4, 99, 1, "Relatório exemplo quatro", b"SELECT 4", "rel.exemplo", 1, None),
              (5, 3, 1, "Relatório exemplo cinco", None, "fantasma.exemplo", 2, None),
              (6, 3, 2, "Relatório exemplo seis", None, None, 1, None),
              (7, 2, 1, "  Relatório   exemplo   sete ", "Ação á é ç\r\n".encode("cp1252"), "adm.exemplo", 4, 11),
              (8, 1, 1, "Relatório exemplo oito", b"SELECT 8", "rel.exemplo", 1, 99)]:
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
    # ADR 0006: portal do painel (um painel por configuração, páginas na lista JSON), leiaute do relatório (uma versão
    # por relatório, componentes na lista JSON; relatório 3 recusado: pai_pendente; 99 nunca visto: 3 pai_inexistente
    # e 1048) e relatório como
    # modelo de impressão (tipo 2 nunca visto: pai_inexistente + 1048; relatório 3 sem nome: 1048 pelo nome encadeado)
    ins("PNCONFIGPORTAL", [1, 1, "Portal exemplo", b'{"cor": "azul"}'])
    ins("PNCONFIGPORTAL", [1, 2, "Portal exemplo dois", None])
    ins("PNCONFIGPORTAL", [2, 1, "Portal exemplo tres", "Configura\xe7\xe3o".encode("cp1252")])
    for i, c in enumerate(["Titulo", "Banda", "Campo"], 1):
        ins("TBEDITQRP", [1, "Componente%d" % i, i, "TClasseFalsa", b"prop=1", None, "Raiz", None])
    ins("TBEDITQRP", [2, "Componente1", 1, "TClasseFalsa", None, "Conte\xfado".encode("cp1252"), "Raiz", "CAMPO"])
    ins("TBEDITQRP", [3, "Componente1", 1, "TClasseFalsa", None, None, "Raiz", None])
    ins("TBEDITQRP", [99, "Componente1", 1, "TClasseFalsa", None, None, "Raiz", None])
    # lista fixa de situações: o de-para é pelo NOME (variantes de caixa e acento), nunca pela ordem do código
    for i, n in [(1, "Enviado"), (2, "Não conectado"), (3, "NAO ENVIADO"), (4, "Outro exemplo")]:
        ins("TBEDITREL_AGENDA_SITUACAO", [i, n])
    for m in [(1, 1), (3, 1), (2, 2)]:
        ins("TBEDITREL_PRMODELOREL", list(m))
    # pesquisas: 3 e 1 ligadas ao parâmetro (UPDATE); 5 parâmetro recusado (pai_pendente); 9 parâmetro nunca visto
    # (complemento sem pai: recusa pai_inexistente); entidade e campo presumidos (2 por linha não recusada)
    for q in [(3, b"SELECT id, nome FROM tabela_falsa", 1), (1, b"SELECT data FROM tabela_falsa", 2),
              (5, b"SELECT 5", 1), (9, b"SELECT 9", 1)]:
        ins("TBEDITPESQ", list(q))
    # agendamentos: rel 1 07:30 e rel 2 gravados (rel 2 com lista longa: texto_resumido); rel 1 19:00 com o mesmo
    # nome (1062); rel 5 sem criador conhecido (dono pai_inexistente + 1048); rel 3 recusado (pai_pendente);
    # periodicidade e tipo do destinatário presumidos (2 por linha não recusada em _valores: 4 x 2 = 8)
    lista = ";".join("d%02d@exemplo.invalid" % i for i in range(12))
    lista = "d00" + "x" * (255 - len(lista)) + lista[3:]
    assert len(lista) == 255 and lista.endswith(".invalid")
    hora = lambda h, m: datetime.datetime(1899, 12, 30, h, m)  # noqa: E731
    for a in [(1, hora(7, 30), "2,4", None, "destino@exemplo.invalid"),
              (2, hora(8, 0), None, "SO_COM_LINHAS", lista),
              (1, hora(19, 0), None, None, "noite@exemplo.invalid"),
              (5, hora(6, 0), None, None, "cinco@exemplo.invalid"),
              (3, hora(7, 0), None, None, "tres@exemplo.invalid")]:
        ins("TBEDITREL_AGENDA", list(a))
    # log de envio do rel 2 (um agendamento): enviado, sem conexão com mensagem e não enviado gravados; sem conexão
    # sem mensagem (CHECK: 4025); situação de nome sem par (valor_fora_do_dominio + 1048); situação 9 fora da lista
    # (pai_inexistente + 1048); rel 1 com dois agendamentos (pai_ambiguo + 1048); rel 5 agendamento recusado
    # (pai_pendente); rel 8 sem agendamento (pai_inexistente + 1048)
    dia = lambda d: datetime.datetime(2026, 1, d, 7, 30)  # noqa: E731
    for g in [(2, dia(5), 1, None), (2, dia(6), 2, "Falha exemplo de conexao"), (2, dia(8), 3, None),
              (2, dia(9), 2, None), (2, dia(10), 4, None), (1, dia(5), 1, None),
              (5, dia(5), 1, None), (8, dia(5), 1, None), (2, dia(7), 9, None)]:
        ins("TBEDITREL_AGENDA_LOG", [g[0], g[1], "origem@exemplo.invalid", "destino@exemplo.invalid", g[2],
                                     b"Conteudo falso", None, g[3]])
    # botões: 1 e 5 gravados; 2 só de agrupamento (gravado pelo agrupamento, r5); 3 tela nunca vista pela opção 3 (pai_inexistente + 1048);
    # 4 sem rótulo (1048); 6 relatório recusado (pai_pendente)
    for b in [(1, 1, "Imprimir", 1, None), (2, 1, "Agrupado", None, 1), (3, 3, "Imprimir", 2, None),
              (4, 2, None, 7, None), (5, 2, "Rel oito", 8, None), (6, 1, "Rel tres", 3, None)]:
        ins("TBBTNOPREL", list(b))
    # parâmetros do botão: DATA_INI repetido em relatórios (pai_ambiguo + 1048); nome inexistente (pai_inexistente +
    # 1048); SETOR do botão 2 (de agrupamento, gravado desde a r5); CONVENIO e DATA_FIM únicos, gravados
    for q in [(1, 1, "edtData", "DATA_INI"), (2, 5, "edtConvenio", "CONVENIO"), (3, 5, "edtFalta", "INEXISTENTE"),
              (4, 2, "edtSetor", "SETOR"), (5, 1, "edtFim", "DATA_FIM")]:
        ins("TBPARAMOPREL", list(q))
    return {
        "PNCONFIGPORTAL": {"gravados": 3, "pendencias": {"adotado_existente": 2, "pai_inexistente": 1}},
        "TBEDITQRP": {"gravados": 4, "pendencias": {"pai_pendente": 1, "pai_inexistente": 3,
                                                    "restricao_destino_1048": 1}},
        # (1,1) grava com o leiaute do relatório 1 copiado de relatorio_versao; (3,1) relatório 3 recusado: o leiaute
        # dele também, pai_pendente; (2,2) tipo nunca visto: pai_inexistente + 1048
        "TBEDITREL_PRMODELOREL": {"gravados": 1, "pendencias": {"pai_inexistente": 1, "pai_pendente": 1,
                                                                "restricao_destino_1048": 1}},
        "TBAGRUPRELAT": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1062": 1,
                                                       "valor_fora_do_dominio": 1}},
        "TBEDITREL": {"gravados": 6, "pendencias": {"restricao_destino_1048": 2, "pai_inexistente": 4,
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
        "TBEDITPESQ": {"gravados": 2, "pendencias": {"valor_presumido": 4, "pai_pendente": 1, "pai_inexistente": 1}},
        # periodicidade presumida só com dias específicos ("2,4"); sem eles diária é fato
        "TBEDITREL_AGENDA": {"gravados": 2, "pendencias": {"valor_presumido": 5, "texto_resumido": 1,
                                                           "restricao_destino_1062": 1, "pai_inexistente": 1,
                                                           "restricao_destino_1048": 1, "pai_pendente": 1}},
        "TBEDITREL_AGENDA_LOG": {"gravados": 3, "pendencias": {"pai_ambiguo": 1, "pai_pendente": 1,
                                                               "pai_inexistente": 2, "valor_fora_do_dominio": 1,
                                                               "restricao_destino_1048": 4,
                                                               "restricao_destino_4025": 1}},
        "TBBTNOPREL": {"gravados": 3, "pendencias": {"restricao_destino_1048": 2, "pai_inexistente": 1,
                                                     "pai_pendente": 1}},
        "TBPARAMOPREL": {"gravados": 3, "pendencias": {"pai_ambiguo": 1, "pai_inexistente": 1,
                                                       "restricao_destino_1048": 2}},
        "TBEDITREL_AGENDA_SITUACAO": {"gravados": 4, "pendencias": {"adotado_existente": 6}},
    }
