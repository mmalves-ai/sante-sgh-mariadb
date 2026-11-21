"""Fatia L6-03 (agenda: cadastros, grade, escala, horários e cancelamentos): tabelas da origem com a forma do
dicionário e dados 100% falsos.

Carregadas pelo mapa (colunas.d/L6-03.tsv): AGCADMOTIVO (motivo da marcação), AGCOMPLEXIDADE, AGDURACAO,
AGGRPFASEEVOL, AGTPAGENDA (categoria de agenda, natureza presumida), RESITAGE (situação da marcação, significado
pelo de-para da legenda e aguardando para o código sem par), RETIPAGE (canal), RETP_INTEG_AGENDA_ONLINE (modo online, permissões presumidas), REAGENDA (agenda, com a
categoria criada ou adotada pela coluna EXAME, o profissional pela inscrição no conselho e o setor dono pela
unidade), REAGECRI (geração da
grade), RECTRAGE e SICTRAGE (escala semanal das agendas de consulta e de exame) e SICANAGE (cancelamento de marcação
de exame, na trilha de auditoria como destino interino). CDTPRETCONS e PSTPRETORNO são descarte
(declarado/sem_carga.tsv, mecanismo_do_produto). REPACAGI (horário da agenda) tem a declaração pronta e comentada até
o motor ter o fim do horário por início + duração (pedido em docs/obra/fatias/f4/saida/L6-03.json): entra na imagem
só com a forma (2 linhas falsas).
Pais de fora da fatia: TBUSERS (login) e TBPROFIS (profissional) como PAIS_EXTERNOS; TBCBOPRO (inscrição no
conselho, L5) e SIAGENDA (agenda de exames, L6-04) entram na imagem com a forma inteira do dicionário, para a
referência encadeada e a chave alternativa (a conferência os carrega junto, sem esperado nesta fatia).
Ordem (arestas da rodada 3 em declarado/dependencias.tsv): TBPROFIS antes de REAGENDA, REAGENDA antes de REAGECRI
e RECTRAGE, SIAGENDA antes de SICTRAGE; as filhas acham a agenda pela chave alternativa NOME+CRM.
Anomalias: descrição nula ou só com espaços (NOT NULL do destino recusa a linha), nome com espaços repetidos, código
que só difere pela caixa (categoria C/c e situação AG/ag: as duas linhas recusadas com codigo_colisao_caixa), situação
fora de A/I (valor_fora_do_dominio), situação sem par no de-para, intervalo real da escala (fica
visível até a regra hora_hhmm_zero_nulo), literal presumido (valor_presumido por coluna presumida em cada linha lida que
chega à gravação), agenda sem profissional (CRM 0: dono pelo setor), inscrição repetida (pai_ambiguo), duração 0000 (NOT NULL),
unidade inexistente, dia fora de 1..7, fim antes do início, hora inválida, agenda de exame com nome repetido
(pai_ambiguo), login desconhecido e data de cancelamento sentinela.
"""
import datetime
import decimal
import re

