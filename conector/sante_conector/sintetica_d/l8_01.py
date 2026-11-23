"""Fatia L8-01 (faturamento e restantes, módulo FAT), rodada 3 de cobertura: forma das 23 tabelas da origem da fatia
e anomalias, com dados 100% falsos.

Carregadas pelo mapa (colunas.d/L8-01.tsv), 16: grupos de motivo de glosa, tipos de dedução do IRRF, competência de
trabalho por módulo (login repetido ADOTA a já gravada), código do profissional e do hospital no convênio, fechamento
da competência, orçamento particular; e, nesta rodada, o horário normal da tabela (pares início/fim por dia no destino
principal), a guia da conta (conta pela chave alternativa COMPOSTA, paciente e atendimento lidos da conta, data da
solicitação por três fontes concorrentes), o modelo de orçamento e o item do orçamento (procedimento pelo código no
cadastro de procedimentos), a incidência do evento de repasse (natureza pelo catálogo oficial do destino, `cod:`), o
lançamento de repasse (favorecido criado ANTES e adotado pelo profissional) e a composição da base do lançamento.
Descartes (sem_carga.tsv) entram só com a forma.
Referências pela ORIGEM: a conta (FCCTAEXT) e o atendimento/prontuário (RECADATE, RICADPAC), a inscrição no conselho
(TBCBOPRO), o procedimento (TBPROCTO) e a associação lançamento x inscrição (RPLANEVE_TBCBOPRO, descarte duplicado).
Os pais de fora da fatia são PAIS_EXTERNOS. Rodada 3 (correção): as dependências de ordem da fatia estão declaradas
(declarado/dependencias.tsv) e a ordem regenerada: a conta, o procedimento, a tabela de honorários e o orçamento
carregam ANTES da guia, do modelo, do horário e do item. Também: condição de pagamento da nota (FCTPPGTONFSE), abertura
da conta na recepção (RECONTAS, evento da linha do tempo da conta), situação do lançamento pela evidência do RPA
(RPLANRPA lida na origem), tipo da guia e do favorecido por de-para.
Anomalias: login sem usuário, login repetido, mês 13, registro repetido (1062), profissional inexistente, convênio
inexistente, código vazio, valor negativo, CPF inválido, paciente sem cadastro, data vazia, bytes CP1252, nome só de
espaços, horário sem dia (sem_item_a_gravar), fim antes do início (CHECK), tabela de preço inexistente, conta de mesmo
número em outro tipo (a chave composta separa), conta repetida (pai_ambiguo), autorização antes da solicitação
(CHECK), procedimento em duas tabelas (pai_ambiguo), natureza com duas vigências (pai_ambiguo) e inexistente, evento
inexistente, lançamento sem profissional, valor negativo (CHECK), alíquota fora de 0..100, lançamento recusado
(pai_pendente na composição).
"""
import csv
import datetime
import os
from decimal import Decimal as D

FATIA = ("FAPARUSU", "FCCODCON", "FCCPSCON", "FCEMPAUDPLANSERV", "FCFECMES", "FCGUIAS", "FCHORATE", "FCORCAME",
         "FCORCPAD", "FCORLAME", "FCPARUSU", "FCPROCUNIBHMED", "FCREFUND", "FCTPMOTGLOSA", "FCTPPGTONFSE", "FIPARUSU",
         "RECONTAS", "RPDEDUTIVEL", "RPEVENTOESOC", "RPLANEVE", "RPLANEVE_COMPOSICAOBASE", "RPLANEVE_TBCBOPRO",
         "RPPARAM")
INTERMEDIARIAS = ("FCCTAEXT", "RECADATE", "RICADPAC", "TBCBOPRO", "TBPROCTO", "RPLANRPA", "TBCTRTHM", "TBCTRMEM",
                  "TBMATMED")
_MAPA = os.path.join(os.path.dirname(__file__), "..", "..", "mapa")


