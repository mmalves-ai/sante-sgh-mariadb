"""Fatia L8-15 (faturamento e restantes, módulo SGO): tabelas da origem com a forma do dicionário e dados 100% falsos.

Carregadas pelo mapa (colunas.d/L8-15.tsv): 16 cadastros simples de plano de saúde e da rede credenciada, o
beneficiário (PSBENEFI) e a venda (PSVENDAS -> proposta_adesao). Nas 7 tabelas cujo destino recebe códigos de várias
origens, o código é prefixo de domínio + chave (#codigo_derivado) e a linha com a mesma descrição (colação do destino)
é ADOTADA (adotado_existente): o mesmo conceito de duas origens fica numa linha só, sem recusa 1062.
Contrato e plano (PSEMPBEN, PSPLANOS) entram como pais externos (PAIS_EXTERNOS): fora do mapa na referência
(pedido 11). A pessoa física nasce do próprio beneficiário (destino gravado ANTES, adotada pelo CPF: a pessoa já
cadastrada no destino é adotada, adotado_existente); o grau do dependente é criado ou adotado pelo código do parentesco
(descrição lida no cadastro de parentesco da origem, TBPARENTE, pai de outra fatia: entra no DDL só com as colunas que a
referência encadeada atravessa); o dependente aponta o titular pelo vínculo e cai em pai_pendente quando o titular é
recusado. A venda grava a
proposta pelo plano e contrato do beneficiário (referência encadeada na origem), mesmo com o beneficiário recusado.
Descartadas (declarado/sem_carga.tsv), só com a forma: TBTPFAVORECIDO, TBTPFORMAREAJ e TBTPVIGCONTRATO (terminologia
TISS oficial), PSTPSVIGENCIA (tabela oficial da taxa) e PSBENCPL (repete colunas de PSBENEFI). Recebem 2 linhas cada.
Anomalias: nome nulo ou só com espaços (NOT NULL do destino: restricao_destino_1048), espaços repetidos e acentos
CP1252, nome repetido com outra caixa (adotado, inclusive entre duas tabelas da fatia no mesmo destino), nome longo
(cabe na descrição: o código vem da chave), situação nula (suspenso, nunca ativo presumido).
"""
import datetime
import decimal
import re

