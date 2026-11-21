"""Fatia `exemplo_r3b`: prova os mecanismos GENÉRICOS da rodada 3 de cobertura do conector (F4), regras de estrutura,
com mapa e destino próprios (tabelas inventadas, prefixo EX3B_, fora do mapa real; dados 100% falsos).

Cobre: retrato COMPLETO da linha de histórico (`#retrato:*-<exceto>`, sem segredo pelo nome, BLOB binário em SHA-256 e
de texto convertido) com o SHA-256 do mesmo JSON (`#sha256:#retrato:*...`) e o retrato das lidas mais colunas listadas
(`#retrato:NOME`); referência ao destino SECUNDÁRIO do pai em colunas CONCORRENTES (`ref:T/<destino>` em duas
colunas para a mesma coluna do destino: vale a primeira com valor); cópia de coluna do destino do pai
(`ref:T@coluna` e `ref:T>X>U/<destino>@coluna`); divisão do destino principal com o item falso (`desdobrar` com
`com_falso`, tabela sem chave); agrupamento de parcelas sob um título (`antes;agrupar:` com `#grupo_contar`,
`#grupo_seq`, `#grupo_somar`, `#grupo_min`, `#grupo_max` e `@id:<destino>`).
"""
DDL = """
CREATE TABLE EX3B_PAC (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40));
CREATE TABLE EX3B_HPAC (ID INTEGER NOT NULL PRIMARY KEY, ID_PAC INTEGER, NOME VARCHAR(40), NASC DATE,
  VALOR NUMERIC(10,2), SENHA VARCHAR(20), INTERNO VARCHAR(10), OBS BLOB SUB_TYPE 1, FOTO BLOB SUB_TYPE 0);
CREATE TABLE EX3B_PRO (COD INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40), ITEM VARCHAR(10));
CREATE TABLE EX3B_MAT (COD INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40), ITEM VARCHAR(10));
CREATE TABLE EX3B_LAN (ID INTEGER NOT NULL PRIMARY KEY, COD_PRO INTEGER, COD_MAT INTEGER, QTD INTEGER);
CREATE TABLE EX3B_CIH (ID_LAN INTEGER NOT NULL PRIMARY KEY, PROC_SUS VARCHAR(10));
CREATE TABLE EX3B_PAR (ID INTEGER NOT NULL PRIMARY KEY, EMPRESA INTEGER, DOC VARCHAR(10), SERIE VARCHAR(3),
  EMISSAO DATE, VENC DATE, VALOR NUMERIC(12,2));
CREATE TABLE EX3B_HER (NOME_ANT CHAR(1), FONE_ANT CHAR(1), END_ANT CHAR(1));
"""

_A = (", origem VARCHAR(20) NOT NULL, criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL,"
      " versao INT UNSIGNED NOT NULL DEFAULT 1")
DDL_DESTINO = """
CREATE TABLE ex3b_paciente (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(40) NULL{a});
CREATE TABLE ex3b_versao (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, paciente_id BIGINT UNSIGNED NOT NULL,
  dados JSON NOT NULL, hash_dados CHAR(64) NOT NULL, resumo JSON NULL{a},
  CONSTRAINT fk_ex3b_versao_paciente FOREIGN KEY (paciente_id) REFERENCES ex3b_paciente (id));
CREATE TABLE ex3b_proc (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo INT NOT NULL, nome VARCHAR(40) NULL{a});
CREATE TABLE ex3b_mat (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo INT NOT NULL, nome VARCHAR(40) NULL{a});
CREATE TABLE ex3b_item (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(10) NOT NULL,
  tipo VARCHAR(20) NOT NULL, proc_id BIGINT UNSIGNED NULL, mat_id BIGINT UNSIGNED NULL{a});
CREATE TABLE ex3b_lancamento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, numero INT NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL, quantidade INT NULL{a},
  CONSTRAINT fk_ex3b_lancamento_item FOREIGN KEY (item_id) REFERENCES ex3b_item (id));
CREATE TABLE ex3b_equivalencia (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lancamento_id BIGINT UNSIGNED NOT NULL, item_id BIGINT UNSIGNED NOT NULL, codigo_item VARCHAR(10) NULL,
  procedimento VARCHAR(10) NULL{a});
CREATE TABLE ex3b_titulo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, empresa INT NULL, documento VARCHAR(10) NULL,
  serie VARCHAR(3) NULL, quantidade_parcelas SMALLINT UNSIGNED NOT NULL, valor_total DECIMAL(12,2) NOT NULL,
  emitido_em DATE NULL, ultimo_vencimento DATE NULL{a});
CREATE TABLE ex3b_parcela (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, titulo_id BIGINT UNSIGNED NOT NULL,
  numero SMALLINT UNSIGNED NOT NULL, vencimento DATE NOT NULL, valor DECIMAL(12,2) NOT NULL{a},
  CONSTRAINT uk_ex3b_parcela UNIQUE (titulo_id, numero), CONSTRAINT ck_ex3b_parcela_valor CHECK (valor > 0),
  CONSTRAINT fk_ex3b_parcela_titulo FOREIGN KEY (titulo_id) REFERENCES ex3b_titulo (id));
CREATE TABLE ex3b_heranca (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, campo VARCHAR(20) NOT NULL,
  herda BOOLEAN NOT NULL{a});
""".format(a=_A)


