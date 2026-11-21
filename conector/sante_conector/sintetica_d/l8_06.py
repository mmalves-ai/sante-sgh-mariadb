"""Fatia L8-06 (faturamento e restantes, módulo FAT): imagem sintética das tabelas carregadas e anomalias.

Dados 100% falsos (endereços, logins, senhas, nomes e códigos inventados). As tabelas novas desta rodada são criadas
com as colunas do dicionário do mapa (`mapa/colunas.tsv`), todas anuláveis menos a chave. TBCBOPRO entra SÓ para a
leitura da referência encadeada inscrição > profissional (o esperado dela não é conferido aqui).

Anomalias cobertas:
- TBTISSWEBSERV -> endpoint_tiss_fonte_pagadora: endereço só de espaços (CHECK, 4025); fonte nunca vista (1048);
  transação nunca vista; autenticação S/N em qualquer caixa, fora do domínio e nula; login e senha nunca lidos;
- FCFAIPAC -> conta_hospitalar_periodo: dois períodos da mesma conta com o mesmo SEQ em tipos diferentes (a sequência
  é 1..n por conta), fim antes do início (CHECK), sem fim (1048), conta nunca vista (pai_inexistente + 1048);
- FCIRREGULARID -> pendencia_conta: resolvida presumida, sem fim (CHECK da resolvida, 4025), conta e tipo nunca
  vistos (pai_inexistente + 1048);
- TBREPGER -> regra_repasse + regra_repasse_item: 0 = todos (sem pendência), percentual e valor fixo, nenhum dos dois
  (CHECK), evento nunca visto (1048), beneficiário e escopo fora do domínio (padrão com pendência), fonte nunca vista
  (fica NULL), hora inválida com a outra ponta preenchida (CHECK do horário);
- TBREPGER_TBCBOPRO -> regra_repasse_profissional: profissional pela cadeia inscrição > profissional, vigência pela
  data da regra, profissional nunca visto (1048), regra recusada (pai_pendente), regra nunca vista;
- HTPROCTO -> trilha_auditoria: retrato da versão anterior, procedimento nunca visto (fica NULL), sem data (1048);
- FCCTAEXT_FCTISSLOTEPROT -> lote_tiss_conta: conta nunca vista (1048);
- critérios da regra (L8-06, revisão): profissional pelo código do prestador (TBCBOPRO.COD), tipo de lançamento,
  ato, local e cooperativa não carregada (pai_inexistente); credencial do endpoint com a segunda
  transação da mesma fonte adotando a credencial (adotado_existente) e a senha esperando o cofre.
Bloqueadas (sem regra do motor) e descartadas ficam fora da imagem (lista em `docs/obra/fatias/f4/saida/L8-06.md`).
"""
import datetime
from decimal import Decimal as D
from pathlib import Path

from .. import carga_mapa, sentinela

_MAPA = Path(__file__).resolve().parents[2] / "mapa"

# pedido 12 (L8-06.json): referência obrigatória declarada na via; recusa a linha cujo pai nunca foi visto
REFERENCIA_OBRIGATORIA = hasattr(carga_mapa, "VIA_OBRIGATORIA")
# pedido 13 (L8-06.json): hora_hhmm ainda não decodifica o texto em bytes da origem (VARCHAR 'HHMM' vira hora_invalida)
HHMM_TEXTO = sentinela.aplicar("hora_hhmm", b"0700")[1] is None


def _dicionario():
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


def _forma(forma, regra):
    if forma == "BLOB":
        return "BLOB SUB_TYPE %d" % (1 if regra == "texto_longo" else 0)
    return "DOUBLE PRECISION" if forma == "DOUBLE" else forma


def _create(t):
    ch = _CHAVES.get(t) or []
    partes = ["%s %s%s" % (c, _forma(f, r), " NOT NULL" if c in ch else "") for c, f, r in _COLS[t]]
    if ch:
        partes.append("PRIMARY KEY (%s)" % ", ".join(ch))
    return "CREATE TABLE %s (%s);" % (t, ", ".join(partes))


def _linha(t, **v):
    return [v.get(c) for c, _, _ in _COLS[t]]


