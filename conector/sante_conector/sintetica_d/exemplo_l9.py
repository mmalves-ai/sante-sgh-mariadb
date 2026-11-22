"""Fatia `exemplo_l9`: prova do Sincronizar (F4 L9; plano F4, seções 6 e 6.1). Mapa e destino próprios (prefixo EX9_,
fora do mapa real; dados 100% falsos). Duas versões da mesma origem (`VERSAO`, trocada pelo teste antes de gerar):

- versão 1: 2.010 pacientes (os 10 últimos sem consulta) e 6.000 consultas (ids 4..24000 de 4 em 4: três blocos de
  10 mil ids), presença 'N'; generator das consultas em 24000;
- versão 2: alteração SÓ DE COLUNA em consultas antigas (presença 20, 24 e 28 passa a 'S'), pacientes antigos
  alterados (telefone do 2, nome do 3), linhas novas (pacientes 2011 e 2012; consultas 24004 a 24020), apagadas
  (consultas 40 e 44, paciente 2005); generator em 24020. O bloco de 10 mil a 19.999 das consultas não muda.

Estruturas compartilhadas (achados da revisão do L9):
- profissional com a pessoa ADOTADA pelo CPF (`antes;adotar:cpf`); o aluno 1 adota a MESMA pessoa do profissional 1.
  Versão 2: profissionais 1 e 2 apagados (a pessoa do 1 segue ativa, a do 2 é excluída), nome do 3 alterado (a pessoa
  criada pela migração segue a origem);
- parcelas AGRUPADAS num título (`antes;agrupar:DOC`): versão 2 apaga a parcela 2 (o título 100 segue ativo) e muda o
  valor da 1 (parcela e agregados do título recalculados);
- vínculo `complementa` na unidade do paciente: versão 2 apaga o vínculo 2 (o paciente 6 segue ativo) e muda a unidade
  do 1 (editada no destino antes: conflito guardado);
- setor num destino SEM `excluido_em` (setor 3 apagado: segue ativo, pendência visível), com prioridade NOT NULL de
  padrão 3 (setor 1 passa a vazio: volta ao padrão) e nome único (setor 2 passa ao nome do 1: a reaplicação é recusada
  pela restrição e nada do Sincronizar dela é contado).
"""
import datetime

VERSAO = 1
PAC, CON = "EX9_PAC", "EX9_CON"
PROF, ALU, PAR, VIN, SEM = "EX9_PROF", "EX9_ALU", "EX9_PAR", "EX9_VIN", "EX9_SEM"
NOVAS_CON = [24004, 24008, 24012, 24016, 24020]


def ddl(versao):
    return """
CREATE TABLE EX9_PAC (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40), FONE VARCHAR(15));
CREATE TABLE EX9_CON (ID INTEGER NOT NULL PRIMARY KEY, PAC INTEGER, DATA DATE, PRESENCA CHAR(1));
CREATE TABLE EX9_PROF (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40), CPF VARCHAR(11), CONSELHO VARCHAR(10));
CREATE TABLE EX9_ALU (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40), CPF VARCHAR(11));
CREATE TABLE EX9_PAR (ID INTEGER NOT NULL PRIMARY KEY, DOC VARCHAR(10), VALOR NUMERIC(12,2));
CREATE TABLE EX9_VIN (ID INTEGER NOT NULL PRIMARY KEY, PAC INTEGER, UNIDADE VARCHAR(10));
CREATE TABLE EX9_SEM (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40), PRIORIDADE INTEGER);
CREATE GENERATOR EX9_GEN_CON;
SET GENERATOR EX9_GEN_CON TO %d;
""" % (24020 if versao == 2 else 24000)


DDL = ddl(1)

_A = (", origem VARCHAR(20) NOT NULL, criado_em DATETIME(3) NOT NULL, alterado_em DATETIME(3) NULL,"
      " versao INT UNSIGNED NOT NULL DEFAULT 1, excluido_em DATETIME(3) NULL")
