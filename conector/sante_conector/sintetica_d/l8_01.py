"""Fatia L8-01 (faturamento e restantes, módulo FAT), rodada de cobertura total: forma das 23 tabelas da origem e
anomalias, com dados 100% falsos.

Carregadas pelo mapa (colunas.d/L8-01.tsv), 9: grupos de motivo de glosa, tipos de dedução do IRRF, competência de
trabalho por módulo (FA/FC/FI, login repetido ADOTA a já gravada), código do profissional e do hospital no convênio
(um código do hospital por convênio: o 2º ADOTA o 1º), fechamento da competência e orçamento particular (forma de
pagamento por de-para de valores). Descartes (sem_carga.tsv) e as 9 sem mecanismo (FCHORATE, FCGUIAS, FCORCPAD,
FCORLAME; FCPORANE e RICGUIAS esperam a regra de DATE em destino DATETIME; FCCRECUN espera o id do tipo de conta;
FCDIAEXT e FCDIAINT esperam a referência por chave alternativa composta e a conta carregada) entram só com a forma ou
com as linhas da declaração pronta, para provar que nada é gravado.
Referências pela ORIGEM: a conta pela chave alternativa COD (FCCTAEXT, RICONTAS) e a carteira lida da conta
(encadeada terminada em coluna); o profissional pela inscrição no conselho (TBCBOPRO -> TBPROFIS); o paciente da guia
pelo atendimento e prontuário (RECADATE -> RICADPAC.PRONT); a conta da guia pela chave composta (RICONTAS(REG,CONTA)).
As intermediárias entram com TODAS as colunas do dicionário (`conector/mapa/colunas.tsv`); os pais de fora da fatia
são PAIS_EXTERNOS.
Anomalias: login sem usuário, login repetido (adotado_existente), 2º código do hospital no mesmo convênio
(adotado_existente), parcelado com uma parcela (CHECK 4025), mês 13, competência vazia, registro repetido (1062), profissional da inscrição
inexistente (CHECK 4025 e NOT NULL), convênio inexistente, código vazio, valor negativo, conta com número repetido
(pai_ambiguo), conta sem carteira, fechamento sem data (CHECK 4025), CPF inválido, paciente sem cadastro, data vazia,
bytes CP1252 e nome só de espaços.
"""
import csv
import datetime
import os
from decimal import Decimal as D

FATIA = ("FAPARUSU", "FCCODCON", "FCCPSCON", "FCCRECUN", "FCDIAEXT", "FCDIAINT", "FCEMPAUDPLANSERV", "FCFECMES",
         "FCGUIAS", "FCHORATE", "FCORCAME", "FCORCPAD", "FCORLAME", "FCPARUSU", "FCPORANE", "FCPROCUNIBHMED",
         "FCREFUND", "FCTPMOTGLOSA", "FCTPPGTONFSE", "FIPARUSU", "RECONTAS", "RICGUIAS", "RPDEDUTIVEL")
INTERMEDIARIAS = ("FCCTAEXT", "RICONTAS", "RECADATE", "RICADPAC", "TBCBOPRO")
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
                 "TBTIPOACOMOD": ["1"], "TBCTRTHM": ["10", "20"], "RECADATE": ["5001", "5002"],
                 "RICADPAC": ["701", "702"], "FCCTAEXT": ["1", "2", "3", "4"], "RICONTAS": ["5001|1"]}
# único estabelecimento do cliente de exemplo (o @estabelecimento resolve por ele)
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento)")

T0 = datetime.datetime(2026, 3, 2, 8, 30)
D0 = datetime.date(2026, 3, 2)


