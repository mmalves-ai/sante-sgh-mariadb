"""Fatia L8-04 (faturamento e restantes, módulo FAT): tabelas da origem com a forma do dicionário, dados 100% falsos
e as anomalias da fatia (rodada de cobertura total).

Carregadas (10 + 2 da rodada 3): tipo de prestador do repasse, tipo de serviço contratado, grupo de ato, tipo de lançamento (duas
origens), função da equipe na cobrança, prestador terceiro (tipo de pessoa PRESUMIDO, CNPJ pela regra), subgrupo de
despesa (subgrupo da natureza financeira, grupo pela referência, classificação copiada do tipo do grupo), preço do procedimento na tabela de honorários (com
o complemento do item faturável do procedimento) e a fórmula de pagamento por via de acesso (vigência da carga).
Fora da carga (12, 2 linhas cada só para presença): descartes com motivo de produto em declarado/sem_carga.tsv.
TBPERTHM saiu da fatia (rodada 3): a L8-03 a declara (desdobrar no destino principal).
PAIS_EXTERNOS: tabela de honorários (TBCTRTHM), grupo de despesa (TBGRUDES), procedimento da tabela (TBPROCTO),
centro de custo (TBCENCUS) e fornecedor (TBFORNEC), registrados como já carregados (ids pela ordem alfabética da tabela e da chave, `id_externo`; rodada 3:
mais TBPROFIS e TBCONVEN); a via de
acesso (TBTISSVIAACES) é terminologia oficial e fica de fora: a fórmula acha a via pelo código TISS no cadastro do
produto (semeado no preparo, como a semente pedida); PREPARO_DESTINO cria o estabelecimento único e os itens faturáveis dos procedimentos (ids de TBPROCTO) que o preço completa.
Rodada 3 (fatia refeita pelo índice novo): regra de crédito da produção (FCCRECUN: profissional e ocupação pela
inscrição, encadeadas; tipo de conta pelo código no catálogo do produto, `cod:tipo_conta.codigo`) e a terminologia TISS
de cada tipo de lançamento (TBTISSTERMO_TBTPLANC: de-para oficial `terminologia` pelo número da tabela). TBCBOPRO e
TBCBOSUS entram na imagem SÓ para as referências encadeadas (CADEIA, de outras fatias); TBPROFIS e TBCONVEN são pais
externos. O preparo semeia três tipos de conta (internacao, externa, ambulatorial: a semente do produto pedida pela
L8-06; urgencia fica de fora para provar codigo_inexistente_destino), uma ocupação CBO e as terminologias 18 e 22.
Anomalias: nome vazio (1048), S/N, 0/1 e sexo fora do domínio, códigos que só diferem pela caixa, pai inexistente
(nulo com pendência, NOT NULL recusa, complemento sem pai recusa), pai recusado (pai_pendente), percentual fora da
faixa, ordem 0 elevada a 1, documento em ponto flutuante (documento_invalido até o pedido 1 e CHECK do documento).
"""
import datetime
import decimal
from pathlib import Path

_MAPA = Path(__file__).resolve().parents[2] / "mapa"


def _dicionario():
    """Colunas (nome, forma, regra) e chave das tabelas pelo mapa gerado (só nomes e tipos)."""
    cols, chaves = {}, {}
    with open(_MAPA / "colunas.tsv", encoding="utf-8") as f:
        cab = f.readline().rstrip("\n").split("\t")
        for l in f:
            r = dict(zip(cab, l.rstrip("\n").split("\t")))
            cols.setdefault(r["tabela"], []).append((r["coluna"], r["forma"], r.get("regra", "")))
    with open(_MAPA / "tabelas.tsv", encoding="utf-8") as f:
        cab = f.readline().rstrip("\n").split("\t")
        for l in f:
            r = dict(zip(cab, l.rstrip("\n").split("\t")))
            chaves[r["tabela"]] = [x for x in (r.get("chave") or "").split(",") if x]
    return cols, chaves


_COLS, _CHAVES = _dicionario()


def _create(t):
    ch = _CHAVES.get(t) or []
    partes = ["%s %s%s" % (c, {"DOUBLE": "DOUBLE PRECISION"}.get(f, f), " NOT NULL" if c in ch else "")
              for c, f, _ in _COLS[t]]
    if ch:
        partes.append("PRIMARY KEY (%s)" % ",".join(ch))
    return "CREATE TABLE %s (%s);" % (t, ", ".join(partes))


def _linha_d(t, **v):
    assert not set(v) - {c for c, _, _ in _COLS[t]}, t
    return [v.get(c) for c, _, _ in _COLS[t]]


R3 = ("FCCRECUN", "TBTISSTERMO_TBTPLANC")  # rodada 3: tabelas que o índice novo trouxe para a fatia
CADEIA = ("TBCBOPRO",)  # de outra fatia (L5-04): só lida pelas referências encadeadas (e carregada sem esperado)

