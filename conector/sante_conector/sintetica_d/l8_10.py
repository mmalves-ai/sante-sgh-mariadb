"""Fatia L8-10 (faturamento e restantes, módulo FIN; 21 tabelas): tabelas da origem com a forma do dicionário e dados
100% falsos.

CARREGADAS (5 cadastros simples, sem referência): GPORIGEM (origem_bem), GPTP_RESPONSAVEL (tipo_responsavel_bem),
MFTIPOLANC (tipo_credor), MFTPCOBRANCA (tipo_cobranca) e MFTPCONTRIBUICAO (tributo), com as anomalias: descrição vazia
(NOT NULL: 1048), espaços internos colapsados, S/N fora do domínio e marca vazia (FALSE: vazio = 'não'), sentido sem par no
de-para (inclusive a mesma letra em caixa baixa), código repetido (chave única: 1062) e valores presumidos (=~).
As outras 16 ficam só com a forma (2 linhas falsas cada): bloqueadas ou fora da carga, com pedido em saida/L8-10.json.
"""
import datetime
import decimal

FORMAS = {
    'GPORIGEM': ('ID', [
        ('ID', 'SMALLINT', True),
        ('NOME', 'VARCHAR(45)', False),
        ('DEPRECIAR', 'CHAR(1)', False),
        ('INTEGRAR_FINANCEIRO', 'CHAR(1)', False),
        ('INTEGRAR_CONTABILIDADE', 'CHAR(1)', False),
        ('COD_OPE', 'INTEGER', False),
        ('HISTPR', 'SMALLINT', False),
        ('COMPL', 'VARCHAR(200)', False),
    ]),
    'GPPARAMU': ('EMPRESA,USUARIO', [
        ('EMPRESA', 'SMALLINT', True),
        ('USUARIO', 'VARCHAR(31)', True),
        ('COMPANO', 'INTEGER', True),
        ('COMPMES', 'SMALLINT', True),
        ('DEPR_INI', 'DATE', True),
        ('DEPR_FIM', 'DATE', True),
        ('PERMISSOES', 'VARCHAR(20)', True),
    ]),
    'GPTP_RESPONSAVEL': ('ID', [
        ('ID', 'INTEGER', True),
        ('NOME', 'VARCHAR(100)', False),
    ]),
    'MFCABECLANC': ('ID', [
        ('ID', 'INTEGER', True),
    ]),
    'MFCABECRENEGO': ('ID', [
        ('ID', 'INTEGER', True),
        ('DATA_HORA_RENEGOCIACAO', 'TIMESTAMP', True),
        ('RESPONSAVEL_RENEGOCIACAO', 'VARCHAR(70)', True),
    ]),
    'MFCTAUSU': ('ID_TBUSERS,ID_TBCTABAN', [
        ('ID_TBUSERS', 'SMALLINT', True),
        ('ID_TBCTABAN', 'SMALLINT', True),
    ]),
    'MFLANGSI': ('EMPRESA,TP_LAN,FORN,DATA,DOC,TIPO,SERIE,GRUPO,SUBGRUPO,ITEM', [
        ('EMPRESA', 'INTEGER', True),
        ('FORN', 'BIGINT', True),
        ('DOC', 'INTEGER', True),
        ('TIPO', 'CHAR(1)', True),
        ('GRUPO', 'INTEGER', True),
        ('SUBGRUPO', 'INTEGER', True),
        ('ITEM', 'INTEGER', True),
        ('VALOR', 'NUMERIC(18,2)', True),
        ('CDC', 'INTEGER', False),
        ('TP_LAN', 'SMALLINT', True),
        ('DATA', 'DATE', True),
        ('SERIE', 'VARCHAR(3)', True),
        ('PERAPUR', 'VARCHAR(7)', False),
    ]),
    'MFPARUSU': ('EMPRESA,USUARIO', [
        ('EMPRESA', 'INTEGER', True),
        ('USUARIO', 'VARCHAR(31)', True),
        ('ANOPRO', 'INTEGER', False),
        ('MESPRO', 'INTEGER', False),
    ]),
    'MFTIPOLANC': ('ID', [
        ('ID', 'SMALLINT', True),
        ('COD_TP_LANCAMENTO', 'CHAR(1)', True),
        ('NOME', 'VARCHAR(25)', True),
        ('TP_LANCAMENTO', 'CHAR(1)', True),
    ]),
    'MFADIFOR': ('ID_MFADIFOR', [
        ('ID_MFADIFOR', 'INTEGER', True),
        ('EMPRESA', 'SMALLINT', True),
        ('COD', 'INTEGER', True),
        ('TIPO_CREDOR', 'CHAR(1)', True),
        ('DOC', 'INTEGER', True),
        ('EMISSAO', 'DATE', False),
        ('VENC', 'DATE', False),
        ('DT_PGTO', 'DATE', False),
        ('VLR_DOC_TOT', 'NUMERIC(18,2)', True),
        ('PAGO', 'NUMERIC(18,2)', True),
        ('REFERENTE', 'VARCHAR(60)', False),
        ('ID_TBCTABAN', 'SMALLINT', False),
        ('CHEQUE', 'INTEGER', True),
        ('TP_PGTO', 'SMALLINT', False),
        ('HIST', 'SMALLINT', False),
        ('ID_MFCABECLANC', 'INTEGER', True),
        ('ID_MFTIPOLANC', 'SMALLINT', True),
        ('DATA_PREVISTA_PGTO', 'DATE', False),
        ('AUTORIZADO_PGTO_PARA', 'DATE', False),
    ]),
    'MFADIFOR_TBCBOPRO': ('ID_MFADIFOR', [
        ('ID_MFADIFOR', 'INTEGER', True),
        ('ID_TBCBOPRO', 'INTEGER', True),
    ]),
    'MFTIPOLANC_TBOPCOES': ('ID_TBOPCOES,ID_MFTIPOLANC', [
        ('ID_TBOPCOES', 'INTEGER', True),
        ('ID_MFTIPOLANC', 'SMALLINT', True),
    ]),
    'MFTPAPURACAO': ('ID', [
        ('ID', 'SMALLINT', True),
        ('NOME', 'VARCHAR(10)', True),
    ]),
    'MFTPCOBRANCA': ('ID', [
        ('ID', 'SMALLINT', True),
        ('COD_TPCOBRANCA', 'SMALLINT', True),
        ('NOME', 'VARCHAR(20)', False),
    ]),
    'MFTPCONTRIBUICAO': ('ID', [
        ('ID', 'SMALLINT', True),
        ('NOME', 'VARCHAR(40)', True),
    ]),
    'MOPARAM': ('', [
        ('ANO', 'SMALLINT', False),
        ('MES', 'SMALLINT', False),
        ('DIG_CDC', 'VARCHAR(1)', False),
        ('REGIME', 'CHAR(1)', False),
    ]),
    'NFSEEMPDESENT': ('ID', [
        ('ID', 'SMALLINT', True),
        ('NOME', 'VARCHAR(30)', True),
    ]),
    'NFSEEMPDESENV': ('ID', [
        ('ID', 'SMALLINT', True),
        ('NOME', 'VARCHAR(30)', True),
        ('VERSAOXML', 'VARCHAR(50)', False),
    ]),
    'NFSEPARUSU': ('ID_TBEMPHOS,USUARIO', [
        ('ID_TBEMPHOS', 'SMALLINT', True),
        ('USUARIO', 'VARCHAR(31)', True),
        ('PERMITIR_MANUTENCAO_RPS_EMITIDO', 'CHAR(1)', False),
        ('RETER_ISS', 'CHAR(1)', False),
        ('RETER_PIS', 'CHAR(1)', False),
        ('RETER_CSLL', 'CHAR(1)', False),
        ('RETER_COFINS', 'CHAR(1)', False),
        ('RETER_INSS', 'CHAR(1)', False),
        ('RETER_IRRF', 'CHAR(1)', False),
        ('MES_PROCESSAMENTO', 'SMALLINT', False),
        ('ANO_PROCESSAMENTO', 'SMALLINT', False),
    ]),
    'PEPARAM_USUARIO': ('COD_EMP,USUARIO', [
        ('COD_EMP', 'INTEGER', True),
        ('USUARIO', 'VARCHAR(31)', True),
        ('MES', 'SMALLINT', True),
        ('ANO', 'SMALLINT', True),
    ]),
    'SDGEITENS': ('ID_GEITENS', [
        ('ID_GEITENS', 'INTEGER', True),
        ('NCM', 'INTEGER', False),
        ('CODIGO_EX_TIPI', 'SMALLINT', False),
        ('ID_SDGENERO', 'SMALLINT', False),
        ('ID_SDNATCREDITO', 'SMALLINT', False),
        ('ID_SDCSTCOFINS', 'SMALLINT', False),
        ('ID_SDCSTPIS', 'SMALLINT', False),
    ]),
}

