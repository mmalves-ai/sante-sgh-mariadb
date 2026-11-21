"""Fatia L8-08 (faturamento e restantes, módulo SUS): tabelas da origem com a forma do dicionário e dados 100% falsos.

Carregáveis: 12 listas fechadas do SUS para dominio_sus (separadas pela lista literal; código = código do leiaute
em texto, ou o id quando a origem não tem código do leiaute; código do leiaute também em codigo_oficial) e a UTI
habilitada (FHLEITOUTI -> leito_uti_habilitado). Tipo de prestador (TBPRESUS, lista tipo_prestador) e nível (TBNIVSUS e a
versão antiga sem id TBNIVEL, lista nivel_atencao) são listas do gestor fora da tabela unificada: carregam com
`adotar:lista,codigo` (a versão que vier depois adota o código que a outra já gravou; o que só uma tem é criado).
Anomalias: nome vazio ou nulo (descricao NOT NULL: recusa só a linha,
restricao_destino_1048), espaços repetidos no nome (colapsados), o mesmo código do leiaute em dois ids (duplicidade: o
segundo vira pendência restricao_destino_1062), o mesmo código em duas competências da fonte orçamentária (duas
versões, código = id da origem); a lista
'localizacao_tumor' (TBLOCPRI) ainda fora do CHECK do destino (toda linha recusada com restricao_destino_4025 até a
migração pedida; LOCALIZACAO_NO_CHECK lido do DDL); UTI com zero leito (CHECK, 4025), com tipo inexistente
(pai_inexistente e NOT NULL, 1048), duas unidades com o mesmo tipo (unidade nula: habilitação do estabelecimento) e
vigência sem fonte (vigencia_sem_fonte).
FCCTRLANCIHA -> equivalencia_sigtap_item (instrumento ciha): item faturável copiado da linha que o lançamento
(FCLANEXT, pai externo) gravou em conta_hospitalar_item (`ref:FCLANEXT@item_faturavel_id`), procedimento pelo código
da TBPROSUS (INTEGER na origem; encadeada + de-para sigtap); UMA equivalência vigente por item e instrumento: o
segundo lançamento do item ADOTA a já gravada, com o mesmo procedimento ou com outro (item ambíguo: adotado_existente; a
conferência prova a unicidade pela contagem de adotadas); item ainda sem equivalência com código fora do catálogo,
procedimento sem código, procedimento inexistente na origem ou lançamento inexistente: recusa (NOT NULL).
NÃO CARREGADAS (forma e 2 linhas falsas): descartes de produto em sem_carga.tsv
(FIPARAM, FAPARAM, FAPARAMA: mecanismo_do_produto; TBLOCSUS: catalogo_oficial). TBPRESSE (versão antiga da lista de
tipo de prestador) carrega na mesma lista por mescla não destrutiva (ADR 0006 e 0007, 20).
"""
import datetime
import decimal
from pathlib import Path