DDL = """
CREATE TABLE TBEMIREFMATMED (ID_TBCONVEN SMALLINT NOT NULL, ID_TBMATMED INTEGER NOT NULL, REF_VALOR_PMC CHAR(1),
  REF_VALOR_PFB CHAR(1), PRIMARY KEY (ID_TBCONVEN,ID_TBMATMED));
CREATE TABLE TBRPATPREPASSE (ID SMALLINT NOT NULL, NOME VARCHAR(10), PRIMARY KEY (ID));
CREATE TABLE TBPRESER (ID INTEGER NOT NULL, ATO SMALLINT NOT NULL, COD SMALLINT NOT NULL, MODULO CHAR(1) NOT NULL,
  NOME VARCHAR(70), VINCULO SMALLINT, REP_FILME VARCHAR(1), CUSTO VARCHAR(1), CGC_CPF DOUBLE PRECISION, CDC INTEGER,
  REPASSE NUMERIC(9,2), PANEST VARCHAR(1), SITUACAO VARCHAR(1), FORN INTEGER, SEM_CESSAO VARCHAR(1), CRM INTEGER,
  CNES INTEGER, REP_SOBRE VARCHAR(1), EQV_SGP INTEGER, ENDERECO VARCHAR(45), BAIRRO VARCHAR(30), CIDADE VARCHAR(30),
  NUMERO INTEGER, CEP INTEGER, UF VARCHAR(2), FONE VARCHAR(15), CBO_ANS INTEGER, ID_TBCBOPRO INTEGER,
  ID_TBRPATPREPASSE SMALLINT, ID_CDCREDENCIADO INTEGER, ID_TBTPDOCUMENTO SMALLINT, PRIMARY KEY (ID));
CREATE TABLE TBSRVCON (COD INTEGER NOT NULL, NOME VARCHAR(60), PRIMARY KEY (COD));
CREATE TABLE TBSTATUSPROCESSA (ID SMALLINT NOT NULL, NOME VARCHAR(40) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE TBSUBDES (GRUPO INTEGER NOT NULL, SUBGRUPO INTEGER NOT NULL, NOME VARCHAR(40), CODCONT VARCHAR(15), CDC
  INTEGER, DESCONTO VARCHAR(1), PRIMARY KEY (GRUPO,SUBGRUPO));
CREATE TABLE TBTABATO (COD SMALLINT NOT NULL, NOME VARCHAR(50), FILME VARCHAR(1), ALTA_COMPLEXIDADE VARCHAR(1),
  PRIMARY KEY (COD));
CREATE TABLE TBTABTHM (ID_TBPROCTO INTEGER NOT NULL, TAB SMALLINT NOT NULL, COD INTEGER NOT NULL, NOME VARCHAR(60),
  CH DOUBLE PRECISION, AUX SMALLINT, FILME DOUBLE PRECISION, COPE DOUBLE PRECISION, INC SMALLINT, PROCMED
  VARCHAR(1), TIPOATO SMALLINT, STAND VARCHAR(1), REPASSE SMALLINT, DTHPACOTE INTEGER, SEXO VARCHAR(1), PACOTE
  VARCHAR(1), EVENTO SMALLINT, PMEDICO VARCHAR(3), PPORTE NUMERIC(9,2), TAB_REF SMALLINT, PROC_REF BIGINT, BILATERAL
  VARCHAR(1), ATOSIP SMALLINT, TITULO VARCHAR(1), PERCSANT NUMERIC(9,2), TIPO_DESP SMALLINT, EQUIV_TISS SMALLINT,
  REVISAO VARCHAR(1), INAMPS INTEGER, QTDE_MAX_GUIA SMALLINT, PERC_PROC_ANT NUMERIC(9,2), PERCSANT_SFILME
  VARCHAR(1), SITUACAO VARCHAR(1), TAB_REF_TUSS SMALLINT, PROC_REF_TUSS INTEGER, ALTA_COMPLEXIDADE VARCHAR(1),
  EXIGE_AUTORIZACAO SMALLINT, QTDE_MAX_GUIA_EXT SMALLINT, LAN_HORA_FINAL VARCHAR(1), DATA_HORA_INCLUSAO TIMESTAMP,
  DATA_HORA_ULTIMA_ATUALIZACAO TIMESTAMP, EXPORTAR_TEMPRO SMALLINT, FORMA_ENVIO CHAR(1), APELIDO_PROCEDIMENTO
  VARCHAR(40), ID_TBSEXO INTEGER, BLOQUEIO CHAR(1), PANE VARCHAR(2), PRIMARY KEY (TAB,COD));
CREATE TABLE TBTIPCOPART (ID SMALLINT NOT NULL, NOME VARCHAR(10) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE TBTIPO_PROCEDIMENTO (ID SMALLINT NOT NULL, CODIGO VARCHAR(2) NOT NULL, DESCRICAO VARCHAR(40) NOT NULL,
  PRIMARY KEY (ID));
CREATE TABLE TBTISSEMIEXP (ID SMALLINT NOT NULL, NOME VARCHAR(15) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE TBTISSFORMAENVPAD (ID SMALLINT NOT NULL, NOME VARCHAR(20) NOT NULL, DATA_VIGENCIA_INICIAL DATE,
  DATA_VIGENCIA_FINAL DATE, PRIMARY KEY (ID));
CREATE TABLE TBTISSGERSPSADTPS (ID SMALLINT NOT NULL, NOME VARCHAR(60) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE TBTISSPARDEF (ID SMALLINT NOT NULL, NOME VARCHAR(100) NOT NULL, ID_TBTISSEMIEXP SMALLINT NOT NULL,
  PRIMARY KEY (ID));
CREATE TABLE TBTISSPOSPROF (ID SMALLINT NOT NULL, NOME VARCHAR(50), PRIMARY KEY (ID));
CREATE TABLE TBGRAUPARTPROC (ID SMALLINT NOT NULL, NOME VARCHAR(45) NOT NULL, ID_TBTISSPOSPROF SMALLINT, PRIMARY KEY
  (ID));
CREATE TABLE TBTISSTPGUIA_TBTISSPARDEF (ID_TBTISSTPGUIA SMALLINT NOT NULL, ID_TBTISSPARDEF SMALLINT NOT NULL,
  PRIMARY KEY (ID_TBTISSTPGUIA,ID_TBTISSPARDEF));
CREATE TABLE TBTPFASEUNIBH (ID SMALLINT NOT NULL, NOME VARCHAR(40) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE TBTPLANC (ID SMALLINT NOT NULL, NOME VARCHAR(25) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE TBFORMULAPAGTO (ID SMALLINT NOT NULL, NOME VARCHAR(30) NOT NULL, ID_TBTPLANC SMALLINT NOT NULL,
  ID_TBTISSVIAACES SMALLINT NOT NULL, PERCENTUAL NUMERIC(9,2), CONSIDERAR SMALLINT, ORDEM SMALLINT, ATIVO CHAR(1),
  PRIMARY KEY (ID));
CREATE TABLE TBCBOSUS (ID INTEGER NOT NULL, COD VARCHAR(6), PRIMARY KEY (ID));
""" + "\n".join(_create(t) for t in R3 + CADEIA) + "\n"

