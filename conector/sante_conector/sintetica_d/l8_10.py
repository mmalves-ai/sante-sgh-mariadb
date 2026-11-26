"""Fatia L8-10 (patrimônio, financeiro, nota de serviço e escrituração: restantes do módulo FIN; 21 tabelas): tabelas
da origem com a forma do dicionário e dados 100% falsos.

CARREGADAS (10): os 4 cadastros simples (origem_bem, tipo_responsavel_bem, tipo_credor, tipo_cobranca), os 4 contextos
de trabalho do usuário por módulo (contexto_trabalho_usuario: usuário pelo login, estabelecimento único, competência de
ano e mês, adoção do mesmo usuário e módulo) e os dados fiscais do item (dado_fiscal_item: NCM com zeros à esquerda,
tipo presumido, vigência da carga, CST de PIS e COFINS, gênero e natureza do crédito pela referência encadeada ao
código dos catálogos fiscais da origem). Anomalias: descrição vazia (1048), espaços colapsados, S/N fora do domínio,
código repetido (1062), login e item inexistentes (pai_inexistente), mês inválido, competência vazia, período invertido
(CHECK 4025), NCM grande demais, ID de catálogo fiscal sem linha (pai_inexistente), código fiscal de 3 dígitos
(valor_fora_do_dominio) e valores presumidos (=~).
SDGELANNFS (rodada 3) completa o item da nota de entrada já gravado com o CFOP (de-para oficial cfop pelo código da
tabela de CFOP da origem). DESCARTADAS (9, declarado/sem_carga.tsv) e SEM_MECANISMO (1: MFLANGSI, pedido A,
em saida/L8-10.json): só a forma (2 linhas). Rodada 4: MFCABECLANC carrega (agregado dos filhos, #filhos_*).
"""
import datetime
import decimal
import re

from sante_conector.sintetica_d import l8_11 as _l811

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
    'SDGELANNFS': ('ID_GELANNFS', [
        ('ID_GELANNFS', 'INTEGER', True),
        ('ID_SDCFOP', 'SMALLINT', False),
    ]),
    'SDNATRECEITA': ('ID', [
        ('ID', 'SMALLINT', True),
        ('NOME', 'VARCHAR(80)', True),
    ]),
    'SDPARAM': ('ANO_PROCESSAMENTO,MES_PROCESSAMENTO', [
        ('ANO_PROCESSAMENTO', 'SMALLINT', True),
        ('MES_PROCESSAMENTO', 'SMALLINT', True),
        ('CAMINHO_PVA', 'VARCHAR(150)', False),
    ]),
}

CARREGADAS = ("GPORIGEM", "GPTP_RESPONSAVEL", "MFTIPOLANC", "MFTPCOBRANCA",
              "GPPARAMU", "MFPARUSU", "NFSEPARUSU", "PEPARAM_USUARIO", "SDGEITENS", "SDGELANNFS",
              "MFCABECLANC", "MFLANGSI", "SDPARAM", "MOPARAM",
              # rodada 5 (ADR 0006): eventos na trilha de auditoria (destino interino; pedidos r5-2 a r5-4)
              "MFCABECRENEGO", "MFTIPOLANC_TBOPCOES", "NFSEEMPDESENT", "NFSEEMPDESENV")
# descarte de produto (declarado/sem_carga.tsv): só a forma, nada carregado
DESCARTADAS = {"MFTPAPURACAO": "mecanismo_do_produto",
               "SDNATRECEITA": "mecanismo_do_produto",
               "MFTPCONTRIBUICAO": "mecanismo_do_produto"}