DDL = """
CREATE TABLE PSREEMBOLSOTP ("ID" INTEGER NOT NULL, "NOME" VARCHAR(40) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE PSTIPMEN ("COD" INTEGER NOT NULL, "NOME" VARCHAR(50), PRIMARY KEY ("COD"));
CREATE TABLE PSTIPOGUIA ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(30), PRIMARY KEY ("ID"));
CREATE TABLE PSTPACUMULPOR ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(20) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE PSTPPERIODO ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(20) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE PSTPSVIGENCIA ("DATA_VIGENCIA" DATE NOT NULL, "ID_PSTPSMESRECOL" SMALLINT NOT NULL, "ANO_RECOLHIMENTO"
  SMALLINT NOT NULL, "VALOR_ANUAL" NUMERIC(9,4) NOT NULL, "VALOR_TRIMESTRAL" NUMERIC(9,4) NOT NULL, PRIMARY KEY
  ("DATA_VIGENCIA"));
CREATE TABLE SPMOTLIG ("ID" INTEGER NOT NULL, "COD" SMALLINT NOT NULL, "NOME" VARCHAR(50), "TIPO_ATENDIMENTO"
  INTEGER, PRIMARY KEY ("ID"));
CREATE TABLE SPORIGEM_ATEND ("ID" SMALLINT NOT NULL, "DESCRICAO" VARCHAR(100) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE SPVINCULOTITULAR ("ID" INTEGER NOT NULL, "NOME" VARCHAR(60), PRIMARY KEY ("ID"));
CREATE TABLE TBENVCOBEMAIL ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(70) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBREGIMEATEND ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(30) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBSTATUSCREPLS ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(20), PRIMARY KEY ("ID"));
CREATE TABLE TBTIPOCOBRANCASGO ("ID" INTEGER NOT NULL, "NOME" VARCHAR(30), PRIMARY KEY ("ID"));
CREATE TABLE TBTPCONTRATOCREPLS ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(20), PRIMARY KEY ("ID"));
CREATE TABLE TBTPEMAILPLS ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(70) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBTPFAVORECIDO ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(50) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBTPFORMAREAJ ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(50) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBTPPRESTADOR ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(20) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBTPUNIDTEMPO ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(40) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE TBPARENTE ("COD_PAR" SMALLINT NOT NULL, "NOME" VARCHAR(20), PRIMARY KEY ("COD_PAR"));
CREATE TABLE TBTPVIGCONTRATO ("ID" SMALLINT NOT NULL, "NOME" VARCHAR(30) NOT NULL, PRIMARY KEY ("ID"));
CREATE TABLE PSBENEFI ("ID" BIGINT NOT NULL, "EMP" INTEGER NOT NULL, "BEN" INTEGER NOT NULL, "DEP" INTEGER NOT NULL,
  "DIG" SMALLINT NOT NULL, "NOME" VARCHAR(70), "SEXO" VARCHAR(1), "NASC" DATE NOT NULL, "ECIV" SMALLINT, "IDENT"
  VARCHAR(15), "CPF" BIGINT, "CNPJ" BIGINT, "PISPASEP" BIGINT, "ADESAO" DATE NOT NULL, "DT_VENC" DATE NOT NULL,
  "DT_STAT" DATE NOT NULL, "APARTIR" DATE NOT NULL, "FONE" VARCHAR(15), "PLANO" SMALLINT, "REAJUSTE" SMALLINT,
  "REPRES" SMALLINT, "EMPRESA" VARCHAR(40), "FONE_EMP" VARCHAR(15), "CARGO" VARCHAR(30), "ANOS_T" SMALLINT,
  "MESES_T" SMALLINT, "EMI_CAR" VARCHAR(1), "ENDER" VARCHAR(45), "NUM" INTEGER, "COMPL" VARCHAR(30), "BAIRRO"
  VARCHAR(30), "CIDADE" VARCHAR(30), "CEP" INTEGER, "UF" VARCHAR(2), "IBGE" INTEGER, "REGIAO" SMALLINT, "VER_CAREN"
  VARCHAR(1), "USU" VARCHAR(1), "MAE" VARCHAR(70), "COR" SMALLINT, "DEFICIENTE" VARCHAR(1), "FAIXA" SMALLINT,
  "GRP_ASSOC" SMALLINT, "STATUS" CHAR(1), "TIP_PAG" CHAR(1), "CARENCIA" CHAR(1), "TIP_PERC" CHAR(1), "CALC_PARC"
  CHAR(1), "PERC_PARC" NUMERIC(9,2), "TX_ADESAO" NUMERIC(9,2), "VLR_REPAS" NUMERIC(9,2), "COD_ANT" VARCHAR(30),
  "CELULAR" VARCHAR(15), "EMAIL" VARCHAR(50), "EMISSOR" SMALLINT, "CPF_PROPRIO" CHAR(1), "PAIS" SMALLINT, "USU_REP"
  CHAR(1), "CO_PART" CHAR(1), "COB_TEMP" CHAR(1), "TX_ADM" NUMERIC(9,2), "PAI" VARCHAR(70), "PARENTE" SMALLINT,
  "TIPO_DEP" CHAR(1), "ESTUDANTE" CHAR(1), "VENC_CO" DATE, "DT_CESC" DATE, "DT_VESC" DATE, "PERMANENTE" CHAR(1),
  "CEI" DOUBLE PRECISION, "INSCEST" VARCHAR(15), "TP_NOTA" SMALLINT, "ATIVIDADE" VARCHAR(40), "EXPEDICAO" DATE,
  "REPEMP" VARCHAR(50), "RGR" VARCHAR(15), "CPFR" DOUBLE PRECISION, "ENDR" VARCHAR(40), "NUMR" INTEGER, "COMPLR"
  VARCHAR(30), "BAIRROR" VARCHAR(30), "IBGER" INTEGER, "CIDADER" VARCHAR(30), "CEPR" INTEGER, "UFR" VARCHAR(2),
  "FONER" VARCHAR(15), "EMAILR" VARCHAR(50), "QUALIFIC" VARCHAR(30), "BOLEMP" CHAR(1), "CNPJE" BIGINT, "COD_EXT"
  VARCHAR(19), "SENHA_WEB" VARCHAR(40), "EXPNAOBENEF" CHAR(1), "MESREAJ" SMALLINT, "ANOREAJ" SMALLINT, "CAR_EMP"
  CHAR(1), "PLANOA" VARCHAR(10), "BANCO" SMALLINT, "AGENCIA" INTEGER, "CONTA" INTEGER, "TITCOB" VARCHAR(45),
  "ENDCOB" VARCHAR(45), "NUMCOB" INTEGER, "COMPLCOB" VARCHAR(30), "BAICOB" VARCHAR(30), "CIDCOB" VARCHAR(30),
  "UFCOB" VARCHAR(2), "CEPCOB" INTEGER, "IBGECOB" INTEGER, "FISICO" CHAR(1), "CONFERIDO" CHAR(1), "DIAVENCTO"
  SMALLINT, "VALCAR" DATE, "CONCESSIONARIA" INTEGER, "GERENTE" INTEGER, "SUPERVISOR" INTEGER, "VENDEDOR" INTEGER,
  "INDICADOR" INTEGER, "VLRULTVIG" CHAR(1), "FANTASIA" VARCHAR(50), "CONTATO" VARCHAR(45), "FONE_CONT" VARCHAR(15),
  "FONVENDA" SMALLINT, "APLIC_DESC_DEP" VARCHAR(1), "DESC_DEP" SMALLINT, "STATUS_CTO" SMALLINT, "REF_CAR" SMALLINT,
  "INI_VIG" DATE, "FIM_VIG" DATE, "STA_CAD" SMALLINT, "BENEFNAOEXP" CHAR(1), "POSVENDA" INTEGER, "DATA_VENDA" DATE,
  "PERC_VLR_TXADESAO" CHAR(1), "TIPO_DE_COBRANCA" SMALLINT, "GERAR_COB_INATIVOS" CHAR(1), "COBRAR_TX_BANCARIA"
  CHAR(1), "INCLUIR_COPART_COBRANCA" CHAR(1), "INCLUIR_SEGUROS_COBRANCA" CHAR(1), "INCLUIR_PRORATA_COBRANCA"
  CHAR(1), "TAXA_BANCARIA" NUMERIC(9,2), "TIPO_VENDA" SMALLINT, "CALC_ISS" CHAR(1), "PERC_ISS" DOUBLE PRECISION,
  "SINDICATO" CHAR(1), "PERC_VITA_FONTE" DOUBLE PRECISION, "PERC_VITA_VENDEDOR" DOUBLE PRECISION,
  "PERC_VITA_SUPERVISOR" DOUBLE PRECISION, "PERC_VITA_GERENTE" DOUBLE PRECISION, "PERC_VITA_INDICADOR" DOUBLE
  PRECISION, "PERC_VITA_CONCESSIONARIA" DOUBLE PRECISION, "VIDAS_VITALICIO" INTEGER, "LOTEDIG" VARCHAR(12), "SIB"
  CHAR(1), "TESTA_CAR_EXP_SEG" CHAR(1), "BCO_DEBITO" INTEGER, "AGE_DEBITO" INTEGER, "CTA_DEBITO" VARCHAR(14), "CCO"
  BIGINT, "DT_RECEBIMENTO" DATE, "NOME_CARTEIRINHA" VARCHAR(50), "HORA_VENDA" VARCHAR(4), "APOLICE" VARCHAR(20),
  "COD_EXP_PEC" INTEGER, "NOVO_CODIGO" VARCHAR(15), "CPFTITFIN" BIGINT, "OBSPERC" BLOB SUB_TYPE 1, "RETRATO" BLOB
  SUB_TYPE 1, "VENCCTR" SMALLINT NOT NULL, "ARTIGO_TRINTA" CHAR(1) NOT NULL, "ID_TBTIPLGR_RESID" INTEGER NOT NULL,
  "ID_TBTIPLGR_COB" INTEGER NOT NULL, "RESIDE_EXTERIOR" CHAR(1), "NUM_DECLARACAO_NASCIDO_VIVO" BIGINT, "CNS"
  VARCHAR(15), "DATA_HORA_INCLUSAO" TIMESTAMP, "DATA_HORA_ULTIMA_ATUALIZACAO" TIMESTAMP, "ID_PFGUIAS_OBITO" DOUBLE
  PRECISION, "ID_TBCID10_OBITO" INTEGER, "NUM_DECLARACAO_OBITO" VARCHAR(11), "USUARIO" VARCHAR(31), "DATA_ADMISSAO"
  DATE, "DESCONTO_PROMOCIONAL" CHAR(1), "ID_TBENVCOBEMAIL" SMALLINT, "NUMERO_FUNCIONAL" INTEGER, "NUMERO_VINCULO"
  SMALLINT, "NUMERO_PENSIONISTA" SMALLINT, "COD_UNIDADE" VARCHAR(5), "UNID_ORCAMENTARIA" VARCHAR(60),
  "ID_PSBENEFI_VINCULO" BIGINT, "NRO_PARCELAS_RECOMP_MENSAL" SMALLINT, "NOME_SOCIAL" VARCHAR(70), "EMI_NOME_CART"
  CHAR(1), "ID_TBCTABAN" INTEGER, PRIMARY KEY ("ID"));
CREATE TABLE PSBENCPL ("ID_PSBENEFI" BIGINT NOT NULL, "NOME_CARTEIRINHA" VARCHAR(50), "FANTASIA" VARCHAR(50), "MAE"
  VARCHAR(70), "PAI" VARCHAR(70), "FONE" VARCHAR(15), "EMPRESA" VARCHAR(40), "FONE_EMP" VARCHAR(15), "CARGO"
  VARCHAR(30), "ENDER" VARCHAR(45), "NUM" INTEGER, "COMPL" VARCHAR(30), "BAIRRO" VARCHAR(30), "CIDADE" VARCHAR(30),
  "CEP" INTEGER, "UF" VARCHAR(2), "IBGE" INTEGER, "CELULAR" VARCHAR(15), "EMAIL" VARCHAR(50), "USU_REP" CHAR(1),
  "TX_ADM" NUMERIC(9,2), "DT_CESC" DATE, "DT_VESC" DATE, "CNS" DOUBLE PRECISION, "CEI" DOUBLE PRECISION, "INSCEST"
  VARCHAR(15), "ATIVIDADE" VARCHAR(40), "REPEMP" VARCHAR(50), "RGR" VARCHAR(15), "CPFR" DOUBLE PRECISION, "QUALIFIC"
  VARCHAR(30), "ENDR" VARCHAR(40), "NUMR" INTEGER, "COMPLR" VARCHAR(30), "BAIRROR" VARCHAR(30), "IBGER" INTEGER,
  "CIDADER" VARCHAR(30), "CEPR" INTEGER, "UFR" VARCHAR(2), "FONER" VARCHAR(15), "EMAILR" VARCHAR(50), "CNPJE"
  BIGINT, "COD_EXT" VARCHAR(19), "SENHA_WEB" VARCHAR(40), "CAR_EMP" CHAR(1), "PLANOA" VARCHAR(10), "ENDCOB"
  VARCHAR(45), "NUMCOB" INTEGER, "COMPLCOB" VARCHAR(30), "BAICOB" VARCHAR(30), "CIDCOB" VARCHAR(30), "UFCOB"
  VARCHAR(2), "CEPCOB" INTEGER, "IBGECOB" INTEGER, "VALCAR" DATE, "CONTATO" VARCHAR(45), "FONE_CONT" VARCHAR(15),
  "LOTEDIG" VARCHAR(12), "TESTA_CAR_EXP_SEG" CHAR(1), "BCO_DEBITO" INTEGER, "AGE_DEBITO" INTEGER, "CTA_DEBITO"
  VARCHAR(14), "OBS_PERC" BLOB SUB_TYPE 1, "FOTO" BLOB SUB_TYPE 1, PRIMARY KEY ("ID_PSBENEFI"));
CREATE TABLE PSVENDAS ("ID_PSBENEFI" BIGINT NOT NULL, "CONCESSIONARIA" INTEGER, "GERENTE" INTEGER, "SUPERVISOR"
  INTEGER, "VENDEDOR" INTEGER, "INDICADOR" INTEGER, "FONVENDA" INTEGER, "POSVENDA" INTEGER, "DATA_VENDA" DATE,
  "HORA_VENDA" VARCHAR(4), "TIPO_VENDA" INTEGER, "VLR_REPAS" DOUBLE PRECISION, "PERC_VITA_FONTE" DOUBLE PRECISION,
  "PERC_VITA_VENDEDOR" DOUBLE PRECISION, "PERC_VITA_SUPERVISOR" DOUBLE PRECISION, "PERC_VITA_GERENTE" DOUBLE
  PRECISION, "PERC_VITA_INDICADOR" DOUBLE PRECISION, "PERC_VITA_CONCESSIONARIA" DOUBLE PRECISION, "VIDAS_VITALICIO"
  INTEGER, "APOLICE" VARCHAR(20), "PROPOSTA" INTEGER, PRIMARY KEY ("ID_PSBENEFI"));
"""

