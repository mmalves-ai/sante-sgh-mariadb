"""Fatia L8-02 (faturamento e restantes, módulo FAT): tabelas da origem com a forma do dicionário e dados 100% falsos.
Rodadas de cobertura total 2 e 3 (F4).

Carregadas (15): RPRENDISENTO, RPTIPOPRESTADOR (categoria presumida), TBCLASSI (código TISS por de-para de valores),
RPEMPCALCIMP (@estabelecimento duas vezes, @vigencia_carga), RPEVENTO (natureza e crédito/débito pelo tipo do evento
V/F/D, de-para de valores com evidência; sem par recusa), RPINTEVE (evento por chave alternativa ref:RPEVENTO.COD,
natureza financeira por chave composta ref:TBITEDES(GRUPO,SUBGRUPO,ITEM)), RPPARUSUEMP (competência por #data:ANO,MES,
usuário pelo login), RPRPA (profissional pela origem ENCADEADA RPRPA_TBCBOPRO > TBCBOPRO > TBPROFIS, situação G e
método E por de-para, fato gerador AAAAMM, totais presumidos), SIORCAME (número derivado, validade = data, paciente
pelo prontuário ref:RICADPAC.PRONT), SIEXAORC (orçamento por chave composta ref:SIORCAME(NOME,ATO), sequência #seq,
nome do exame pela origem encadeada ref:SITABPRO(ATO,EXAME)>NOME) e, na rodada 3: TBCOOPER (cooperativa com a pessoa jurídica gravada ANTES e adotada pelo CNPJ, @id:pessoa_juridica;
município e banco pelos catálogos oficiais), TBINDPRO (valor do índice por procedimento: item faturável pelo CÓDIGO do procedimento,
ref:TBPROCTO.COD_PROCEDIMENTO; código em duas tabelas de honorários dá pai_ambiguo; o id do procedimento usado como
código dá pai_inexistente)
e FCPORANE (valor do porte anestésico, DATE em DATETIME, retrato completo #retrato:* no JSON).
As intermediárias das referências (TBCBOPRO, SITABPRO, RICADPAC) e as tabelas novas da rodada 3 entram com TODAS as
colunas do dicionário. SITABPRO é carregada na conferência pelas declarações da L7-03. TBPROCTO está na imagem só para a
chave alternativa ser LIDA: as declarações dela (L8-03) ficam fora do plano desta conferência (MAPA_TESTE) e os ids
entram como pais já carregados.
Pais externos (TBUSERS, RICADPAC do L3; TBPROFIS, TBCONVEN, TBITEDES) só são registrados como já carregados quando a
ORDEM DO MAPA os põe antes do filho (rodada 2); os da rodada 3 (TBCONVEN, TBPROCTO, TBCTRTHM) entram sempre, e o teste
exige o pedido de dependência registrado para cada par ainda fora de ordem. O CNPJ da cooperativa vem em DOUBLE como
na origem e o esperado é SÓ o correto (pessoa jurídica nova, adoção pelo CNPJ, cooperativa repetida recusada por 1062,
cooperativa sem CNPJ recusada pelo CHECK da pessoa jurídica): até o integrador aplicar os pedidos (dígitos de float
inteiro em sentinela._digitos; CHECK de CNPJ obrigatório em empresa nacional, trilha F2.2), a conciliação de TBCOOPER
FALHA de propósito. SIREFCON (bloqueada: o exame não tem item faturável carregado), o descarte RPRPA_TBCBOPRO, as cinco
listas de opções (bloqueadas: a escolha de cada fonte pagadora ainda não é gravada) (RPLANRPA passou à L8-05, dona pelo índice)
entram só com a forma.
As tabelas que o índice da rodada 3 dá à L8-01 (RPEVENTOESOC, RPLANEVE, RPLANEVE_COMPOSICAOBASE, RPLANEVE_TBCBOPRO,
RPPARAM) saíram desta imagem: são declaradas lá.
"""
import csv
import datetime
import decimal
import os


