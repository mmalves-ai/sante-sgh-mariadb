"""Fatia L6-08 (prontuário, assinatura e assistência, módulo PEP): tabelas da origem e anomalias, dados 100% falsos.

Anomalias cobertas:
- S/N fora do domínio (valor_fora_do_dominio; NOT NULL com padrão fica com o padrão) e inteiro 0/1 fora do domínio;
- pai de fora da fatia nunca carregado: em coluna NOT NULL recusa a linha, em coluna anulável grava NULL
  (pai_inexistente); pai recusado na própria fatia (pai_pendente);
- nome com espaços repetidos (texto_nome colapsa); nome ou código ausente em coluna obrigatória (1048);
- código ou nome maior que o destino (1406); código da terminologia repetido (único no destino, 1062);
- literal presumido (=~): pendência valor_presumido em toda linha gravada;
- de-para de valores pelo nome: gravidade com a ordem da chave DIFERENTE da gravidade (1 = Grave) recebe o nível pelo
  NOME (Grave = 3); nome sem par recusa (1048); tipo de pergunta pelo nome (sem par recusa); letra do tipo de
  protocolo sem par fica com o padrão do destino (valor_fora_do_dominio);
- unidade de nome maior que a sigla: resumida (texto_resumido), a unidade e o kit dela entram;
- velocidade de infusão zero (NULL com valor_fora_do_dominio) e velocidade sem unidade (CHECK recusa o kit);
- categoria com código da terminologia maior que o destino: não recusa (o código é a chave), e o alergeno dela entra.
- cobertura total: TBCLASSIFALERGIA no mesmo cadastro de TBCBARACATEGORIA com prefixo de domínio no código (mesmas
  chaves 1 e 2 nas duas, sem colisão).
Rodada 5 (ADR 0006): PRTPREQUISICAO e TBACAOGRAUGRA carregam como opções de parâmetro de lista do hospital;
PRTPRESPOSTA complementa a informação clínica (L6-05, pai externo) e PRPARRECMED o leiaute de impressão (L6-05).
"""

