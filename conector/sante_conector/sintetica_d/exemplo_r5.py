"""Fatia `exemplo_r5`: prova os mecanismos da rodada 5 do conector (F4; ADR 0006 e 0007, continuidade). Mapa e destino
próprios (tabelas inventadas, prefixo EX6_, fora do mapa real; dados 100% falsos).

Cobre: (a) rascunho da origem como rascunho do AUTOR (login da origem pelo `cod:`, opção `autor`: sem autor achado, a
linha entra com a pendência `rascunho_sem_autor`); (b) ligação ao ESPELHO pelo código e pela edição
(`espelho:simpro@EDICAO`, sem copiar conteúdo licenciado); (c) a tabela EX6_BRA (edições de preço guardadas na origem)
é a fonte da SEMENTE do espelho (`semente_espelho`, teste próprio); (d) PROVA de "não copiar": saldo derivado
recalculado linha a linha (EX6_SAL) e último número carregado como estado (EX6_CTR). ADR 0007: vigência pela
evidência mais antiga (16), senha com hash conhecido importada, senha legível em argon2id e segredo cifrado no cofre do
cliente (17), código derivado conferindo filho -> pai (19), mescla não destrutiva na adoção (20) e a sobra da rodada 4:
chave composta com componente encadeado `ref:EX6_THM(CON>EX6_CNV>TAB,THM)`.
"""
import datetime

DDL = """
CREATE TABLE EX6_USU (ID INTEGER NOT NULL PRIMARY KEY, LOGIN VARCHAR(20), SENHA_MD5 VARCHAR(40), SENHA_CLARA VARCHAR(20),
  SMTP_SENHA VARCHAR(20));
CREATE TABLE EX6_RASC (ID INTEGER NOT NULL PRIMARY KEY, AUTOR VARCHAR(20), DATA TIMESTAMP, TEXTO VARCHAR(100));
CREATE TABLE EX6_MAT (ID INTEGER NOT NULL PRIMARY KEY, COD VARCHAR(20), EDICAO VARCHAR(10));
CREATE TABLE EX6_BRA (COD VARCHAR(20) NOT NULL, EDICAO VARCHAR(10) NOT NULL, DESCR VARCHAR(60), TIPO VARCHAR(20),
  PRECO NUMERIC(12,4), DTPUB DATE, PRIMARY KEY (COD, EDICAO));
CREATE TABLE EX6_PLA (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(30), DTCAD DATE, DTVALIDADE DATE);
CREATE TABLE EX6_GRP (COD VARCHAR(20) NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE EX6_ITM (ID INTEGER NOT NULL PRIMARY KEY, GRP VARCHAR(20), NOME VARCHAR(30));
CREATE TABLE EX6_PES (ID INTEGER NOT NULL PRIMARY KEY, CPF VARCHAR(11), NOME VARCHAR(30), FONE VARCHAR(15));
CREATE TABLE EX6_CNV (ID INTEGER NOT NULL PRIMARY KEY, TAB SMALLINT);
CREATE TABLE EX6_THM (TAB SMALLINT NOT NULL, COD INTEGER NOT NULL, NOME VARCHAR(30), PRIMARY KEY (TAB, COD));
CREATE TABLE EX6_PAC (ID INTEGER NOT NULL PRIMARY KEY, CON INTEGER, THM INTEGER);
CREATE TABLE EX6_MOV (ID INTEGER NOT NULL PRIMARY KEY, PROD INTEGER, QTD NUMERIC(10,2));
CREATE TABLE EX6_SAL (PROD INTEGER NOT NULL PRIMARY KEY, SALDO NUMERIC(10,2));
CREATE TABLE EX6_CTR (NOME VARCHAR(10) NOT NULL PRIMARY KEY, ULTIMO INTEGER);
"""

_A = (", origem VARCHAR(20) NOT NULL, criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL,"
      " versao INT UNSIGNED NOT NULL DEFAULT 1")
