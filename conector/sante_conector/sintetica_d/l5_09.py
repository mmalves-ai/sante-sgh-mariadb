"""Fatia L5-09 (cadastros do RH): situações do colaborador e tipos de rescisão; as outras 19 tabelas da fatia são
catálogo oficial (só de-para pelo código) ou tipo de domínio sem linha de destino e ficam fora da carga.

Dados 100% falsos. Anomalias: código de 1 caractere com colisão de caixa ('a' e 'A': a chave única do destino não
distingue caixa: as duas linhas recusadas com codigo_colisao_caixa), descrição nula e só de espaços (NOT NULL no destino), texto com espaços internos
e bytes CP1252, nome com espaços repetidos (colapsados), código RAIS fora da faixa do destino (SMALLINT UNSIGNED).
As tabelas de catálogo oficial entram na imagem para provar que nada delas é gravado.
REQUER a L5-07: a condição do colaborador grava no mesmo destino (código único), e o código numérico '1' da situação
choca com a condição 1 (restricao_destino_1062 até o prefixo de domínio pedido ao integrador); o '4' não choca.
Ainda sem regra genérica no motor (pedido em docs/obra/fatias/f4/saida/L5-09.json): os códigos RAIS 14 a 18 (fora
do catálogo falso 11 a 13) entram sem pendência catalogo_codigo_*; o esperado muda quando o motor ganhar a regra.
"""

REQUER = ["L5-07"]

DDL = """
CREATE TABLE FPSIT_FUNC (COD_SIT VARCHAR(1) NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(40));
CREATE TABLE FPTIPORESC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(80), ID_FPRESC_RAIS INTEGER NOT NULL,
  ID_FPSAQUE VARCHAR(3) NOT NULL, ID_FPRESC_SEFIP VARCHAR(2) NOT NULL, ID_FPRESC_CAGED INTEGER NOT NULL,
  ID_FPRESC_CAUSA INTEGER NOT NULL, ID_FPCAUSA_AFASTAMENTO VARCHAR(3) NOT NULL, ID_FPMOTDESLIG VARCHAR(2));
CREATE TABLE FPRESC_RAIS (COD_RAIS INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(200));
CREATE TABLE FPSAQUE (COD_SAQ VARCHAR(3) NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(180));
CREATE TABLE FPMOTDESLIG (ID VARCHAR(2) NOT NULL PRIMARY KEY, DESCRICAO BLOB SUB_TYPE 1, DATA_VIGENCIA_INICIAL DATE NOT NULL,
  DATA_VIGENCIA_FINAL DATE);
CREATE TABLE FPTPACESSORIA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
"""

SIT, TR = "FPSIT_FUNC", "FPTIPORESC"


def linhas(r, ins):
    import datetime
    for cod, desc in [("A", "Situação exemplo um"), ("F", "Situação exemplo dois"), ("D", "Situação exemplo três"),
                      ("a", "Colide com A pela caixa"),          # chave única sem caixa: codigo_colisao_caixa (as duas)
                      ("X", None),                                # NOT NULL: restricao_destino_1048
                      ("Y", "   "),                             # só espaços vira NULL: restricao_destino_1048
                      ("P", "  Situação  com   espaços  "),      # pontas aparadas, internos preservados
                      ("Z", "Exemplo €“”"),              # bytes CP1252 0x80-0x9F
                      ("1", "Situação numérica"),                # choca com a condição 1 (L5-07): restricao_destino_1062
                      ("4", "Situação numérica sem choque")]:
        ins(SIT, [cod, desc])
    for i in range(1, 9):
        nome, rais = "Tipo exemplo %d" % i, 10 + i
        if i == 3:
            nome = "  Tipo   com  espaços  "                     # texto_nome colapsa
        if i == 5:
            nome = None                                           # NOT NULL: restricao_destino_1048
        if i == 7:
            rais = 70000                                          # fora de SMALLINT UNSIGNED: restricao_destino_1264
        ins(TR, [i, nome, rais, "%02d" % (r.randint(1, 99)), "%d" % (i % 9), 30 + i, i, "%02d" % i, None if i % 2 else "0%d" % i])
    for i in range(1, 4):
        ins("FPRESC_RAIS", [10 + i, "Código oficial falso %d" % i])
        ins("FPSAQUE", ["%02d" % i, "Saque falso %d" % i])
        ins("FPMOTDESLIG", ["0%d" % i, ("Motivo falso %d\r\nlinha dois" % i).encode("cp1252"),
                            datetime.date(2020, 1, i), None])
        ins("FPTPACESSORIA", [i, "Tipo falso %d" % i])
    return {
        SIT: {"gravados": 5, "pendencias": {"codigo_colisao_caixa": 2, "restricao_destino_1062": 1,
                                            "restricao_destino_1048": 2}},
        TR: {"gravados": 6, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1264": 1}},
    }
