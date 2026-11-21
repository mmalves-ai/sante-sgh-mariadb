"""Fatia `exemplo_r4`: prova os mecanismos GENÉRICOS da rodada 4 de cobertura do conector (F4), pedidos pelas fatias,
com mapa e destino próprios (tabelas inventadas, prefixo EX4_, fora do mapa real; dados 100% falsos).

Cobre: fim do horário pela duração (`#data_hora_mais`, da linha ou da agenda pela chave alternativa composta com
literal, virada de dia, sem duração); condição de coluna (`se:`), de destino secundário (`destino_se:`) e filtro de
linha (`so_se:...!regra`); `cod:` por chave composta com literal; `#item` desdobrado com referência encadeada e
`#rotulo` com `cod:`; destino PRINCIPAL agrupado (`agrupar:` com `#grupo_somar`, `#grupo_contar`, `#grupo_json`) e
referência a ele por vários pais que apontam a mesma linha; grupos de leitura (`#grupo_seq@`, `#grupo_razao:`);
agregados das tabelas filhas (`#filhos_min`, `#filhos_somar`); `#codigo_derivado` de várias colunas; referência com
`max:` e chave composta num passo seguinte (`>(G,S)>T`).
"""
DDL = """
CREATE TABLE EX4_AGE (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(20), ATIVA CHAR(1), DURACAO VARCHAR(4));
CREATE TABLE EX4_HOR (ID INTEGER NOT NULL PRIMARY KEY, NOME_AGE VARCHAR(20), DATA DATE, HORA INTEGER, DUR VARCHAR(4));
CREATE TABLE EX4_CLI (COD INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40));
CREATE TABLE EX4_FOR (COD INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40));
CREATE TABLE EX4_TIT (ID INTEGER NOT NULL PRIMARY KEY, TIPO CHAR(1), COD INTEGER, VALOR NUMERIC(10,2), DT_PGTO DATE);
CREATE TABLE EX4_TAB (COD INTEGER NOT NULL PRIMARY KEY, PROPRIA CHAR(1));
CREATE TABLE EX4_ITE (ID INTEGER NOT NULL PRIMARY KEY, TAB INTEGER, NOME VARCHAR(40));
CREATE TABLE EX4_INC (ID INTEGER NOT NULL PRIMARY KEY, TRIB_COD VARCHAR(4));
CREATE TABLE EX4_PAR (ID INTEGER NOT NULL PRIMARY KEY, A INTEGER, B INTEGER);
CREATE TABLE EX4_KON (ID INTEGER NOT NULL PRIMARY KEY, ANO INTEGER, CC VARCHAR(4), VALOR NUMERIC(10,2), OBS VARCHAR(20));
CREATE TABLE EX4_USO (ID INTEGER NOT NULL PRIMARY KEY, ANO INTEGER, CC VARCHAR(4));
CREATE TABLE EX4_RAT (ID INTEGER NOT NULL PRIMARY KEY, DOC VARCHAR(4), VALOR NUMERIC(10,2));
CREATE TABLE EX4_CAB (ID INTEGER NOT NULL PRIMARY KEY);
CREATE TABLE EX4_FL1 (ID INTEGER NOT NULL PRIMARY KEY, ID_CAB INTEGER, DATA DATE, VALOR NUMERIC(10,2));
CREATE TABLE EX4_FL2 (ID INTEGER NOT NULL PRIMARY KEY, ID_CAB INTEGER, DATA DATE);
CREATE TABLE EX4_COD (ID INTEGER NOT NULL PRIMARY KEY, A VARCHAR(20), B VARCHAR(5));
CREATE TABLE EX4_NAT (G VARCHAR(3) NOT NULL, S VARCHAR(3) NOT NULL, NOME VARCHAR(20), PRIMARY KEY (G, S));
CREATE TABLE EX4_RT2 (ID INTEGER NOT NULL PRIMARY KEY, DOC VARCHAR(4), TP INTEGER, VALOR NUMERIC(10,2), G VARCHAR(3),
  S VARCHAR(3));
CREATE TABLE EX4_TT (ID INTEGER NOT NULL PRIMARY KEY, DOC VARCHAR(4));
CREATE TABLE EX4_UNI (ID INTEGER NOT NULL PRIMARY KEY, CPF VARCHAR(11), CNS VARCHAR(15));
CREATE TABLE EX4_PRF (COD INTEGER NOT NULL PRIMARY KEY, CPF VARCHAR(11), CNS VARCHAR(15));
"""

