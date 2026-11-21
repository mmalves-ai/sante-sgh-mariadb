"""Fatia L8-02 (faturamento e restantes, módulo FAT; 23 tabelas): tabelas da origem com a forma do dicionário e dados
100% falsos. Rodada de cobertura total (F4).

Carregadas (10): RPRENDISENTO, RPTIPOPRESTADOR (categoria presumida), TBCLASSI (código TISS por de-para de valores),
RPEMPCALCIMP (@estabelecimento duas vezes, @vigencia_carga), RPEVENTO (natureza e crédito/débito pelo tipo do evento
V/F/D, de-para de valores com evidência; sem par recusa), RPINTEVE (evento por chave alternativa ref:RPEVENTO.COD, natureza financeira por chave
composta ref:TBITEDES(GRUPO,SUBGRUPO,ITEM)), RPPARUSUEMP (competência por #data:ANO,MES, usuário pelo login), RPRPA
(profissional pela origem ENCADEADA RPRPA_TBCBOPRO > TBCBOPRO > TBPROFIS, situação G e método E por de-para,
fato gerador AAAAMM, totais presumidos), SIORCAME (número derivado, validade = data, paciente pelo prontuário
ref:RICADPAC.PRONT) e SIEXAORC (orçamento por chave composta ref:SIORCAME(NOME,ATO), sequência #seq, nome do
exame pela origem encadeada ref:SITABPRO(ATO,EXAME)>NOME). As intermediárias das referências encadeadas (TBCBOPRO,
SITABPRO, RICADPAC) entram com TODAS as colunas do dicionário.
Pais externos (TBUSERS, RICADPAC do L3; TBPROFIS, TBCONVEN, TBITEDES) só são registrados como já carregados quando a
ORDEM DO MAPA os põe antes do filho: sem as dependências pedidas em saida/L8-02.json (RPINTEVE -> RPEVENTO e TBITEDES,
RPRPA -> TBPROFIS, SIORCAME -> TBCONVEN, SIEXAORC -> SIORCAME), a conciliação FALHA nessas tabelas, como falharia a
carga real. O esperado é um só (pai antes do filho) e exige linhas gravadas em toda tabela carregada. Descartes pedidos (RPPARAM, RPRPA_TBCBOPRO,
RPLANEVE_TBCBOPRO e as cinco listas de opções) e as que aguardam modelo ou catálogo (RPEVENTOESOC, RPLANEVE,
RPLANEVE_COMPOSICAOBASE, RPLANRPA, SIREFCON) entram só com a forma (2 linhas falsas).
"""
import csv
import datetime
import decimal
import os