CARREGADAS = ('TBEMIREFMATMED', 'TBGRAUPARTPROC', 'TBRPATPREPASSE', 'TBSRVCON', 'TBTABATO', 'TBTIPO_PROCEDIMENTO', 'TBTPLANC',
              'TBPRESER', 'TBSUBDES', 'TBTABTHM', 'TBFORMULAPAGTO') + R3
# R5 (ADR 0006): as listas de opções CARREGAM como opções de um parâmetro de lista (parametro_opcao); os tipos de
# guia de cada campo TISS, como um parâmetro de lista por campo
LISTAS_R5 = ('TBSTATUSPROCESSA', 'TBTPFASEUNIBH', 'TBTIPCOPART', 'TBTISSEMIEXP', 'TBTISSFORMAENVPAD',
             'TBTISSGERSPSADTPS', 'TBTISSPARDEF', 'TBTISSTPGUIA_TBTISSPARDEF')
# R5: listas do campo adicional de guia e da obrigatoriedade de material (as linhas da L8-05 saíram)
LISTAS_R5_B = ('TBTPTRATUNIBH', 'TBTPPERFILUNIBH', 'TBTPCLASSIFUNIBH', 'TBTPOBRIGAMAT')
DDL += "\n".join(_create(t) for t in LISTAS_R5_B) + "\n"
LISTAS_R5 = LISTAS_R5 + LISTAS_R5_B
CARREGADAS = CARREGADAS + LISTAS_R5
DESCARTADAS = ('TBTISSPOSPROF',)  # terminologia oficial TISS (grau de participação): de-para tiss:35
# TBREFMEMTUSS, TBREFUNI e TBTIPPRO saíram da fatia (rodada 3): a L8-03, dona pelo índice, as declara
SEM_MECANISMO = ()  # TBPERTHM saiu da fatia: a L8-03 (dona pelo índice) a declara desdobrada no principal
# acordo do cliente (NÃO é descarte): declaração pronta e comentada (colunas.d/L8-05.tsv) com o item faturável do
# mat/med (ref:TBMATMED/item_faturavel); só carrega quando a L8-03 carregar TBMATMED com esse destino secundário
AGUARDA_PAI = ()  # TBEMIREFMATMED carrega pelo item de referência (modelo 12_FAT/13, conferidor r4)
BLOQUEADAS = DESCARTADAS + SEM_MECANISMO + AGUARDA_PAI  # fora do plano de carga (nome mantido para os testes)
# linhas recusadas por pai_inexistente no complemento (não é restrição do destino)
RECUSADAS_SEM_PAI = {"TBTABTHM": 1}

# TBTISSVIAACES NÃO entra: é terminologia oficial; a via vem do cadastro do produto pelo código TISS (cod:), semeado
# no preparo como a semente do produto pedida (pedido 4 revisto)
PAIS_EXTERNOS = {"TBCTRTHM": ["7"], "TBGRUDES": ["3", "4"], "TBPROCTO": ["501", "502", "503"], "TBCENCUS": ["40"],
                 "TBFORNEC": ["900"], "TBPROFIS": ["300", "301"], "TBCONVEN": ["10", "11"],
                 "TBMATMED": ["1", "2"]}


