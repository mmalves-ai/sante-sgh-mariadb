"""Fatia L5-03 (cadastros e administração): tabelas da origem carregáveis hoje pela carga dirigida pelo mapa.

Dados 100% falsos (identificadores no arco inventado 9.99, nomes inventados). Anomalias cobertas:
- identificador repetido (único no destino: restricao_destino_1062);
- código ou nome ausente em coluna obrigatória do destino (restricao_destino_1048);
- nome com espaços repetidos (texto_nome colapsa) e descrição com quebra de linha (texto preserva);
- identificador com conselho e tipo preenchidos (ainda sem via no motor: entram como 'outro', conselho NULL).

TBALERTA fica na imagem, mas NÃO é carregada (sem coluna declarada) até o motor ter o de-para de sexo
(ID_TBSEXO -> sexo_aplicavel), a repetição (REPETIR_HORAS*60+REPETIR_MINUTOS -> intervalo) e a exibição
(TP_EXIBICAO -> gravidade/bloqueante): carregá-la sem isso mudaria o significado da regra (pedido no L5-03.json).
As linhas já trazem os casos que a futura conferência tem de provar: sexo feminino e masculino, repetição a cada N
minutos, faixa de idade 0..12, 0..0, 30..0 (possível marcador de faixa aberta), invertida, cenário ausente e nunca
carregado, data sentinela, texto longo demais e S/N fora do domínio.
As demais tabelas da fatia dependem de pedidos ao motor (docs/obra/fatias/f4/saida/L5-03.json).
"""
import datetime

DDL = """
CREATE TABLE TBOID (ID SMALLINT NOT NULL PRIMARY KEY, OID VARCHAR(30) NOT NULL, DESCRICAO VARCHAR(100) NOT NULL,
  ID_TBCONSPROF SMALLINT, ID_TBTIPOOID SMALLINT);
CREATE TABLE TBTPMINISTCER (ID SMALLINT NOT NULL PRIMARY KEY, COD_TBTPMINISTCER VARCHAR(8), NOME VARCHAR(60));
CREATE TABLE TBALERTA (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40) NOT NULL, ATIVO CHAR(1),
  IDADE_INICIAL INTEGER, IDADE_FINAL INTEGER, DESCRICAO_ALERTA BLOB SUB_TYPE 1 NOT NULL, TP_EXIBICAO SMALLINT,
  ID_TBSEXO INTEGER, ID_TBCENARIO INTEGER, ORIGEM CHAR(1) NOT NULL, DATA_CAD_INICIO DATE, ALERTA_MENSAL SMALLINT,
  REPETIR_ACRITERIODOUSR CHAR(1), REPETIR_HORAS SMALLINT, REPETIR_MINUTOS SMALLINT, GRAVAR_LOG CHAR(1));
CREATE TABLE TBTPACAOAUDIT (ID SMALLINT NOT NULL PRIMARY KEY, OLD_COD_TP_ACAO_AUDITORIA SMALLINT, NOME VARCHAR(80));
"""
PAIS_EXTERNOS = {"TBCENARIO": ["1", "2"]}
CARREGADAS = ("TBOID", "TBTPMINISTCER", "TBTPACAOAUDIT")
NAO_CARREGADAS = ("TBALERTA",)


def linhas(r, ins):
    # identificadores: o 12 repete o do 3 (único no destino); 2 e 5 trazem conselho
    for i in range(1, 13):
        oid = "9.99.%d.%d" % (1 + i % 3 if i != 12 else 1, 100 + (3 if i == 12 else i))
        descr = "Atributo exemplo %d" % i if i != 4 else "  Atributo\r\ncom quebra  "
        ins("TBOID", [i, oid, descr, 7 if i in (2, 5) else None, 1 + i % 3])
    for c in [(1, "MEX", "  Ministério   Exemplo  "), (2, "EST", "Secretaria Exemplo"), (3, None, "Sem código"),
              (4, "MUN", None), (5, "MEX", "Código repetido")]:
        ins("TBTPMINISTCER", list(c))
    base = datetime.date(2025, 1, 1)
    for i in range(1, 15):
        nome, ativo, ini, fim, cen = "Alerta exemplo %d" % i, "SN"[i % 2], None, None, 1 + i % 2
        dt, texto = base + datetime.timedelta(days=r.randint(0, 300)), "Mensagem de alerta %d ação" % i
        sexo, horas, minutos, exib = None, 0, 0, r.randint(0, 2)
        if i == 1:
            ini, fim = 0, 12
        if i == 2:
            sexo = 2             # só um sexo: não pode virar 'todos'
        if i == 3:
            ativo = "X"          # fora do domínio
        if i == 4:
            ini, fim = 60, 18    # faixa invertida
        if i == 5:
            cen = None           # cenário ausente
        if i == 6:
            cen = 99             # cenário nunca carregado
        if i == 7:
            dt = datetime.date(1899, 12, 30)  # data sentinela em coluna obrigatória
        if i == 8:
            texto = "x" * 1200   # maior que o destino (1000)
        if i == 9:
            nome, texto = "  Alerta   nove ", "Primeira linha\r\n  segunda linha  "
        if i == 10:
            horas, minutos = 2, 30  # repetição a cada 150 minutos: não pode virar 'sempre'
        if i == 11:
            ini, fim = 0, 0      # 0..0: recém-nascido ou faixa aberta?
        if i == 12:
            ini, fim = 30, 0     # 0 no limite superior: faixa aberta ou recusa?
        if i == 13:
            sexo, minutos = 1, 45
        ins("TBALERTA", [i, nome, ativo, ini, fim, texto.encode("cp1252"), exib, sexo, cen, "S", dt,
                         None, "N", horas, minutos, "S"])
    for i in range(1, 9):
        nome = "Ação auditável %d" % i
        if i == 2:
            nome = "  Impressão   de  documento "
        if i == 5:
            nome = None          # descrição obrigatória no destino
        ins("TBTPACAOAUDIT", [i, 100 + i, nome])
    return {
        "TBOID": {"gravados": 11, "pendencias": {"restricao_destino_1062": 1}},
        "TBTPMINISTCER": {"gravados": 2, "pendencias": {"restricao_destino_1048": 2, "restricao_destino_1062": 1}},
        "TBTPACAOAUDIT": {"gravados": 7, "pendencias": {"restricao_destino_1048": 1}},
    }