# sem mecanismo no motor: pedido em saida/L8-10.json (letra do pedido)
SEM_MECANISMO = {}  # r4 correção: MFLANGSI declarada (pedido A atendido pelos mecanismos da rodada 4)
# catálogos fiscais da origem (fora da fatia, carga de referência, nunca gravados: regra 7): só lidos pela referência
# encadeada `ref:<T>>CODIGO` de SDGEITENS (forma do dicionário: ID e CODIGO SMALLINT); IDs diferentes do código
CATALOGOS_ORIGEM = {t: ('ID', [('ID', 'SMALLINT', True), ('CODIGO', 'SMALLINT', True)])
                    for t in ('SDCSTPIS', 'SDCSTCOFINS', 'SDGENERO', 'SDNATCREDITO', 'SDCFOP')}
COLUNAS = {t: cols for t, (_, cols) in list(FORMAS.items()) + list(CATALOGOS_ORIGEM.items())}


def _ddl():
    saida = []
    for t, (chave, cols) in list(FORMAS.items()) + list(CATALOGOS_ORIGEM.items()):
        defs = ["%s %s%s" % (c, tp, " NOT NULL" if nn else "") for c, tp, nn in cols]
        if chave:
            defs.append("PRIMARY KEY (%s)" % chave)
        saida.append("CREATE TABLE %s (%s);" % (t, ", ".join(defs)))
    return "\n".join(saida) + "\n"


DDL = _ddl()
# filhos do agrupador (formas IDÊNTICAS às da L8-11, chaves 9101+ sem colisão na imagem conjunta): só lidos pelos
# agregados #filhos_* de MFCABECLANC, nunca carregados por esta fatia
SO_ORIGEM = ("MFLANCTO", "MFCTAREC")
DDL += "\n".join(m.group(0) for m in re.finditer(r"CREATE TABLE (\w+) \(.*?\);", _l811.DDL, re.S)
                 if m.group(1) in SO_ORIGEM) + "\n"
# pais de fora da fatia, como já carregados: usuários (login, chave de TBUSERS) e itens (COD de GEITENS); ZECA e o
# item 9 não existem (pai_inexistente)
# itens da nota de entrada (GELANNFS, L7-07) 1 a 4: na ordem dos pais (GEITENS 1-3 recebem os ids 1 a 3), os ids 4 a
# 7 do destino; o item 9 não existe (pai_inexistente)
PAIS_EXTERNOS = {"TBUSERS": ["ANA.PAULA", "BRUNO", "CARLA"], "GEITENS": [1, 2, 3], "GELANNFS": [1, 2, 3, 4],
                 "TBITEDES": ["1|1|1"], "TBCENCUS": [1]}
# um estabelecimento só no cliente de exemplo (@estabelecimento)
# o CFOP 1102 do carregador oficial (catálogo nunca gravado pela carga) e os itens da nota de entrada já gravados
# pela L7-07 (ids 4 a 7, sem CFOP), que SDGELANNFS completa por UPDATE
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS modulo_sistema (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(60) NOT NULL, descricao VARCHAR(150) NOT NULL, criado_em DATETIME(3) NOT NULL);"
                   "INSERT INTO modulo_sistema (codigo, descricao, criado_em) SELECT 'financeiro', 'Financeiro',"
                   " UTC_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = 'financeiro');"
                   "CREATE TABLE IF NOT EXISTS parametro_definicao (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " chave VARCHAR(100) NOT NULL, modulo_sistema_id BIGINT UNSIGNED NOT NULL,"
                   " descricao VARCHAR(500) NOT NULL, tipo VARCHAR(30) NOT NULL, criado_em DATETIME(3) NOT NULL);"
                   # r5: as definições (pedido r5-1 de saida/L8-10.json) NÃO são criadas aqui: sem a semente no
                   # catálogo do produto, cada item é recusado com codigo_inexistente_destino (visível)
                   "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   "INSERT INTO estabelecimento () VALUES ();"
                   "INSERT INTO cfop (id, codigo_cfop, descricao, sentido, abrangencia, versao_fonte, criado_em) VALUES"
                   " (11, '1102', 'Compra para comercialização', 'entrada', 'estadual', 'exemplo', UTC_TIMESTAMP(3));"
                   "INSERT INTO nota_entrada_item (id, nota_entrada_id, sequencia, insumo_id, unidade_medida_id,"
                   " quantidade, quantidade_estoque, valor_unitario, custo_unitario, criado_em) VALUES"
                   " (4, 1, 1, 1, 1, 2, 2, 1.5, 1.5, UTC_TIMESTAMP(3)), (5, 1, 2, 2, 1, 1, 1, 3, 3, UTC_TIMESTAMP(3)),"
                   " (6, 1, 3, 3, 1, 4, 4, 2, 2, UTC_TIMESTAMP(3)), (7, 2, 1, 1, 1, 1, 1, 9, 9, UTC_TIMESTAMP(3));")
