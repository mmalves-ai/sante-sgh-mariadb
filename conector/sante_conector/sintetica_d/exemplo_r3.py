"""Fatia `exemplo_r3`: prova os mecanismos GENÉRICOS da rodada 3 de cobertura do conector (F4), regras de data e hora,
com mapa e destino próprios (tabelas inventadas, prefixo EX3_, fora do mapa real; dados 100% falsos).

Cobre: recorrência de datas pelo ano-marca (`ano_recorrente`, `data_nao_recorrente`, `dia_recorrente`,
`mes_recorrente`, a mesma coluna para quatro destinos, com de-para de valores); `desdobrar` em PARES no destino
PRINCIPAL (`#item`/`#item2`, `#rotulo`/`#rotulo2` com partes '|'; linha sem item: sem_item_a_gravar; fim antes do
início: restrição do destino); período com a unidade em outra coluna (`#dias:V,U`: unidade lida do pai por
`ref:T>COL`, por de-para de valores ou literal `=ano`; periodo_aproximado, unidade_ausente, pai_inexistente,
valor_fora_do_dominio); data + hora HHMM com a virada da meia-noite (`#data_hora:D,H,REF`: virada_de_dia).
"""
DDL = """
CREATE TABLE EX3_FER (ID INTEGER NOT NULL PRIMARY KEY, DATA DATE, NOME VARCHAR(40));
CREATE TABLE EX3_HOR (ID INTEGER NOT NULL PRIMARY KEY, SEG_I VARCHAR(4), SEG_F VARCHAR(4), TER_I VARCHAR(4),
  TER_F VARCHAR(4), FER_I VARCHAR(4), FER_F VARCHAR(4));
CREATE TABLE EX3_UNI (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(20), CALCULO VARCHAR(10));
CREATE TABLE EX3_IDA (ID INTEGER NOT NULL PRIMARY KEY, IDADE_MIN INTEGER, UN_MIN INTEGER, IDADE_MAX DOUBLE PRECISION,
  UN_MAX INTEGER, PRAZO INTEGER, PRAZO_UN CHAR(1), ANOS SMALLINT);
CREATE TABLE EX3_ATO (ID INTEGER NOT NULL PRIMARY KEY, DATA DATE, HORA_I VARCHAR(4), HORA_F VARCHAR(4));
"""

_A = (", origem VARCHAR(20) NOT NULL, criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL,"
      " versao INT UNSIGNED NOT NULL DEFAULT 1")
DDL_DESTINO = """
CREATE TABLE ex3_dia (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, descricao VARCHAR(40) NOT NULL,
  recorrencia VARCHAR(20) NOT NULL, dia TINYINT UNSIGNED NULL, mes TINYINT UNSIGNED NULL, data DATE NULL{a},
  CONSTRAINT ck_ex3_dia_recorrencia CHECK ((recorrencia = 'anual' AND dia BETWEEN 1 AND 31 AND mes BETWEEN 1 AND 12
    AND data IS NULL) OR (recorrencia = 'data_unica' AND data IS NOT NULL AND dia IS NULL AND mes IS NULL)));
CREATE TABLE ex3_horario (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, grade INT NOT NULL,
  dia_semana TINYINT UNSIGNED NULL, dia_nao_util BOOLEAN NOT NULL DEFAULT FALSE, hora_inicio TIME NOT NULL,
  hora_fim TIME NOT NULL{a},
  CONSTRAINT ck_ex3_horario_dia CHECK ((dia_nao_util = FALSE AND dia_semana BETWEEN 1 AND 7)
    OR (dia_nao_util = TRUE AND dia_semana IS NULL)),
  CONSTRAINT ck_ex3_horario_faixa CHECK (hora_fim > hora_inicio));
CREATE TABLE ex3_faixa (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo INT NOT NULL,
  idade_minima_dias INT UNSIGNED NULL, idade_maxima_dias INT UNSIGNED NULL, prazo_dias INT UNSIGNED NULL,
  limite_dias INT UNSIGNED NULL{a});
CREATE TABLE ex3_ato (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, numero INT NOT NULL, inicio_em DATETIME NULL,
  fim_em DATETIME NULL{a});
""".format(a=_A)