FORMAS = {
    'RPEMPCALCIMP': ('ID_TBEMPHOS,ID_TBEMPHOS_CONSIDERAR_IMP', [
        ('ID_TBEMPHOS', 'SMALLINT', True), ('ID_TBEMPHOS_CONSIDERAR_IMP', 'SMALLINT', True),
    ]),
    'RPINTEVE': ('EMPRESA,EVENTO', [
        ('EMPRESA', 'SMALLINT', True), ('EVENTO', 'SMALLINT', True), ('GRUPO', 'SMALLINT', False),
        ('SUBGRUPO', 'SMALLINT', False), ('ITEM', 'SMALLINT', False), ('HIST', 'SMALLINT', False),
    ]),
    'RPPARUSUEMP': ('EMPRESA_RPPARAM,USUARIO', [
        ('EMPRESA_RPPARAM', 'SMALLINT', True), ('USUARIO', 'VARCHAR(31)', True),
        ('MES_PROCESSAMENTO', 'SMALLINT', True), ('ANO_PROCESSAMENTO', 'SMALLINT', True),
    ]),
    'RPRENDISENTO': ('ID', [
        ('ID', 'INTEGER', True), ('NOME', 'VARCHAR(150)', False),
    ]),
    'RPEVENTO': ('ID_RPEVENTO', [
        ('ID_RPEVENTO', 'INTEGER', True), ('EMPRESA', 'SMALLINT', True), ('COD', 'SMALLINT', True),
        ('NOME', 'VARCHAR(40)', True), ('CLASSIF', 'SMALLINT', False), ('TIPO_EVENTO', 'CHAR(1)', False),
        ('TIPO_LANC', 'CHAR(1)', False), ('CALCULO_AUT', 'CHAR(1)', False), ('CONTA_FIN', 'SMALLINT', False),
        ('DESC_BASE_IR', 'CHAR(1)', False), ('RETER_INSS', 'CHAR(1)', False),
        ('INCIDIR_PERC_DESC', 'CHAR(1)', False), ('RETER_IRRF', 'CHAR(1)', False),
        ('DESC_BASE_PIS_COFINS_CSLL', 'CHAR(1)', True), ('VALOR', 'NUMERIC(18,2)', False),
        ('DEDUZ_BASE_ISS', 'CHAR(1)', False), ('ATIVO', 'CHAR(1)', False), ('DEDUZIR_BASE_INSS', 'CHAR(1)', False),
        ('DEDUZIR_VALOR_BRUTO_FIN', 'CHAR(1)', False), ('TOTAL_REND_INCIDEM_PERC_DESC', 'SMALLINT', False),
        ('DATA_HORA_INC_ULT_ALT_ESOC', 'TIMESTAMP', False), ('DATA_VIGENCIA_INICIAL', 'DATE', True),
        ('DATA_VIGENCIA_FINAL', 'DATE', False), ('OBSERVACAO', 'VARCHAR(255)', False),
        ('ID_FPCATEGTRAB', 'SMALLINT', False), ('COD_ERP_TERCEIRO', 'VARCHAR(30)', False),
        ('COD_TAB_ERP_TERCEIRO', 'VARCHAR(8)', False), ('ID_FPESOCTPAPURIR', 'SMALLINT', False),
        ('METODO_ENVIO', 'SMALLINT', False), ('ID_RPDEDUTIVEL', 'INTEGER', False),
        ('ID_RPRENDISENTO', 'INTEGER', False), ('INTEGRACAO_FATURAMENTO', 'CHAR(1)', False),
    ]),
    'RPRPA': ('ID_RPRPA', [
        ('EMPRESA', 'SMALLINT', True), ('ID_RPRPA', 'INTEGER', True), ('SERIE', 'VARCHAR(3)', True),
        ('NUMERO', 'INTEGER', True), ('DATA_INI', 'DATE', True), ('DATA_FIN', 'DATE', True),
        ('EMISSAO', 'DATE', True), ('ID_RPLOTES', 'SMALLINT', False), ('HIST', 'SMALLINT', False),
        ('TIPO', 'CHAR(1)', False), ('COD_PRESTADOR', 'INTEGER', False), ('STATUS', 'CHAR(1)', False),
        ('ID_FPLOTTRIBCAD', 'INTEGER', False), ('DATA_HORA_INC_ULT_ALT_ESOC', 'TIMESTAMP', False),
        ('CALCULAR_INSS', 'CHAR(1)', False), ('FATO_GERADOR', 'INTEGER', False),
        ('COMPETENCIA_FATO_GERADOR', 'INTEGER', False), ('METODO_ENVIO', 'CHAR(1)', False),
    ]),
    'RPRPA_TBCBOPRO': ('ID_RPRPA', [
        ('ID_RPRPA', 'INTEGER', True), ('ID_TBCBOPRO', 'INTEGER', True),
    ]),
    'RPTIPOPRESTADOR': ('ID', [
        ('ID', 'SMALLINT', True), ('COD', 'CHAR(1)', True), ('DESCRICAO', 'VARCHAR(25)', True),
    ]),
    'SIEXAORC': ('NOME,EXAME,DATA,ATO', [
        ('NOME', 'VARCHAR(70)', True), ('EXAME', 'VARCHAR(4)', True), ('VALOR', 'NUMERIC(18,2)', False),
        ('ATO', 'SMALLINT', True), ('DATA', 'DATE', True),
    ]),
    'SIORCAME': ('NOME,ATO', [
        ('NOME', 'VARCHAR(70)', True), ('PRONT', 'INTEGER', False), ('CONV', 'SMALLINT', False),
        ('PERC', 'SMALLINT', False), ('DATA', 'DATE', False), ('USUARIO', 'VARCHAR(31)', False),
        ('ATO', 'INTEGER', True),
    ]),
    'SIREFCON': ('ATO,EXAME,CONV,TIPO_CTA', [
        ('EXAME', 'VARCHAR(4)', True), ('CONV', 'SMALLINT', True), ('CODAMB', 'INTEGER', True),
        ('ATO', 'SMALLINT', True), ('TIPO_CTA', 'CHAR(1)', True),
    ]),
    'TBCLASSI': ('COD', [
        ('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(30)', False), ('REF_TISS', 'SMALLINT', False),
        ('CONSID_COD_DESP', 'VARCHAR(1)', False),
    ]),
    'TBCONSBRASINATIVO': ('ID', [
        ('ID', 'SMALLINT', True), ('NOME', 'VARCHAR(40)', True),
    ]),
    'TBCONSIDCALCVLR': ('ID', [
        ('ID', 'SMALLINT', True), ('NOME', 'VARCHAR(25)', True),
    ]),
    'TBCONVCOBTXPA': ('ID', [
        ('ID', 'SMALLINT', True), ('NOME', 'VARCHAR(60)', True),
    ]),
    'TBCONVCONSMAT': ('ID', [
        ('ID', 'SMALLINT', True), ('NOME', 'VARCHAR(40)', True),
    ]),
    'TBCONVMEDREQATD': ('ID', [
        ('ID', 'SMALLINT', True), ('NOME', 'VARCHAR(30)', True),
    ]),
}
# rodada 3: tabelas do índice da L8-02 declaradas agora nesta fatia, com TODAS as colunas do dicionário
NOVAS_R3 = {"TBCOOPER": "COD", "TBINDPRO": "CONV,PROCTO,DATA", "FCPORANE": "TAB,PORTE,DATA_PORTE"}
CARREGADAS = ("RPRENDISENTO", "RPTIPOPRESTADOR", "TBCLASSI", "RPEMPCALCIMP", "RPEVENTO", "RPINTEVE", "RPPARUSUEMP",
              "RPRPA", "SIORCAME", "SIEXAORC") + tuple(NOVAS_R3) + ("SIREFCON",)
