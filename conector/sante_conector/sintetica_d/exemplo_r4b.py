"""Fatia `exemplo_r4b`: prova o RESÍDUO do motor da rodada 4 de cobertura do conector (F4): os pedidos de regra e
mecanismo que ainda deixavam tabelas bloqueadas. Mapa e destino próprios (tabelas inventadas, prefixo EX5_, fora do
mapa real; dados 100% falsos).

Cobre: regra declarada sobre `=@data_carga` (competência do mês da carga); `#dif` e `#soma` (aritmética entre colunas
da linha, com `piso:0` no resultado); `exige_dominio` (código de estado sem par recusa a linha); `senao` (a
concorrente que acha o valor apaga a pendência de domínio da anterior) e a presumida `=~x` só quando é a gravada;
`por_pai` (a mesma pergunta em vários modelos: uma opção por modelo).
"""
DDL = """
CREATE TABLE EX5_SAL (ID INTEGER NOT NULL PRIMARY KEY, QTDE INTEGER);
CREATE TABLE EX5_PAR (ID INTEGER NOT NULL PRIMARY KEY, VALOR NUMERIC(10,2), PAGO NUMERIC(10,2));
CREATE TABLE EX5_EST (ID INTEGER NOT NULL PRIMARY KEY, SIT CHAR(1));
CREATE TABLE EX5_FRQ (ID INTEGER NOT NULL PRIMARY KEY, NUM INTEGER, NOME VARCHAR(10));
CREATE TABLE EX5_PER (ID INTEGER NOT NULL PRIMARY KEY, PERG INTEGER, MODELO INTEGER);
CREATE TABLE EX5_RES (ID INTEGER NOT NULL PRIMARY KEY, PERG INTEGER, TXT VARCHAR(10));
"""

_A = (", origem VARCHAR(20) NOT NULL, criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL,"
      " versao INT UNSIGNED NOT NULL DEFAULT 1")
DDL_DESTINO = """
CREATE TABLE ex5_saldo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, competencia DATE NOT NULL,
  quantidade INT NULL{a}, CONSTRAINT ck_ex5_saldo_dia1 CHECK (DAY(competencia) = 1));
CREATE TABLE ex5_parcela (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, saldo DECIMAL(10,2) NULL,
  total DECIMAL(10,2) NULL{a});
CREATE TABLE ex5_estado (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  situacao VARCHAR(10) NOT NULL DEFAULT 'aberto'{a});
CREATE TABLE ex5_frequencia (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, tipo VARCHAR(20) NULL{a});
CREATE TABLE ex5_campo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pergunta INT NOT NULL, modelo INT NOT NULL{a});
CREATE TABLE ex5_opcao (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, campo_id BIGINT UNSIGNED NOT NULL,
  rotulo VARCHAR(10) NULL{a}, CONSTRAINT fk_ex5_opcao_campo FOREIGN KEY (campo_id) REFERENCES ex5_campo (id));
""".format(a=_A)


def _g(t, c, regra):
    return {"tabela": t, "coluna": c, "regra": regra, "referencia": "", "depara": ""}


def _d(t, c, destino, regra="", via="", depara=""):
    return {"tabela": t, "coluna": c, "destino": destino, "regra": regra, "depara": depara, "via": via,
            "motivo": "exemplo"}


def _v(t, c, destino, origem, valor):
    return {"tabela": t, "coluna": c, "destino": destino, "valor_origem": origem, "valor_destino": valor}


def _t(t, destinos, ordem, chave):
    return {"tabela": t, "tabelas_destino": destinos, "ordem": str(ordem), "chave": chave, "estrategia": "hash_linha"}