DDL = """
CREATE TABLE PRTPLAN_PRFREQUENCIA (ID_PRTPLAN SMALLINT NOT NULL, ID_PRFREQUENCIA SMALLINT NOT NULL, VISIVEL CHAR(1),
  CONSTRAINT PK_L608_PRF PRIMARY KEY (ID_PRTPLAN, ID_PRFREQUENCIA));
CREATE TABLE PRTPLAN_PRTPINFUSAO (ID_PRTPLAN SMALLINT NOT NULL, ID_PRTPINFUSAO SMALLINT NOT NULL, VISIVEL CHAR(1),
  CONSTRAINT PK_L608_PRI PRIMARY KEY (ID_PRTPLAN, ID_PRTPINFUSAO));
CREATE TABLE PRTPNOTALEMB (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(10) NOT NULL);
CREATE TABLE PRTPPERGUNTA (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(50), REFERENCIAS VARCHAR(255),
  ID_DIGITAL VARCHAR(36));
CREATE TABLE PRTPPROT (COD INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40), COR VARCHAR(20), ORDEM SMALLINT,
  LINTRATOBR VARCHAR(1), TIPO VARCHAR(1), PERMITE_ALT_ITEM_PROT_NP_CONV CHAR(1), SEPARAR_DOC_GERADO_EST SMALLINT,
  OBRIGAR_AUT_ITENS_AGE_AUT_PEXT CHAR(1));
CREATE TABLE PRTPRECMED (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30), PADRAO CHAR(1) NOT NULL);
CREATE TABLE PRFICHAREL (ID_FICHAREL INTEGER NOT NULL PRIMARY KEY, COD SMALLINT NOT NULL, NOMECOMP VARCHAR(30) NOT NULL,
  NOMECLASSE VARCHAR(30), NOME VARCHAR(50), COMPONENTE BLOB SUB_TYPE 1, CONTEUDO BLOB SUB_TYPE 1, PARENT VARCHAR(30),
  TIPO SMALLINT NOT NULL, SEQUENCIA SMALLINT);
CREATE TABLE PRPARRECMED (COD_PRFICHAREL SMALLINT NOT NULL PRIMARY KEY, ID_PRTPRECMED SMALLINT NOT NULL);
CREATE TABLE PRTPREQUISICAO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE PRTPRESPOSTA (ID INTEGER NOT NULL PRIMARY KEY, ID_PRTPPERGUNTA INTEGER NOT NULL,
  ID_PRDADOSENVIOOPERADORA INTEGER NOT NULL);
CREATE TABLE PRTPTCLE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE PRUNIDINFUSAO (ID SMALLINT NOT NULL PRIMARY KEY, ID_PRTPINFUSAO SMALLINT, NOME VARCHAR(30) NOT NULL);
CREATE TABLE PRKITSOL (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(100) NOT NULL, ID_PRFREQUENCIA SMALLINT NOT NULL,
  ID_GETABVIA VARCHAR(2) NOT NULL, INICIAR_ADM_AGORA CHAR(1), VELOCIDADE_INFUSAO NUMERIC(18,3),
  ID_PRUNIDINFUSAO SMALLINT, ID_PRTPINFUSAO SMALLINT, NOME_AGRUP_VISUAL_BALANCO VARCHAR(5), ATIVO CHAR(1));
CREATE TABLE PRUNIDRESPOSTA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(10) NOT NULL);
CREATE TABLE PRVALIDARMEDDUPLICPRESC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL, ATIVO CHAR(1));
CREATE TABLE PRVIAAEREA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ID_DIGITAL VARCHAR(36));
CREATE TABLE TBACAOGRAUGRA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(100) NOT NULL);
CREATE TABLE TBCBARACATEGORIA (ID SMALLINT NOT NULL PRIMARY KEY, CODIGO VARCHAR(50) NOT NULL, NOME VARCHAR(200) NOT NULL,
  ID_TBVERSAOCBARA SMALLINT, ATIVO CHAR(1) NOT NULL, ID_DIGITAL VARCHAR(36));
CREATE TABLE TBCBARAAGENTE (ID INTEGER NOT NULL PRIMARY KEY, CODIGO VARCHAR(50) NOT NULL, NOME VARCHAR(200) NOT NULL,
  SINONIMO_1 VARCHAR(200), SINONIMO_2 VARCHAR(200), ID_TBCBARACATEGORIA SMALLINT NOT NULL, ID_TBVERSAOCBARA SMALLINT,
  ATIVO CHAR(1) NOT NULL, ID_DIGITAL VARCHAR(36));
CREATE TABLE TBCBARACLASSIFREACAO (ID INTEGER NOT NULL PRIMARY KEY, CODIGO VARCHAR(50) NOT NULL,
  NOME VARCHAR(200) NOT NULL, ID_TBVERSAOCBARA SMALLINT, ATIVO CHAR(1) NOT NULL, ID_DIGITAL VARCHAR(36));
CREATE TABLE TBCBARAORIGEMINFO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL, ATIVO VARCHAR(1) NOT NULL,
  ID_DIGITAL VARCHAR(36));
CREATE TABLE TBCBARASEVERIDADE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL, ATIVO VARCHAR(1) NOT NULL,
  ID_DIGITAL VARCHAR(36));
CREATE TABLE TBCLASSIFALERGIA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(100) NOT NULL);
CREATE TABLE TBCLASSINTMED (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40) NOT NULL, ATIVO CHAR(1) NOT NULL);
CREATE TABLE TBDIGITAL_VIAACESSO (ID VARCHAR(36) NOT NULL PRIMARY KEY, CODIGO VARCHAR(30) NOT NULL,
  NOME VARCHAR(100) NOT NULL);
"""
PAIS_EXTERNOS = {"PRTPLAN": ["1", "2", "3"], "PRFREQUENCIA": ["1", "2", "3"], "PRTPINFUSAO": ["1", "2"],
                 "GETABVIA": ["VO", "EV"], "PRDADOSENVIOOPERADORA": ["1", "2", "3", "4", "5"]}
CARREGADAS = ("PRTPLAN_PRFREQUENCIA", "PRTPLAN_PRTPINFUSAO", "PRTPNOTALEMB", "PRTPPERGUNTA", "PRTPPROT", "PRTPRECMED",
              "PRTPTCLE", "PRUNIDINFUSAO", "PRKITSOL", "PRUNIDRESPOSTA", "PRVALIDARMEDDUPLICPRESC", "PRVIAAEREA",
              "TBCBARACATEGORIA", "TBCBARAAGENTE", "TBCBARACLASSIFREACAO", "TBCBARAORIGEMINFO", "TBCBARASEVERIDADE",
              "TBCLASSINTMED", "TBCLASSIFALERGIA", "TBDIGITAL_VIAACESSO", "PRTPREQUISICAO", "TBACAOGRAUGRA",
              "PRTPRESPOSTA", "PRPARRECMED")
