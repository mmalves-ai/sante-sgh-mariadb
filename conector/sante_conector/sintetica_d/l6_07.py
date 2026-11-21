"""Fatia L6-07 (prontuário, assinatura e assistência do PEP): tabelas de situação, tipos e parâmetros do prontuário.

Dados 100% falsos. Anomalias: descrição só de espaços em tabela com NOME obrigatório (vira NULL: NOT NULL no
destino recusa a linha); nome com espaços repetidos (colapsados); bytes CP1252 0x80-0x9F; código de 1 caractere com
colisão de caixa ('a' e 'A': codigo_colisao_caixa nas duas); S/N e A/I fora do domínio (valor_fora_do_dominio, fica
o padrão do destino); ordem negativa (SMALLINT UNSIGNED: restricao_destino_1264, até a regra inteiro_nao_negativo pedida);
choque de código com outra fonte do mesmo destino (PREPARO_DESTINO: restricao_destino_1062, até o prefixo de domínio); referência a pai recusado
(pai_pendente), a pai nulo em coluna NOT NULL e a pai de fora da fatia inexistente (pai_inexistente). Os literais
PRESUMIDOS (`=~`) deixam valor_presumido em cada linha, inclusive na recusada pela restrição do destino
(não na recusada por pai_pendente nem por colisão de caixa: comportamento atual do motor). As tabelas não carregadas por ora (ver colunas.d/L6-07.tsv)
entram na imagem para provar que nada delas é gravado.
"""

DDL = """
CREATE TABLE PRSITDOCUMENTO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE PRSITDOCUMENTOASSINADO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE PRSITEXAME (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(12) NOT NULL);
CREATE TABLE PRSITUACAOCHECAGEM (ID CHAR(1) NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL, ATIVO CHAR(1),
  ID_DIGITAL VARCHAR(36), NOME_PROCESSO_ENFERMAGEM VARCHAR(50));
CREATE TABLE PRSUMARIO_ALTA_COMP (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(100) NOT NULL,
  STATUS VARCHAR(1) NOT NULL);
CREATE TABLE PRTIPODOCANEXO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL, ATIVO CHAR(1) NOT NULL,
  ID_DIGITAL VARCHAR(36));
CREATE TABLE PRTIPONOTIFICACAO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(100));
CREATE TABLE PRTIPOPERGPAR (ID SMALLINT NOT NULL PRIMARY KEY, COD_TIPO_PERGUNTA_PARAMETRO SMALLINT NOT NULL,
  NOME VARCHAR(100));
CREATE TABLE PRTIPOPRESENTEADMISSAO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL,
  ATIVO CHAR(1) NOT NULL);
CREATE TABLE PRTPALERTA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40) NOT NULL);
CREATE TABLE PRTPASSINATURA (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(80) NOT NULL, ORDEM_MEDICA CHAR(1));
CREATE TABLE PRINDICEAGRUPAMENTO (ID INTEGER NOT NULL PRIMARY KEY, ID_PRTPASSINATURA SMALLINT NOT NULL,
  DESCRICAO VARCHAR(80));
CREATE TABLE PRPARAMORIGEMCABIMP (ID SMALLINT NOT NULL PRIMARY KEY, ID_PRTPASSINATURA SMALLINT, ORIGEM_DADOS CHAR(1),
  GERENCIAVEL CHAR(1));
CREATE TABLE PRTPASSINATURA_PRSITDOC (ID INTEGER NOT NULL PRIMARY KEY, ID_PRTPASSINATURA SMALLINT NOT NULL,
  ID_PRSITDOCUMENTO SMALLINT NOT NULL, ORDEM SMALLINT NOT NULL);
CREATE TABLE PRTPASSINATURA_TBOID (ID INTEGER NOT NULL PRIMARY KEY, ID_PRTPASSINATURA SMALLINT NOT NULL,
  ID_TBOID SMALLINT NOT NULL);
CREATE TABLE PRTPCOMP (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(35) NOT NULL);
CREATE TABLE PRTPDOCUMENTO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE PRTPINFOPERGOPERADORA (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(80));
CREATE TABLE PRINFOPERGOPERADORA (ID INTEGER NOT NULL PRIMARY KEY, ID_PRTPINFOPERGOPERADORA INTEGER, NOME VARCHAR(80));
CREATE TABLE PRTPINFUSAO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ID_DIGITAL VARCHAR(36));
CREATE TABLE PRTPLAN (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL, ORDEM SMALLINT,
  ID_DIGITAL_SERV_REQ_CATEGORY VARCHAR(36));
CREATE TABLE PRMODOVENT (ID SMALLINT NOT NULL PRIMARY KEY, ID_PRTPLAN SMALLINT NOT NULL, NOME VARCHAR(30) NOT NULL,
  ID_DIGITAL VARCHAR(36));
CREATE TABLE PRTPLAN_GETABVIA (ID_PRTPLAN SMALLINT NOT NULL, ID_GETABVIA VARCHAR(2) NOT NULL, VISIVEL CHAR(1),
  PREVIAMENTE_MARCADO_LANCAMENTO CHAR(1), CONSTRAINT PK_PRTPLAN_GETABVIA PRIMARY KEY (ID_PRTPLAN, ID_GETABVIA));
"""

