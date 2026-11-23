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
Rodada 3: FCLANEXT com glosa, recebimento e recurso (trilha do item, opcional), técnica, nota e autor; contas, segurado e guias da internação, lote TISS, vigências no acordo migrado, itens
da conta e complementos, produção do repasse e histórico da auditoria (`_rodada3`). Sequencial do item na guia (FCLANEXTSEQITEM) e histórico do vínculo de mat/med (TBHISTBR) como trilha.
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


NOVAS = ("FCFAIPAC", "FCIRREGULARID", "TBREPGER", "TBREPGER_TBCBOPRO", "HTPROCTO", "FCTISSLOTEPROT",
         "FCCTAEXT_FCTISSLOTEPROT", "RICONTAS", "FCDIAINT", "RICGUIAS", "TBHISTTABDTH", "TBHISTTABMM",
         "TBHISTTABTHME", "TBHISTTABTHMI", "FCLANEXT", "REPROEXT", "RIPROEXT", "FCINTEGRPA", "FCLANAUD",
         "FCLANEXTSEQITEM", "TBHISTBR")
# de outras fatias: só lidas pelas referências encadeadas e chaves alternativas (inscrição > profissional,
# internação > atendimento/prontuário/fonte, prontuário > paciente, configuração TISS da fonte)
CADEIA = ("TBCBOPRO", "RICADINT", "RICADPAC", "TBTISS")
DDL = """
CREATE TABLE TBTISSWEBSERV (ID_TBCONVEN SMALLINT NOT NULL, ID_TBTISSSCHEMA SMALLINT NOT NULL,
  URL VARCHAR(150) NOT NULL, LOCAL_ARQ_XML_RETORNO VARCHAR(100) NOT NULL, LOGIN_PRESTADOR VARCHAR(30),
  SENHA_PRESTADOR VARCHAR(64), SENHA_PRESTADOR_PADRAO_HASH_MD5 CHAR(1), CTR_AUT_TP_BASIC CHAR(1),
  TIME_RESPOSTA_WEBSERV TIME, PRIMARY KEY (ID_TBCONVEN, ID_TBTISSSCHEMA));
""" + "\n".join(_create(t) for t in NOVAS + CADEIA) + "\n"
# pais de fora da fatia (ou bloqueados nela), registrados como já carregados
PAIS_EXTERNOS = {"TBCONVEN": ["1", "2", "3"], "TBTISSSCHEMA": ["1", "2"], "FCCTAEXT": ["10", "11", "12"],
                 "TBIRREGULARID": ["1", "2"], "TBESPEC": ["1"], "TBUNIDAD": ["1"], "TBCENCUS": ["1"],
                 "RPEVENTO": ["1"], "TBPROFIS": ["1", "2"], "TBPROCTO": ["1", "2"],
                 "TBTPLANC": ["1", "2"], "TBGRAUPARTPROC": ["1"], "TBLOCAL": ["1"],  # TBCOOPER fica de fora
                 "ATCABECATEND": ["7001", "7002"], "RICADPAC": ["1", "2"], "TBUSERS": ["usuario.exemplo"],
                 "TBCTRDTH": ["1"], "TBCTRMEM": ["1"], "TBCTRTHM": ["1", "2"], "FCCTAAUD": ["2025|3|E|10"],
                 # diária 5 com o item faturável secundário já gravado (pedido à L8-05); a 6 sem ele
                 "TBTABDTH": ["5", "5/item_faturavel", "6"]}
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
# e os catálogos oficiais usados (papel do carregador oficial): versão TISS 3.05.00 de troca e o termo '1' da
# terminologia TISS 48 (técnica utilizada); o termo '5' fica ausente
PREPARO_DESTINO = ";\n".join([
    "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
    " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')",
    "INSERT INTO versao_padrao_tiss (id, codigo_tiss, componente, descricao, vigencia_inicio, versao_fonte, criado_em)"
    " VALUES (31, '3.05.00', 'troca', 'Versão de exemplo', '2016-01-01', 'exemplo', UTC_TIMESTAMP(3)),"
    " (32, '3.05.00', 'monitoramento', 'Versão de exemplo', '2016-01-01', 'exemplo', UTC_TIMESTAMP(3))",
    "INSERT INTO terminologia (id, codigo, nome, tipo, numero_tabela_tiss, criado_em) VALUES (41, 'tiss48',"
    " 'Técnica utilizada', 'dominio_tiss', '48', UTC_TIMESTAMP(3))",
    "INSERT INTO termo_terminologia (id, terminologia_id, codigo_termo, descricao, criado_em) VALUES"
    " (51, 41, '1', 'Termo de exemplo', UTC_TIMESTAMP(3))",
    # função da equipe TITULAR (tipo de profissional 1, carregado na L8-05): a produção de repasse a procura pelo
    # código (C11)
    "INSERT INTO funcao_equipe_cobranca (codigo, descricao, tipo_funcao, criado_em) VALUES ('tipo_prof_1',"
    " 'Titular de exemplo', 'outro', UTC_TIMESTAMP(3))",
    # motivo de glosa oficial '1001' (o 9999 fica ausente)
    "CREATE TABLE IF NOT EXISTS motivo_glosa (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo_tuss VARCHAR(10)"
    " NOT NULL, descricao VARCHAR(500) NOT NULL, UNIQUE KEY uq_motivo_glosa_codigo_tuss (codigo_tuss));"
    " INSERT INTO motivo_glosa (id, codigo_tuss, descricao) VALUES (61, '1001', 'Motivo de exemplo')",
    # catálogos-base que a carga da internação (RICADINT, lida aqui pelas cadeias) procura pelo código
    "CREATE TABLE IF NOT EXISTS carater_admissao (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(30)"
    " NOT NULL, UNIQUE KEY uq_carater_admissao_codigo (codigo)); INSERT INTO carater_admissao (codigo, descricao,"
    " criado_em) SELECT c, c, UTC_TIMESTAMP(3) FROM (SELECT 'eletiva' c UNION ALL SELECT 'urgencia' UNION ALL"
    " SELECT 'emergencia') s",
    "CREATE TABLE IF NOT EXISTS modalidade_internacao (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo"
    " VARCHAR(30) NOT NULL, UNIQUE KEY uq_modalidade_internacao_codigo (codigo)); INSERT INTO modalidade_internacao"
    " (codigo, descricao, criado_em) VALUES ('clinica', 'Clínica', UTC_TIMESTAMP(3))"])