def _g(t, c, regra):
    return {"tabela": t, "coluna": c, "regra": regra, "referencia": "", "depara": ""}


def _d(t, c, destino, regra="", via="", depara=""):
    return {"tabela": t, "coluna": c, "destino": destino, "regra": regra, "depara": depara, "via": via,
            "motivo": "exemplo"}


def _v(t, c, destino, origem, valor):
    return {"tabela": t, "coluna": c, "destino": destino, "valor_origem": origem, "valor_destino": valor}


FER, HOR, UNI, IDA, ATO = "EX3_FER", "EX3_HOR", "EX3_UNI", "EX3_IDA", "EX3_ATO"
_PARES = "desdobrar:SEG_I+SEG_F=2|0,TER_I+TER_F=3|0,FER_I+FER_F=|1"
MAPA_TESTE = {
    "tabelas": [
        {"tabela": FER, "tabelas_destino": "ex3_dia", "ordem": "1", "chave": "ID", "estrategia": "hash_linha"},
        {"tabela": HOR, "tabelas_destino": "ex3_horario", "ordem": "2", "chave": "ID", "estrategia": "hash_linha"},
        {"tabela": UNI, "tabelas_destino": "", "ordem": "3", "chave": "ID", "estrategia": "hash_linha"},
        {"tabela": IDA, "tabelas_destino": "ex3_faixa", "ordem": "4", "chave": "ID", "estrategia": "hash_linha"},
        {"tabela": ATO, "tabelas_destino": "ex3_ato", "ordem": "5", "chave": "ID", "estrategia": "hash_linha"}],
    "colunas": [
        _g(FER, "ID", "inteiro"), _g(FER, "DATA", "data"), _g(FER, "NOME", "texto_nome"),
        _g(HOR, "ID", "inteiro")] + [_g(HOR, c, "texto") for c in ("SEG_I", "SEG_F", "TER_I", "TER_F", "FER_I",
                                                                  "FER_F")] + [
        _g(UNI, "ID", "inteiro"), _g(UNI, "NOME", "texto"), _g(UNI, "CALCULO", "texto"),
        _g(IDA, "ID", "inteiro"), _g(IDA, "IDADE_MIN", "inteiro"), _g(IDA, "UN_MIN", "inteiro"),
        _g(IDA, "IDADE_MAX", "flutuante"), _g(IDA, "UN_MAX", "inteiro"), _g(IDA, "PRAZO", "inteiro"),
        _g(IDA, "PRAZO_UN", "codigo_char"), _g(IDA, "ANOS", "inteiro"),
        _g(ATO, "ID", "inteiro"), _g(ATO, "DATA", "data"), _g(ATO, "HORA_I", "texto"), _g(ATO, "HORA_F", "texto")],
    "colunas_decl": [
        _d(FER, "NOME", "ex3_dia.descricao", regra="texto_nome"),
        _d(FER, "DATA", "ex3_dia.recorrencia", regra="ano_recorrente:9999", depara="valores"),
        _d(FER, "DATA", "ex3_dia.dia", regra="dia_recorrente:9999"),
        _d(FER, "DATA", "ex3_dia.mes", regra="mes_recorrente:9999"),
        _d(FER, "DATA", "ex3_dia.data", regra="data_nao_recorrente:9999"),
        _d(HOR, "ID", "ex3_horario.grade", regra="inteiro"),
        _d(HOR, "#item", "ex3_horario.hora_inicio", regra="hora_hhmm", via=_PARES),
        _d(HOR, "#item2", "ex3_horario.hora_fim", regra="hora_hhmm"),
        _d(HOR, "#rotulo", "ex3_horario.dia_semana"),
        _d(HOR, "#rotulo2", "ex3_horario.dia_nao_util"),
        _d(IDA, "ID", "ex3_faixa.codigo", regra="inteiro"),
        _d(IDA, "#dias:IDADE_MIN,UN_MIN", "ex3_faixa.idade_minima_dias", via="ref:EX3_UNI>CALCULO"),
        _d(IDA, "#dias:IDADE_MAX,UN_MAX", "ex3_faixa.idade_maxima_dias", via="ref:EX3_UNI>CALCULO"),
        _d(IDA, "#dias:PRAZO,PRAZO_UN", "ex3_faixa.prazo_dias", depara="valores"),
        _d(IDA, "#dias:ANOS,=ano", "ex3_faixa.limite_dias", regra="inteiro_zero_nulo"),
        _d(ATO, "ID", "ex3_ato.numero", regra="inteiro"),
        _d(ATO, "#data_hora:DATA,HORA_I", "ex3_ato.inicio_em"),
        _d(ATO, "#data_hora:DATA,HORA_F,HORA_I", "ex3_ato.fim_em")],
    "valores": [
        _v(FER, "DATA", "ex3_dia.recorrencia", "1", "anual"), _v(FER, "DATA", "ex3_dia.recorrencia", "0", "data_unica"),
        _v(IDA, "#dias:PRAZO,PRAZO_UN", "ex3_faixa.prazo_dias", "D", "dia"),
        _v(IDA, "#dias:PRAZO,PRAZO_UN", "ex3_faixa.prazo_dias", "S", "semana")],
    "deps": [], "descartes": [],
}