FORMAS = {
    'FHLEITOUTI': ('', [
        ('ID', 'INTEGER', True), ('ID_FHLEITOUTITP', 'SMALLINT', True), ('QTDE_LEITO', 'SMALLINT', True),
        ('ID_TBUNIDAD', 'SMALLINT', True),
    ]),
    'FIPARAM': ('', [
        ('EMPRESA', 'VARCHAR(50)', False), ('ENDERECO', 'VARCHAR(40)', False), ('FONE', 'VARCHAR(15)', False),
        ('ENDENT', 'VARCHAR(30)', False), ('BAIENT', 'VARCHAR(30)', False), ('VERDAT', 'VARCHAR(5)', False),
        ('AIHSEL', 'VARCHAR(1)', False), ('DIGDES', 'VARCHAR(1)', False), ('DIGDRS', 'VARCHAR(1)', False),
        ('DIGCOP', 'VARCHAR(1)', False), ('DIGVIS', 'VARCHAR(1)', False), ('ORGLOV', 'VARCHAR(1)', False),
        ('CEPENT', 'VARCHAR(8)', False), ('CIDENT', 'VARCHAR(25)', False), ('UFENT', 'VARCHAR(2)', False),
        ('MESPRO', 'SMALLINT', False), ('ANOPRO', 'SMALLINT', False), ('NUMRAA', 'VARCHAR(7)', False),
        ('SOMSADT', 'VARCHAR(1)', False), ('VERLEI', 'VARCHAR(1)', False), ('SOMPROF', 'VARCHAR(1)', False),
        ('TESPRON', 'VARCHAR(1)', False), ('COBMOD', 'VARCHAR(1)', False), ('COBACO', 'VARCHAR(1)', False),
        ('HOSP', 'SMALLINT', False), ('IMP_CAR', 'VARCHAR(1)', False), ('AIHVAL', 'DOUBLE PRECISION', False),
        ('DATENT', 'DATE', False), ('AIH_BOL', 'VARCHAR(1)', False), ('CPL_LAUDO', 'VARCHAR(1)', False),
        ('EMAIL', 'VARCHAR(40)', False), ('EMAIL_SERV', 'VARCHAR(40)', False), ('EMAIL_USER', 'VARCHAR(40)', False),
        ('LAUDO_ALT', 'SMALLINT', False), ('COB_DIA_IDO', 'INTEGER', False), ('COB_SIFILIS', 'CHAR(1)', False),
        ('ULT_COMP_PROC', 'INTEGER', False), ('CRED_HAB_UNIDADE', 'CHAR(1)', False),
        ('CONS_UNI_CLASS', 'CHAR(1)', False), ('CONS_AIH_ANO', 'CHAR(1)', False), ('PROF2VINC', 'CHAR(1)', False),
        ('CNS_AUTORIZACOES', 'VARCHAR(15)', False), ('EXP_DADOS_PAC_MOD_AUTORIZ_MS', 'CHAR(1)', False),
        ('DIGITAR_CDC_PROCEDIMENTO', 'SMALLINT', False), ('HOSP_FILAN_PARC_PROG_REST_CONT', 'CHAR(1)', False),
        ('DIGITAR_REMESSA', 'SMALLINT', False), ('VALIDAR_NUM_SAME_REPETIDO', 'CHAR(1)', False),
        ('DIGITAR_REPASSE_LANCAMENTO', 'CHAR(1)', False), ('CARREGAR_DOC_MED_RESP_MED_SOL', 'CHAR(1)', False),
        ('ID_TBIRREGCTRCTA', 'SMALLINT', True), ('DIGITAR_UNIDADE_LANCAMENTO', 'CHAR(1)', False),
        ('CONS_LANC_HEMOTERAPIA', 'CHAR(1)', True), ('UTILIZAR_CAD_INTEG_CONTAS', 'CHAR(1)', False),
        ('TABELA_SUS_PAULISTA', 'VARCHAR(1)', False),
    ]),
    'TBALTSUS': ('ID', [
        ('ID', 'INTEGER', True), ('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(40)', False),
    ]),
    'TBASSOCI': ('COD', [
        ('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(50)', False),
    ]),
    'TBCARATERATEND': ('ID', [
        ('ID', 'SMALLINT', True), ('COD_CARATERATEND', 'SMALLINT', True), ('NOME', 'VARCHAR(80)', False),
        ('ID_DIGITAL', 'VARCHAR(36)', False),
    ]),
    'TBDRS': ('COD', [
        ('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(52)', False),
    ]),
    'TBFONTE_ORCAMENTARIA_SUS': ('ID', [
        ('ID', 'INTEGER', True), ('ANO_MES_COMPETENCIA', 'INTEGER', False), ('CODIGO', 'INTEGER', True),
        ('NOME', 'VARCHAR(70)', False),
    ]),
    'TBGRUATE': ('COD', [
        ('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(40)', False),
    ]),
    'TBLOCPRI': ('COD', [
        ('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(60)', False), ('QTDE', 'SMALLINT', False),
    ]),
    'TBLOCSUS': ('ID', [
        ('ID', 'INTEGER', True), ('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(50)', False),
    ]),
    'TBNIVEL': ('COD', [
        ('COD', 'SMALLINT', True), ('NOME', 'BLOB SUB_TYPE 0', False),
    ]),
    'TBNIVSUS': ('ID', [
        ('ID', 'INTEGER', True), ('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(50)', False),
    ]),
    'TBPRESSE': ('COD', [
        ('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(60)', False),
    ]),
    'TBPRESUS': ('ID', [
        ('ID', 'INTEGER', True), ('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(50)', False),
    ]),
    'TBTIPATE': ('COD', [
        ('COD', 'SMALLINT', True), ('NOME', 'VARCHAR(40)', False),
    ]),
    'TBTPAPAC': ('ID', [
        ('ID', 'SMALLINT', True), ('NOME', 'VARCHAR(30)', True),
    ]),
    'FAPARAM': ('', [
        ('MEM', 'SMALLINT', False), ('DIG_DOCUM', 'VARCHAR(1)', False), ('DIG_NASC', 'VARCHAR(1)', False),
        ('DIG_IDADE', 'VARCHAR(1)', False), ('DIG_SEXO', 'VARCHAR(1)', False), ('DIG_ACIDTRA', 'VARCHAR(1)', False),
        ('DIG_ENCAMINHA', 'VARCHAR(1)', False), ('DIG_HORA', 'VARCHAR(1)', False),
        ('DIG_ENDERECO', 'VARCHAR(1)', False), ('DIG_BAIRRO', 'VARCHAR(1)', False),
        ('DIG_MUNICIPIO', 'VARCHAR(1)', False), ('DIG_CEP', 'VARCHAR(1)', False), ('DIG_UF', 'VARCHAR(1)', False),
        ('DIG_FONECONT', 'VARCHAR(1)', False), ('FONE', 'VARCHAR(13)', False), ('DIG_CID', 'VARCHAR(1)', False),
        ('DIG_COMPL', 'VARCHAR(1)', False), ('SOMA_PROF', 'VARCHAR(1)', False), ('SOMA_SADT', 'VARCHAR(1)', False),
        ('SOMA_MATM', 'VARCHAR(1)', False), ('DIG_ANEST', 'VARCHAR(1)', False), ('GER_CTA', 'VARCHAR(1)', False),
        ('DIG_CIDADE', 'VARCHAR(1)', False), ('DIG_NOME', 'VARCHAR(1)', False), ('DIG_CRM', 'VARCHAR(1)', False),
        ('DIG_PROC', 'VARCHAR(1)', False), ('COT_UNI', 'VARCHAR(1)', False), ('DIG_DRS', 'VARCHAR(1)', False),
        ('DIG_DATA', 'VARCHAR(1)', False), ('DIG_PEDIDO', 'VARCHAR(1)', False), ('DIG_COBRAR', 'VARCHAR(1)', False),
        ('MESPRO', 'SMALLINT', False), ('ANOPRO', 'SMALLINT', False), ('PERINI', 'TIMESTAMP', False),
        ('PERFIN', 'TIMESTAMP', False), ('DIG_CRMAUX', 'VARCHAR(1)', False), ('DIG_CDC', 'VARCHAR(1)', False),
        ('PRESTADOR', 'SMALLINT', False), ('COT_MED', 'VARCHAR(1)', False), ('CDC_LAN', 'VARCHAR(1)', False),
        ('COT_GRUPO', 'VARCHAR(1)', False), ('NIVEL_H', 'SMALLINT', False), ('COD_SER', 'SMALLINT', False),
        ('CLA_SER', 'SMALLINT', False), ('OBRIG_CRM', 'VARCHAR(1)', False), ('OBRIG_ANEST', 'VARCHAR(1)', False),
        ('OBRIG_CRMX', 'VARCHAR(1)', False), ('VERSAO', 'VARCHAR(10)', False), ('DIG_DTEXA', 'CHAR(1)', False),
        ('COT_APAC', 'CHAR(1)', False), ('DIG_CPF', 'CHAR(1)', False), ('DIG_IBGE', 'CHAR(1)', False),
        ('DIG_MAE', 'CHAR(1)', False), ('DIG_UFNASC', 'CHAR(1)', False), ('DIG_REM', 'CHAR(1)', False),
        ('DIG_PRONT', 'CHAR(1)', False), ('DIG_PRONTA', 'CHAR(1)', False), ('LIMPAR_CAMPOS', 'CHAR(1)', False),
        ('EMAIL', 'VARCHAR(40)', False), ('EMAIL_SERV', 'VARCHAR(40)', False), ('EMAIL_USER', 'VARCHAR(40)', False),
        ('DIR_UNI', 'CHAR(1)', False), ('NOME_ORGAO', 'VARCHAR(30)', False), ('SOMA_QTDE', 'VARCHAR(1)', False),
        ('FECHAR_FAT', 'VARCHAR(1)', False), ('NIVEL_UNID', 'VARCHAR(1)', False),
        ('FECHAR_CTA', 'VARCHAR(1)', False), ('SUDS_COD', 'VARCHAR(13)', False), ('SUDS_NOME', 'VARCHAR(30)', False),
        ('SUDS_END', 'VARCHAR(40)', False), ('SUDS_RESP', 'VARCHAR(30)', False),
        ('APRESENTADA', 'VARCHAR(1)', False), ('DIG_DATADIG', 'VARCHAR(1)', False),
        ('OBRIG_CID', 'VARCHAR(1)', False), ('CONS_UNI_CLASS', 'VARCHAR(1)', False),
        ('AUTORIZADOR', 'INTEGER', False), ('GRUPO', 'INTEGER', False), ('SUBGRUPO', 'INTEGER', False),
        ('ITEM', 'INTEGER', False), ('INTEG_FIN', 'VARCHAR(1)', False), ('VERSAO_BANCO', 'VARCHAR(7)', False),
        ('BLOQ_MANUT', 'VARCHAR(1)', False), ('TETO_UNI', 'VARCHAR(1)', False),
        ('COBRAR_APOS_GRAV', 'VARCHAR(1)', False), ('INTEG_CONT', 'VARCHAR(1)', False),
        ('ULT_COMP_PROC', 'INTEGER', False), ('CRED_HAB_UNIDADE', 'CHAR(1)', False),
        ('CLASS_SERV_UNIDADE', 'CHAR(1)', False), ('DIGITACAO_OBRIG_CDC_LANC', 'CHAR(1)', False),
        ('DIGITACAO_OBRIGATORIA_REMESSA', 'CHAR(1)', False), ('EXP_DADOS_PAC_MOD_AUTORIZ_MS', 'CHAR(1)', False),
        ('DIGITAR_UNIDADE_CONTA', 'SMALLINT', False), ('DIGITAR_UNID_LANCAMENTO', 'SMALLINT', False),
        ('DIGITAR_REPASSE_LANCAMENTO', 'CHAR(1)', False), ('DIGITAR_CNS', 'SMALLINT', False),
        ('DIGITAR_NUM_AUTORIZ_EXAME_LANC', 'SMALLINT', False), ('ID_TBIRREGCTRCTA', 'SMALLINT', True),
        ('GERAR_SEQUENCIA_AUTO_LANCTO', 'CHAR(1)', False), ('DIGITAR_UNIDADE_PROF_LANC', 'CHAR(1)', True),
    ]),
    'FAPARAMA': ('', [
        ('ANOPRO', 'SMALLINT', False), ('MESPRO', 'SMALLINT', False), ('PERINI', 'TIMESTAMP', False),
        ('PERFIN', 'TIMESTAMP', False), ('SOMA_PROF', 'VARCHAR(1)', False), ('SOMA_SADT', 'VARCHAR(1)', False),
        ('SOMA_MATM', 'VARCHAR(1)', False), ('ULT_COMP_PROC', 'INTEGER', False), ('MEM', 'SMALLINT', False),
        ('GER_CTA', 'VARCHAR(1)', False), ('COT_MED', 'VARCHAR(1)', False), ('COT_UNI', 'VARCHAR(1)', False),
        ('COT_GRUPO', 'VARCHAR(1)', False), ('COT_APAC', 'VARCHAR(1)', False), ('EMAIL', 'VARCHAR(40)', False),
        ('EMAIL_SERV', 'VARCHAR(40)', False), ('EMAIL_USER', 'VARCHAR(40)', False), ('DIG_CDC', 'VARCHAR(1)', False),
        ('DIG_PROCED', 'VARCHAR(1)', False), ('DIG_DRS', 'VARCHAR(1)', False), ('DIG_UNIDADE', 'VARCHAR(1)', False),
        ('DIG_DOCTO', 'VARCHAR(1)', False), ('DIG_PRONTA', 'VARCHAR(1)', False), ('DIG_HORA', 'VARCHAR(1)', False),
        ('DIG_FONECONT', 'VARCHAR(1)', False), ('DIG_CNS', 'VARCHAR(1)', False), ('DIG_REM', 'VARCHAR(1)', False),
        ('PRESTADOR', 'SMALLINT', False), ('NIVEL_H', 'SMALLINT', False), ('NIVEL_UNID', 'VARCHAR(1)', False),
        ('VERSAO', 'VARCHAR(15)', False), ('VERSAO_BANCO', 'VARCHAR(7)', False),
        ('NOME_ORGAO', 'VARCHAR(30)', False), ('COD_SER', 'SMALLINT', False), ('CLA_SER', 'SMALLINT', False),
        ('DIR_UNI', 'VARCHAR(1)', False), ('FECHAR_CTA', 'VARCHAR(1)', False), ('APRESENTADA', 'VARCHAR(1)', False),
        ('INTEG_FIN', 'VARCHAR(1)', False), ('INTEG_CONT', 'VARCHAR(1)', False), ('LAUDO_RED', 'VARCHAR(1)', False),
        ('TELA_AUTORIZ', 'VARCHAR(1)', False), ('AUTORIZADOR', 'INTEGER', False), ('GRUPO', 'INTEGER', False),
        ('SUBGRUPO', 'INTEGER', False), ('ITEM', 'INTEGER', False), ('SOMA_QTDE', 'VARCHAR(1)', False),
        ('CONS_UNI_CLASS', 'VARCHAR(1)', False), ('BLOQ_MANUT', 'VARCHAR(1)', False),
        ('TETO_UNI', 'VARCHAR(1)', False), ('FAT_UNIDADE', 'VARCHAR(1)', False),
        ('CRED_HAB_UNIDADE', 'CHAR(1)', False), ('CLASS_SERV_UNIDADE', 'CHAR(1)', False),
        ('DIGITAR_REMESSA', 'SMALLINT', False), ('EXP_DADOS_PAC_MOD_AUTORIZ_MS', 'CHAR(1)', False),
        ('CONSISTIR_NUM_APAC_ANO', 'CHAR(1)', False), ('DIGITAR_REPASSE_LANCAMENTO', 'CHAR(1)', False),
        ('ID_TBIRREGCTRCTA', 'SMALLINT', True), ('CONVERTE_AMB_APAC_CADASTRO', 'CHAR(1)', False),
        ('DIGITAR_UNIDADE_PROF_LANC', 'CHAR(1)', True),
    ]),
    'FCCTRLANCIHA': ('ID_FCLANEXT', [
        ('ID_FCLANEXT', 'INTEGER', True), ('ID_TBPROSUS', 'INTEGER', True),
    ]),
}

