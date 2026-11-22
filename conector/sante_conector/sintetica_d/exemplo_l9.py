"""Fatia `exemplo_l9`: prova do Sincronizar (F4 L9; plano F4, seções 6 e 6.1). Mapa e destino próprios (prefixo EX9_,
fora do mapa real; dados 100% falsos). Duas versões da mesma origem (`VERSAO`, trocada pelo teste antes de gerar):

- versão 1: 2.010 pacientes (os 10 últimos sem consulta) e 6.000 consultas (ids 4..24000 de 4 em 4: três blocos de
  10 mil ids), presença 'N'; generator das consultas em 24000;
- versão 2: alteração SÓ DE COLUNA em consultas antigas (presença 20, 24 e 28 passa a 'S'), pacientes antigos
  alterados (telefone do 2, nome do 3), linhas novas (pacientes 2011 e 2012; consultas 24004 a 24020), apagadas
  (consultas 40 e 44, paciente 2005); generator em 24020. O bloco de 10 mil a 19.999 das consultas não muda.
"""
import datetime

VERSAO = 1
PAC, CON = "EX9_PAC", "EX9_CON"
NOVAS_CON = [24004, 24008, 24012, 24016, 24020]


def ddl(versao):
    return """
CREATE TABLE EX9_PAC (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40), FONE VARCHAR(15));
CREATE TABLE EX9_CON (ID INTEGER NOT NULL PRIMARY KEY, PAC INTEGER, DATA DATE, PRESENCA CHAR(1));
CREATE GENERATOR EX9_GEN_CON;
SET GENERATOR EX9_GEN_CON TO %d;
""" % (24020 if versao == 2 else 24000)


DDL = ddl(1)

_A = (", origem VARCHAR(20) NOT NULL, criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL,"
      " versao INT UNSIGNED NOT NULL DEFAULT 1, excluido_em DATETIME(3) NULL")
DDL_DESTINO = """
CREATE TABLE ex9_paciente (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(60) NOT NULL,
  telefone VARCHAR(20) NULL{a});
CREATE TABLE ex9_consulta (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, paciente_id BIGINT UNSIGNED NOT NULL,
  data DATE NOT NULL, presente BOOLEAN NOT NULL DEFAULT FALSE{a});
CREATE TABLE sequencia_negocio (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, estabelecimento_id BIGINT UNSIGNED NULL,
  tipo VARCHAR(60) NOT NULL, prefixo VARCHAR(20) NULL, proximo_valor BIGINT UNSIGNED NOT NULL DEFAULT 1,
  criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL, versao INT UNSIGNED NOT NULL DEFAULT 1);
""".format(a=_A)


def _g(t, c, regra):
    return {"tabela": t, "coluna": c, "regra": regra, "referencia": "", "depara": ""}


def _d(t, c, destino, regra="", via=""):
    return {"tabela": t, "coluna": c, "destino": destino, "regra": regra, "depara": "", "via": via,
            "motivo": "exemplo"}


def _t(t, destinos, ordem, chave):
    return {"tabela": t, "tabelas_destino": destinos, "ordem": str(ordem), "chave": chave,
            "estrategia": "faixa_id_hash_bloco"}


MAPA_TESTE = {
    "tabelas": [_t(PAC, "ex9_paciente", 1, "ID"), _t(CON, "ex9_consulta", 2, "ID")],
    "colunas": [_g(PAC, "ID", "inteiro"), _g(PAC, "NOME", "texto"), _g(PAC, "FONE", "texto"),
                _g(CON, "ID", "inteiro"), _g(CON, "PAC", "inteiro"), _g(CON, "DATA", "data"),
                _g(CON, "PRESENCA", "booleano_sn")],
    "colunas_decl": [_d(PAC, "NOME", "ex9_paciente.nome", regra="texto_nome"),
                     _d(PAC, "FONE", "ex9_paciente.telefone"),
                     _d(CON, "PAC", "ex9_consulta.paciente_id", via="ref:EX9_PAC"),
                     _d(CON, "DATA", "ex9_consulta.data"),
                     _d(CON, "PRESENCA", "ex9_consulta.presente", regra="booleano_sn")],
    "valores": [], "deps": [], "descartes": [], "provas": [], "evidencia_origem": [],
    "sequencias": [{"generator": "EX9_GEN_CON", "tipo": "consulta", "motivo": "exemplo"}],
}


def linhas(r, ins):
    v2 = VERSAO == 2
    pacs = [i for i in range(1, 2011) if not (v2 and i == 2005)] + ([2011, 2012] if v2 else [])
    for i in pacs:
        nome = "PACIENTE TESTE %d" % i
        fone = "1100%06d" % i
        if v2 and i == 2:
            fone = "1199999999"
        if v2 and i == 3:
            nome = "PACIENTE TESTE TRES ALTERADO"
        ins(PAC, [i, nome, fone])
    base = datetime.date(2020, 1, 1)
    cons = [(4 * k, (k % 2000) + 1) for k in range(1, 6001) if not (v2 and 4 * k in (40, 44))]
    if v2:
        cons += [(c, 2011 + (j % 2)) for j, c in enumerate(NOVAS_CON)]
    for cid, pac in cons:
        pres = "S" if v2 and cid in (20, 24, 28) else "N"
        ins(CON, [cid, pac, base + datetime.timedelta(days=cid % 2000), pres])
    return {PAC: {"gravados": len(pacs), "pendencias": {}}, CON: {"gravados": len(cons), "pendencias": {}}}