CARREGADAS = ("TBTISSWEBSERV",) + NOVAS
DA = datetime.date
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
    novas = _rodada3(ins)
    gravados = 4 if REFERENCIA_OBRIGATORIA else 6
    return dict(novas, **{
        # pendência por linha e destino: fonte nunca vista e autenticação fora do domínio contam no endpoint e na
        # credencial; senha e vigência em toda linha; a segunda transação da mesma fonte adota a credencial
        "TBTISSWEBSERV": {"gravados": gravados, "pendencias": {"restricao_destino_4025": 1,
                                                               "restricao_destino_1048": 1, "pai_inexistente": 4,
                                                               "valor_fora_do_dominio": 2,
                                                               "segredo_aguarda_cofre": 8, "vigencia_sem_fonte": 8,
                                                               "adotado_existente": 2 if REFERENCIA_OBRIGATORIA else 3,
                                                               # ADR 0007 (20): a credencial adotada tem outro
                                                               # endereço: o destino fica e o da origem vai ao
                                                               # histórico da mescla (uma por linha adotada)
                                                               "mescla_conflito_origem_guardada":
                                                                   2 if REFERENCIA_OBRIGATORIA else 3}},
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
        # o lote (FCTISSLOTEPROT, mesma fatia) é recusado inteiro até a regra antes do de-para (pedido): pai_pendente
        "FCCTAEXT_FCTISSLOTEPROT": {"gravados": 0, "pendencias": {"pai_pendente": 4}},
    })


