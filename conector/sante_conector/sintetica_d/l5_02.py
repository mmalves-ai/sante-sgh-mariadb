"""Fatia L5-02 (cadastros e administração, módulo ADM): tabelas da origem com os mesmos nomes e tipos do dicionário e
dados 100% falsos.

Carregadas pelo mapa (15): modelo de leitor biométrico, motivo de anonimização (base legal, descrição resumida),
função do responsável de proteção de dados, papel de segurança (origem 'migracao', limite 0 = sem limite), tipo de
termo, mensagem interna (mensagem + destinatário, remetente e destinatário pelo login, estabelecimento único,
prioridade pelo tipo), nível de criticidade (severidade pelo nome do nível), tipo de certificado (modalidade e
repositório pelo nome), como referência histórica inativa, módulo, opção de menu (tela + ação de acesso) e evento,
as concessões antigas papel x opção e perfil x opção (ação de ACESSO da opção: destino secundário do pai,
`ref:TBOPCOES/acao_sistema`) e a permissão SUS (uma linha por indicador S/N, desdobrada no destino principal, com a
negação explícita) e o último acesso de cada usuário por módulo (usuário e módulo legado pela chave, só a data:
hora 00:00). As outras 5 entram na imagem para provar que nada delas é gravado: descarte de produto
(situação do termo, tipo de signatário e tipo de OID: domínio fixo do modelo; cópia de segurança:
infraestrutura).
Anomalias: nome vazio e nulo (NOT NULL no destino: recusa só a linha), descrição longa (resumida, texto integral na
explicação), código repetido (1062), S/N fora do domínio (padrão do destino), espaços internos, quebra de linha,
acentos CP1252, lacunas; mensagem repetida (sem chave: duas mensagens), destinatário nunca visto (pai_inexistente),
sem remetente, sem texto e sem data de envio (recusa só a linha); nível sem par na escala e nível com a mesma
severidade de outro; tipo de certificado sem par; módulo vazio e opção de módulo recusado ou sem módulo; concessão
de papel recusado (pai_pendente), de opção recusada (sem ação de acesso) ou de opção ou grupo nunca vistos (pai_inexistente + 1048); permissão SUS
de usuário nunca visto, sem nenhum indicador (sem_item_a_gravar) e repetida para o mesmo usuário (1062).
"""
import datetime

FLAGS_SUS = ["AIH_CONTAS_INC", "AIH_CONTAS_ALT", "AIH_CONTAS_EXC", "AIH_CONTAS_EXAMES", "AIH_CONTAS_DADOS_CPL",
             "AIH_BOL_INC", "AIH_BOL_ALT", "AIH_BOL_EXC", "AIH_BOL_OPM", "AIH_BOL_EXAMES", "AIH_IRREG_INC",
             "AIH_IRREG_ALT", "AIH_IRREG_EXC", "AIH_EMISSAO_EMITIR", "AIH_EMISSAO_EXC_STATUS", "AIH_EMISSAO_REEMITIR",
             "AIH_ARQ_CRIAR", "AIH_ARQ_CONSULTAR", "AIH_ARQ_RELACAO", "AIH_FEC_FAT_INC", "AIH_FEC_FAT_EXC",
             "AIH_FEC_FAT_APRES", "AIH_FEC_FAT_CANC_APRES", "AIH_FEC_MENSAL_INC", "AIH_FEC_MENSAL_CANC",
             "AIH_ACERTAR_SADT", "AIH_ACERTAR_CREDOR", "AIH_INTEG_REPASSE", "AIH_PGTO_INTERV", "AIH_EXC_REP_GRT",
             "AIH_REL_FAT_MENSAL", "AIH_REL_SP_HM_SINT", "AIH_REL_PROC_ESP_ANALIT", "AIH_UTIL_FEC_FAT_FIN"]

