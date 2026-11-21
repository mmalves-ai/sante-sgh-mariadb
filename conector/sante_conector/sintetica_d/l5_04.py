"""Fatia L5-04 (cadastros e administração, domínios do cadastro-base): tabelas da origem e dados 100% falsos.

Carregadas pelo mapa: complexidade e porte do estabelecimento, finalidade do endereço, tipo de telefone, capacidade
civil, classe da fonte pagadora, escolaridade, clínica (situação A/I, natureza presumida), estado civil da folha
(código com prefixo de domínio) e do cadastro (variantes por sexo adotadas num id só), credor pessoa física com a conta
(só quando há banco), técnicos do laboratório e da hemoterapia como PROFISSIONAL (principal) da pessoa física
gravada antes (adotada pelo CPF; profissional da mesma pessoa adotado), situação A/I e S/N (inativo sem data recusado
pelo CHECK), fonte do recurso das compras (origem_recurso_compra), pré-cadastro das agendas (paciente e
situação pelo prontuário), titular da cobertura (tipo, CNPJ e parentesco) e o complemento do solicitante externo (CNS).
Fora (NAO_CARREGADAS): nenhuma. A linha marcadora sem pessoa do cadastro de técnicos cai por linha (1048).
Rodada 3: inscrição no conselho (conselho e UF por de-para oficial, ocupação pelo CBO da tabela de CBO, sequência por
profissional, situação, competências), especialidade x procedimento (procedimento pelo código, ambíguo entre tabelas
de honorários recusado com pai_ambiguo) e feriado (ano 9999 = anual com dia e mês; abrangência do estabelecimento).
Anomalias: descrição nula, colisão de caixa em código de 1 caractere, nome com espaços repetidos, código eSocial fora da
faixa, CPF inválido e repetido (adoção), banco fora do catálogo, CEP zero, município ausente, convênio inexistente,
data de nascimento sentinela, pais de outras fatias ausentes da imagem (referência encadeada: pai_inexistente),
situação fora do domínio, feriado com ano 9999.
"""
import datetime
import pathlib

from sante_conector import sentinela

# o motor aplica a regra do brief (codigo_colisao_caixa) ou a colisão cai na restrição do destino (1062)? O esperado
# acompanha o motor: a conferência da carga confere o efeito REAL.
MOTOR_APLICA_COLISAO = "colisoes_caixa" in (pathlib.Path(__file__).resolve().parents[1] / "carga_mapa.py").read_text(
    encoding="utf-8")


def cpf_falso(base9):
    """CPF de 11 dígitos com dígitos verificadores válidos a partir de 9 dígitos inventados."""
    d = [int(x) for x in "%09d" % base9]
    for n in (10, 11):
        q = sum(x * p for x, p in zip(d, range(n, 1, -1))) % 11
        d.append(0 if q < 2 else 11 - q)
    return int("".join(map(str, d)))


CPF_A, CPF_B, CPF_C, CPF_D, CPF_E = (cpf_falso(x) for x in (11144477, 222555888, 333666999, 44477700, 155566677))
# CPF guardado em DOUBLE na origem: o motor o lê como documento? (pedido em saida/L5-04.json; o esperado acompanha)
MOTOR_CPF_DOUBLE = sentinela.aplicar("cpf", float(CPF_E))[1] is None

