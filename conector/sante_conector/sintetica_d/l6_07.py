"""Fatia L6-07 (prontuário, assinatura e assistência do PEP): tabelas de situação, tipos e parâmetros do prontuário.

Dados 100% falsos. Anomalias: descrição só de espaços em tabela com NOME obrigatório (vira NULL: NOT NULL no
destino recusa a linha); nome com espaços repetidos (colapsados); bytes CP1252 0x80-0x9F; código de 1 caractere que só
difere pela caixa ('a' e 'A': códigos distintos pelo sufixo); processo de enfermagem, origem do cabeçalho e tipo de
ventilação pelo de-para de valores (sem par: valor_fora_do_dominio e o padrão do destino); S/N e A/I fora do domínio (valor_fora_do_dominio, fica
o padrão do destino); ordem negativa (inteiro_nao_negativo: NULL com valor_fora_do_dominio; piso:0 na ordem da situação
permitida: valor_elevado_ao_minimo); choque de código com outra fonte do mesmo destino (PREPARO_DESTINO: o tipo de anexo
com prefixo de domínio não choca; a situação de checagem de 1 caractere entra pelo de-para de valores com o prefixo
'checagem_' e a caixa no sufixo: 'a' e 'A' gravam as duas e '1' não choca; caractere sem par é recusado); tipo de
documento de duas fontes no mesmo destino (PRTPCOMP com prefixo 'evolucao_', sem choque com PRTPASSINATURA); situação
permitida por tipo gravada inativa e presumida (valor_presumido); referência a pai recusado
(pai_pendente), a pai nulo em coluna NOT NULL e a pai de fora da fatia inexistente (pai_inexistente). Os literais
PRESUMIDOS (`=~`) deixam valor_presumido em cada linha, inclusive na recusada pela restrição do destino
(não na recusada por pai_pendente: comportamento atual do motor). As tabelas descartadas (declarado/sem_carga.tsv, mecanismo_do_produto)
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
# identificadores do certificado (L5-03, TBOID -> oid_icp), dados como já carregados: o rótulo do vínculo tipo de
# documento x identificador lê a descrição gravada (ref:TBOID@descricao)
PAIS_EXTERNOS = {"GETABVIA": ["01", "02", "03"], "TBOID": ["1", "2", "3"]}

# choque de código em destino compartilhado: L6-06 (PROFTTPARQUIV, PRSITCHECAGEM) grava antes no mesmo destino com
# código numérico: o tipo de anexo leva o prefixo 'anexo_' e a situação de checagem o prefixo 'checagem_' (de-para
# de valores): nenhum choca
PREPARO_DESTINO = """
INSERT INTO oid_icp (id, codigo, descricao, oid, tipo_oid, criado_em) SELECT n, CONCAT('oid_falso_', n),
  CONCAT('Identificador falso ', n), CONCAT('9.9.9.', n), 'outro', NOW(3)
  FROM (WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 10) SELECT n FROM s) x;
INSERT INTO tipo_anexo (codigo, descricao, criado_em) VALUES ('1', 'Tipo de arquivo falso de outra fonte', NOW(3));
INSERT INTO situacao_checagem (codigo, descricao, categoria, criado_em)
  VALUES ('1', 'Situação falsa de outra fonte', 'pendente', NOW(3));
