"""Fatia L8-02 (faturamento e restantes, módulo FAT; 23 tabelas): tabelas da origem com a forma do dicionário e dados
100% falsos.

Carregadas (3): RPRENDISENTO (tipo de rendimento isento), RPTIPOPRESTADOR (tipo de favorecido do repasse, categoria
PRESUMIDA) e TBCLASSI (classificação da despesa, código TISS por de-para de valores). Anomalias: descrição vazia em
coluna NOT NULL (restricao_destino_1048), nome com espaços repetidos (colapsados), código de 1 caractere que só
difere pela caixa (codigo_colisao_caixa, os dois recusados), código TISS sem par e S/N fora do domínio
(valor_fora_do_dominio, linha gravada). As outras 20 ficam fora da carga (motivo em colunas.d/L8-02.tsv e pedidos em
saida/L8-02.json) e entram só com a forma (2 linhas falsas cada).
"""
import datetime
import decimal

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
CARREGADAS = ("RPRENDISENTO", "RPTIPOPRESTADOR", "TBCLASSI")
COLUNAS = {t: cols for t, (_, cols) in FORMAS.items()}


def _ddl():
    saida = []
    for t, (chave, cols) in FORMAS.items():
        defs = ["%s %s%s" % (c, tp, " NOT NULL" if nn else "") for c, tp, nn in cols]
        if chave:
            defs.append("PRIMARY KEY (%s)" % chave)
        saida.append("CREATE TABLE %s (%s);" % (t, ", ".join(defs)))
    return "\n".join(saida) + "\n"


DDL = _ddl()
# nenhuma tabela carregada da fatia referencia pai de fora dela
PAIS_EXTERNOS = {}


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
    ins(tab, [v.get(c) for c, _, _ in COLUNAS[tab]])


def linhas(r, ins):
    for tab, cols in COLUNAS.items():
        if tab not in CARREGADAS:
            for i in (1, 2):
                ins(tab, [_falso(tp, i) for _, tp, _ in cols])
    # rendimentos isentos: 3 sem nome (descricao NOT NULL: 1048); 4 com espaços repetidos (colapsados)
    for i, nome in [(1, "Rendimento isento exemplo um"), (2, "Rendimento isento exemplo dois"), (3, None),
                    (4, "  Rendimento   isento  quatro "), (5, "Rendimento isento exemplo cinco")]:
        _ins(ins, "RPRENDISENTO", ID=i, NOME=nome)
    # tipos de favorecido: categoria presumida em todas as gravadas (valor_presumido); 'X' e 'x' só diferem pela
    # caixa (os dois recusados com codigo_colisao_caixa)
    for i, cod, desc in [(1, "A", "Tipo exemplo A"), (2, "B", "Tipo exemplo B"), (3, "X", "Tipo exemplo X"),
                         (4, "x", "Tipo exemplo x minusculo"), (5, "C", "  Tipo exemplo C  ")]:
        _ins(ins, "RPTIPOPRESTADOR", ID=i, COD=cod, DESCRICAO=desc)
    # classificações: 4 com código TISS sem par (NULL, valor_fora_do_dominio); 5 sem nome (1048); 6 com S/N fora do
    # domínio (fica com o padrão FALSE, valor_fora_do_dominio); 3 sem S/N (padrão FALSE, sem pendência)
    for cod, nome, tiss, cons in [(1, "Classe exemplo um", 1, "S"), (2, "Classe exemplo dois", 2, "N"),
                                  (3, "Classe exemplo tres", 3, None), (4, "Classe  exemplo  quatro", 4, "N"),
                                  (5, None, 5, "N"), (6, "Classe exemplo seis", 7, "X"),
                                  (7, "Classe exemplo sete", None, "S")]:
        _ins(ins, "TBCLASSI", COD=cod, NOME=nome, REF_TISS=tiss, CONSID_COD_DESP=cons)
    return {
        "RPRENDISENTO": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1}},
        "RPTIPOPRESTADOR": {"gravados": 3, "pendencias": {"valor_presumido": 3, "codigo_colisao_caixa": 2}},
        "TBCLASSI": {"gravados": 6, "pendencias": {"valor_fora_do_dominio": 2, "restricao_destino_1048": 1}},
    }