CARREGADAS = ("PSREEMBOLSOTP", "PSTIPMEN", "PSTIPOGUIA", "PSTPACUMULPOR", "PSTPPERIODO", "SPMOTLIG", "SPORIGEM_ATEND",
              "SPVINCULOTITULAR", "TBENVCOBEMAIL", "TBREGIMEATEND", "TBSTATUSCREPLS", "TBTIPOCOBRANCASGO",
              "TBTPCONTRATOCREPLS", "TBTPEMAILPLS", "TBTPPRESTADOR", "TBTPUNIDTEMPO", "PSBENEFI", "PSVENDAS")
NAO_CARREGADAS = ()  # r5c: PSTPSVIGENCIA passa a carregar na trilha (retrato) até o carregador da ANS
# rodada 5 (ADR 0006): listas do hospital (parametro_opcao) e complemento do beneficiário (mescla não destrutiva)
# lista: a 1.ª linha da fatia cria o módulo e a definição; as seguintes adotam (adotado_existente, baixa)
NOVAS = {"TBTPFAVORECIDO": {"gravados": 2, "pendencias": {"adotado_existente": 2}}, "TBTPFORMAREAJ": {"gravados": 2, "pendencias": {"adotado_existente": 3}},
         "TBTPVIGCONTRATO": {"gravados": 2, "pendencias": {"adotado_existente": 3}},
         # r5c: valores da taxa por vigência guardados na trilha com o retrato; a placeholder de 1899 tem o momento pela
         # evidência (ADR 0007, 16: data mais antiga da tabela, nunca a da carga), com vigencia_sem_fonte (baixa)
         "PSTPSVIGENCIA": {"gravados": 2, "pendencias": {"vigencia_sem_fonte": 1}}}
