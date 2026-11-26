"""Fatia L6-16 (prontuário, assinatura e assistência, módulo CC): tabelas da origem e anomalias, dados 100% falsos.

Anomalias cobertas:
- nome com espaços repetidos (texto_nome colapsa) e texto com espaços nas pontas (texto apara);
- S/N fora do domínio (valor_fora_do_dominio; NOT NULL com padrão fica com o padrão) e S/N nulo (padrão);
- nome ausente em coluna obrigatória do destino (restricao_destino_1048);
- sigla repetida (única no destino: restricao_destino_1062);
- literal presumido (=~): pendência valor_presumido em toda linha lida;
- natureza do caráter e grupo da anestesia pelo NOME (de-para de valores, valores.d/L6-16.tsv): nome sem par vira
  NULL com valor_fora_do_dominio e fica o padrão do destino;
- parâmetros do usuário (tabela sem chave): S/N inválido nas 8 permissões (uma pendência por coluna); usuário nunca
  carregado (pai_inexistente, recusa pelo NOT NULL), usuário repetido com permissões opostas (único por usuário e
  estabelecimento: 1062), usuário nulo (1048), CON_AGE nulo (FALSE pelo de-para de valores: permissão ausente é negada) e
  pode_criar_agendamento presumido (valor_presumido por linha);
- ícone binário presente (fica fora: vai para arquivo, pedido em L6-16.json);
- agenda excluída ou cancelada (registro_excluido com retrato): operação presumida (valor_presumido por linha),
  atendimento e prontuário nunca vistos (pai_inexistente, coluna opcional: grava NULL), sem data da última
  atualização (1048) e usuário nunca carregado (pai_inexistente e 1048). RICADPAC entra só com as colunas da
  referência pelo prontuário (pai do L3, registrado como já carregado).
Rodada 3 (bloco cirúrgico inteiro carrega):
- sala: unidade cirúrgica única do cliente (@unico, PREPARO_DESTINO), sem nome (1048), centro de custo nunca visto
  (pai_inexistente) com fim da agenda web antes do início (CHECK 4025); permissão de sala com usuário nunca visto e
  com sala recusada (pai_pendente);
- ato cirúrgico: horários HHMM com a data do ato (#data_hora), ato que atravessa a meia-noite (virada_de_dia nas
  quatro colunas de fim), paciente pelo atendimento (encadeada RECADATE > PRONT > RICADPAC), sem sala (1048),
  atendimento nunca visto (1048) e sala recusada (pai_pendente);
- agenda: caráter presumido eletivo pelo cadastro do destino (cod:, valor_presumido), situação presumida suspenso (pedido 67; sem cancelado_em, 4025),
  cirurgião pela inscrição (encadeada até o profissional), procedimento principal criado no cadastro cirúrgico
  (antes;adotar:codigo) com o nome da tabela de procedimentos da origem ou, ambíguo, o código derivado; prontuário e
  profissional nunca vistos (1048), sem duração (CHECK de agendado, 4025), ATEND fora do domínio;
- histórico e procedimentos extras da agenda: agenda pela sala + data e hora (chave alternativa composta; no
  histórico, com o registro na chave e o registro sozinho como concorrente; ambíguo: pai_ambiguo); horário
  reaproveitado por outro paciente nunca liga à agenda dele. A agenda carrega antes (declarado/dependencias.tsv);
- rodada 3b: situação da agenda pelo código da origem (de-para de valores; cancelada sem data e horário bloqueado
  recusam com 4025, nunca agendados), sangue reservado (quantidade > 0), paciente pelo CPF sem prontuário,
  potencial de contaminação do ato pela classe da CCIH (cod:), retrato da exclusão com a identificação informada;
- lançamento do ato: procedimento adotado do cadastro cirúrgico, sequência repetida no ato (1062), ato recusado
  (pai_pendente).
"""
import datetime
import decimal
import re

