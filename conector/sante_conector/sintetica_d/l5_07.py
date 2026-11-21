"""Fatia L5-07 (cadastros do RH): tabelas da origem com os mesmos nomes e tipos do dicionário e dados 100% falsos.

Só a condição do colaborador é carregada (vira situacao_colaborador INATIVA, código 'cond_<n>' pelo prefixo de domínio
e categoria 'outro' presumida: nenhuma coluna da origem a referencia). As outras 21 são descarte de produto
(`declarado/sem_carga.tsv`): 4 cópias de catálogo oficial (nunca gravado; 3 aguardam o carregador oficial), 15 listas
de domínio fixo do leiaute (de-para pela descrição na coluna consumidora) e 2 listas públicas extintas sem consumidor:
entram na imagem para provar que nada delas é gravado.
Anomalias: descrição nula (NOT NULL no destino: recusa só a linha), espaços internos (texto_nome colapsa), acentos
CP1252, lacunas na chave, chave alta (o código com prefixo cabe), valor_presumido em toda linha lida.
"""
DDL = """
CREATE TABLE FPADMESOCIAL (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(100));
CREATE TABLE FPAFAST_COD (COD_AFA VARCHAR(2) NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(300));
CREATE TABLE FPAFAST_RAIS (COD_AFA_RAIS VARCHAR(2) NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(300));
CREATE TABLE FPALIQRATCNAE (CNAE INTEGER NOT NULL PRIMARY KEY, ALIQUOTA_RAT SMALLINT);
CREATE TABLE FPASOEXAMEORD (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(15));
CREATE TABLE FPASOINDRESUL (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(15));
CREATE TABLE FPASOINTEXAME (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(5));
CREATE TABLE FPASORESULTADO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(10));
CREATE TABLE FPASOTIPO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(70));
CREATE TABLE FPBANCOPIS (COD_PIS SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50));
CREATE TABLE FPBR_PDH (COD_BR_PDH VARCHAR(1) NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50));
CREATE TABLE FPCATTIPO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(70));
CREATE TABLE FPCATTPEMIS (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(60));
CREATE TABLE FPCATTPLOCACD (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(70));
CREATE TABLE FPCATTPREG (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(70));
CREATE TABLE FPCAUSA_AFASTAMENTO (COD_AFA VARCHAR(3) NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(100));
CREATE TABLE FPCLASSIFTRIB (DESCRICAO VARCHAR(150), ID VARCHAR(2) NOT NULL PRIMARY KEY);
CREATE TABLE FPCODALIQFPAS (ID SMALLINT NOT NULL PRIMARY KEY, COD_FPCODALIQFPAS SMALLINT NOT NULL,
  SITUACAO_CONTRIBUINTE BLOB SUB_TYPE 1, CODIGO_TERCEIRO SMALLINT, PERCENTUAL_ALIQUOTA NUMERIC(4,2));
CREATE TABLE FPCONDFUNC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(150));
CREATE TABLE FPCOND_TRAB_IMIGRANTE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(150));
CREATE TABLE FPCOR (COD_COR INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(20), COD_ESOCIAL SMALLINT);
CREATE TABLE FPDOSE_VACINA (COD_DOSE_VAC SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50));
"""

CONDICOES = [(1, "Em atividade"), (2, "  Afastado   temporariamente  "), (3, None), (5, "Férias coletivas"),
             (6, "Licença não remunerada"), (8, "Cedido a outra unidade"), (9, "Aposentado por invalidez"),
             (12, "Suspensão disciplinar"), (300, "Condição de chave alta")]

NAO_CARREGADAS = ["FPADMESOCIAL", "FPAFAST_COD", "FPAFAST_RAIS", "FPALIQRATCNAE", "FPASOEXAMEORD", "FPASOINDRESUL",
                  "FPASOINTEXAME", "FPASORESULTADO", "FPASOTIPO", "FPBANCOPIS", "FPBR_PDH", "FPCATTIPO",
                  "FPCATTPEMIS", "FPCATTPLOCACD", "FPCATTPREG", "FPCAUSA_AFASTAMENTO", "FPCLASSIFTRIB",
                  "FPCODALIQFPAS", "FPCOND_TRAB_IMIGRANTE", "FPCOR", "FPDOSE_VACINA"]


def linhas(r, ins):
    for i in (1, 2, 4):
        ins("FPADMESOCIAL", [i, "Tipo de admissão %d" % i])
    for c in ("01", "1A", "03"):
        ins("FPAFAST_COD", [c, "Código de afastamento %s" % c])
        ins("FPAFAST_RAIS", [c, "Afastamento anual %s" % c])
        ins("FPCAUSA_AFASTAMENTO", [c, "Causa de saída %s" % c])
    for cnae in (8610101, 8610102, 8630503):
        ins("FPALIQRATCNAE", [cnae, r.randint(1, 3)])
    for t in ("FPASOEXAMEORD", "FPASOINDRESUL", "FPASORESULTADO", "FPCATTIPO", "FPCATTPEMIS", "FPCATTPLOCACD",
              "FPCATTPREG", "FPASOTIPO", "FPCOND_TRAB_IMIGRANTE"):
        for i in (1, 2):
            ins(t, [i, "Opção %d" % i])
    ins("FPASOINTEXAME", [1, "Sim"])
    ins("FPASOINTEXAME", [2, "Não"])
    for i, n in ((1, "Banco um"), (2, "Banco dois")):
        ins("FPBANCOPIS", [i, n])
    for c in ("a", "A", "1"):
        ins("FPBR_PDH", [c, "Indicador %s" % c])
    for c in ("01", "02"):
        ins("FPCLASSIFTRIB", ["Classificação %s" % c, c])
    for i in range(1, 4):
        ins("FPCODALIQFPAS", [i, 500 + i, ("Situação %d\r\n  linha dois" % i).encode("cp1252"), i * 4,
                              r.randint(0, 900) / 100])
    for i, (n, e) in enumerate((("Branca", 1), ("Preta", 2), ("Não informada", None)), 1):
        ins("FPCOR", [i, n, e])
    for i, n in ((1, "Primeira dose"), (2, "Segunda dose"), (9, "Reforço")):
        ins("FPDOSE_VACINA", [i, n])
    for c in CONDICOES:
        ins("FPCONDFUNC", list(c))
    # valor_presumido: uma por linha lida (categoria presumida), inclusive a recusada
    return {"FPCONDFUNC": {"gravados": len(CONDICOES) - 1,
                           "pendencias": {"restricao_destino_1048": 1, "valor_presumido": len(CONDICOES)}}}