_A = (", origem VARCHAR(20) NOT NULL, criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL,"
      " versao INT UNSIGNED NOT NULL DEFAULT 1")
DDL_DESTINO = """
CREATE TABLE ex4_horario (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, inicio_em DATETIME NOT NULL,
  fim_em DATETIME NOT NULL{a}, CONSTRAINT ck_ex4_horario_fim CHECK (fim_em > inicio_em));
CREATE TABLE ex4_cliente (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(40) NULL{a});
CREATE TABLE ex4_fornecedor (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(40) NULL{a});
CREATE TABLE ex4_titulo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cliente_id BIGINT UNSIGNED NULL,
  fornecedor_id BIGINT UNSIGNED NULL, valor DECIMAL(10,2) NULL{a});
CREATE TABLE ex4_baixa (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, titulo_id BIGINT UNSIGNED NOT NULL,
  pago_em DATE NOT NULL{a});
CREATE TABLE ex4_item (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(40) NOT NULL{a});
CREATE TABLE ex4_codigo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, tributo VARCHAR(10) NOT NULL,
  codigo VARCHAR(4) NOT NULL, UNIQUE (tributo, codigo));
CREATE TABLE ex4_incidencia (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo_id BIGINT UNSIGNED NOT NULL{a});
CREATE TABLE ex4_tributo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, sigla VARCHAR(10) NOT NULL UNIQUE);
CREATE TABLE ex4_parametro (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, tributo_id BIGINT UNSIGNED NOT NULL,
  valor VARCHAR(40) NOT NULL{a});
CREATE TABLE ex4_consumo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ano SMALLINT NOT NULL, centro VARCHAR(4) NOT NULL,
  valor_total DECIMAL(12,2) NOT NULL, quantidade INT NOT NULL, detalhes JSON NOT NULL{a}, UNIQUE (ano, centro));
CREATE TABLE ex4_uso (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, consumo_id BIGINT UNSIGNED NOT NULL{a});
CREATE TABLE ex4_rateio (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, documento VARCHAR(4) NULL,
  sequencia SMALLINT NOT NULL, percentual DECIMAL(7,4) NULL{a});
CREATE TABLE ex4_grupo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, numero INT NOT NULL, data_operacao DATE NOT NULL,
  total DECIMAL(12,2) NOT NULL{a});
CREATE TABLE ex4_codigo_der (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(12) NOT NULL{a});
CREATE TABLE ex4_natureza (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(20) NULL{a});
CREATE TABLE ex4_titulo2 (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, documento VARCHAR(4) NULL,
  natureza_id BIGINT UNSIGNED NOT NULL{a});
CREATE TABLE ex4_unidade (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo INT NOT NULL,
  diretor_id BIGINT UNSIGNED NULL{a});
CREATE TABLE ex4_prof (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cpf VARCHAR(11) NULL{a});
""".format(a=_A)

PREPARO_DESTINO = ("INSERT INTO ex4_codigo (tributo, codigo) VALUES ('fgts', '11'), ('inss', '11'), ('fgts', '12');\n"
                   "INSERT INTO ex4_tributo (sigla) VALUES ('fgts'), ('inss');\n")


def _g(t, c, regra):
    return {"tabela": t, "coluna": c, "regra": regra, "referencia": "", "depara": ""}


def _d(t, c, destino, regra="", via="", depara=""):
    return {"tabela": t, "coluna": c, "destino": destino, "regra": regra, "depara": depara, "via": via,
            "motivo": "exemplo"}