DDL = """
CREATE TABLE CCAGENDA_EXC_CANC ("ID" INTEGER NOT NULL, "SALA" SMALLINT NOT NULL, "DATA_HORA" TIMESTAMP NOT NULL,
  "DURACAO" TIMESTAMP, "PRONT" INTEGER, "REG" INTEGER NOT NULL, "PACIENTE" VARCHAR(70), "IDENT" VARCHAR(15), "CPF"
  BIGINT, "OBS" VARCHAR(150), "ATEND" VARCHAR(1) NOT NULL, "ESP" SMALLINT, "CRM" INTEGER, "CONV" SMALLINT, "AUX1"
  INTEGER, "AUX2" INTEGER, "AUX3" INTEGER, "INSTR" INTEGER, "ANEST" INTEGER, "CIRCUL" INTEGER, "PROCTO" INTEGER,
  "ANESTESIA" SMALLINT NOT NULL, "INTERVALO" TIMESTAMP, "JUSTIF" VARCHAR(60), "USUARIO" VARCHAR(31), "QTSAN"
  NUMERIC(18,3), "CTI" CHAR(1), "MIC" CHAR(1), "IMA" CHAR(1), "FUR" CHAR(1), "CAN" CHAR(1), "VID" CHAR(1), "TOR"
  CHAR(1), "ORT" CHAR(1), "ELE" CHAR(1), "OUTR" VARCHAR(30), "MATRICULA" VARCHAR(20), "TP_CIR" SMALLINT, "FONE"
  VARCHAR(15), "UCO" VARCHAR(1), "CIDADE" VARCHAR(30), "OUTR_TIPO_ANEST" VARCHAR(25), "ID_CRM" INTEGER, "ID_AUX1"
  INTEGER, "ID_AUX2" INTEGER, "ID_AUX3" INTEGER, "ID_INSTR" INTEGER, "ID_ANEST" INTEGER, "ID_CIRCUL" INTEGER, "ARCO"
  VARCHAR(1), "CONGEL" VARCHAR(1), "RX" VARCHAR(1), "DATA_NASCIMENTO" DATE, "DATA_HORA_INCLUSAO" TIMESTAMP,
  "DATA_HORA_ULTIMA_ATUALIZACAO" TIMESTAMP, "ID_TBCBOPRO_PEDIATRA" INTEGER, "NUM_CELULAR_PACIENTE" VARCHAR(15),
  "E_MAIL_PACIENTE" VARCHAR(100), "ID_TBSITAGE" VARCHAR(2), "ID_CCHORAGE" INTEGER, "AXREG_ID_PROCEDURE" BIGINT,
  CONSTRAINT PK_L616_CCAGENDA_EXC_CANC PRIMARY KEY ("ID"));
CREATE TABLE CCHISAGE ("DATA_HORA" TIMESTAMP NOT NULL, "USUARIO" VARCHAR(31) NOT NULL, "SALA_ANT" SMALLINT,
  "DATA_HORA_ANT" TIMESTAMP, "DURACAO" TIMESTAMP, "PACIENTE" VARCHAR(70), "SALA_R" SMALLINT, "DATA_HORA_R"
  TIMESTAMP, "JUSTIF" VARCHAR(150), "OPERACAO" VARCHAR(1), "REG" INTEGER, "CRM" INTEGER, "ID_CRM" INTEGER, "CONV"
  SMALLINT, "PROCTO" INTEGER, CONSTRAINT PK_L616_CCHISAGE PRIMARY KEY ("DATA_HORA","USUARIO"));
CREATE TABLE CCPARAM ("USUARIO" VARCHAR(31), "DIG_CDC" VARCHAR(1), "DIG_CIR" VARCHAR(1), "ATU_INT_S" VARCHAR(1),
  "ATU_INT_C" VARCHAR(1), "ATU_EXT_S" VARCHAR(1), "ATU_EXT_C" VARCHAR(1), "CON_AGE" VARCHAR(1), "DIG_INVAS" CHAR(1),
  "DIG_SUPUR" CHAR(1), "DIG_RESER" CHAR(1), "DIG_MATERIAIS" CHAR(1), "LANCAR_OPM" VARCHAR(1), "DADOS_CIH"
  VARCHAR(1), "LANC_EXAME_PAT" VARCHAR(1), "CONSIS_FERIADO_AGE" VARCHAR(1), "DIGITAR_TECNICA_UTIL" VARCHAR(1),
  "DIGITAR_ESPECIALIDADE" CHAR(1), "PERMITIR_DESAGENDAR" CHAR(1), "PERMITIR_REAGENDAR" CHAR(1),
  "PERMITIR_EXCLUIR_AGENDAMENTO" CHAR(1), "PERMITIR_ATENDER_AGENDAMENTO" CHAR(1), "DIGITAR_OFTALMOLOGIA" CHAR(1),
  "GERIR_SALA_BLOCO_CIRURGICO" CHAR(1), "SITUACAO_DESAGENDAMENTO" VARCHAR(2), "PERM_LAN_DATHOR_FUT_FIN_POS_OPE"
  VARCHAR(1), "CONSID_ESPEC_PESQ_ANEST" INTEGER);
CREATE TABLE CCPROEXT ("SALA" SMALLINT NOT NULL, "DATA_HORA" TIMESTAMP NOT NULL, "PROCTO" INTEGER NOT NULL,
  CONSTRAINT PK_L616_CCPROEXT PRIMARY KEY ("SALA","DATA_HORA","PROCTO"));
CREATE TABLE CCSALAS ("COD" SMALLINT NOT NULL, "NOME" VARCHAR(40), "CDC" INTEGER, "OLD_SITUACAO" VARCHAR(1),
  "HORARIO_INICIAL_AGENDA_WEB" TIME NOT NULL, "HORARIO_FINAL_AGENDA_WEB" TIME NOT NULL, CONSTRAINT PK_L616_CCSALAS
  PRIMARY KEY ("COD"));
CREATE TABLE CCSALAS_TBUSERS ("ID_CCSALAS" SMALLINT NOT NULL, "USUARIO" VARCHAR(31) NOT NULL, CONSTRAINT
  PK_L616_CCSALAS_TBUSERS PRIMARY KEY ("ID_CCSALAS","USUARIO"));
CREATE TABLE CCTIPOLOCALBLC ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(30) NOT NULL, "ATIVO" CHAR(1), CONSTRAINT
  PK_L616_CCTIPOLOCALBLC PRIMARY KEY ("ID"));
CREATE TABLE CCTIPOMOVIMENTACAOPAC ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(30) NOT NULL, "ATIVO" CHAR(1), CONSTRAINT
  PK_L616_CCTIPOMOVIMENTACAOPA PRIMARY KEY ("ID"));
CREATE TABLE CCTPURGENCIA ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(40) NOT NULL, "ATIVO" CHAR(1), CONSTRAINT
  PK_L616_CCTPURGENCIA PRIMARY KEY ("ID"));
CREATE TABLE PRFA_CAD_MODO_RESPIR ("ID" SMALLINT NOT NULL, "DESCRICAO" VARCHAR(100) NOT NULL, "SIGLA" VARCHAR(3) NOT
  NULL, "ATIVO" CHAR(1) NOT NULL, CONSTRAINT PK_L616_PRFA_CAD_MODO_RESPIR PRIMARY KEY ("ID"));
CREATE TABLE PRFA_CAD_POSICAO_CIR ("ID" SMALLINT NOT NULL, "DESCRICAO" VARCHAR(100) NOT NULL, "ATIVO" CHAR(1) NOT
  NULL, "ICONE" BLOB SUB_TYPE 0, CONSTRAINT PK_L616_PRFA_CAD_POSICAO_CIR PRIMARY KEY ("ID"));
CREATE TABLE PRFA_TIPO_SINAL ("ID" SMALLINT NOT NULL, "SIGLA" VARCHAR(3) NOT NULL, "DESCRICAO" VARCHAR(100) NOT
  NULL, "ATIVO" CHAR(1) NOT NULL, CONSTRAINT PK_L616_PRFA_TIPO_SINAL PRIMARY KEY ("ID"));
CREATE TABLE PRTIPO_PROFISSIONAL ("ID" INTEGER NOT NULL, "NOME" VARCHAR(80) NOT NULL, "ATIVO" CHAR(1) NOT NULL,
  CONSTRAINT PK_L616_PRTIPO_PROFISSIONAL PRIMARY KEY ("ID"));
CREATE TABLE TBANESTESIA ("COD" SMALLINT NOT NULL, "NOME" VARCHAR(20), "ATIVO" CHAR(1), CONSTRAINT
  PK_L616_TBANESTESIA PRIMARY KEY ("COD"));
CREATE TABLE CCCADCIR ("ID" INTEGER NOT NULL, "REG" INTEGER NOT NULL, "DATA" DATE NOT NULL, "ORDEM" SMALLINT NOT
  NULL, "CONV" SMALLINT, "ATEND" VARCHAR(1) NOT NULL, "HORA_I" VARCHAR(4), "HORA_T" VARCHAR(4), "DURACAO"
  VARCHAR(4), "CID10" VARCHAR(6), "DIAG" VARCHAR(400), "TIPO_ANES" SMALLINT NOT NULL, "HORA_IA" VARCHAR(4),
  "HORA_TA" VARCHAR(4), "PESO" NUMERIC(9,3), "PRESSAO" VARCHAR(10), "PULSO" VARCHAR(10), "TEMPO" VARCHAR(5),
  "SANGUE" VARCHAR(3), "PROG_ANES" VARCHAR(40), "PROG_HORA" VARCHAR(4), "EFEITO" VARCHAR(4), "AP_RESP" VARCHAR(100),
  "AP_CIRC" VARCHAR(100), "AP_DIGEST" VARCHAR(100), "SIST_NERV" VARCHAR(100), "ANEST_ANT" VARCHAR(100), "TIPO_CIR"
  VARCHAR(1), "OLD_URG_CIR" VARCHAR(1), "POT_CONT" VARCHAR(1), "PARTO" VARCHAR(1), "SALA" SMALLINT, "CIRCUL"
  VARCHAR(40), "USUARIO" VARCHAR(31), "ANAT_PAT" CHAR(1), "SUPUR" CHAR(1), "MATRICULA" VARCHAR(20), "TP_CIR"
  SMALLINT, "DATA_P_I" DATE, "HORA_P_I" VARCHAR(4), "DATA_P_F" DATE, "HORA_P_F" VARCHAR(4), "OUT_TIP_ANES"
  VARCHAR(30), "USA_TUBO" VARCHAR(1), "USA_ANTIMI" VARCHAR(1), "USA_SONDA" VARCHAR(1), "USA_CATETER" VARCHAR(1),
  "USA_PUNCAO" VARCHAR(1), "TUBO" VARCHAR(35), "ANTIMI" VARCHAR(35), "DOSAGEM" VARCHAR(15), "SONDA" VARCHAR(35),
  "CATETER" VARCHAR(35), "PUNCAO" VARCHAR(35), "ACOMPANHANTE_SALA_PARTO" CHAR(1), "EPISIOTOMIA" CHAR(1),
  "DATA_HORA_INCLUSAO" TIMESTAMP, "DATA_HORA_ULTIMA_ATUALIZACAO" TIMESTAMP, "CONTA" DOUBLE PRECISION NOT NULL,
  "TIPO_CIR_COPIA" VARCHAR(1), "ID_CCTPURGENCIA" SMALLINT, "AXREG_ID_PROCEDURE" BIGINT, CONSTRAINT PK_L616_CCCADCIR
  PRIMARY KEY ("ID"));
CREATE TABLE CCAGENDA ("ID" INTEGER NOT NULL, "SALA" SMALLINT NOT NULL, "DATA_HORA" TIMESTAMP NOT NULL, "DURACAO"
  TIMESTAMP, "PRONT" INTEGER, "REG" INTEGER NOT NULL, "PACIENTE" VARCHAR(70), "IDENT" VARCHAR(15), "CPF" BIGINT,
  "OBS" VARCHAR(150), "ATEND" VARCHAR(1) NOT NULL, "ESP" SMALLINT, "CRM" INTEGER, "CONV" SMALLINT, "AUX1" INTEGER,
  "AUX2" INTEGER, "AUX3" INTEGER, "INSTR" INTEGER, "ANEST" INTEGER, "CIRCUL" INTEGER, "PROCTO" INTEGER, "ANESTESIA"
  SMALLINT NOT NULL, "INTERVALO" TIMESTAMP, "JUSTIF" VARCHAR(60), "USUARIO" VARCHAR(31), "QTSAN" NUMERIC(18,3),
  "CTI" CHAR(1), "MIC" CHAR(1), "IMA" CHAR(1), "FUR" CHAR(1), "CAN" CHAR(1), "VID" CHAR(1), "TOR" CHAR(1), "ORT"
  CHAR(1), "ELE" CHAR(1), "OUTR" VARCHAR(30), "MATRICULA" VARCHAR(20), "TP_CIR" SMALLINT, "FONE" VARCHAR(15), "UCO"
  VARCHAR(1), "CIDADE" VARCHAR(30), "OUTR_TIPO_ANEST" VARCHAR(25), "ID_CRM" INTEGER, "ID_AUX1" INTEGER, "ID_AUX2"
  INTEGER, "ID_AUX3" INTEGER, "ID_INSTR" INTEGER, "ID_ANEST" INTEGER, "ID_CIRCUL" INTEGER, "ARCO" VARCHAR(1),
  "CONGEL" VARCHAR(1), "RX" VARCHAR(1), "DATA_NASCIMENTO" DATE, "DATA_HORA_INCLUSAO" TIMESTAMP,
  "DATA_HORA_ULTIMA_ATUALIZACAO" TIMESTAMP, "ID_TBCBOPRO_PEDIATRA" INTEGER, "NUM_CELULAR_PACIENTE" VARCHAR(15),
  "E_MAIL_PACIENTE" VARCHAR(100), "ID_TBSITAGE" VARCHAR(2), "ID_CCHORAGE" INTEGER, "AXREG_ID_PROCEDURE" BIGINT,
  "HORA_BLOQUEADA" VARCHAR(1), "ID_TBSPD_USUARIO" INTEGER, CONSTRAINT PK_L616_CCAGENDA PRIMARY KEY ("ID"));
CREATE TABLE CCLANCIR ("ID" INTEGER NOT NULL, "ID_CCCADCIR" INTEGER NOT NULL, "OLD_REG" INTEGER, "OLD_DATA" DATE,
  "OLD_ORDEM" SMALLINT, "OLD_ATEND" CHAR(1), "PROCTO" INTEGER NOT NULL, "SEQ" SMALLINT NOT NULL, "LOCAL" SMALLINT
  NOT NULL, "HORA" CHAR(4), "CIRUR" INTEGER, "AUX1" DOUBLE PRECISION, "AUX2" INTEGER, "AUX3" INTEGER, "INSTR" INTEGER, "ANEST"
  INTEGER, "PED" INTEGER, "CIRC" INTEGER, "CDC" INTEGER, "FP" SMALLINT, "TIPO" VARCHAR(1), "PERC" NUMERIC(9,2),
  "DTGASI" DATE, "DTGASF" DATE, "HRGASI" TIME, "HRGASF" TIME, "ESP" SMALLINT, "ANAP" VARCHAR(50), "ID_CIRUR"
  INTEGER, "ID_AUX1" INTEGER, "ID_AUX2" INTEGER, "ID_AUX3" INTEGER, "ID_INSTR" INTEGER, "ID_ANEST" INTEGER, "ID_PED"
  INTEGER, "ID_CIRC" INTEGER, "TECNICA" SMALLINT, "DATA_HORA_INCLUSAO" TIMESTAMP, "DATA_HORA_ULTIMA_ATUALIZACAO"
  TIMESTAMP, "ID_TBPROCTO_TAXA" INTEGER, "QUANTIDADE" DOUBLE PRECISION, "ID_TBCBOPRO_AUX4" INTEGER, "HORAF" CHAR(4),
  CONSTRAINT PK_L616_CCLANCIR PRIMARY KEY ("ID"));
CREATE TABLE RICADPAC ("ID" INTEGER NOT NULL, "PRONT" INTEGER NOT NULL, "CPF" DOUBLE PRECISION, CONSTRAINT PK_L616_RICADPAC PRIMARY KEY ("ID"));
CREATE TABLE RECADATE ("REG" INTEGER NOT NULL, "PRONT" INTEGER, CONSTRAINT PK_L616_RECADATE PRIMARY KEY ("REG"));
CREATE TABLE TBCBOPRO ("ID" INTEGER NOT NULL, "ID_TBCBOSUS" INTEGER NOT NULL, "UF" VARCHAR(2) NOT NULL, "COD"
  INTEGER NOT NULL, "ID_TBPROFIS" INTEGER NOT NULL, "VINC_EMPR" VARCHAR(1) NOT NULL, "CONS_PROF" VARCHAR(7), "ATIVO"
  VARCHAR(1), "VINCULO" SMALLINT, "COMP_INICIAL" INTEGER, "COMP_FINAL" INTEGER, "ATENDE_SUS" CHAR(1), "CRM_DIGITO"
  VARCHAR(1), "REGIONAL" INTEGER, "ID_TBSIGLACONSPROF" SMALLINT, "REG_QUALIF_ESPECIALISTA" VARCHAR(9),
  "AXREG_ID_ANESTHESIOLOGISTS" BIGINT, "ID_DIGITAL" VARCHAR(36), CONSTRAINT PK_L616_TBCBOPRO PRIMARY KEY ("ID"));
CREATE TABLE TBPROCTO ("ID" INTEGER NOT NULL, "ID_TBCTRTHM" SMALLINT NOT NULL, "COD_PROCEDIMENTO" BIGINT NOT NULL,
  "NOME" VARCHAR(100), "TP_MODULO" CHAR(1), CONSTRAINT PK_L616_TBPROCTO PRIMARY KEY ("ID"));
"""
PAIS_EXTERNOS = {"TBUSERS": ["USR_EXEMPLO_A", "USR_EXEMPLO_B", "USR_EXEMPLO_C", "USR_EXEMPLO_E"],
                 "RICADPAC": ["1", "2"], "RECADATE": ["5000", "5001", "5003"], "TBCENCUS": ["10"], "TBCONVEN": ["3"],
                 "TBESPEC": ["7"], "TBPROFIS": ["900", "901"]}