# r5 revisão: responsável da renegociação -> autor do evento pelo NOME do usuário (cod:usuario.nome): o 1 casa, o 2 não
# casa (codigo_inexistente_destino, NULL visível); a tabela é do modelo (02_ADM), criada aqui só no banco descartável
PREPARO_DESTINO += ("CREATE TABLE IF NOT EXISTS usuario (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                    " login VARCHAR(60) NOT NULL, nome VARCHAR(150) NOT NULL, criado_em DATETIME(3) NOT NULL);"
                    # conta de serviço sem CPF (ck_usuario_cpf_pessoa: pessoa exige CPF ou dispensa)
                    "INSERT INTO usuario (login, nome, tipo_conta, criado_em) SELECT 'usuario.exemplo', 'Responsável 1 exemplo',"
                    " 'servico', UTC_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM usuario WHERE nome = 'Responsável 1 exemplo');")


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


# rodada 5 (revisão): listas fixas provadas por código E rótulo (provas.d/<T>.sql)
ROTULOS_R5 = {'MFTPAPURACAO': [(1, 'Pagamento'), (2, 'Emissão')], 'SDNATRECEITA': [(1, 'Cumulativo'), (2, 'Não cumulativo')], 'MFTPCONTRIBUICAO': [(1, 'Contribuição sindical compulsória'), (2, 'Contribuição associativa'), (3, 'Contribuição assistencial'), (4, 'Contribuição confederativa')]}