def id_externo(tabela, chave):
    """Id que a conferência dá ao pai externo (ordem de tabela e de chave, a partir de 1)."""
    i = 0
    for t, ks in sorted(PAIS_EXTERNOS.items()):
        for k in ks:
            i += 1
            if (t, k) == (tabela, chave):
                return i
    raise KeyError((tabela, chave))


CBO_VALIDO = "225125"
_ITENS = [id_externo("TBPROCTO", k) for k in ("501", "502", "503")]
PREPARO_DESTINO = (
    "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
    " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
    " INSERT INTO item_faturavel (id, codigo, descricao, tipo_item, grupo_faturamento_id, origem, criado_em) VALUES"
    " (%d, 'p501', 'Procedimento exemplo um', 'procedimento', 1, 'migracao', UTC_TIMESTAMP(3)),"
    " (%d, 'p502', 'Procedimento exemplo dois', 'procedimento', 1, 'migracao', UTC_TIMESTAMP(3)),"
    " (%d, 'p503', 'Procedimento exemplo tres', 'procedimento', 1, 'migracao', UTC_TIMESTAMP(3));"
    # rodada 3: semente do catálogo do produto tipo_conta (sem urgencia, de propósito), CBO e terminologias TISS
    " CREATE TABLE IF NOT EXISTS tipo_conta (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(30) NOT NULL,"
    " descricao VARCHAR(150) NOT NULL, natureza VARCHAR(20) NOT NULL, ativo BOOLEAN NOT NULL DEFAULT TRUE,"
    " criado_em DATETIME(3) NOT NULL, UNIQUE KEY uq_tipo_conta_codigo (codigo));"
    " INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES"
    " ('internacao', 'Internação', 'internacao', UTC_TIMESTAMP(3)), ('externa', 'Externa', 'externa', UTC_TIMESTAMP(3)),"
    " ('ambulatorial', 'Ambulatorial', 'ambulatorial', UTC_TIMESTAMP(3));"
    " INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES ('%s', 'Ocupação exemplo', UTC_TIMESTAMP(3));"
    " INSERT INTO terminologia (codigo, nome, tipo, numero_tabela_tiss, criado_em) VALUES"
    " ('tuss_18', 'Terminologia exemplo 18', 'dominio_tiss', '18', UTC_TIMESTAMP(3)),"
    " ('tuss_22', 'Terminologia exemplo 22', 'procedimento', '22', UTC_TIMESTAMP(3)),"
    " ('tiss_35', 'Terminologia exemplo 35', 'dominio_tiss', '35', UTC_TIMESTAMP(3));"
    # grau de participação TISS 00 e 01 no catálogo oficial (06 fica de fora: catalogo_codigo_inexistente)
    " INSERT INTO termo_terminologia (terminologia_id, codigo_termo, descricao, criado_em) SELECT id, x.c, x.d,"
    " UTC_TIMESTAMP(3) FROM terminologia, (SELECT '00' c, 'Grau exemplo zero' d UNION ALL SELECT '01', 'Grau exemplo um') x"
    " WHERE numero_tabela_tiss = '35';"
    # semente do produto: as três vias de acesso da TISS (pedido 4 revisto)
    " CREATE TABLE IF NOT EXISTS via_acesso_cirurgico (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo"
    " VARCHAR(30) NOT NULL, descricao VARCHAR(150) NOT NULL, codigo_tiss VARCHAR(10) NULL, criado_em DATETIME(3) NOT NULL,"
    " UNIQUE KEY uq_via_acesso_cirurgico_codigo_tiss (codigo_tiss));"
    " INSERT INTO via_acesso_cirurgico (codigo, descricao, codigo_tiss, criado_em) VALUES"
    " ('unica', 'Via única', '1', UTC_TIMESTAMP(3)), ('mesma_via', 'Mesma via', '2', UTC_TIMESTAMP(3)),"
    " ('diferentes_vias', 'Diferentes vias', '3', UTC_TIMESTAMP(3));"
    # grupos de despesa e de receita já gravados pela L8-11 (o subgrupo copia o tipo do grupo)
    " CREATE TABLE IF NOT EXISTS grupo_natureza_financeira (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo"
    " VARCHAR(30) NOT NULL, nome VARCHAR(150) NOT NULL, tipo VARCHAR(30) NOT NULL, origem VARCHAR(20) NOT NULL,"
    " criado_em DATETIME(3) NOT NULL);"
    " INSERT INTO grupo_natureza_financeira (id, codigo, nome, tipo, origem, criado_em) VALUES"
    " (%d, '3', 'Grupo exemplo despesa', 'despesa', 'migracao', UTC_TIMESTAMP(3)),"
    " (%d, '4', 'Grupo exemplo receita', 'receita', 'migracao', UTC_TIMESTAMP(3));") % (
    tuple(_ITENS) + (CBO_VALIDO, id_externo("TBGRUDES", "3"), id_externo("TBGRUDES", "4")))