def _dicionario():
    cols, chaves = {t: [] for t in FATIA + INTERMEDIARIAS}, {}
    with open(os.path.join(_MAPA, "colunas.tsv"), encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            if r["tabela"] in cols:
                forma = r["forma"]
                if forma == "BLOB":
                    forma = "BLOB SUB_TYPE 1" if r["regra"] == "texto_longo" else "BLOB SUB_TYPE 0"
                elif forma == "DOUBLE":
                    forma = "DOUBLE PRECISION"
                cols[r["tabela"]].append((r["coluna"], forma, r["obrigatoria"] == "S"))
    with open(os.path.join(_MAPA, "tabelas.tsv"), encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            if r["tabela"] in cols and r["chave"]:
                chaves[r["tabela"]] = r["chave"]
    return cols, chaves


COLS, CHAVES = _dicionario()
DDL = "".join("CREATE TABLE %s (%s%s);\n" % (
    t, ", ".join('"%s" %s%s' % (c, f, " NOT NULL" if ((ob and t in FATIA) or c in CHAVES.get(t, "").split(",")) else "")
                 for c, f, ob in COLS[t]),
    ", PRIMARY KEY (%s)" % CHAVES[t] if t in CHAVES else "") for t in FATIA + INTERMEDIARIAS)

PAIS_EXTERNOS = {"TBUSERS": ["fat.exemplo", "sus.exemplo"], "TBCONVEN": ["1", "2"], "TBPROFIS": ["1", "2"],
                 "TBTIPOACOMOD": ["1"], "RECADATE": ["5001", "5002"],
                 "RICADPAC": ["701", "702"], "RPEVENTO": ["1", "2", "3"]}
# FCCTAEXT (conta, L8-05) e TBPROCTO (procedimento, L8-03) estão nesta imagem como intermediárias (a referência lê a
# origem delas) e são declaradas pelas fatias donas: carregam aqui pelo mapa, ANTES das filhas desta fatia (dependências
# declaradas na rodada 3); TBCTRTHM também (tabela de honorários, L8-03), por isso deixou de ser pai externo.
# único estabelecimento do cliente de exemplo (o @estabelecimento resolve por ele); catálogo oficial da natureza da
# rubrica (só LIDO pelo cod:): 1000 vigente, 1200 com duas vigências (pai_ambiguo)
PREPARO_DESTINO = (
    "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
    " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
    "CREATE TABLE IF NOT EXISTS natureza_rubrica (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo_esocial"
    " VARCHAR(4) NOT NULL, descricao VARCHAR(150) NOT NULL, vigencia_inicio DATE NOT NULL, versao_fonte VARCHAR(30) NOT"
    " NULL, criado_em DATETIME(3) NOT NULL, UNIQUE KEY (codigo_esocial, vigencia_inicio));"
    "INSERT IGNORE INTO natureza_rubrica (codigo_esocial, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES"
    " ('1000', 'Natureza exemplo', '2018-01-01', 'teste', UTC_TIMESTAMP(3)),"
    " ('1200', 'Natureza exemplo antiga', '2018-01-01', 'teste', UTC_TIMESTAMP(3)),"
    " ('1200', 'Natureza exemplo nova', '2021-01-01', 'teste', UTC_TIMESTAMP(3));"
    # forma mínima do atendimento (L3, pai externo): a conta (FCCTAEXT, declarada por outra fatia e presente nesta
    # imagem como intermediária) copia dele o paciente (`ref:RECADATE@paciente_id`); vazio aqui, a cópia fica NULL
    # e o tipo de conta pelo código (`cod:tipo_conta.codigo`): externa e interna
    "CREATE TABLE IF NOT EXISTS atendimento (id BIGINT UNSIGNED PRIMARY KEY, paciente_id BIGINT UNSIGNED NULL);"
    # r3 (correção): os dois atendimentos dos pais externos RECADATE 5001 e 5002 (ids 1 e 2 do conector_origem
    # externo, em ordem de tabela e chave) com paciente: a conta (FCCTAEXT) grava e a guia e a abertura da conta
    # (RECONTAS) acham a conta pela chave alternativa composta, na ordem nova (dependências declaradas)
    "INSERT IGNORE INTO atendimento (id, paciente_id) VALUES (1, 3), (2, 4);"
    "CREATE TABLE IF NOT EXISTS tipo_conta (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(30) NOT NULL);"
    "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) SELECT 'externa', 'Externa', 'externa', UTC_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tipo_conta WHERE"
    " codigo = 'externa');"
    "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) SELECT 'internacao', 'Internação', 'internacao', UTC_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tipo_conta WHERE"
    " codigo = 'internacao')")

T0 = datetime.datetime(2026, 3, 2, 8, 30)
D0 = datetime.date(2026, 3, 2)


def _item_aceita_f():
    """O filtro de licença do item de mat/med (TBMATMED, fatia L8-03) aceita a marca F nas duas colunas?"""
    from ..mapa import DIR_PACOTE
    try:
        txt = (DIR_PACOTE / "declarado" / "colunas.d" / "L8-03.tsv").read_text(encoding="utf-8")
    except OSError:
        return False
    vias = [l.split("\t")[5] for l in txt.splitlines() if l.startswith("TBMATMED\t") and "so_se:" in l]
    def aceita(col):
        return any(("so_se:TAB>TBCTRMEM>%s=" % col) in v and
                   "F" in v.split("so_se:TAB>TBCTRMEM>%s=" % col)[1].split("!")[0].split(";")[0].split(",")
                   for v in vias)
    return bool(vias) and aceita("REF_BRA") and aceita("REF_SIMP")


_ITEM_ACEITA_F = _item_aceita_f()


def linhas(r, ins):
    def linha(t, **v):
        faltam = set(v) - {c for c, _, _ in COLS[t]}
        if faltam:
            raise KeyError("%s: colunas fora do dicionário: %s" % (t, sorted(faltam)))
        ins(t, [v.get(c) for c, _, _ in COLS[t]])

    # intermediárias (forma completa do dicionário, só as colunas usadas preenchidas)
    for i, prof in ((301, 1), (302, 2), (303, 9)):                      # 303 -> profissional 9 inexistente
        linha("TBCBOPRO", ID=i, ID_TBPROFIS=prof, ID_TBCBOSUS=1, UF="SP", COD=7000 + i, VINC_EMPR="N")
    # contas: 1 e 2 externas; 3 INTERNA com o mesmo número 800 (a chave composta separa); 4 e 5 repetidas
    # (pai_ambiguo); 6 sem atendimento
    for i, ano, mes, tipo, cod, reg, dtg, dreq in ((1, 2026, 3, "E", 800, 5001, D0, None),
                                                   (2, 2026, 3, "E", 801, 5002, None, T0),
                                                   (3, 2026, 3, "I", 800, 5002, None, None),
                                                   (4, 2026, 4, "E", 802, 5001, D0, None),
                                                   (5, 2026, 4, "E", 802, 5001, D0, None),
                                                   (6, 2026, 4, "E", 803, None, D0, None)):
        linha("FCCTAEXT", ID=i, ANOPRO=ano, MESPRO=mes, TIPO_CTA=tipo, COD=cod, REG_ATE=reg, DT_GUIA=dtg,
              DATA_REQ=dreq, CON=1, BAIXA=D0, HOR_BAI="0800")
    # C9 (recusa acima de 5% em entidade principal deixa a conciliação não conferida): a conta 6 recusada fica abaixo
    # do limite com 14 contas comuns (junho de 2026, números 900+, que nenhuma linha desta imagem procura)
    for i in range(7, 21):
        linha("FCCTAEXT", ID=i, ANOPRO=2026, MESPRO=6, TIPO_CTA="E", COD=900 + i, REG_ATE=5001, DT_GUIA=D0,
              CON=1, BAIXA=D0, HOR_BAI="0800")
    # tabelas de honorários (r3, correção: carregam aqui pelo mapa, L8-03, antes do horário e do procedimento, que
    # lê o nome da tabela na origem para o grupo de faturamento)
    # r4: tabelas de mat/med (L8-03, carregam aqui pelo mapa): 1 própria (marcas vazias), 2 de referência comercial,
    # 3 própria com as marcas da origem T/F valendo F (o caso real: 1.065.998 preços na referência)
    linha("TBCTRMEM", COD=1, NOME="Tabela de mat/med falsa", SITUACAO="A")
    linha("TBCTRMEM", COD=2, NOME="Tabela comercial falsa", REF_BRA="T", REF_SIMP="T", SITUACAO="A")
    linha("TBCTRMEM", COD=3, NOME="Tabela propria marcada falsa", REF_BRA="F", REF_SIMP="F", SITUACAO="A")
    for i, tab, cod in ((1, 1, 100), (2, 1, 101), (3, 2, 100), (4, 3, 100)):
        linha("TBMATMED", ID=i, TAB=tab, COD=cod, CLASSIF=1, COD_ALFA="A", NOME="Item falso %d" % i, FATOR_Q=1.0)
    # histórico de preço (FCREFUND): duas datas do mesmo item (uma edição de migração por tabela), sem preço (CHECK),
    # negativo, item inexistente (1048) e tabela de referência comercial (pulada: licenca_nao_comprovada)
    for cod, data, valor, tab in ((100, datetime.date(2025, 1, 1), D("10.5"), 1),
                                  (100, datetime.date(2025, 6, 1), D("11.25"), 1),
                                  (101, datetime.date(2025, 1, 1), None, 1),
                                  (101, datetime.date(2025, 2, 1), D("-1"), 1),
                                  (999, datetime.date(2025, 1, 1), D("5"), 1),
                                  (100, datetime.date(2025, 1, 1), D("7"), 2),
                                  (100, datetime.date(2025, 3, 1), D("8"), 3)):     # tabela própria marcada F
        linha("FCREFUND", TAB=tab, COD=cod, CLASSIF=1, COD_ALFA="A", DATA=data, VALOR=valor, NOME="Item falso")
    for cod in (10, 20, 30):
        linha("TBCTRTHM", COD=cod, NOME="Tabela de honorários falsa %d" % cod, SITUACAO="A")
    # procedimentos: 30101 numa tabela; 30102 em duas (pai_ambiguo)
    for i, tab, cod in ((51, 10, 30101), (52, 10, 30102), (53, 20, 30102)):
        linha("TBPROCTO", ID=i, ID_TBCTRTHM=tab, COD_PROCEDIMENTO=cod, NOME="Procedimento falso %d" % i)
    # lançamento x inscrição: 101, 103, 106 e 107 -> profissional 1; 102 -> 2; 104 -> inscrição sem profissional
    for lanc, insc in ((101, 301), (102, 302), (103, 301), (104, 303), (106, 301), (107, 301)):
        linha("RPLANEVE_TBCBOPRO", ID_RPLANEVE=lanc, ID_TBCBOPRO=insc)
    # lançamento x RPA (r3, correção): 101 e 103 já estão em RPA emitido -> aprovado; os outros, sem RPA -> aberto
    for rpa, lanc in ((9001, 101), (9002, 103)):
        linha("RPLANRPA", ID_RPRPA=rpa, ID_RPLANEVE=lanc)
    for reg, pront in ((5001, 7001), (5002, 7002)):
        linha("RECADATE", REG=reg, PRONT=pront)
    for i, pront in ((701, 7001), (702, 7002)):
        linha("RICADPAC", ID=i, PRONT=pront, NOME="Paciente falso %d" % i)

    # já carregadas antes da rodada
    for v in [(1, 10, "Elegibilidade exemplo"), (2, 20, "  Guia   exemplo  "), (3, 30, None),
              (4, 40, "Cobrança ação € exemplo"), (5, 50, "   ")]:
        linha("FCTPMOTGLOSA", ID=v[0], COD_TP_MOTIVO_GLOSA=v[1], NOME=v[2])
    for v in [(1, "Previdência oficial exemplo"), (2, "Pensão   alimentícia exemplo"), (3, None),
              (7, "Dependente “exemplo”")]:
        linha("RPDEDUTIVEL", ID=v[0], NOME=v[1])

    # competência de trabalho por módulo
    linha("FAPARUSU", USUARIO="fat.exemplo", MODULO="BPA", MESPRO=3, ANOPRO=2026, PERINI=T0, PERFIN=T0)
    linha("FAPARUSU", USUARIO="fantasma", MODULO="BPA", MESPRO=13, ANOPRO=2026)        # login e mês inválidos
    linha("FAPARUSU", USUARIO="fat.exemplo", MODULO="APAC", MESPRO=4, ANOPRO=2026)     # outro submódulo: adota
    linha("FCPARUSU", USUARIO="fat.exemplo", MESPRO=3, ANOPRO=2026, RCSC="S", CTAE=10, IMPRES="S")
    linha("FCPARUSU", USUARIO="sus.exemplo", MESPRO=4, ANOPRO=2026, RCSC="N")
    linha("FCPARUSU", USUARIO="fat.exemplo", MESPRO=5, ANOPRO=2026, RCSC="S")         # mesmo usuário: adota
    linha("FIPARUSU", USUARIO="sus.exemplo", ANOPRO=2026, MESPRO=2)
    linha("FIPARUSU", USUARIO="fat.exemplo")                                            # sem competência: 1048

    # código do profissional e do hospital no convênio
    banco = dict(BANCO="Banco exemplo", N_BANCO=1, AGENCIA="0001", CONTA="12345-6")
    linha("FCCODCON", CON=1, ID_TBCBOPRO=301, CRM=1001, CODIGO="M001", COD_CON_TISS="T001",
          VLR_CONSULTA=D("150.00"), **banco)
    linha("FCCODCON", CON=2, ID_TBCBOPRO=302, CRM=1002, CODIGO="M002", VLR_CONSULTA=D("-5.00"))  # negativo
    linha("FCCODCON", CON=1, ID_TBCBOPRO=303, CRM=1003, CODIGO="M003")                 # sem profissional: 4025
    linha("FCCODCON", CON=9, ID_TBCBOPRO=301, CRM=1001)                                 # convênio 9, sem código
    linha("FCCPSCON", CON=1, ATO=1, COD=1, CODIGO="H001", COD_CON_TISS="TH001", **banco)
    linha("FCCPSCON", CON=2, ATO=1, COD=2)                                              # sem código: 1048
    linha("FCCPSCON", CON=1, ATO=2, COD=3, CODIGO="H002")                              # 2º código no convênio: adota

    # fechamento da competência
    linha("FCFECMES", CONVENIO=1, ANO=2026, MES=1, DATA=T0, USUARIO="fat.exemplo")
    linha("FCFECMES", CONVENIO=2, ANO=2026, MES=2, USUARIO="fat.exemplo")              # sem data: 4025
    linha("FCFECMES", CONVENIO=2, ANO=2026, MES=3, DATA=T0, USUARIO="fantasma")        # login sem usuário

    # orçamento particular
    orc = dict(TEL_RES="11 5555-0000", EMAIL="exemplo@exemplo.invalid", VALOR=D("1234.56"), N_PARCELAS=3,
               VENC=datetime.date(2026, 4, 2), OBS="Observação ação\nsegunda linha", OBS_P="Cirurgia exemplo",
               PERMANENCIA=2, CON=1, CODACO=1, DATA_REALIZ=datetime.date(2026, 3, 20), PARCELADO="S")
    linha("FCORCAME", COD=1, PRONT=7001, PACIENTE="Paciente falso", RESPONSAVEL="Responsável falso",
          CPF=52998224725, DATA=D0, **orc)
    linha("FCORCAME", COD=2, PRONT=9999, PACIENTE="Interessado   falso", RESPONSAVEL="Outro responsável",
          CPF=12345678900, DATA=D0, PARCELADO="N")                                      # sem cadastro, CPF inválido
    linha("FCORCAME", COD=3, PACIENTE="Sem data", RESPONSAVEL="Responsável")          # sem data: 1048
    linha("FCORCAME", COD=4, PACIENTE="Uma parcela", RESPONSAVEL="Responsável", DATA=D0, PARCELADO="S",
          N_PARCELAS=1)                                                                 # parcelado em 1: 4025

    # horário normal por tabela (pares HHMM): 10 seis dias; 20 nenhum (sem_item_a_gravar); 99 tabela inexistente;
    # 30 domingo com fim antes do início (CHECK recusa a linha inteira)
    util = {"%s_%s" % (d, x): h for d in ("SEG", "TER", "QUA", "QUI", "SEX") for x, h in (("I", "0700"), ("F", "1900"))}
    linha("FCHORATE", TAB=10, SAB_I="0700", SAB_F="1200", **util)
    linha("FCHORATE", TAB=20, DOM_I="  ")
    linha("FCHORATE", TAB=99, SEG_I="0800", SEG_F="1800")
    linha("FCHORATE", TAB=30, DOM_I="1300", DOM_F="1200", SEG_I="0800", SEG_F="1800")

    # guias da conta
    gd = dict(TP_GUIA="S", TP_GUIA_S="S", TIPO_CTA="E", ANOPRO=2026, MESPRO=3)
    linha("FCGUIAS", CON=1, GUIA_P="G1", GUIA_S="G1", CONTA=800, SENHA_SUPLEMENTAR="S9",
          VALIDADE_SENHA_SUPLEMENTAR=datetime.date(2026, 4, 30), DATA_AUTORIZACAO_SUPLEMENTAR=datetime.date(2026, 3, 3),
          GUIA_ATRIBUIDA_OPERADORA_TISS="OP-1", **gd)                                  # data da guia da conta
    linha("FCGUIAS", CON=1, GUIA_P="G1", GUIA_S="G2", CONTA=801, **gd)                 # data da requisição
    linha("FCGUIAS", CON=2, GUIA_P="G3", GUIA_S="G3", CONTA=800, **dict(gd, TIPO_CTA="I"))  # interna: competência
    linha("FCGUIAS", CON=1, GUIA_P="G4", GUIA_S="G4", CONTA=802, **dict(gd, MESPRO=4))  # conta repetida: 1048
    linha("FCGUIAS", CON=9, GUIA_P="G5", GUIA_S="G5", CONTA=800, **gd)                 # convênio inexistente: 1048
    # número repetido no MESMO convênio: adota a guia (lida antes da linha acima pela chave, TP_GUIA_S C < S). Traz
    # os mesmos dados da guia: a mescla que PREENCHE a guia adotada muda o resumo da linha que a gravou e a
    # conciliação diverge (lacuna do motor pedida em saida/L8-01.json, "resumo_apos_mescla")
    linha("FCGUIAS", CON=1, GUIA_P="G1", GUIA_S="G1", CONTA=800, SENHA_SUPLEMENTAR="S9",
          VALIDADE_SENHA_SUPLEMENTAR=datetime.date(2026, 4, 30), DATA_AUTORIZACAO_SUPLEMENTAR=datetime.date(2026, 3, 3),
          GUIA_ATRIBUIDA_OPERADORA_TISS="OP-1", **dict(gd, TP_GUIA_S="C"))
    linha("FCGUIAS", CON=2, GUIA_P="G7", GUIA_S="G7", CONTA=800,
          DATA_AUTORIZACAO_SUPLEMENTAR=datetime.date(2026, 1, 5), **gd)               # autorização antes: 4025
    linha("FCGUIAS", CON=2, GUIA_P="G2", GUIA_S="G2", CONTA=801, **gd)                 # mesmo número, outro convênio: 1062
    linha("FCGUIAS", CON=1, GUIA_P="G8", GUIA_S="G8", CONTA=800,
          **dict(gd, TP_GUIA="R", TP_GUIA_S="R", TIPO_CTA="I"))                          # guia de internação (R)
    linha("FCGUIAS", CON=1, GUIA_P="G9", GUIA_S="G9", CONTA=801, **dict(gd, TP_GUIA="X"))  # tipo sem par: 1048

    # condição de pagamento da nota de serviço (r3, correção): cadastro do produto; nome só de espaços: 1048
    for i, nome in ((1, "A vista"), (2, "30   dias"), (3, "   ")):
        linha("FCTPPGTONFSE", ID=i, NOME=nome)

    # abertura da conta na recepção (r3, correção): evento da linha do tempo da conta de FCCTAEXT pela chave
    # alternativa (registro, número): 5001/800 certa; 5002/801 login inexistente (usuário NULL, grava); 5009/999 sem
    # conta (1048); 5001/802 conta repetida em duas competências (pai_ambiguo, 1048)
    rc = dict(DT_FIM=datetime.date(1899, 12, 30), HR_FIM="0000", VALIDADE=0, HORAS="0015", ID_FACTASUS=1, CRM=1001,
              ID_TBCBOPRO=301, DATA=D0, CONV=1, ANOPRO=2026, MESPRO=3)
    for reg, conta, usu, ini in ((5001, 800.0, "fat.exemplo", D0), (5002, 801.0, "fantasma", None),
                                 (5009, 999.0, "fat.exemplo", D0), (5001, 802.0, "fat.exemplo", D0)):
        linha("RECONTAS", REG=reg, CONTA=conta, USUARIO=usu, DT_INICIO=ini, HR_INICIO="0830" if ini else None, **rc)

    # modelo de orçamento: 1 certo; 2 procedimento em duas tabelas; 3 sem nome; 4 nome repetido (código 1062)
    mo = dict(TIPO=1, SUBTIPO=0, ID_TBTIPOACOMOD=1, VALOR=D("1000.00"), PERC_ADM=D("10.00"), PERC_HOS=D("5.00"),
              V_ADM=D("100.00"), QTDE=D("1.00"))
    linha("FCORCPAD", CONV=1, PROCTO=30101, NOME="Modelo exemplo", PERCENTUAL_ACRESCIMO=D("2.50"), **mo)
    linha("FCORCPAD", CONV=1, PROCTO=30102, NOME="Modelo ambíguo", **mo)
    linha("FCORCPAD", CONV=2, PROCTO=30101, NOME=None, **mo)
    linha("FCORCPAD", CONV=2, PROCTO=30101, NOME="Modelo exemplo", **dict(mo, SUBTIPO=1))

    # itens (honorários) do orçamento: vêm ANTES do orçamento na ordem atual do mapa (dependência pedida)
    linha("FCORLAME", COD=1, PROCTO=30101, TIPO=1, SUBTIPO=0, VALOR=D("500.00"), QTDE=D("1.00"), CRM_TIT=1001,
          VLR_TIT=D("400.00"), CRM_ANES=1002, VLR_ANES=D("100.00"))
    linha("FCORLAME", COD=1, PROCTO=30102, TIPO=1, SUBTIPO=0, VALOR=D("80.00"))
    linha("FCORLAME", COD=77, PROCTO=30101, TIPO=1, SUBTIPO=0, VALOR=D("10.00"))

    # incidência do evento de repasse: 1 certa; 2 mesmo evento em outra empresa (1062); 3 natureza com duas
    # vigências; 4 natureza inexistente; 5 evento inexistente
    for ev, emp, nat in ((1, 1, 1000), (1, 2, 1000), (2, 1, 1200), (3, 1, 9999), (99, 1, 1000)):
        linha("RPEVENTOESOC", ID_RPEVENTO=ev, ID_TBEMPHOS=emp, ID_FPNATRUBRICA=nat, ID_FPRUBRICAINSS=11,
              ID_FPRUBRICAIRRF=12)

    # lançamentos de repasse: 101 e 102 criam o favorecido de cada profissional; 103 ADOTA o do profissional 1;
    # 104 inscrição sem profissional; 105 sem associação; 106 valor negativo (CHECK); 107 evento inexistente
    la = dict(EMPRESA=1, TIPO="M", COD_PRESTADOR=1, ID_RPEVENTO=1, EMAIL_ENVIADO="N", IND_DECIMO_TERCEIRO="N",
              REFERENTE="Produção exemplo", OBS="Observação ação")
    for i, data, valor, extra in ((101, datetime.date(2026, 3, 10), D("100.00"), {}),
                                  (102, datetime.date(2026, 2, 5), D("50.00"), {"PERC": D("10.00")}),
                                  (103, datetime.date(2026, 3, 20), D("70.00"), {"IND_DECIMO_TERCEIRO": "S"}),
                                  (104, datetime.date(2026, 3, 1), D("10.00"), {}),
                                  (105, datetime.date(2026, 3, 1), D("10.00"), {"TIPO": "E"}),  # empresa
                                  (106, datetime.date(2026, 3, 1), D("-10.00"), {}),
                                  (107, datetime.date(2026, 3, 1), D("10.00"), {"ID_RPEVENTO": 99})):
        linha("RPLANEVE", **dict(la, ID_RPLANEVE=i, DATA=data, VALOR=valor, **extra))

    # composição da base: 1 certa; 2 alíquota fora de 0..100; 3 lançamento recusado; 4 sem valor; 5 sem lançamento
    for i, lanc, aliq, valor in ((1, 101, D("11.00"), D("11.00")), (2, 101, D("150.00"), D("5.00")),
                                 (3, 104, D("11.00"), D("1.10")), (4, 102, D("11.00"), None),
                                 (5, None, D("11.00"), D("1.00"))):
        linha("RPLANEVE_COMPOSICAOBASE", ID=i, ID_RPLANEVE=lanc, PARCELA=1, BASE_CALCULO=D("100.00"), ALIQUOTA=aliq,
              VALOR=valor, VALOR_BRUTO=D("100.00"), ID_EVENTO=1)

    # R5 (ADR 0006): empresas de auditoria (lista de nomes sem CNPJ) -> opções de um parâmetro de lista; 3 só
    # espaços (1048)
    for i, nome in ((1, "Auditoria Exemplo Um"), (2, "Auditoria  Exemplo Dois"), (3, "   ")):
        linha("FCEMPAUDPLANSERV", ID=i, NOME=nome)
    # r6: códigos de procedimento de uma operadora -> opções de um parâmetro de lista; sequência pela chave na
    # tabela inteira (códigos grandes não cabem em SMALLINT); 30000003 sem nome (1048)
    for cod, nome in ((30000001, "Procedimento exemplo A"), (30000002, "Procedimento  exemplo B"), (30000003, "   ")):
        linha("FCPROCUNIBHMED", CODIGO=cod, NOME=nome)
    # R5: numeração do RPA: o último número (41) vira o próximo da sequência (42), série como prefixo
    linha("RPPARAM", EMPRESA=1, SERIE_RPA="A", NUMERO_RPA=41, HAB_RET_IRRF="S", HABILITA_DATA_PREVISAO="N")

    return ESPERADO


ESPERADO = {
    "FCTPMOTGLOSA": {"gravados": 3, "pendencias": {"restricao_destino_1048": 2}},
    "RPDEDUTIVEL": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
    # login e mês 13: usuário e competência nulos, recusa
    "FAPARUSU": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "valor_fora_do_dominio": 1,
                                               "restricao_destino_1048": 1, "adotado_existente": 1}},
    "FCPARUSU": {"gravados": 3, "pendencias": {"adotado_existente": 1}},
    "FIPARUSU": {"gravados": 1, "pendencias": {"restricao_destino_1048": 1}},
    # vigência sem fonte em toda linha; inscrição sem profissional (CHECK); convênio 9 e código vazio (NOT NULL)
    "FCCODCON": {"gravados": 2, "pendencias": {"vigencia_sem_fonte": 4, "valor_fora_do_dominio": 1,
                                               "pai_inexistente": 2, "restricao_destino_4025": 1,
                                               "restricao_destino_1048": 1}},
    "FCCPSCON": {"gravados": 2, "pendencias": {"vigencia_sem_fonte": 3, "valor_presumido": 3,
                                               "adotado_existente": 1, "restricao_destino_1048": 1}},
    "FCFECMES": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_4025": 1}},
    # situação presumida em toda linha; sem cadastro (nome fica); CPF inválido; sem data; parcelado em 1 (CHECK)
    "FCORCAME": {"gravados": 2, "pendencias": {"valor_presumido": 4, "pai_inexistente": 1, "documento_invalido": 1,
                                               "restricao_destino_1048": 1, "restricao_destino_4025": 1}},
    # pares por dia (gravados = itens): seis dias da tabela 10; 20 sem dia; 99 tabela inexistente; 30 fim antes do início
    "FCHORATE": {"gravados": 6, "pendencias": {"sem_item_a_gravar": 1, "pai_inexistente": 1,
                                               "restricao_destino_1048": 1, "restricao_destino_4025": 1}},
    # r3 (correção), ordem nova (dependências declaradas: a conta carrega antes): tipo pelo de-para (S, R; X sem par:
    # valor_fora_do_dominio e 1048); conta repetida (pai_ambiguo nas cinco colunas que a leem, paciente NOT NULL);
    # convênio inexistente; o mesmo número no MESMO convênio ADOTA a guia gravada; em OUTRO convênio, 1062 (modelo
    # pedido); autorização antes da solicitação (CHECK)
    "FCGUIAS": {"gravados": 6, "pendencias": {"adotado_existente": 1, "pai_ambiguo": 5, "pai_inexistente": 1,
                                              "valor_fora_do_dominio": 1, "restricao_destino_1048": 3,
                                              "restricao_destino_4025": 1}},
    # ordem nova: o procedimento (TBPROCTO) carrega antes: 1 certo; código em duas tabelas (pai_ambiguo, 1048); sem
    # nome (1048); nome repetido (código derivado repetido, 1062)
    "FCORCPAD": {"gravados": 1, "pendencias": {"pai_ambiguo": 1, "restricao_destino_1048": 2,
                                               "restricao_destino_1062": 1}},
    # ordem nova: o orçamento e o procedimento carregam antes: 1 certo; procedimento ambíguo (CHECK de alvo, 4025);
    # orçamento 77 inexistente (1048)
    "FCORLAME": {"gravados": 1, "pendencias": {"pai_ambiguo": 1, "pai_inexistente": 1, "restricao_destino_1048": 1,
                                               "restricao_destino_4025": 1}},
    # tabela 3 (própria, marcas F): grava quando o filtro do item (TBMATMED, L8-03) aceita F como o do preço; enquanto
    # o do item aceitar só N, o item é recusado (licenca_nao_comprovada) e o preço fica pai_pendente (pedido r4_marca_TF)
    "FCREFUND": {"gravados": 3 if _ITEM_ACEITA_F else 2,
                 "pendencias": dict({"adotado_existente": 1, "restricao_destino_4025": 2, "valor_fora_do_dominio": 1,
                                     "pai_inexistente": 1, "restricao_destino_1048": 1, "licenca_nao_comprovada": 1},
                                    **({} if _ITEM_ACEITA_F else {"pai_pendente": 1}))},
    "FCTPPGTONFSE": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
    # abertura da conta: login inexistente (grava sem usuário); conta inexistente e conta ambígua (1048)
    "RECONTAS": {"gravados": 2, "pendencias": {"pai_inexistente": 2, "pai_ambiguo": 1, "restricao_destino_1048": 2}},
    "RPEVENTOESOC": {"gravados": 1, "pendencias": {"vigencia_sem_fonte": 5, "restricao_destino_1062": 1,
                                                   "pai_ambiguo": 1, "codigo_inexistente_destino": 1,
                                                   "pai_inexistente": 1, "restricao_destino_1048": 3}},
    # r3 (correção): uma presunção por linha (tipo do favorecido); o tipo do lançamento vem do de-para (M, E) e a
    # situação da evidência do RPA (101 e 103 aprovados; os outros cinco sem RPA: pai_inexistente e o padrão aberto);
    # 103 ADOTA o favorecido do profissional 1; sem profissional (104; 105 empresa: favorecido exige o titular, modelo
    # pedido), valor negativo (CHECK) e evento inexistente (107)
    "RPLANEVE": {"gravados": 3, "pendencias": {"valor_presumido": 7, "adotado_existente": 1, "pai_inexistente": 10,
                                               "restricao_destino_1048": 1, "restricao_destino_4025": 3}},
    "RPLANEVE_COMPOSICAOBASE": {"gravados": 2, "pendencias": {"valor_fora_do_dominio": 1, "pai_pendente": 1,
                                                              "restricao_destino_1048": 2}},
}