COM_DADOS = CARREGADAS + ("RPRPA_TBCBOPRO",)  # intermediária da referência encadeada do RPA (descarte pedido)
COLUNAS = {t: cols for t, (_, cols) in FORMAS.items()}

# intermediárias das referências encadeadas (de outras fatias): todas as colunas do dicionário
_TIPOS_FB = {"DOUBLE": "DOUBLE PRECISION", "BLOB": "BLOB SUB_TYPE 0"}
INTERMEDIARIAS = {"TBCBOPRO": "ID", "SITABPRO": "ATO,CODALF", "RICADPAC": "ID", "TBPROCTO": "ID"}
# só LIDAS pela chave alternativa (pais já carregados em PAIS_EXTERNOS): fora do plano da conferência
SO_LIDAS = ("TBPROCTO",)
DO_DICIONARIO = dict(INTERMEDIARIAS, **NOVAS_R3)
_MAPA = os.path.join(os.path.dirname(__file__), "..", "..", "mapa")


def _dicionario():
    cols = {t: [] for t in DO_DICIONARIO}
    with open(os.path.join(_MAPA, "colunas.tsv"), encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            if r["tabela"] in cols:
                cols[r["tabela"]].append((r["coluna"], _TIPOS_FB.get(r["forma"], r["forma"])))
    return cols


COLS_INTER = _dicionario()


def _mapa_tabelas():
    with open(os.path.join(_MAPA, "tabelas.tsv"), encoding="utf-8") as f:
        return {r["tabela"]: r for r in csv.DictReader(f, delimiter="\t")}


def _ordem():
    """Ordem efetiva de carga: o L3 (carga própria) vem antes de todo lote dirigido pelo mapa."""
    return {t: (-1 if r["lote"] == "L3" else int(r["ordem"])) for t, r in _mapa_tabelas().items()
            if r["ordem"].lstrip("-").isdigit()}


# pai de fora da fatia -> filhos da fatia que o referenciam (ref: declarada)
_FILHOS_EXTERNOS = {"TBUSERS": ("RPPARUSUEMP", "SIORCAME"), "RICADPAC": ("SIORCAME",), "TBPROFIS": ("RPRPA",),
                    "TBCONVEN": ("SIORCAME",), "TBITEDES": ("RPINTEVE",)}
_CHAVES_EXTERNAS = {"TBUSERS": ["USR1", "USR2"], "RICADPAC": [1, 2], "TBPROFIS": [1, 2], "TBCONVEN": [1],
                    "TBITEDES": ["1|1|1"]}
# pai da própria fatia que a carga exige antes do filho
_PAIS_INTERNOS = {"RPINTEVE": "RPEVENTO", "SIEXAORC": "SIORCAME"}


def dependencias_fora_de_ordem(ordem=None):
    """[(filho, pai)] em que o pai vem DEPOIS do filho na ordem do mapa (a carga real recusaria o filho)."""
    o = _ordem() if ordem is None else ordem
    saida = [(f, p) for p, fs in _FILHOS_EXTERNOS.items() for f in fs if o.get(p, 10 ** 9) >= o.get(f, 0)]
    saida += [(f, p) for f, p in _PAIS_INTERNOS.items() if o.get(p, 10 ** 9) >= o.get(f, 0)]
    return sorted(saida)


def _ddl():
    saida = []
    for t, (chave, cols) in FORMAS.items():
        defs = ["%s %s%s" % (c, tp, " NOT NULL" if nn else "") for c, tp, nn in cols]
        if chave:
            defs.append("PRIMARY KEY (%s)" % chave)
        saida.append("CREATE TABLE %s (%s);" % (t, ", ".join(defs)))
    for t, k in DO_DICIONARIO.items():
        saida.append('CREATE TABLE %s (%s, PRIMARY KEY (%s));' % (t, ", ".join('"%s" %s' % c for c in COLS_INTER[t]), k))
    return "\n".join(saida) + "\n"


DDL = _ddl()
# pais de fora da fatia registrados como já carregados SÓ quando a ordem do mapa os põe antes de todos os filhos
_FORA = {p for _, p in dependencias_fora_de_ordem()}
PAIS_EXTERNOS = {p: ks for p, ks in _CHAVES_EXTERNAS.items() if p not in _FORA}
# rodada 3: dependências novas PEDIDAS em saida/L8-02.json (o integrador regenera a ordem). Os pais entram sempre como
# já carregados; o teste confere que cada par fora de ordem tem o pedido registrado.
DEPENDENCIAS_PEDIDAS_R3 = [("SIREFCON", "TBCONVEN"), ("TBINDPRO", "TBCONVEN"), ("TBINDPRO", "TBPROCTO")]
PAIS_EXTERNOS.update({"TBCONVEN": [1], "TBPROCTO": [1, 2, 3], "TBCTRTHM": [10, 20]})


def __getattr__(nome):
    """`MAPA_TESTE` (lido pela conferência): o mapa real sem as declarações de SO_LIDAS (TBPROCTO é da L8-03; aqui só
    a chave alternativa é lida, e o pai já conta como carregado)."""
    if nome != "MAPA_TESTE":
        raise AttributeError(nome)
    from .. import mapa
    m = mapa.carregar_execucao()
    return dict(m, colunas_decl=[c for c in m["colunas_decl"] if c["tabela"] not in SO_LIDAS])


def cnpj_falso(base12):
    """CNPJ de 14 dígitos com dígitos verificadores válidos a partir de 12 dígitos inventados."""
    d = [int(x) for x in "%012d" % base12]
    for pesos in ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]):
        r = sum(x * p for x, p in zip(d, pesos)) % 11
        d.append(0 if r < 2 else 11 - r)
    return "".join(map(str, d))


