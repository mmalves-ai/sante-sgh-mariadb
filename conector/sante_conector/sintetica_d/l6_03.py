"""Fatia L6-03 (agenda: cadastros, grade, horários e cancelamentos): tabelas da origem com a forma do dicionário e
dados 100% falsos.

Carregadas pelo mapa (colunas.d/L6-03.tsv): AGCADMOTIVO (motivo da marcação), AGCOMPLEXIDADE (complexidade da
sessão), AGDURACAO (duração da sessão), AGGRPFASEEVOL (fase do tratamento), AGTPAGENDA (categoria de agenda, natureza
presumida), RESITAGE (situação da marcação, significado presumido), RETIPAGE (canal de marcação) e
RETP_INTEG_AGENDA_ONLINE (modo de marcação online, permissões presumidas). CDTPRETCONS e PSTPRETORNO são descarte
(declarado/sem_carga.tsv, mecanismo_do_produto). As outras 6 tabelas (REAGENDA, as filhas da agenda e SIAGECRI)
entram na imagem só com a forma (2 linhas falsas cada) e ficam fora da carga até as regras de minutos HHMM e de data
mais hora, a ordem, a referência pelo código de negócio do destino e a mudança de modelo pedidas em
docs/obra/fatias/f4/saida/L6-03.json (lá está também a declaração pronta; motivo por coluna em colunas.d/L6-03.tsv).
REPACAGD_EXCLUSAO é da fatia L6-04.
Anomalias: descrição nula ou só com espaços (NOT NULL do destino recusa a linha), nome com espaços repetidos, código
que só difere pela caixa (categoria C/c e situação AG/ag: as duas linhas recusadas com codigo_colisao_caixa), situação fora de A/I
(valor_fora_do_dominio, fica o padrão do destino) e literal presumido (valor_presumido por coluna presumida em cada linha lida que chega à gravação, inclusive a recusada pelo destino).
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
CREATE TABLE RECANAGE (NOME VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL, DATA DATE NOT NULL, HORA VARCHAR(4) NOT NULL,
  PACIENTE VARCHAR(70), FONE VARCHAR(15), CONV SMALLINT, USU_AGE VARCHAR(31), DT_CAN DATE NOT NULL,
  HR_CAN VARCHAR(4) NOT NULL, USU_CAN VARCHAR(31), MOTIVO VARCHAR(300), PROTOCOLO INTEGER NOT NULL,
  ID_TBMOTCANCCAD INTEGER, PRIMARY KEY (NOME,CRM,DATA,HORA,DT_CAN,HR_CAN));
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
CREATE TABLE SIAGECRI (NOME VARCHAR(40) NOT NULL, CRM INTEGER NOT NULL, PERINI DATE NOT NULL, PERFIN DATE NOT NULL,
  DT_CRIACAO DATE NOT NULL, HR_CRIACAO VARCHAR(4) NOT NULL, EXAME CHAR(1) NOT NULL, DURACAO VARCHAR(4),
  STATUS VARCHAR(1), SEM1 VARCHAR(1), SEM2 VARCHAR(1), SEM3 VARCHAR(1), SEM4 VARCHAR(1), SEM5 VARCHAR(1),
  SEM6 VARCHAR(1), SEM7 VARCHAR(1), USUARIO VARCHAR(31),
  PRIMARY KEY (NOME,CRM,PERINI,PERFIN,DT_CRIACAO,HR_CRIACAO,EXAME));
"""

# Tabelas da fatia fora da carga (todas as colunas declaradas sem destino): 2 linhas falsas cada na imagem. Hoje o
# motor as pula sem rastro (planejar só entra tabela com coluna com destino) e a conferência só compara o esperado
# devolvido por linhas(); por isso a conciliação da fatia cobre 8 de 16 tabelas. Quando o motor ganhar a pendência
# por tabela pedida em saida/L6-03.json, entram no esperado como {"gravados": 0, "pendencias": {regra: 1}}.
NAO_CARREGADAS = {"CDTPRETCONS": 2, "PSTPRETORNO": 2, "REAGECRI": 2, "RECANAGE": 2, "RECTRAGE": 2,
                  "REPACAGI": 2, "REAGENDA": 2, "SIAGECRI": 2}
# descarte de produto (declarado/sem_carga.tsv): domínio fixo que entra pelo de-para de valores na coluna consumidora
DESCARTADAS = ("CDTPRETCONS", "PSTPRETORNO")

CARREGADAS = ("AGCADMOTIVO", "AGCOMPLEXIDADE", "AGDURACAO", "AGGRPFASEEVOL", "AGTPAGENDA", "RESITAGE", "RETIPAGE",
              "RETP_INTEG_AGENDA_ONLINE")


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
    # codigo_colisao_caixa); ícone em bytes (não carregado); FA (falta) entra presumida como aguardando (pendência)
    for c, n in [("AG", "Agendado exemplo"), ("ag", "Agendado online exemplo"), ("CF", "Confirmado exemplo"),
                 ("FA", "Faltou  exemplo"), ("Z", None)]:
        _ins(ins, "RESITAGE", COD=c, NOME=n, EXTENSAO="bmp", ICONE=bytes([0, 0x80, 0x9F, 0xFF]))
    # canal de marcação: situação A, I, X (fora do domínio: fica o padrão do destino) e nula
    for i, n, s in [(1, "Presencial exemplo", "A"), (2, "Telefone exemplo", "I"), (3, "Portal exemplo", "X"),
                    (4, "Mensagem exemplo", None)]:
        _ins(ins, "RETIPAGE", COD=i, NOME=n, COR=255 * i, TPAGEN=1, SITUACAO=s)
    for i, d in [(0, "Não exemplo"), (1, "Central exemplo"), (2, "Portal exemplo"), (3, "Ambos exemplo")]:
        _ins(ins, "RETP_INTEG_AGENDA_ONLINE", ID=i, DESCRICAO=d)
    return {
        "AGCADMOTIVO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "AGCOMPLEXIDADE": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1}},
        "AGDURACAO": {"gravados": 4, "pendencias": {}},
        "AGGRPFASEEVOL": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "AGTPAGENDA": {"gravados": 3, "pendencias": {"codigo_colisao_caixa": 2, "valor_presumido": 3}},
        "RESITAGE": {"gravados": 2, "pendencias": {"codigo_colisao_caixa": 2, "restricao_destino_1048": 1,
                                                   "valor_presumido": 3}},
        "RETIPAGE": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1}},
        "RETP_INTEG_AGENDA_ONLINE": {"gravados": 4, "pendencias": {"valor_presumido": 8}},
    }