# a conferência cria só as tabelas de destino da fatia: o estabelecimento e a unidade cirúrgica únicos do cliente de
# exemplo vêm daqui (no cliente real: o estabelecimento do L3 e a unidade cadastrada no painel antes da migração)
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');"
                   " CREATE TABLE IF NOT EXISTS unidade_cirurgica (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " ativo BOOLEAN NOT NULL DEFAULT TRUE, excluido_em DATETIME(3) NULL);"
                   " INSERT INTO unidade_cirurgica (ativo) VALUES (TRUE), (FALSE);"
                   # classes de contaminação da CCIH (cadastro do produto; o ato acha o id pela classe, cod:)
                   " CREATE TABLE IF NOT EXISTS classe_contaminacao_cirurgica (id BIGINT UNSIGNED AUTO_INCREMENT"
                   " PRIMARY KEY, codigo VARCHAR(30) NOT NULL, descricao VARCHAR(150) NOT NULL, classe VARCHAR(30)"
                   " NOT NULL, ativo BOOLEAN NOT NULL DEFAULT TRUE, criado_em DATETIME(3) NOT NULL DEFAULT NOW(3));"
                   " INSERT INTO classe_contaminacao_cirurgica (codigo, descricao, classe) VALUES ('L', 'Limpa',"
                   " 'limpa'), ('PC', 'Potencialmente contaminada', 'potencialmente_contaminada'), ('C',"
                   " 'Contaminada', 'contaminada'), ('I', 'Infectada', 'infectada')")