def _rodada3(ins):
    """Tabelas da rodada 3 (zero bloqueadas): contas e guias da internação, lote TISS, vigências do acordo, itens da
    conta e o que os completa, produção do repasse e histórico da auditoria. Devolve o esperado delas."""
    def q(t, **kw):
        fora = set(kw) - {c for c, _, _ in _COLS[t]}
        assert not fora, (t, fora)
        ins(t, _linha(t, **kw))

    # origem lida pelas cadeias: prontuário (chave alternativa PRONT), internação, configuração TISS da fonte
    for i in (1, 2):
        q("RICADPAC", ID=i, PRONT=8000 + i)
    for reg, pront, atc, conv in [(501, 8001, 7001, 1), (502, 8002, 7002, 2), (503, 8099, 7001, 1)]:
        q("RICADINT", REG=reg, PRONT=pront, ID_ATCABECATEND=atc, CONV=conv)  # 503: prontuário nunca visto
    q("TBTISS", CONV=1, VERSAO_TISS=30500)   # 030500 = 3.05.00
    q("TBTISS", CONV=2, VERSAO_TISS=12)      # formato não reconhecido: catalogo_codigo_inexistente
    # contas de internação: (REG, CONTA, ano, mês, convênio, início, hora, fim, hora, data, COD, matrícula)
    for x in [(501, 1, 2025, 3, 1, DA(2025, 3, 1), "0800", DA(2025, 3, 5), "1000", None, 7001, "MAT-0001"),
              (502, 1, 2025, 4, None, None, None, None, None, DA(2025, 4, 2), 7002, None),  # fonte e início do pai
              (503, 1, 2025, 5, 1, DA(2025, 5, 1), "0700", None, None, None, 7003, None),  # paciente nunca visto
              (501, 2, 2025, 13, 1, DA(2025, 7, 1), "0700", None, None, None, 7004, None),  # mês inválido
              (501, 3, 2025, 6, 1, DA(2025, 6, 10), "0800", DA(2025, 6, 1), "0800", None, 7005, None)]:  # fim < início
        q("RICONTAS", REG=x[0], CONTA=float(x[1]), ANOPRO=x[2], MESPRO=x[3], CONV=x[4], DATAINI=x[5], HORAINI=x[6],
          DATAFIN=x[7], HORAFIN=x[8], DATA=x[9], COD=x[10], MATRIC=x[11])
    # dados do segurado (a conta pela competência e COD)
    for a, m, c in [(2025, 3, 7001), (2025, 4, 7002), (2025, 9, 7999)]:  # 7002 sem matrícula; 7999 nunca vista
        q("FCDIAINT", ANOPRO=a, MESPRO=m, COD=c, DIAG="Diagnóstico de exemplo\nlinha 2", CARGO="AUX", PADRAO=3,
          CLASSE="B", UND_ADM="Secretaria de exemplo", AFINIDADE="Titular", N_ORDEM="01", VAL_CAR=DA(2026, 1, 31))
    # guias da internação
    for reg, cta, guia, conv, sol, cad, senha in [(501, 1.0, "G-1001", 1, DA(2025, 2, 28), None, "S-1"),
                                                 (502, None, "G-1002", None, None, DA(2025, 4, 1), "S-2"),
                                                 (501, 1.0, "G-1001", 1, DA(2025, 3, 2), None, "S-3"),  # repetida
                                                 (502, None, None, 2, DA(2025, 4, 3), None, "S-4")]:   # sem número
        q("RICGUIAS", REG=reg, CONTA=cta, GUIA=guia, CONV=conv, DATASOLICIT=sol, CADASTRO=cad, SENHA=senha,
          DATAINI=DA(2025, 3, 1), DATAFIN=DA(2025, 3, 31), DIARIAS_SOLICIT=3, DIARIAS_AUTOR=2,
          ID_TBCBOPRO_SOLICITANTE=1, INDICACAO_CLINICA="Indicação de exemplo")
    # lotes TISS: (id, fonte, tipo de guia, número, protocolo, data)
    for i, conv, tg, num, prot, dt in [(1, 1, 2, "000123", "P-1", DT(2025, 3, 10, 10)),
                                       (2, 1, 3, "000124", None, DT(2025, 3, 11)),
                                       (3, 2, 2, "000125", None, DT(2025, 3, 12)),   # versão não reconhecida
                                       (4, 1, 9, "000126", None, DT(2025, 3, 13)),   # tipo de guia sem par
                                       (5, 1, 1, "000127", None, None)]:             # sem data
        q("FCTISSLOTEPROT", ID=i, ID_TBCONVEN=conv, ID_TBTISSTPGUIA=tg, ID_TBTISSSCHEMA=1, NUM_LOTE=num,
          SEQUENCIAL_LOTE=str(i), NUM_PROTOCOLO=prot, DATA_HORA_LOTE=dt)
    # vigências das tabelas no acordo migrado da fonte
    q("TBHISTTABDTH", ID_TBCONVEN=1, PERIODO_INICIAL=DA(2024, 1, 1), PERIODO_FINAL=DA(2024, 12, 31), ID_TBCTRDTH=1)
    q("TBHISTTABDTH", ID_TBCONVEN=2, PERIODO_INICIAL=DA(2024, 1, 1), PERIODO_FINAL=DA(2024, 6, 30), ID_TBCTRDTH=1)
    q("TBHISTTABDTH", ID_TBCONVEN=1, PERIODO_INICIAL=DA(2025, 1, 1), PERIODO_FINAL=DA(2024, 12, 31),
      ID_TBCTRDTH=1)  # fim antes do início: CHECK
    q("TBHISTTABMM", ID_TBCONVEN=1, PERIODO_INICIAL=DA(2024, 1, 1), PERIODO_FINAL=DA(2024, 12, 31), ID_TBCTRMEM=1)
    q("TBHISTTABMM", ID_TBCONVEN=99, PERIODO_INICIAL=DA(2024, 1, 1), PERIODO_FINAL=DA(2024, 12, 31),
      ID_TBCTRMEM=1)  # fonte nunca vista
    q("TBHISTTABTHME", ID_TBCONVEN=1, PERIODO_INICIAL=DA(2024, 1, 1), PERIODO_FINAL=DA(2024, 12, 31),
      ID_TBCTRTHM_ATEND_EXT=1)
    q("TBHISTTABTHMI", ID_TBCONVEN=1, PERIODO_INICIAL=DA(2024, 1, 1), PERIODO_FINAL=DA(2024, 12, 31),
      ID_TBCTRTHM_ATEND_INT=2)
    q("TBHISTTABTHMI", ID_TBCONVEN=2, PERIODO_INICIAL=DA(2024, 2, 1), PERIODO_FINAL=DA(2024, 3, 1),
      ID_TBCTRTHM_ATEND_INT=9)  # tabela nunca vista
    # itens da conta externa: (id, conta, procedimento, diária, mat/med, tipo, data, hora, hora final, qtde)
    for i, cta, pr, dth, mm, tp, dt, h, hf, qt in [
            (1, 10, 1, None, None, 1, DT(2025, 3, 2), "0930", "1000", D("1")),
            (2, 10, None, 5, None, 2, DT(2025, 3, 3), "2300", "0100", D("2")),   # diária; vira o dia
            (3, 10, None, None, 7, 3, DT(2025, 3, 4), "1000", "1000", D("1")),   # mat/med: sem item faturável
            (4, 11, 1, None, None, 1, DT(2025, 3, 5), "1000", "1000", D("0")),   # quantidade zero: CHECK
            (5, 99, 1, None, None, 1, DT(2025, 3, 6), "1000", "1000", D("1")),   # conta nunca vista
            (6, 12, None, 6, None, 2, DT(2025, 3, 7), "1000", "1000", D("1")),   # diária sem item faturável
            (7, 12, 1, None, None, 1, DT(2025, 3, 8), "1000", "1000", D("1"))]:  # glosado, motivo fora: CHECK
        # resultado financeiro: 1 glosado com motivo, recurso, nota, técnica, autorização e autor;
        # 2 sem glosa ('n') e autor nunca visto; 7 glosado com motivo fora do catálogo oficial
        fin = {1: dict(GLOSADO="S", MOTGLO=1001, VLR_PG=D("60"), DT_PG=DA(2025, 5, 10), VLR_RE=D("40.12"),
                       QTD_RE=D("1"), DT_RE=DA(2025, 5, 20), MOTREA=2, N_PROCES="PROC-EX-1", NOTA=123456,
                       TECNICA="1", COD_AUTORIZ="AUT-EX-1", USUARIO="usuario.exemplo",
                       SEQUENCIAL_ITEM_FATURADO=1),
               2: dict(GLOSADO="n", MOTGLO=0, USUARIO="usuario.fora", NOTA=0, COD_AUTORIZ="  "),
               7: dict(GLOSADO="S", MOTGLO=9999)}.get(i, {})
        q("FCLANEXT", ID=i, ID_FCCTAEXT=cta, ID_TBPROCTO=pr, ID_TBTABDTH=dth, ID_TBMATMED=mm, TIPO=tp, DATA=dt,
          HORA=h, HORA_FINAL=hf, QTDE=qt, UNIT_C=D("100.1234"), VALOR_C=D("100.12"), PACOTE="N", PROCTO=1, LOCAL=1,
          ATO=42, ID_TBCBOPRO_TITULAR=1, CDC=1, VLR_CH=D("10"), OBS="Observação de exemplo", **fin)
    # complementos do item: lote do imunobiológico e técnica
    q("REPROEXT", REG=1, PROCTO=1, CRM=1, SEQ=1, ATO=1, ID_FCLANEXT=1, LOTE="LOTE-EX-1", TECNICA=1)
    q("REPROEXT", REG=1, PROCTO=1, CRM=1, SEQ=2, ATO=1, ID_FCLANEXT=3, LOTE="LOTE-EX-2")  # item recusado
    q("REPROEXT", REG=1, PROCTO=1, CRM=1, SEQ=3, ATO=1, ID_FCLANEXT=None, LOTE="LOTE-EX-3")  # sem item
    q("RIPROEXT", REG=1, CONTA=1.0, PROCTO=1, SEQ=1, ID_FCLANEXT=2, TECNICA=5)  # técnica fora do catálogo
    # produção do repasse (C11: o ATO 42 do item é grupo de ato, sem grau de participação igual; a função é o titular)
    for i, it, dt in [(1, 1, DT(2025, 3, 31, 18)), (2, 3, DT(2025, 3, 31)), (3, 1, None)]:  # 2: item recusado; 3: sem data (C10: a do item, gravada)
        q("FCINTEGRPA", ID=i, ID_TBTIPOLANCVLR=1, ID_FCLANEXT=it, ID_RPLANEVE=1, VALOR=D("30"), PERCENTUAL=D("30"),
          DATA_HORA_INTEGRACAO=dt)
    # histórico da auditoria (retrato completo)
    q("FCLANAUD", ANOPRO=2025, MESPRO=3, TIPO_CTA="E", CONTA=10, TIPO=1, DATA=DT(2025, 3, 2), HORA="0930", PROCTO=1,
      LOCAL=1, ATO=1, DATA_GRA=DA(2025, 3, 20), USUARIO="usuario.exemplo", QTDE=D("1"), VALOR_C=D("100.12"))
    q("FCLANAUD", ANOPRO=2025, MESPRO=3, TIPO_CTA="E", CONTA=11, TIPO=2, DATA=DT(2025, 3, 3), HORA="2300", PROCTO=1,
      LOCAL=1, ATO=1, USUARIO="usuario.fora", QTDE=D("2"))  # auditoria e usuário nunca vistos; data do item
    # sequencial do item na guia TISS (trilha do item): 1 e 2 gravados; 3 item recusado; 99 item nunca visto
    for it, seq in [(1, 1), (2, 1), (3, 2), (99, 1)]:
        q("FCLANEXTSEQITEM", ID_FCLANEXT=it, SEQUENCIAL_ITEM=seq)
    # histórico do vínculo do item de mat/med ao código de referência (trilha da tabela de mat/med)
    q("TBHISTBR", TAB=1, COD=10, DATA=DA(2024, 5, 1), TIPO_REF=1, BRAS=12345, USUARIO="usuario.exemplo",
      ID_TBMATMED=7)
    q("TBHISTBR", TAB=1, COD=10, DATA=DA(2024, 8, 1), TIPO_REF=1, BRAS=12399, USUARIO="usuario.fora",
      ID_TBMATMED=7)  # usuário nunca visto
    q("TBHISTBR", TAB=9, COD=11, DATA=DA(2024, 9, 1), TIPO_REF=2, BRAS=54321, ID_TBMATMED=8)  # tabela nunca vista
    return ESPERADO_R3