# rodada 5 (ADR 0007, item 20): a adoção MESCLA; o conflito mantém o destino e guarda o valor da origem (pendência
# baixa, uma por linha adotada com valor diferente)
for _t in ("FAPARUSU", "FCCPSCON", "FCPARUSU", "RPLANEVE"):
    ESPERADO[_t]["pendencias"]["mescla_conflito_origem_guardada"] = 1
# R5 (ADR 0006): passam a carregar
ESPERADO.update({
    # opções do parâmetro de lista das empresas de auditoria: 3 só espaços (1048); módulo e definição criados pela
    # 1ª linha e adotados pela 2ª
    "FCPROCUNIBHMED": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1, "adotado_existente": 3}},
    "FCEMPAUDPLANSERV": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1, "adotado_existente": 2}},
    # numeração do RPA: uma sequência (item desdobrado), inativa e presumida
    "RPPARAM": {"gravados": 1, "pendencias": {"valor_presumido": 1}},
    # complemento do lançamento: 101, 102 e 103 gravam; 104, 106 e 107 têm o lançamento recusado (pai_pendente);
    # (a inscrição 303 do lançamento 104 nem chega a ser procurada: o pai recusado decide antes)
    "RPLANEVE_TBCBOPRO": {"gravados": 3, "pendencias": {"pai_pendente": 3}},
})