def linhas(r, ins):
    for tab, cols in COLUNAS.items():
        if tab not in CARREGADAS and tab not in CATALOGOS_ORIGEM and tab not in ROTULOS_R5:
            for i in (1, 2):
                ins(tab, [_falso(tp, i) for _, tp, _ in cols])
    # rodada 5 (ADR 0006): as listas fixas provadas (declarado/provas.tsv) trazem todos os itens do domínio
    for tab, itens in ROTULOS_R5.items():  # código E rótulo (prova pelo par)
        for i, rot in itens:
            ins(tab, [i, rot])
    # parâmetros de linha única -> parametro_valor (uma linha por coluna com valor; DIG_CDC vazio não gera linha)
    ins("SDPARAM", [2025, 3, "C:/pasta/validador"])
    ins("MOPARAM", [2024, 1, None, "C"])
    for i in (1, 2):
        ins("MFCABECLANC", [i])
    # rodada 5: trilha de auditoria. Renegociação 3 com data sentinela (NOT NULL: 1048); liberação do tipo 9 inexistente
    # (pai_inexistente, entra sem entidade_id); entidade 3 da NFS-e com nome só de espaços (motivo nulo, grava); provedor 3 sem versão
    for tab, cols in (("MFCABECRENEGO", [3, datetime.datetime(1899, 12, 30), "Responsável exemplo"]),
                      ("MFTIPOLANC_TBOPCOES", [1, 9]), ("NFSEEMPDESENT", [3, "   "]),
                      ("NFSEEMPDESENV", [3, "Provedor   exemplo", None])):
        ins(tab, cols)
    for i in (1, 2):
        _ins(ins, "MFCABECRENEGO", ID=i, DATA_HORA_RENEGOCIACAO=datetime.datetime(2025, 2, i, 9, 15),
             RESPONSAVEL_RENEGOCIACAO="Responsável %d exemplo" % i)
        for t in ("NFSEEMPDESENT", "NFSEEMPDESENV"):
            _ins(ins, t, ID=i, NOME="Entidade %d exemplo" % i, VERSAOXML="2.0%d" % i)
        _ins(ins, "MFTIPOLANC_TBOPCOES", ID_TBOPCOES=i, ID_MFTIPOLANC=i)
    # rateios: 1 e 2 do título a receber 9201 (70 = 60 + 10: sequência e percentual pelo grupo de leitura), carregado
    # nesta imagem (MFCTAREC abaixo): o 1 grava ligado ao título; o 2 com natureza 1|1|2 inexistente (pai_inexistente e
    # 1048); 3 TP_LAN 9 sem título (fora das condições, CHECK do pai recusa, 4025); 4 sem centro de custo (NOT NULL, 1048)
    # P7 (A06): TP_LAN 1 = a receber (era 2 antes da P7; o 2 ficou sem título e não exercitava mais a ligação)
    for tl, doc, tp, v, cdc in [(1, 9201, "E", "60.00", 1), (1, 9201, "E", "10.00", 1), (9, 5, "X", "5.00", 1),
                                (1, 9202, "E", "30.00", None)]:
        _ins(ins, "MFLANGSI", EMPRESA=1, FORN=5, DOC=doc, TIPO=tp, GRUPO=1, SUBGRUPO=1, ITEM=1 if v != "10.00" else 2,
             VALOR=decimal.Decimal(v), CDC=cdc, TP_LAN=tl, DATA=datetime.date(2025, 1, 5), SERIE="A")
    # agrupador 1: um movimento (10/01) e dois títulos a receber (05/01, 70 + 30): data 05/01, a receber 100;
    # agrupador 2 sem filho: data da carga (=@data_carga) com sem_filho_com_valor
    f11 = _l811.formas()
    ins("MFLANCTO", _l811._linha(f11["MFLANCTO"], {"ID": 9101, "EMPRESA": 1, "DATA": datetime.date(2025, 1, 10),
                                                   "DOC": 1, "VALOR": decimal.Decimal("40.00"), "ID_MFCABECLANC": 1}))
    for i, v in [(9201, "70.00"), (9202, "30.00")]:
        ins("MFCTAREC", _l811._linha(f11["MFCTAREC"], {"ID": i, "EMPRESA": 1, "DEV": "E", "COD": 5,
                                                     "APRES": datetime.date(2025, 1, 5), "DOC": i, "PARC": 1,
                                                     "VALOR": decimal.Decimal(v), "SERIE": "A", "RECIBO": 1,
                                                     "ID_MFCTAREC": i, "ID_MFCABECLANC": 1, "ID_MFTIPOLANC": 1,
                                                     "FLUXO": 1}))
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
    D = datetime.date
    # contexto do patrimônio: 1 grava; 2 mesmo login em outra empresa ADOTA o contexto da 1; 3 login inexistente
    # (pai_inexistente, 1048); 4 mês 13 (valor_fora_do_dominio, 1048); 5 fim antes do início (CHECK: 4025)
    for emp, usu, ano, mes, ini, fim in [(1, "ANA.PAULA", 2025, 3, D(2025, 1, 1), D(2025, 3, 31)),
                                         (2, "ANA.PAULA", 2025, 4, D(2025, 1, 1), D(2025, 4, 30)),
                                         (1, "ZECA", 2025, 5, D(2025, 1, 1), D(2025, 5, 31)),
                                         (1, "BRUNO", 2025, 13, D(2025, 1, 1), D(2025, 5, 31)),
                                         (1, "CARLA", 2025, 6, D(2025, 6, 30), D(2025, 6, 1))]:
        _ins(ins, "GPPARAMU", EMPRESA=emp, USUARIO=usu, COMPANO=ano, COMPMES=mes, DEPR_INI=ini, DEPR_FIM=fim,
             PERMISSOES="SNNS")
    # contexto do financeiro: 1 grava; 2 sem competência (1048); 3 mesma pessoa em outra empresa (adotado)
    for emp, usu, ano, mes in [(1, "ANA.PAULA", 2025, 2), (1, "BRUNO", None, None), (2, "ANA.PAULA", 2025, 3)]:
        _ins(ins, "MFPARUSU", EMPRESA=emp, USUARIO=usu, ANOPRO=ano, MESPRO=mes)
    # contexto da nota de serviço: 1 grava (retenções por usuário não migram); 2 mês zero (1048)
    for usu, mes in [("ANA.PAULA", 7), ("CARLA", 0)]:
        _ins(ins, "NFSEPARUSU", ID_TBEMPHOS=1, USUARIO=usu, PERMITIR_MANUTENCAO_RPS_EMITIDO="S", RETER_ISS="S",
             RETER_PIS="N", RETER_CSLL="N", RETER_COFINS="N", RETER_INSS="S", RETER_IRRF="N",
             MES_PROCESSAMENTO=mes, ANO_PROCESSAMENTO=2025)
    # contexto do ponto: 1 grava; 2 login inexistente (pai_inexistente, 1048)
    for usu, mes in [("BRUNO", 1), ("ZECA", 2)]:
        _ins(ins, "PEPARAM_USUARIO", COD_EMP=1, USUARIO=usu, MES=mes, ANO=2025)
    # catálogos fiscais da origem: o ID não é o código (o código 1 da natureza do crédito vira '01'; o 123 do
    # gênero não cabe em CHAR(2): valor_fora_do_dominio)
    for t, pares in (("SDCSTPIS", [(7, 50), (8, 98)]), ("SDCSTCOFINS", [(7, 50), (8, 70)]),
                     ("SDGENERO", [(31, 30), (32, 123)]), ("SDNATCREDITO", [(4, 1), (5, 13)])):
        for i, cod in pares:
            _ins(ins, t, ID=i, CODIGO=cod)
    # dados fiscais: 1 NCM de 8 dígitos e Ex 1 ('01'), códigos fiscais pelo catálogo; 2 NCM com zero à esquerda
    # perdido no inteiro, CST do PIS com ID sem linha no catálogo (pai_inexistente, NULL) e gênero de 3 dígitos
    # (valor_fora_do_dominio, NULL); 3 NCM de 9 dígitos (valor_fora_do_dominio), sem códigos fiscais (vazio, NULL sem
    # pendência); 9 item inexistente (pai_inexistente; CHECK do item: 4025)
    for item, ncm, ex, gen, nat, cof, pis in [(1, 30049099, 1, 31, 4, 7, 7), (2, 1012100, None, 32, 5, 8, 99),
                                              (3, 123456789, None, None, None, None, None),
                                              (9, 30049099, None, 31, 4, 7, 8)]:
        _ins(ins, "SDGEITENS", ID_GEITENS=item, NCM=ncm, CODIGO_EX_TIPI=ex, ID_SDGENERO=gen, ID_SDNATCREDITO=nat,
             ID_SDCSTCOFINS=cof, ID_SDCSTPIS=pis)
    # CFOP da origem (o ID não é o código): 1102 no catálogo; 1949 válido e fora do catálogo; 9102 inválido (1.º dígito)
    for i, cod in [(1, 1102), (2, 1949), (3, 9102)]:
        _ins(ins, "SDCFOP", ID=i, CODIGO=cod)
    # CFOP do item da nota (UPDATE do item já gravado): 1 grava o 1102; 2 fora do catálogo (catalogo_codigo_inexistente,
    # NULL); 3 inválido (catalogo_codigo_invalido, NULL); 4 ID de CFOP sem linha (pai_inexistente, NULL) e 5 sem
    # CFOP (vazio, sem pendência): o item continua como estava; 9 item inexistente (pai_inexistente, recusa)
    for item, cfop in [(1, 1), (2, 2), (3, 3), (4, 77), (9, 1)]:
        _ins(ins, "SDGELANNFS", ID_GELANNFS=item, ID_SDCFOP=cfop)
    return ESPERADO