NOVAS = ("FCFAIPAC", "FCIRREGULARID", "TBREPGER", "TBREPGER_TBCBOPRO", "HTPROCTO", "FCCTAEXT_FCTISSLOTEPROT")
CADEIA = ("TBCBOPRO",)  # de outra fatia: só lida pela referência encadeada e pela chave alternativa COD
DDL = """
CREATE TABLE TBTISSWEBSERV (ID_TBCONVEN SMALLINT NOT NULL, ID_TBTISSSCHEMA SMALLINT NOT NULL,
  URL VARCHAR(150) NOT NULL, LOCAL_ARQ_XML_RETORNO VARCHAR(100) NOT NULL, LOGIN_PRESTADOR VARCHAR(30),
  SENHA_PRESTADOR VARCHAR(64), SENHA_PRESTADOR_PADRAO_HASH_MD5 CHAR(1), CTR_AUT_TP_BASIC CHAR(1),
  TIME_RESPOSTA_WEBSERV TIME, PRIMARY KEY (ID_TBCONVEN, ID_TBTISSSCHEMA));
""" + "\n".join(_create(t) for t in NOVAS + CADEIA) + "\n"
# pais de fora da fatia (ou bloqueados nela), registrados como já carregados
PAIS_EXTERNOS = {"TBCONVEN": ["1", "2", "3"], "TBTISSSCHEMA": ["1", "2"], "FCCTAEXT": ["10", "11", "12"],
                 "TBIRREGULARID": ["1", "2"], "TBESPEC": ["1"], "TBUNIDAD": ["1"], "TBCENCUS": ["1"],
                 "RPEVENTO": ["1"], "TBPROFIS": ["1", "2"], "TBPROCTO": ["1", "2"], "FCTISSLOTEPROT": ["1", "2"],
                 "TBTPLANC": ["1", "2"], "TBGRAUPARTPROC": ["1"], "TBLOCAL": ["1"]}  # TBCOOPER fica de fora: bloqueada
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')")
CARREGADAS = ("TBTISSWEBSERV",) + NOVAS
DT = datetime.datetime