# complemento do beneficiário 101 (mãe igual: adotado sem mudança nas colunas que PSBENEFI concilia); 999 sem
# beneficiário (pai_inexistente em cada referência; recusado). Preencher pela mescla uma coluna que PSBENEFI também
# concilia muda a soma de controle dele (pedido 14 em saida/L8-15.json: a conciliação descontar o que a mescla preencheu)
PSBENCPL_LINHAS = (101, None, "Mae exemplo", None), (999, "Nome ex", None, None)
# r5b: o complemento também grava o e-mail próprio (101) e o retrato da linha inteira no histórico do beneficiário;
# 999 leva mais duas pai_inexistente (data do movimento pela adesão do beneficiário ausente)
PSBENCPL_ESPERADO = {"gravados": 1, "pendencias": {"adotado_existente": 2, "pai_inexistente": 12,
                                                   "restricao_destino_1048": 1}}
# rodada 5: adotar passou a MESCLAR (ADR 0007, 20): o conflito da linha adotada fica guardado (baixa)
MESCLA_R5 = {"PSBENEFI": 1, "PSTIPMEN": 1, "TBTIPOCOBRANCASGO": 1, "TBTPPRESTADOR": 1, "TBTPUNIDTEMPO": 1}
# contrato 7 e plano 3 já carregados (cadastros fora do mapa na referência: pedido 11)
PAIS_EXTERNOS = {"PSEMPBEN": ["7"], "PSPLANOS": ["3"]}
# um estabelecimento só no cliente de exemplo (@estabelecimento da proposta)
# CPF válido inventado (dígitos verificadores calculados): nunca de uma pessoa real
def cpf_falso(base9):
    d = [int(x) for x in "%09d" % base9]
    for n in (10, 11):
        r = sum(a * b for a, b in zip(d, range(n, 1, -1))) * 10 % 11
        d.append(0 if r == 10 else r)
    return int("".join(map(str, d)))