# vias de uso de outra fatia (L6, ordem 279), dadas como já carregadas
PAIS_EXTERNOS = {"GETABVIA": ["01", "02", "03"]}

# choque de código em destino compartilhado: L6-06 (PROFTTPARQUIV, PRSITCHECAGEM) grava antes no mesmo destino com
# código numérico; sem o prefixo de domínio (pedido em saida/L6-07.json) a linha de mesmo código é recusada (1062)
PREPARO_DESTINO = """
INSERT INTO tipo_anexo (codigo, descricao, criado_em) VALUES ('1', 'Tipo de arquivo falso de outra fonte', NOW(3));
INSERT INTO situacao_checagem (codigo, descricao, categoria, criado_em)
  VALUES ('1', 'Situação falsa de outra fonte', 'pendente', NOW(3));
"""

NAO_CARREGADAS = ["PRTIPONOTIFICACAO", "PRTIPOPERGPAR", "PRTPASSINATURA_PRSITDOC", "PRTPASSINATURA_TBOID", "PRTPCOMP"]


def _simples(ins, t, nomes, extra=lambda i: []):
    for i, n in enumerate(nomes, 1):
        ins(t, [i, n] + extra(i))


def linhas(r, ins):
    E = "   "  # só espaços: vira NULL, NOT NULL no destino recusa a linha
    _simples(ins, "PRSITDOCUMENTO", ["Situação exemplo um", "  Situação   com  espaços ", E, "Exemplo €“”",
                                     "Situação exemplo cinco"])
    _simples(ins, "PRSITDOCUMENTOASSINADO", ["Assinatura falsa um", "Assinatura falsa dois", E])
    _simples(ins, "PRSITEXAME", ["Exame um", "Exame dois", "Exame três"])
    for cod, nome, ativo in [("A", "Checagem exemplo A", "S"), ("a", "Colide com A pela caixa", "S"),
                             ("B", "Checagem exemplo B", "N"), ("C", "Checagem exemplo C", None),
                             ("D", "Checagem exemplo D", "X"), ("E", E, "S"),
                             ("1", "Checagem de código numérico", "S")]:
        ins("PRSITUACAOCHECAGEM", [cod, nome, ativo, None, "Processo falso"])
    for i, (desc, st) in enumerate([("Seção falsa um", "A"), ("Seção falsa dois", "I"), ("Seção falsa três", "Z"),
                                    (E, "A")], 1):
        ins("PRSUMARIO_ALTA_COMP", [i, desc, st])
    for i, (nome, at) in enumerate([("Anexo falso um", "S"), ("Anexo falso dois", "N"), ("Anexo falso três", "Q"),
                                    (E, "S")], 1):
        ins("PRTIPODOCANEXO", [i, nome, at, None])
    for i in range(1, 4):
        ins("PRTIPONOTIFICACAO", [i, "Notificação falsa %d" % i])
        ins("PRTIPOPERGPAR", [i, r.randint(1, 9), "Parâmetro falso %d" % i])
        ins("PRTPCOMP", [i, "Componente falso %d" % i])
    _simples(ins, "PRTIPOPRESENTEADMISSAO", ["Sim falso", "Não falso", "Indeterminado falso"],
             lambda i: ["SNX"[i - 1]])
    _simples(ins, "PRTPALERTA", ["Alerta falso um", "Alerta falso dois"])
    # tipos de documento: 4 sem descrição (recusado); filhos dele caem em pai_pendente
    for i in range(1, 7):
        ins("PRTPASSINATURA", [i, E if i == 4 else "Documento falso %d" % i, [None, "S", "N", "S", "N", "S"][i - 1]])
    for i, (tp, desc) in enumerate([(1, "Escala falsa um"), (2, "Escala falsa dois"), (4, "Escala do tipo recusado"),
                                    (3, None), (99, "Escala de tipo inexistente")], 1):
        ins("PRINDICEAGRUPAMENTO", [i, tp, desc])
    for i, (tp, ger) in enumerate([(1, "S"), (2, "N"), (None, None), (4, "S"), (5, "S")], 1):
        ins("PRPARAMORIGEMCABIMP", [i, tp, "E", ger])
    for i in range(1, 4):
        ins("PRTPASSINATURA_PRSITDOC", [i, 1, i, i])
        ins("PRTPASSINATURA_TBOID", [i, i, i])
    _simples(ins, "PRTPDOCUMENTO", ["Sem assinatura falsa", "Eletrônica falsa"])
    _simples(ins, "PRTPINFOPERGOPERADORA", ["Grupo falso um", "Grupo falso dois", None])
    for i, (g, nome) in enumerate([(1, "Informação falsa um"), (2, "Informação falsa dois"), (None, "Sem grupo"),
                                   (3, "Grupo recusado"), (1, None)], 1):
        ins("PRINFOPERGOPERADORA", [i, g, nome])
    _simples(ins, "PRTPINFUSAO", ["Infusão falsa um", "Infusão falsa dois"], lambda i: [None])
    for i, (nome, ordem) in enumerate([("Item falso um", 1), ("Item falso dois", None), ("Item falso três", -1),
                                       ("Item falso quatro", 4)], 1):
        ins("PRTPLAN", [i, nome, ordem, "categoria-falsa-%d" % i])
    for i in range(1, 4):
        ins("PRMODOVENT", [i, 1, "Modo falso %d" % i, None])
    for item, via, vis, marc in [(1, "01", "S", "N"), (1, "02", None, "S"), (2, "01", "N", None),
                                 (3, "01", "S", "S"),      # item recusado: pai_pendente
                                 (4, "99", "S", "N"),      # via fora da imagem: pai_inexistente (NOT NULL recusa)
                                 (4, "03", "X", "N")]:     # S/N inválido: fica o padrão
        ins("PRTPLAN_GETABVIA", [item, via, vis, marc])
    return {
        "PRSITDOCUMENTO": {"gravados": 4, "pendencias": {"valor_presumido": 5, "restricao_destino_1048": 1}},
        "PRSITDOCUMENTOASSINADO": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "PRSITEXAME": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
        "PRSITUACAOCHECAGEM": {"gravados": 3, "pendencias": {"valor_presumido": 10, "restricao_destino_1062": 1, "codigo_colisao_caixa": 2,
                                                             "valor_fora_do_dominio": 1,
                                                             "restricao_destino_1048": 1}},
        "PRSUMARIO_ALTA_COMP": {"gravados": 3, "pendencias": {"valor_presumido": 4, "valor_fora_do_dominio": 1,
                                                              "restricao_destino_1048": 1}},
        "PRTIPODOCANEXO": {"gravados": 2, "pendencias": {"restricao_destino_1062": 1, "valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "PRTIPOPRESENTEADMISSAO": {"gravados": 3, "pendencias": {"valor_presumido": 3, "valor_fora_do_dominio": 1}},
        "PRTPALERTA": {"gravados": 2, "pendencias": {}},
        "PRTPASSINATURA": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1}},
        "PRINDICEAGRUPAMENTO": {"gravados": 3, "pendencias": {"pai_pendente": 1, "restricao_destino_1048": 1,
                                                              "pai_inexistente": 1}},
        "PRPARAMORIGEMCABIMP": {"gravados": 4, "pendencias": {"valor_presumido": 4, "pai_pendente": 1}},
        "PRTPDOCUMENTO": {"gravados": 2, "pendencias": {"valor_presumido": 2}},
        "PRTPINFOPERGOPERADORA": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        "PRINFOPERGOPERADORA": {"gravados": 2, "pendencias": {"restricao_destino_1048": 2, "pai_pendente": 1}},
        "PRTPINFUSAO": {"gravados": 2, "pendencias": {}},
        "PRTPLAN": {"gravados": 3, "pendencias": {"restricao_destino_1264": 1}},
        "PRMODOVENT": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
        "PRTPLAN_GETABVIA": {"gravados": 4, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                           "restricao_destino_1048": 1, "valor_fora_do_dominio": 1}},
    }