CARREGADAS = ("CCPARAM", "CCTIPOLOCALBLC", "CCTIPOMOVIMENTACAOPAC", "CCTPURGENCIA", "PRFA_CAD_MODO_RESPIR",
              "PRFA_CAD_POSICAO_CIR", "PRFA_TIPO_SINAL", "PRTIPO_PROFISSIONAL", "TBANESTESIA", "CCAGENDA_EXC_CANC",
              "CCSALAS", "CCSALAS_TBUSERS", "CCCADCIR", "CCAGENDA", "CCHISAGE", "CCPROEXT", "CCLANCIR")
# pais de outras fatias só com as colunas das referências (não são carregados pela fatia)
PAIS_ORIGEM = ("RICADPAC", "RECADATE", "TBCBOPRO", "TBPROCTO")
NAO_CARREGADAS = ()
_COL = re.compile(r'"(\w+)"\s+([A-Z]+)(?:\((\d+)(?:,(\d+))?\))?')


class _Hora(datetime.time):
    """Hora como literal do isql (a imagem sintética escreve tipos desconhecidos por str())."""
    def __str__(self):
        return "'%02d:%02d:00'" % (self.hour, self.minute)


def colunas(tabela):
    """(nome, tipo, tamanho) das colunas da tabela, na ordem do DDL."""
    corpo = DDL.split("CREATE TABLE %s (" % tabela)[1].split(");")[0]
    return [(m.group(1), m.group(2), int(m.group(3) or 0)) for m in _COL.finditer(corpo)]