DDL = """
CREATE TABLE TBCOMPLEXIDADE_HOSPITALAR (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50), ID_DIGITAL VARCHAR(36));
CREATE TABLE TBPORTE_HOSPITALAR (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50), ID_DIGITAL VARCHAR(36));
CREATE TABLE CDTPENDERECO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20));
CREATE TABLE FPTPTEL (ID CHAR(1) NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE TBCAPACIDADE_CIVIL (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(30) NOT NULL);
CREATE TABLE TBCLASSC (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50));
CREATE TABLE TBCLINICA (COD VARCHAR(1) NOT NULL PRIMARY KEY, NOME VARCHAR(20), SITUACAO VARCHAR(1),
  ID_TBTISSTPINTER SMALLINT);
CREATE TABLE TBECIV (ID SMALLINT NOT NULL PRIMARY KEY, COD SMALLINT NOT NULL, SEXO VARCHAR(1) NOT NULL, NOME VARCHAR(15));
CREATE TABLE TBESCOLARIDADE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(80));
CREATE TABLE TBFERIAD (ID SMALLINT NOT NULL PRIMARY KEY, DATA DATE NOT NULL, NOME VARCHAR(50), FACULTATIVO CHAR(1));
CREATE TABLE FAMEDSOL (CPF DOUBLE PRECISION NOT NULL PRIMARY KEY, NOME VARCHAR(70), CNS DOUBLE PRECISION, CRM INTEGER);
CREATE TABLE FPECIV (COD_ECIV SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50), COD_ESOCIAL SMALLINT);
CREATE TABLE GETABFUN (ID SMALLINT NOT NULL PRIMARY KEY, EMPRESA SMALLINT NOT NULL, COD INTEGER NOT NULL, NOME VARCHAR(70),
  EVENTO SMALLINT NOT NULL, DIA_VENC SMALLINT, VLR_COTA NUMERIC(9,2), CLASSIF SMALLINT, DOCUMENTO VARCHAR(15),
  ORGAO VARCHAR(10), INSS VARCHAR(11), ISS VARCHAR(13), CPF BIGINT, SITUACAO VARCHAR(1), HORA_TEC NUMERIC(18,2),
  FONE VARCHAR(15), RAMAL VARCHAR(4), EMAIL VARCHAR(40), BANCO SMALLINT, NOMEBCO VARCHAR(40), AGENCIA VARCHAR(9),
  CONTA BIGINT, DIGITO VARCHAR(2), ID_CVLOCAL SMALLINT);
CREATE TABLE REPACAGN (PACIENTE VARCHAR(70) NOT NULL, NOME VARCHAR(40), ENDERECO VARCHAR(40), COMPL VARCHAR(15),
  CEP INTEGER, BAIRRO VARCHAR(30), CIDADE VARCHAR(30), UF VARCHAR(2), IBGE INTEGER, FONE VARCHAR(15), CONV INTEGER,
  PRONT INTEGER, ESPEC SMALLINT, IDENT VARCHAR(15), TP_AGE SMALLINT, UNIDADE SMALLINT, CRM INTEGER, DATA DATE,
  CPF BIGINT, NUMERO INTEGER, OBS BLOB SUB_TYPE 1, TIPOPAC CHAR(1), OTMU CHAR(1), DATA_NASCIMENTO DATE NOT NULL,
  PRIMARY KEY (PACIENTE, DATA_NASCIMENTO));
CREATE TABLE RESEGUR (REG INTEGER NOT NULL PRIMARY KEY, PROFI VARCHAR(30), ENDERECO VARCHAR(40), NUMERO INTEGER,
  BAIRRO VARCHAR(30), CIDADE VARCHAR(30), UF VARCHAR(2), CEP INTEGER, IDENT VARCHAR(15), NOME VARCHAR(70),
  FONE VARCHAR(15), CPF DOUBLE PRECISION, DTNASC DATE, PARENTE SMALLINT, COMPL VARCHAR(15), CNPJ DOUBLE PRECISION,
  TIPO VARCHAR(1));
CREATE TABLE SHTECNIC (CRM_TECNICO INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(70), CPF DOUBLE PRECISION,
  ENDERECO VARCHAR(40), NUMERO INTEGER, COMPL VARCHAR(20), BAIRRO VARCHAR(30), CIDADE VARCHAR(30), UF VARCHAR(2),
  FONE VARCHAR(20), CELULAR VARCHAR(20), IBGE INTEGER, CONSELHO_PROFISSIONAL INTEGER, NCONSELHO INTEGER,
  SITUACAO CHAR(1) NOT NULL);
CREATE TABLE SIPACAGN (NOME VARCHAR(40) NOT NULL, PACIENTE VARCHAR(70) NOT NULL, ENDERECO VARCHAR(40),
  COMPL VARCHAR(15), CEP INTEGER, BAIRRO VARCHAR(30), CIDADE VARCHAR(30), UF VARCHAR(2), IBGE INTEGER,
  FONE VARCHAR(15), PRONT INTEGER, ESPEC SMALLINT, CONV SMALLINT, UNIDADE SMALLINT, TP_AGE SMALLINT,
  IDENT VARCHAR(15), CRM INTEGER NOT NULL, DATA DATE, CPF BIGINT, NUMERO INTEGER, OBS BLOB SUB_TYPE 1,
  PRIMARY KEY (NOME, CRM, PACIENTE));
CREATE TABLE SITECNIC (CRM INTEGER NOT NULL PRIMARY KEY, CPF BIGINT NOT NULL, NOME VARCHAR(70) NOT NULL,
  APELIDO VARCHAR(25), CEP INTEGER, ENDERECO VARCHAR(40), NUMERO VARCHAR(5), COMPL VARCHAR(5), BAIRRO VARCHAR(30),
  CIDADE VARCHAR(30), UF VARCHAR(2), FONE VARCHAR(15), CELULAR VARCHAR(15), IBGE INTEGER, ATIVO CHAR(1));
CREATE TABLE TBCBOPRO (ID INTEGER NOT NULL PRIMARY KEY, ID_TBCBOSUS INTEGER NOT NULL, UF VARCHAR(2) NOT NULL,
  COD INTEGER NOT NULL, ID_TBPROFIS INTEGER NOT NULL, VINC_EMPR VARCHAR(1) NOT NULL, CONS_PROF VARCHAR(7),
  ATIVO VARCHAR(1), VINCULO SMALLINT, COMP_INICIAL INTEGER, COMP_FINAL INTEGER, ATENDE_SUS CHAR(1),
  CRM_DIGITO VARCHAR(1), REGIONAL INTEGER, ID_TBSIGLACONSPROF SMALLINT, REG_QUALIF_ESPECIALISTA VARCHAR(9),
  AXREG_ID_ANESTHESIOLOGISTS BIGINT, ID_DIGITAL VARCHAR(36));
CREATE TABLE TBESPPRO (PROCTO INTEGER NOT NULL, ESP SMALLINT NOT NULL, PRIMARY KEY (PROCTO, ESP));
CREATE TABLE TBFONTE_PAGADORA (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(60), ID_DIGITAL VARCHAR(36));
CREATE TABLE TBCBOSUS (ID INTEGER NOT NULL PRIMARY KEY, COD VARCHAR(6));
CREATE TABLE TBPROCTO (ID INTEGER NOT NULL PRIMARY KEY, ID_TBCTRTHM SMALLINT NOT NULL, COD_PROCEDIMENTO BIGINT NOT NULL,
  NOME VARCHAR(100), TP_MODULO CHAR(1));
"""

