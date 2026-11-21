"""Fatia `exemplo_l5`: prova os recursos genéricos que a integração do L5 acrescentou ao motor (carga_mapa.py), com
mapa e destino próprios (tabelas inventadas, prefixo EX5_, fora do mapa real; dados 100% falsos).

Cobre: referência declarada na `via` (`ref:TBUSERS`, pela chave de login do pai); de-para de valores próprio
(`depara=valores`) com valor sem par; `@estabelecimento`; literal presumido `=~...` (pendência `valor_presumido`);
literal convertido ao tipo do destino (`=5` em INT); inteiro gravado em coluna de texto (soma de controle pelo tipo do
destino); regras `booleano_ai` e `inteiro_zero_nulo`; colisão de caixa num código de chave única
(`codigo_colisao_caixa` nas duas linhas, nenhuma vence); `#seq:<COLUNA>` estável no diferencial.
"""
DDL = """
CREATE TABLE EX5_PERFIL (ID INTEGER NOT NULL PRIMARY KEY, COD CHAR(10), NOME VARCHAR(40), SIT CHAR(1), ATV CHAR(1),
  LIMITE INTEGER);
CREATE TABLE EX5_ACESSO (ID INTEGER NOT NULL PRIMARY KEY, ID_EX5_PERFIL INTEGER, USUARIO VARCHAR(31));
"""
PAIS_EXTERNOS = {"TBUSERS": ["ana", "bia"]}

_AUDIT = (", origem VARCHAR(20) NOT NULL, criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL,"
          " versao INT UNSIGNED NOT NULL DEFAULT 1")
DDL_DESTINO = """
CREATE TABLE estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(40) NOT NULL);
CREATE TABLE ex5_perfil (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(10) NOT NULL,
  nome VARCHAR(40) NOT NULL, situacao VARCHAR(10) NOT NULL DEFAULT 'ativo', ativo BOOLEAN NULL, limite INT NULL,
  estabelecimento_id BIGINT UNSIGNED NOT NULL, tipo VARCHAR(20) NOT NULL, peso INT NOT NULL,
  codigo_origem VARCHAR(10) NOT NULL, UNIQUE KEY uq_ex5_perfil_codigo (codigo){a});
CREATE TABLE ex5_acesso (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, perfil_id BIGINT UNSIGNED NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL, sequencia INT NOT NULL, UNIQUE KEY uq_ex5_acesso (perfil_id, sequencia){a});
""".format(a=_AUDIT)
PREPARO_DESTINO = "INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')"


def _g(t, c, regra, ref=""):
    return {"tabela": t, "coluna": c, "regra": regra, "referencia": ref, "depara": ""}


def _d(t, c, destino, regra="", dp="", via=""):
    return {"tabela": t, "coluna": c, "destino": destino, "regra": regra, "depara": dp, "via": via,
            "motivo": "exemplo"}


def _v(t, c, destino, de, para):
    return {"tabela": t, "coluna": c, "destino": destino, "valor_origem": de, "valor_destino": para,
            "motivo": "exemplo"}


P, A = "EX5_PERFIL", "EX5_ACESSO"
MAPA_TESTE = {
    "tabelas": [
        {"tabela": P, "tabelas_destino": "ex5_perfil", "ordem": "1", "chave": "ID", "estrategia": "hash_linha"},
        {"tabela": A, "tabelas_destino": "ex5_acesso", "ordem": "2", "chave": "ID", "estrategia": "hash_linha"}],
    "colunas": [
        _g(P, "ID", "inteiro"), _g(P, "COD", "codigo_char"), _g(P, "NOME", "texto_nome"), _g(P, "SIT", "texto_char"),
        _g(P, "ATV", "texto_char"), _g(P, "LIMITE", "inteiro"),
        _g(A, "ID", "inteiro"), _g(A, "ID_EX5_PERFIL", "chave_origem", P), _g(A, "USUARIO", "texto")],
    "colunas_decl": [
        _d(P, "COD", "ex5_perfil.codigo"), _d(P, "NOME", "ex5_perfil.nome"),
        _d(P, "SIT", "ex5_perfil.situacao", dp="valores"), _d(P, "ATV", "ex5_perfil.ativo", regra="booleano_ai"),
        _d(P, "LIMITE", "ex5_perfil.limite", regra="inteiro_zero_nulo"),
        _d(P, "@estabelecimento", "ex5_perfil.estabelecimento_id"), _d(P, "=~geral", "ex5_perfil.tipo"),
        _d(P, "=5", "ex5_perfil.peso"), _d(P, "ID", "ex5_perfil.codigo_origem", regra="inteiro"),
        _d(A, "ID_EX5_PERFIL", "ex5_acesso.perfil_id"), _d(A, "USUARIO", "ex5_acesso.usuario_id", via="ref:TBUSERS"),
        _d(A, "#seq:ID_EX5_PERFIL", "ex5_acesso.sequencia")],
    "valores": [_v(P, "SIT", "ex5_perfil.situacao", "A", "ativo"), _v(P, "SIT", "ex5_perfil.situacao", "I", "inativo")],
    "deps": [],
    "descartes": [],
}


def linhas(r, ins):
    # perfis: 1 e 2 só diferem pela caixa do código (as duas recusadas); 4 com situação sem par no de-para (fica com
    # o padrão do destino, com pendência)
    for x in [(1, "ADM", "Administração", "A", "A", 0), (2, "adm", "Administração mínima", "A", "A", 5),
              (3, "MED", "Médicos", "I", "I", 3), (4, "ENF", "Enfermagem", "X", "A", 0),
              (5, "NUT", "Nutrição", "A", None, 2)]:
        ins(P, list(x))
    # acessos: 4 aponta perfil recusado (pai_pendente); 5 usuário inexistente (NULL em NOT NULL: recusa); a
    # sequência por perfil conta todas as linhas lidas
    for x in [(1, 3, "ana"), (2, 3, "bia"), (3, 5, "ana"), (4, 1, "ana"), (5, 3, "ze"), (6, 3, "bia")]:
        ins(A, list(x))
    return {
        P: {"gravados": 3, "pendencias": {"codigo_colisao_caixa": 2, "valor_presumido": 3,
                                          "valor_fora_do_dominio": 1}},
        A: {"gravados": 4, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1, "restricao_destino_1048": 1}},
    }