def _generica(tabela, i):
    """Linha genérica e falsa de tabela não carregada: valor inventado pelo tipo de cada coluna."""
    v = []
    for _, tipo, tam in colunas(tabela):
        if tipo in ("INTEGER", "SMALLINT", "BIGINT"):
            v.append(i)
        elif tipo == "TIMESTAMP":
            v.append(datetime.datetime(2026, 1, i, 8, 30))
        elif tipo == "DATE":
            v.append(datetime.date(2026, 1, i))
        elif tipo == "TIME":
            v.append(_Hora(7 + i, 0))
        elif tipo == "NUMERIC":
            v.append(decimal.Decimal(i))
        elif tipo == "DOUBLE":
            v.append(float(i))
        elif tipo in ("VARCHAR", "CHAR"):
            v.append(("S" if tam == 1 else "X%d" % i)[:tam])
        else:
            v.append(None)
    return v


def _linha(tabela, i=1, **kw):
    """Linha genérica e falsa com as colunas dadas por nome; as de hora em texto e as datas sem uso ficam nulas."""
    nomes = [n for n, _, _ in colunas(tabela)]
    v = _generica(tabela, i)
    for n in nomes:
        if n.startswith(("HORA", "PROG_HORA", "DATA_P_", "DTGAS", "HRGAS")) or n in ("DURACAO", "INTERVALO", "CID10"):
            v[nomes.index(n)] = None
    for k, x in kw.items():
        v[nomes.index(k)] = x
    return v


def _exc_canc(**kw):
    """Linha da agenda excluída ou cancelada: genérica e falsa, com as colunas lidas dadas por nome (CPF nulo)."""
    nomes = [n for n, _, _ in colunas("CCAGENDA_EXC_CANC")]
    v = _generica("CCAGENDA_EXC_CANC", 1)
    v[nomes.index("CPF")] = None
    for k, x in kw.items():
        v[nomes.index(k)] = x
    return v


