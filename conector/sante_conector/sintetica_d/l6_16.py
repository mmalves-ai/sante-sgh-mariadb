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
CCHISAGE, CCPROEXT, CCSALAS, CCSALAS_TBUSERS, CCCADCIR, CCAGENDA e CCLANCIR ficam na imagem e NÃO são
carregadas (sem coluna declarada; motivos e pedidos em docs/obra/fatias/f4/saida/L6-16.json).
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
CREATE TABLE RICADPAC ("ID" INTEGER NOT NULL, "PRONT" INTEGER NOT NULL, CONSTRAINT PK_L616_RICADPAC PRIMARY KEY ("ID"));
"""
PAIS_EXTERNOS = {"TBUSERS": ["USR_EXEMPLO_A", "USR_EXEMPLO_B", "USR_EXEMPLO_C", "USR_EXEMPLO_E"],
                 "RICADPAC": ["1", "2"], "RECADATE": ["5000"]}
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')")
CARREGADAS = ("CCPARAM", "CCTIPOLOCALBLC", "CCTIPOMOVIMENTACAOPAC", "CCTPURGENCIA", "PRFA_CAD_MODO_RESPIR",
              "PRFA_CAD_POSICAO_CIR", "PRFA_TIPO_SINAL", "PRTIPO_PROFISSIONAL", "TBANESTESIA", "CCAGENDA_EXC_CANC")
# pai do L3 só com as colunas da referência pelo prontuário (não é carregado pela fatia)
PAIS_ORIGEM = ("RICADPAC",)
NAO_CARREGADAS = ("CCHISAGE", "CCPROEXT", "CCSALAS", "CCSALAS_TBUSERS", "CCCADCIR", "CCAGENDA",
                  "CCLANCIR")
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


def _exc_canc(**kw):
    """Linha da agenda excluída ou cancelada: genérica e falsa, com as colunas lidas dadas por nome."""
    nomes = [n for n, _, _ in colunas("CCAGENDA_EXC_CANC")]
    v = _generica("CCAGENDA_EXC_CANC", 1)
    for k, x in kw.items():
        v[nomes.index(k)] = x
    return v


def linhas(r, ins):
    for t in NAO_CARREGADAS:
        for i in (1, 2):
            ins(t, _generica(t, i))
    ins("RICADPAC", [1, 700])
    ins("RICADPAC", [2, 701])
    # agenda excluída ou cancelada: 1 completa; 2 atendimento nunca visto e sem prontuário; 3 prontuário nunca visto;
    # 4 sem a data da última atualização (1048); 5 usuário nunca carregado (pai_inexistente e 1048)
    ts = datetime.datetime(2026, 2, 3, 14, 5)
    for i, pront, reg, usu, quando in [(1, 700, 5000, "USR_EXEMPLO_A", ts), (2, None, 9999, "USR_EXEMPLO_B", ts),
                                       (3, 888, 5000, "USR_EXEMPLO_C", ts), (4, 701, 5000, "USR_EXEMPLO_A", None),
                                       (5, 701, 5000, "USR_EXEMPLO_D", ts)]:
        ins("CCAGENDA_EXC_CANC", _exc_canc(ID=i, PRONT=pront, REG=reg, USUARIO=usu,
                                           DATA_HORA_ULTIMA_ATUALIZACAO=quando, JUSTIF="Justificativa exemplo %d" % i))
    # local do paciente no bloco: 2 com espaços repetidos; 3 com S/N inválido (padrão TRUE); 4 com S/N nulo
    for v in [(1, "Pré-operatório exemplo", "S"), (2, "  Sala   exemplo  ", "S"), (3, "Recuperação exemplo", "X"),
              (4, "Espera exemplo", None), (5, "Inativo exemplo", "N")]:
        ins("CCTIPOLOCALBLC", list(v))
    for v in [(1, "Admissão exemplo", "S"), (2, "Transferência exemplo", "S"), (3, "Alta do bloco exemplo", "N")]:
        ins("CCTIPOMOVIMENTACAOPAC", list(v))
    # caráter: natureza pelo nome (de-para de valores); 4 sem par: NULL com valor_fora_do_dominio, fica o padrão
    for v in [(1, "ELETIVA", "S"), (2, "Urgência", "S"), (3, "EMERGÊNCIA", "T"), (4, "Caráter exemplo", "S")]:
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
    return {
        "CCTIPOLOCALBLC": {"gravados": 5, "pendencias": {"valor_presumido": 5, "valor_fora_do_dominio": 1}},
        "CCTIPOMOVIMENTACAOPAC": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
        "CCTPURGENCIA": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1}},
        "PRFA_CAD_MODO_RESPIR": {"gravados": 3, "pendencias": {}},
        "PRFA_CAD_POSICAO_CIR": {"gravados": 3, "pendencias": {}},
        "PRFA_TIPO_SINAL": {"gravados": 3, "pendencias": {"restricao_destino_1062": 1}},
        "PRTIPO_PROFISSIONAL": {"gravados": 4, "pendencias": {}},
        "TBANESTESIA": {"gravados": 5, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "CCAGENDA_EXC_CANC": {"gravados": 3, "pendencias": {"valor_presumido": 5, "pai_inexistente": 3,
                                                            "restricao_destino_1048": 2}},
        "CCPARAM": {"gravados": 4, "pendencias": {"valor_presumido": 7, "valor_fora_do_dominio": 8, "pai_inexistente": 1,
                                                  "restricao_destino_1048": 2, "restricao_destino_1062": 1}},
    }