CARREGADAS = ("GPORIGEM", "GPTP_RESPONSAVEL", "MFTIPOLANC", "MFTPCOBRANCA", "MFTPCONTRIBUICAO")
# bloqueadas por pai ou coluna obrigatória (a declaração prevista fica no motivo de cada coluna) e o pedido
BLOQUEADAS = {"GPPARAMU": 2, "MFPARUSU": 2, "NFSEPARUSU": 2, "PEPARAM_USUARIO": 2, "MFCABECLANC": 3,
              "MFCABECRENEGO": 3, "MFCTAUSU": 4, "MFLANGSI": 5, "MFADIFOR": 7, "MFADIFOR_TBCBOPRO": 7,
              "SDGEITENS": 12}
# fora da carga por decisão de modelo (pedido)
FORA = {"MFTIPOLANC_TBOPCOES": 8, "MFTPAPURACAO": 9, "MOPARAM": 9, "NFSEEMPDESENT": 11, "NFSEEMPDESENV": 11}
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
# nenhuma carregável aponta outra tabela: sem pais externos
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
    return None


def _ins(ins, tab, **v):
    ins(tab, [v.get(c) for c, _, _ in COLUNAS[tab]])


def linhas(r, ins):
    for tab, cols in COLUNAS.items():
        if tab not in CARREGADAS:
            for i in (1, 2):
                ins(tab, [_falso(tp, i) for _, tp, _ in cols])
    # origens do bem: 2 nome com espaços repetidos (colapsados) e complemento com quebra de linha (preservada);
    # 3 nome só com espaços (NULL em NOT NULL: 1048); 4 S/N fora do domínio (padrão TRUE, com pendência);
    # 5 marcas vazias (vazio = 'não': FALSE pelo de-para de valores, sem pendência); 1 T/F, a forma da origem
    for i, nome, dep, fin, cont, compl in [
            (1, "Compra exemplo", "T", "F", "T", "Entrada por compra"),
            (2, "  Doação   recebida ", "N", "S", "N", " linha 1\nlinha 2 "),
            (3, "   ", "S", "S", "S", None), (4, "Comodato exemplo", "X", "N", "S", None),
            (5, "Transferência exemplo", None, None, None, None)]:
        _ins(ins, "GPORIGEM", ID=i, NOME=nome, DEPRECIAR=dep, INTEGRAR_FINANCEIRO=fin, INTEGRAR_CONTABILIDADE=cont,
             COD_OPE=10 + i, HISTPR=i, COMPL=compl)
    # tipos de responsável: 4 sem nome (1048)
    for i, nome in [(1, "Colaborador exemplo"), (2, "Médico   plantonista"), (3, "Cooperativa exemplo"), (4, None)]:
        _ins(ins, "GPTP_RESPONSAVEL", ID=i, NOME=nome)
    # tipos de lançamento: 2 repete a letra de 1 em outro sentido (código do destino é o ID: grava); 3 'p' em caixa
    # baixa e 4 'X' sem par no de-para (padrão 'pagar', com pendência); 5 nome vazio (1048)
    for i, cod, nome, tp in [(1, "F", "Fornecedor exemplo", "P"), (2, "F", "Fornecedor a receber", "R"),
                             (3, "M", "Médicos exemplo", "p"), (4, "T", "Tributos exemplo", "X"),
                             (5, "O", "  ", "P")]:
        _ins(ins, "MFTIPOLANC", ID=i, COD_TP_LANCAMENTO=cod, NOME=nome, TP_LANCAMENTO=tp)
    # tipos de cobrança: 3 repete o código 2 (chave única: 1062); 4 sem nome (1048)
    for i, cod, nome in [(1, 1, "Carteira exemplo"), (2, 2, "Boleto  registrado"), (3, 2, "Repetido exemplo"),
                         (4, 4, None)]:
        _ins(ins, "MFTPCOBRANCA", ID=i, COD_TPCOBRANCA=cod, NOME=nome)
    # contribuições: 4 nome vazio (1048)
    for i, nome in [(1, "Contribuição A"), (2, "Contribuição B"), (3, "Contribuição C"), (4, "")]:
        _ins(ins, "MFTPCONTRIBUICAO", ID=i, NOME=nome)
    return ESPERADO


ESPERADO = {
    "GPORIGEM": {"gravados": 4, "pendencias": {"valor_presumido": 5, "restricao_destino_1048": 1,
                                               "valor_fora_do_dominio": 1}},
    "GPTP_RESPONSAVEL": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
    "MFTIPOLANC": {"gravados": 4, "pendencias": {"valor_presumido": 5, "restricao_destino_1048": 1,
                                                 "valor_fora_do_dominio": 2}},
    "MFTPCOBRANCA": {"gravados": 2, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1,
                                                   "restricao_destino_1062": 1}},
    # três colunas presumidas por linha (esfera, apuração, incidência), contadas também na linha recusada
    "MFTPCONTRIBUICAO": {"gravados": 3, "pendencias": {"valor_presumido": 12, "restricao_destino_1048": 1}},
}
