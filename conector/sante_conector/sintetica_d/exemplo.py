"""Fatia `exemplo`: prova o mecanismo da carga dirigida pelo mapa (carga_mapa.py) com mapa e destino próprios.

Tabelas inventadas (prefixo EX_, fora do mapa real) e dados 100% falsos. Cobre: regra de texto, nome, S/N, data
sentinela, hora HHMM, decimal, BLOB de texto; de-para oficial (banco) com código ausente; referência a pai recusado
(pai_pendente em cadeia), a pai inexistente e a pai de fora da fatia (PAIS_EXTERNOS); autorreferência (duas fases);
dois destinos com `@id`; literal `=...`; restrição do destino (NOT NULL e tamanho) recusando só a linha; tabela sem
chave com linhas repetidas. As fatias reais seguem a mesma forma, sem MAPA_TESTE nem DDL_DESTINO (usam o mapa e o
DDL do modelo).
"""
import datetime
import decimal

DDL = """
CREATE TABLE EX_CAD_GRUPO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(30), ID_EX_CAD_GRUPO INTEGER, ATIVO CHAR(1));
CREATE TABLE EX_CAD_ITEM (ID INTEGER NOT NULL PRIMARY KEY, ID_EX_CAD_GRUPO INTEGER, DESCR VARCHAR(40), DT DATE,
  HHMM INTEGER, BANCO SMALLINT, VALOR NUMERIC(12,2), ATIVO CHAR(1), ID_TBUSERS SMALLINT, OBS BLOB SUB_TYPE 1);
CREATE TABLE EX_CAD_NOTA (ID_EX_CAD_ITEM INTEGER, TEXTO VARCHAR(20));
"""
PAIS_EXTERNOS = {"TBUSERS": ["1", "2"]}

_AUDIT = (", origem VARCHAR(20) NOT NULL, criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL,"
          " versao INT UNSIGNED NOT NULL DEFAULT 1")
DDL_DESTINO = """
CREATE TABLE ex_grupo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(30) NOT NULL,
  grupo_pai_id BIGINT UNSIGNED NULL, ativo BOOLEAN NULL{a});
CREATE TABLE ex_item (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, grupo_id BIGINT UNSIGNED NULL,
  descricao VARCHAR(20) NULL, data_ref DATE NULL, hora_ref TIME NULL, banco_id BIGINT UNSIGNED NULL,
  valor DECIMAL(12,2) NULL, ativo BOOLEAN NULL, usuario_id BIGINT UNSIGNED NULL, tipo VARCHAR(10) NOT NULL{a});
CREATE TABLE ex_item_extra (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, item_id BIGINT UNSIGNED NOT NULL,
  observacao TEXT NULL, criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1);
CREATE TABLE ex_nota (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, item_id BIGINT UNSIGNED NULL,
  texto VARCHAR(40) NULL{a});
CREATE TABLE banco (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo_compensacao CHAR(3) NOT NULL,
  criado_em DATETIME(3) NOT NULL);
""".format(a=_AUDIT)
PREPARO_DESTINO = "INSERT INTO banco (codigo_compensacao, criado_em) VALUES ('001', UTC_TIMESTAMP(3)), ('237', UTC_TIMESTAMP(3))"


def _g(t, c, regra, ref="", dp=""):
    return {"tabela": t, "coluna": c, "regra": regra, "referencia": ref, "depara": dp}


def _d(t, c, destino):
    return {"tabela": t, "coluna": c, "destino": destino, "regra": "", "depara": "", "via": "", "motivo": "exemplo"}


