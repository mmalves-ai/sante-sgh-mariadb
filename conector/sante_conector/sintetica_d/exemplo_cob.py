"""Fatia `exemplo_cob`: prova os mecanismos GENÉRICOS da rodada de cobertura total do conector (F4), com mapa e
destino próprios (tabelas inventadas, prefixo EXC_, fora do mapa real; dados 100% falsos).

Cobre: referência por chave composta `ref:T(C1,C2)`, por chave alternativa `ref:T.K` (valor repetido: pai_ambiguo) e
encadeada `ref:T>X>U` (terminada em tabela) e `ref:T>X` (terminada em coluna); `=@data_carga` e `@vigencia_carga`
(vigencia_sem_fonte); `#sha256`, `#codigo_derivado` (codigo_derivado), `#cofre` (segredo nunca gravado:
segredo_aguarda_cofre); `#retrato` (JSON da linha); regras piso (valor_elevado_ao_minimo), faixa, texto_resumo (texto_resumido) e
minutos_em_timestamp (hora_com_data); destino secundário opcional; desdobrar colunas em linhas (#item, #rotulo); adoção
pelo CPF de uma pessoa que já existe no destino (adotado_existente), sem sobrescrever; complemento da linha do pai
por UPDATE (`complementa`; pai não carregado: pai_inexistente).
"""
DDL = """
CREATE TABLE EXC_GRUPO (EMP INTEGER NOT NULL, COD VARCHAR(10) NOT NULL, NOME VARCHAR(60), SIGLA CHAR(3),
  TEXTO VARCHAR(200), SENHA VARCHAR(20), TEMPO TIMESTAMP, MINIMO INTEGER, FAIXA NUMERIC(9,2), OBS VARCHAR(40),
  SEG CHAR(1), TER CHAR(1), QUA CHAR(1), PRIMARY KEY (EMP, COD));
CREATE TABLE EXC_PESSOA (ID INTEGER NOT NULL PRIMARY KEY, CPF VARCHAR(14), NOME VARCHAR(40));
CREATE TABLE EXC_SUB (ID INTEGER NOT NULL PRIMARY KEY, ID_EXC_PESSOA INTEGER, CODIGO VARCHAR(5));
CREATE TABLE EXC_ITEM (ID INTEGER NOT NULL PRIMARY KEY, EMP INTEGER, COD_GRUPO VARCHAR(10), SIGLA CHAR(3),
  ID_EXC_SUB INTEGER);
CREATE TABLE EXC_COMPL (EMP INTEGER NOT NULL, COD VARCHAR(10) NOT NULL, TITULO VARCHAR(30), PRIMARY KEY (EMP, COD));
"""

_A = (", origem VARCHAR(20) NOT NULL, criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL,"
      " versao INT UNSIGNED NOT NULL DEFAULT 1")
DDL_DESTINO = """
CREATE TABLE exc_grupo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(12) NOT NULL,
  nome VARCHAR(60) NOT NULL, hash_texto CHAR(64) NULL, resumo VARCHAR(20) NULL, senha_ref VARCHAR(100) NULL,
  minutos INT NULL, minimo INT NULL, fator DECIMAL(9,2) NULL, carregado_em DATE NOT NULL, vigencia_inicio DATE NOT NULL,
  titulo VARCHAR(30) NULL,
  UNIQUE KEY uq_exc_grupo_codigo (codigo), CONSTRAINT ck_exc_grupo_minimo CHECK (minimo IS NULL OR minimo >= 8){a});
CREATE TABLE exc_grupo_detalhe (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, grupo_id BIGINT UNSIGNED NOT NULL,
  obs VARCHAR(40) NOT NULL{a});
CREATE TABLE exc_grupo_dia (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, grupo_id BIGINT UNSIGNED NOT NULL,
  dia VARCHAR(3) NOT NULL, marcado BOOLEAN NOT NULL, UNIQUE KEY uq_exc_grupo_dia (grupo_id, dia){a});
CREATE TABLE exc_pessoa (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cpf CHAR(11) NULL, nome VARCHAR(40) NOT NULL,
  UNIQUE KEY uq_exc_pessoa_cpf (cpf){a});
CREATE TABLE exc_sub (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pessoa_id BIGINT UNSIGNED NULL,
  codigo VARCHAR(5) NOT NULL{a});
CREATE TABLE exc_item (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, grupo_id BIGINT UNSIGNED NULL,
  grupo_sigla_id BIGINT UNSIGNED NULL, pessoa_id BIGINT UNSIGNED NULL, sub_codigo VARCHAR(5) NULL,
  dados LONGTEXT NULL{a});
""".format(a=_A)