CARREGADAS = ("TBALTSUS", "TBASSOCI", "TBCARATERATEND", "TBDRS", "TBFONTE_ORCAMENTARIA_SUS", "TBGRUATE", "TBTIPATE",
              "TBTPAPAC", "TBLOCPRI", "TBNIVSUS", "TBNIVEL", "TBPRESUS", "TBPRESSE", "FHLEITOUTI", "FCCTRLANCIHA",
              # r5 (ADR 0006): opções e competência aberta do faturamento SUS -> parametro_valor JSON do estabelecimento
              "FIPARAM", "FAPARAM", "FAPARAMA")
DESCARTADAS = {"TBLOCSUS": "catalogo_oficial"}
SEM_MECANISMO = ()
BLOQUEADAS = tuple(DESCARTADAS) + SEM_MECANISMO  # não carregadas (nenhuma coluna com destino)


def _lista_no_check(lista):
    """A lista está no CHECK de dominio_sus do DDL (db/migracoes, montado no container)? Lido, não fixado: quando a
    migração pedida em saida/L8-08.json chegar, o esperado de TBLOCPRI passa a gravar sem mudar a fatia."""
    raiz = Path(__file__).resolve().parents[2] / "db" / "migracoes"
    try:
        return any("'%s'" % lista in a.read_text(encoding="utf-8") and "ck_dominio_sus_lista" in a.read_text(encoding="utf-8")
                   for a in raiz.rglob("*.sql"))
    except OSError:
        return False