DDL = """
CREATE TABLE AGCADMOTIVO (ID_CADMOTIVO INTEGER NOT NULL, DESCRICAO VARCHAR(100), ID_RETPAGEN SMALLINT NOT NULL,
  PRIMARY KEY (ID_CADMOTIVO));
CREATE TABLE AGCOMPLEXIDADE (ID_COMPLEXIDADE SMALLINT NOT NULL, NOME VARCHAR(20), PRIMARY KEY (ID_COMPLEXIDADE));
CREATE TABLE AGDURACAO (ID_DURACAO SMALLINT NOT NULL, NOME VARCHAR(20), PRIMARY KEY (ID_DURACAO));
CREATE TABLE AGGRPFASEEVOL (ID SMALLINT NOT NULL, NOME VARCHAR(15), PRIMARY KEY (ID));
CREATE TABLE AGTPAGENDA (ID CHAR(1) NOT NULL, NOME_TIPO_AGENDA VARCHAR(20), PRIMARY KEY (ID));
CREATE TABLE CDTPRETCONS (ID SMALLINT NOT NULL, NOME VARCHAR(50) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE PSTPRETORNO (ID SMALLINT NOT NULL, NOME VARCHAR(50) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE REAGECRI (NOME VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL, PERINI DATE NOT NULL, PERFIN DATE NOT NULL,
  DT_CRIACAO DATE NOT NULL, HR_CRIACAO VARCHAR(4) NOT NULL, STATUS VARCHAR(1) NOT NULL, DURACAO VARCHAR(4),
  SEM1 VARCHAR(1), SEM2 VARCHAR(1), SEM3 VARCHAR(1), SEM4 VARCHAR(1), SEM5 VARCHAR(1), SEM6 VARCHAR(1),
  SEM7 VARCHAR(1), USUARIO VARCHAR(31), PRIMARY KEY (NOME,CRM,PERINI,PERFIN,DT_CRIACAO,HR_CRIACAO,STATUS));
CREATE TABLE RECTRAGE (AGENDA VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL, SEMANA VARCHAR(1) NOT NULL,
  DURACAO VARCHAR(4) NOT NULL, HOR_INC VARCHAR(4) NOT NULL, HOR_FIN VARCHAR(4), INTER_INC VARCHAR(4),
  INTER_FIN VARCHAR(4), AOL_PROGRAMACAO INTEGER, PRIMARY KEY (AGENDA,CRM,SEMANA,DURACAO,HOR_INC));
CREATE TABLE REPACAGI (NOME VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL, DATA DATE NOT NULL, HORA VARCHAR(5) NOT NULL,
  PACIENTE VARCHAR(70), RETORNO VARCHAR(1), CONV SMALLINT, UNID SMALLINT, LIVRE VARCHAR(1), PROCED INTEGER,
  USUARIO VARCHAR(31), TIPO VARCHAR(1), SITUACAO VARCHAR(2), DATA_CTR DATE, HORA_CTR VARCHAR(4), DATA_SIT DATE,
  HORA_SIT VARCHAR(4), APAC CHAR(1), HR_PLANEJA VARCHAR(4), TIPOHR VARCHAR(1), DURACAO CHAR(4), AOL_HORARIO INTEGER,
  COD_AGENDA_GERCON INTEGER, TELEATENDIMENTO CHAR(1) NOT NULL, ID_DIGITAL_VIDEOTELEPHONY VARCHAR(36),
  PRIMARY KEY (NOME,CRM,DATA,HORA));
CREATE TABLE RESITAGE (COD VARCHAR(2) NOT NULL, NOME VARCHAR(40), EXTENSAO VARCHAR(5), ICONE BLOB SUB_TYPE 0,
  PRIMARY KEY (COD));
CREATE TABLE RETIPAGE (COD SMALLINT NOT NULL, NOME VARCHAR(40), COR INTEGER, TPAGEN SMALLINT, SITUACAO CHAR(1),
  PRIMARY KEY (COD));
CREATE TABLE RETP_INTEG_AGENDA_ONLINE (ID SMALLINT NOT NULL, DESCRICAO VARCHAR(40) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE REAGENDA (ID INTEGER NOT NULL, NOME VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL, DURACAO VARCHAR(4),
  EXAME VARCHAR(1) NOT NULL, QTDE_RET SMALLINT, ATIVA VARCHAR(1), HR_CRIACAO VARCHAR(4), QTDE_D_RET SMALLINT,
  USUARIO VARCHAR(31), PERINI DATE, PERFIN DATE, DT_CRIACAO DATE, FX_INC SMALLINT, FX_FIN SMALLINT,
  OBS BLOB SUB_TYPE 1, TIPO SMALLINT, UNID SMALLINT, PLANEJA VARCHAR(1), ID_RETP_INTEG_AGENDA_ONLINE SMALLINT NOT NULL,
  OBS_PORTAL_PAC_AGEND_ONLINE BLOB SUB_TYPE 1, PERMITE_TELEATENDIMENTO CHAR(1) NOT NULL, PRIMARY KEY (ID));
CREATE TABLE SICANAGE (NOME VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL, DATA DATE NOT NULL, HORA VARCHAR(4) NOT NULL,
  FONE VARCHAR(15), PACIENTE VARCHAR(70), DT_CAN DATE NOT NULL, HR_CAN VARCHAR(4) NOT NULL, USU_CAN VARCHAR(31),
  USU_AGE VARCHAR(31), CONV SMALLINT, MOTIVO VARCHAR(30), ID_TBMOTCANCCAD INTEGER,
  PRIMARY KEY (NOME, CRM, DATA, HORA, DT_CAN, HR_CAN));
CREATE TABLE SICTRAGE (AGENDA VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL, SEMANA VARCHAR(1) NOT NULL,
  DURACAO VARCHAR(4) NOT NULL, EXAME CHAR(1) NOT NULL, HOR_FIN VARCHAR(4), INTER_FIN VARCHAR(4), HOR_INC VARCHAR(4),
  INTER_INC VARCHAR(4), PRIMARY KEY (AGENDA, CRM, SEMANA, DURACAO, EXAME));
"""
# pais de outras fatias (fora de COLUNAS da fatia): TBCBOPRO com a forma inteira do dicionário (a L5-04 a declara e
# a conferência a carrega junto, sem esperado aqui; o L7-04 faz o mesmo); SIAGENDA com as colunas da L6-04
DDL_PAIS = """
CREATE TABLE TBCBOPRO (ID INTEGER NOT NULL PRIMARY KEY, ID_TBCBOSUS INTEGER NOT NULL, UF VARCHAR(2) NOT NULL,
  COD INTEGER NOT NULL, ID_TBPROFIS INTEGER NOT NULL, VINC_EMPR VARCHAR(1) NOT NULL, CONS_PROF VARCHAR(7),
  ATIVO VARCHAR(1), VINCULO SMALLINT, COMP_INICIAL INTEGER, COMP_FINAL INTEGER, ATENDE_SUS CHAR(1),
  CRM_DIGITO VARCHAR(1), REGIONAL INTEGER, ID_TBSIGLACONSPROF SMALLINT, REG_QUALIF_ESPECIALISTA VARCHAR(9),
  AXREG_ID_ANESTHESIOLOGISTS BIGINT, ID_DIGITAL VARCHAR(36));
CREATE TABLE SIAGENDA (ID INTEGER NOT NULL PRIMARY KEY, CRM INTEGER NOT NULL, NOME VARCHAR(40) NOT NULL,
  EXAME VARCHAR(1) NOT NULL, DURACAO VARCHAR(4), QTDE_RET SMALLINT, ATIVA VARCHAR(1), HR_CRIACAO VARCHAR(4),
  QTDE_D_RET SMALLINT, USUARIO VARCHAR(31), PERINI DATE, PERFIN DATE, DT_CRIACAO DATE, FX_FIN SMALLINT, FX_INC SMALLINT,
  UNID INTEGER, OBSERVACAO BLOB SUB_TYPE 1, ID_TBTABATO SMALLINT NOT NULL, ID_RETP_INTEG_AGENDA_ONLINE SMALLINT NOT NULL,
  OBS_PORTAL_PAC_AGEND_ONLINE BLOB SUB_TYPE 1);
"""