NAO_CARREGADAS = ()
# complementa sem o pai (dado de envio 7; leiaute fora da imagem, PRFICHAREL é da L6-05): a linha é recusada
RECUSA_PAI_INEXISTENTE = {"PRTPRESPOSTA": 1, "PRPARRECMED": 1}
# pai de fora da fatia presente na imagem só para a referência por chave alternativa (o esperado é da L6-05)
PAIS_NA_IMAGEM = ("PRFICHAREL",)
# vias de uso do hospital (L6-05, dadas como já carregadas) com o identificador da prescrição digital: 1 e 2
# existem; o 3 não é usado por via nenhuma (codigo_inexistente_destino; NOT NULL recusa a linha)
# informação clínica que a L6-05 gravou (pai externo de PRTPRESPOSTA, que a complementa): ids 1..100, como a
# conferência numera os pais externos (desta fatia e das que a requerem)
PREPARO_INFORMACAO = ("INSERT INTO informacao_clinica_operadora (id, codigo, descricao, grupo_informacao_clinica_operadora_id,"
                      " criado_em) SELECT n, CONCAT('externo_', n), CONCAT('Informação externa ', n), 1, UTC_TIMESTAMP(3)"
                      " FROM (WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 100) SELECT n FROM s) x;\n")
PREPARO_DESTINO = PREPARO_INFORMACAO + ("CREATE TABLE IF NOT EXISTS via_de_uso (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(30) NOT NULL, descricao VARCHAR(150) NOT NULL,"
                   " codigo_interoperabilidade VARCHAR(36) NULL, criado_em DATETIME(3) NOT NULL);\n"
                   "INSERT INTO via_de_uso (codigo, descricao, codigo_interoperabilidade, criado_em) VALUES"
                   " ('vdx1', 'Via falsa 1', '%s', NOW(3)), ('vdx2', 'Via falsa 2', '%s', NOW(3));"
                   % ("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"))
GUID = "00000000-0000-0000-0000-0000000000%02d"