LOCALIZACAO_NO_CHECK = _lista_no_check("localizacao_tumor")
COLUNAS = {t: cols for t, (_, cols) in FORMAS.items()}


def _ddl():
    saida = []
    for t, (chave, cols) in FORMAS.items():
        defs = ["%s %s%s" % (c, tp, " NOT NULL" if nn else "") for c, tp, nn in cols]
        if chave:
            defs.append("PRIMARY KEY (%s)" % chave)
        saida.append("CREATE TABLE %s (%s);" % (t, ", ".join(defs)))
    # procedimento da tabela unificada na origem (catálogo oficial, nunca gravado): só o código, lido pela encadeada
    # o código é INTEGER na origem (conferido no dicionário da imagem de referência): os zeros à esquerda somem
    saida.append("CREATE TABLE TBPROSUS (ID INTEGER NOT NULL, COD INTEGER, PRIMARY KEY (ID));")
    return "\n".join(saida) + "\n"


DDL = _ddl()
# tipo de UTI (FHLEITOUTITP, L8-07) já carregado; um estabelecimento único no destino (@estabelecimento)
# lançamentos da conta (FCLANEXT, L8-06) já carregados: os pais externos recebem os ids 1 a 6 em
# conta_hospitalar_item, na ordem da lista (FCLANEXT antes de FHLEITOUTITP, que fica com 8 e 9), com o item faturável
# 880801, 880802 ou 880803; 9105 não é lançamento carregado; dois procedimentos no catálogo oficial carregado
PAIS_EXTERNOS = {"FCLANEXT": ["9101", "9102", "9103", "9104", "9106", "9107", "9108"], "FHLEITOUTITP": ["1", "2"]}
ITENS_DOS_LANCAMENTOS = {"9101": 880801, "9102": 880801, "9103": 880802, "9104": 880803, "9106": 880803,
                         "9107": 880803, "9108": 880801}