DDL_DESTINO = """
CREATE TABLE ex6_usuario (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, login VARCHAR(20) NOT NULL,
  resumo_senha VARCHAR(255) NULL, algoritmo VARCHAR(20) NULL, regravar_no_login BOOLEAN NOT NULL DEFAULT FALSE,
  referencia_cofre_smtp VARCHAR(200) NULL{a}, UNIQUE KEY uq_ex6_usuario_login (login));
CREATE TABLE ex6_rascunho (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, autor_usuario_id BIGINT UNSIGNED NULL,
  iniciado_em DATETIME(3) NOT NULL, situacao VARCHAR(20) NOT NULL, texto VARCHAR(100) NULL{a},
  CONSTRAINT ck_ex6_rascunho_autor CHECK (autor_usuario_id IS NOT NULL OR origem = 'migracao'));
CREATE TABLE item_referencia_matmed (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, fonte_referencia VARCHAR(20) NOT NULL,
  codigo_referencia VARCHAR(20) NOT NULL, UNIQUE KEY uq_irm (fonte_referencia, codigo_referencia));
CREATE TABLE edicao_referencia_matmed (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, numero_edicao VARCHAR(30) NOT NULL);
CREATE TABLE preco_referencia_matmed (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_referencia_matmed_id BIGINT UNSIGNED NOT NULL, edicao_referencia_matmed_id BIGINT UNSIGNED NOT NULL);
CREATE TABLE ex6_material (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, item_referencia_matmed_id BIGINT UNSIGNED NULL{a});
CREATE TABLE ex6_plano (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(30) NULL,
  vigencia_inicio DATE NOT NULL{a});
CREATE TABLE ex6_grupo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(10) NOT NULL,
  codigo_origem VARCHAR(20) NULL{a}, UNIQUE KEY uq_ex6_grupo (codigo));
CREATE TABLE ex6_item (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, grupo_id BIGINT UNSIGNED NULL,
  nome VARCHAR(30) NULL{a});
CREATE TABLE ex6_pessoa (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cpf CHAR(11) NOT NULL, nome VARCHAR(30) NULL,
  telefone VARCHAR(15) NULL{a}, UNIQUE KEY uq_ex6_pessoa_cpf (cpf));
CREATE TABLE ex6_convenio (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, tabela SMALLINT NULL{a});
CREATE TABLE ex6_preco (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(30) NULL{a});
CREATE TABLE ex6_pacote (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, preco_id BIGINT UNSIGNED NULL{a});
CREATE TABLE ex6_movimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, numero INT NOT NULL, produto INT NOT NULL,
  quantidade DECIMAL(10,2) NOT NULL{a});
""".format(a=_A)

# o espelho já levado ao cliente (mesmos ids do espelho padrão da base): item 77 do Simpro com preço na edição 2024.1
PREPARO_DESTINO = """
INSERT INTO item_referencia_matmed (id, fonte_referencia, codigo_referencia) VALUES (77, 'simpro', 'S-100'),
  (78, 'simpro', 'S-200');
INSERT INTO edicao_referencia_matmed (id, numero_edicao) VALUES (5, '2024.1'), (6, '2024.2');
INSERT INTO preco_referencia_matmed (item_referencia_matmed_id, edicao_referencia_matmed_id) VALUES (77, 5), (78, 6);
INSERT INTO ex6_pessoa (cpf, nome, telefone, origem, criado_em) VALUES ('00000000191', 'PESSOA JA CADASTRADA', NULL,
  'sistema', UTC_TIMESTAMP(3));
"""


def _g(t, c, regra):
    return {"tabela": t, "coluna": c, "regra": regra, "referencia": "", "depara": ""}


def _d(t, c, destino, regra="", via="", depara=""):
    return {"tabela": t, "coluna": c, "destino": destino, "regra": regra, "depara": depara, "via": via,
            "motivo": "exemplo"}


def _t(t, destinos, ordem, chave):
    return {"tabela": t, "tabelas_destino": destinos, "ordem": str(ordem), "chave": chave, "estrategia": "hash_linha"}


USU, RASC, MAT, BRA, PLA, GRP, ITM, PES = "EX6_USU", "EX6_RASC", "EX6_MAT", "EX6_BRA", "EX6_PLA", "EX6_GRP", \
    "EX6_ITM", "EX6_PES"