def linhas(r, ins):
    # pares tipo de item x frequência: (2,3) S/N inválido (padrão TRUE); (3,9) frequência nunca carregada e
    # (9,1) tipo de item nunca carregado: NOT NULL no destino recusa a linha
    for v in [(1, 1, "S"), (1, 2, "N"), (2, 1, None), (2, 3, "X"), (3, 9, "S"), (9, 1, "N")]:
        ins("PRTPLAN_PRFREQUENCIA", list(v))
    for v in [(1, 1, "S"), (2, 2, "N"), (3, 1, "S")]:
        ins("PRTPLAN_PRTPINFUSAO", list(v))
    for v in [(1, "Aviso"), (2, " Lembrete ")]:
        ins("PRTPNOTALEMB", list(v))
    for i in range(1, 6):
        # 1 e 2 pelo nome; 3 sem nome (1048; a presumida conta antes); 4 com espaços (colapsados antes do par); 5 sem
        # par: texto presumido (recusas-fase2 P3a: tipo neutro, mantido pelo pedido 67), com valor_presumido
        nome = {1: "Texto", 2: "DATA", 3: None, 4: "  Número  "}.get(i, "Pergunta exemplo %d" % i)
        ins("PRTPPERGUNTA", [i, nome, "componente_exemplo_%d" % i if i % 2 else None, GUID % i])
    # protocolos: 2 com inteiro 0/1 fora do domínio; 4 sem nome (1048)
    for c in range(1, 6):
        nome = None if c == 4 else "Protocolo exemplo %d" % c
        tipo = {3: "Z", 5: "H"}.get(c, "Q")  # Z sem par: padrão do destino com valor_fora_do_dominio
        ins("PRTPPROT", [c, nome, "clExemplo", c, "SN"[c % 2], tipo, "S", 2 if c == 2 else c % 2, "N"])
    for v in [(1, "Receita simples exemplo", "S"), (2, "Receita especial exemplo", "N"), (3, "Receita três", "X")]:
        ins("PRTPRECMED", list(v))
    # leiaute de impressão (L6-05) na imagem, com as MESMAS linhas da L6-05 (na imagem conjunta valem as dela): o
    # tipo de receita 1 complementa o leiaute de código 1 (tipo_receita_id conferido); o código 3 não existe
    for v in [[1, 1, "Painel1", "TPanel", "Cabeçalho exemplo", b"Left = 8\r\nTop = 4", "Título falso".encode("cp1252"), None, 1, 2],
                    [2, 1, "Label1", "TLabel", None, b"Caption = 'Nome'", None, "Painel1", 2, 1],
                    [3, 2, "Memo1", "TMemo", "Observação", None, "Texto de exemplo\nlinha 2".encode("cp1252"), None, 3, 1],
                    [4, 1, "Image1", "TImage", None, None, None, "Painel1", 4, None]]:
        ins("PRFICHAREL", v)
    for v in [(1, 1), (3, 3)]:  # leiaute 3 não existe: pai_inexistente (complementa recusa)
        ins("PRPARRECMED", list(v))
    for v in [(1, "Por horário"), (2, "Por dia"), (3, "   ")]:  # 3: sem nome, rótulo = código
        ins("PRTPREQUISICAO", list(v))
    # respostas: 3 pergunta sem nome (1048); 4 pergunta nunca vista e 5 dado de envio nunca visto (pai_inexistente,
    # 1048); 6 nome da pergunta com espaços repetidos (colapsados na descrição)
    # 7: SEGUNDA pergunta do dado de envio 1 (N:1) que resulta no MESMO tipo (pergunta 9 nunca vista: texto
    # presumido, igual ao 'Texto' da 1): o complemento repetido concilia. O N:1 com tipos DIFERENTES diverge a soma
    # da conciliação (o UPDATE do último vence) até o motor guardar o conflito no histórico (ADR 0007, 20): pedido
    # em saida/L6-08.json; volta à imagem quando o motor atender
    for v in [(1, 1, 1), (2, 2, 2), (3, 3, 3), (4, 9, 4), (5, 1, 7), (6, 4, 5), (7, 9, 1)]:
        ins("PRTPRESPOSTA", list(v))
    # etapa do termo pelo nome (pedido 67): 3 sem par entra cancelado presumido (valor_fora_do_dominio + valor_presumido)
    for v in [(1, "Pendente"), (2, "ASSINADO"), (3, "Termo exemplo")]:
        ins("PRTPTCLE", list(v))
    # unidades: 3 com nome maior que a sigla (resumida, texto_resumido; o kit 3 entra); 4 com tipo nunca carregado
    for v in [(1, 1, "ml/h"), (2, None, "gotas/min"), (3, 2, "unidade exemplo longa demais"), (4, 7, "mcg/kg/min")]:
        ins("PRUNIDINFUSAO", list(v))
    for k in range(1, 7):
        nome, via, ini, unid, tpi, vel = "Kit solução %d" % k, ("VO", "EV")[k % 2], "N", None, None, None
        if k == 1:
            unid, tpi, vel = 1, 1, "1.500"
        if k == 2:
            via, vel = "ZZ", "0"  # via nunca carregada: NULL com pai_inexistente; velocidade 0: NULL (fora do domínio)
        if k == 3:
            unid, vel = 3, "3.500"  # unidade de nome resumido: o kit entra
        if k == 4:
            nome = "  Kit   quatro  "
        if k == 5:
            ini, unid, vel = "X", 2, "5.250"  # fora do domínio: padrão FALSE
        if k == 6:
            vel = "6.500"         # velocidade sem unidade: o CHECK do destino recusa o kit
        ins("PRKITSOL", [k, nome, 1 + k % 3, via, ini, vel, unid, tpi, None, "SN"[k % 2]])
    for v in [(1, "mg"), (2, "ml"), (3, " cm ")]:
        ins("PRUNIDRESPOSTA", list(v))
    for v in [(1, "Mesmo princípio", "S"), (2, "Mesma classe", "N")]:
        ins("PRVALIDARMEDDUPLICPRESC", list(v))
    for i, n in enumerate(["Tubo exemplo", "Máscara exemplo", "Cânula exemplo"], 1):
        ins("PRVIAAEREA", [i, n, GUID % i])
    for v in [(1, "Avisar"), (2, "Bloquear")]:
        ins("TBACAOGRAUGRA", list(v))
    # categorias: 4 com código da terminologia maior que o destino (fica fora do código): carrega, e o agente 3 também
    for i in range(1, 5):
        codigo = "X" * 40 if i == 4 else "CAT%d" % i
        ins("TBCBARACATEGORIA", [i, codigo, "Categoria exemplo %d" % i, 1, "S", GUID % i])
    for i in range(1, 9):
        codigo, nome, cat = "AG%03d" % i, "Agente exemplo %d" % i, 1 + i % 3
        if i == 3:
            cat = 4              # categoria de código longo na terminologia: carregada
        if i == 5:
            nome = "Agente " * 25  # 175 caracteres > 150 (1406)
        if i == 7:
            codigo = "AG001"     # código da terminologia repetido (único no destino: 1062)
        if i == 8:
            nome = "  Agente   oito  "
        ins("TBCBARAAGENTE", [i, codigo, nome, "Sinônimo %d" % i, None, cat, 1, "SN"[i % 2], GUID % i])
    for v in [(1, "R1", "Alergia exemplo"), (2, "R2", "Intolerância exemplo")]:
        ins("TBCBARACLASSIFREACAO", list(v) + [1, "S", None])
    for v in [(1, "Paciente", "S"), (2, "Familiar", "N"), (3, "Documento", "X")]:
        ins("TBCBARAORIGEMINFO", list(v) + [None])
    # ordem da chave diferente da gravidade: o nível vem do nome (Grave = 3); nome sem par recusa (1048)
    for v in [(1, "Grave", "S"), (2, "LEVE", "S"), (3, "Moderada", "S"), (4, "Gravidade fora exemplo", "N")]:
        ins("TBCBARASEVERIDADE", list(v) + [None])
    for v in [(1, "Alimentos exemplo"), (2, "Medicamentos exemplo"), (3, "  Ambiental   exemplo ")]:
        ins("TBCLASSIFALERGIA", list(v))
    for i in range(1, 4):
        ins("TBDIGITAL_VIAACESSO", [GUID % i, "V%d" % i, "Via digital exemplo %d" % i])
    for v in [(1, "Farmacocinética", "S"), (2, "Farmacodinâmica", "S"), (3, "Outra exemplo", "N")]:
        ins("TBCLASSINTMED", list(v))
    return {
        "PRTPREQUISICAO": {"gravados": 3, "pendencias": {"adotado_existente": 4}},
        "TBACAOGRAUGRA": {"gravados": 2, "pendencias": {"adotado_existente": 3}},
        "PRTPRESPOSTA": {"gravados": 6, "pendencias": {"pai_inexistente": 3, "valor_presumido": 3}},
        "PRPARRECMED": {"gravados": 1, "pendencias": {"pai_inexistente": 1}},
        "TBDIGITAL_VIAACESSO": {"gravados": 2, "pendencias": {"codigo_inexistente_destino": 1, "adotado_existente": 2,
                                                              "valor_presumido": 3,
                                                              "restricao_destino_1048": 1}},
        "PRTPLAN_PRFREQUENCIA": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1, "pai_inexistente": 2,
                                                               "restricao_destino_1048": 2}},
        "PRTPLAN_PRTPINFUSAO": {"gravados": 3, "pendencias": {}},
        "PRTPNOTALEMB": {"gravados": 2, "pendencias": {}},
        "PRTPPERGUNTA": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1,
                                                       "valor_presumido": 2}},
        "PRTPPROT": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 2, "restricao_destino_1048": 1}},
        "PRTPRECMED": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1}},
        "PRTPTCLE": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "valor_presumido": 1}},
        "PRUNIDINFUSAO": {"gravados": 4, "pendencias": {"texto_resumido": 1, "pai_inexistente": 1,
                                                        "valor_presumido": 4}},
        "PRKITSOL": {"gravados": 5, "pendencias": {"pai_inexistente": 1, "valor_fora_do_dominio": 2,
                                                   "restricao_destino_4025": 1}},
        "PRUNIDRESPOSTA": {"gravados": 3, "pendencias": {}},
        "PRVALIDARMEDDUPLICPRESC": {"gravados": 2, "pendencias": {"valor_presumido": 2}},
        "PRVIAAEREA": {"gravados": 3, "pendencias": {}},
        "TBCBARACATEGORIA": {"gravados": 4, "pendencias": {}},
        "TBCBARAAGENTE": {"gravados": 6, "pendencias": {"valor_presumido": 8, "restricao_destino_1406": 1,
                                                        "restricao_destino_1062": 1}},
        "TBCBARACLASSIFREACAO": {"gravados": 2, "pendencias": {"valor_presumido": 2}},
        "TBCBARAORIGEMINFO": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1}},
        "TBCBARASEVERIDADE": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "TBCLASSINTMED": {"gravados": 3, "pendencias": {}},
        "TBCLASSIFALERGIA": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
    }