DDL = """
CREATE TABLE TBLEITORBIOME (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE TBLGPDANONMOT (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(999) NOT NULL, ATIVO CHAR(1) NOT NULL);
CREATE TABLE TBLGPDANONUSERFUNCAO (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(60) NOT NULL,
  ATIVO CHAR(1) NOT NULL);
CREATE TABLE TBMENSAG (USUARIO VARCHAR(31) NOT NULL, SEQ INTEGER NOT NULL, MENSAGEM VARCHAR(200), ORIGEM VARCHAR(31),
  TIPO VARCHAR(1), DATA_HORA_ENVIO TIMESTAMP, DATA_HORA_LEITURA TIMESTAMP, ID_TBMENSAG_AGENDADA INTEGER);
CREATE TABLE TBMODULO (ID SMALLINT NOT NULL PRIMARY KEY, SISTEMA VARCHAR(3) NOT NULL, NOME VARCHAR(45) NOT NULL,
  TITULO_JANELA VARCHAR(150), BOTAO_TAREFA VARCHAR(150), DESCRICAO_TELA_ABERTURA VARCHAR(120),
  RESUMO_FUNCIONALIDADE VARCHAR(280), EXECUTAVEL VARCHAR(25));
CREATE TABLE TBMOVTERMSTATUS (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(60) NOT NULL, ATIVO CHAR(1) NOT NULL);
CREATE TABLE TBNVLCRITICID (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE TBOPCOES (ID INTEGER NOT NULL PRIMARY KEY, MODULO SMALLINT, INDICE SMALLINT, NIVEL SMALLINT,
  NOME VARCHAR(65), TITULO VARCHAR(60), DETALHE_FUNCIONALIDADE_AUDIT VARCHAR(255), OLD_ID_TBTPACAOAUDIT SMALLINT,
  ATIVO CHAR(1), OPCAO_AVULSA CHAR(1), OLD_ID_TBNVLCRITICID INTEGER);
CREATE TABLE TBEVENTOS (ID INTEGER NOT NULL PRIMARY KEY, ID_TBOPCOES INTEGER NOT NULL, NOME VARCHAR(50) NOT NULL);
CREATE TABLE TBPAPEL (ID SMALLINT NOT NULL PRIMARY KEY, COD_PAPEL SMALLINT NOT NULL, NOME VARCHAR(50),
  QTDE_MAX_USUARIO_VINC SMALLINT);
CREATE TABLE TBPAPEL_TBOPCOES (ID_TBPAPEL SMALLINT NOT NULL, ID_TBOPCOES INTEGER NOT NULL,
  CONSTRAINT PK_TBPAPEL_TBOPCOES PRIMARY KEY (ID_TBPAPEL, ID_TBOPCOES));
CREATE TABLE TBPERMISSAO_SUS (ID INTEGER NOT NULL PRIMARY KEY, ID_TBUSERS VARCHAR(31) NOT NULL, %s);
CREATE TABLE TBPERUSU (GRUPO VARCHAR(50) NOT NULL, ID_TBOPCOES INTEGER NOT NULL,
  CONSTRAINT PK_TBPERUSU PRIMARY KEY (GRUPO, ID_TBOPCOES));
CREATE TABLE TBPROCBACKUP (ID INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(30) NOT NULL);
CREATE TABLE TBSGHCONEXAO (MODULO SMALLINT NOT NULL, USUARIO VARCHAR(31) NOT NULL, DATA_ULTIMA_CONEXAO DATE NOT NULL,
  ENVIADO CHAR(1), CONSTRAINT PK_TBSGHCONEXAO PRIMARY KEY (MODULO, USUARIO));
CREATE TABLE TBSITBACKUP (ID INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(30) NOT NULL);
CREATE TABLE TBTERMCONREVTP (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(60) NOT NULL, ATIVO CHAR(1) NOT NULL);
CREATE TABLE TBTIPOCERTIFICADO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL, ATIVO CHAR(1) NOT NULL);
CREATE TABLE TBTIPOOID (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE TBTIPOREPRE (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(60) NOT NULL, ATIVO CHAR(1) NOT NULL);
""" % ", ".join("%s CHAR(1)" % c for c in FLAGS_SUS)