def linhas(r, ins):
    h = None  # TIME_RESPOSTA_WEBSERV não declarado (pedido 9); o gerador comum não cita datetime.time
    for x in [(1, 1, "https://operadora-um.exemplo.invalid/tiss/lote", "S"),
              (1, 2, "https://operadora-um.exemplo.invalid/tiss/elegibilidade", None),  # nulo: nenhuma
              (2, 1, "  https://operadora-dois.exemplo.invalid/ws  ", "X"),            # fora do domínio
              (2, 2, "https://operadora-dois.exemplo.invalid/ws2", "s"),               # minúsculo: basica
              (3, 1, "   ", "S"),                                            # sem endereço: CHECK recusa
              (3, 9, "https://operadora-tres.exemplo.invalid/ws9", "n"),    # transação nunca vista
              (3, 8, "https://operadora-tres.exemplo.invalid/ws8", "N"),    # outra transação nunca vista, mesma fonte
              (88, 1, "https://operadora-sem-cadastro.exemplo.invalid/ws", "N")]:  # fonte nunca vista: recusa
        ins("TBTISSWEBSERV", [x[0], x[1], x[2], "C:\\retorno\\exemplo", "prestador%d" % r.randint(1, 9),
                              "senha-falsa-%d" % r.randint(100, 999), "N", x[3], h])
    # períodos da conta: (conta, tipo, seq, início, fim)
    for c, tl, s, i, f in [(10, 1, 1, DT(2025, 3, 2, 8), DT(2025, 3, 5, 10)),
                           (10, 2, 1, DT(2025, 3, 6), DT(2025, 3, 10)),       # mesmo SEQ, outro tipo: sequência 2
                           (11, 1, 1, DT(2025, 4, 9), DT(2025, 4, 1)),        # fim antes do início: CHECK
                           (12, 1, 1, DT(2025, 5, 1), None),                  # sem fim: 1048
                           (99, 1, 1, DT(2025, 6, 1), DT(2025, 6, 2))]:       # conta nunca vista
        ins("FCFAIPAC", _linha("FCFAIPAC", ID_FCCTAEXT=c, TIPO_LAN=tl, SEQ=s, DATAI=i, HORAI="0800", DATAF=f))
    # pendências da conta: (conta, tipo, início, fim)
    for c, tp, i, f in [(10, 1, DT(2021, 1, 5, 10), DT(2021, 1, 6)),
                        (11, 2, DT(2021, 2, 1), DT(2021, 2, 3)),
                        (12, 1, DT(2021, 3, 1), None),        # sem fim: resolvida sem resolução, CHECK recusa
                        (99, 1, DT(2021, 4, 1), DT(2021, 4, 2)),   # conta nunca vista
                        (10, 9, DT(2021, 5, 1), DT(2021, 5, 2))]:  # tipo nunca visto
        ins("FCIRREGULARID", _linha("FCIRREGULARID", ID_FCCTAEXT=c, ID_TBIRREGULARID=tp, DATA_HORA_INICIO=i,
                                    DATA_HORA_FIM=f, IRREGULARIDADE="Falta documento de exemplo\nlinha 2"))
    base = dict(DATA=datetime.date(2024, 1, 1), MED_PRS="M", COD=90001, CONV=1, TIPO_CTA="I", TIPO_LAN=1, TIPO_REPASSE=1,
                UNID=1, CDC=1, ATO=0, LOCAL=0, ESP=1, PROCTO_INI=10101012, SEQ=1, QTDE=D("0"), QTDE_FIN=D("0"),
                VALOR=D("0"), HORA_INI="0700", HORA_FIN="1900", PERC=D("70"), INCIDE_FILME="S", PROCTO_FIM=0,
                ID_RPEVENTOS=1, GER_VLR_INTERVALO="N", PERC_FERIADO=D("10"), PERC_FIM_SEMANA=D("0"))
    for i, mud in [(1, dict(ATO=1, LOCAL=1, COOP=3)),                      # critérios; cooperativa não carregada
                   (2, dict(MED_PRS="P", COD=0, TIPO_LAN=0, CONV=0, TIPO_CTA="A", ESP=0, UNID=0, CDC=0, PERC=D("0"), VALOR=D("150"),
                            HORA_INI=None, HORA_FIN=None, INCIDE_FILME="N")),            # 0 = todos; valor fixo
                   (3, dict(PERC=D("0"), VALOR=D("0"))),                                 # nenhum dos dois: CHECK
                   (4, dict(ID_RPEVENTOS=99)),                                           # evento nunca visto
                   (5, dict(MED_PRS="X", TIPO_CTA="Z", CONV=77, COD=55)),               # fora do domínio; prestador nunca visto
                   (6, dict(HORA_INI="2500"))]:                                          # hora inválida: CHECK
        v = dict(base, **mud)
        ins("TBREPGER", _linha("TBREPGER", ID=i, **dict(v, DATA=v["DATA"] + datetime.timedelta(days=i))))
    for i, prof in [(1, 1), (2, 2), (3, 88)]:  # inscrição 3 aponta profissional nunca visto
        ins("TBCBOPRO", _linha("TBCBOPRO", ID=i, ID_TBPROFIS=prof, UF="ZZ", COD=90000 + i, ATIVO="S"))
    for reg, cbo in [(1, 1), (2, 2), (5, 3), (3, 1), (40, 2)]:  # 5: profissional nunca visto; 3: regra recusada
        ins("TBREPGER_TBCBOPRO", _linha("TBREPGER_TBCBOPRO", ID_TBREPGER=reg, ID_TBCBOPRO=cbo))
    for i, pr, q in [(1, 1, DT(2023, 5, 1, 9)), (2, 2, DT(2023, 6, 1)), (3, 99, DT(2023, 7, 1)), (4, 1, None)]:
        ins("HTPROCTO", _linha("HTPROCTO", ID=i, ID_TBPROCTO=pr, DATA_HORA_HISTORICO=q, NOME="Procedimento antigo %d" % i))
    for c, lote in [(10, 1), (11, 1), (10, 2), (99, 1)]:
        ins("FCCTAEXT_FCTISSLOTEPROT", [c, lote])
    gravados = 4 if REFERENCIA_OBRIGATORIA else 6
    return {
        # pendência por linha e destino: fonte nunca vista e autenticação fora do domínio contam no endpoint e na
        # credencial; senha e vigência em toda linha; a segunda transação da mesma fonte adota a credencial
        "TBTISSWEBSERV": {"gravados": gravados, "pendencias": {"restricao_destino_4025": 1,
                                                               "restricao_destino_1048": 1, "pai_inexistente": 4,
                                                               "valor_fora_do_dominio": 2,
                                                               "segredo_aguarda_cofre": 8, "vigencia_sem_fonte": 8,
                                                               "adotado_existente": 2 if REFERENCIA_OBRIGATORIA else 3}},
        "FCFAIPAC": {"gravados": 2, "pendencias": {"restricao_destino_4025": 1, "restricao_destino_1048": 2,
                                                   "pai_inexistente": 1}},
        "FCIRREGULARID": {"gravados": 2, "pendencias": {"valor_presumido": 5, "restricao_destino_4025": 1,
                                                        "restricao_destino_1048": 2, "pai_inexistente": 2}},
        # com o pedido 13: a hora 2500 é inválida e o CHECK do horário recusa a linha 6; antes dele toda hora em
        # texto vira NULL com hora_invalida (10 horas preenchidas) e a linha 6 grava sem horário
        "TBREPGER": {"gravados": 3 if HHMM_TEXTO else 4,
                     "pendencias": {"restricao_destino_4025": 2 if HHMM_TEXTO else 1, "restricao_destino_1048": 1,
                                    "pai_inexistente": 5, "valor_fora_do_dominio": 2,
                                    "hora_invalida": 1 if HHMM_TEXTO else 10}},
        "TBREPGER_TBCBOPRO": {"gravados": 2, "pendencias": {"restricao_destino_1048": 2, "pai_inexistente": 3,
                                                            "pai_pendente": 1}},
        "HTPROCTO": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}},
        "FCCTAEXT_FCTISSLOTEPROT": {"gravados": 3, "pendencias": {"pai_inexistente": 1,
                                                                  "restricao_destino_1048": 1}},
    }