def _g(t, c, regra):
    return {"tabela": t, "coluna": c, "regra": regra, "referencia": "", "depara": ""}


def _d(t, c, destino, regra="", via="", depara=""):
    return {"tabela": t, "coluna": c, "destino": destino, "regra": regra, "depara": depara, "via": via,
            "motivo": "exemplo"}


PAC, HPAC, PRO, MAT, LAN, CIH, PAR, HER = ("EX3B_PAC", "EX3B_HPAC", "EX3B_PRO", "EX3B_MAT", "EX3B_LAN", "EX3B_CIH",
                                           "EX3B_PAR", "EX3B_HER")
RETRATO = "#retrato:*-INTERNO"
MAPA_TESTE = {
    "tabelas": [
        {"tabela": PAC, "tabelas_destino": "ex3b_paciente", "ordem": "1", "chave": "ID", "estrategia": "hash_linha"},
        {"tabela": HPAC, "tabelas_destino": "ex3b_versao", "ordem": "2", "chave": "ID", "estrategia": "hash_linha"},
        {"tabela": PRO, "tabelas_destino": "ex3b_proc;ex3b_item", "ordem": "3", "chave": "COD",
         "estrategia": "hash_linha"},
        {"tabela": MAT, "tabelas_destino": "ex3b_mat;ex3b_item", "ordem": "4", "chave": "COD",
         "estrategia": "hash_linha"},
        {"tabela": LAN, "tabelas_destino": "ex3b_lancamento", "ordem": "5", "chave": "ID", "estrategia": "hash_linha"},
        {"tabela": CIH, "tabelas_destino": "ex3b_equivalencia", "ordem": "6", "chave": "ID_LAN",
         "estrategia": "hash_linha"},
        {"tabela": PAR, "tabelas_destino": "ex3b_parcela;ex3b_titulo", "ordem": "7", "chave": "ID",
         "estrategia": "hash_linha"},
        {"tabela": HER, "tabelas_destino": "ex3b_heranca", "ordem": "8", "chave": "",
         "estrategia": "hash_linha_sem_chave"}],
    # OBS e FOTO sem regra gerada: o retrato completo decide pelo tipo vivo (BLOB de texto e binário)
    "colunas": [
        _g(PAC, "ID", "inteiro"), _g(PAC, "NOME", "texto_nome"),
        _g(HPAC, "ID", "inteiro"), _g(HPAC, "ID_PAC", "inteiro"), _g(HPAC, "NOME", "texto_nome"),
        _g(HPAC, "NASC", "data"), _g(HPAC, "VALOR", "decimal"), _g(HPAC, "SENHA", "texto"),
        _g(HPAC, "INTERNO", "texto"),
        _g(PRO, "COD", "inteiro"), _g(PRO, "NOME", "texto"), _g(PRO, "ITEM", "texto"),
        _g(MAT, "COD", "inteiro"), _g(MAT, "NOME", "texto"), _g(MAT, "ITEM", "texto"),
        _g(LAN, "ID", "inteiro"), _g(LAN, "COD_PRO", "inteiro"), _g(LAN, "COD_MAT", "inteiro"),
        _g(LAN, "QTD", "inteiro"), _g(CIH, "ID_LAN", "inteiro"), _g(CIH, "PROC_SUS", "texto"),
        _g(PAR, "ID", "inteiro"), _g(PAR, "EMPRESA", "inteiro"), _g(PAR, "DOC", "texto"), _g(PAR, "SERIE", "texto"),
        _g(PAR, "EMISSAO", "data"), _g(PAR, "VENC", "data"), _g(PAR, "VALOR", "decimal"),
        _g(HER, "NOME_ANT", "booleano_sn"), _g(HER, "FONE_ANT", "booleano_sn"), _g(HER, "END_ANT", "booleano_sn")],
    "colunas_decl": [
        _d(PAC, "NOME", "ex3b_paciente.nome", regra="texto_nome"),
        _d(HPAC, "ID_PAC", "ex3b_versao.paciente_id", via="ref:EX3B_PAC"),
        _d(HPAC, RETRATO, "ex3b_versao.dados"),
        _d(HPAC, "#sha256:" + RETRATO, "ex3b_versao.hash_dados"),
        _d(HPAC, "#retrato:NOME", "ex3b_versao.resumo"),
        _d(PRO, "COD", "ex3b_proc.codigo", regra="inteiro"),
        _d(PRO, "NOME", "ex3b_proc.nome"),
        _d(PRO, "ITEM", "ex3b_item.codigo", via="opcional"),
        _d(PRO, "=procedimento", "ex3b_item.tipo"),
        _d(PRO, "@id", "ex3b_item.proc_id"),
        _d(MAT, "COD", "ex3b_mat.codigo", regra="inteiro"),
        _d(MAT, "NOME", "ex3b_mat.nome"),
        _d(MAT, "ITEM", "ex3b_item.codigo", via="opcional"),
        _d(MAT, "=material", "ex3b_item.tipo"),
        _d(MAT, "@id", "ex3b_item.mat_id"),
        _d(LAN, "ID", "ex3b_lancamento.numero", regra="inteiro"),
        _d(LAN, "COD_PRO", "ex3b_lancamento.item_id", via="ref:EX3B_PRO/ex3b_item"),
        _d(LAN, "COD_MAT", "ex3b_lancamento.item_id", via="ref:EX3B_MAT/ex3b_item"),
        _d(LAN, "QTD", "ex3b_lancamento.quantidade", regra="inteiro"),
        _d(CIH, "ID_LAN", "ex3b_equivalencia.lancamento_id", via="ref:EX3B_LAN"),
        _d(CIH, "ID_LAN", "ex3b_equivalencia.item_id", via="ref:EX3B_LAN@item_id"),
        _d(CIH, "ID_LAN", "ex3b_equivalencia.codigo_item", via="ref:EX3B_LAN>COD_PRO>EX3B_PRO/ex3b_item@codigo"),
        _d(CIH, "PROC_SUS", "ex3b_equivalencia.procedimento"),
        _d(PAR, "@id:ex3b_titulo", "ex3b_parcela.titulo_id"),
        _d(PAR, "#grupo_seq", "ex3b_parcela.numero"),
        _d(PAR, "VENC", "ex3b_parcela.vencimento", regra="data"),
        _d(PAR, "VALOR", "ex3b_parcela.valor", regra="decimal"),
        _d(PAR, "EMPRESA", "ex3b_titulo.empresa", regra="inteiro", via="antes;agrupar:EMPRESA,DOC,SERIE"),
        _d(PAR, "DOC", "ex3b_titulo.documento"),
        _d(PAR, "SERIE", "ex3b_titulo.serie"),
        _d(PAR, "#grupo_contar", "ex3b_titulo.quantidade_parcelas"),
        _d(PAR, "#grupo_somar:VALOR", "ex3b_titulo.valor_total"),
        _d(PAR, "#grupo_min:EMISSAO", "ex3b_titulo.emitido_em"),
        _d(PAR, "#grupo_max:VENC", "ex3b_titulo.ultimo_vencimento"),
        _d(HER, "#item", "ex3b_heranca.herda", regra="booleano_sn",
           via="desdobrar:NOME_ANT=nome,FONE_ANT=telefone,END_ANT=endereco;com_falso"),
        _d(HER, "#rotulo", "ex3b_heranca.campo")],
    "valores": [], "deps": [], "descartes": [],
}