# pais de outras fatias (convênio) registrados como já carregados; os da referência encadeada (atendimento, paciente,
# cobertura, solicitante) ficam AUSENTES da imagem: a carga prova o caminho pai_inexistente sem inventar a origem deles
# TBCBOSUS (fora do mapa) e TBPROCTO (código do procedimento) só são LIDOS pela referência encadeada/alternativa;
# o profissional, a especialidade e o procedimento (item faturável) entram como já carregados
PAIS_EXTERNOS = {"TBCONVEN": ["1"], "TBPROFIS": ["1", "2", "4"], "TBESPEC": ["1", "2"],
                 "TBPROCTO": ["11", "12", "13"]}
# pais de outras fatias que estão na imagem só para serem LIDOS (chave alternativa, encadeada): não são carregados
# na conferência desta fatia (a declaração deles é da fatia dona: TBPROCTO é da L8-03). Sem isso a carga regravaria o
# pai externo (alteracao_aguarda_sincronizar) e a conciliação de item_faturavel e grupo_faturamento entraria aqui.
SO_LIDOS = ("TBPROCTO", "TBCBOSUS")


def _mapa_teste():
    from sante_conector import mapa
    m = mapa.carregar_execucao()
    m["colunas_decl"] = [c for c in m.get("colunas_decl", []) if c["tabela"] not in SO_LIDOS]
    return m