CNPJ_A, CNPJ_B, CNPJ_C, CNPJ_EXISTENTE = (cnpj_falso(x) for x in (221113330001, 223335550001, 224446660001,
                                                                    225557770001))
# único estabelecimento do cliente de exemplo (o @estabelecimento resolve por ele); catálogos oficiais usados pela
# cooperativa (município, banco); a pessoa jurídica já cadastrada (CNPJ_EXISTENTE) prova a adoção pelo CNPJ
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');"
                   " INSERT INTO municipio_ibge (codigo_ibge, nome, unidade_federativa_id, criado_em) VALUES"
                   " ('3550308', 'Municipio exemplo', 1, UTC_TIMESTAMP(3));"
                   " INSERT INTO banco (codigo_compensacao, codigo_ispb, descricao, vigencia_inicio, versao_fonte,"
                   " criado_em) VALUES ('001', '00000001', 'Banco exemplo', '2020-01-01', 'exemplo', UTC_TIMESTAMP(3));"
                   " INSERT INTO pessoa_juridica (cnpj, razao_social, origem, criado_em) VALUES ('%s',"
                   " 'Pessoa juridica ja cadastrada', 'sistema', UTC_TIMESTAMP(3));" % CNPJ_EXISTENTE)


def _falso(tipo, i):
    """Valor falso pela forma da coluna (tabelas só com a forma)."""
    if tipo.startswith(("SMALLINT", "INTEGER", "BIGINT")):
        return i
    if tipo.startswith(("VARCHAR", "CHAR")):
        n = int(tipo.split("(")[1].rstrip(")"))
        return "S" if n == 1 else (str(i) + " exemplo")[:n]
    if tipo.startswith("NUMERIC"):
        return decimal.Decimal("1.5")
    if tipo == "DATE":
        return datetime.date(2025, 1, i)
    if tipo == "TIMESTAMP":
        return datetime.datetime(2025, 1, i, 8, 30)
    return ("texto exemplo " + str(i)).encode("cp1252")