ESPERADO = {
    # agrupador 1 com filhos na imagem (data e total a receber dos filhos); 2 sem filho: data da carga, visível
    # rateios (V, correção, pela P7/A06: TP_LAN 1 = a receber): o 1 grava ligado ao título 9201; o 2 com natureza
    # 1|1|2 inexistente (pai_inexistente, 1048); o 3 TP_LAN 9 sem título (CHECK do pai, 4025); o 4 sem centro de custo
    # (1048)
    "MFLANGSI": {"gravados": 1, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 2,
                                               "restricao_destino_4025": 1}},
    # V3b (recusas-fase2): a data da carga (concorrente) só vale e só avisa quando nenhum filho deu a data
    "MFCABECLANC": {"gravados": 2, "pendencias": {"sem_filho_com_valor": 1, "vigencia_sem_fonte": 1}},
    "GPORIGEM": {"gravados": 4, "pendencias": {"valor_presumido": 5, "restricao_destino_1048": 1,
                                               "valor_fora_do_dominio": 1}},
    "GPTP_RESPONSAVEL": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
    "MFTIPOLANC": {"gravados": 4, "pendencias": {"valor_presumido": 5, "restricao_destino_1048": 1,
                                                 "valor_fora_do_dominio": 2}},
    "MFTPCOBRANCA": {"gravados": 2, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1,
                                                   "restricao_destino_1062": 1}},
    "GPPARAMU": {"gravados": 2, "pendencias": {"adotado_existente": 1, "mescla_conflito_origem_guardada": 1, "pai_inexistente": 1,
                                               "valor_fora_do_dominio": 1, "restricao_destino_1048": 2,
                                               "restricao_destino_4025": 1}},
    # rodada 5: itens (SDPARAM 2 colunas; MOPARAM 3 com valor) recusados sem a definição no catálogo (pedido r5-1)
    "SDPARAM": {"gravados": 0, "pendencias": {"codigo_inexistente_destino": 2, "restricao_destino_1048": 1}},
    "MOPARAM": {"gravados": 0, "pendencias": {"codigo_inexistente_destino": 3, "restricao_destino_1048": 1}},
    # rodada 5: eventos na trilha de auditoria (destino interino)
    "MFCABECRENEGO": {"gravados": 2, "pendencias": {"data_sentinela": 1, "restricao_destino_1048": 1,
                                                   "codigo_inexistente_destino": 2}},
    "MFTIPOLANC_TBOPCOES": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "vigencia_sem_fonte": 3}},
    "NFSEEMPDESENT": {"gravados": 3, "pendencias": {"vigencia_sem_fonte": 3}},
    "NFSEEMPDESENV": {"gravados": 3, "pendencias": {"vigencia_sem_fonte": 3}},
    "MFPARUSU": {"gravados": 2, "pendencias": {"adotado_existente": 1, "mescla_conflito_origem_guardada": 1,
                                               "restricao_destino_1048": 1}},
    "NFSEPARUSU": {"gravados": 1, "pendencias": {"restricao_destino_1048": 1}},
    "PEPARAM_USUARIO": {"gravados": 1, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}},
    # vigência sem fonte e tipo do item presumido por linha, contados também na recusada
    "SDGEITENS": {"gravados": 3, "pendencias": {"vigencia_sem_fonte": 4, "valor_presumido": 4,
                                                "valor_fora_do_dominio": 2, "pai_inexistente": 2,
                                                "restricao_destino_4025": 1}},
    "SDGELANNFS": {"gravados": 4, "pendencias": {"catalogo_codigo_inexistente": 1, "catalogo_codigo_invalido": 1,
                                                 "pai_inexistente": 2}},
}
