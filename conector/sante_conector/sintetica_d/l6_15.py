"""Fatia L6-15 (prontuário, assinatura e assistência, módulo INT): tabelas da origem com os mesmos nomes e tipos do
dicionário (as não carregadas só com parte das colunas) e dados 100% falsos.

Carregadas (CARREGADAS, 8): desfecho da internação, motivo de saída, central reguladora + sistema externo (dois
destinos), serviço de regulação, categoria de acomodação, local e leito de observação e a ocupação do leito de
observação. Anomalias cobertas:
- nome nulo ou só de espaços (NOT NULL do destino: restricao_destino_1048), espaços internos (texto_nome colapsa);
- S/N e A/I fora do domínio (valor_fora_do_dominio, fica o padrão), literais presumidos (valor_presumido por linha);
- de-para de valores: classe do motivo de saída pelo código da AIH (óbito com declaração, permanência que não encerra,
  evasão sem alta médica; código fora da tabela pública: valor_fora_do_dominio em cada coluna derivada), sexo do local
  pela sigla do cadastro de sexo (TBSEXO, lido só pela referência encadeada) e situação da ocupação pela presença da
  saída na origem (sentinela inclusive: encerrada);
- código duplicado na chave única do destino (1062: sigla da central, serviço na central, local, leito no local,
  duas ocupações abertas no mesmo leito);
- vigência e ocupação com fim antes do início (CHECK: 4025), quantidade negativa em UNSIGNED (1264);
- data sentinela (data_sentinela) e data e hora com data sentinela (hora_sem_data, recusa pela NOT NULL); saída da
  ocupação com data sentinela, 00:00 (data_sentinela) e com hora (hora_sem_data): gravada com saída NULL e situação
  'encerrada' (a origem tem saída), sem ocupar o leito vigente;
- pai recusado (pai_pendente: serviço de central recusada, leito de local recusado, ocupação de leito recusado), pai
  nunca visto (pai_inexistente: centro de custo em coluna anulável fica NULL; central, tipo de leito e atendimento
  em coluna NOT NULL recusam a linha) e pais de fora da fatia (PAIS_EXTERNOS);
- BLOB de texto com quebra de linha e espaços internos preservados.
Rodada 3 (cobertura total): carregam também (13) leito (RILEITOS) completado por TBLEITO, quarto completado por
TBACOMODLEITO (o quarto é de RIACOMOD, fatia L6-14: pai externo criado no PREPARO_DESTINO), internação, pré-internação,
transferência de leito, as quatro trocas da internação e, na trilha de auditoria com o retrato completo, a alta
desfeita, a internação excluída e o histórico do leito. Anomalias: código de leito repetido na unidade (1062) e na
chave alternativa (pai_ambiguo), sigla sem par com o literal concorrente (situação livre, caráter eletiva), sem data
de entrada (1048), alta sem motivo (CHECK), paciente vigente repetido (1062), hora inválida, CID fora do catálogo
oficial, internação recusada levando as movimentações (pai_pendente), CPF do profissional nunca visto, troca sem valor
novo (CHECK). Pais lidos na origem (PAIS_ORIGEM: prontuário, inscrição -> profissional, CPF, CID) com DDL gerado do
dicionário. Não carregada: só a terminologia TISS de regime de internação (catálogo oficial, regra 7).
"""
import csv
import datetime
from pathlib import Path

DDL = """
CREATE TABLE TBSEXO (CODIGO INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(20), SIGLA CHAR(1));
CREATE TABLE TBDESFECHO_INTERNACAO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL, ATIVO CHAR(1));
CREATE TABLE TBMOTALT (COD SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(80), STATUS VARCHAR(1), NOME_ANT VARCHAR(80),
  ID_DIGITAL VARCHAR(36));
CREATE TABLE TBREGUL_SISTEMA (ID INTEGER NOT NULL PRIMARY KEY, SIGLA VARCHAR(30), ATIVO VARCHAR(1));
CREATE TABLE TBREGUL_SERVICO (ID INTEGER NOT NULL PRIMARY KEY, ID_TBREGUL_SISTEMA INTEGER, COD VARCHAR(50),
  DESCRICAO VARCHAR(100), ATIVO VARCHAR(1));
CREATE TABLE TBTIPOACOMOD (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(45));
CREATE TABLE TBTISSREGINT (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(15), DATA_VIGENCIA_INICIAL DATE,
  DATA_VIGENCIA_FINAL DATE);
CREATE TABLE RELOCLEITO (ID SMALLINT NOT NULL PRIMARY KEY, COD_LOCAL_LEITO VARCHAR(6) NOT NULL, NOME VARCHAR(45),
  ID_TBCENCUS INTEGER, QTD_LEITO SMALLINT NOT NULL, ID_TBSEXO INTEGER NOT NULL, ID_TBTIPOACOMOD SMALLINT NOT NULL,
  TP_CONVENIO SMALLINT NOT NULL, ID_TBCLINICA VARCHAR(1), COR VARCHAR(20), IDADE_MINIMA SMALLINT,
  ID_TBUNID_IDADE_MIN SMALLINT, IDADE_MAXIMA SMALLINT, ID_TBUNID_IDADE_MAX SMALLINT);
CREATE TABLE RELEITO (ID SMALLINT NOT NULL PRIMARY KEY, ID_RELOCLEITO SMALLINT NOT NULL, COD_LEITO VARCHAR(5) NOT NULL,
  ID_RETPLEITO SMALLINT NOT NULL, ATIVO CHAR(1), ID_TBTABDTH INTEGER);
CREATE TABLE REOCUPLEITO (ID_RECADATE INTEGER NOT NULL, TIPO CHAR(1) NOT NULL, DATA_HORA_ENTRADA TIMESTAMP NOT NULL,
  ID_RELEITO SMALLINT NOT NULL, DATA_HORA_SAIDA TIMESTAMP, JUSTIFICATIVA BLOB SUB_TYPE 1, COD INTEGER NOT NULL,
  ID_DIGITAL VARCHAR(36), CONSTRAINT PK_REOCUPLEITO PRIMARY KEY (ID_RECADATE, TIPO, DATA_HORA_ENTRADA));
"""
_MAPA = Path(__file__).resolve().parents[2] / "mapa"
# internação (carregadas nesta rodada) e pais lidos na origem (cadeias e chaves alternativas): DDL gerado do dicionário
# (`colunas.tsv`), com TODAS as colunas, porque o `#retrato:*` e as referências leem a tabela inteira
NOVAS = ["TBACOMODLEITO", "RILEITOS", "TBLEITO", "RIPREINT", "RICADINT", "RIALTA_EXCLUSAO", "RIEXCINT", "RITRANSF",
         "RITRFCLI", "RITRFCON", "RITRFESP", "RITRFMED", "HTLEITO"]