CPF_NOVO, CPF_JA_CADASTRADO = cpf_falso(123450001), cpf_falso(123450002)
# sexo e estado civil como o destino fica depois do L3 e do L5-04; a pessoa já cadastrada (paciente, por exemplo) prova
# a adoção pelo CPF, sem sobrescrever
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   # r5c: a operadora única do cliente (@unico da conta do portal do beneficiário)
                   "CREATE TABLE IF NOT EXISTS operadora_saude (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   "INSERT INTO operadora_saude () VALUES ();"
                   "INSERT INTO estabelecimento () VALUES ();"
                   # sexo e estado civil só são lidos (cod:): a conferência cria apenas os destinos da fatia
                   "CREATE TABLE IF NOT EXISTS sexo (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, sigla CHAR(1));"
                   "INSERT INTO sexo (codigo, descricao, sigla, criado_em) VALUES ('masculino', 'Masculino', 'M', UTC_TIMESTAMP(3)), ('feminino', 'Feminino', 'F', UTC_TIMESTAMP(3));"
                   "CREATE TABLE IF NOT EXISTS estado_civil (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " codigo VARCHAR(30));"
                   "INSERT INTO estado_civil (codigo, descricao, criado_em) VALUES ('1', 'Estado civil um', UTC_TIMESTAMP(3)),"
                   " ('2', 'Estado civil dois', UTC_TIMESTAMP(3));"
                   # tipo de documento rg do cadastro do produto (L3/L5-05), só lido (cod:)
                   "CREATE TABLE IF NOT EXISTS tipo_documento_identificacao (id BIGINT UNSIGNED AUTO_INCREMENT"
                   " PRIMARY KEY, codigo VARCHAR(30));"
                   "INSERT INTO tipo_documento_identificacao (codigo, descricao, criado_em) VALUES ('rg', 'RG', UTC_TIMESTAMP(3));"
                   "INSERT INTO pessoa_fisica (nome, cpf, origem, criado_em) VALUES ('Pessoa ja cadastrada', '%011d',"
                   " 'sistema', UTC_TIMESTAMP(3));" % CPF_JA_CADASTRADO)