# REPACAGI: declaração pronta e comentada (fim do horário pede o especial pedido ao motor): 2 linhas falsas na imagem,
# fora da carga; descarte de produto (declarado/sem_carga.tsv): 2 linhas falsas cada
NAO_CARREGADAS = {"CDTPRETCONS": 2, "PSTPRETORNO": 2, "REPACAGI": 2}
DESCARTADAS = ("CDTPRETCONS", "PSTPRETORNO")
PRONTAS = ("REPACAGI",)

CARREGADAS = ("AGCADMOTIVO", "AGCOMPLEXIDADE", "AGDURACAO", "AGGRPFASEEVOL", "AGTPAGENDA", "RESITAGE", "RETIPAGE",
              "RETP_INTEG_AGENDA_ONLINE", "SICANAGE", "SICTRAGE", "REAGENDA", "REAGECRI", "RECTRAGE")
PAIS_EXTERNOS = {"TBUSERS": ["ana", "bia"], "TBPROFIS": ["1", "2"]}
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único vem daqui; a categoria 'exame' já
# existe no destino (a agenda de exame a adota, sem sobrescrever)
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');"
                   " INSERT INTO categoria_agenda (codigo, descricao, natureza, criado_em)"
                   " VALUES ('exame', 'Exame do cliente', 'exame', NOW(3))")