def linhas(r, ins):
    import datetime as dt
    import decimal
    D = decimal.Decimal
    ins(PAC, [1, "Paciente de exemplo"])
    # histórico: 1 e 2 versões do paciente 1 (retrato completo sem SENHA e INTERNO); 3 paciente inexistente (NOT NULL)
    ins(HPAC, [1, 1, "Paciente de exemplo", dt.date(1990, 5, 1), D("10.50"), "segredo1", "x", "linha um\nlinha dois",
               b"\x00\x01\x02"])
    ins(HPAC, [2, 1, "Paciente de exemplo", dt.date(1990, 5, 2), None, None, None, None, None])
    ins(HPAC, [3, 9, "Outro", None, None, "segredo3", None, None, None])
    # procedimentos e materiais: o item faturável (secundário opcional) só quando há ITEM
    ins(PRO, [1, "Procedimento um", "P1"])
    ins(PRO, [2, "Procedimento dois", None])
    ins(MAT, [1, "Material um", "M1"])
    # lançamentos: 1 procedimento; 2 material; 3 procedimento sem item (pai_inexistente) e material (vale o material);
    # 4 nenhum (item NOT NULL: recusa 1048); 5 os dois (vale o primeiro declarado, o procedimento)
    ins(LAN, [1, 1, None, 2])
    ins(LAN, [2, None, 1, 1])
    ins(LAN, [3, 2, 1, 1])
    ins(LAN, [4, None, None, 1])
    ins(LAN, [5, 1, 1, 3])
    # equivalências: item copiado do lançamento e código do item do procedimento dele; 3 sem item do procedimento
    # (pai_inexistente, código NULL); 4 lançamento recusado (pai_pendente); 9 inexistente (3 pai_inexistente + 1048)
    for k in (1, 2, 3, 4, 5, 9):
        ins(CIH, [k, "S%d" % k])
    # parcelas: título A (3 parcelas), B (a 1ª com valor 0 recusada pelo CHECK; a 2ª cria o título), 6 e 7 sem
    # documento (cada uma o próprio título), 8 mesmo documento de A em outra empresa (outro título)
    ins(PAR, [1, 1, "A1", "1", dt.date(2026, 1, 10), dt.date(2026, 2, 10), D("100.00")])
    ins(PAR, [2, 1, "A1", "1", dt.date(2026, 1, 10), dt.date(2026, 3, 10), D("100.00")])
    ins(PAR, [3, 1, "A1 ", "1", dt.date(2026, 1, 12), dt.date(2026, 4, 10), D("50.50")])
    ins(PAR, [4, 1, "B2", "1", dt.date(2026, 1, 15), dt.date(2026, 2, 15), D("0")])
    ins(PAR, [5, 1, "B2", "1", dt.date(2026, 1, 15), dt.date(2026, 3, 15), D("80.00")])
    ins(PAR, [6, None, None, None, dt.date(2026, 1, 20), dt.date(2026, 2, 20), D("10.00")])
    ins(PAR, [7, None, None, None, dt.date(2026, 1, 20), dt.date(2026, 2, 20), D("20.00")])
    ins(PAR, [8, 2, "A1", "1", dt.date(2026, 1, 5), dt.date(2026, 2, 5), D("30.00")])
    # marcações S/N: S e N viram linhas (herda verdadeiro e falso), vazio não; a segunda linha não tem nenhuma
    ins(HER, ["S", "N", None])
    ins(HER, [None, None, " "])
    return {
        PAC: {"gravados": 1, "pendencias": {}},
        HPAC: {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}},
        PRO: {"gravados": 2, "pendencias": {}},
        MAT: {"gravados": 1, "pendencias": {}},
        LAN: {"gravados": 4, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}},
        CIH: {"gravados": 4, "pendencias": {"pai_inexistente": 4, "pai_pendente": 1, "restricao_destino_1048": 1}},
        PAR: {"gravados": 7, "pendencias": {"restricao_destino_4025": 1}},
        HER: {"gravados": 2, "pendencias": {"sem_item_a_gravar": 1}},
    }