def linhas(r, ins):
    def linha(t, **v):
        faltam = set(v) - {c for c, _, _ in COLS[t]}
        if faltam:
            raise KeyError("%s: colunas fora do dicionário: %s" % (t, sorted(faltam)))
        ins(t, [v.get(c) for c, _, _ in COLS[t]])

    # intermediárias (forma completa do dicionário, só as colunas usadas preenchidas)
    for i, prof in ((301, 1), (302, 2), (303, 9)):                      # 303 -> profissional 9 inexistente
        linha("TBCBOPRO", ID=i, ID_TBPROFIS=prof, ID_TBCBOSUS=1, UF="SP", COD=7000 + i, VINC_EMPR="N")
    for i, cod, cart in ((1, 800, "CART-800"), (2, 801, None), (3, 802, "CART-802"), (4, 802, "CART-802B")):
        linha("FCCTAEXT", ID=i, ANOPRO=2026, MESPRO=3, TIPO_CTA="E", COD=cod, MATRICULA=cart)  # 802 repetido
    linha("RICONTAS", REG=5001, CONTA=1.0, COD=900, MATRIC="MAT-900", ANOPRO=2026, MESPRO=3)
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
    linha("FCCRECUN", ID_TBCBOPRO=301, CON=1, CRM=1001, CONTAS="T")
    linha("FCCRECUN", ID_TBCBOPRO=303, CON=2, CRM=1003, CONTAS="I")                    # sem profissional: 1048

    # segurado na conta
    seg = dict(VAL_CAR=datetime.date(2027, 1, 31), CARGO="ANALIS", PADRAO=12, UND_ADM="Secretaria exemplo",
               AFINIDADE="Filho", N_ORDEM="01", CLASSE="A", EST_CIVIL="S")
    linha("FCDIAEXT", ANOPRO=2026, MESPRO=3, COD=800, DIAB="texto clínico falso", **seg)
    linha("FCDIAEXT", ANOPRO=2026, MESPRO=3, COD=801)                                   # conta sem carteira
    linha("FCDIAEXT", ANOPRO=2026, MESPRO=3, COD=802)                                   # número repetido
    linha("FCDIAEXT", ANOPRO=2026, MESPRO=3, COD=999)                                   # conta inexistente
    linha("FCDIAINT", ANOPRO=2026, MESPRO=3, COD=900, DIAG="texto clínico falso", **seg)
    linha("FCDIAINT", ANOPRO=2026, MESPRO=3, COD=901)                                   # conta inexistente

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

    # valor do porte anestésico
    linha("FCPORANE", TAB=10, QTDE=1.5, PMEDICO="1A", VALOR=D("100.1234"), DATA_PORTE=D0, PORTE="1")
    linha("FCPORANE", TAB=20, DATA_PORTE=D0, PORTE="2")                                 # sem valor: 1048
    linha("FCPORANE", TAB=99, VALOR=D("50.0000"), DATA_PORTE=D0, PORTE="3")            # tabela inexistente

    # guias da internação
    g = dict(CONV=1, DATASOLICIT=D0, DATAENTREGA=datetime.date(2026, 3, 3), SENHA="S123", DIARIAS_SOLICIT=3,
             DIARIAS_AUTOR=2, USUARIO="fat.exemplo", INDICACAO_CLINICA="indicação falsa", ID_TBCBOPRO_SOLICITANTE=301)
    linha("RICGUIAS", REG=5001, CONTA=1.0, GUIA="G001", **g)
    linha("RICGUIAS", REG=5002, CONTA=2.0, GUIA="G002", **dict(g, CONV=2, ID_TBCBOPRO_SOLICITANTE=303))
    linha("RICGUIAS", REG=5001, CONTA=1.0, GUIA="G001", **g)                            # número repetido: 1062
    linha("RICGUIAS", REG=5003, GUIA="G004", **g)                                       # atendimento inexistente
    linha("RICGUIAS", REG=5001, CONTA=1.0, **g)                                         # sem número: 1048

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
}
# FCPORANE e RICGUIAS (data DATE em destino DATETIME), FCCRECUN (id do tipo de conta), FCDIAEXT e FCDIAINT (chave
# alternativa composta da conta) entram na imagem com as anomalias da declaração pronta, sem esperado: nada é gravado
# até a regra existir