def _bloco(ins):
    """Bloco cirúrgico (rodada 3): sala, permissão, ato, agenda, histórico, extras e lançamento."""
    dt, h = datetime.datetime, lambda hh, mm: datetime.datetime(1899, 12, 30, hh, mm)
    ins("RECADATE", [5000, 700])
    ins("RECADATE", [5001, 701])
    ins("RECADATE", [5002, 700])           # atendimento da origem nunca carregado (pai_inexistente)
    ins("RECADATE", [5003, 701])
    # inscrição no conselho (pai de outra fatia, todas as colunas do dicionário: a fatia dona também a planeja aqui;
    # o esperado dela não é conferido nesta fatia); 52: profissional nunca carregado
    for i, prof in [(50, 900), (51, 901), (52, 999)]:
        ins("TBCBOPRO", [i, 1, "SP", 1000 + i, prof, "N"] + [None] * 12)
    # tabela de procedimentos: 30101010 único (nome); 10101012 em duas tabelas (pai_ambiguo: código derivado)
    for v in [(1, 1, 30101010, "Cirurgia exemplo B", "C"), (2, 1, 10101012, "Procedimento exemplo A", "C"),
              (3, 2, 10101012, "Procedimento exemplo A outra tabela", "C")]:
        ins("TBPROCTO", list(v))
    # sala: 2 nome com espaços; 3 sem nome (1048); 4 centro de custo nunca visto e fim antes do início (4025)
    for v in [(1, "Sala exemplo 1", 10, None, _Hora(7, 0), _Hora(19, 0)),
              (2, "  Sala   exemplo  2 ", None, None, _Hora(7, 0), _Hora(13, 0)),
              (3, None, 10, None, _Hora(8, 0), _Hora(12, 0)),
              (4, "Sala exemplo 4", 77, None, _Hora(13, 0), _Hora(8, 0))]:
        ins("CCSALAS", list(v))
    # permissão: D nunca carregado (1048); sala 3 recusada (pai_pendente)
    for v in [(1, "USR_EXEMPLO_A"), (2, "USR_EXEMPLO_B"), (1, "USR_EXEMPLO_D"), (3, "USR_EXEMPLO_A")]:
        ins("CCSALAS_TBUSERS", list(v))
    # ato: 1 completo; 2 atravessa a meia-noite; 3 sem sala (1048); 5 atendimento nunca visto (1048); 6 sala recusada
    d = datetime.date(2026, 3, 2)
    # potencial de contaminação: 1 limpa (L); 2 fora do domínio (valor_fora_do_dominio, NULL); demais nulos
    for i, reg, sala, urg, an, conv, hi, ht, hia, hta, pot in [
            (1, 5000, 1, 1, 1, 3, "0800", "0930", "0745", "0945", "L"),
            (2, 5001, 2, 2, 2, None, "2330", "0110", "2300", "0130", "Y"),
            (3, 5000, None, 1, 1, 3, "0800", "0900", "0750", "0910", None),
            (5, 5002, 1, 1, 1, 3, "1000", "1100", "0950", "1110", None),
            (6, 5000, 4, 1, 1, 3, "1400", "1500", "1350", "1510", None)]:
        ins("CCCADCIR", _linha("CCCADCIR", i, ID=i, REG=reg, DATA=d, SALA=sala, ID_CCTPURGENCIA=urg, TIPO_ANES=an,
                               CONV=conv, HORA_I=hi, HORA_T=ht, HORA_IA=hia, HORA_TA=hta, PESO=decimal.Decimal(
                                   "70.5" if i == 1 else "0"), SUPUR="N", USUARIO="USR_EXEMPLO_A",
                               CID10="K359" if i == 1 else None, DIAG="Diagnóstico exemplo %d" % i, POT_CONT=pot))
    # agenda: 1 completa, confirmada (C), 2 unidades de sangue (reserva TRUE); 2 procedimento ambíguo, sem inclusão,
    # sem situação (suspenso presumido, pedido 67: sem cancelado_em, 4025); 3 prontuário nunca visto (1048); 4 cirurgião nunca visto (1048), realizada
    # (S); 5 sem duração (CHECK de agendado, 4025; o procedimento já existe: adotado); 6 ATEND fora do domínio, sem
    # procedimento e cancelada (X: sem a data do cancelamento o CHECK recusa, 4025); 7 sem prontuário: paciente pelo
    # CPF; 8 horário bloqueado na grade (S: recusa 4025, nunca agendada); 9 horário reservado (HR: recusa 4025);
    # 10 situação sem par (valor_fora_do_dominio, suspenso presumido: 4025); 11 sem prontuário nem CPF conhecido (1048)
    for i, sala, quando, dur, pront, reg, atend, esp, procto, crm, incl, sit, blq, san, cpf in [
            (1, 1, dt(2026, 4, 6, 8, 0), h(2, 0), 700, 5000, "I", 7, 30101010, 50, dt(2026, 3, 30, 10, 0), "C", "N",
             2, None),
            (2, 2, dt(2026, 4, 6, 10, 0), h(1, 0), 701, 5001, "E", None, 10101012, 51, None, None, None, 0, None),
            (3, 1, dt(2026, 4, 7, 8, 0), h(1, 30), 888, 5000, "I", 7, None, 50, dt(2026, 3, 30, 11, 0), "N", "N",
             0, None),
            (4, 1, dt(2026, 4, 7, 10, 0), h(1, 0), 700, 5000, "I", 7, None, 52, dt(2026, 3, 30, 12, 0), "S", "N",
             0, None),
            (5, 1, dt(2026, 4, 8, 8, 0), None, 700, 5000, "I", 7, 30101010, 50, dt(2026, 3, 30, 13, 0), "R", "N",
             0, None),
            (6, 2, dt(2026, 4, 8, 10, 0), h(0, 45), 701, 5000, "X", 7, None, 51, dt(2026, 3, 30, 14, 0), "X", "N",
             0, None),
            (7, 2, dt(2026, 4, 11, 8, 0), h(1, 0), None, 5003, "I", 7, None, 51, dt(2026, 3, 30, 15, 0), "C", "N",
             0, 11122233344),
            (8, 1, dt(2026, 4, 11, 13, 0), h(4, 0), 700, 5000, "I", 7, None, 50, dt(2026, 3, 30, 16, 0), None, "S",
             0, None),
            (9, 1, dt(2026, 4, 12, 8, 0), h(2, 0), 700, 5000, "I", 7, None, 50, dt(2026, 3, 30, 17, 0), "HR", "N",
             0, None),
            (10, 2, dt(2026, 4, 12, 10, 0), h(1, 0), 701, 5003, "I", 7, None, 51, dt(2026, 3, 30, 18, 0), "ZZ",
             "N", 0, None),
            (11, 2, dt(2026, 4, 13, 8, 0), h(1, 0), None, 5003, "I", 7, None, 51, dt(2026, 3, 30, 19, 0), "C",
             "N", 0, 99988877766)]:
        ins("CCAGENDA", _linha("CCAGENDA", 1, ID=i, SALA=sala, DATA_HORA=quando, DURACAO=dur, PRONT=pront, REG=reg,
                               ATEND=atend, ESP=esp, CONV=3, PROCTO=procto, ANESTESIA=1, INTERVALO=h(0, 30),
                               USUARIO="USR_EXEMPLO_A", CTI="S", OBS="Observação exemplo %d" % i, ID_CRM=crm,
                               DATA_HORA_INCLUSAO=incl, ID_TBSITAGE=sit, HORA_BLOQUEADA=blq,
                               QTSAN=decimal.Decimal(san), CPF=cpf))
    # histórico: 1 pelo novo horário e registro; 2 pelo registro (horário sem agenda); 3 registro com várias agendas
    # (pai_ambiguo, 1048); 4 usuário nunca visto (1048); 5 horário da agenda 1 reaproveitado por OUTRO paciente
    # (registro 5001): não casa com a agenda 1 (a chave leva o registro) e liga à agenda do próprio registro (2)
    for quando, usu, sala_r, novo, reg in [
            (dt(2026, 3, 31, 9, 0), "USR_EXEMPLO_A", 1, dt(2026, 4, 6, 8, 0), 5000),
            (dt(2026, 3, 31, 10, 0), "USR_EXEMPLO_B", 2, dt(2026, 4, 9, 10, 0), 5001),
            (dt(2026, 3, 31, 11, 0), "USR_EXEMPLO_C", 1, dt(2026, 4, 10, 8, 0), 5000),
            (dt(2026, 3, 31, 12, 0), "USR_EXEMPLO_D", 1, dt(2026, 4, 6, 8, 0), 5000),
            (dt(2026, 3, 31, 13, 0), "USR_EXEMPLO_B", 1, dt(2026, 4, 6, 8, 0), 5001)]:
        ins("CCHISAGE", _linha("CCHISAGE", 1, DATA_HORA=quando, USUARIO=usu, SALA_ANT=2,
                               DATA_HORA_ANT=dt(2026, 4, 5, 8, 0), DURACAO=h(2, 0), PACIENTE="Paciente exemplo",
                               SALA_R=sala_r, DATA_HORA_R=novo, JUSTIF="Remarcação exemplo", OPERACAO="A", REG=reg,
                               CRM=None, ID_CRM=50, CONV=3, PROCTO=30101010))
    # extras da agenda 1: um procedimento novo (sem nome na origem) e um que já existe; 3 horário sem agenda
    for v in [(1, dt(2026, 4, 6, 8, 0), 40101010), (1, dt(2026, 4, 6, 8, 0), 30101010),
              (2, dt(2026, 4, 9, 10, 0), 30101010)]:
        ins("CCPROEXT", list(v))
    # lançamento: 1 procedimento adotado; 2 novo; 3 sequência repetida no ato (1062); 4 ato recusado (pai_pendente)
    for i, ato, procto, seq, perc in [(1, 1, 30101010, 1, "100"), (2, 1, 50101010, 2, "70"),
                                      (3, 1, 30101010, 2, None), (4, 3, 30101010, 1, None)]:
        ins("CCLANCIR", _linha("CCLANCIR", 1, ID=i, ID_CCCADCIR=ato, PROCTO=procto, SEQ=seq,
                               PERC=decimal.Decimal(perc) if perc else None))