def _colunas():
    """{tabela: [(coluna, tipo, obrigatoria)]} lidas do próprio DDL (fonte única da forma)."""
    saida = {}
    for st in DDL.split(";"):
        m = re.match(r"\s*CREATE TABLE (\w+) \((.*), PRIMARY KEY", " ".join(st.split()))
        if m:
            cols = []
            for c in re.split(r",\s*(?=[A-Z_0-9]+ )", m.group(2)):
                nome, resto = c.strip().split(" ", 1)
                cols.append((nome, resto.replace(" NOT NULL", "").strip(), "NOT NULL" in resto))
            saida[m.group(1)] = cols
    return saida


COLUNAS = _colunas()
DDL += DDL_PAIS


def _falso(tipo, i):
    """Valor falso pela forma da coluna (tabelas só com a forma)."""
    if tipo.startswith(("SMALLINT", "INTEGER", "BIGINT")):
        return i
    if tipo.startswith(("VARCHAR", "CHAR")):
        n = int(tipo.split("(")[1].rstrip(")"))
        return str(i) if n == 1 else ("exemplo " + str(i))[:n]
    if tipo == "DATE":
        return datetime.date(2025, 1, i)
    if tipo == "TIMESTAMP":
        return datetime.datetime(2025, 1, i, 8, 30)
    if tipo.startswith("NUMERIC"):
        return decimal.Decimal("1.0")
    return ("texto exemplo " + str(i)).encode("cp1252")


def _ins(ins, tab, **v):
    ins(tab, [v.get(c) for c, _, _ in COLUNAS[tab]])