def _ins(ins, tab, **v):
    if tab in DO_DICIONARIO:
        ins(tab, [v.get(c) for c, _ in COLS_INTER[tab]])
    else:
        ins(tab, [v.get(c) for c, _, _ in COLUNAS[tab]])


D = decimal.Decimal
DT = datetime.date


def linhas(r, ins):
    for tab, cols in COLUNAS.items():
        if tab not in COM_DADOS:
            for i in (1, 2):
                ins(tab, [_falso(tp, i) for _, tp, _ in cols])
    # rendimentos isentos: 3 sem nome (descricao NOT NULL: 1048); 4 com espaços repetidos (colapsados)
    for i, nome in [(1, "Rendimento isento exemplo um"), (2, "Rendimento isento exemplo dois"), (3, None),
                    (4, "  Rendimento   isento  quatro "), (5, "Rendimento isento exemplo cinco")]:
        _ins(ins, "RPRENDISENTO", ID=i, NOME=nome)
    # tipos de favorecido: categoria presumida em todas as gravadas; 'X' e 'x' só diferem pela caixa (os dois
    # recusados com codigo_colisao_caixa)
    for i, cod, desc in [(1, "A", "Tipo exemplo A"), (2, "B", "Tipo exemplo B"), (3, "X", "Tipo exemplo X"),
                         (4, "x", "Tipo exemplo x minusculo"), (5, "C", "  Tipo exemplo C  ")]:
        _ins(ins, "RPTIPOPRESTADOR", ID=i, COD=cod, DESCRICAO=desc)
    # classificações: 4 com código TISS sem par; 5 sem nome (1048); 6 com S/N fora do domínio; 3 sem S/N
    for cod, nome, tiss, cons in [(1, "Classe exemplo um", 1, "S"), (2, "Classe exemplo dois", 2, "N"),
                                  (3, "Classe exemplo tres", 3, None), (4, "Classe  exemplo  quatro", 4, "N"),
                                  (5, None, 5, "N"), (6, "Classe exemplo seis", 7, "X"),
                                  (7, "Classe exemplo sete", None, "S")]:
        _ins(ins, "TBCLASSI", COD=cod, NOME=nome, REF_TISS=tiss, CONSID_COD_DESP=cons)
    # empresa do cálculo cumulativo: (1,1) gravada; (2,3) vira o mesmo par no estabelecimento único (1062)
    _ins(ins, "RPEMPCALCIMP", ID_TBEMPHOS=1, ID_TBEMPHOS_CONSIDERAR_IMP=1)
    _ins(ins, "RPEMPCALCIMP", ID_TBEMPHOS=2, ID_TBEMPHOS_CONSIDERAR_IMP=3)
    # eventos: 1 vencimento normal; 2 desconto com valor negativo (pendência, gravado); 3 tipo sem par (recusa);
    # 4 fixo com vigência invertida (CHECK)
    base = dict(EMPRESA=1, DESC_BASE_PIS_COFINS_CSLL="N", RETER_INSS="S", RETER_IRRF="N", CALCULO_AUT="S", ATIVO="S",
                METODO_ENVIO=0, CLASSIF=1, CONTA_FIN=2)
    for i, cod, nome, te, tl, val, ini, fim in [
            (1, 10, "Consulta exemplo", "V", "V", D("100.00"), DT(2024, 1, 1), None),
            (2, 11, "Desconto  exemplo", "D", "V", D("-5.00"), DT(2024, 1, 1), None),
            (3, 12, "Evento tipo desconhecido", "X", "P", None, DT(2024, 1, 1), None),
            (4, 13, "Evento vigencia invertida", "F", "V", None, DT(2025, 5, 1), DT(2025, 1, 1))]:
        _ins(ins, "RPEVENTO", ID_RPEVENTO=i, COD=cod, NOME=nome, TIPO_EVENTO=te, TIPO_LANC=tl, VALOR=val,
             DATA_VIGENCIA_INICIAL=ini, DATA_VIGENCIA_FINAL=fim, **base)
    # vínculo contábil: 10 normal; 11 sem natureza (CHECK do destino contábil); 99 evento inexistente
    for ev, g in [(10, 1), (11, None), (99, 1)]:
        _ins(ins, "RPINTEVE", EMPRESA=1, EVENTO=ev, GRUPO=g, SUBGRUPO=g, ITEM=g, HIST=5 if g else None)
    # competência por usuário: USR1 03/2026; USR2 mês 13 (recusa); login inexistente (recusa)
    for u, m in [("USR1", 3), ("USR2", 13), ("NINGUEM", 1)]:
        _ins(ins, "RPPARUSUEMP", EMPRESA_RPPARAM=1, USUARIO=u, MES_PROCESSAMENTO=m, ANO_PROCESSAMENTO=2026)
    # RPA: 1 normal (inscrição 301 -> profissional 1); 2 sem inscrição (recusa); 3 período invertido (CHECK);
    # 4 série e número repetidos do 1 (1062). Situação: G (par) ou Z (sem par: padrão emitido + pendência);
    # método E ou nulo; fato gerador AAAAMM, 0 (nulo) ou mês 13 (valor_fora_do_dominio)
    for i, num, ini, fim, st, met, comp in [
            (1, 1, DT(2025, 3, 1), DT(2025, 3, 31), "G", "E", 202503), (2, 2, DT(2025, 3, 1), DT(2025, 3, 31), "G", "E", 0),
            (3, 3, DT(2025, 4, 30), DT(2025, 4, 1), "Z", None, 202513), (4, 1, DT(2025, 5, 1), DT(2025, 5, 31), "G", "E", 0)]:
        _ins(ins, "RPRPA", EMPRESA=1, ID_RPRPA=i, SERIE="A", NUMERO=num, DATA_INI=ini, DATA_FIN=fim,
             EMISSAO=fim, CALCULAR_INSS="S", STATUS=st, METODO_ENVIO=met, COMPETENCIA_FATO_GERADOR=comp,
             DATA_HORA_INC_ULT_ALT_ESOC=datetime.datetime(2025, 6, 1, 8, 0), TIPO="M", COD_PRESTADOR=i, HIST=0,
             FATO_GERADOR=0)
    for rpa, insc in [(1, 301), (3, 302), (4, 301)]:
        _ins(ins, "RPRPA_TBCBOPRO", ID_RPRPA=rpa, ID_TBCBOPRO=insc)
    for i, prof in [(301, 1), (302, 2)]:   # ids das inscrições diferentes dos profissionais
        _ins(ins, "TBCBOPRO", ID=i, ID_TBPROFIS=prof, UF="SP", COD=7000 + i)
    # orçamentos: Um/1 normal com paciente pelo prontuário; Um/2 colide no número derivado (1062); Dois/1 percentual
    # fora da faixa e prontuário sem paciente (pai_inexistente, gravado); Tres sem data
    for i, pront in [(1, 501), (2, 502)]:
        _ins(ins, "RICADPAC", ID=i, PRONT=pront, NOME="Paciente exemplo %d" % i)
    for nome, ato, perc, data, conv, usu, pront in [
            ("Interessado Exemplo Um", 1, 10, DT(2025, 6, 1), 1, "USR1", 501),
            ("Interessado Exemplo Um", 2, None, DT(2025, 6, 2), 1, "USR1", None),
            ("Interessado  Exemplo Dois", 1, 150, DT(2025, 6, 3), 1, "USR2", 999),
            ("Interessado Exemplo Tres", 1, None, None, None, None, None)]:
        _ins(ins, "SIORCAME", NOME=nome, ATO=ato, PERC=perc, DATA=data, CONV=conv, USUARIO=usu, PRONT=pront)
    # r4: CODAMB = código do procedimento do exame (10101 numa tabela; 10102 em duas: vale a menor chave; 99999 sem
    # procedimento)
    for i, ato, cod, nome, amb in [(1, 1, "HEM", "Hemograma exemplo", 10101), (2, 1, "GLI", "Glicose exemplo", 10102),
                                   (3, 2, "HEM", "Hemograma setor dois exemplo", 99999)]:
        _ins(ins, "SITABPRO", ID=i, ATO=ato, CODALF=cod, NOME=nome, CODAMB=amb)
    # r4: código de cobrança do exame por fonte pagadora: 1 completo; 2 procedimento em duas tabelas (menor chave,
    # escolha_pelo_menor); 3 exame sem procedimento (1048); 4 tipo de conta fora do domínio (RECUSADA, exige_dominio); 5 exame inexistente (1048)
    for ato, ex, conv, tc, amb in [(1, "HEM", 1, "A", 501), (1, "GLI", 1, "I", 502), (2, "HEM", 1, "T", 503),
                                   (1, "HEM", 1, "X", 504), (9, "ZZZ", 1, "A", 505)]:
        _ins(ins, "SIREFCON", ATO=ato, EXAME=ex, CONV=conv, TIPO_CTA=tc, CODAMB=amb)
    # cooperativas: 1 completa (pessoa jurídica nova); 2 CNPJ já cadastrado (adotada), conta e ISS fora do domínio;
    # 3 sem CNPJ (CHECK da pessoa jurídica: recusa); 4 município e banco fora do catálogo (gravada, NULL); 5 mesmo
    # CNPJ da 1 (adota a mesma pessoa: a cooperativa repetida recusa por 1062); 6 sem nome (1048)
    base = dict(IBGE=3550308, BANCO=1, AGENCIA=1234, DG_AGENCIA="5", CONTA=98765, DG_CONTA="0", TP_CONTA="C",
                RETER_IR="S", ALIQUOTA_IR=D("1.50"), P_ISS=D("2.00"), P_PIS=D("0.65"), P_COFINS=D("3.00"),
                P_CSLL=D("1.00"), REPASSE=80.0, ATIVO="S", IMPOSTOS10REAIS="S", OPT_SIMPLES="N", CEP=1310100,
                CNES=1234567, LOCAL="Rua Exemplo", NUM=10, BAIRRO="Bairro Exemplo", FONE="1100000000", UF="SP",
                CIDADE="Cidade Exemplo", P_R_CO=D("70.00"))
    for cod, nome, cnpj, extra in [
            (1, "Cooperativa Exemplo Um", CNPJ_A, {}),
            (2, "Cooperativa  Exemplo  Dois", CNPJ_EXISTENTE, dict(TP_CONTA="X", P_ISS=D("150.00"))),
            (3, "Cooperativa Exemplo Sem Documento", None, {}),
            (4, "Cooperativa Exemplo Quatro", CNPJ_B, dict(IBGE=9999999, BANCO=999)),
            (5, "Cooperativa Exemplo Repetida", CNPJ_A, {}),
            (6, None, CNPJ_C, {})]:
        _ins(ins, "TBCOOPER", **dict(base, COD=cod, NOME=nome, CGC=float(cnpj) if cnpj else None, **extra))
    # procedimentos (só lidos pela chave alternativa): 10101 numa tabela de honorários; 10102 em duas
    for i, tab, cod in [(1, 10, 10101), (2, 10, 10102), (3, 20, 10102)]:
        _ins(ins, "TBPROCTO", ID=i, ID_TBCTRTHM=tab, COD_PROCEDIMENTO=cod, NOME="Procedimento exemplo %d" % i)
    # índice por procedimento (PROCTO = código): dois valores do 10101 (vigências); valor negativo (recusa); código
    # em duas tabelas (pai_ambiguo, recusa); o ID 1 usado como código (pai_inexistente: a ligação não é pelo id)
    for proc, data, val in [(10101, DT(2025, 1, 1), D("0.5000")), (10101, DT(2025, 6, 1), D("0.7000")),
                            (10101, DT(2025, 9, 1), D("-1.0000")), (10102, DT(2025, 1, 1), D("0.8000")),
                            (1, DT(2025, 1, 1), D("0.9000"))]:
        _ins(ins, "TBINDPRO", CONV=1, PROCTO=proc, DATA=data, VALOR=val)
    # porte anestésico: 10/1 em duas vigências (com equivalência ao porte médico, no retrato); sem valor (1048);
    # tabela inexistente (recusa); 20/0 sem equivalência
    for tab, porte, data, val, qt, pm in [(10, "1", DT(2024, 1, 1), D("100.1234"), 1.5, "1A"),
                                          (10, "1", DT(2024, 6, 1), D("120.0000"), 1.5, "1A"),
                                          (10, "2", DT(2024, 1, 1), None, None, None),
                                          (99, "3", DT(2024, 1, 1), D("50.0000"), None, None),
                                          (20, "0", DT(2024, 1, 1), D("10.0000"), None, None)]:
        _ins(ins, "FCPORANE", TAB=tab, PORTE=porte, DATA_PORTE=data, VALOR=val, QTDE=qt, PMEDICO=pm)
    # itens: dois do orçamento Um/1; um do Um/2 (pai recusado); um de orçamento inexistente
    for nome, ex, val, ato in [("Interessado Exemplo Um", "HEM", D("10.00"), 1),
                               ("Interessado Exemplo Um", "GLI", D("20.00"), 1),
                               ("Interessado Exemplo Um", "HEM", D("30.00"), 2),
                               ("Interessado Exemplo Nove", "HEM", D("5.00"), 1)]:
        _ins(ins, "SIEXAORC", NOME=nome, EXAME=ex, VALOR=val, ATO=ato, DATA=DT(2025, 6, 1))
    return esperado()