def _esperado_bloco():
    """Esperado do bloco na ordem do mapa (dependências em declarado/dependencias.tsv: a agenda antes do histórico e
    dos extras, o convênio antes do ato, o centro de custo antes da sala)."""
    return {
        "CCSALAS": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1, "pai_inexistente": 1,
                                                  "restricao_destino_4025": 1}},
        "CCSALAS_TBUSERS": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1,
                                                          "pai_pendente": 1}},
        "CCCADCIR": {"gravados": 2, "pendencias": {"virada_de_dia": 4, "restricao_destino_1048": 2,
                                                   "pai_inexistente": 1, "pai_pendente": 1,
                                                   "valor_fora_do_dominio": 1}},
        # valor_presumido 13 (rodada 6): caráter eletivo presumido nas 11 linhas + situação suspenso presumida só nas 2
        # em que é ela que grava (o motor deixou de marcar o =~ concorrente quando uma coluna anterior preenche)
        # 3 e 11: o banco acusa o CHECK (4025) antes do NOT NULL do paciente; 5: recusada (4025), a adoção é desfeita;
        # 6 cancelada sem data do cancelamento, 8 e 9 horário bloqueado: 4025; T2 (pedido 67): 2 (sem situação) e 10
        # (situação sem par) entram suspenso presumido e o CHECK do cancelamento (sem cancelado_em) recusa: 4025
        "CCAGENDA": {"gravados": 2, "pendencias": {"valor_presumido": 13, "pai_ambiguo": 1, "pai_inexistente": 3,
                                                   "restricao_destino_1048": 1, "restricao_destino_4025": 8,
                                                   "valor_fora_do_dominio": 2}},
        # T2 (pedido 67): 2 e 5 ligam à agenda 2, agora recusada: pai_pendente (NOT NULL), visíveis até a agenda gravar
        "CCHISAGE": {"gravados": 1, "pendencias": {"valor_presumido": 3, "pai_ambiguo": 3, "pai_inexistente": 2,
                                                   "pai_pendente": 2, "restricao_destino_1048": 2}},
        "CCPROEXT": {"gravados": 2, "pendencias": {"pai_inexistente": 2, "adotado_existente": 1,
                                                   "restricao_destino_1048": 1}},
        "CCLANCIR": {"gravados": 2, "pendencias": {"adotado_existente": 1, "pai_inexistente": 1,
                                                   "restricao_destino_1062": 1, "pai_pendente": 1}},
    }