SIGTAP_NO_CATALOGO = ("0301010072", "0202010503")
PREPARO_DESTINO = (
    "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
    " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);\n"
    # o banco da conferência só cria os destinos do plano (sem FK): a linha do lançamento que o pai gravou vem aqui,
    # com as colunas que o modelo exige (CREATE só se a tabela não existir, ex.: conferência isolada da fatia)
    "CREATE TABLE IF NOT EXISTS conta_hospitalar_item (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
    " conta_hospitalar_id BIGINT UNSIGNED NOT NULL, sequencia INT UNSIGNED NOT NULL,"
    " item_faturavel_id BIGINT UNSIGNED NOT NULL, realizado_em DATETIME(3) NOT NULL, quantidade DECIMAL(15,4) NOT NULL,"
    " valor_unitario DECIMAL(15,4) NOT NULL, valor_total DECIMAL(15,2) NOT NULL,"
    " origem VARCHAR(20) NOT NULL DEFAULT 'sistema', criado_em DATETIME(3) NOT NULL);\n"
    "SET FOREIGN_KEY_CHECKS=0;\n"
    "INSERT INTO conta_hospitalar_item (id, conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,"
    " valor_unitario, valor_total, origem, criado_em) VALUES"
    " (1, 1, 1, 880801, '2025-01-02 08:00', 1, 10, 10, 'migracao', UTC_TIMESTAMP(3)),"
    " (2, 1, 2, 880801, '2025-01-02 09:00', 1, 10, 10, 'migracao', UTC_TIMESTAMP(3)),"
    " (3, 1, 3, 880802, '2025-01-02 10:00', 1, 10, 10, 'migracao', UTC_TIMESTAMP(3)),"
    " (4, 1, 4, 880803, '2025-01-02 11:00', 1, 10, 10, 'migracao', UTC_TIMESTAMP(3)),"
    " (5, 1, 5, 880803, '2025-01-02 12:00', 1, 10, 10, 'migracao', UTC_TIMESTAMP(3)),"
    " (6, 1, 6, 880803, '2025-01-02 13:00', 1, 10, 10, 'migracao', UTC_TIMESTAMP(3)),"
    " (7, 1, 7, 880801, '2025-01-02 14:00', 1, 10, 10, 'migracao', UTC_TIMESTAMP(3));\n"
    "INSERT INTO procedimento_sigtap (codigo_sigtap, descricao, grupo_sigtap_id, vigencia_inicio, versao_fonte,"
    " criado_em) VALUES ('0301010072', 'Procedimento sigtap exemplo um', 1, '2020-01-01', 'exemplo', UTC_TIMESTAMP(3)),"
    " ('0202010503', 'Procedimento sigtap exemplo dois', 1, '2020-01-01', 'exemplo', UTC_TIMESTAMP(3));\n"
    # r5 (ADR 0006, 4): lista oficial de modalidade com os códigos da origem (TBLOCSUS 1 e 2): prova de conciliação
    "CREATE TABLE IF NOT EXISTS dominio_sigtap (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, lista VARCHAR(30) NOT NULL,"
    " codigo_sigtap VARCHAR(10) NOT NULL, descricao VARCHAR(250) NOT NULL, vigencia_inicio DATE NOT NULL,"
    " vigencia_fim DATE NULL, versao_fonte VARCHAR(30) NOT NULL, criado_em DATETIME(3) NOT NULL);\n"
    "INSERT INTO dominio_sigtap (lista, codigo_sigtap, descricao, vigencia_inicio, versao_fonte, criado_em)"
    " SELECT 'modalidade', c, CONCAT('Modalidade exemplo ', c), '2020-01-01', 'exemplo', UTC_TIMESTAMP(3) FROM"
    " (SELECT '01' AS c UNION ALL SELECT '02') x WHERE NOT EXISTS (SELECT 1 FROM dominio_sigtap d"
    " WHERE d.lista = 'modalidade' AND d.codigo_sigtap = x.c);\n"
    "SET FOREIGN_KEY_CHECKS=1")