PAIS_ORIGEM = ["RICADPAC", "TBCBOPRO", "TBPROFIS", "TBCID10"]


def _ler(arq):
    with open(_MAPA / arq, encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t"))


_COLS, _CHAVE = {}, {}
for _r in _ler("colunas.tsv"):
    if _r["tabela"] in NOVAS or _r["tabela"] in PAIS_ORIGEM:
        _COLS.setdefault(_r["tabela"], []).append((_r["coluna"], _r["forma"], _r["regra"]))
for _r in _ler("tabelas.tsv"):
    if _r["tabela"] in _COLS:
        _CHAVE[_r["tabela"]] = [x for x in _r["chave"].split(",") if x]
COLUNAS = {t: [c for c, _, _ in v] for t, v in _COLS.items()}


def _tipo(forma, regra):
    if forma == "BLOB":
        return "BLOB SUB_TYPE %d" % (1 if regra == "texto_longo" else 0)
    return "DOUBLE PRECISION" if forma == "DOUBLE" else forma


DDL += "".join("CREATE TABLE %s (%s%s);\n" % (
    t, ", ".join('"%s" %s%s' % (c, _tipo(f, rg), " NOT NULL" if c in _CHAVE[t] else "") for c, f, rg in _COLS[t]),
    (", PRIMARY KEY (%s)" % ", ".join('"%s"' % c for c in _CHAVE[t])) if _CHAVE[t] else "") for t in NOVAS + PAIS_ORIGEM)

# pais de fora da fatia, dados como já carregados (ids sequenciais: `id_externo`). Os pais lidos na origem
# (PAIS_ORIGEM) também ficam aqui, com todas as linhas: entram como já carregados e não são regravados
PAIS_EXTERNOS = {"TBCENCUS": ["10", "20"], "RETPLEITO": ["1", "2"],
                 "RECADATE": ["5001", "5002", "5003", "5004", "5005", "5006"],
                 "RIBLOCOS": ["A", "A/unidade_internacao", "B", "B/unidade_internacao"],
                 "RIACOMOD": ["A|101", "A|102", "B|201"],
                 "TBCLINICA": ["C", "P"], "TBCONVEN": ["1", "2"], "TBESPEC": ["10", "20"],
                 "TBUSERS": ["usuario.exemplo"], "TBTIPPLANO": ["1"],
                 "TBCID10": ["1", "2"], "RICADPAC": ["1", "2", "3", "4", "5", "6"],
                 "ATCABECATEND": [str(6000 + k) for k in range(1, 11)]}


def id_externo(tabela, chave):
    """Id que a conferência dá ao pai externo: sequencial na ordem das tabelas e das chaves."""
    i = 0
    for t, ks in sorted(PAIS_EXTERNOS.items()):
        for k in ks:
            i += 1
            if (t, k) == (tabela, chave):
                return i
    raise KeyError((tabela, chave))


_CAT = ("CREATE TABLE IF NOT EXISTS {t} (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(30) NOT NULL,"
        " UNIQUE KEY uq_{t}_codigo (codigo)); INSERT INTO {t} (codigo) VALUES {v};")
# catálogos-base do produto (semente do 'criar novo cliente', pedido M2b à F2.2), procurados pelo código (`cod:`);
# os quartos de RIACOMOD (fatia L6-14) com o id do pai externo, para TBACOMODLEITO completar; e o CID do catálogo
# oficial (só A00: B01 fica ausente)
PREPARO_DESTINO = "\n".join([
    "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
    " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo');",
    _CAT.format(t="situacao_leito", v="('livre'), ('ocupado'), ('reservado'), ('higienizacao'), ('interditado'),"
                                      " ('manutencao'), ('bloqueado'), ('inativo')"),
    _CAT.format(t="carater_admissao", v="('eletiva'), ('urgencia'), ('emergencia')"),
    _CAT.format(t="modalidade_internacao", v="('clinica'), ('cirurgica'), ('obstetrica'), ('pediatrica'),"
                                             " ('psiquiatrica')"),
    _CAT.format(t="motivo_troca_leito", v="('migracao')"),
    _CAT.format(t="tipo_troca_internacao", v="('clinica'), ('fonte_pagadora'), ('especialidade'), ('profissional')"),
    "INSERT INTO acomodacao (id, estabelecimento_id, unidade_internacao_id, categoria_acomodacao_id, codigo, nome,"
    " origem, criado_em) VALUES " + ", ".join(
        "(%d, 1, %d, 1, '%s', 'Quarto %s', 'migracao', UTC_TIMESTAMP(3))" % (
            id_externo("RIACOMOD", k), id_externo("RIBLOCOS", k[0] + "/unidade_internacao"), k[2:], k[2:])
        for k in PAIS_EXTERNOS["RIACOMOD"]) + ";",
    "CREATE TABLE IF NOT EXISTS regime_atendimento_internacao (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
    " codigo VARCHAR(30) NOT NULL, descricao VARCHAR(150) NOT NULL, codigo_tiss VARCHAR(2) NULL);",
    "INSERT INTO regime_atendimento_internacao (id, codigo, descricao, codigo_tiss) VALUES (1, 'hospitalar',"
    " 'Hospitalar', '1'), (2, 'hospital_dia', 'Hospital-dia', '2'), (3, 'domiciliar', 'Domiciliar', '3');",
    "INSERT INTO terminologia (id, codigo, nome, tipo, origem, criado_em) VALUES (900, 'cid10', 'CID-10',"
    " 'diagnostico', 'sistema', UTC_TIMESTAMP(3));",
    "INSERT INTO termo_terminologia (id, terminologia_id, codigo_termo, descricao, criado_em) VALUES"
    " (901, 900, 'A00', 'Termo de exemplo', UTC_TIMESTAMP(3));"])
CADEIA = ("TBSEXO",)  # de outra fatia (L5-05): lida pela referência encadeada do sexo do local
CARREGADAS = ("TBDESFECHO_INTERNACAO", "TBMOTALT", "TBREGUL_SISTEMA", "TBREGUL_SERVICO", "TBTIPOACOMOD",
              "RELOCLEITO", "RELEITO", "REOCUPLEITO") + tuple(NOVAS)
NAO_CARREGADAS = ("TBTISSREGINT",)  # terminologia TISS (regra 7): na imagem só para provar que nada é gravado

# Significado gravado (relido do destino depois da carga): (tabela de destino, filtro {coluna: valor}, coluna, valor).
# Cobre os de-para de valores, os booleanos A/I e S/N e os literais. A conciliação compara contagem e soma; estes
# valores provam que nenhuma coluna entrou com o significado trocado (releitura pedida ao conferencia.py no L6-15.json).
VALORES_ESPERADOS = [
    ("motivo_saida_hospitalar", {"codigo": "41"}, "tipo_saida", "obito"),
    ("motivo_saida_hospitalar", {"codigo": "41"}, "exige_declaracao_obito", 1),
    ("motivo_saida_hospitalar", {"codigo": "41"}, "ativo", 0),
    ("motivo_saida_hospitalar", {"codigo": "41"}, "codigo_sus", "41"),
    ("motivo_saida_hospitalar", {"codigo": "21"}, "tipo_saida", "permanencia"),
    ("motivo_saida_hospitalar", {"codigo": "21"}, "encerra_internacao", 0),
    ("motivo_saida_hospitalar", {"codigo": "21"}, "ativo", 1),
    ("motivo_saida_hospitalar", {"codigo": "16"}, "tipo_saida", "evasao"),
    ("motivo_saida_hospitalar", {"codigo": "16"}, "alta_a_revelia", 1),
    ("motivo_saida_hospitalar", {"codigo": "31"}, "tipo_saida", "transferencia"),
    ("motivo_saida_hospitalar", {"codigo": "11"}, "tipo_saida", "alta"),
    ("motivo_saida_hospitalar", {"codigo": "11"}, "exige_declaracao_obito", 0),
    ("motivo_saida_hospitalar", {"codigo": "77"}, "tipo_saida", "alta"),
    ("motivo_saida_hospitalar", {"codigo": "77"}, "codigo_sus", None),
    ("desfecho_internacao", {"codigo": "3"}, "ativo", 1),
    ("desfecho_internacao", {"codigo": "1"}, "obito", 0),
    ("central_reguladora", {"sigla": "CENTRAL-B"}, "ativo", 0),
    ("central_reguladora", {"sigla": "CENTRAL-A"}, "nome", "CENTRAL-A"),
    ("sistema_externo", {"codigo": "CENTRAL-A"}, "categoria", "regulacao"),
    ("local_observacao", {"codigo": "OBS1"}, "sexo_permitido", "masculino"),
    ("local_observacao", {"codigo": "OBS7"}, "sexo_permitido", "feminino"),
    ("local_observacao", {"codigo": "MED1"}, "sexo_permitido", "qualquer"),
    ("local_observacao", {"codigo": "OBS8"}, "sexo_permitido", "qualquer"),
    ("leito_observacao", {"codigo": "P01"}, "ativo", 1),
    ("ocupacao_leito_observacao", {"data_hora_entrada": "2026-03-01 08:00:00"}, "situacao", "encerrada"),
    ("ocupacao_leito_observacao", {"data_hora_entrada": "2026-03-01 13:00:00"}, "situacao", "ativa"),
    ("ocupacao_leito_observacao", {"data_hora_entrada": "2026-03-04 08:00:00"}, "situacao", "encerrada"),
    ("ocupacao_leito_observacao", {"data_hora_entrada": "2026-03-04 08:00:00"}, "data_hora_saida", None),
    ("ocupacao_leito_observacao", {"data_hora_entrada": "2026-03-04 09:00:00"}, "situacao", "encerrada"),
    # internação (ids dos catálogos-base pela ordem da semente: eletiva 1, urgência 2; livre 1, inativo 8;
    # clínica 1; regime hospitalar 1)
    ("internacao", {"numero": "7001"}, "situacao", "alta"),
    ("internacao", {"numero": "7001"}, "data_hora_entrada", "2026-02-01 09:30:00"),
    ("internacao", {"numero": "7001"}, "data_hora_alta", "2026-02-05 14:00:00"),
    ("internacao", {"numero": "7001"}, "carater_admissao_id", 2),
    ("internacao", {"numero": "7001"}, "cid_principal_termo_terminologia_id", 901),
    ("internacao", {"numero": "7001"}, "cid_secundario_termo_terminologia_id", None),
    ("internacao", {"numero": "7001"}, "reinternacao_30_dias", 0),
    ("internacao", {"numero": "7001"}, "observacao", "Paciente  estável\r\n"),
    ("internacao", {"numero": "7002"}, "situacao", "ativa"),
    ("internacao", {"numero": "7002"}, "carater_admissao_id", 1),
    ("internacao", {"numero": "7001"}, "senha_autorizacao", "S1"),
    ("internacao", {"numero": "7001"}, "regime_atendimento_internacao_id", 1),
    ("internacao", {"numero": "7001"}, "tem_acompanhante", 1),
    ("internacao", {"numero": "7001"}, "plano_fonte_pagadora_id", id_externo("TBTIPPLANO", "1")),
    ("internacao", {"numero": "7002"}, "plano_fonte_pagadora_id", None),
    ("internacao", {"numero": "7002"}, "regime_atendimento_internacao_id", None),
    ("internacao", {"numero": "7002"}, "tem_acompanhante", 0),
    ("internacao", {"numero": "7005"}, "situacao", "alta_medica"),
    ("internacao", {"numero": "7005"}, "motivo_saida_hospitalar_id", None),
    ("internacao", {"numero": "7007"}, "situacao", "ativa"),
    ("trilha_auditoria", {"entidade": "internacao", "acao": "inclusao", "ocorrido_em": "2026-02-01 09:31:00"},
     "motivo", "dados_da_origem_sem_coluna_propria"),
    ("agendamento_internacao", {"numero": "pre_7501"}, "situacao", "internado"),
    ("agendamento_internacao", {"numero": "pre_7501"}, "senha_autorizacao", "P1"),
    ("agendamento_internacao", {"numero": "pre_7501"}, "autorizacao_validade", "2026-02-20"),
    ("agendamento_internacao", {"numero": "pre_7501"}, "cirurgia_prevista_em", "2026-02-02 08:00:00"),
    ("agendamento_internacao", {"numero": "pre_7501"}, "contato_telefone", "5100000000"),
    ("agendamento_internacao", {"numero": "pre_7501"}, "necessita_acompanhante", 1),
    ("agendamento_internacao", {"numero": "pre_7501"}, "regime_atendimento_internacao_id", 1),
    ("agendamento_internacao", {"numero": "pre_7501"}, "plano_fonte_pagadora_id", None),
    ("agendamento_internacao", {"numero": "pre_7503"}, "situacao", "nao_compareceu"),
    ("agendamento_internacao", {"numero": "pre_7503"}, "carater_admissao_id", 1),
    ("internacao", {"numero": "7003"}, "carater_admissao_id", 1),
    ("internacao", {"numero": "7003"}, "modalidade_internacao_id", 1),
    ("leito_hospitalar", {"codigo": "101B"}, "situacao_leito_id", 1),
    ("leito_hospitalar", {"codigo": "102A"}, "situacao_leito_id", 1),
    ("leito_hospitalar", {"codigo": "102B"}, "situacao_leito_id", 1),
    ("leito_hospitalar", {"codigo": "201A"}, "situacao_leito_id", 8),
    ("leito_hospitalar", {"codigo": "201A"}, "ativo", 0),
    ("leito_hospitalar", {"codigo": "201A"}, "data_ativacao", "2026-02-01"),
    ("leito_hospitalar", {"codigo": "101A"}, "ativo", 1),
    ("acomodacao", {"codigo": "101"}, "tipo_atendimento", "internacao"),
    ("agendamento_internacao", {"numero": "pre_7501"}, "previsto_para", "2026-02-01 09:00:00"),
    ("transferencia_leito", {"transferido_em": "2026-02-01 10:15:00"}, "justificativa", "Troca de quarto"),
    ("trilha_auditoria", {"entidade": "internacao", "acao": "exclusao", "motivo": "Cadastro em duplicidade",
                          "usuario_id": id_externo("TBUSERS", "usuario.exemplo")}, "entidade_id", None),
]

D = datetime.date
H = datetime.datetime


def linhas(r, ins):
    for cod, nome, sigla in [(1, "Masculino", "M"), (2, "Feminino", "F"), (3, "Ignorado", "I"), (4, "Outro", "O")]:
        ins("TBSEXO", [cod, nome, sigla])
    for x in [(1, "Alta  melhorada", "S"), (2, "Óbito", "S"), (3, "Evasão", None), (4, "Transferência externa", "X"),
              (5, "   ", "N")]:
        ins("TBDESFECHO_INTERNACAO", list(x))
    # COD pela tabela da AIH: 41 óbito (inativo), 21 permanência (STATUS 'T' ambíguo), 16 evasão, 31 transferência
    # (STATUS nulo), 77 fora da tabela pública (valor_fora_do_dominio nas 5 colunas derivadas), 15 sem nome (1048)
    for x in [(11, "Alta  curado", "A"), (12, "Alta melhorado", "A"), (41, "Óbito com declaração", "I"),
              (15, None, "A"), (21, "Permanência por\r\ncaracterística da doença", "T"), (16, "Evasão", "A"),
              (31, "Transferência externa", None), (77, "Motivo local", "A")]:
        ins("TBMOTALT", list(x) + [None, None])
    for x in [(1, "CENTRAL-A", "S"), (2, "CENTRAL-B", "N"), (3, None, "S"), (4, "CENTRAL-A", None)]:
        ins("TBREGUL_SISTEMA", list(x))
    for x in [(1, 1, "101", "Leito clínico adulto", "S"), (2, 1, "102", "Leito  UTI   adulto", "S"),
              (3, 2, "201", "Leito pediátrico", "N"), (4, 3, "301", "Serviço de central recusada", "S"),
              (5, 9, "901", "Central nunca vista", "S"), (6, 1, "101", "Código repetido na central", "S"),
              (7, 2, None, "Sem código", "S"), (8, 2, "202", "Leito obstétrico", "X")]:
        ins("TBREGUL_SERVICO", list(x))
    for x in [(1, "Enfermaria"), (2, "Apartamento"), (3, "UTI  adulto"), (4, None), (5, "Berçário")]:
        ins("TBTIPOACOMOD", list(x))
    for x in [(1, "Hospitalar", D(2020, 1, 1), None), (2, "Hospital-dia", D(2020, 1, 1), D(2030, 12, 31))]:
        ins("TBTISSREGINT", list(x))  # catálogo oficial: nada gravado
    # ID, COD, NOME, CENCUS, QTD, SEXO, TIPOACOMOD, TP_CONVENIO, CLINICA, COR, IDMIN, UNMIN, IDMAX, UNMAX
    # sexo pela sigla: 1 M masculino, 2 F feminino, 3 I qualquer, 4 'O' sem par (valor_fora_do_dominio, 'qualquer')
    for x in [(1, "OBS1", "Observação  adulto", 10, 6, 1, 1, 0, "A", "clBlue", 18, 1, 130, 1),
              (2, "OBS2", "Observação pediátrica", 20, 4, 1, 1, 0, "P", None, 0, 1, 12, 1),
              (3, "OBS3", None, 10, 2, 1, 1, 0, None, None, None, None, None, None),
              (4, "MED1", "Sala de medicação", 77, 3, 3, 1, 0, None, None, None, None, None, None),
              (5, "OBS5", "Local com quantidade negativa", None, -1, 1, 1, 0, None, None, None, None, None, None),
              (6, "OBS1", "Código repetido", 10, 2, 1, 1, 0, None, None, None, None, None, None),
              (7, "OBS7", "Observação feminina", 20, 2, 2, 1, 0, None, None, None, None, None, None),
              (8, "OBS8", "Sexo sem par", 20, 2, 4, 1, 0, None, None, None, None, None, None)]:
        ins("RELOCLEITO", list(x))
    for x in [(1, 1, "L01", 1, "S"), (2, 1, "L02", 2, "S"), (3, 2, "P01", 1, None), (4, 3, "X01", 1, "S"),
              (5, 1, "L01", 1, "S"), (6, 2, "P02", 9, "S"), (7, 1, "L03", 2, "X"), (8, 5, "Z01", 1, "S")]:
        ins("RELEITO", list(x) + [None])
    j = "Observação\r\n  pós-medicação  ".encode("cp1252")
    for x in [(5001, "E", H(2026, 3, 1, 8), 1, H(2026, 3, 1, 12), j, 1),
              (5002, "E", H(2026, 3, 1, 9), 2, H(2026, 3, 1, 10, 30), None, 2),
              (5001, "T", H(2026, 3, 1, 13), 3, None, None, 3),
              (5003, "E", H(2026, 3, 2, 8), 3, None, None, 4),                      # leito 3 já ocupado: 1062
              (5004, "E", H(2026, 3, 2, 10), 1, H(2026, 3, 2, 9), None, 5),         # saída antes da entrada: 4025
              (5005, "E", H(2026, 3, 2, 11), 4, None, None, 6),                     # leito recusado: pai_pendente
              (5099, "E", H(2026, 3, 2, 12), 2, H(2026, 3, 2, 13), None, 7),        # atendimento nunca visto
              (5006, "E", H(1899, 12, 30, 10), 2, None, None, 8),                   # data sentinela com hora
              (5002, "E", H(2026, 3, 3, 8), 7, None, None, 9),
              (5003, "E", H(2026, 3, 4, 8), 1, H(1899, 12, 30), None, 10),          # saída sentinela 00:00
              (5004, "E", H(2026, 3, 4, 9), 2, H(1899, 12, 30, 15, 30), None, 11)]:  # saída sentinela com hora
        ins("REOCUPLEITO", list(x) + [None])
    def q(t, **kw):
        fora = set(kw) - set(COLUNAS[t])
        assert not fora, (t, fora)
        ins(t, [kw.get(c) for c in COLUNAS[t]])

    d = D(2026, 2, 1)
    # pais lidos na origem (todos também em PAIS_EXTERNOS): prontuário, inscrição -> profissional, CPF, CID
    for i in range(1, 7):
        q("RICADPAC", ID=i, PRONT=8000 + i)
    for i, prof in ((1, 1), (2, 2), (3, 9)):
        q("TBCBOPRO", ID=i, ID_TBPROFIS=prof)
    for i, cpf in ((1, 10000000019), (2, 20000000028)):
        q("TBPROFIS", ID=i, NOME="Profissional %d" % i, CNPJ_CPF=cpf)
    for i, cod in ((1, "A00"), (2, "B01")):
        q("TBCID10", ID=i, COD=cod)
    # leitos (STATUS medido na referência: só A ativo e I inativo): 1 e 2 ativos (livre), 3 sem situação (livre
    # presumida), 4 sigla sem par (livre + valor_fora_do_dominio), 5 inativo
    # (código único 201A: TBLEITO o acha), 6 repete bloco+quarto+leito do 4 (1062 e chave alternativa ambígua), 7 bloco
    # nunca visto (unidade, bloco e quarto: pai_inexistente; 1048)
    for i, b, a, l, st in ((1, "A", "101", "101A", "A"), (2, "A", "101", "101B", "A"), (3, "A", "102", "102A", None),
                           (4, "A", "102", "102B", "X"), (5, "B", "201", "201A", "I"), (6, "A", "102", "102B", "A"),
                           (7, "Z", "999", "999A", "A")):
        q("RILEITOS", ID=i, BLOCO=b, ACOMOD=a, LEITO=l, ANDAR=1, REG=0, STATUS=st, RAMAL=200 + i, ORDEM=i,
          INAMPS="0%d" % i)
    # quartos completados: 1 tipo internação, 2 'E' sem significado confirmado (fica o padrão), 3 nunca visto
    for i, b, a, tp in ((1, "A", "101", "I"), (2, "A", "102", "E"), (3, "Q", "999", "I")):
        q("TBACOMODLEITO", ID=i, ID_RIBLOCOS=b, COD_ACOMODACAO=a, TP_ATENDIMENTO=tp, QTD_LEITO=2, TP_CONVENIO=0,
          ID_TBSEXO=1, ID_TBTIPOACOMOD=1)
    # leitos completados pelo código: 1 código único (201A), 2 código repetido (102B: recusa), 3 nunca visto
    for i, cod, at in ((1, "201A", "N"), (2, "102B", "S"), (3, "777A", "S")):
        q("TBLEITO", ID=i, ID_TBACOMODLEITO=1, COD_LEITO=cod, ATIVO=at, DATA_VIGENCIA=d)
    # histórico do leito: 1 do leito completado, 2 de leito recusado (pai_pendente), 3 de leito nunca visto (NULL)
    for i, lt in ((1, 1), (2, 2), (3, 99)):
        q("HTLEITO", ID=i, ID_TBLEITO=lt, DATA_HORA_HISTORICO=H(2026, 1, i, 9), NOME_BLOCO="Bloco A",
          NOME_ACOMODACAO="Quarto %d" % i, NUM_ANDAR=1, ID_TBTIPOACOMOD=1)
    # internações (REG 700x, atendimento 600x, prontuário 800x):
    # (caráter pelo código medido: 1 eletivo, 2 urgência)
    # 1 alta com motivo, caráter urgência, CID principal no catálogo e secundário ausente (catalogo_codigo_inexistente),
    # senha da operadora, plano, regime 1, acompanhante, médico da alta, data de inclusão e usuário (trilha);
    # 2 ativa sem caráter (eletiva presumida), plano 0 e regime 0 (sem par); 3 caráter sem par (valor_fora_do_dominio,
    # eletiva); 4 sem data de entrada (1048); 5 alta sem motivo com médico da alta: 'alta_medica' (gravada, nunca motivo
    # inventado); 6 especialidade nunca vista (pai_inexistente, 1048); 7 inscrição do médico cujo profissional nunca
    # foi visto, achado pelo CPF (concorrente MEDASS: gravada); 8 mesmo paciente da 2, ainda ativa (1062: uma internação
    # vigente por paciente); 9 bloco nunca visto (unidade e quarto: pai_inexistente, 1048)
    for reg, pr, ent, car, bl, ac, esp, med, alta, mot, lt in (
            (1, 1, d, "2", "A", "101", 10, 1, D(2026, 2, 5), 11, 1), (2, 2, d, None, "A", "101", 10, 2, None, None, 2),
            (3, 3, d, "Z", "A", "102", 20, 1, None, None, 3), (4, 4, None, "1", "A", "101", 10, 1, None, None, None),
            (5, 5, d, "1", "B", "201", 10, 1, D(2026, 2, 3), None, 5), (6, 6, d, "1", "A", "101", 99, 1, None, None, None),
            (7, 1, D(2026, 2, 7), "1", "A", "101", 10, 3, None, None, None),
            (8, 2, D(2026, 2, 8), "1", "A", "101", 10, 1, None, None, None),
            (9, 3, D(2026, 2, 9), "1", "Z", "999", 10, 1, None, None, None)):
        q("RICADINT", REG=7000 + reg, PRONT=8000 + pr, ENTRADA=ent, HORAENT="0930", BLOCO=bl, ACOMOD=ac, LEITO="101A",
          CONV=1, ESPEC=esp, CARINT=car, ID_TBCBOPRO_MEDASS=med, ID_TBCBOPROMEDSOL=2, ID_ATCABECATEND=6000 + reg,
          ID_RILEITOS=lt, ALTA=alta, HORASAI="1400" if alta else None, MOTIVO=mot, GUIA="G%d" % reg,
          MATRIC="M%d" % reg, ALTAPREV=D(2026, 2, 10), REINT30="N", QTDDIARIAS=3, ID_FHCADAIH=0,
          ID_TBCID10_PRINCIPAL=1 if reg == 1 else None, ID_TBCID10_SECUNDARIO=2 if reg == 1 else None,
          OBS="Paciente  estável\r\n".encode("cp1252") if reg == 1 else None,
          ID_TBCBOPRO_ALTA_MEDICA=1 if reg in (1, 5) else None, MEDASS=10000000019.0 if reg == 7 else None,
          SENHACONV="S%d" % reg if reg == 1 else None, CODPLANO={1: 1, 2: 0}.get(reg), REGIME={1: 1, 2: 0}.get(reg),
          ACOMP="Acompanhante Exemplo" if reg == 1 else None, USERINT="usuario.exemplo" if reg == 1 else None,
          DATA_HORA_INCLUSAO=H(2026, 2, 1, 9, 31) if reg == 1 else None)
    # pré-internações: 1 completa, internada (mesmo prontuário e entrada da internação 7001: 'internado'), com CID,
    # senha, validade, cirurgia prevista, categoria, leito reservado, telefone, regime e acompanhante; 2 hora inválida
    # (hora_invalida, 1048), sem caráter (eletiva presumida); 3 prontuário nunca visto (pai_inexistente, 1048); 4 sem a
    # inscrição do médico, achado pelo CPF (gravada). Sem internação correspondente: 'nao_compareceu' presumida
    for pr, tp, hora, med, ent in ((8001, "I", "0900", 1, d), (8002, "I", "2575", 1, D(2026, 3, 1)),
                                   (8099, "I", "0900", 1, D(2026, 3, 1)), (8003, "E", "0900", None, D(2026, 3, 1))):
        um = pr == 8001
        q("RIPREINT", PRONT=pr, TIPOPAC=tp, OTMU="A", ENTRADA=ent, HORAENT=hora, CONV=1,
          CARINT=None if pr == 8002 else "1", ID_TBCBOPRO_ASSISTENTE=med, ID_TBCBOPRO_SOLICITANTE=2,
          MEDASS=10000000019.0 if med is None else None, REG=7500 + pr - 8000, ESPEC=10, CLINICA="C",
          BLOCO="A", ALTAPREV=D(2026, 3, 4), CID_P="A00" if um else None, SENHACONV="P1" if um else None,
          VALSENHA=D(2026, 2, 20) if um else None, DATACIR=D(2026, 2, 2) if um else None,
          HORACIR="0800" if um else None, CODACOMOD=1 if um else None, ACOMOD="101" if um else None,
          LEITO="101A" if um else None, TELRESP="5100000000" if um else None, REGIME=1 if um else None,
          ACOMP="Acompanhante Exemplo" if um else None, PLANO=0)
    # altas desfeitas: 1 da internação 1; 2 atendimento sem internação (pai_inexistente, entidade NULL); 3 da
    # internação 4, recusada (pai_pendente); 4 sem data (1048)
    for i, at, quando in ((1, 6001, H(2026, 2, 5, 16)), (2, 6099, H(2026, 2, 6, 16)), (3, 6004, H(2026, 2, 6, 17)),
                          (4, 6002, None)):
        q("RIALTA_EXCLUSAO", ID=i, ID_ATCABECATEND=at, MOTIVO=11, JUSTIFICATIVAALTERNATIVA="Alta lançada por engano",
          DATA_HORA_ALTA_MEDICA=H(2026, 2, 5, 15), ALTA=D(2026, 2, 5), USUARIOALTA="usuario.exemplo",
          DATA_HORA_EXCLUSAO=quando)
    # internações excluídas: 1 completa; 2 sem data (1048); 3 usuário nunca visto (pai_inexistente, gravada)
    for reg, dt, us in ((7101, d, "usuario.exemplo"), (7102, None, "usuario.exemplo"), (7103, d, "nunca.visto")):
        q("RIEXCINT", REG=reg, ENTRADA=d, PRONT=8001, NOME="Paciente Exemplo", DTCANCEL=dt,
          JUSTIF="Cadastro em duplicidade", USUARIO=us, MEDSOL="Medico Exemplo")
    # transferências: 1 completa; 2 hora inválida (1048); 3 mesmo leito na origem e no destino (CHECK 4025); 4 leito
    # de destino nunca visto (pai_inexistente, 1048); 5 internação recusada (pai_pendente); 6 leito ambíguo (pai_ambiguo,
    # 1048)
    for reg, hora, o, dd in ((7001, "1015", ("A", "101", "101A"), ("A", "101", "101B")),
                             (7002, "2575", ("A", "101", "101A"), ("A", "101", "101B")),
                             (7002, "1100", ("A", "101", "101B"), ("A", "101", "101B")),
                             (7003, "1200", ("A", "101", "101A"), ("Z", "9", "9")),
                             (7004, "1300", ("A", "101", "101A"), ("A", "101", "101B")),
                             (7003, "1400", ("A", "101", "101A"), ("A", "102", "102B"))):
        q("RITRANSF", REG=reg, DATA=d, HORA=hora, BLOCOO=o[0], ACOMODO=o[1], LEITOO=o[2], BLOCOD=dd[0],
          ACOMODD=dd[1], LEITOD=dd[2], USUARIO="usuario.exemplo", JUSTIF="Troca de quarto")
    # trocas: clínica 1 completa, 2 sem valor novo (CHECK 4025), 3 internação nunca vista (pai_inexistente, 1048);
    # fonte pagadora 1 completa, 2 sem data (1048); especialidade 1 sem hora (meia-noite), 2 nova nunca vista
    # (pai_inexistente, 4025); profissional pelo CPF 1 completa, 2 CPF novo nunca visto (pai_inexistente, 4025)
    for reg, o, n in ((7001, "C", "P"), (7002, "C", None), (7099, "C", "P")):
        q("RITRFCLI", REG=reg, DATA=d, HORA="1100", USUARIO="usuario.exemplo", CLINO=o, CLIND=n)
    for reg, dt in ((7001, d), (7002, None)):
        q("RITRFCON", REG=reg, DATA=dt, HORA="1130", CONVO=1, CONVD=2, USUARIO="usuario.exemplo")
    for hora, n in ((None, 20), ("0900", 99)):
        q("RITRFESP", REG=7001, DATA=d, HORA=hora, ESPO=10, ESPD=n, USUARIO="usuario.exemplo")
    for reg, n in ((7001, 20000000028.0), (7002, 30000000037.0)):
        q("RITRFMED", REG=reg, DATA=d, HORA="1200", TIPO="A", CPFO=10000000019.0, CPFD=n, PRONT=8001,
          USUARIO="usuario.exemplo")
    # valor_presumido: uma por literal presumido em cada linha lida, inclusive a recusada pela restrição do destino
    # (a recusada por pai_pendente para antes do literal: TBREGUL_SERVICO 4)
    return {
        "TBDESFECHO_INTERNACAO": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1,
                                                                "valor_fora_do_dominio": 1, "valor_presumido": 5}},
        "TBMOTALT": {"gravados": 7, "pendencias": {"restricao_destino_1048": 1, "valor_fora_do_dominio": 6}},
        "TBREGUL_SISTEMA": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1062": 1,
                                                          "valor_presumido": 4}},
        "TBREGUL_SERVICO": {"gravados": 4, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                          "restricao_destino_1048": 2, "restricao_destino_1062": 1,
                                                          "valor_fora_do_dominio": 1, "valor_presumido": 7}},
        "TBTIPOACOMOD": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 5}},
        "RELOCLEITO": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1, "pai_inexistente": 1,
                                                     "restricao_destino_1264": 1, "restricao_destino_1062": 1,
                                                     "valor_fora_do_dominio": 1}},
        "RELEITO": {"gravados": 4, "pendencias": {"pai_pendente": 2, "restricao_destino_1062": 1,
                                                  "pai_inexistente": 1, "restricao_destino_1048": 1,
                                                  "valor_fora_do_dominio": 1}},
        "REOCUPLEITO": {"gravados": 6, "pendencias": {"restricao_destino_1062": 1, "restricao_destino_4025": 1,
                                                      "pai_pendente": 1, "pai_inexistente": 1,
                                                      "restricao_destino_1048": 2, "hora_sem_data": 2,
                                                      "data_sentinela": 1, "valor_presumido": 10}},
        "TBACOMODLEITO": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "valor_fora_do_dominio": 1}},
        # =~livre: valor_presumido só onde a sigla não deu a situação (resíduo r4: presumida concorrente só quando gravada)
        "RILEITOS": {"gravados": 5, "pendencias": {"pai_inexistente": 3, "restricao_destino_1048": 1,
                                                   "restricao_destino_1062": 1, "valor_fora_do_dominio": 1,
                                                   "valor_presumido": 2}},
        # complementa: o código repetido (pai_ambiguo na chave alternativa) recusa a linha como pai_inexistente
        "TBLEITO": {"gravados": 1, "pendencias": {"pai_inexistente": 2}},
        "HTLEITO": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "pai_pendente": 1}},
        # 5 gravadas: 7005 (alta médica sem motivo) e 7007 (médico pelo CPF) deixaram de ser recusadas; caráter 'Z' e
        # regime 0 sem par (valor_fora_do_dominio); modalidade presumida em cada linha (9) e eletiva só onde o
        # caráter não deu o valor (2; resíduo r4: a presumida concorrente só pende quando é a gravada)
        "RICADINT": {"gravados": 5, "pendencias": {"catalogo_codigo_inexistente": 1, "pai_inexistente": 4,
                                                   "restricao_destino_1048": 3, "restricao_destino_1062": 1,
                                                   "valor_fora_do_dominio": 2, "valor_presumido": 11}},
        # 2 gravadas (8001 internada, 8003 médico pelo CPF); pai_inexistente: internação correspondente ausente
        # (internacao_id e situação: 2 x 3 linhas), leito reservado de chave parcial (3) e o prontuário nunca visto;
        # valor_presumido: solicitado_em e nao_compareceu em cada linha (2 x 4); eletiva só quando gravada (resíduo r4: 0)
        "RIPREINT": {"gravados": 2, "pendencias": {"hora_invalida": 1, "pai_inexistente": 10,
                                                   "restricao_destino_1048": 2, "valor_presumido": 8}},
        "RIALTA_EXCLUSAO": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "pai_pendente": 1,
                                                          "restricao_destino_1048": 1}},
        "RIEXCINT": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}},
        "RITRANSF": {"gravados": 1, "pendencias": {"hora_invalida": 1, "pai_ambiguo": 1, "pai_inexistente": 1,
                                                   "pai_pendente": 1, "restricao_destino_1048": 3,
                                                   "restricao_destino_4025": 1}},
        "RITRFCLI": {"gravados": 1, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1,
                                                   "restricao_destino_4025": 1}},
        "RITRFCON": {"gravados": 1, "pendencias": {"restricao_destino_1048": 1}},
        "RITRFESP": {"gravados": 1, "pendencias": {"pai_inexistente": 1, "restricao_destino_4025": 1}},
        "RITRFMED": {"gravados": 1, "pendencias": {"pai_inexistente": 1, "restricao_destino_4025": 1}},
    }