def linhas(r, ins):
    for tab, cols in COLUNAS.items():
        if tab not in CARREGADAS:
            for i in range(1, NAO_CARREGADAS[tab] + 1):
                ins(tab, [_falso(tp, i) for _, tp, _ in cols])
    # motivo da marcação: 3 sem descrição (NOT NULL do destino recusa a linha)
    for i, d in [(1, "Primeira consulta exemplo"), (2, "Retorno pós-operatório"), (3, None), (5, "Revisão  anual ")]:
        _ins(ins, "AGCADMOTIVO", ID_CADMOTIVO=i, DESCRICAO=d, ID_RETPAGEN=1)
    # complexidade: nome com espaços repetidos (texto_nome colapsa) e 5 sem nome (recusa)
    for i, n in [(1, "Baixa"), (2, "Média"), (3, "  Alta   complexa "), (4, "Crítica"), (5, None)]:
        _ins(ins, "AGCOMPLEXIDADE", ID_COMPLEXIDADE=i, NOME=n)
    for i, n in [(1, "Curta"), (2, "Média"), (3, "Longa"), (4, "Muito longa")]:
        _ins(ins, "AGDURACAO", ID_DURACAO=i, NOME=n)
    # fase do tratamento: 4 com nome só de espaços (vira NULL: recusa)
    for i, n in [(1, "Inicial"), (2, "Intermediária"), (3, "Final"), (4, "   ")]:
        _ins(ins, "AGGRPFASEEVOL", ID=i, NOME=n)
    # categoria de agenda: C e c só diferem pela caixa (as duas recusadas, nenhuma vence pela ordem de leitura)
    for c, n in [("C", "Consulta exemplo"), ("c", "Consulta clínica"), ("E", "Exame exemplo"), ("Q", "Sessão exemplo"),
                 ("P", "Plantão exemplo")]:
        _ins(ins, "AGTPAGENDA", ID=c, NOME_TIPO_AGENDA=n)
    # situação da marcação: Z sem nome (recusa); AG e ag só diferem pela caixa (as duas recusadas com
    # codigo_colisao_caixa); ícone em bytes (não carregado); C e F pelo de-para (confirmada, falta); M sem par no
    # de-para: valor_fora_do_dominio e aguardando pela coluna concorrente
    for c, n in [("AG", "Agendado exemplo"), ("ag", "Agendado online exemplo"), ("C", "Confirmado exemplo"),
                 ("F", "Faltou  exemplo"), ("M", "Marcado exemplo"), ("Z", None)]:
        _ins(ins, "RESITAGE", COD=c, NOME=n, EXTENSAO="bmp", ICONE=bytes([0, 0x80, 0x9F, 0xFF]))
    # canal de marcação: situação A, I, X (fora do domínio: fica o padrão do destino) e nula
    for i, n, s in [(1, "Presencial exemplo", "A"), (2, "Telefone exemplo", "I"), (3, "Portal exemplo", "X"),
                    (4, "Mensagem exemplo", None)]:
        _ins(ins, "RETIPAGE", COD=i, NOME=n, COR=255 * i, TPAGEN=1, SITUACAO=s)
    for i, d in [(0, "Não exemplo"), (1, "Central exemplo"), (2, "Portal exemplo"), (3, "Ambos exemplo")]:
        _ins(ins, "RETP_INTEG_AGENDA_ONLINE", ID=i, DESCRICAO=d)
    D = datetime.date
    # inscrições no conselho (pai de outra fatia): 103 repetido em duas inscrições (pai_ambiguo)
    for v in [(1, 101, 1), (2, 102, 2), (3, 103, 1), (4, 103, 2), (5, 104, 2)]:
        ins("TBCBOPRO", [v[0], 1, "SP", v[1], v[2], "S"] + [None] * 12)
    # agenda de exames (pai de outra fatia; as linhas 1 a 4 iguais às da L6-04): 2 e 3 com o mesmo nome; 1 a 4 sem
    # profissional (CRM 0) são recusadas pelo CHECK de dono até a L6-04 adotar o setor dono (pedido em
    # saida/L6-03.json); a 5, com profissional pela inscrição 102, carrega e prova a escala de exame
    for v in [(1, 0, "Endoscopia exemplo", "E", "0030"), (2, 0, "Ultrassom exemplo", "U", "0015"),
              (3, 0, "Ultrassom exemplo", "O", "0015"), (4, 0, "Agenda nao carregada", "E", "0020"),
              (5, 102, "Raio X exemplo", "R", "0020")]:
        ins("SIAGENDA", list(v) + [None] * 12 + [1, 0, None])
    obs = ("Observação  da agenda\r\n segunda linha €").encode("cp1252")
    for (i, nome, crm, dur, exa, ativa, dret, usu, fxi, fxf, unid, tele) in [
            (1, "Clinica geral exemplo", 101, "0020", "F", "S", 30, "ana", 0, 0, 0, "N"),   # categoria consulta criada
            (2, "Cardiologia exemplo", 102, "0030", "F", "N", 0, "bia", 12, 90, 0, "S"),    # consulta adotada
            (3, "Sem dono exemplo", 0, "0015", "T", "S", 0, "ana", 0, 0, 0, "N"),           # CHECK de dono: recusa
            (4, "Duracao zero exemplo", 101, "0000", "F", "S", 0, "ana", 0, 0, 0, "N"),     # duração NULL: recusa
            (5, "Exame exemplo", 104, "0045", "T", None, 0, "zeca", 0, 0, 7, "N"),          # 'exame' adotada
            (6, "Inscricao repetida exemplo", 103, "0020", "F", "S", 0, "ana", 0, 0, 0, "N")]:  # ambíguo: recusa
        _ins(ins, "REAGENDA", ID=i, NOME=nome, CRM=crm, DURACAO=dur, EXAME=exa, QTDE_RET=2, ATIVA=ativa,
             HR_CRIACAO="0900", QTDE_D_RET=dret, USUARIO=usu, PERINI=D(2025, 1, 1), PERFIN=D(2026, 12, 31),
             DT_CRIACAO=D(2024, 12, 20), FX_INC=fxi, FX_FIN=fxf, OBS=obs if i == 1 else None, TIPO=0, UNID=unid,
             PLANEJA="N", ID_RETP_INTEG_AGENDA_ONLINE=i % 4,
             OBS_PORTAL_PAC_AGEND_ONLINE=b"Traga o pedido" if i == 2 else None, PERMITE_TELEATENDIMENTO=tele)
    sem = dict(SEM1="F", SEM2="T", SEM3="F", SEM4="T", SEM5="F", SEM6="F", SEM7="F")
    for (nome, crm, cri, hr, st, usu) in [
            ("Clinica geral exemplo", 101, D(2025, 12, 20), "0930", "C", "ana"),
            ("Clinica geral exemplo", 101, D(2025, 12, 22), "1000", "E", "bia"),    # reversão
            ("Cardiologia exemplo", 102, D(2025, 12, 21), "0800", "C", None),       # sem responsável
            ("Exame exemplo", 104, D(2025, 12, 23), "2575", "C", "ana"),            # hora inválida
            ("Agenda inexistente", 999, D(2025, 12, 24), "1100", "C", "ana")]:      # agenda inexistente
        _ins(ins, "REAGECRI", NOME=nome, CRM=crm, PERINI=D(2026, 1, 1), PERFIN=D(2026, 1, 31), DT_CRIACAO=cri,
             HR_CRIACAO=hr, STATUS=st, DURACAO="0020", USUARIO=usu, **sem)
    for v in [("Clinica geral exemplo", 101, "2", "0020", "0800", "1200", "0000", "0000", None),
              ("Clinica geral exemplo", 101, "4", "0020", "1300", "1800", "1500", "1515", 77),
              ("Cardiologia exemplo", 102, "9", "0030", "0800", "1200", None, None, None),    # dia fora de 1..7
              ("Cardiologia exemplo", 102, "3", "0030", "1200", "0800", None, None, None),    # fim antes do início
              ("Cardiologia exemplo", 102, "5", "0030", "0700", "1100", "0000", "0000", None),
              ("Agenda inexistente", 999, "2", "0030", "0800", "1000", None, None, None)]:  # agenda inexistente
        _ins(ins, "RECTRAGE", **dict(zip(("AGENDA", "CRM", "SEMANA", "DURACAO", "HOR_INC", "HOR_FIN", "INTER_INC",
                                          "INTER_FIN", "AOL_PROGRAMACAO"), v)))
    e = "Endoscopia exemplo"
    for v in [(e, 0, "2", "0030", "E", "1200", "0000", "0800", "0000"),
              (e, 0, "4", "0030", "E", "1800", "1400", "1300", "1330"),
              ("Ultrassom exemplo", 0, "3", "0015", "U", "1100", None, "0700", None),   # nome repetido: pai_ambiguo
              (e, 0, "6", "0020", "E", "2575", None, "0800", None),                     # hora inválida
              ("Agenda nao carregada", 0, "2", "0030", "E", "1200", None, "0800", None),   # agenda recusada
              ("Raio X exemplo", 102, "2", "0020", "R", "1200", "0000", "0800", "0000"),    # gravada
              ("Raio X exemplo", 102, "3", "0020", "R", "2575", None, "0800", None)]:       # hora inválida
        _ins(ins, "SICTRAGE", **dict(zip(("AGENDA", "CRM", "SEMANA", "DURACAO", "EXAME", "HOR_FIN", "INTER_FIN",
                                          "HOR_INC", "INTER_INC"), v)))
    for v in [(e, 0, D(2026, 3, 2), "0800", "0000-0000", "Paciente Ficticio Um", D(2026, 3, 1), "1015", "ana", "bia",
               1, "Paciente desistiu", None),
              (e, 0, D(2026, 3, 2), "0830", None, "Paciente Ficticio Dois", D(2026, 3, 1), "1100", "zeca", "ana",
               2, "Exame remarcado", None),                             # login desconhecido: entra sem usuário
              (e, 0, D(2026, 3, 2), "0900", None, None, D(1899, 12, 30), "0000", None, None, None, None, None),
              (e, 0, D(2026, 3, 3), "0930", None, "Paciente Ficticio Tres", D(2026, 3, 2), "0900", None, None,
               None, "  Sem   motivo €", None)]:
        _ins(ins, "SICANAGE", **dict(zip(("NOME", "CRM", "DATA", "HORA", "FONE", "PACIENTE", "DT_CAN", "HR_CAN",
                                          "USU_CAN", "USU_AGE", "CONV", "MOTIVO", "ID_TBMOTCANCCAD"), v)))
    return {
        "AGCADMOTIVO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "AGCOMPLEXIDADE": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1}},
        "AGDURACAO": {"gravados": 4, "pendencias": {}},
        "AGGRPFASEEVOL": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "AGTPAGENDA": {"gravados": 3, "pendencias": {"codigo_colisao_caixa": 2, "valor_presumido": 3}},
        # C e F pelo de-para; M sem par: valor_fora_do_dominio e aguardando (coluna concorrente)
        "RESITAGE": {"gravados": 3, "pendencias": {"codigo_colisao_caixa": 2, "restricao_destino_1048": 1,
                                                   "valor_fora_do_dominio": 1}},
        "RETIPAGE": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1}},
        "RETP_INTEG_AGENDA_ONLINE": {"gravados": 4, "pendencias": {"valor_presumido": 8}},
        # agendas 1, 2, 3, 5 e 6 gravadas: o dono é o setor da unidade (decisão L6-03 r3b), então a 3 (CRM 0) e a 6
        # (inscrição repetida, pai_ambiguo) carregam sem profissional; 4 com duração 0000 (1048). Categoria criada
        # pela 1 e adotada pela 2, 3, 5 e 6; setor agenda_sem_unidade criado pela 1 e adotado pela 2, 3 e 6; a 5
        # (UNID 7, sem cadastro) cria agenda_unidade_7 com o nome fixo. pai_inexistente: login da 5 e a unidade 7 na
        # agenda, no nome e na unidade do setor. valor_presumido: setor presumido em cada linha lida (6)
        "REAGENDA": {"gravados": 5, "pendencias": {"adotado_existente": 7, "pai_ambiguo": 1, "pai_inexistente": 4,
                                                   "restricao_destino_1048": 1, "valor_presumido": 6}},
        # geração: 1 gravada (agenda 1, C); a E da mesma agenda é a reversão (CHECK ck_geracao_grade_reversao: 4025,
        # visível até a gravação condicional pedida); sem responsável (1048); hora inválida 2575 em solicitada_em e
        # processada_em (2 hora_invalida, 1048); agenda inexistente (pai_inexistente, 1048)
        "REAGECRI": {"gravados": 1, "pendencias": {"hora_invalida": 2, "pai_inexistente": 1,
                                                   "restricao_destino_1048": 3, "restricao_destino_4025": 1}},
        # escala: dia 2, dia 4 (intervalo real 1500-1515: valor_fora_do_dominio nas duas pontas, visível até
        # hora_hhmm_zero_nulo) e dia 5 gravadas; dia 9 (valor_fora_do_dominio, 1048); fim antes do início (4025);
        # agenda inexistente (pai_inexistente, 1048)
        "RECTRAGE": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 2,
                                                   "restricao_destino_4025": 1, "valor_fora_do_dominio": 3,
                                                   "vigencia_sem_fonte": 6}},
        # escala de exame: a da agenda 5 (Raio X) gravada; hora inválida na mesma agenda (1048); Ultrassom com nome
        # repetido (pai_ambiguo, 1048); Endoscopia (3 faixas) e a agenda 4 recusadas na L6-04 (sem dono): pai_pendente
        "SICTRAGE": {"gravados": 1, "pendencias": {"hora_invalida": 1, "pai_ambiguo": 1, "pai_pendente": 4,
                                                   "restricao_destino_1048": 2, "vigencia_sem_fonte": 3}},
        # cancelamento de exame na trilha (interino): 3 gravados; data sentinela recusa (1048); login desconhecido
        "SICANAGE": {"gravados": 3, "pendencias": {"data_sentinela": 1, "pai_inexistente": 1,
                                                   "restricao_destino_1048": 1}},
    }