FORMAS = {
    'RPEMPCALCIMP': ('ID_TBEMPHOS,ID_TBEMPHOS_CONSIDERAR_IMP', [
        ('ID_TBEMPHOS', 'SMALLINT', True), ('ID_TBEMPHOS_CONSIDERAR_IMP', 'SMALLINT', True),
    ]),
    'RPEVENTOESOC': ('ID_RPEVENTO,ID_TBEMPHOS', [
        ('ID_RPEVENTO', 'INTEGER', True), ('ID_TBEMPHOS', 'SMALLINT', True), ('ID_FPNATRUBRICA', 'SMALLINT', True),
        ('ID_FPRUBRICAINSS', 'SMALLINT', False), ('ID_FPRUBRICAIRRF', 'SMALLINT', False),
    ]),
    'RPINTEVE': ('EMPRESA,EVENTO', [
        ('EMPRESA', 'SMALLINT', True), ('EVENTO', 'SMALLINT', True), ('GRUPO', 'SMALLINT', False),
        ('SUBGRUPO', 'SMALLINT', False), ('ITEM', 'SMALLINT', False), ('HIST', 'SMALLINT', False),
    ]),
    'RPPARAM': ('EMPRESA', [
        ('EMPRESA', 'SMALLINT', True), ('OLD_ANO', 'SMALLINT', False), ('OLD_MES', 'SMALLINT', False),
        ('SERIE_RPA', 'CHAR(1)', True), ('NUMERO_RPA', 'INTEGER', True), ('HAB_RET_IRRF', 'CHAR(1)', False),
        ('HAB_RET_INSS', 'CHAR(1)', False), ('HAB_RET_ISS', 'CHAR(1)', False),
        ('IDENT_LOTES_RPA', 'CHAR(1)', False), ('INTEG_FIN', 'CHAR(1)', False), ('INTEG_CONT', 'CHAR(1)', False),
        ('DIG_DESC_PADRAO_SERV', 'CHAR(1)', False), ('DESC_PADRAO_SERV', 'VARCHAR(70)', False),
        ('IMP_BASE_LIQ_IR', 'CHAR(1)', False), ('DESC_IRRF', 'CHAR(1)', False),
        ('INCLUI_REFERENTE_CONTAB', 'CHAR(1)', False), ('IR_PJ_CUMULATIVO', 'CHAR(1)', False),
        ('PROVISIONAR_EVENTOS_PLS', 'CHAR(1)', False), ('MODELO_PADRAO_RPA', 'SMALLINT', False),
        ('CALCULAR_INSS_SALARIO_BASE', 'CHAR(1)', False), ('GERAR_RPA_PREST_SEM_PIS', 'CHAR(1)', False),
        ('ORDEM_GRAV_RPA_CONT', 'SMALLINT', False), ('ORDEM_GRAV_NOME_PREST_CONT', 'SMALLINT', False),
        ('ORDEM_GRAV_DESC_SERV_CONT', 'SMALLINT', False), ('ORDEM_GRAV_REFERENTE_CONT', 'SMALLINT', False),
        ('INTEG_FATO_GERADOR', 'CHAR(1)', False), ('IDENT_CDC', 'CHAR(1)', False),
        ('APENAS_INTEG_CUSTOS', 'CHAR(1)', False), ('FATO_GERADOR', 'INTEGER', False),
        ('INCLUIR_DADOS_BANCARIOS', 'CHAR(1)', False), ('MALA_DIRETA_MEDICO', 'VARCHAR(200)', False),
        ('MALA_DIRETA_COOPERATIVA', 'VARCHAR(200)', False), ('MALA_DIRETA_FORNECEDOR', 'VARCHAR(200)', False),
        ('MALA_DIRETA_REPRESENTANTE_SGO', 'VARCHAR(200)', False), ('HABILITA_DATA_PREVISAO', 'CHAR(1)', False),
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
    'RPLANEVE': ('ID_RPLANEVE', [
        ('ID_RPLANEVE', 'INTEGER', True), ('EMPRESA', 'SMALLINT', True), ('TIPO', 'CHAR(1)', True),
        ('COD_PRESTADOR', 'INTEGER', True), ('DATA', 'DATE', True), ('ID_RPEVENTO', 'SMALLINT', True),
        ('VALOR', 'NUMERIC(18,2)', False), ('OBS', 'VARCHAR(1024)', False), ('PERC', 'NUMERIC(9,2)', False),
        ('VEIO', 'CHAR(1)', False), ('REFERENTE', 'VARCHAR(60)', False), ('ID_FPCATEGTRAB', 'SMALLINT', False),
        ('VALOR_DIG_CALC', 'CHAR(1)', False), ('DATA_LAUDO', 'DATE', False),
        ('DESC_RENDIMENTO', 'VARCHAR(100)', False), ('ENTIDADE_PREVIDENCIA', 'VARCHAR(1)', False),
        ('ID_TBPREVIDENCIACOMPL', 'INTEGER', False), ('VALOR_PATROC_FUNP', 'NUMERIC(18,2)', False),
        ('IND_DECIMO_TERCEIRO', 'VARCHAR(1)', False), ('VLR_PERC_SCP', 'NUMERIC(4,2)', False),
        ('EMAIL_ENVIADO', 'CHAR(1)', True), ('DATA_PREVISAO', 'DATE', False),
    ]),
    'RPLANEVE_COMPOSICAOBASE': ('ID', [
        ('ID', 'BIGINT', True), ('ID_RPLANEVE', 'INTEGER', False), ('IMPOSTO', 'INTEGER', False),
        ('CONTA', 'INTEGER', False), ('PARCELA', 'INTEGER', False), ('BASE_CALCULO', 'NUMERIC(18,2)', False),
        ('ALIQUOTA', 'NUMERIC(9,2)', False), ('VALOR', 'NUMERIC(18,2)', False),
        ('FATO_GERADOR_CONTABIL', 'INTEGER', False), ('ID_FPITENSNATRENDIMENTO', 'INTEGER', False),
        ('VALOR_BRUTO', 'NUMERIC(18,2)', False), ('ID_EVENTO', 'INTEGER', False),
    ]),
    'RPLANEVE_TBCBOPRO': ('ID_RPLANEVE', [
        ('ID_RPLANEVE', 'INTEGER', True), ('ID_TBCBOPRO', 'INTEGER', True),
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
    'RPLANRPA': ('ID_RPRPA,ID_RPLANEVE', [
        ('ID_RPRPA', 'INTEGER', True), ('ID_RPLANEVE', 'INTEGER', True),
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
CARREGADAS = ("RPRENDISENTO", "RPTIPOPRESTADOR", "TBCLASSI", "RPEMPCALCIMP", "RPEVENTO", "RPINTEVE", "RPPARUSUEMP",
              "RPRPA", "SIORCAME", "SIEXAORC")
COM_DADOS = CARREGADAS + ("RPRPA_TBCBOPRO",)  # intermediária da referência encadeada do RPA (descarte pedido)
COLUNAS = {t: cols for t, (_, cols) in FORMAS.items()}

# intermediárias das referências encadeadas (de outras fatias): todas as colunas do dicionário
_TIPOS_FB = {"DOUBLE": "DOUBLE PRECISION", "BLOB": "BLOB SUB_TYPE 0"}
INTERMEDIARIAS = {"TBCBOPRO": "ID", "SITABPRO": "ATO,CODALF", "RICADPAC": "ID"}
_MAPA = os.path.join(os.path.dirname(__file__), "..", "..", "mapa")


def _dicionario():
    cols = {t: [] for t in INTERMEDIARIAS}
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
    for t, k in INTERMEDIARIAS.items():
        saida.append('CREATE TABLE %s (%s, PRIMARY KEY (%s));' % (t, ", ".join('"%s" %s' % c for c in COLS_INTER[t]), k))
    return "\n".join(saida) + "\n"


DDL = _ddl()
# pais de fora da fatia registrados como já carregados SÓ quando a ordem do mapa os põe antes de todos os filhos
_FORA = {p for _, p in dependencias_fora_de_ordem()}
PAIS_EXTERNOS = {p: ks for p, ks in _CHAVES_EXTERNAS.items() if p not in _FORA}
# único estabelecimento do cliente de exemplo (o @estabelecimento resolve por ele)
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')")


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
    if tab in INTERMEDIARIAS:
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
    for ato, cod, nome in [(1, "HEM", "Hemograma exemplo"), (1, "GLI", "Glicose exemplo"),
                           (2, "HEM", "Hemograma setor dois exemplo")]:
        _ins(ins, "SITABPRO", ATO=ato, CODALF=cod, NOME=nome)
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
    return e