NAO_CARREGADAS = ["TBPROCBACKUP", "TBSITBACKUP", "TBTIPOOID", "TBTIPOREPRE"]
CARREGADAS = ["TBLEITORBIOME", "TBLGPDANONMOT", "TBLGPDANONUSERFUNCAO", "TBMENSAG", "TBNVLCRITICID", "TBPAPEL",
              "TBTERMCONREVTP", "TBTIPOCERTIFICADO", "TBMODULO", "TBOPCOES", "TBEVENTOS", "TBPAPEL_TBOPCOES",
              "TBPERUSU", "TBPERMISSAO_SUS", "TBSGHCONEXAO", "TBMOVTERMSTATUS"]
DESCARTE = list(NAO_CARREGADAS)  # descarte de produto (sem_carga.tsv) com prova (provas.tsv; r5, ADR 0006)

PAIS_EXTERNOS = {"TBUSERS": ["usuario1", "usuario2", "usuario3"], "TBGRUUSU": ["Grupo A", "Grupo B"]}
# permissão SUS: (ID, login, indicadores); None = sem indicador (não gera linha), N = negação explícita (gera linha)
_SN = ["S", "N", None, "s"]
PERMISSOES_SUS = [(1, "usuario1", [_SN[i % 4] for i in range(len(FLAGS_SUS))]),
                  (2, "usuario2", ["S"] * len(FLAGS_SUS)),
                  (3, "usuario3", [None] * len(FLAGS_SUS)),           # nenhum indicador: sem_item_a_gravar
                  (4, "usuario9", ["S"] * 3 + [None] * (len(FLAGS_SUS) - 3)),  # nunca visto: pai_inexistente + 1048
                  (5, "usuario2", ["N"] + [None] * (len(FLAGS_SUS) - 1))]     # mesmo usuário e regra: 1062
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')")

LEITORES = [(1, "Leitor  óptico   modelo A"), (2, "Leitor capacitivo"), (4, "   ")]
MOTIVOS = [(1, "Tutela da saúde", "S"), (2, "Obrigação legal ou regulatória", "N"),
           (3, "Pesquisa por órgão de estudo " + "com anonimização sempre que possível " * 5, "S"),
           (5, "  Exercício regular de direitos\r\nem processo  ", "X")]
FUNCOES = [(1, "Encarregado", "S"), (2, "Substituto do encarregado", "N"), (3, "Comitê de privacidade", "s")]
MODULOS = [(1, "Recepção  e   internação"), (2, "Prontuário"), (3, "Faturamento"), (5, "   "), (8, "Farmácia"),
           (13, "Administração")]
# a chave NÃO é a severidade (1..8 na origem): a severidade sai do nome; 5 repete a severidade de 3 (1062);
# 9 não tem par na escala (valor_fora_do_dominio + 1048)
NIVEIS = [(1, "Emergência"), (2, "ALERTA"), (3, "Crítico"), (4, "Erro"), (8, "Depuração"), (5, "Critico"),
          (9, "Nível  sem par")]
CERTIFICADOS = [(1, "A1", "S"), (2, "A3", "S"), (3, "Em nuvem", "N"), (4, "Modelo sem par", "S")]
PAPEIS = [(1, 10, "Médico"), (2, 20, "Enfermagem"), (3, 30, None), (4, 10, "Papel repetido"), (5, 50, "Farmácia")]
TERMOS = [(1, "Consentimento de tratamento", "S"), (2, "Revogação de consentimento", "N"), (4, "Anonimização", "S")]
# último acesso (módulo, login, data, enviado): 5 = módulo recusado (pai_pendente); usuario9 e módulo 99 nunca vistos
# (pai_inexistente + 1048); ENVIADO sem destino (fora do domínio não pesa)
CONEXOES = [(1, "usuario1", datetime.date(2026, 3, 1), "N"), (2, "usuario1", datetime.date(2026, 3, 2), "S"),
            (1, "usuario2", datetime.date(2012, 5, 7), None), (3, "usuario3", datetime.date(2026, 2, 10), "X"),
            (5, "usuario2", datetime.date(2026, 1, 4), "N"),
            (1, "usuario9", datetime.date(2026, 1, 5), "N"),
            (99, "usuario1", datetime.date(2026, 1, 6), "N")]