"""

# descartadas com motivo de produto (declarado/sem_carga.tsv): nada delas é gravado
NAO_CARREGADAS = []  # rodada 5 (ADR 0006): todas carregam


def _simples(ins, t, nomes, extra=lambda i: []):
    for i, n in enumerate(nomes, 1):
        ins(t, [i, n] + extra(i))


def linhas(r, ins):
    # T2 (pedido 67): categoria e etapa das situações pelo nome (de-para); 1 e 5 do documento, 1 da assinatura, 1 do
    # exame, A e D da checagem com par; as outras sem par caem no terminal não acionável presumido
    E = "   "  # só espaços: vira NULL, NOT NULL no destino recusa a linha
    _simples(ins, "PRSITDOCUMENTO", ["Rascunho", "  Situação   com  espaços ", E, "Exemplo €“”",
                                     "ASSINADO"])
    _simples(ins, "PRSITDOCUMENTOASSINADO", ["Pendente", "Assinatura falsa dois", E])
    _simples(ins, "PRSITEXAME", ["Realizado", "Exame dois", "Exame três"])
    for cod, nome, ativo, proc in [("A", "Administrado", "S", "Administração"),
                                   ("a", "Só difere de A pela caixa", "S", "CUIDADOS"),
                                   ("B", "Checagem exemplo B", "N", "Processo falso"),   # sem par: padrão
                                   ("C", "Checagem exemplo C", None, None),
                                   ("D", "SUSPENSO", "X", "Sinais vitais"),
                                   ("E", E, "S", "Coleta"),                               # sem nome: recusa
                                   ("1", "Checagem de código numérico", "S", "Conferência"),
                                   ("#", "Código fora do de-para", "S", "Coleta")]:       # sem par: recusa
        ins("PRSITUACAOCHECAGEM", [cod, nome, ativo, None, proc])
    for i, (desc, st) in enumerate([("Seção falsa um", "A"), ("Seção falsa dois", "I"), ("Seção falsa três", "Z"),
                                    (E, "A")], 1):
        ins("PRSUMARIO_ALTA_COMP", [i, desc, st])
    for i, (nome, at) in enumerate([("Anexo falso um", "S"), ("Anexo falso dois", "N"), ("Anexo falso três", "Q"),
                                    (E, "S")], 1):
        ins("PRTIPODOCANEXO", [i, nome, at, None])
    for i in range(1, 4):
        ins("PRTIPONOTIFICACAO", [i, "Notificação falsa %d" % i])
        # parâmetro: 1 e 2 com o MESMO código fixo (o código derivado leva a chave: nenhum choque); 3 sem nome
        ins("PRTIPOPERGPAR", [i, 7 if i < 3 else 8, ["Peso", "Parâmetro falso 2", None][i - 1]])  # 1: par pelo rótulo
        ins("PRTPCOMP", [i, "Componente falso %d" % i])
    ins("PRTPCOMP", [4, E])  # sem nome: NOT NULL recusa
    _simples(ins, "PRTIPOPRESENTEADMISSAO", ["Sim falso", "Não falso", "Indeterminado falso"],
             lambda i: ["SNX"[i - 1]])
    _simples(ins, "PRTPALERTA", ["Alerta falso um", "Alerta falso dois"])
    # tipos de documento: 4 sem descrição (recusado); filhos dele caem em pai_pendente
    for i in range(1, 7):
        ins("PRTPASSINATURA", [i, E if i == 4 else "Documento falso %d" % i, [None, "S", "N", "S", "N", "S"][i - 1]])
    for i, (tp, desc) in enumerate([(1, "Escala falsa um"), (2, "Escala falsa dois"), (4, "Escala do tipo recusado"),
                                    (3, None), (99, "Escala de tipo inexistente")], 1):
        ins("PRINDICEAGRUPAMENTO", [i, tp, desc])
    for i, (tp, org, ger) in enumerate([(1, "E", "S"), (2, "E", "N"), (None, None, None), (4, "E", "S"),
                                        (5, "X", "S")], 1):  # X sem par: padrão (estabelecimento)
        ins("PRPARAMORIGEMCABIMP", [i, tp, org, ger])
    # situações permitidas por tipo: 3 e 4 com pai recusado (situação sem nome; tipo sem descrição); ordem negativa
    # sobe a 0; situação inexistente (pai_inexistente, NOT NULL recusa)
    for i, (tp, sit, ordem) in enumerate([(1, 1, 1), (1, 2, 2), (1, 3, 3), (4, 1, 1), (2, 1, -1), (2, 99, 2)], 1):
        ins("PRTPASSINATURA_PRSITDOC", [i, tp, sit, ordem])
    # vínculo tipo de documento x identificador: 4 aponta o tipo recusado (pai_pendente); 1 e 5 são o MESMO tipo
    # com identificadores diferentes (rótulos distintos: a descrição do identificador); 6 identificador inexistente
    # (pai_inexistente visível; rótulo cai para a descrição do tipo)
    for i, (tp, oid) in enumerate([(1, 1), (2, 2), (3, 3), (4, 1), (1, 2), (2, 99)], 1):
        ins("PRTPASSINATURA_TBOID", [i, tp, oid])
    _simples(ins, "PRTPDOCUMENTO", ["Sem assinatura falsa", "Eletrônica falsa"])
    _simples(ins, "PRTPINFOPERGOPERADORA", ["Grupo falso um", "Grupo falso dois", None])
    for i, (g, nome) in enumerate([(1, "Informação falsa um"), (2, "Informação falsa dois"), (None, "Sem grupo"),
                                   (3, "Grupo recusado"), (1, None)], 1):
        ins("PRINFOPERGOPERADORA", [i, g, nome])
    _simples(ins, "PRTPINFUSAO", ["Infusão falsa um", "Infusão falsa dois"], lambda i: [None])
    for i, (nome, ordem) in enumerate([("Item falso um", 1), ("Item falso dois", None), ("Item falso três", -1),
                                       ("Item falso quatro", 4)], 1):
        ins("PRTPLAN", [i, nome, ordem, "categoria-falsa-%d" % i])
    for i, tp in enumerate([12, 11, 1], 1):  # invasiva, não invasiva, código sem par (padrão)
        ins("PRMODOVENT", [i, tp, "Modo falso %d" % i, None])
    for item, via, vis, marc in [(1, "01", "S", "N"), (1, "02", None, "S"), (2, "01", "N", None),
                                 (3, "01", "S", "S"),      # item de ordem negativa: gravado (ordem nula)
                                 (4, "99", "S", "N"),      # via fora da imagem: pai_inexistente (NOT NULL recusa)
                                 (4, "03", "X", "N")]:     # S/N inválido: fica o padrão
        ins("PRTPLAN_GETABVIA", [item, via, vis, marc])
    return {
        "PRTIPONOTIFICACAO": {"gravados": 3, "pendencias": {"adotado_existente": 4}},
        # V3b (recusas-fase2): a 4 tem o rótulo pelo identificador; o rótulo pelo tipo recusado (concorrente) nem é
        # tentado: grava, sem pai_pendente
        "PRTPASSINATURA_TBOID": {"gravados": 6, "pendencias": {"adotado_existente": 11,
                                                               "pai_inexistente": 1}},
        "PRTIPOPERGPAR": {"gravados": 3, "pendencias": {"valor_presumido": 5, "valor_fora_do_dominio": 2}},
        "PRSITDOCUMENTO": {"gravados": 4, "pendencias": {"valor_presumido": 3, "valor_fora_do_dominio": 2,
                                                         "restricao_destino_1048": 1}},
        "PRSITDOCUMENTOASSINADO": {"gravados": 2, "pendencias": {"valor_presumido": 2, "valor_fora_do_dominio": 1,
                                                                 "restricao_destino_1048": 1}},
        "PRSITEXAME": {"gravados": 3, "pendencias": {"valor_presumido": 2, "valor_fora_do_dominio": 2}},
        "PRSITUACAOCHECAGEM": {"gravados": 6, "pendencias": {"valor_presumido": 6, "valor_fora_do_dominio": 8,
                                                             "restricao_destino_1048": 2}},
        "PRSUMARIO_ALTA_COMP": {"gravados": 3, "pendencias": {"valor_presumido": 4, "valor_fora_do_dominio": 1,
                                                              "restricao_destino_1048": 1}},
        "PRTIPODOCANEXO": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "PRTIPOPRESENTEADMISSAO": {"gravados": 3, "pendencias": {"valor_presumido": 3, "valor_fora_do_dominio": 1}},
        "PRTPALERTA": {"gravados": 2, "pendencias": {"valor_presumido": 2}},
        "PRTPASSINATURA": {"gravados": 5, "pendencias": {"valor_presumido": 6, "restricao_destino_1048": 1}},
        # recusas-fase2 (R9): o tipo de documento recusado em coluna anulável grava sem a ligação (pai_pendente é
        # aviso, religada no reprocessamento): AVISO_R9 no teste da fatia
        "PRINDICEAGRUPAMENTO": {"gravados": 4, "pendencias": {"pai_pendente": 1, "restricao_destino_1048": 1,
                                                              "pai_inexistente": 1}},
        "PRPARAMORIGEMCABIMP": {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 1, "pai_pendente": 1}},
        "PRTPASSINATURA_PRSITDOC": {"gravados": 3, "pendencias": {"valor_presumido": 4, "pai_pendente": 2,
                                                                  "valor_elevado_ao_minimo": 1, "pai_inexistente": 1,
                                                                  "restricao_destino_1048": 1}},
        "PRTPCOMP": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "PRTPDOCUMENTO": {"gravados": 2, "pendencias": {"valor_presumido": 2}},
        "PRTPINFOPERGOPERADORA": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        "PRINFOPERGOPERADORA": {"gravados": 2, "pendencias": {"restricao_destino_1048": 2, "pai_pendente": 1}},
        "PRTPINFUSAO": {"gravados": 2, "pendencias": {"valor_presumido": 2}},
        "PRTPLAN": {"gravados": 4, "pendencias": {"valor_presumido": 4, "valor_fora_do_dominio": 1}},
        "PRMODOVENT": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1}},
        "PRTPLAN_GETABVIA": {"gravados": 5, "pendencias": {"pai_inexistente": 1,
                                                           "restricao_destino_1048": 1, "valor_fora_do_dominio": 1}},
    }