def cpf_falso(base9):
    """CPF de 11 dígitos com dígitos verificadores válidos a partir de 9 dígitos inventados."""
    d = [int(x) for x in "%09d" % base9]
    for n in (10, 11):
        r = sum(x * p for x, p in zip(d, range(n, 1, -1))) % 11
        d.append(0 if r < 2 else 11 - r)
    return "".join(map(str, d))


CPF_EXISTENTE, CPF_NOVO = cpf_falso(111444777), cpf_falso(222555888)
PREPARO_DESTINO = ("INSERT INTO exc_pessoa (cpf, nome, origem, criado_em) VALUES ('%s', 'Pessoa ja cadastrada',"
                   " 'manual', UTC_TIMESTAMP(3))" % CPF_EXISTENTE)


def _g(t, c, regra):
    return {"tabela": t, "coluna": c, "regra": regra, "referencia": "", "depara": ""}


def _d(t, c, destino, regra="", via=""):
    return {"tabela": t, "coluna": c, "destino": destino, "regra": regra, "depara": "", "via": via,
            "motivo": "exemplo"}


G, P, S, I, C = "EXC_GRUPO", "EXC_PESSOA", "EXC_SUB", "EXC_ITEM", "EXC_COMPL"
MAPA_TESTE = {
    "tabelas": [
        {"tabela": G, "tabelas_destino": "exc_grupo;exc_grupo_detalhe;exc_grupo_dia", "ordem": "1", "chave": "EMP,COD",
         "estrategia": "hash_linha"},
        {"tabela": P, "tabelas_destino": "exc_pessoa", "ordem": "2", "chave": "ID", "estrategia": "hash_linha"},
        {"tabela": S, "tabelas_destino": "exc_sub", "ordem": "3", "chave": "ID", "estrategia": "hash_linha"},
        {"tabela": I, "tabelas_destino": "exc_item", "ordem": "4", "chave": "ID", "estrategia": "hash_linha"},
        {"tabela": C, "tabelas_destino": "exc_grupo", "ordem": "5", "chave": "EMP,COD", "estrategia": "hash_linha"}],
    "colunas": [
        _g(G, "EMP", "inteiro"), _g(G, "COD", "texto"), _g(G, "NOME", "texto_nome"), _g(G, "SIGLA", "texto_char"),
        _g(G, "TEXTO", "texto"), _g(G, "SENHA", "texto"), _g(G, "TEMPO", "data_hora"), _g(G, "MINIMO", "inteiro"),
        _g(G, "FAIXA", "decimal"), _g(G, "OBS", "texto"), _g(G, "SEG", "booleano_sn"), _g(G, "TER", "booleano_sn"),
        _g(G, "QUA", "booleano_sn"),
        _g(P, "ID", "inteiro"), _g(P, "CPF", "texto"), _g(P, "NOME", "texto_nome"),
        _g(S, "ID", "inteiro"), _g(S, "ID_EXC_PESSOA", "inteiro"), _g(S, "CODIGO", "texto"),
        _g(I, "ID", "inteiro"), _g(I, "EMP", "inteiro"), _g(I, "COD_GRUPO", "texto"), _g(I, "SIGLA", "texto_char"),
        _g(I, "ID_EXC_SUB", "inteiro"),
        _g(C, "EMP", "inteiro"), _g(C, "COD", "texto"), _g(C, "TITULO", "texto")],
    "colunas_decl": [
        _d(G, "#codigo_derivado:NOME:12", "exc_grupo.codigo", regra="texto_nome"),
        _d(G, "NOME", "exc_grupo.nome"),
        _d(G, "#sha256:TEXTO", "exc_grupo.hash_texto"),
        _d(G, "TEXTO", "exc_grupo.resumo", regra="texto_resumo:20"),
        _d(G, "#cofre:SENHA", "exc_grupo.senha_ref"),
        _d(G, "TEMPO", "exc_grupo.minutos", regra="minutos_em_timestamp"),
        _d(G, "MINIMO", "exc_grupo.minimo", regra="piso:8"),
        _d(G, "FAIXA", "exc_grupo.fator", regra="faixa:0,100"),
        _d(G, "=@data_carga", "exc_grupo.carregado_em"),
        _d(G, "@vigencia_carga", "exc_grupo.vigencia_inicio"),
        _d(G, "@id", "exc_grupo_detalhe.grupo_id", via="opcional"),
        _d(G, "OBS", "exc_grupo_detalhe.obs"),
        _d(G, "@id", "exc_grupo_dia.grupo_id"),
        _d(G, "#rotulo", "exc_grupo_dia.dia"),
        _d(G, "#item", "exc_grupo_dia.marcado", regra="booleano_sn", via="desdobrar:SEG=seg,TER=ter,QUA=qua"),
        _d(P, "CPF", "exc_pessoa.cpf", regra="cpf", via="adotar:cpf"),
        _d(P, "NOME", "exc_pessoa.nome"),
        _d(S, "ID_EXC_PESSOA", "exc_sub.pessoa_id", via="ref:EXC_PESSOA"),
        _d(S, "CODIGO", "exc_sub.codigo"),
        _d(I, "EMP", "exc_item.grupo_id", via="ref:EXC_GRUPO(EMP,COD_GRUPO)"),
        _d(I, "SIGLA", "exc_item.grupo_sigla_id", via="ref:EXC_GRUPO.SIGLA"),
        _d(I, "ID_EXC_SUB", "exc_item.pessoa_id", via="ref:EXC_SUB>ID_EXC_PESSOA>EXC_PESSOA"),
        _d(I, "ID_EXC_SUB", "exc_item.sub_codigo", via="ref:EXC_SUB>CODIGO"),
        _d(I, "#retrato", "exc_item.dados"),
        _d(C, "EMP", "exc_grupo.id", via="ref:EXC_GRUPO(EMP,COD);complementa"),
        _d(C, "TITULO", "exc_grupo.titulo")],
    "valores": [], "deps": [], "descartes": [],
}