def linhas(r, ins):
    import datetime as dt
    # feriados: 1 recorrente (ano-marca 9999); 2 data única; 3 sem nome (descricao NOT NULL: recusa 1048)
    ins(FER, [1, dt.date(9999, 12, 25), "Natal de exemplo"])
    ins(FER, [2, dt.date(2026, 4, 3), "Feriado de exemplo"])
    ins(FER, [3, dt.date(2026, 4, 21), None])
    # horários em pares: 1 três itens (segunda, terça, feriado); 2 nenhum (sem_item_a_gravar); 3 fim antes do início
    # (CHECK: a linha inteira é recusada); 4 só terça
    ins(HOR, [1, "0800", "1200", "0800", "1800", "0900", "1200"])
    ins(HOR, [2, None, None, "  ", None, None, None])
    ins(HOR, [3, "1300", "1200", None, None, None, None])
    ins(HOR, [4, None, None, "0700", "1100", None, None])
    # unidades de idade (pai lido só na origem, não carregado)
    ins(UNI, [1, "Dia", "Dias"])
    ins(UNI, [2, "Mes", "Meses"])
    ins(UNI, [3, "Ano", "A"])
    ins(UNI, [4, "Hora", "horas"])
    # 1: 0 dia; 12 anos (aprox.); 2 semanas pelo de-para; 1 ano literal (aprox.)
    # 2: 6 meses (aprox.); 48 horas = 2; unidade Z sem par (fora); 0 anos = sem limite (NULL)
    # 3: unidade 9 inexistente no pai; 1,5 ano = 547 (aprox.); prazo negativo (fora)
    # 4: sem unidade (unidade_ausente, duas vezes); 2 anos (aprox.)
    ins(IDA, [1, 0, 1, 12.0, 3, 2, "S", 1])
    ins(IDA, [2, 6, 2, 48.0, 4, 3, "Z", 0])
    ins(IDA, [3, 5, 9, 1.5, 3, -1, "D", None])
    ins(IDA, [4, 2, None, None, None, 1, None, 2])
    # atos: 1 termina depois da meia-noite (virada_de_dia); 2 normal; 3 início inválido (hora_invalida), fim no dia
    ins(ATO, [1, dt.date(2026, 4, 2), "2200", "0130"])
    ins(ATO, [2, dt.date(2026, 4, 2), "0800", "1000"])
    ins(ATO, [3, dt.date(2026, 4, 4), "2575", "0900"])
    return {
        FER: {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        HOR: {"gravados": 4, "pendencias": {"sem_item_a_gravar": 1, "restricao_destino_4025": 1}},
        IDA: {"gravados": 4, "pendencias": {"periodo_aproximado": 5, "valor_fora_do_dominio": 2,
                                            "pai_inexistente": 1, "unidade_ausente": 2}},
        ATO: {"gravados": 3, "pendencias": {"virada_de_dia": 1, "hora_invalida": 1}},
    }