FORMAS_FORA = {
    'TBSTATUSPROCESSA': ('SMALLINT', 'VARCHAR'),
    'TBTIPCOPART': ('SMALLINT', 'VARCHAR'),
    'TBTISSEMIEXP': ('SMALLINT', 'VARCHAR'),
    'TBTISSFORMAENVPAD': ('SMALLINT', 'VARCHAR', 'DATE', 'DATE'),
    'TBTISSGERSPSADTPS': ('SMALLINT', 'VARCHAR'),
    'TBTISSPARDEF': ('SMALLINT', 'VARCHAR', 'SMALLINT'),
    'TBTISSPOSPROF': ('SMALLINT', 'VARCHAR'),
    'TBTISSTPGUIA_TBTISSPARDEF': ('SMALLINT', 'SMALLINT'),
    'TBTPFASEUNIBH': ('SMALLINT', 'VARCHAR'),
}

COLS_PRESER = ("ID ATO COD MODULO NOME VINCULO REP_FILME CUSTO CGC_CPF CDC REPASSE PANEST SITUACAO FORN SEM_CESSAO CRM "
               "CNES REP_SOBRE EQV_SGP ENDERECO BAIRRO CIDADE NUMERO CEP UF FONE CBO_ANS ID_TBCBOPRO ID_TBRPATPREPASSE "
               "ID_CDCREDENCIADO ID_TBTPDOCUMENTO").split()
COLS_THM = ("ID_TBPROCTO TAB COD NOME CH AUX FILME COPE INC PROCMED TIPOATO STAND REPASSE DTHPACOTE SEXO PACOTE EVENTO "
            "PMEDICO PPORTE TAB_REF PROC_REF BILATERAL ATOSIP TITULO PERCSANT TIPO_DESP EQUIV_TISS REVISAO INAMPS "
            "QTDE_MAX_GUIA PERC_PROC_ANT PERCSANT_SFILME SITUACAO TAB_REF_TUSS PROC_REF_TUSS ALTA_COMPLEXIDADE "
            "EXIGE_AUTORIZACAO QTDE_MAX_GUIA_EXT LAN_HORA_FINAL DATA_HORA_INCLUSAO DATA_HORA_ULTIMA_ATUALIZACAO "
            "EXPORTAR_TEMPRO FORMA_ENVIO APELIDO_PROCEDIMENTO ID_TBSEXO BLOQUEIO PANE").split()

D = decimal.Decimal


def _dv(base, pesos_lista):
    d = [int(x) for x in base]
    for pesos in pesos_lista:
        r = sum(x * p for x, p in zip(d, pesos)) % 11
        d.append(0 if r < 2 else 11 - r)
    return "".join(map(str, d))


def cnpj_falso(base12):
    return _dv("%012d" % base12, [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]])


def cpf_falso(base9):
    return _dv("%09d" % base9, [list(range(10, 1, -1)), list(range(11, 1, -1))])


def _valor(forma, i, k):
    """Valor falso para a forma da coluna (só presença na imagem)."""
    if forma in ("SMALLINT", "INTEGER", "BIGINT"):
        return i + k
    if forma == "NUMERIC":
        return D("%d.%02d" % (i + k, k))
    if forma == "DATE":
        return datetime.date(2025, 1 + i % 12, 1 + k % 28)
    return "S"  # CHAR/VARCHAR: cabe em qualquer tamanho da fatia


def _linha(cols, **v):
    assert not set(v) - set(cols), set(v) - set(cols)
    return [v.get(c) for c in cols]