def _falso(tipo, i):
    """Valor falso pela forma da coluna (tabelas só com a forma)."""
    if tipo.startswith(("SMALLINT", "INTEGER", "BIGINT")):
        return i
    if tipo.startswith(("VARCHAR", "CHAR")):
        n = int(tipo.split("(")[1].rstrip(")"))
        return "S" if n == 1 else (str(i) + " exemplo")[:n]
    if tipo.startswith("DOUBLE"):
        return 1.5
    if tipo == "DATE":
        return datetime.date(2025, 1, i)
    if tipo == "TIMESTAMP":
        return datetime.datetime(2025, 1, i, 8, 30)
    return ("texto exemplo " + str(i)).encode("cp1252")


def _ins(ins, tab, **v):
    ins(tab, [v.get(c) for c, _, _ in COLUNAS[tab]])


R1048 = "restricao_destino_1048"
R1062 = "restricao_destino_1062"
R4025 = "restricao_destino_4025"


def linhas(r, ins):
    for tab in BLOQUEADAS:
        for i in (1, 2):
            ins(tab, [_falso(tp, i) for _, tp, _ in COLUNAS[tab]])
    # motivo de saída: 4 sem nome (1048); 2 e 5 com o mesmo código do leiaute (o 5 vira duplicidade 1062)
    ok = lambda n: {"gravados": n, "pendencias": {}}
    for i, cod, nome in [(1, 11, "Alta curado"), (2, 12, "Alta   melhorado "), (3, 14, "Alta a pedido"),
                         (4, 15, None), (5, 12, "Alta melhorado bis")]:
        _ins(ins, "TBALTSUS", ID=i, COD=cod, NOME=nome)
    for cod, nome in [(1, "Associação exemplo um"), (2, "Associação exemplo dois")]:
        _ins(ins, "TBASSOCI", COD=cod, NOME=nome)
    # caráter: 3 com nome só de espaços (vira NULL: 1048)
    for i, cod, nome in [(1, 1, "Eletivo"), (2, 2, "Urgência  exemplo"), (3, 3, "   ")]:
        _ins(ins, "TBCARATERATEND", ID=i, COD_CARATERATEND=cod, NOME=nome, ID_DIGITAL="00000000-exemplo-%d" % i)
    for cod, nome in [(1, "Regional exemplo um"), (2, "Regional exemplo dois")]:
        _ins(ins, "TBDRS", COD=cod, NOME=nome)
    # fonte orçamentária: o mesmo código do leiaute em duas competências são duas versões (código = id da origem,
    # codigo_oficial repetido, vigências distintas: nenhuma recusada); competência AAAAMM vira vigencia_inicio; o id 4
    # tem mês 13 (NULL com valor_fora_do_dominio, linha gravada)
    for i, comp, cod, nome in [(1, 202501, 100, "Fonte exemplo"), (2, 202601, 100, "Fonte exemplo nova"),
                               (3, None, 200, "Fonte exemplo dois"), (4, 202513, 300, "Fonte exemplo três")]:
        _ins(ins, "TBFONTE_ORCAMENTARIA_SUS", ID=i, ANO_MES_COMPETENCIA=comp, CODIGO=cod, NOME=nome)
    for cod, nome in [(1, "Grupo exemplo um"), (2, "Grupo exemplo dois"), (3, "Grupo exemplo três")]:
        _ins(ins, "TBGRUATE", COD=cod, NOME=nome)
    for cod, nome in [(1, "Tipo exemplo um"), (2, "Tipo exemplo dois")]:
        _ins(ins, "TBTIPATE", COD=cod, NOME=nome)
    for i, nome in [(1, "Inicial exemplo"), (2, "Continuidade exemplo"), (3, "  ")]:
        _ins(ins, "TBTPAPAC", ID=i, NOME=nome)
    # localização do tumor: 3 sem nome (1048, antes do CHECK); 1 e 2 recusadas pelo CHECK da lista até a migração
    for cod, nome, qtde in [(1, "Localização exemplo um", 5), (2, "Localização   exemplo dois", 0), (3, None, 1)]:
        _ins(ins, "TBLOCPRI", COD=cod, NOME=nome, QTDE=qtde)
    loc = {"gravados": 2, "pendencias": {R1048: 1}} if LOCALIZACAO_NO_CHECK else \
        {"gravados": 0, "pendencias": {R4025: 2, R1048: 1}}
    # UTI habilitada: 1, 2 e 3 gravadas (1 e 3 do mesmo tipo em unidades diferentes: unidade nula, sem duplicidade);
    # 4 com zero leito (CHECK: 4025); 5 com tipo inexistente (pai_inexistente; tipo NOT NULL: 1048); a vigência sem
    # fonte fica em toda linha lida, também nas recusadas
    for i, tp, qt, un in [(1, 1, 10, 1), (2, 2, 4, 1), (3, 1, 6, 2), (4, 1, 0, 1), (5, 9, 3, 1)]:
        _ins(ins, "FHLEITOUTI", ID=i, ID_FHLEITOUTITP=tp, QTDE_LEITO=qt, ID_TBUNIDAD=un)
    # equivalência CIHA (uma vigente por item e instrumento): 9101 grava (880801 x A); 9102 tem o mesmo par (adotado);
    # 9103 grava (880802 x B); 9108 informou OUTRO procedimento (B) para o item 880801: adota a equivalência já gravada
    # (se gravasse, o item ficaria com duas vigentes e a contagem de adotadas cairia para 1); o item 880803 nunca tem
    # equivalência válida: 9104 código fora do catálogo (catalogo_codigo_inexistente), 9106 procedimento inexistente na
    # origem (pai_inexistente), 9107 procedimento sem código: recusa pelo NOT NULL (1048); 9105 lançamento inexistente
    # (pai_inexistente, 1048). Código INTEGER como na origem (zeros à esquerda completados pelo de-para)
    for i, cod in [(1, 301010072), (2, 202010503), (3, 399999999), (4, None)]:
        ins("TBPROSUS", [i, cod])
    for lan, pro in [(9101, 1), (9102, 1), (9103, 2), (9104, 3), (9105, 1), (9106, 77), (9107, 4), (9108, 2)]:
        _ins(ins, "FCCTRLANCIHA", ID_FCLANEXT=lan, ID_TBPROSUS=pro)
    ciha = {"gravados": 4, "pendencias": {"vigencia_sem_fonte": 8, "adotado_existente": 2, "catalogo_codigo_inexistente": 1,
                                          "pai_inexistente": 2, R1048: 4,
                                          "mescla_conflito_origem_guardada": 1}}
    # tipo de prestador: 3 sem nome (1048). A versão antiga TBPRESSE (ordem anterior no mapa) carrega na mesma lista:
    # cria 1, 2 e o 7 (só dela); o 5 sem nome recusa (1048). TBPRESUS ADOTA 1 e 2 (adotado_existente; a descrição
    # diferente do 2 fica no histórico da mescla) e cria o 3
    for i, cod, nome in [(1, 1, "Prestador exemplo um"), (2, 2, "Prestador   exemplo dois"), (3, 3, None)]:
        _ins(ins, "TBPRESUS", ID=i, COD=cod, NOME=nome)
    for cod, nome in [(1, "Prestador exemplo um"), (2, "Prestador antigo dois"), (5, None), (7, "Prestador so antigo")]:
        _ins(ins, "TBPRESSE", COD=cod, NOME=nome)
    # nível: a versão com id (TBNIVSUS) carrega antes (dependencias.tsv: TBNIVEL depende de TBNIVSUS) e cria 1, 2 e 3
    # com a descrição dela; o 4 sem nome recusa (1048). A antiga sem id (TBNIVEL) adota 1 e 2 (adotado_existente) e
    # cria o 9, que só existe nela (por isso ela carrega)
    for cod, nome in [(1, "Nível exemplo um"), (2, "Nível exemplo dois"), (9, "Nível exemplo nove")]:
        _ins(ins, "TBNIVEL", COD=cod, NOME=nome.encode("cp1252"))
    for i, cod, nome in [(1, 1, "Nível exemplo um"), (2, 2, "Nível  exemplo dois"), (3, 3, "Nível exemplo três"),
                         (4, 4, " ")]:
        _ins(ins, "TBNIVSUS", ID=i, COD=cod, NOME=nome)
    # r5: parâmetros do faturamento SUS (linha única): FIPARAM com uma 2ª linha sem competência (vigência pela
    # evidência, vigencia_sem_fonte): outra versão; FAPARAM e FAPARAMA, uma linha cada
    _ins(ins, "FIPARAM", EMPRESA="Hospital exemplo", ANOPRO=2025, MESPRO=3, AIHSEL="S", ID_TBIRREGCTRCTA=1,
         CONS_LANC_HEMOTERAPIA="N", EMAIL_USER="usuario.exemplo")
    _ins(ins, "FIPARAM", EMPRESA="Hospital exemplo dois", ANOPRO=None, MESPRO=None, ID_TBIRREGCTRCTA=1,
         CONS_LANC_HEMOTERAPIA="S")
    _ins(ins, "FAPARAM", ID_TBIRREGCTRCTA=1, DIGITAR_UNIDADE_PROF_LANC="N", ANOPRO=2025, MESPRO=4, DIG_CID="S", PERINI=datetime.datetime(2025, 4, 1),
         PERFIN=datetime.datetime(2025, 4, 30, 23, 59))
    _ins(ins, "FAPARAMA", ID_TBIRREGCTRCTA=1, DIGITAR_UNIDADE_PROF_LANC="N", ANOPRO=2025, MESPRO=4, SOMA_PROF="S", NOME_ORGAO="Gestor  exemplo")
    # a 2ª linha do FIPARAM grava outra versão do parâmetro (vigência distinta); módulo e definição adotados
    par = {"FIPARAM": {"gravados": 2, "pendencias": {"vigencia_sem_fonte": 1, "adotado_existente": 2}},
           "FAPARAM": {"gravados": 1, "pendencias": {"adotado_existente": 1}},
           "FAPARAMA": {"gravados": 1, "pendencias": {"adotado_existente": 1}}}
    uti = {"gravados": 3, "pendencias": {"vigencia_sem_fonte": 5, R4025: 1, "pai_inexistente": 1, R1048: 1}}
    rec = lambda n: {"gravados": n, "pendencias": {R1048: 1}}
    return dict(par, **{"TBALTSUS": {"gravados": 3, "pendencias": {R1048: 1, R1062: 1}}, "TBASSOCI": ok(2),
            "TBCARATERATEND": rec(2), "TBDRS": ok(2),
            "TBFONTE_ORCAMENTARIA_SUS": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1}}, "TBGRUATE": ok(3),
            "TBTIPATE": ok(2), "TBTPAPAC": rec(2), "TBLOCPRI": loc, "FHLEITOUTI": uti, "FCCTRLANCIHA": ciha,
            "TBPRESUS": {"gravados": 2, "pendencias": {R1048: 1, "adotado_existente": 2,
                                                       "mescla_conflito_origem_guardada": 1}},
            "TBPRESSE": rec(3), "TBNIVSUS": rec(3),
            "TBNIVEL": {"gravados": 3, "pendencias": {"adotado_existente": 2}}})