def __getattr__(nome):  # MAPA_TESTE preguiçoso: o mapa só é lido quando a conferência pede
    if nome == "MAPA_TESTE":
        return _mapa_teste()
    raise AttributeError(nome)
PREPARO_DESTINO = (
    "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
    " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
    " INSERT INTO banco (codigo_compensacao, codigo_ispb, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES"
    " ('001', '00000001', 'Banco exemplo um', '2020-01-01', 'exemplo', UTC_TIMESTAMP(3)),"
    " ('237', '00000237', 'Banco exemplo dois', '2020-01-01', 'exemplo', UTC_TIMESTAMP(3));"
    " INSERT INTO municipio_ibge (codigo_ibge, nome, unidade_federativa_id, criado_em) VALUES"
    " ('3550308', 'Municipio exemplo', 1, UTC_TIMESTAMP(3));"
    " INSERT IGNORE INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES"
    " ('35', 'SP', 'Unidade exemplo SP', 1, UTC_TIMESTAMP(3));"
    " INSERT IGNORE INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES"
    " ('06', 'CRM', 'Conselho exemplo um', UTC_TIMESTAMP(3)), ('07', 'COREN', 'Conselho exemplo dois', UTC_TIMESTAMP(3));"
    " INSERT IGNORE INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES"
    " ('225125', 'Ocupacao exemplo', UTC_TIMESTAMP(3))")

# tabelas da fatia fora da carga, com o motivo (pedidos ao integrador em docs/obra/fatias/f4/saida/L5-04.json)
NAO_CARREGADAS = {}