CNV, THM, PAC, MOV, SAL, CTR = "EX6_CNV", "EX6_THM", "EX6_PAC", "EX6_MOV", "EX6_SAL", "EX6_CTR"
MAPA_TESTE = {
    "tabelas": [_t(USU, "ex6_usuario", 1, "ID"), _t(RASC, "ex6_rascunho", 2, "ID"), _t(MAT, "ex6_material", 3, "ID"),
                _t(PLA, "ex6_plano", 4, "ID"), _t(GRP, "ex6_grupo", 5, "COD"), _t(ITM, "ex6_item", 6, "ID"),
                _t(PES, "ex6_pessoa", 7, "ID"), _t(CNV, "ex6_convenio", 8, "ID"), _t(THM, "ex6_preco", 9, "TAB,COD"),
                _t(PAC, "ex6_pacote", 10, "ID"), _t(MOV, "ex6_movimento", 11, "ID"),
                _t(SAL, "", 12, "PROD"), _t(CTR, "", 13, "NOME"), _t(BRA, "", 14, "COD,EDICAO")],
    "colunas": [
        _g(USU, "ID", "inteiro"), _g(USU, "LOGIN", "texto"), _g(USU, "SENHA_MD5", "texto"),
        _g(USU, "SENHA_CLARA", "texto"), _g(USU, "SMTP_SENHA", "texto"),
        _g(RASC, "ID", "inteiro"), _g(RASC, "AUTOR", "texto"), _g(RASC, "DATA", "data_hora"),
        _g(RASC, "TEXTO", "texto"),
        _g(MAT, "ID", "inteiro"), _g(MAT, "COD", "texto"), _g(MAT, "EDICAO", "texto"),
        _g(PLA, "ID", "inteiro"), _g(PLA, "NOME", "texto"), _g(PLA, "DTCAD", "data"), _g(PLA, "DTVALIDADE", "data"),
        _g(GRP, "COD", "texto"), _g(GRP, "NOME", "texto"),
        _g(ITM, "ID", "inteiro"), _g(ITM, "GRP", "texto"), _g(ITM, "NOME", "texto"),
        _g(PES, "ID", "inteiro"), _g(PES, "CPF", "texto"), _g(PES, "NOME", "texto"), _g(PES, "FONE", "texto"),
        _g(CNV, "ID", "inteiro"), _g(CNV, "TAB", "inteiro"),
        _g(THM, "TAB", "inteiro"), _g(THM, "COD", "inteiro"), _g(THM, "NOME", "texto"),
        _g(PAC, "ID", "inteiro"), _g(PAC, "CON", "inteiro"), _g(PAC, "THM", "inteiro"),
        _g(MOV, "ID", "inteiro"), _g(MOV, "PROD", "inteiro"), _g(MOV, "QTD", "decimal"),
        _g(SAL, "PROD", "inteiro"), _g(SAL, "SALDO", "decimal"), _g(CTR, "NOME", "texto"), _g(CTR, "ULTIMO", "inteiro")],
    "colunas_decl": [
        # credenciais copiadas (ADR 0007, 17): login igual, hash md5 importado e marcado para regravar no 1º login,
        # senha legível direto a argon2id (aqui no mesmo resumo, quando não há hash), segredo de e-mail ao cofre
        _d(USU, "LOGIN", "ex6_usuario.login"),
        _d(USU, "#senha_hash:SENHA_MD5:md5", "ex6_usuario.resumo_senha"),
        _d(USU, "#senha:SENHA_CLARA", "ex6_usuario.resumo_senha"),
        _d(USU, "=md5", "ex6_usuario.algoritmo", via="se:SENHA_MD5"),
        _d(USU, "=argon2id", "ex6_usuario.algoritmo", via="se:SENHA_CLARA"),
        _d(USU, "=1", "ex6_usuario.regravar_no_login", via="se:SENHA_MD5"),
        _d(USU, "#cofre:SMTP_SENHA", "ex6_usuario.referencia_cofre_smtp"),
        # (a) rascunho do autor pelo login da origem; data original; nunca finalizado
        _d(RASC, "AUTOR", "ex6_rascunho.autor_usuario_id", regra="texto", via="cod:ex6_usuario.login;autor"),
        _d(RASC, "DATA", "ex6_rascunho.iniciado_em"),
        _d(RASC, "=aberto", "ex6_rascunho.situacao"),
        _d(RASC, "TEXTO", "ex6_rascunho.texto"),
        # (b) referência ao espelho pelo código e pela edição; o conteúdo licenciado nunca é gravado
        _d(MAT, "COD", "ex6_material.item_referencia_matmed_id", via="espelho:simpro@EDICAO"),
        # vigência sem data própria: a evidência mais antiga (cadastro), nunca a data da carga (ADR 0007, 16)
        _d(PLA, "NOME", "ex6_plano.nome"),
        _d(PLA, "@vigencia_carga", "ex6_plano.vigencia_inicio"),
        # código derivado (19): o filho liga pelo id do pai, o código original fica guardado
        _d(GRP, "#codigo_derivado:COD:10:g", "ex6_grupo.codigo"),
        _d(GRP, "COD", "ex6_grupo.codigo_origem"),
        _d(ITM, "GRP", "ex6_item.grupo_id", via="ref:EX6_GRP"),
        _d(ITM, "NOME", "ex6_item.nome"),
        # mescla não destrutiva (20): a pessoa já cadastrada é adotada pelo CPF
        _d(PES, "CPF", "ex6_pessoa.cpf", via="adotar:cpf"),
        _d(PES, "NOME", "ex6_pessoa.nome"),
        _d(PES, "FONE", "ex6_pessoa.telefone"),
        # chave composta com componente encadeado (sobra da rodada 4): a tabela de honorários vem do convênio
        _d(CNV, "TAB", "ex6_convenio.tabela"),
        _d(THM, "NOME", "ex6_preco.nome"),
        _d(PAC, "CON", "ex6_pacote.preco_id", via="ref:EX6_THM(CON>EX6_CNV>TAB,THM)"),
        # movimentos carregados; o saldo (EX6_SAL) e o contador (EX6_CTR) NÃO são copiados: provados abaixo
        _d(MOV, "ID", "ex6_movimento.numero", regra="inteiro"),
        _d(MOV, "PROD", "ex6_movimento.produto"),
        _d(MOV, "QTD", "ex6_movimento.quantidade")],
    "valores": [], "deps": [], "descartes": [],
    # (d) prova de "não copiar" (ADR 0006, 1): derivado igual linha a linha; mecanismo com o estado carregado
    "provas": [
        {"tabela": SAL, "tipo": "derivado", "chave": ["PROD"], "valores": [("SALDO", "")],
         "sql": "SELECT produto, SUM(quantidade) FROM ex6_movimento GROUP BY produto"},
        {"tabela": CTR, "tipo": "mecanismo", "chave": ["NOME"], "valores": [("ULTIMO", "inteiro_mais_um")],
         "sql": "SELECT 'MOV', MAX(numero) + 1 FROM ex6_movimento"}],
    "evidencia_origem": [],
}