# opções: 7 sem título (1048), 11 com ordem negativa (padrão 0), 9 com S/N fora do domínio (coluna sem destino);
# 31 do módulo recusado (pai_pendente), 32 sem módulo (1048)
OPCOES_SEM_TITULO, OPCAO_NEGATIVA, OPCAO_SN_INVALIDO = 7, 11, 9


def linhas(r, ins):
    for row in LEITORES:
        ins("TBLEITORBIOME", list(row))
    for row in MOTIVOS:
        ins("TBLGPDANONMOT", list(row))
    for row in FUNCOES:
        ins("TBLGPDANONUSERFUNCAO", list(row))
    t0 = datetime.datetime(2026, 2, 1, 9, 0)
    h = lambda n: t0 + datetime.timedelta(hours=n)  # noqa: E731
    msgs = [["usuario1", 1, "Reunião  às 10h na sala 2", "usuario2", "N", h(1), h(2)],
            ["usuario2", 1, "Mensagem ainda não lida", "usuario1", "N", h(3), None],
            ["usuario1", 2, "Linha um\r\nlinha dois", "usuario3", "U", h(4), h(5)],
            ["usuario1", 1, "Reunião  às 10h na sala 2", "usuario2", "N", h(1), h(2)],  # repetida: duas mensagens
            ["usuario9", 1, "Destinatário nunca visto", "usuario1", "N", h(6), None],   # pai_inexistente + 1048
            ["usuario2", 2, None, "usuario1", "N", h(7), None],                         # sem texto: 1048
            ["usuario3", 1, "Aviso do sistema", None, "S", h(8), None],                 # sem remetente: 1048
            ["usuario3", 2, "Sem data de envio", "usuario2", "N", None, None]]          # CHECK de envio: 4025
    for m in msgs:
        ins("TBMENSAG", m + [None])
    for i, nome in MODULOS:
        ins("TBMODULO", [i, "SGH", nome, "Janela do módulo %d" % i, "Botão %d" % i, "Abertura do módulo %d" % i,
                         ("Resumo do módulo %d. " % i) * (12 if i == 13 else 1), "modulo%d.exe" % i])
    for i, d in [(1, "Emitido"), (2, "Autorizado"), (3, "Revogado"), (4, "Em análise")]:
        ins("TBMOVTERMSTATUS", [i, d, "S"])
    for row in NIVEIS:
        ins("TBNVLCRITICID", list(row))
    opcoes = [i for i in range(1, 31) if i % 6]  # lacunas na chave
    for i in opcoes:
        titulo = None if i == OPCOES_SEM_TITULO else "Opção  de menu %d" % i
        indice = -1 if i == OPCAO_NEGATIVA else i * 10
        ativo = "X" if i == OPCAO_SN_INVALIDO else (None if i == 13 else "SN"[i % 4 == 0])
        ins("TBOPCOES", [i, 1 + i % 3, indice, 1 + i % 2, "mnuOpcao%d" % i, titulo, "Detalhe %d" % i,
                         None, ativo, "N", None])
    ins("TBOPCOES", [31, 5, 310, 1, "mnuOpcao31", "Opção do módulo vazio", None, None, "S", "S", None])
    ins("TBOPCOES", [32, None, 320, 1, "mnuOpcao32", "Opção sem módulo", None, None, "S", None, None])
    for i, o in [(1, 1), (2, 2), (3, 3), (4, OPCOES_SEM_TITULO)]:
        ins("TBEVENTOS", [i, o, "Evento %d" % i])
    for row in PAPEIS:
        ins("TBPAPEL", list(row) + [r.choice([None, 0, 3])])
    pares = [(1, 1), (1, 2), (1, 3), (2, 1), (2, 4), (5, 8), (5, 10),
             (3, 1),            # papel recusado (nome nulo): pai_pendente
             (4, 2),            # papel recusado (código repetido): pai_pendente
             (2, OPCOES_SEM_TITULO),  # opção recusada: sem ação de acesso, pai_inexistente + 1048
             (1, 9999)]         # opção inexistente: NULL na coluna NOT NULL
    for p in pares:
        ins("TBPAPEL_TBOPCOES", list(p))
    for i, u, fl in PERMISSOES_SUS:
        ins("TBPERMISSAO_SUS", [i, u] + fl)
    for g, o in [("Grupo A", 1), ("Grupo A", 2), ("Grupo B", 3), ("Grupo B", 4),
                 ("Grupo B", OPCOES_SEM_TITULO),  # opção recusada: sem ação de acesso, pai_inexistente + 1048
                 ("Grupo C", 1),                  # grupo nunca visto: pai_inexistente + 1048
                 ("Grupo A", 9999)]:              # opção inexistente: pai_inexistente + 1048
        ins("TBPERUSU", [g, o])
    for i, d in [(1, "Cópia"), (2, "Restauração")]:
        ins("TBPROCBACKUP", [i, d])
    for row in CONEXOES:
        ins("TBSGHCONEXAO", list(row))
    for i, d in [(1, "Concluído"), (2, "Falhou"), (3, "Em andamento"), (4, "Cancelada")]:
        ins("TBSITBACKUP", [i, d])
    for row in TERMOS:
        ins("TBTERMCONREVTP", list(row))
    for row in CERTIFICADOS:
        ins("TBTIPOCERTIFICADO", list(row))
    for i, d in [(1, "Política"), (2, "CPF"), (3, "CNPJ"), (4, "Nome"), (5, "Data de nascimento"),
                 (6, "Título de eleitor"), (7, "Registro no conselho"), (8, "UF do conselho"), (9, "Especialidade"),
                 (10, "CNES")]:
        ins("TBTIPOOID", [i, d])
    for i, d in [(1, "Titular"), (2, "Representante legal")]:
        ins("TBTIPOREPRE", [i, d, "S"])
    return {
        # r5: rótulo sem par (Em análise): etapa pendente presumida, final e autoriza no padrão
        "TBMOVTERMSTATUS": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 3, "valor_presumido": 1}},
        "TBLEITORBIOME": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        "TBLGPDANONMOT": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1, "texto_resumido": 1}},
        "TBMENSAG": {"gravados": 4, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 3,
                                                   "restricao_destino_4025": 1}},
        "TBNVLCRITICID": {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1,
                                                        "restricao_destino_1062": 1}},
        "TBTIPOCERTIFICADO": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 2, "restricao_destino_1048": 1}},
        "TBMODULO": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1}},
        "TBOPCOES": {"gravados": 24, "pendencias": {"restricao_destino_1048": 2, "pai_pendente": 1,
                                                   "valor_fora_do_dominio": 1}},
        "TBEVENTOS": {"gravados": 3, "pendencias": {"valor_presumido": 3, "pai_pendente": 1}},
        "TBLGPDANONUSERFUNCAO": {"gravados": 3, "pendencias": {}},
        "TBPAPEL": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1062": 1}},
        "TBTERMCONREVTP": {"gravados": 3, "pendencias": {}},
        # opção recusada: a ação de acesso (secundário) nunca foi gravada, a referência ao secundário dá
        # pai_inexistente (não pai_pendente) e a NOT NULL recusa a concessão
        "TBPAPEL_TBOPCOES": {"gravados": 7, "pendencias": {"pai_pendente": 2, "pai_inexistente": 2,
                                                           "restricao_destino_1048": 2}},
        "TBPERUSU": {"gravados": 4, "pendencias": {"pai_inexistente": 3, "restricao_destino_1048": 3}},
        # gravados = itens (uma linha por indicador preenchido): 26 do usuário 1 (S, N, s) + 34 do usuário 2
        "TBSGHCONEXAO": {"gravados": 4, "pendencias": {"pai_pendente": 1, "pai_inexistente": 2,
                                                       "restricao_destino_1048": 2}},
        "TBPERMISSAO_SUS": {"gravados": 60, "pendencias": {"sem_item_a_gravar": 1, "pai_inexistente": 1,
                                                           "restricao_destino_1048": 1,
                                                           "restricao_destino_1062": 1}},
    }