def linhas(r, ins):
    ins("RICADPAC", [1, 700, 55566677788])
    ins("RICADPAC", [2, 701, 11122233344])
    # agenda excluída ou cancelada: 1 completa; 2 atendimento nunca visto e sem prontuário (paciente pelo CPF; a
    # identificação informada fica no retrato); 3 prontuário nunca visto;
    # 4 sem a data da última atualização (a inclusão presumida, P2b); 5 usuário nunca carregado (pai_inexistente e 1048)
    ts = datetime.datetime(2026, 2, 3, 14, 5)
    for i, pront, reg, usu, quando in [(1, 700, 5000, "USR_EXEMPLO_A", ts), (2, None, 9999, "USR_EXEMPLO_B", ts),
                                       (3, 888, 5000, "USR_EXEMPLO_C", ts), (4, 701, 5000, "USR_EXEMPLO_A", None),
                                       (5, 701, 5000, "USR_EXEMPLO_D", ts)]:
        ins("CCAGENDA_EXC_CANC", _exc_canc(ID=i, PRONT=pront, REG=reg, USUARIO=usu, CPF=55566677788 if pront is None
                                           else None, PACIENTE="Paciente exemplo %d" % i,
                                           DATA_HORA_ULTIMA_ATUALIZACAO=quando, JUSTIF="Justificativa exemplo %d" % i))
    # local do paciente no bloco: 2 com espaços repetidos; 3 com S/N inválido (padrão TRUE); 4 com S/N nulo
    for v in [(1, "Pré-operatório exemplo", "S"), (2, "  Sala   exemplo  ", "S"), (3, "Recuperação exemplo", "X"),
              (4, "Espera exemplo", None), (5, "Inativo exemplo", "N")]:
        ins("CCTIPOLOCALBLC", list(v))
    for v in [(1, "Admissão exemplo", "S"), (2, "Transferência exemplo", "S"), (3, "Alta do bloco exemplo", "N")]:
        ins("CCTIPOMOVIMENTACAOPAC", list(v))
    # caráter: natureza pelo nome (de-para de valores); um só de natureza eletiva (a agenda presume o eletivo pelo
    # cadastro do destino); o nome sem par fica no teste de unidade
    for v in [(1, "ELETIVA", "S"), (2, "Urgência", "S"), (3, "EMERGÊNCIA", "T"), (4, "Cirurgia de urgência", "S")]:
        ins("CCTPURGENCIA", list(v))
    for v in [(1, "Espontâneo exemplo", "VE", "S"), (2, " Controlado a volume ", "VCV", "S"),
              (3, "Controlado a pressão", "PCV", "N")]:
        ins("PRFA_CAD_MODO_RESPIR", list(v))
    for v in [(1, "Decúbito dorsal exemplo", "S", b"\x89PNG-falso"), (2, "Decúbito ventral exemplo", "S", None),
              (3, "Litotomia exemplo", "N", None)]:
        ins("PRFA_CAD_POSICAO_CIR", list(v))
    # sinal 3 com sigla repetida (única no destino: 1062)
    for v in [(1, "PA", "Pressão arterial exemplo", "S"), (2, "FC", "Frequência cardíaca exemplo", "S"),
              (3, "PA", "Pressão invasiva exemplo", "S"), (4, "SAT", "Saturação exemplo", "N")]:
        ins("PRFA_TIPO_SINAL", list(v))
    for v in [(1, "Cirurgião exemplo", "S"), (2, "Primeiro   auxiliar", "S"), (3, "Anestesista exemplo", "S"),
              (4, "Instrumentador exemplo", "N")]:
        ins("PRTIPO_PROFISSIONAL", list(v))
    # anestesia: grupo pelo nome (de-para de valores); 3 sem nome (1048); 4 com S/N nulo (padrão TRUE); 6 sem par
    # (NULL com valor_fora_do_dominio, fica o padrão geral)
    for v in [(1, "GERAL", "S"), (2, "Raquidiana", "S"), (3, None, "S"), (4, "Local", None), (5, "Bloqueio", "S"),
              (6, "Técnica exemplo", "S")]:
        ins("TBANESTESIA", list(v))
    # parâmetros do usuário (sem chave): C com S/N inválido; D nunca carregado (pai_inexistente, recusa pelo NOT NULL);
    # A repetido com permissões opostas (hoje 1062 numa delas; pedido: as duas recusadas); usuário nulo (1048);
    # E com CON_AGE nulo (FALSE pelo de-para de valores, nunca o padrão TRUE do destino)
    cols = colunas("CCPARAM")
    for u, flag in [("USR_EXEMPLO_A", "S"), ("USR_EXEMPLO_B", "N"), ("USR_EXEMPLO_C", "X"), ("USR_EXEMPLO_D", "S"),
                    ("USR_EXEMPLO_A", "N"), (None, "S"), ("USR_EXEMPLO_E", "S")]:
        v = [u]
        for nome, tipo, tam in cols[1:]:
            v.append(0 if tipo == "INTEGER" else (flag if tam == 1 and not (u == "USR_EXEMPLO_E" and nome == "CON_AGE")
                                                  else None))
        ins("CCPARAM", v)
    _bloco(ins)
    esp = {
        "CCTIPOLOCALBLC": {"gravados": 5, "pendencias": {"valor_presumido": 5, "valor_fora_do_dominio": 1}},
        "CCTIPOMOVIMENTACAOPAC": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
        "CCTPURGENCIA": {"gravados": 4, "pendencias": {}},
        "PRFA_CAD_MODO_RESPIR": {"gravados": 3, "pendencias": {}},
        "PRFA_CAD_POSICAO_CIR": {"gravados": 3, "pendencias": {}},
        "PRFA_TIPO_SINAL": {"gravados": 3, "pendencias": {"restricao_destino_1062": 1}},
        "PRTIPO_PROFISSIONAL": {"gravados": 4, "pendencias": {}},
        "TBANESTESIA": {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        # recusas-fase2 (P2b, L6-16 r4): a 4, sem a data da última atualização, grava pela inclusão presumida
        "CCAGENDA_EXC_CANC": {"gravados": 4, "pendencias": {"valor_presumido": 6, "pai_inexistente": 3,
                                                            "restricao_destino_1048": 1}},
        "CCPARAM": {"gravados": 4, "pendencias": {"valor_presumido": 7, "valor_fora_do_dominio": 8, "pai_inexistente": 1,
                                                  "restricao_destino_1048": 2, "restricao_destino_1062": 1}},
    }
    esp.update(_esperado_bloco())
    return esp