# declaração da semente do espelho (c): a tabela de preços por edição guardada na cópia da origem
SEMENTE = {"simpro": {"tabela": BRA, "campos": {
    "codigo": "COD", "descricao": "DESCR", "tipo_produto": "TIPO", "preco_fabrica": "PRECO", "#edicao": "EDICAO",
    "#vigencia": "DTPUB"}}}
MD5_FALSO = "0123456789abcdef0123456789abcdef"


def linhas(r, ins):
    import decimal
    D, dt = decimal.Decimal, datetime.datetime
    # 1 hash conhecido; 2 senha legível; 3 hash inválido (pendência) e segredo de e-mail
    ins(USU, [1, "ana.teste", MD5_FALSO.upper(), None, None])
    ins(USU, [2, "beto.teste", None, "senha-falsa-1", "smtp-falso"])
    ins(USU, [3, "caio.teste", "nao-e-hash", None, None])
    # rascunhos: autor achado (2) e autor sem login no destino (1, pendência alta, entra sem autor)
    ins(RASC, [1, "ana.teste", dt(2019, 3, 4, 10, 30), "evolucao em edicao"])
    ins(RASC, [2, "beto.teste", dt(2020, 1, 2, 8, 0), "outra"])
    ins(RASC, [3, "ninguem", dt(2021, 5, 6, 9, 15), "sem autor"])
    # espelho: código e edição achados; código ausente; código de outra edição
    ins(MAT, [1, "S-100", "2024.1"])
    ins(MAT, [2, "S-999", "2024.1"])
    ins(MAT, [3, "S-200", "2024.1"])
    ins(MAT, [4, "S-200", None])
    # semente (c): duas edições, uma linha inválida (sem descrição) na 2ª
    ins(BRA, ["B-1", "E1", "ITEM UM", "material", D("1.5000"), datetime.date(2020, 1, 1)])
    ins(BRA, ["B-2", "E1", "ITEM DOIS", "medicamento", D("2.0000"), datetime.date(2020, 1, 1)])
    ins(BRA, ["B-1", "E2", "ITEM UM", "material", D("1.7500"), datetime.date(2021, 1, 1)])
    ins(BRA, ["B-3", "E2", None, "material", D("3.0000"), datetime.date(2021, 1, 1)])
    # vigência: 1 cadastro de 2015; 2 sem cadastro: o mais antigo da tabela (a validade nunca é evidência)
    ins(PLA, [1, "PLANO A", datetime.date(2015, 6, 1), datetime.date(2030, 1, 1)])
    ins(PLA, [2, "PLANO B", None, datetime.date(2010, 1, 1)])
    # código derivado: o longo não cabe em 10 (hash); o filho liga pelo pai mesmo assim
    ins(GRP, ["CURTO", "G1"])
    ins(GRP, ["CODIGO-MUITO-LONGO", "G2"])
    ins(ITM, [1, "CURTO", "I1"])
    ins(ITM, [2, "CODIGO-MUITO-LONGO", "I2"])
    ins(ITM, [3, "CODIGO-MUITO-LONGO", "I3"])
    # mescla: o CPF já cadastrado é adotado (telefone vazio recebe; nome em conflito fica e a origem vai ao histórico)
    ins(PES, [1, "00000000191", "NOME DA ORIGEM", "1199990000"])
    ins(PES, [2, "00000000272", "OUTRA PESSOA", None])
    # chave composta encadeada: convênio 1 usa a tabela 10, convênio 2 a 20; pacote do convênio 9 não existe
    ins(CNV, [1, 10])
    ins(CNV, [2, 20])
    ins(THM, [10, 500, "CONSULTA T10"])
    ins(THM, [20, 500, "CONSULTA T20"])
    ins(PAC, [1, 1, 500])
    ins(PAC, [2, 2, 500])
    ins(PAC, [3, 9, 500])
    # movimentos; saldo derivado e contador do último número (não copiados, provados)
    ins(MOV, [1, 7, D("10.00")])
    ins(MOV, [2, 7, D("-4.00")])
    ins(MOV, [3, 8, D("1.50")])
    ins(SAL, [7, D("6.00")])
    ins(SAL, [8, D("1.50")])
    ins(CTR, ["MOV", 3])
    return {
        USU: {"gravados": 3, "pendencias": {"senha_hash_invalido": 1}},
        RASC: {"gravados": 3, "pendencias": {"rascunho_sem_autor": 1}},
        MAT: {"gravados": 4, "pendencias": {"espelho_codigo_inexistente": 1, "espelho_edicao_inexistente": 1}},
        PLA: {"gravados": 2, "pendencias": {"vigencia_sem_fonte": 1}},
        GRP: {"gravados": 2, "pendencias": {"codigo_derivado": 1}},
        ITM: {"gravados": 3, "pendencias": {}},
        PES: {"gravados": 2, "pendencias": {"adotado_existente": 1, "mescla_conflito_origem_guardada": 1}},
        CNV: {"gravados": 2, "pendencias": {}},
        THM: {"gravados": 2, "pendencias": {}},
        PAC: {"gravados": 3, "pendencias": {"pai_inexistente": 1}},
        MOV: {"gravados": 3, "pendencias": {}},
    }