H = "1899-12-30 "


def linhas(r, ins):
    import datetime as dt
    from decimal import Decimal as D
    ts = lambda s: dt.datetime.strptime(s, "%Y-%m-%d %H:%M")  # noqa: E731
    # g1: texto resumido, segredo, 90 minutos, dois dias marcados, detalhe; g2: código derivado (nome longo),
    # duração com data (hora_com_data), mínimo elevado, fator fora da faixa, sem detalhe nem dias; g3: sigla repetida
    # (pai_ambiguo para quem a usa), duração 00:00 (NULL), um dia marcado
    ins(G, [1, "A01", "Grupo Alfa", "ALF", "Texto longo do grupo alfa com várias palavras", "naoler", ts(H + "01:30"),
            10, D("50.50"), "obs alfa", "S", "N", "S"])
    ins(G, [1, "B02", "Grupo Beta com nome bem comprido", "BET", "curto", None, ts("2026-01-05 00:45"), 3, D("150.00"),
            None, None, None, None])
    ins(G, [2, "A01", "Grupo Gama", "ALF", "gama", None, ts(H + "00:00"), None, None, "obs gama", "N", "S", None])
    # pessoas: 1 já existe no destino pelo CPF (adotada, nada sobrescrito); 3 com CPF inválido
    ins(P, [1, CPF_EXISTENTE, "Pessoa Um"])
    ins(P, [2, CPF_NOVO, "Pessoa Dois"])
    ins(P, [3, "123", "Pessoa Tres"])
    ins(S, [1, 1, "S1"])
    ins(S, [2, 2, "S2"])
    ins(S, [3, 9, "S3"])          # pessoa 9 não existe: pai_inexistente
    # itens: 1 tudo resolvido; 2 sigla ambígua; 3 grupo, sigla e pessoa da cadeia inexistentes; 4 sub inexistente
    ins(I, [1, 1, "A01", "BET", 1])
    ins(I, [2, 2, "A01", "ALF", 2])
    ins(I, [3, 1, "Z99", "XXX", 3])
    ins(I, [4, None, None, None, 7])
    # complemento: o título do grupo 1|A01 vai para a linha já gravada; 9|X não tem pai (recusa)
    ins(C, [1, "A01", "Titulo alfa"])
    ins(C, [9, "X", "Sem pai"])
    return {
        G: {"gravados": 3, "pendencias": {"texto_resumido": 1, "segredo_aguarda_cofre": 1, "vigencia_sem_fonte": 3,
                                          "codigo_derivado": 1, "hora_com_data": 1, "valor_elevado_ao_minimo": 1,
                                          "valor_fora_do_dominio": 1}},
        P: {"gravados": 3, "pendencias": {"adotado_existente": 1, "documento_invalido": 1}},
        S: {"gravados": 3, "pendencias": {"pai_inexistente": 1}},
        I: {"gravados": 4, "pendencias": {"pai_ambiguo": 1, "pai_inexistente": 5}},
        C: {"gravados": 1, "pendencias": {"pai_inexistente": 1}},
    }
