"""Fatia L5-02 (cadastros e administração, módulo ADM): tabelas da origem com os mesmos nomes e tipos do dicionário e
dados 100% falsos.

Carregadas pelo mapa: modelo de leitor biométrico, motivo de anonimização (base legal), função do responsável de
proteção de dados, papel de segurança (origem 'migracao') e tipo de termo.
As outras 15 entram na imagem para provar que nada delas é gravado. Módulo, opção de menu e papel x opção ficam fora
até a decisão do destino: módulo e ação do sistema são catálogos do produto (o carregador de ações inativa o que não
está no contrato, e o código numérico da origem não concede nada). As demais: o destino exige o que a linha não tem
(referência por login ou por número sem referência gerada, estabelecimento, uma linha por permissão, OID, severidade)
ou são domínios de valor (situação do termo, processo e situação da cópia de segurança). Pedidos em
docs/obra/fatias/f4/saida/L5-02.json.
Anomalias: nome vazio e nulo (NOT NULL no destino: recusa só a linha), descrição longa (inteira na explicação, sem
recusa), código repetido (1062), S/N fora do domínio (padrão do destino), espaços internos, quebra de linha, acentos
CP1252, lacunas.
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
CREATE TABLE TBDIGITAR_FILIACAO (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(10) NOT NULL);
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
""" % ", ".join("%s CHAR(1)" % c for c in FLAGS_SUS)

NAO_CARREGADAS = ["TBDIGITAR_FILIACAO", "TBMENSAG", "TBMODULO", "TBMOVTERMSTATUS", "TBNVLCRITICID", "TBOPCOES",
                  "TBEVENTOS", "TBPAPEL_TBOPCOES",
                  "TBPERMISSAO_SUS", "TBPERUSU", "TBPROCBACKUP", "TBSGHCONEXAO", "TBSITBACKUP", "TBTIPOCERTIFICADO",
                  "TBTIPOOID"]
CARREGADAS = ["TBLEITORBIOME", "TBLGPDANONMOT", "TBLGPDANONUSERFUNCAO", "TBPAPEL", "TBTERMCONREVTP"]

LEITORES = [(1, "Leitor  óptico   modelo A"), (2, "Leitor capacitivo"), (4, "   ")]
MOTIVOS = [(1, "Tutela da saúde", "S"), (2, "Obrigação legal ou regulatória", "N"),
           (3, "Pesquisa por órgão de estudo " + "com anonimização sempre que possível " * 5, "S"),
           (5, "  Exercício regular de direitos\r\nem processo  ", "X")]
FUNCOES = [(1, "Encarregado", "S"), (2, "Substituto do encarregado", "N"), (3, "Comitê de privacidade", "s")]
MODULOS = [(1, "Recepção  e   internação"), (2, "Prontuário"), (3, "Faturamento"), (5, "   "), (8, "Farmácia"),
           (13, "Administração")]
PAPEIS = [(1, 10, "Médico"), (2, 20, "Enfermagem"), (3, 30, None), (4, 10, "Papel repetido"), (5, 50, "Farmácia")]
TERMOS = [(1, "Consentimento de tratamento", "S"), (2, "Revogação de consentimento", "N"), (4, "Anonimização", "S")]
# opções (não carregadas): 7 sem título, 11 com ordem negativa, 9 com S/N fora do domínio
OPCOES_SEM_TITULO, OPCAO_NEGATIVA, OPCAO_SN_INVALIDO = 7, 11, 9


def linhas(r, ins):
    for i, d in [(1, "MAE"), (2, "PAI"), (3, "RESP")]:
        ins("TBDIGITAR_FILIACAO", [i, d])
    for row in LEITORES:
        ins("TBLEITORBIOME", list(row))
    for row in MOTIVOS:
        ins("TBLGPDANONMOT", list(row))
    for row in FUNCOES:
        ins("TBLGPDANONUSERFUNCAO", list(row))
    base = datetime.datetime(2026, 2, 1, 9, 0)
    for s in range(1, 6):
        ins("TBMENSAG", ["usuario%d" % (s % 2 + 1), s, "Mensagem de teste %d" % s, "usuario3", "N",
                         base + datetime.timedelta(hours=s), None, None])
    for i, nome in MODULOS:
        ins("TBMODULO", [i, "SGH", nome, "Janela do módulo %d" % i, "Botão %d" % i, "Abertura do módulo %d" % i,
                         ("Resumo do módulo %d. " % i) * (12 if i == 13 else 1), "modulo%d.exe" % i])
    for i, d in [(1, "Emitido"), (2, "Autorizado"), (3, "Revogado")]:
        ins("TBMOVTERMSTATUS", [i, d, "S"])
    for i, d in [(1, "Baixa"), (2, "Média"), (3, "Alta")]:
        ins("TBNVLCRITICID", [i, d])
    opcoes = [i for i in range(1, 31) if i % 6]  # lacunas na chave
    for i in opcoes:
        titulo = None if i == OPCOES_SEM_TITULO else "Opção  de menu %d" % i
        indice = -1 if i == OPCAO_NEGATIVA else i * 10
        ativo = "X" if i == OPCAO_SN_INVALIDO else (None if i == 13 else "SN"[i % 4 == 0])
        ins("TBOPCOES", [i, 1 + i % 3, indice, 1 + i % 2, "mnuOpcao%d" % i, titulo, "Detalhe %d" % i,
                         None, ativo, "N", None])
    for i, o in [(1, 1), (2, 2), (3, 3)]:
        ins("TBEVENTOS", [i, o, "Evento %d" % i])
    for row in PAPEIS:
        ins("TBPAPEL", list(row) + [r.choice([None, 0, 3])])
    pares = [(1, 1), (1, 2), (1, 3), (2, 1), (2, 4), (5, 8), (5, 10),
             (3, 1),            # papel recusado (nome nulo): pai_pendente
             (4, 2),            # papel recusado (código repetido): pai_pendente
             (2, OPCOES_SEM_TITULO),  # opção recusada: pai_pendente
             (1, 9999)]         # opção inexistente: NULL na coluna NOT NULL
    for p in pares:
        ins("TBPAPEL_TBOPCOES", list(p))
    for i in (1, 2):
        ins("TBPERMISSAO_SUS", [i, "usuario%d" % i] + [r.choice(["S", "N", None]) for _ in FLAGS_SUS])
    for g, o in [("Grupo A", 1), ("Grupo A", 2), ("Grupo B", 3)]:
        ins("TBPERUSU", [g, o])
    for i, d in [(1, "Cópia"), (2, "Restauração")]:
        ins("TBPROCBACKUP", [i, d])
    for m in (1, 2):
        ins("TBSGHCONEXAO", [m, "usuario1", datetime.date(2026, 3, m), "N"])
    for i, d in [(1, "Concluído"), (2, "Falhou")]:
        ins("TBSITBACKUP", [i, d])
    for row in TERMOS:
        ins("TBTERMCONREVTP", list(row))
    for i, d in [(1, "A1"), (2, "A3")]:
        ins("TBTIPOCERTIFICADO", [i, d, "S"])
    for i, d in [(1, "Política A1"), (2, "CPF do titular")]:
        ins("TBTIPOOID", [i, d])
    return {
        "TBLEITORBIOME": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        "TBLGPDANONMOT": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1}},
        "TBLGPDANONUSERFUNCAO": {"gravados": 3, "pendencias": {}},
        "TBPAPEL": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1062": 1}},
        "TBTERMCONREVTP": {"gravados": 3, "pendencias": {}},
    }