P1899 = datetime.date(1899, 12, 30)


def colunas(t):
    """[(nome, tipo, not_null)] da tabela no DDL acima."""
    corpo = re.search(r"CREATE TABLE %s \((.*?)\);" % t, DDL, re.S).group(1)
    corpo = corpo.split(", PRIMARY KEY")[0]
    return [(m.group(1), m.group(2), bool(m.group(3)))
            for m in re.finditer(r'"(\w+)"\s+([A-Z]+(?: PRECISION| SUB_TYPE \d)?(?:\(\d+(?:,\d+)?\))?)( NOT NULL)?', corpo)]


def _forma(t, n, placeholder):
    """Linha só com a forma: obrigatórias preenchidas com valor falso (placeholder de 1899 ou 2025), o resto nulo."""
    v = []
    for nome, tipo, nn in colunas(t):
        if not nn:
            v.append(None)
        elif tipo.startswith(("INTEGER", "SMALLINT", "BIGINT")):
            v.append(n)
        elif tipo.startswith(("NUMERIC", "DECIMAL")):
            v.append(decimal.Decimal("1.5"))
        elif tipo.startswith("DOUBLE"):
            v.append(1.5)
        elif tipo == "DATE":
            v.append(P1899 if placeholder else datetime.date(2025, 1, n))
        elif tipo == "TIMESTAMP":
            v.append(datetime.datetime(1899, 12, 30) if placeholder else datetime.datetime(2025, 1, n, 8, 0))
        elif tipo.startswith("BLOB"):
            v.append(b"ex")
        else:
            v.append("X")
    return v


def _n(*nomes):
    return [[i, n] for i, n in enumerate(nomes, 1)]


R1048, R1062, R1406, VP = ("restricao_destino_1048", "restricao_destino_1062", "restricao_destino_1406",
                          "valor_presumido")
AD = "adotado_existente"
DADOS = [
    ("PSREEMBOLSOTP", _n("Reembolso  hospitalar ex", "Reembolso consulta ex", "   ", "Reembolso transporte ex"),
     {"gravados": 3, "pendencias": {R1048: 1}}),
    # nome vira o código: nulo (1048), repetido com outra caixa (1062) e longo demais para VARCHAR(30) (1406)
    ("PSTIPMEN", _n("Mensalidade exemplo", "Taxa  adesão exemplo", None, "MENSALIDADE  exemplo",
                    "Mensalidade de nome longo demais ex"),
     {"gravados": 4, "pendencias": {R1048: 1, AD: 1, VP: 5}}),
    # internação e exigência de autorização presumidas: duas valor_presumido por linha
    ("PSTIPOGUIA", _n("Consulta exemplo", "SP SADT  exemplo", "Internação exemplo", None),
     {"gravados": 3, "pendencias": {R1048: 1, VP: 8}}),
    ("PSTPACUMULPOR", _n("Grupo exemplo", "Família exemplo", "Beneficiário ex"), {"gravados": 3, "pendencias": {VP: 3}}),
    ("PSTPPERIODO", _n("Mensal exemplo", "Anual exemplo"), {"gravados": 2, "pendencias": {VP: 2}}),
    ("SPMOTLIG", [[1, 10, "Informação exemplo", 1], [2, 20, None, 2], [3, 30, "Segunda  via exemplo", None]],
     {"gravados": 2, "pendencias": {R1048: 1, VP: 3}}),
    ("SPORIGEM_ATEND", _n("Central exemplo", "Portal exemplo", "Presencial  exemplo", "   "),
     {"gravados": 3, "pendencias": {R1048: 1}}),
    ("SPVINCULOTITULAR", _n("Próprio exemplo", "Cônjuge exemplo", None, "Procurador exemplo"),
     {"gravados": 3, "pendencias": {R1048: 1, VP: 4}}),
    ("TBENVCOBEMAIL", _n("Não enviar exemplo", "Enviar por e-mail exemplo", "Enviar  pelo aplicativo ex"),
     {"gravados": 3, "pendencias": {VP: 3}}),
    ("TBREGIMEATEND", _n("Ambulatorial exemplo", "Hospitalar exemplo", "Ambos exemplo"),
     {"gravados": 3, "pendencias": {VP: 3}}),
    # comunica_ans e ativa_prestador presumidos: duas valor_presumido por linha
    ("TBSTATUSCREPLS", _n("Inclusão exemplo", "Exclusão exemplo", None, "Alteração ex"),
     {"gravados": 3, "pendencias": {R1048: 1, VP: 8}}),
    # mesmo destino de PSTIPMEN: o terceiro tem a descrição de uma linha dela e é adotado
    ("TBTIPOCOBRANCASGO", _n("Boleto exemplo", "Débito em conta ex", "Mensalidade exemplo", None),
     {"gravados": 3, "pendencias": {AD: 1, R1048: 1, VP: 4}}),
    ("TBTPCONTRATOCREPLS", _n("Direta exemplo", "Indireta exemplo"), {"gravados": 2, "pendencias": {VP: 2}}),
    # corpo e finalidade presumidos: duas pendências valor_presumido por linha
    ("TBTPEMAILPLS", _n("Boleto  por e-mail ex", "Aviso de reajuste ex", "Extrato exemplo"),
     {"gravados": 3, "pendencias": {VP: 6}}),
    ("TBTPPRESTADOR", _n("Clínica exemplo", "Hospital exemplo", "clínica  EXEMPLO"),
     {"gravados": 3, "pendencias": {AD: 1}}),
    # mesmo destino de PSTPPERIODO: o terceiro repete o código dela com outra caixa (1062)
    ("TBTPUNIDTEMPO", _n("Dias exemplo", "Meses exemplo", "ANUAL  exemplo", "Anos exemplo"),
     {"gravados": 4, "pendencias": {AD: 1, VP: 4}}),
]