def esperado():
    """Esperado no destino com todo pai antes do filho (a única ordem em que a carga é correta). Com o pai depois
    (dependência pedida e não aplicada), a conciliação diverge nas tabelas de `dependencias_fora_de_ordem()`."""
    e = {
        "RPRENDISENTO": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1}},
        "RPTIPOPRESTADOR": {"gravados": 3, "pendencias": {"valor_presumido": 12, "codigo_colisao_caixa": 2}},
        "TBCLASSI": {"gravados": 6, "pendencias": {"valor_fora_do_dominio": 2, "restricao_destino_1048": 1}},
        "RPEMPCALCIMP": {"gravados": 1, "pendencias": {"vigencia_sem_fonte": 2, "restricao_destino_1062": 1}},
        "RPEVENTO": {"gravados": 2, "pendencias": {"valor_fora_do_dominio": 3, "restricao_destino_1048": 1,
                                                   "restricao_destino_4025": 1}},
        "RPPARUSUEMP": {"gravados": 1, "pendencias": {"valor_fora_do_dominio": 1, "pai_inexistente": 1,
                                                      "restricao_destino_1048": 2}},
        "RPRPA": {"gravados": 1, "pendencias": {"valor_presumido": 4, "valor_fora_do_dominio": 2, "pai_inexistente": 1,
                                                "restricao_destino_1048": 1, "restricao_destino_4025": 1,
                                                "restricao_destino_1062": 1}},
        "SIORCAME": {"gravados": 2, "pendencias": {"codigo_derivado": 4, "valor_fora_do_dominio": 1, "pai_inexistente": 1,
                                                   "restricao_destino_1062": 1, "restricao_destino_1048": 1}},
    }
    e["RPINTEVE"] = {"gravados": 1, "pendencias": {"vigencia_sem_fonte": 3, "pai_inexistente": 1,
                                                   "restricao_destino_1048": 1, "restricao_destino_4025": 1}}
    e["SIEXAORC"] = {"gravados": 2, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                   "restricao_destino_1048": 1}}
    # cooperativa: só o esperado correto (CNPJ em DOUBLE lido como número inteiro; nacional sem CNPJ recusada pelo
    # CHECK da pessoa jurídica). Falha até os pedidos de sentinela._digitos e do CHECK serem aplicados (de propósito).
    # Medido numa cópia descartável com os dois pedidos aplicados: gravadas 1, 2 e 4; a 2 adota a pessoa já cadastrada
    # (adotado_existente); a 5 usa a pessoa que a 1 criou na mesma execução e a cooperativa repetida recusa (1062)
    e["TBCOOPER"] = {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 2, "catalogo_codigo_inexistente": 2,
                                                   "adotado_existente": 1, "restricao_destino_1062": 1,
                                                   "restricao_destino_1048": 1, "restricao_destino_4025": 1}}
    e["TBINDPRO"] = {"gravados": 2, "pendencias": {"valor_fora_do_dominio": 1, "pai_inexistente": 1,
                                                   "pai_ambiguo": 1, "restricao_destino_1048": 3}}
    e["FCPORANE"] = {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 2}}
    # r4: sem item (exame inexistente ou sem procedimento) o CHECK do alvo (item ou grupo) recusa (4025)
    # r4 (revisão): tipo de conta fora do domínio recusa a linha (exige_dominio): nunca vira 'todos'
    e["SIREFCON"] = {"gravados": 2, "pendencias": {"escolha_pelo_menor": 1, "pai_inexistente": 2,
                                                   "restricao_destino_4025": 2, "valor_fora_do_dominio": 1,
                                                   "vigencia_sem_fonte": 4}}
    return e
