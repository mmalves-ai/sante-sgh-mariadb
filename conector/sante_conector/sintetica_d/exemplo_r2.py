"""Fatia `exemplo_r2`: prova os mecanismos GENÉRICOS da rodada 2 de cobertura do conector (F4), com mapa e destino
próprios (tabelas inventadas, prefixo EXR_, fora do mapa real; dados 100% falsos).

Cobre: id pelo código no cadastro do destino (`cod:<tabela>.<coluna>`, pela coluna e por literal; ausente:
codigo_inexistente_destino; repetido: pai_ambiguo); `@unico:<tabela>` (única linha ativa); referência por chave
alternativa composta `ref:T.(K1,K2)=(C1,C2)` (repetida: pai_ambiguo; ausente: pai_inexistente) e ao destino
secundário do pai `ref:T/<destino>`; data em coluna DATETIME (conciliação na meia-noite); regras `minutos_hhmm`,
`email` e `hora_hhmm` sobre texto CHAR; destino secundário gravado ANTES do principal (`antes`, com `adotar:cpf`) e
`@id:<destino>` (a pessoa do profissional criada pelo nome e CPF da própria linha, ou adotada).
"""
DDL = """
CREATE TABLE EXR_PAI (ID INTEGER NOT NULL PRIMARY KEY, EMP INTEGER, DOC INTEGER, NOME VARCHAR(30), DATA DATE,
  HORA VARCHAR(4));
CREATE TABLE EXR_FILHO (ID INTEGER NOT NULL PRIMARY KEY, EMP INTEGER, DOC INTEGER, ID_EXR_PAI INTEGER,
  TIPO VARCHAR(10), DUR VARCHAR(4), HORA CHAR(4), EMAIL VARCHAR(60));
CREATE TABLE EXR_PROF (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40), CPF VARCHAR(11), APELIDO VARCHAR(20));
"""

_A = (", origem VARCHAR(20) NOT NULL, criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL,"
      " versao INT UNSIGNED NOT NULL DEFAULT 1")
DDL_DESTINO = """
CREATE TABLE exr_tipo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(10) NOT NULL,
  nome VARCHAR(30) NOT NULL{a});
CREATE TABLE exr_sala (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(30) NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE{a});
CREATE TABLE exr_pai (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(30) NOT NULL,
  data_em DATETIME(3) NULL, entrada_em DATETIME NULL{a});
CREATE TABLE exr_pai_item (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pai_id BIGINT UNSIGNED NOT NULL,
  nome VARCHAR(30) NOT NULL{a});
CREATE TABLE exr_filho (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pai_id BIGINT UNSIGNED NULL,
  item_id BIGINT UNSIGNED NULL, tipo_id BIGINT UNSIGNED NULL, tipo_fixo_id BIGINT UNSIGNED NOT NULL,
  sala_id BIGINT UNSIGNED NOT NULL, minutos INT NULL, hora TIME NULL, email VARCHAR(60) NULL{a});
CREATE TABLE exr_pessoa (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cpf CHAR(11) NULL, nome VARCHAR(40) NOT NULL,
  UNIQUE KEY uq_exr_pessoa_cpf (cpf){a});
CREATE TABLE exr_prof (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pessoa_id BIGINT UNSIGNED NOT NULL,
  apelido VARCHAR(20) NULL, UNIQUE KEY uq_exr_prof_pessoa (pessoa_id){a});
""".format(a=_A)

# cadastro do produto já existente no destino: tipos por código (um repetido) e salas (só uma ativa)
def cpf_falso(base9):
    """CPF de 11 dígitos com dígitos verificadores válidos a partir de 9 dígitos inventados."""
    d = [int(x) for x in "%09d" % base9]
    for n in (10, 11):
        r = sum(x * p for x, p in zip(d, range(n, 1, -1))) % 11
        d.append(0 if r < 2 else 11 - r)
    return "".join(map(str, d))


CPF_EXISTENTE, CPF_NOVO = cpf_falso(333666999), cpf_falso(444777111)
PREPARO_DESTINO = """
INSERT INTO exr_tipo (codigo, nome, origem, criado_em) VALUES ('posto', 'Posto', 'produto', UTC_TIMESTAMP(3)),
  ('setor', 'Setor', 'produto', UTC_TIMESTAMP(3)), ('dup', 'Um', 'produto', UTC_TIMESTAMP(3)),
  ('dup', 'Dois', 'produto', UTC_TIMESTAMP(3));
INSERT INTO exr_pessoa (cpf, nome, origem, criado_em) VALUES ('{cpf}', 'Pessoa ja cadastrada', 'manual',
  UTC_TIMESTAMP(3));
INSERT INTO exr_sala (nome, ativo, origem, criado_em) VALUES ('Sala ativa', TRUE, 'produto', UTC_TIMESTAMP(3)),
  ('Sala antiga', FALSE, 'produto', UTC_TIMESTAMP(3));
""".replace("{cpf}", CPF_EXISTENTE)


def _g(t, c, regra):
    return {"tabela": t, "coluna": c, "regra": regra, "referencia": "", "depara": ""}