def _benef(n, **v):
    """Linha de PSBENEFI: forma de 2025 com os valores dados (dados 100% falsos)."""
    linha = _forma("PSBENEFI", n, False)
    nomes = [c[0] for c in colunas("PSBENEFI")]
    for k, x in v.items():
        linha[nomes.index(k)] = x
    return linha


D25 = datetime.date(2025, 2, 1)
PARENTES = [[2, "Filho  exemplo"], [3, "Cônjuge exemplo"]]
# titular com pessoa nova (CPF válido), dependente sem CPF com grau novo (código 2, descrição do cadastro de parentesco)
# e o segundo dependente do mesmo grau (grau adotado); titular cuja pessoa já está no destino pelo CPF (adotada);
# dependente com parentesco inexistente na origem (descrição NULL: 1048 no grau, recusa visível); a placeholder de 1899
# tem contrato desconhecido (pai_inexistente), datas sentinela e nome nulo (1048)
BENEFICIARIOS = [
    _benef(1, ID=101, EMP=7, BEN=1, DEP=0, PLANO=3, CPF=CPF_NOVO, NOME="Titular  exemplo", SEXO="M", NASC=D25,
           MAE="Mae exemplo", CNS="700000000000005", ECIV=1, ADESAO=D25, APARTIR=D25, COD_ANT="ANT-EX-1", CCO=900001,
           ESTUDANTE="N", STATUS="A", COB_TEMP="N", COD_UNIDADE="U-EX", DATA_HORA_INCLUSAO=datetime.datetime(2025, 2, 1, 9, 30),
           IDENT="RG-EX-1", EXPEDICAO=D25, EMAIL="titular@exemplo.test", SENHA_WEB="senha-falsa-ex1"),
    _benef(2, ID=102, EMP=7, BEN=1, DEP=1, PLANO=3, CPF=None, NOME="Dependente exemplo", SEXO="F", ADESAO=D25,
           APARTIR=D25, ESTUDANTE="S", ID_PSBENEFI_VINCULO=101, PARENTE=2, EMAIL="sem-arroba-exemplo",
           SENHA_WEB="senha-falsa-ex2"),
    _benef(4, ID=103, EMP=7, BEN=1, DEP=2, PLANO=3, CPF=None, NOME="Outro dependente exemplo", ADESAO=D25,
           APARTIR=D25, ID_PSBENEFI_VINCULO=101, PARENTE=2, STATUS="C", NUM_DECLARACAO_OBITO="99999999"),
    _benef(5, ID=104, EMP=7, BEN=2, DEP=0, PLANO=3, CPF=CPF_JA_CADASTRADO, NOME="Titular ja cadastrado", ADESAO=D25,
           APARTIR=D25, STATUS="A", IDENT="RG-EX-4"),
    _benef(6, ID=105, EMP=7, BEN=2, DEP=1, PLANO=3, CPF=None, NOME="Dependente sem parentesco", ADESAO=D25,
           APARTIR=D25, ID_PSBENEFI_VINCULO=104, PARENTE=9),
    _forma("PSBENEFI", 3, True),
]
# 4 gravados (titular novo, dependente com grau novo, dependente com grau adotado, titular com pessoa adotada);
# identidade e e-mail do titular novo e identidade do adotado viram documento_pessoa/email_pessoa da pessoa; e-mail
# inválido do dependente: valor_fora_do_dominio e nenhuma linha; o outro dependente tem STATUS 'C' sem par (suspenso
# com valor_fora_do_dominio) e declaração de óbito (pessoa falecida);
# recusados: dependente sem parentesco na origem (pai_inexistente + 1048 na descrição do grau) e a placeholder
# (pai_inexistente do contrato, 5 datas sentinela: adesão, início e nascimento, mais a adesão no efeito e no momento do
# movimento de inclusão; 1048 no nome da pessoa). r5c: o e-mail inválido do dependente também vale para a conta do
# portal (criada pela senha web): valor_fora_do_dominio 3 (e-mail da pessoa, e-mail da conta e STATUS 'C')
ESPERADO_BENEFICIARIO = {"gravados": 4, "pendencias": {AD: 2, "data_sentinela": 5, "pai_inexistente": 2, R1048: 2,
                                                       "valor_fora_do_dominio": 3}}
