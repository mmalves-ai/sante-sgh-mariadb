"""Fatia L5-07 (cadastros do RH): tabelas da origem com os mesmos nomes e tipos do dicionário e dados 100% falsos.

Rodada 5 (ADR 0006, decisão r5-1/r5-2): as 19 listas legais do RH entram inteiras como listas do hospital
(`parametro_opcao` sob `parametro_definicao` `rh.lista.<nome>`, módulo `migracao`, criados pela 1.ª linha e
adotados). A condição do colaborador vira situacao_colaborador INATIVA ('cond_<n>', categoria 'outro' presumida).
Só FPBANCOPIS segue descarte (catálogo oficial de bancos, carregador do Banco Central).
Anomalias: descrição nula (o rótulo vira o código), descrição longa (texto_resumido), código alfanumérico com caixa
(FPBR_PDH 'a' e 'A' distintos; ordem pelos pares de valores.d), código alfanumérico do SEFIP fora do domínio gerado
(minúsculo: valor_fora_do_dominio, sem ordem, recusa visível), CNAE em listas por alíquota RAT, alíquota nula
(sem lista: recusa visível), espaços internos, acentos CP1252, lacunas e chave alta na condição.
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

NAO_CARREGADAS = ["FPBANCOPIS"]
LISTAS = ["FPADMESOCIAL", "FPAFAST_COD", "FPAFAST_RAIS", "FPALIQRATCNAE", "FPASOEXAMEORD", "FPASOINDRESUL",
          "FPASOINTEXAME", "FPASORESULTADO", "FPASOTIPO", "FPBR_PDH", "FPCATTIPO", "FPCATTPEMIS", "FPCATTPLOCACD",
          "FPCATTPREG", "FPCAUSA_AFASTAMENTO", "FPCLASSIFTRIB", "FPCODALIQFPAS", "FPCOND_TRAB_IMIGRANTE", "FPCOR",
          "FPDOSE_VACINA"]
ESPERADO = {}


def _e(t, n, **pend):
    ESPERADO[t] = {"gravados": n, "pendencias": pend}


# adotado_existente: o módulo 'migracao' e a definição da lista criados pela 1.ª linha lida e adotados pelas outras
for _t in ("FPASOEXAMEORD", "FPASOINDRESUL", "FPASOINTEXAME", "FPASORESULTADO", "FPASOTIPO", "FPCATTIPO", "FPCATTPEMIS",
           "FPCATTPLOCACD", "FPCATTPREG", "FPCLASSIFTRIB", "FPCOND_TRAB_IMIGRANTE"):
    _e(_t, 2, adotado_existente=3)
for _t in ("FPAFAST_RAIS", "FPCAUSA_AFASTAMENTO", "FPCODALIQFPAS", "FPCOR", "FPDOSE_VACINA"):
    _e(_t, 3, adotado_existente=5)
_e("FPADMESOCIAL", 3, adotado_existente=4)       # a 1.ª tabela cria o módulo; descrição nula: rótulo = código
_e("FPAFAST_COD", 3, adotado_existente=5, texto_resumido=1,  # 'x1' minúsculo sem ordem: recusa visível
   valor_fora_do_dominio=1, restricao_destino_1048=1)
_e("FPBR_PDH", 2, adotado_existente=3, restricao_destino_1062=1)  # 'a' x 'A': valor único sem caixa, recusa visível
_e("FPALIQRATCNAE", 4, adotado_existente=5, restricao_destino_1048=1)  # alíquota nula: sem lista, recusa visível


def linhas(r, ins):
    for i in (1, 2, 4):
        ins("FPADMESOCIAL", [i, "Tipo de admissão %d" % i if i != 4 else None])
    longa = "Descrição longa " + " ".join("palavra%d" % i for i in range(25))
    for c in ("O1", "Z5", "01", "x1"):
        ins("FPAFAST_COD", [c, "Código de afastamento %s" % c if c != "Z5" else longa])
    for c in ("10", "20", "70"):
        ins("FPAFAST_RAIS", [c, "Afastamento anual %s" % c])
        ins("FPCAUSA_AFASTAMENTO", [c, "Causa %s" % c])
    for cnae, rat in ((8610101, 3), (8610102, 3), (8630503, 1), (8640202, 2), (8650001, None)):
        ins("FPALIQRATCNAE", [cnae, rat])
    for t in ("FPASOEXAMEORD", "FPASOINDRESUL", "FPASORESULTADO", "FPCATTIPO", "FPCATTPEMIS", "FPCATTPLOCACD",
              "FPCATTPREG", "FPASOTIPO", "FPCOND_TRAB_IMIGRANTE"):
        for i in (1, 2):
            ins(t, [i, " Op  %d " % i])
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
    esp = dict(ESPERADO)
    # valor_presumido: uma por linha lida (categoria presumida), inclusive a recusada
    esp["FPCONDFUNC"] = {"gravados": len(CONDICOES) - 1,
                         "pendencias": {"restricao_destino_1048": 1, "valor_presumido": len(CONDICOES)}}
    return esp