def _t(t, destinos, ordem, chave):
    return {"tabela": t, "tabelas_destino": destinos, "ordem": str(ordem), "chave": chave, "estrategia": "hash_linha"}


(AGE, HOR, CLI, FOR, TIT, TAB, ITE, INC, PAR, KON, USO, RAT, CAB, FL1, FL2, COD, NAT, RT2, TT, UNI, PRF) = (
    "EX4_AGE", "EX4_HOR", "EX4_CLI", "EX4_FOR", "EX4_TIT", "EX4_TAB", "EX4_ITE", "EX4_INC", "EX4_PAR", "EX4_KON",
    "EX4_USO", "EX4_RAT", "EX4_CAB", "EX4_FL1", "EX4_FL2", "EX4_COD", "EX4_NAT", "EX4_RT2", "EX4_TT", "EX4_UNI",
    "EX4_PRF")
MAPA_TESTE = {
    "tabelas": [
        _t(AGE, "", 1, "ID"), _t(HOR, "ex4_horario", 2, "ID"), _t(CLI, "ex4_cliente", 3, "COD"),
        _t(FOR, "ex4_fornecedor", 4, "COD"), _t(TIT, "ex4_titulo;ex4_baixa", 5, "ID"), _t(TAB, "", 6, "COD"),
        _t(ITE, "ex4_item", 7, "ID"), _t(INC, "ex4_incidencia", 8, "ID"), _t(PAR, "ex4_parametro", 9, "ID"),
        _t(KON, "ex4_consumo", 10, "ID"), _t(USO, "ex4_uso", 11, "ID"), _t(RAT, "ex4_rateio", 12, "ID"),
        _t(CAB, "ex4_grupo", 13, "ID"), _t(FL1, "", 14, "ID"), _t(FL2, "", 15, "ID"),
        _t(COD, "ex4_codigo_der", 16, "ID"), _t(NAT, "ex4_natureza", 17, "G,S"), _t(RT2, "", 18, "ID"),
        _t(TT, "ex4_titulo2", 19, "ID"), _t(UNI, "ex4_unidade", 20, "ID"), _t(PRF, "ex4_prof", 21, "COD")],
    "colunas": [
        _g(AGE, "ID", "inteiro"), _g(AGE, "NOME", "texto"), _g(AGE, "ATIVA", "texto"), _g(AGE, "DURACAO", "texto"),
        _g(HOR, "ID", "inteiro"), _g(HOR, "NOME_AGE", "texto"), _g(HOR, "DATA", "data"), _g(HOR, "HORA", "hora_hhmm"),
        _g(HOR, "DUR", "texto"),
        _g(CLI, "COD", "inteiro"), _g(CLI, "NOME", "texto"), _g(FOR, "COD", "inteiro"), _g(FOR, "NOME", "texto"),
        _g(TIT, "ID", "inteiro"), _g(TIT, "TIPO", "codigo_char"), _g(TIT, "COD", "inteiro"),
        _g(TIT, "VALOR", "decimal"), _g(TIT, "DT_PGTO", "data"),
        _g(TAB, "COD", "inteiro"), _g(TAB, "PROPRIA", "booleano_sn"),
        _g(ITE, "ID", "inteiro"), _g(ITE, "TAB", "inteiro"), _g(ITE, "NOME", "texto"),
        _g(INC, "ID", "inteiro"), _g(INC, "TRIB_COD", "texto"),
        _g(PAR, "ID", "inteiro"), _g(PAR, "A", "inteiro"), _g(PAR, "B", "inteiro"),
        _g(KON, "ID", "inteiro"), _g(KON, "ANO", "inteiro"), _g(KON, "CC", "texto"), _g(KON, "VALOR", "decimal"),
        _g(KON, "OBS", "texto"),
        _g(USO, "ID", "inteiro"), _g(USO, "ANO", "inteiro"), _g(USO, "CC", "texto"),
        _g(RAT, "ID", "inteiro"), _g(RAT, "DOC", "texto"), _g(RAT, "VALOR", "decimal"),
        _g(CAB, "ID", "inteiro"),
        _g(FL1, "ID", "inteiro"), _g(FL1, "ID_CAB", "inteiro"), _g(FL1, "DATA", "data"), _g(FL1, "VALOR", "decimal"),
        _g(FL2, "ID", "inteiro"), _g(FL2, "ID_CAB", "inteiro"), _g(FL2, "DATA", "data"),
        _g(COD, "ID", "inteiro"), _g(COD, "A", "texto"), _g(COD, "B", "texto"),
        _g(NAT, "G", "texto"), _g(NAT, "S", "texto"), _g(NAT, "NOME", "texto"),
        _g(RT2, "ID", "inteiro"), _g(RT2, "DOC", "texto"), _g(RT2, "TP", "inteiro"), _g(RT2, "VALOR", "decimal"),
        _g(RT2, "G", "texto"), _g(RT2, "S", "texto"),
        _g(TT, "ID", "inteiro"), _g(TT, "DOC", "texto"),
        _g(UNI, "ID", "inteiro"), _g(UNI, "CPF", "texto"), _g(UNI, "CNS", "texto"),
        _g(PRF, "COD", "inteiro"), _g(PRF, "CPF", "texto"), _g(PRF, "CNS", "texto")],
    "colunas_decl": [
        # horário: início pela data e hora; fim = início + duração da linha ou, sem ela, da agenda ATIVA de mesmo nome
        _d(HOR, "#data_hora:DATA,HORA", "ex4_horario.inicio_em"),
        _d(HOR, "#data_hora_mais:DATA,HORA,DUR", "ex4_horario.fim_em", regra="minutos_hhmm",
           via="ref:EX4_AGE.(NOME,ATIVA)=(NOME_AGE,=S)>DURACAO"),
        _d(CLI, "NOME", "ex4_cliente.nome"),
        _d(FOR, "NOME", "ex4_fornecedor.nome"),
        # título: o devedor pelo TIPO (o mesmo COD é cliente ou fornecedor); a baixa só da parcela paga
        _d(TIT, "COD", "ex4_titulo.cliente_id", via="ref:EX4_CLI;se:TIPO=C"),
        _d(TIT, "COD", "ex4_titulo.fornecedor_id", via="ref:EX4_FOR;se:TIPO=F"),
        _d(TIT, "VALOR", "ex4_titulo.valor", regra="decimal"),
        _d(TIT, "@id", "ex4_baixa.titulo_id"),
        _d(TIT, "DT_PGTO", "ex4_baixa.pago_em", regra="data", via="destino_se:DT_PGTO"),
        # item: só o da tabela própria (filtro pela tabela do pai; o resto fica pendente, nunca gravado)
        _d(ITE, "NOME", "ex4_item.nome", via="so_se:TAB>EX4_TAB>PROPRIA=S!licenca_nao_comprovada"),
        # incidência: o código existe em vários tributos; o par (tributo, código) acha o id
        _d(INC, "TRIB_COD", "ex4_incidencia.codigo_id", regra="texto",
           via="cod:ex4_codigo.(tributo,codigo)=(=fgts,valor)"),
        # parâmetro desdobrado: o valor é o nome do cliente (encadeada no #item) e o tributo, o rótulo pelo código
        _d(PAR, "#item", "ex4_parametro.valor", via="desdobrar:A=fgts,B=inss;ref:EX4_CLI>NOME"),
        _d(PAR, "#rotulo", "ex4_parametro.tributo_id", via="cod:ex4_tributo.sigla"),
        # consumo: uma linha do destino por (ano, centro); os documentos somados e listados
        _d(KON, "ANO", "ex4_consumo.ano", regra="inteiro", via="agrupar:ANO,CC"),
        _d(KON, "CC", "ex4_consumo.centro"),
        _d(KON, "#grupo_somar:VALOR", "ex4_consumo.valor_total"),
        _d(KON, "#grupo_contar", "ex4_consumo.quantidade"),
        _d(KON, "#grupo_json:ID,OBS", "ex4_consumo.detalhes"),
        # uso: o consumo pela chave alternativa composta: várias linhas da origem, a mesma linha do destino
        _d(USO, "ANO", "ex4_uso.consumo_id", via="ref:EX4_KON.(ANO,CC)=(ANO,CC)"),
        # rateio: sequência e percentual dentro do documento, sem cabeçalho gravado
        _d(RAT, "DOC", "ex4_rateio.documento"),
        _d(RAT, "#grupo_seq@DOC", "ex4_rateio.sequencia"),
        _d(RAT, "#grupo_razao:VALOR@DOC", "ex4_rateio.percentual"),
        # grupo de operações: a data e o total só existem nas filhas
        _d(CAB, "ID", "ex4_grupo.numero", regra="inteiro"),
        _d(CAB, "#filhos_min:EX4_FL1.DATA|EX4_FL2.DATA@ID_CAB", "ex4_grupo.data_operacao"),
        _d(CAB, "#filhos_somar:EX4_FL1.VALOR@ID_CAB", "ex4_grupo.total"),
        _d(COD, "#codigo_derivado:A+B:12:x_", "ex4_codigo_der.codigo"),
        _d(NAT, "NOME", "ex4_natureza.nome"),
        # título 2: a natureza pelo MAIOR rateio de pagar (literal) e a chave composta da natureza no passo seguinte
        _d(TT, "DOC", "ex4_titulo2.documento"),
        _d(TT, "DOC", "ex4_titulo2.natureza_id", via="ref:EX4_RT2.(DOC,TP)=(DOC,=1)>max:VALOR>(G,S)>EX4_NAT"),
        # unidade antes do profissional (ciclo em duas fases): o diretor pelo CPF ou, sem ele, pelo CNS, na fase 2
        _d(UNI, "ID", "ex4_unidade.codigo", regra="inteiro"),
        _d(UNI, "CPF", "ex4_unidade.diretor_id", via="ref:EX4_PRF.CPF"),
        _d(UNI, "CNS", "ex4_unidade.diretor_id", via="ref:EX4_PRF.CNS"),
        _d(PRF, "CPF", "ex4_prof.cpf")],
    "valores": [], "deps": [{"tabela": UNI, "depende_de": PRF, "quebra": "duas_fases"}], "descartes": [],
}