SAL, PAR, EST, FRQ, PER, RES = "EX5_SAL", "EX5_PAR", "EX5_EST", "EX5_FRQ", "EX5_PER", "EX5_RES"
MAPA_TESTE = {
    "tabelas": [_t(SAL, "ex5_saldo", 1, "ID"), _t(PAR, "ex5_parcela", 2, "ID"), _t(EST, "ex5_estado", 3, "ID"),
                _t(FRQ, "ex5_frequencia", 4, "ID"), _t(PER, "ex5_campo", 5, "ID"), _t(RES, "ex5_opcao", 6, "ID")],
    "colunas": [
        _g(SAL, "ID", "inteiro"), _g(SAL, "QTDE", "inteiro"),
        _g(PAR, "ID", "inteiro"), _g(PAR, "VALOR", "decimal"), _g(PAR, "PAGO", "decimal"),
        _g(EST, "ID", "inteiro"), _g(EST, "SIT", "codigo_char"),
        _g(FRQ, "ID", "inteiro"), _g(FRQ, "NUM", "inteiro"), _g(FRQ, "NOME", "texto"),
        _g(PER, "ID", "inteiro"), _g(PER, "PERG", "inteiro"), _g(PER, "MODELO", "inteiro"),
        _g(RES, "ID", "inteiro"), _g(RES, "PERG", "inteiro"), _g(RES, "TXT", "texto")],
    "colunas_decl": [
        # saldo atual: a competência é o mês da carga (CHECK dia 1)
        _d(SAL, "=@data_carga", "ex5_saldo.competencia", regra="data_primeiro_dia_mes"),
        _d(SAL, "QTDE", "ex5_saldo.quantidade", regra="inteiro"),
        # parcela: saldo = valor - pago (nunca negativo), total = valor + pago
        _d(PAR, "#dif:VALOR,PAGO", "ex5_parcela.saldo", regra="piso:0"),
        _d(PAR, "#soma:VALOR,PAGO", "ex5_parcela.total"),
        # estado: o código sem par recusa a linha (nunca o padrão do destino em silêncio)
        _d(EST, "SIT", "ex5_estado.situacao", depara="valores", via="exige_dominio"),
        # frequência: pelo número; sem ele, pelo nome (senao); o resto presumido
        _d(FRQ, "NUM", "ex5_frequencia.tipo", depara="valores"),
        _d(FRQ, "NOME", "ex5_frequencia.tipo", depara="valores", via="senao"),
        _d(FRQ, "=~a_criterio", "ex5_frequencia.tipo"),
        _d(PER, "PERG", "ex5_campo.pergunta", regra="inteiro"),
        _d(PER, "MODELO", "ex5_campo.modelo", regra="inteiro"),
        # opção de resposta: a pergunta está em vários modelos; uma opção por campo (pai) da chave alternativa
        _d(RES, "PERG", "ex5_opcao.campo_id", via="ref:EX5_PER.PERG;por_pai"),
        _d(RES, "TXT", "ex5_opcao.rotulo")],
    "valores": [_v(EST, "SIT", "ex5_estado.situacao", "A", "aberto"),
                _v(EST, "SIT", "ex5_estado.situacao", "F", "fechado"),
                _v(FRQ, "NUM", "ex5_frequencia.tipo", "1", "vezes_dia"),
                _v(FRQ, "NOME", "ex5_frequencia.tipo", "SN", "se_necessario")],
    "deps": [], "descartes": [],
}


def linhas(r, ins):
    import decimal
    D = decimal.Decimal
    ins(SAL, [1, 5])
    ins(SAL, [2, 7])
    # 1 saldo 6; 2 pago a mais: saldo 0 (valor_elevado_ao_minimo); 3 sem valores: NULL
    ins(PAR, [1, D("10.00"), D("4.00")])
    ins(PAR, [2, D("5.00"), D("8.00")])
    ins(PAR, [3, None, None])
    # 3 código sem par: recusada
    ins(EST, [1, "A"])
    ins(EST, [2, "F"])
    ins(EST, [3, "X"])
    # 1 pelo número; 2 número sem par, mas o nome casa (a pendência do número sai); 3 nada casa: presumida
    ins(FRQ, [1, 1, None])
    ins(FRQ, [2, 7, "SN"])
    ins(FRQ, [3, None, "ZZ"])
    ins(PER, [1, 10, 1])
    ins(PER, [2, 10, 2])
    ins(PER, [3, 20, 1])
    # 1 pergunta em dois modelos: duas opções; 2 uma; 3 pergunta inexistente; 4 sem pergunta (nenhum item)
    ins(RES, [1, 10, "Sim"])
    ins(RES, [2, 20, "Nao"])
    ins(RES, [3, 99, "x"])
    ins(RES, [4, None, "y"])
    return {
        SAL: {"gravados": 2, "pendencias": {}},
        PAR: {"gravados": 3, "pendencias": {"valor_elevado_ao_minimo": 1}},
        EST: {"gravados": 2, "pendencias": {"valor_fora_do_dominio": 1}},
        FRQ: {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "valor_presumido": 1}},
        PER: {"gravados": 3, "pendencias": {}},
        RES: {"gravados": 3, "pendencias": {"pai_inexistente": 1, "sem_item_a_gravar": 1}},
    }