DDL_DESTINO = """
CREATE TABLE ex9_paciente (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(60) NOT NULL,
  telefone VARCHAR(20) NULL, unidade VARCHAR(10) NULL{a});
CREATE TABLE ex9_pessoa (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cpf VARCHAR(11) NOT NULL, nome VARCHAR(60) NULL{a});
CREATE TABLE ex9_profissional (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pessoa_id BIGINT UNSIGNED NOT NULL,
  conselho VARCHAR(10) NULL{a});
CREATE TABLE ex9_aluno (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pessoa_id BIGINT UNSIGNED NOT NULL{a});
CREATE TABLE ex9_titulo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, documento VARCHAR(10) NOT NULL,
  quantidade INT NOT NULL, valor_total DECIMAL(12,2) NOT NULL{a});
CREATE TABLE ex9_parcela (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, titulo_id BIGINT UNSIGNED NOT NULL,
  valor DECIMAL(12,2) NOT NULL{a});
CREATE TABLE ex9_setor (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(40) NOT NULL UNIQUE,
  prioridade INT NOT NULL DEFAULT 3, origem VARCHAR(20) NOT NULL, criado_em DATETIME(3) NOT NULL,
  alterado_em DATETIME(3) NULL, versao INT UNSIGNED NOT NULL DEFAULT 1);
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
    "tabelas": [_t(PAC, "ex9_paciente", 1, "ID"), _t(CON, "ex9_consulta", 2, "ID"),
                _t(PROF, "ex9_profissional,ex9_pessoa", 3, "ID"), _t(ALU, "ex9_aluno,ex9_pessoa", 4, "ID"),
                _t(PAR, "ex9_parcela,ex9_titulo", 5, "ID"), _t(VIN, "ex9_paciente", 6, "ID"),
                _t(SEM, "ex9_setor", 7, "ID")],
    "colunas": [_g(PAC, "ID", "inteiro"), _g(PAC, "NOME", "texto"), _g(PAC, "FONE", "texto"),
                _g(CON, "ID", "inteiro"), _g(CON, "PAC", "inteiro"), _g(CON, "DATA", "data"),
                _g(CON, "PRESENCA", "booleano_sn"),
                _g(PROF, "ID", "inteiro"), _g(PROF, "NOME", "texto"), _g(PROF, "CPF", "texto"),
                _g(PROF, "CONSELHO", "texto"), _g(ALU, "ID", "inteiro"), _g(ALU, "NOME", "texto"),
                _g(ALU, "CPF", "texto"), _g(PAR, "ID", "inteiro"), _g(PAR, "DOC", "texto"),
                _g(PAR, "VALOR", "decimal"), _g(VIN, "ID", "inteiro"), _g(VIN, "PAC", "inteiro"),
                _g(VIN, "UNIDADE", "texto"), _g(SEM, "ID", "inteiro"), _g(SEM, "NOME", "texto"),
                _g(SEM, "PRIORIDADE", "inteiro")],
    "colunas_decl": [_d(PAC, "NOME", "ex9_paciente.nome", regra="texto_nome"),
                     _d(PAC, "FONE", "ex9_paciente.telefone"),
                     _d(CON, "PAC", "ex9_consulta.paciente_id", via="ref:EX9_PAC"),
                     _d(CON, "DATA", "ex9_consulta.data"),
                     _d(CON, "PRESENCA", "ex9_consulta.presente", regra="booleano_sn"),
                     _d(PROF, "@id:ex9_pessoa", "ex9_profissional.pessoa_id"),
                     _d(PROF, "CONSELHO", "ex9_profissional.conselho"),
                     _d(PROF, "CPF", "ex9_pessoa.cpf", via="antes;adotar:cpf"),
                     _d(PROF, "NOME", "ex9_pessoa.nome", regra="texto_nome"),
                     _d(ALU, "@id:ex9_pessoa", "ex9_aluno.pessoa_id"),
                     _d(ALU, "CPF", "ex9_pessoa.cpf", via="antes;adotar:cpf"),
                     _d(ALU, "NOME", "ex9_pessoa.nome", regra="texto_nome"),
                     _d(PAR, "@id:ex9_titulo", "ex9_parcela.titulo_id"),
                     _d(PAR, "VALOR", "ex9_parcela.valor", regra="decimal"),
                     _d(PAR, "DOC", "ex9_titulo.documento", via="antes;agrupar:DOC"),
                     _d(PAR, "#grupo_contar", "ex9_titulo.quantidade"),
                     _d(PAR, "#grupo_somar:VALOR", "ex9_titulo.valor_total"),
                     _d(VIN, "PAC", "ex9_paciente.id", via="ref:EX9_PAC;complementa"),
                     _d(VIN, "UNIDADE", "ex9_paciente.unidade"),
                     _d(SEM, "NOME", "ex9_setor.nome"),
                     _d(SEM, "PRIORIDADE", "ex9_setor.prioridade", regra="inteiro")],
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
    profs = [(3, "PROF TRES ALTERADO")] if v2 else [(1, "PROF UM"), (2, "PROF DOIS"), (3, "PROF TRES")]
    for i, nome in profs:
        ins(PROF, [i, nome, "%d" % (i * 11111111111), "CRM%d" % i])
    ins(ALU, [1, "PROF UM", "11111111111"])
    pars = [(1, "100", 15), (3, "200", 5)] if v2 else [(1, "100", 10), (2, "100", 20), (3, "200", 5)]
    for i, doc, valor in pars:
        ins(PAR, [i, doc, valor])
    vins = [(1, 5, "U9")] if v2 else [(1, 5, "U1"), (2, 6, "U2")]
    for x in vins:
        ins(VIN, list(x))
    sems = [(1, "SETOR 1", None), (2, "SETOR 1", 4)] if v2 else [(1, "SETOR 1", 7), (2, "SETOR 2", 4), (3, "SETOR 3", 2)]
    for x in sems:
        ins(SEM, list(x))
    return {PAC: {"gravados": len(pacs), "pendencias": {}}, CON: {"gravados": len(cons), "pendencias": {}},
            PROF: {"gravados": len(profs), "pendencias": {}}, ALU: {"gravados": 1, "pendencias": {}},
            PAR: {"gravados": len(pars), "pendencias": {}}, VIN: {"gravados": len(vins), "pendencias": {}},
            SEM: {"gravados": len(sems), "pendencias": {"restricao_destino_1062": 1} if v2 else {}}}