def linhas(r, ins):
    import datetime as dt
    import decimal
    D = decimal.Decimal
    d = dt.date(2026, 5, 4)
    ins(AGE, [1, "A", "S", "0015"])
    ins(AGE, [2, "B", "S", None])
    ins(AGE, [3, "C", "N", "0045"])
    # 1 duração da linha; 2 da agenda A; 3 agenda C inativa (pai_inexistente, 1048); 4 vira o dia; 5 agenda sem
    # duração (duracao_ausente, 1048)
    ins(HOR, [1, "A", d, 800, "0030"])
    ins(HOR, [2, "A", d, 900, None])
    ins(HOR, [3, "C", d, 1000, None])
    ins(HOR, [4, "A", d, 2350, "0020"])
    ins(HOR, [5, "B", d, 1100, None])
    ins(CLI, [1, "Cliente um"])
    ins(CLI, [2, "Cliente dois"])
    ins(FOR, [1, "Fornecedor um"])
    # 1 cliente 1 (o fornecedor 1 também existe, mas o tipo é C), pago; 2 fornecedor 1; 3 cliente inexistente
    ins(TIT, [1, "C", 1, D("10.00"), dt.date(2026, 1, 10)])
    ins(TIT, [2, "F", 1, D("20.00"), None])
    ins(TIT, [3, "C", 7, D("30.00"), None])
    ins(TAB, [1, "S"])
    ins(TAB, [2, "N"])
    ins(ITE, [1, 1, "Item próprio"])
    ins(ITE, [2, 2, "Item de referência comercial"])
    ins(ITE, [3, 9, "Item de tabela inexistente"])
    ins(INC, [1, "11"])
    ins(INC, [2, "99"])
    ins(INC, [3, "12"])
    # 1 um item; 2 dois itens; 3 cliente inexistente: nenhum item (sem_item_a_gravar)
    ins(PAR, [1, 1, None])
    ins(PAR, [2, 1, 2])
    ins(PAR, [3, 9, None])
    ins(KON, [1, 2026, "A", D("10.00"), "doc 1"])
    ins(KON, [2, 2026, "A", D("5.50"), None])
    ins(KON, [3, 2026, "B", D("1.00"), "doc 3"])
    ins(USO, [1, 2026, "A"])
    ins(USO, [2, 2026, "B"])
    ins(USO, [3, 2025, "A"])
    ins(RAT, [1, "D1", D("30")])
    ins(RAT, [2, "D1", D("70")])
    ins(RAT, [3, "D2", D("1")])
    ins(RAT, [4, "D2", D("2")])
    ins(RAT, [5, "D3", D("0")])
    ins(CAB, [1])
    ins(CAB, [2])
    ins(FL1, [1, 1, dt.date(2026, 3, 5), D("10.00")])
    ins(FL1, [2, 1, None, D("2.50")])
    ins(FL2, [1, 1, dt.date(2026, 3, 1)])
    ins(COD, [1, "AB", "12"])
    ins(COD, [2, "LONGOCODIGO", "999"])
    ins(NAT, ["G1", "S1", "Natureza um"])
    ins(NAT, ["G2", "S2", "Natureza dois"])
    ins(RT2, [1, "A", 1, D("10"), "G1", "S1"])
    ins(RT2, [2, "A", 1, D("50"), "G2", "S2"])
    ins(RT2, [3, "A", 2, D("99"), "G1", "S1"])
    ins(RT2, [4, "B", 1, D("5"), "G1", "S1"])
    ins(TT, [1, "A"])
    ins(TT, [2, "B"])
    ins(TT, [3, "C"])
    # 1 diretor pelo CPF (o CNS também casa outro: vale o primeiro); 2 CPF sem profissional, diretor pelo CNS
    ins(UNI, [1, "111", "9"])
    ins(UNI, [2, "333", "9"])
    ins(PRF, [1, "111", "8"])
    ins(PRF, [2, "222", "9"])
    return {
        HOR: {"gravados": 3, "pendencias": {"pai_inexistente": 1, "duracao_ausente": 1, "virada_de_dia": 1,
                                            "restricao_destino_1048": 2}},
        CLI: {"gravados": 2, "pendencias": {}},
        FOR: {"gravados": 1, "pendencias": {}},
        TIT: {"gravados": 3, "pendencias": {"pai_inexistente": 1}},
        ITE: {"gravados": 1, "pendencias": {"licenca_nao_comprovada": 2}},
        INC: {"gravados": 2, "pendencias": {"codigo_inexistente_destino": 1, "restricao_destino_1048": 1}},
        PAR: {"gravados": 3, "pendencias": {"sem_item_a_gravar": 1}},
        KON: {"gravados": 3, "pendencias": {}},
        USO: {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}},
        RAT: {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 1}},
        CAB: {"gravados": 1, "pendencias": {"sem_filho_com_valor": 1, "restricao_destino_1048": 1}},
        COD: {"gravados": 2, "pendencias": {"codigo_derivado": 1}},
        NAT: {"gravados": 2, "pendencias": {}},
        TT: {"gravados": 2, "pendencias": {"escolha_pelo_maior": 1, "pai_inexistente": 1,
                                           "restricao_destino_1048": 1}},
        UNI: {"gravados": 2, "pendencias": {"pai_inexistente": 1}},
        PRF: {"gravados": 2, "pendencias": {}},
    }