def linhas(r, ins):
    for x in [(1, "Baixa complexidade", "00000000-0000-0000-0000-000000000001"), (2, "Média complexidade", None),
              (3, "Alta complexidade", None), (4, None, None)]:
        ins("TBCOMPLEXIDADE_HOSPITALAR", list(x))
    for x in [(1, "Pequeno   porte"), (2, "Médio porte"), (3, "Grande porte"), (4, "Porte especial")]:
        ins("TBPORTE_HOSPITALAR", list(x) + [None])
    for x in [(1, "Residencial"), (2, "Comercial"), (3, "Cobrança"), (4, "Correspondência"), (5, "   ")]:
        ins("CDTPENDERECO", list(x))
    for x in [("R", "Residencial"), ("C", "Celular"), ("M", "Comercial"), ("c", "Celular  recado")]:
        ins("FPTPTEL", list(x))
    for x in [(1, "Plena"), (2, "Relativamente incapaz"), (3, "Absolutamente incapaz")]:
        ins("TBCAPACIDADE_CIVIL", list(x))
    for x in [(1, "Particular"), (2, "Convênio"), (3, "Público"), (4, "Gratuidade"), (5, "Seguro  trânsito"),
              (6, None)]:
        ins("TBCLASSC", list(x))
    for x in [("M", "Clínica médica", "A", 1), ("C", "Cirúrgica", "A", 2), ("O", "Obstetrícia", "I", None),
              ("P", "Pediatria", None, None)]:
        ins("TBCLINICA", list(x))
    for x in [(1, 1, "M", "Solteiro"), (2, 1, "F", "Solteira"), (3, 2, "M", "Casado"), (4, 2, "F", "Casada")]:
        ins("TBECIV", list(x))
    for i, n in enumerate(["Analfabeto", "Fundamental incompleto", "Fundamental completo", "Médio completo",
                           "Superior completo"], 1):
        ins("TBESCOLARIDADE", [i, n])
    d = datetime.date
    for x in [(1, d(2026, 1, 1), "Confraternização universal", "N"), (2, d(2026, 2, 17), "Carnaval", "S"),
              (3, d(2026, 4, 21), "Tiradentes", None), (4, d(1899, 12, 30), "Feriado sem data", "N"),
              (5, d(2026, 11, 20), "Feriado da cidade", "X"), (6, d(2026, 12, 25), None, "N"),
              (7, d(9999, 12, 25), "Feriado fixo de exemplo", "N"), (8, d(9999, 9, 7), "Outro feriado fixo", None)]:
        ins("TBFERIAD", list(x))
    for x in [("X", None, "Z", None), ("c", "Cirurgia  dia", "A", None)]:
        ins("TBCLINICA", list(x))
    for x in [(5, 6, "M", "União estável"), (6, 6, "F", "União estável"), (7, 5, "M", None)]:
        ins("TBECIV", list(x))
    for x in [(1, "Solteiro", 1), (2, "Casado", 2), (3, "Divorciado", 3), (4, "Viúvo", 9), (5, None, 5)]:
        ins("FPECIV", list(x))
    for x in [(1, "Particular", None), (2, "Convênio  SUS", None), (3, None, None)]:
        ins("TBFONTE_PAGADORA", list(x))  # fonte do recurso da compra; descrição nula recusa (1048)

    def credor(i, nome, cpf, inss, banco, ag, conta, dig):
        ins("GETABFUN", [i, 1, 100 + i, nome, 1, 10, None, None, None, None, inss, None, cpf, "A", None, None, None,
                         None, banco, None, ag, conta, dig, None])
    credor(1, "Prestador Um", CPF_A, "12345678901", 1, "1234", 98765, "0")
    credor(2, "Prestador  Dois", CPF_B, "ABC", None, None, None, None)
    credor(3, "Prestador Tres", CPF_A, None, 237, "0001", 555, None)      # mesmo CPF: pessoa adotada, conta nova
    credor(4, "Prestador Quatro", 123, None, 999, "1", 2, None)          # CPF inválido, banco fora do catálogo
    credor(5, None, None, None, None, None, None, None)                  # sem nome: recusa
    # técnico do laboratório: 101 mesma pessoa do técnico da hemoterapia (pessoa e profissional adotados, se o CPF em
    # DOUBLE já é lido); 102 pessoa do credor (adotada); 103 CPF inválido e inativo sem data (4025); 104 situação fora
    for crm, cpf, nome, apel, fone, ativo in [(101, CPF_C, "Tecnico Um", "Tec  Um", "1133334444", "S"),
                                              (102, CPF_A, "Tecnico Dois", None, None, None),
                                              (103, 123, "Tecnico Tres", None, None, "N"),
                                              (104, CPF_D, "Tecnico Quatro", None, None, "X")]:
        ins("SITECNIC", [crm, cpf, nome, apel, None, None, None, None, None, None, None, fone, "11999990000", None, ativo])
    d = datetime.date

    def agenda(pac, cep, ibge, conv, cpf, num, obs, nasc, pront=None):
        ins("REPACAGN", [pac, None, "Rua Exemplo", "Apto 1", cep, "Centro", "Cidade", "SP", ibge, "1199990000", conv,
                         pront, None, None, None, None, None, d(2026, 3, 1), cpf, num, obs, None, None, nasc])
    agenda("Paciente Agenda Um", 1310100, 3550308, 1, CPF_D, 100, "observação\nlinha 2", d(1980, 5, 1))
    agenda("Paciente  Agenda Dois", 0, 9999999, 7, None, 0, None, d(1990, 1, 2))
    agenda("Paciente Agenda Tres", None, None, None, None, None, None, d(1899, 12, 30))
    agenda("Paciente Agenda Quatro", None, None, None, 123, None, None, d(2001, 2, 3))
    agenda("Paciente Agenda Cinco", None, None, None, None, None, None, d(1985, 6, 7), pront=77)  # paciente ausente
    for nome, pront in [("Agenda exame", 10), ("Agenda exame", None)]:
        ins("SIPACAGN", [nome, "Paciente Exame %s" % pront, None, None, 1310100, None, None, None, 3550308, None, pront,
                         None, 1, None, None, None, 500, d(2026, 4, 1), None, 12, None])
    for reg, cpf, nasc, cnpj, tipo in [(1, None, d(1970, 1, 1), None, "F"), (2, float(CPF_E), d(1970, 1, 1), None, "F"),
                                       (3, None, None, 11222333000181.0, "J")]:  # J: contrato coletivo, com CNPJ
        ins("RESEGUR", [reg, None, "Rua Titular", 10, "Bairro", None, "SP", 1310100, None, "Titular %d" % reg, None, cpf,
                        nasc, 1, None, cnpj, tipo])
    for cpf, crm in [(float(CPF_B), 1234), (float(CPF_C), None)]:
        ins("FAMEDSOL", [cpf, "Solicitante SUS", 700000000000005.0, crm])
    # técnico da hemoterapia: 1 linha marcadora sem pessoa (1048 só nela); 2 pessoa nova (CPF em DOUBLE); 3 inativo sem
    # data (4025); 4 CPF inválido e situação fora do domínio (padrão ativo)
    for crm, nome, cpf, sit in [(1, None, None, "A"), (2, "Tecnico Hemo Um", float(CPF_C), "A"),
                                (3, "Tecnico Hemo Dois", None, "I"), (4, "Tecnico  Hemo Tres", 123.0, "Z")]:
        ins("SHTECNIC", [crm, nome, cpf, None, None, None, None, None, "SP", "1133335555", None, None, 6, 1000 + crm, sit])
    # CBO da origem: 10 no catálogo, 11 fora do catálogo; 999 (ausente) é pai_inexistente
    ins("TBCBOSUS", [10, "225125"])
    ins("TBCBOSUS", [11, "999999"])
    for x in [(1, 10, "SP", 12345, 1, "S", "CRM", "S", None, 202001, 202312, "S", "7", None, 1),
              (2, 10, "SP", 54321, 1, "N", "COREN", "N", None, 202013, None, "N", None, None, 2),   # competência inválida
              (3, 10, "SP", 11111, 2, "S", "CRF", "S", None, None, None, None, None, None, None),   # conselho fora
              (4, 10, "SP", 22222, 3, "S", "CRM", "S", None, None, None, None, None, None, None),   # profissional ausente
              (5, 10, "SP", 33333, 2, "S", None, None, None, None, None, None, None, None, 1),     # sem sigla
              (6, 11, "XX", 44444, 1, "S", "CRM", "X", None, None, None, None, None, None, None),   # UF e CBO fora
              (7, 999, "SP", 55555, 4, "N", "CRM", "S", None, 202201, 202105, "S", None, None, None)]:  # fim < início
        ins("TBCBOPRO", list(x) + [None, None, None])
    # procedimento por código: 101 numa tabela só; 102 em duas tabelas de honorários (ambíguo); 103 ausente
    for x in [(11, 1, 101, "Procedimento exemplo um"), (12, 1, 102, "Procedimento exemplo dois"),
              (13, 2, 102, "Procedimento exemplo dois")]:
        ins("TBPROCTO", list(x) + [None])
    for x in [(101, 1), (101, 2), (102, 1), (103, 1), (101, 99)]:
        ins("TBESPPRO", list(x))
    # pendência por coluna: o prontuário sem paciente conta no paciente, na situação e na conversão (3); o titular
    # sem cobertura conta na cobertura e no parentesco (TBPARENTE fora da imagem)
    doc = {} if MOTOR_CPF_DOUBLE else {"documento_invalido": 2}  # CPF (REG 2) e CNPJ (REG 3) em DOUBLE
    return {
        "TBCOMPLEXIDADE_HOSPITALAR": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "TBPORTE_HOSPITALAR": {"gravados": 4, "pendencias": {}},
        "CDTPENDERECO": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1}},
        "FPTPTEL": ({"gravados": 2, "pendencias": {"codigo_colisao_caixa": 2}} if MOTOR_APLICA_COLISAO  # as duas
                    else {"gravados": 3, "pendencias": {"restricao_destino_1062": 1}}),
        "TBCAPACIDADE_CIVIL": {"gravados": 3, "pendencias": {}},
        "TBCLASSC": {"gravados": 5, "pendencias": {"valor_presumido": 6, "restricao_destino_1048": 1}},
        "TBESCOLARIDADE": {"gravados": 5, "pendencias": {}},
        "TBCLINICA": {"gravados": 3, "pendencias": {"valor_presumido": 4, "codigo_colisao_caixa": 2,
                                                     "valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "FPECIV": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}},
        "TBECIV": {"gravados": 6, "pendencias": {"adotado_existente": 3, "restricao_destino_1048": 1}},
        "GETABFUN": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1, "adotado_existente": 1,
                                                    "documento_invalido": 2, "catalogo_codigo_inexistente": 1,
                                                    "restricao_destino_1048": 1}},
        # técnico: tipo presumido em toda linha lida (4); 101 adota a pessoa e o profissional do técnico da hemoterapia
        # só quando o CPF em DOUBLE já é lido (pedido); 103 inativo sem data recusado pelo CHECK (4025)
        "SITECNIC": {"gravados": 3, "pendencias": {"adotado_existente": 3 if MOTOR_CPF_DOUBLE else 1,
                                                    "documento_invalido": 1, "valor_fora_do_dominio": 1,
                                                    "valor_presumido": 4, "restricao_destino_4025": 1}},
        # marcador sem pessoa recusa só a linha (1048); inativo sem data (4025); CPF em DOUBLE e CPF inválido
        "SHTECNIC": {"gravados": 2, "pendencias": {"documento_invalido": 1 if MOTOR_CPF_DOUBLE else 2,
                                                    "valor_fora_do_dominio": 1, "valor_presumido": 4,
                                                    "restricao_destino_1048": 1, "restricao_destino_4025": 1}},
        "TBFONTE_PAGADORA": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        "REPACAGN": {"gravados": 4, "pendencias": {"valor_fora_do_dominio": 1, "catalogo_codigo_inexistente": 1,
                                                    "pai_inexistente": 4, "data_sentinela": 1, "documento_invalido": 1,
                                                    "restricao_destino_1048": 1}},
        "SIPACAGN": {"gravados": 0, "pendencias": {"pai_inexistente": 4, "restricao_destino_1048": 2}},
        "RESEGUR": {"gravados": 0, "pendencias": dict({"pai_inexistente": 6, "restricao_destino_1048": 3}, **doc)},
        "FAMEDSOL": {"gravados": 0, "pendencias": {"pai_inexistente": 2}},
        # inscrição: 1 e 2 gravam (2 com competência inválida); conselho fora (CRF), UF fora (XX) e CBO fora: catálogo
        # inexistente; sem sigla e profissional ausente: recusa 1048; competência final antes da inicial: 4025
        "TBCBOPRO": {"gravados": 2, "pendencias": {"catalogo_codigo_inexistente": 3, "pai_inexistente": 2,
                                                   "valor_fora_do_dominio": 2, "restricao_destino_1048": 4,
                                                   "restricao_destino_4025": 1}},
        # código em duas tabelas de honorários: pai_ambiguo; código e especialidade ausentes: pai_inexistente
        "TBESPPRO": {"gravados": 2, "pendencias": {"vigencia_sem_fonte": 5, "pai_ambiguo": 1, "pai_inexistente": 2,
                                                   "restricao_destino_1048": 3}},
        # data sentinela conta nas quatro declarações da DATA (recorrência, dia, mês, data) e recusa a linha
        "TBFERIAD": {"gravados": 6, "pendencias": {"data_sentinela": 4, "valor_fora_do_dominio": 1,
                                                   "restricao_destino_1048": 2}},
    }
