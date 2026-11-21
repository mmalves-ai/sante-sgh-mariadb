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
PRTPREQUISICAO, TBACAOGRAUGRA, TBDIGITAL_VIAACESSO, PRTPRESPOSTA e PRPARRECMED ficam na imagem e NÃO são carregadas
(descarte de produto em declarado/sem_carga.tsv: os pais de PRTPRESPOSTA e PRPARRECMED são descartados na L6-05).
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
                 "GETABVIA": ["VO", "EV"]}
CARREGADAS = ("PRTPLAN_PRFREQUENCIA", "PRTPLAN_PRTPINFUSAO", "PRTPNOTALEMB", "PRTPPERGUNTA", "PRTPPROT", "PRTPRECMED",
              "PRTPTCLE", "PRUNIDINFUSAO", "PRKITSOL", "PRUNIDRESPOSTA", "PRVALIDARMEDDUPLICPRESC", "PRVIAAEREA",
              "TBCBARACATEGORIA", "TBCBARAAGENTE", "TBCBARACLASSIFREACAO", "TBCBARAORIGEMINFO", "TBCBARASEVERIDADE",
              "TBCLASSINTMED", "TBCLASSIFALERGIA")
NAO_CARREGADAS = ("PRTPREQUISICAO", "TBACAOGRAUGRA", "TBDIGITAL_VIAACESSO", "PRTPRESPOSTA", "PRPARRECMED")
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
        # 1 e 2 pelo nome; 3 sem nome (1048); 4 com espaços (colapsados antes do par); 5 sem par (recusa, 1048)
        nome = {1: "Texto", 2: "DATA", 3: None, 4: "  Número  "}.get(i, "Pergunta exemplo %d" % i)
        ins("PRTPPERGUNTA", [i, nome, "componente_exemplo_%d" % i if i % 2 else None, GUID % i])
    # protocolos: 2 com inteiro 0/1 fora do domínio; 4 sem nome (1048)
    for c in range(1, 6):
        nome = None if c == 4 else "Protocolo exemplo %d" % c
        tipo = {3: "Z", 5: "H"}.get(c, "Q")  # Z sem par: padrão do destino com valor_fora_do_dominio
        ins("PRTPPROT", [c, nome, "clExemplo", c, "SN"[c % 2], tipo, "S", 2 if c == 2 else c % 2, "N"])
    for v in [(1, "Receita simples exemplo", "S"), (2, "Receita especial exemplo", "N"), (3, "Receita três", "X")]:
        ins("PRTPRECMED", list(v))
    for v in [(1, 1), (2, 3)]:
        ins("PRPARRECMED", list(v))
    for v in [(1, "Por horário"), (2, "Por dia")]:
        ins("PRTPREQUISICAO", list(v))
    # respostas: 3 pergunta sem nome (1048); 4 pergunta nunca vista e 5 dado de envio nunca visto (pai_inexistente,
    # 1048); 6 nome da pergunta com espaços repetidos (colapsados na descrição)
    for v in [(1, 1, 1), (2, 2, 1), (3, 3, 1), (4, 9, 1), (5, 1, 7), (6, 4, 1)]:
        ins("PRTPRESPOSTA", list(v))
    for v in [(1, "Pendente exemplo"), (2, "Assinado exemplo"), (3, "Recusado exemplo")]:
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
    for i in range(1, 3):
        ins("TBDIGITAL_VIAACESSO", [GUID % i, "V%d" % i, "Via digital exemplo %d" % i])
    for v in [(1, "Farmacocinética", "S"), (2, "Farmacodinâmica", "S"), (3, "Outra exemplo", "N")]:
        ins("TBCLASSINTMED", list(v))
    return {
        "PRTPLAN_PRFREQUENCIA": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1, "pai_inexistente": 2,
                                                               "restricao_destino_1048": 2}},
        "PRTPLAN_PRTPINFUSAO": {"gravados": 3, "pendencias": {}},
        "PRTPNOTALEMB": {"gravados": 2, "pendencias": {}},
        "PRTPPERGUNTA": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 2}},
        "PRTPPROT": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 2, "restricao_destino_1048": 1}},
        "PRTPRECMED": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1}},
        "PRTPTCLE": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
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