def _d(t, c, destino, regra="", via=""):
    return {"tabela": t, "coluna": c, "destino": destino, "regra": regra, "depara": "", "via": via,
            "motivo": "exemplo"}


P, F, R = "EXR_PAI", "EXR_FILHO", "EXR_PROF"
MAPA_TESTE = {
    "tabelas": [
        {"tabela": P, "tabelas_destino": "exr_pai;exr_pai_item", "ordem": "1", "chave": "ID",
         "estrategia": "hash_linha"},
        {"tabela": F, "tabelas_destino": "exr_filho", "ordem": "2", "chave": "ID", "estrategia": "hash_linha"},
        {"tabela": R, "tabelas_destino": "exr_prof;exr_pessoa", "ordem": "3", "chave": "ID",
         "estrategia": "hash_linha"}],
    "colunas": [
        _g(P, "ID", "inteiro"), _g(P, "EMP", "inteiro"), _g(P, "DOC", "inteiro"), _g(P, "NOME", "texto"),
        _g(P, "DATA", "data"), _g(P, "HORA", "texto"),
        _g(F, "ID", "inteiro"), _g(F, "EMP", "inteiro"), _g(F, "DOC", "inteiro"), _g(F, "ID_EXR_PAI", "inteiro"),
        _g(F, "TIPO", "texto"), _g(F, "DUR", "texto"), _g(F, "HORA", "texto_char"), _g(F, "EMAIL", "texto"),
        _g(R, "ID", "inteiro"), _g(R, "NOME", "texto_nome"), _g(R, "CPF", "texto"), _g(R, "APELIDO", "texto")],
    "colunas_decl": [
        _d(P, "NOME", "exr_pai.nome"),
        _d(P, "DATA", "exr_pai.data_em", regra="data"),
        _d(P, "#data_hora:DATA,HORA", "exr_pai.entrada_em"),
        _d(P, "@id", "exr_pai_item.pai_id"),
        _d(P, "NOME", "exr_pai_item.nome"),
        _d(F, "EMP", "exr_filho.pai_id", via="ref:EXR_PAI.(EMP,DOC)=(EMP,DOC)"),
        _d(F, "ID_EXR_PAI", "exr_filho.item_id", via="ref:EXR_PAI/exr_pai_item"),
        _d(F, "TIPO", "exr_filho.tipo_id", via="cod:exr_tipo.codigo"),
        _d(F, "=posto", "exr_filho.tipo_fixo_id", via="cod:exr_tipo.codigo"),
        _d(F, "@unico:exr_sala", "exr_filho.sala_id"),
        _d(F, "DUR", "exr_filho.minutos", regra="minutos_hhmm"),
        _d(F, "HORA", "exr_filho.hora", regra="hora_hhmm"),
        _d(F, "EMAIL", "exr_filho.email", regra="email"),
        _d(R, "@id:exr_pessoa", "exr_prof.pessoa_id"),
        _d(R, "APELIDO", "exr_prof.apelido"),
        _d(R, "CPF", "exr_pessoa.cpf", regra="cpf", via="antes;adotar:cpf"),
        _d(R, "NOME", "exr_pessoa.nome", regra="texto_nome")],
    "valores": [], "deps": [], "descartes": [],
}


def linhas(r, ins):
    import datetime as dt
    # pais: (1,11) repetido -> pai_ambiguo para quem casa por EMP+DOC; 1 sem data
    # entrada: 1 data e hora 0930; 2 hora inválida (hora_invalida, NULL); 3 sem data (NULL)
    ins(P, [1, 1, 10, "Pai um", dt.date(2026, 4, 2), "0930"])
    ins(P, [2, 1, 11, "Pai dois", dt.date(2026, 4, 3), "2575"])
    ins(P, [3, 1, 11, "Pai tres", None, "0800"])
    # filho 1 tudo resolvido; 2 pai ambíguo, tipo ausente, duração, hora e e-mail inválidos; 3 pai inexistente (nas
    # duas referências), tipo repetido, duração 0000 (NULL)
    ins(F, [1, 1, 10, 1, "posto", "0130", "0800", "pessoa@exemplo.com"])
    ins(F, [2, 1, 11, 2, "zzz", "0075", "2500", "semarroba"])
    ins(F, [3, 9, 99, 7, "dup", "0000", None, None])
    # profissionais: 1 cria a pessoa; 2 adota a que já estava no destino; 3 tem o CPF do 1 e adota a pessoa criada por
    # ele, mas o profissional repete a pessoa (UNIQUE): recusado pela restrição do destino
    ins(R, [1, "Profissional Um", CPF_NOVO, "Um"])
    ins(R, [2, "Profissional Dois", CPF_EXISTENTE, "Dois"])
    ins(R, [3, "Profissional Tres", CPF_NOVO, "Tres"])
    return {
        R: {"gravados": 2, "pendencias": {"adotado_existente": 1, "mescla_conflito_origem_guardada": 1, "restricao_destino_1062": 1}},
        P: {"gravados": 3, "pendencias": {"hora_invalida": 1}},
        F: {"gravados": 3, "pendencias": {"pai_ambiguo": 2, "codigo_inexistente_destino": 1,
                                          "valor_fora_do_dominio": 2, "hora_invalida": 1, "pai_inexistente": 2}},
    }
