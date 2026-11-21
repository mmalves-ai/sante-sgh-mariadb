"""Fatia L8-08 (faturamento e restantes, módulo SUS): tabelas da origem com a forma do dicionário e dados 100% falsos.

Carregáveis: 8 listas fechadas do SUS para dominio_sus (separadas pela lista literal; código = código do leiaute
em texto, ou o id quando a origem não tem código do leiaute; código do leiaute também em codigo_oficial). Anomalias:
nome vazio ou nulo (descricao NOT NULL: recusa só a linha, restricao_destino_1048), espaços repetidos no nome
(colapsados), o mesmo código do leiaute em dois ids e o mesmo código em duas competências da fonte orçamentária
(duplicidade: o segundo vira pendência restricao_destino_1062, nunca dois itens com o mesmo código).
BLOQUEADAS (forma e 2 linhas falsas, pedidos em saida/L8-08.json): TBLOCSUS, TBNIVSUS e TBPRESUS (catálogo oficial
da tabela unificada: só de-para para dominio_sigtap, nunca lista própria), TBLOCPRI (sem lista no destino), TBNIVEL e
TBPRESSE (versões antigas do catálogo oficial), FHLEITOUTI (unidade de internação sem
alimentadora e vigência sem origem), FIPARAM, FAPARAM, FAPARAMA (competência AAAAMM de duas colunas e aberta_em sem
origem) e FCCTRLANCIHA (item faturável derivado do item da conta; registro da CIHA sem origem).
"""
import datetime
import decimal

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
              "TBTPAPAC")
BLOQUEADAS = ("TBLOCSUS", "TBNIVSUS", "TBPRESUS", "TBLOCPRI", "TBNIVEL", "TBPRESSE", "FHLEITOUTI", "FIPARAM", "FAPARAM", "FAPARAMA", "FCCTRLANCIHA")
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
# nenhuma carregável referencia pai de fora da fatia
PAIS_EXTERNOS = {}


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


def linhas(r, ins):
    for tab in BLOQUEADAS:
        for i in (1, 2):
            ins(tab, [_falso(tp, i) for _, tp, _ in COLUNAS[tab]])
    # motivo de saída: 4 sem nome (1048); 2 e 5 com o mesmo código do leiaute (o 5 vira duplicidade 1062)
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
    # fonte orçamentária: o mesmo código em duas competências (o id 2 vira duplicidade 1062: o único é lista+código);
    # competência AAAAMM vira vigencia_inicio; o id 4 tem mês 13 (NULL com valor_fora_do_dominio, linha gravada)
    for i, comp, cod, nome in [(1, 202501, 100, "Fonte exemplo"), (2, 202601, 100, "Fonte exemplo nova"),
                               (3, None, 200, "Fonte exemplo dois"), (4, 202513, 300, "Fonte exemplo três")]:
        _ins(ins, "TBFONTE_ORCAMENTARIA_SUS", ID=i, ANO_MES_COMPETENCIA=comp, CODIGO=cod, NOME=nome)
    for cod, nome in [(1, "Grupo exemplo um"), (2, "Grupo exemplo dois"), (3, "Grupo exemplo três")]:
        _ins(ins, "TBGRUATE", COD=cod, NOME=nome)
    for cod, nome in [(1, "Tipo exemplo um"), (2, "Tipo exemplo dois")]:
        _ins(ins, "TBTIPATE", COD=cod, NOME=nome)
    for i, nome in [(1, "Inicial exemplo"), (2, "Continuidade exemplo"), (3, "  ")]:
        _ins(ins, "TBTPAPAC", ID=i, NOME=nome)
    ok = lambda n: {"gravados": n, "pendencias": {}}
    rec = lambda n: {"gravados": n, "pendencias": {R1048: 1}}
    return {"TBALTSUS": {"gravados": 3, "pendencias": {R1048: 1, R1062: 1}}, "TBASSOCI": ok(2),
            "TBCARATERATEND": rec(2), "TBDRS": ok(2),
            "TBFONTE_ORCAMENTARIA_SUS": {"gravados": 3, "pendencias": {R1062: 1, "valor_fora_do_dominio": 1}}, "TBGRUATE": ok(3),
            "TBTIPATE": ok(2), "TBTPAPAC": rec(2)}