G, I, N = "EX_CAD_GRUPO", "EX_CAD_ITEM", "EX_CAD_NOTA"
MAPA_TESTE = {
    "tabelas": [
        {"tabela": G, "tabelas_destino": "ex_grupo", "ordem": "1", "chave": "ID", "estrategia": "hash_linha"},
        {"tabela": I, "tabelas_destino": "ex_item;ex_item_extra", "ordem": "2", "chave": "ID",
         "estrategia": "hash_linha"},
        {"tabela": N, "tabelas_destino": "ex_nota", "ordem": "3", "chave": "", "estrategia": "hash_linha_sem_chave"}],
    "colunas": [
        _g(G, "ID", "inteiro"), _g(G, "NOME", "texto_nome"), _g(G, "ID_EX_CAD_GRUPO", "chave_origem", G),
        _g(G, "ATIVO", "booleano_sn"),
        _g(I, "ID", "inteiro"), _g(I, "ID_EX_CAD_GRUPO", "chave_origem", G), _g(I, "DESCR", "texto"),
        _g(I, "DT", "data"), _g(I, "HHMM", "hora_hhmm"), _g(I, "BANCO", "inteiro", dp="banco"),
        _g(I, "VALOR", "decimal"), _g(I, "ATIVO", "booleano_sn"), _g(I, "ID_TBUSERS", "chave_origem", "TBUSERS"),
        _g(I, "OBS", "texto_longo"),
        _g(N, "ID_EX_CAD_ITEM", "chave_origem", I), _g(N, "TEXTO", "texto")],
    "colunas_decl": [
        _d(G, "NOME", "ex_grupo.nome"), _d(G, "ID_EX_CAD_GRUPO", "ex_grupo.grupo_pai_id"), _d(G, "ATIVO", "ex_grupo.ativo"),
        _d(I, "ID_EX_CAD_GRUPO", "ex_item.grupo_id"), _d(I, "DESCR", "ex_item.descricao"), _d(I, "DT", "ex_item.data_ref"),
        _d(I, "HHMM", "ex_item.hora_ref"), _d(I, "BANCO", "ex_item.banco_id"), _d(I, "VALOR", "ex_item.valor"),
        _d(I, "ATIVO", "ex_item.ativo"), _d(I, "ID_TBUSERS", "ex_item.usuario_id"), _d(I, "=exemplo", "ex_item.tipo"),
        _d(I, "@id", "ex_item_extra.item_id"), _d(I, "OBS", "ex_item_extra.observacao"),
        _d(N, "ID_EX_CAD_ITEM", "ex_nota.item_id"), _d(N, "TEXTO", "ex_nota.texto")],
    "deps": [],
    "descartes": [],
}


def linhas(r, ins):
    # grupos: 3 sem nome (NOT NULL no destino: recusa só a linha); 4 com S/N inválido e pai 5 (vem depois: fase 2);
    # 6 com pai 3 (recusado: fica gravado, com pendência na fase 2)
    for g in [(1, "Grupo raiz", None, "S"), (2, "  Grupo   dois  ", 1, "N"), (3, None, None, "S"),
              (4, "Grupo quatro", 5, "X"), (5, "Grupo cinco", 1, None), (6, "Grupo seis", 3, "S")]:
        ins(G, list(g))
    for i in range(1, 21):
        grupo, dt, hhmm, banco, usuario = 1 + i % 2, datetime.date(2026, 1, i), 830, (1, 237)[i % 2], 1 + i % 2
        descr = "Item ação %d" % i
        if i == 3:
            grupo = 3            # pai recusado, coluna anulável: grava NULL com pai_pendente (M15, recusas fase 2;
            #                      a ligação é refeita quando o pai for corrigido: _readiar_anulaveis)
        if i == 4:
            grupo = 99           # pai inexistente: NULL com pendência
        if i == 5:
            dt = datetime.date(1899, 12, 30)
        if i == 6:
            hhmm = 2575
        if i == 7:
            banco = 999          # código fora do catálogo oficial
        if i == 8:
            descr = "Descrição longa demais para o destino"  # VARCHAR(20) no destino: restricao_destino_1406
        if i == 9:
            usuario = 77         # pai de fora da fatia que não foi carregado
        if i == 10:
            grupo = 6
        valor = decimal.Decimal(r.randint(0, 99999)) / 100
        ins(I, [i, grupo, descr, dt, hhmm, banco, valor, "S" if i % 3 else "N", usuario,
                ("nota %d\r\n  segunda linha  " % i).encode("cp1252")])
    for item, texto in [(1, "nota a"), (1, "nota a"), (2, "nota b"), (3, "nota c"), (8, "nota d"), (None, "sem item")]:
        ins(N, [item, texto])
    return {
        G: {"gravados": 5, "pendencias": {"restricao_destino_1048": 1, "valor_fora_do_dominio": 1, "pai_pendente": 1}},
        I: {"gravados": 19, "pendencias": {"pai_pendente": 1, "restricao_destino_1406": 1, "data_sentinela": 1,
                                           "hora_invalida": 1, "catalogo_codigo_inexistente": 1,
                                           "pai_inexistente": 2}},
        # notas: a do item 3 acha o pai (gravado pelo M15); a do item 8 (recusado pelo tamanho) grava NULL com aviso
        N: {"gravados": 6, "pendencias": {"pai_pendente": 1}},
    }