# venda do titular: proposta gravada pelo plano e contrato do beneficiário (referência encadeada na origem); venda da
# placeholder (contrato desconhecido: pai_inexistente; sem plano nem data: 1048) e do dependente sem data (1048)

def _venda(**v):
    """Linha de PSVENDAS: tudo nulo menos os valores dados (dados 100% falsos)."""
    nomes = [c[0] for c in colunas("PSVENDAS")]
    return [v.get(n) for n in nomes]


VENDAS = [_venda(ID_PSBENEFI=101, CONCESSIONARIA=1, VENDEDOR=3, DATA_VENDA=D25, HORA_VENDA="1030", TIPO_VENDA=1,
                 PERC_VITA_VENDEDOR=2.5, APOLICE="AP-EX", PROPOSTA=5001),
          _venda(ID_PSBENEFI=3),
          _venda(ID_PSBENEFI=102, PROPOSTA=5002)]
ESPERADO_VENDAS = {"gravados": 1, "pendencias": {"pai_inexistente": 1, R1048: 2}}


def linhas(r, ins):
    esperado = {}
    for v in BENEFICIARIOS:
        ins("PSBENEFI", list(v))
    for v in PARENTES:
        ins("TBPARENTE", list(v))
    esperado["PSBENEFI"] = {"gravados": ESPERADO_BENEFICIARIO["gravados"],
                            "pendencias": dict(ESPERADO_BENEFICIARIO["pendencias"])}
    for v in VENDAS:
        ins("PSVENDAS", list(v))
    esperado["PSVENDAS"] = {"gravados": 1, "pendencias": dict(ESPERADO_VENDAS["pendencias"])}
    for tab, ls, esp in DADOS:
        for v in ls:
            ins(tab, list(v))
        esperado[tab] = {"gravados": esp["gravados"], "pendencias": dict(esp["pendencias"])}
    for tab in NAO_CARREGADAS + tuple(NOVAS):
        ins(tab, _forma(tab, 1, True))
        ins(tab, _forma(tab, 2, False))
    for tab, e in NOVAS.items():
        esperado[tab] = {"gravados": e["gravados"], "pendencias": dict(e["pendencias"])}
    nomes = [n for n, _, _ in colunas("PSBENCPL")]
    for chave, cart, mae, pai in PSBENCPL_LINHAS:
        v = _forma("PSBENCPL", 1, False)
        for n, x in (("ID_PSBENEFI", chave), ("NOME_CARTEIRINHA", cart), ("MAE", mae), ("PAI", pai),
                     ("EMAIL", "complemento@exemplo.test" if chave == 101 else None), ("EMPRESA", "Empresa exemplo")):
            v[nomes.index(n)] = x
        ins("PSBENCPL", v)
    esperado["PSBENCPL"] = {"gravados": PSBENCPL_ESPERADO["gravados"], "pendencias": dict(PSBENCPL_ESPERADO["pendencias"])}
    for tab, n in MESCLA_R5.items():
        esperado[tab]["pendencias"]["mescla_conflito_origem_guardada"] = n
    return esperado