def linhas(r, ins):
    # --- fora da carga: duas linhas por tabela (só presença)
    for t, formas in FORMAS_FORA.items():
        if t in LISTAS_R5:
            continue
        for i in (1, 2):
            ins(t, [_valor(f, i, k) for k, f in enumerate(formas)])

    # --- R5 (ADR 0006): listas de opções -> parametro_opcao; a 3 só espaços (1048, recusada)
    for t in ('TBSTATUSPROCESSA', 'TBTPFASEUNIBH', 'TBTIPCOPART', 'TBTISSEMIEXP', 'TBTISSGERSPSADTPS'):
        for x in [(1, "Exemplo A"), (2, "Exemplo  B"), (3, "   ")]:
            ins(t, list(x))
    for t in ('TBTPTRATUNIBH', 'TBTPPERFILUNIBH'):
        for x in [(1, "Exemplo A"), (2, "Exemplo  B"), (3, "   ")]:
            ins(t, list(x))
    # classificação: tratamento, perfil e fase lidos (sem coluna na opção, pedido R5-3); 3 só espaços (1048)
    for i, n in ((1, "Classe A"), (2, "Classe B"), (3, "   ")):
        ins("TBTPCLASSIFUNIBH", _linha_d("TBTPCLASSIFUNIBH", ID=i, NOME=n, CLASSIFICACAO="C%d" % i,
                                         ID_TBTPTRATUNIBH=1, ID_TBTPPERFILUNIBH=1, ID_TBTPFASEUNIBH=1))
    # obrigatoriedade de material: 3 sem descrição (rótulo presumido)
    for x in [(1, "Obrig A"), (2, "Obrig B"), (3, None)]:
        ins("TBTPOBRIGAMAT", list(x))
    # forma de envio: a 2 tem fim de vigência (entra inativa)
    for x in [(1, "Envio A", datetime.date(2020, 1, 1), None), (2, "Envio B", datetime.date(2020, 1, 1),
                                                                  datetime.date(2024, 12, 31))]:
        ins("TBTISSFORMAENVPAD", list(x))
    # campos TISS configuráveis: 3 só espaços (1048)
    for x in [(1, "Campo exemplo um", 1), (2, "Campo exemplo dois", 2), (3, "  ", 1)]:
        ins("TBTISSPARDEF", list(x))
    # tipos de guia por campo: o campo 1 em dois tipos (parâmetro criado e adotado), o 2 em um; o campo 9 não existe
    # (pai_inexistente e descrição NOT NULL: 1048)
    for x in [(1, 1), (2, 1), (1, 2), (1, 9)]:
        ins("TBTISSTPGUIA_TBTISSPARDEF", list(x))
    # --- tipo de prestador do repasse: 3 sem nome (1048); categoria presumida em toda linha lida
    for x in [(1, "Médico"), (2, "Pessoa  PJ"), (3, None)]:
        ins("TBRPATPREPASSE", list(x))
    # --- tipo de serviço contratado: 3 só espaços (1048); categoria presumida
    for x in [(1, "Internação"), (2, "Laboratório   clínico"), (3, "   "), (4, "Imagem")]:
        ins("TBSRVCON", list(x))
    # --- grupo de ato: 3 com S/N fora do domínio (padrão FALSE + valor_fora_do_dominio), 4 sem nome (1048)
    for x in [(1, "Patologia  clínica", "N", "N"), (2, "Radiologia", "S", None), (3, "Cardiologia", "X", "S"),
              (4, None, "N", "N")]:
        ins("TBTABATO", list(x))
    # --- tipo de lançamento (origem 1): natureza e repasse pelo código (de-para de valores); 'MM' e 'mm' só diferem
    # pela caixa (os dois recusados antes de gravar); 'XX' fora do domínio (valor_fora_do_dominio na natureza e no
    # repasse, recusa 1048)
    for x in [(1, "SH", "Serviço hospitalar"), (2, "SP", "Serviço profissional"), (3, "MM", "Materiais e medicamentos"),
              (4, "mm", "Serviço exemplo"), (5, "XX", "Código fora do domínio")]:
        ins("TBTIPO_PROCEDIMENTO", list(x))
    # --- tipo de lançamento (origem 2): natureza e repasse presumidos (nome livre: 2 valor_presumido por linha); 3 só espaços (1048)
    for x in [(1, "Cirurgia"), (2, "Honorário   médico"), (3, "  "), (4, "Taxas")]:
        ins("TBTPLANC", list(x))
    # --- função da equipe na cobrança: tipo e ordem do auxiliar pelo grau TISS (a chave da tabela 35 é o código);
    # 3 nome vazio (1048); 5 sem grau (o presumido 'outro' é a reserva); 6 grau 77 fora do par e do catálogo;
    # grau 06 fora do catálogo da imagem (catalogo_codigo_inexistente, linha gravada)
    for x in [(1, "Cirurgião", 0), (2, "Primeiro  auxiliar", 1), (3, "", None), (4, "Anestesista", 6),
              (5, "Sem grau", None), (6, "Grau fora", 77)]:
        ins("TBGRAUPARTPROC", list(x))

    # --- prestador terceiro: tipo de pessoa presumido (3); CNPJ e CPF vêm em ponto flutuante (documento_invalido até o
    # pedido 1) e sem documento: as três caem no CHECK do documento (4025)
    base = dict(ATO=1, COD=1, MODULO="F", SITUACAO="A", REP_FILME="N", CUSTO="S", PANEST="N", SEM_CESSAO="N",
                REPASSE=D("30.00"), ENDERECO="Rua Exemplo", NUMERO=10, BAIRRO="Centro", CEP=1310100, FONE="1130000000",
                CNES=1234567, ID_TBRPATPREPASSE=1, CDC=40)
    # base do repasse: C, R e Z (fora do domínio); fornecedor 900 externo e 901 inexistente; centro de custo 41
    # inexistente na terceira
    for i, doc, sobre, forn, cdc in [(1, float(cnpj_falso(112223330001)), "C", 900, 40),
                                     (2, float(cpf_falso(529982247)), "R", None, 40), (3, None, "Z", 901, 41)]:
        ins("TBPRESER", _linha(COLS_PRESER, **dict(base, ID=i, NOME="Prestador  exemplo %d" % i, CGC_CPF=doc,
                                                   REP_SOBRE=sobre, FORN=forn, CDC=cdc)))
    # --- subgrupo: classificação copiada do tipo do grupo (3 despesa, 4 receita, externos); 3 sem nome (1048);
    # grupo 77 inexistente (pai_inexistente + 1048)
    for x in [(3, 1, "Material  de escritório", "3.1.01", 40, "S"), (3, 2, "Limpeza", None, 41, "N"),
              (3, 3, None, None, None, None), (77, 1, "Sem grupo", None, None, None),
              (4, 1, "Receita  de aluguel", None, None, None)]:
        ins("TBSUBDES", list(x))
    # --- preço do procedimento na tabela 7 (externa) e complemento do item do procedimento (501 a 503 externos)
    ts = datetime.datetime(2025, 3, 1, 8, 30)
    thm = [dict(ID_TBPROCTO=501, TAB=7, COD=10101012, NOME="Consulta  em consultório", CH=100.0, AUX=0, SEXO="A", SITUACAO="A",
                EXIGE_AUTORIZACAO=0, BILATERAL="N", ALTA_COMPLEXIDADE="N", TIPOATO=1, APELIDO_PROCEDIMENTO="Consulta",
                QTDE_MAX_GUIA=0),
           # grupo de ato 9 inexistente: NULL com pai_inexistente (linha gravada)
           dict(ID_TBPROCTO=502, TAB=7, COD=30101010, NOME="Cirurgia exemplo", CH=250.5, AUX=2, FILME=0.5, INC=1, SITUACAO="I",
                SEXO="F", EXIGE_AUTORIZACAO=1, BILATERAL="S", ALTA_COMPLEXIDADE="S", TIPOATO=9, QTDE_MAX_GUIA=2),
           # autorização 5 e sexo X fora do domínio: o item fica com o que tinha (2 valor_fora_do_dominio)
           dict(ID_TBPROCTO=503, TAB=7, COD=40301010, NOME="Exame exemplo", CH=None, EXIGE_AUTORIZACAO=5, SEXO="X",
                SITUACAO="Q"),
           # tabela 8 inexistente: pai_inexistente e NOT NULL (1048)
           dict(ID_TBPROCTO=501, TAB=8, COD=1, NOME="Sem tabela", CH=1.0),
           # procedimento 999 inexistente: o complemento recusa a linha (pai_inexistente)
           dict(ID_TBPROCTO=999, TAB=7, COD=50000001, NOME="Sem procedimento", CH=1.0)]
    for x in thm:
        ins("TBTABTHM", _linha(COLS_THM, DATA_HORA_INCLUSAO=ts, DATA_HORA_ULTIMA_ATUALIZACAO=ts, **x))
    # --- fórmula de pagamento: via pelo código TISS (1 e 2 semeadas); via 9 sem linha (codigo_inexistente_destino + 1048); percentual 1500 fora da faixa (NULL + 1048);
    # ordem 0 elevada a 1 e ativo X fora do domínio (gravada); tipo de lançamento 3 recusado (pai_pendente)
    for x in [(1, "Via única principal", 1, 1, D("100.00"), 0, 1, "S"), (2, "Mesma via demais", 1, 2, D("50.00"), 0, 2, "S"),
              (3, "Via inexistente", 1, 9, D("70.00"), 0, 1, "S"), (4, "Percentual alto", 2, 1, D("1500.00"), 0, 1, "N"),
              (5, "Ordem zero", 2, 2, D("70.00"), 0, 0, "X"), (6, "Tipo recusado", 3, 1, D("100.00"), 0, 3, "S")]:
        ins("TBFORMULAPAGTO", list(x))

    # --- rodada 3: tabelas atravessadas pelas encadeadas (inscrição -> profissional e -> CBO da ocupação)
    ins("TBCBOSUS", [1, CBO_VALIDO])
    ins("TBCBOSUS", [2, "999999"])  # fora do catálogo oficial
    for i, sus, prof in [(50, 1, 300), (51, 1, 301), (52, 2, 301), (53, 1, 399)]:
        ins("TBCBOPRO", _linha_d("TBCBOPRO", ID=i, ID_TBCBOSUS=sus, ID_TBPROFIS=prof, UF="ZZ", COD=90000 + i,
                                 VINC_EMPR="N"))
    # --- regra de crédito da produção: tipo de conta pelo código (I/E/A com semente; T = todas, NULL sem pendência;
    # nulo = todas; Z fora do par; U sem linha no catálogo do cliente), ocupação fora do CBO (NULL visível),
    # profissional inexistente e convênio inexistente (pai_inexistente + 1048)
    for x in [(50, 10, 1001, "I"), (50, 11, 1001, "T"), (51, 10, 1002, None), (52, 10, 1003, "E"),
              (51, 11, 1002, "Z"), (53, 10, 1004, "A"), (50, 99, 1001, "I"), (52, 11, 1003, "U")]:
        ins("FCCRECUN", _linha_d("FCCRECUN", ID_TBCBOPRO=x[0], CON=x[1], CRM=x[2], CONTAS=x[3]))
    # --- terminologia TISS do tipo de lançamento (TBTPLANC 1, 2 e 4 gravados; 3 recusado): tabela 19 fora do catálogo
    # (1048), tipo recusado (pai_pendente), tipo 9 inexistente (1048), par repetido (1062)
    for x in [(1, 18, 1), (2, 22, 2), (3, 19, 4), (4, 18, 3), (5, 22, 9), (6, 22, 1), (7, 18, 1)]:
        ins("TBTISSTERMO_TBTPLANC", list(x))
    # --- exceção de preço base por fonte e item de referência (conferidor r4): PFB S = fábrica, senão PMC; 4 fonte
    # inexistente (pai_inexistente, 1048); 5 item inexistente (pai_inexistente; sem item nenhum: CHECK 4025)
    for x in [(10, 1, "N", "S"), (10, 2, "S", "N"), (11, 1, "N", "N"), (99, 2, "N", "S"), (11, 77, "N", "S")]:
        ins("TBEMIREFMATMED", list(x))

    # módulo faturamento e definição do parâmetro: a 1ª lista na ordem do mapa (TBSTATUSPROCESSA) cria os dois e a
    # 2ª linha adota (2); nas outras o módulo já existe (adotado_existente 3 com duas opções gravadas)
    r5 = {t: {"gravados": 2, "pendencias": {"restricao_destino_1048": 1,
                                            "adotado_existente": 2 if t == "TBSTATUSPROCESSA" else 3}}
          for t in ('TBSTATUSPROCESSA', 'TBTPFASEUNIBH', 'TBTIPCOPART', 'TBTISSEMIEXP', 'TBTISSGERSPSADTPS',
                    'TBTISSPARDEF')}
    r5["TBTISSFORMAENVPAD"] = {"gravados": 2, "pendencias": {"adotado_existente": 3}}
    for t in ('TBTPTRATUNIBH', 'TBTPPERFILUNIBH', 'TBTPCLASSIFUNIBH'):
        r5[t] = {"gravados": 2, "pendencias": {"restricao_destino_1048": 1, "adotado_existente": 3}}
    r5["TBTPOBRIGAMAT"] = {"gravados": 3, "pendencias": {"valor_presumido": 1, "adotado_existente": 5}}
    # campo 9 inexistente: descrição do parâmetro NOT NULL (pai_inexistente e 1048); o campo 1 cria o parâmetro dele
    # e a 2ª linha adota (módulo adotado em toda linha gravada)
    r5["TBTISSTPGUIA_TBTISSPARDEF"] = {"gravados": 3, "pendencias": {"pai_inexistente": 1, "adotado_existente": 4,
                                                                     "restricao_destino_1048": 1}}
    return dict(r5, **{
        "TBEMIREFMATMED": {"gravados": 3, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 1,
                                                         "restricao_destino_4025": 1}},
        "FCCRECUN": {"gravados": 6, "pendencias": {"catalogo_codigo_inexistente": 2, "valor_fora_do_dominio": 1,
                                                   "codigo_inexistente_destino": 1, "pai_inexistente": 2,
                                                   "restricao_destino_1048": 2}},
        "TBTISSTERMO_TBTPLANC": {"gravados": 3, "pendencias": {"catalogo_codigo_inexistente": 1, "pai_pendente": 1,
                                                               "pai_inexistente": 1, "restricao_destino_1048": 2,
                                                               "restricao_destino_1062": 1}},
        "TBRPATPREPASSE": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "TBSRVCON": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
        "TBTABATO": {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "TBTIPO_PROCEDIMENTO": {"gravados": 2, "pendencias": {"codigo_colisao_caixa": 2, "valor_fora_do_dominio": 2,
                                                              "restricao_destino_1048": 1}},
        "TBTPLANC": {"gravados": 3, "pendencias": {"valor_presumido": 8, "restricao_destino_1048": 1}},
        # grau 06 e 77 fora do catálogo da imagem; 77 sem par no tipo e na ordem do auxiliar (reserva 'outro');
        # o presumido de reserva fica em toda linha lida (pedido 19)
        # r4: o presumido de reserva (=~outro) só conta quando é o valor usado (pedido 18 atendido)
        "TBGRAUPARTPROC": {"gravados": 5, "pendencias": {"valor_presumido": 3, "catalogo_codigo_inexistente": 2,
                                                         "valor_fora_do_dominio": 2, "restricao_destino_1048": 1}},
        # r4: o documento em DOUBLE de valor inteiro passa a ser lido (sentinela._digitos): um prestador grava
        "TBPRESER": {"gravados": 1, "pendencias": {"valor_presumido": 3, "documento_invalido": 1,
                                                   "pai_inexistente": 2, "valor_fora_do_dominio": 1,
                                                   "restricao_destino_4025": 2}},
        # grupo 77 inexistente: na referência e na cópia do tipo (2) + centro de custo 41 (1)
        "TBSUBDES": {"gravados": 3, "pendencias": {"pai_inexistente": 3, "restricao_destino_1048": 2}},
        "TBTABTHM": {"gravados": 3, "pendencias": {"pai_inexistente": 3, "valor_fora_do_dominio": 3,
                                                   "restricao_destino_1048": 1}},
        # via pelo código TISS: 9 sem linha no cadastro (codigo_inexistente_destino + 1048), percentual fora da faixa
        # (1048), tipo recusado (pai_pendente)
        "TBFORMULAPAGTO": {"gravados": 3, "pendencias": {"vigencia_sem_fonte": 5, "valor_presumido": 5,
                                                         "codigo_inexistente_destino": 1, "restricao_destino_1048": 2,
                                                         "valor_fora_do_dominio": 2, "valor_elevado_ao_minimo": 1,
                                                         "pai_pendente": 1}},
    })