def _e(g, **p):
    return {"gravados": g, "pendencias": p}


# pendências por regra da tabela da origem (todas as entidades dela, também as das linhas recusadas)
ESPERADO_R3 = {
    # 7001 e 7002 gravam (a segunda adota o tipo 'internacao'); 7003 paciente nunca visto; 7004 mês 13; 7005 fim < início
    "RICONTAS": _e(2, adotado_existente=1, pai_inexistente=1, restricao_destino_1048=2, restricao_destino_4025=1,
                   valor_fora_do_dominio=1),
    # 7001 grava e completa a conta com o diagnóstico; 7002 sem matrícula; 7999 conta nunca vista
    "FCDIAINT": _e(1, pai_inexistente=1, restricao_destino_1048=1),
    # G-1001 repetida (UNIQUE) e guia sem número; a segunda pega fonte e data dos concorrentes; guia sem CONTA:
    # conta NULL com pai_inexistente (a chave alternativa composta com parte vazia não casa), visível
    "RICGUIAS": _e(2, pai_inexistente=2, restricao_destino_1062=1, restricao_destino_1048=1),
    # a versão TISS é SMALLINT na origem: sem a regra antes do de-para (pedido), todo lote fica com
    # catalogo_codigo_invalido e é recusado, visível; o tipo de guia 9 não tem par
    "FCTISSLOTEPROT": _e(0, catalogo_codigo_invalido=5, restricao_destino_1048=5, valor_fora_do_dominio=1),
    # o acordo da fonte 1 nasce na primeira vigência e é adotado pelas outras tabelas (situação presumida)
    "TBHISTTABDTH": _e(2, restricao_destino_4025=1, valor_presumido=3),
    "TBHISTTABMM": _e(1, adotado_existente=1, pai_inexistente=1, restricao_destino_1048=1, valor_presumido=2),
    "TBHISTTABTHME": _e(1, adotado_existente=1, valor_presumido=1),
    "TBHISTTABTHMI": _e(1, adotado_existente=1, pai_inexistente=1, restricao_destino_1048=1, valor_presumido=2),
    # procedimento e diária gravam (a diária vira o dia); mat/med e diária sem item faturável: 1048; tipo 3 e conta
    # nunca vistos; quantidade zero: CHECK; autor nunca visto; glosado com motivo fora do catálogo: CHECK da glosa
    "FCLANEXT": _e(2, pai_inexistente=4, restricao_destino_1048=3, restricao_destino_4025=2, virada_de_dia=1,
                   codigo_inexistente_destino=1),
    "REPROEXT": _e(1, pai_inexistente=1, pai_pendente=1),
    "RIPROEXT": _e(1, catalogo_codigo_inexistente=1),
    "FCINTEGRPA": _e(2, pai_pendente=1),
    "FCLANAUD": _e(2, pai_inexistente=2),
    # item 3 recusado: a trilha dele também (pai_pendente); item 99 nunca visto: grava com o item NULL
    "FCLANEXTSEQITEM": _e(3, pai_pendente=1, pai_inexistente=1),
    # usuário e tabela nunca vistos: gravam com NULL e pendência
    "TBHISTBR": _e(3, pai_inexistente=2),
}
