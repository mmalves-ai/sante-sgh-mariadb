"""Fatia L8-07 (faturamento e restantes, módulo SUS): tabelas da origem com os mesmos nomes e tipos do dicionário e
dados 100% falsos.

Carregadas pelo mapa (18): as listas da contratualização SUS (escore, periodicidade, rede assistencial, complexidade,
tipo de aferição, esfera, tipo de dado, tipo de indicador, tipo de item do indicador, componente do orçamento) em
`dominio_contratualizacao_sus` e as listas dos instrumentos SUS (acesso vascular, característica do tratamento
dialítico, contraindicação e situação de transplante, credor, classificação do diagnóstico, justificativa de paciente
sem documento, tipo de leito de UTI) em `dominio_sus`. Várias tabelas da origem no mesmo destino, separadas pelo
literal da lista; o mesmo código em listas diferentes não colide.
Incentivo contratual (CMINCENTIVO, rodada 5, ADR 0006): carrega em `incentivo_contratual_sus` INATIVO, com o tipo
de dado pela lista, vigência pela evidência (ADR 0007, 16: `vigencia_sem_fonte`) e percentual 0 PRESUMIDO (a origem
não tem valor; o CHECK exige valor ou percentual): o cliente liga ao contrato com gestor e informa o valor.
Anomalias: nome só com espaços (NOT NULL no destino: recusa só a linha), espaços internos colapsados, acentos CP1252,
sigla vazia (NULL, aceita), lacunas nos ids, o mesmo id em várias listas e o id 0 (sentinela 'não informado') na
rede assistencial e no tipo de indicador: entra INATIVO (ativo falso), nunca escolhível. Duas listas do modelo são
mais longas que a coluna `lista` (VARCHAR(30)): suas linhas são recusadas (restricao_destino_1406) até a migração
pedida em saida/L8-07.json (alargar para 40); depois basta trocar LARGURA_LISTA para 40.
"""

LISTAS = {  # tabela: (tamanho de NOME, destino, lista)
    "CMESCORE": (10, "dominio_contratualizacao_sus", "escore"),
    "CMPERIODO": (15, "dominio_contratualizacao_sus", "periodicidade"),
    "CMREDEASSIST": (60, "dominio_contratualizacao_sus", "rede_assistencial"),
    "CMTIPOCOMPLEXIDADESP": (35, "dominio_contratualizacao_sus", "complexidade"),
    "CMTPAFERICAO": (30, "dominio_contratualizacao_sus", "tipo_afericao"),
    "CMTPCONTRATO": (10, "dominio_contratualizacao_sus", "esfera"),
    "CMTPDADOS": (15, "dominio_contratualizacao_sus", "tipo_dado"),
    "CMTPINDICADOR": (70, "dominio_contratualizacao_sus", "tipo_indicador"),
    "CMTPITEMINDIC": (30, "dominio_contratualizacao_sus", "tipo_item_indicador"),
    "CMTPORCAMENTO": (10, "dominio_contratualizacao_sus", "componente_orcamento"),
    "FAHEMOACEVASC": (25, "dominio_sus", "acesso_vascular"),
    "FAHEMOCARTRAT": (30, "dominio_sus", "caracteristica_tratamento_dialitico"),
    "FAHEMOCONTRAN": (70, "dominio_sus", "contraindicacao_transplante"),
    "FAHEMOSITTRAN": (50, "dominio_sus", "situacao_transplante"),
    "FGTBTPCREDOR": (25, "dominio_sus", "credor"),
    "FHCLASSIFDIAG": (40, "dominio_sus", "classificacao_diagnostico"),
    "FHJUSTPACDESC": (60, "dominio_sus", "justificativa_paciente_sem_documento"),
    "FHLEITOUTITP": (60, "dominio_sus", "tipo_leito_uti"),
}
INT_ID = {"CMTPINDICADOR"}
# lista maior que a coluna `dominio_sus.lista` VARCHAR(30) do modelo (o CHECK e a API já usam estes valores): até a
# coluna ser alargada (pedido 2 em saida/L8-07.json) toda linha destas tabelas é recusada com restricao_destino_1406
LARGURA_LISTA = 40
LISTA_LONGA = {t for t, (_, _, l) in LISTAS.items() if len(l) > LARGURA_LISTA}  # ID INTEGER; as demais SMALLINT

DDL = "\n".join(
    "CREATE TABLE %s (ID %s NOT NULL PRIMARY KEY, %sNOME VARCHAR(%d) NOT NULL);"
    % (t, "INTEGER" if t in INT_ID else "SMALLINT", "SIGLA VARCHAR(4) NOT NULL, " if t == "CMREDEASSIST" else "", n)
    for t, (n, _, _) in LISTAS.items()) + """
CREATE TABLE CMINCENTIVO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(120) NOT NULL, ID_CMTPDADOS SMALLINT);
"""

CARREGADAS = list(LISTAS) + ["CMINCENTIVO"]
NAO_CARREGADAS = []
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
                   " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento)")
# tabelas com uma linha de nome só com espaços (recusa só a linha: restricao_destino_1048)
COM_NOME_VAZIO = {"CMPERIODO", "CMTPINDICADOR", "FAHEMOCONTRAN", "FHLEITOUTITP"}
# rede assistencial: (id, sigla, nome); sigla só com espaços vira NULL e a linha entra
# id 0: sentinela 'não informado' da origem (entra inativo; ver colunas.d/L8-07.tsv)
SENTINELA_ZERO = {"CMREDEASSIST", "CMTPINDICADOR"}
REDES = [(0, "    ", "Rede nao informada"), (1, "RUE", "Rede  de   urgência"), (2, " RCP", "Rede cegonha e parto"), (4, "    ", "Rede psicossocial"),
         (6, "RPCD", "Rede da pessoa com deficiência")]


def _nomes(t, n):
    """Nomes inventados do item, cabendo no tamanho da coluna; acento e espaços internos no segundo."""
    base = ["Item  um", "Opção   número dois", "Terceira opção", "Quarta", "Quinta"]
    return [b[:n] for b in base]


def linhas(r, ins):
    esp = {}
    for t, (n, _, _) in LISTAS.items():
        if t == "CMREDEASSIST":
            for v in REDES:
                ins(t, list(v))
            esp[t] = {"gravados": len(REDES), "pendencias": {}}
            continue
        ids = [1, 2, 3, 5, 9]  # lacuna: os mesmos ids em todas as listas (o único é lista + código)
        nomes = _nomes(t, n)
        if t in SENTINELA_ZERO:
            ids, nomes = [0] + ids, ["Nao informado"] + nomes
        for i, nome in zip(ids, nomes):
            ins(t, [i, nome])
        pend = {}
        if t in COM_NOME_VAZIO:
            ins(t, [12, "   "])
            pend["restricao_destino_1048"] = 1
        esp[t] = {"gravados": len(ids), "pendencias": pend}
        if t in LISTA_LONGA:  # a lista não cabe: recusa todas (a de nome vazio também, pela lista)
            esp[t] = {"gravados": 0, "pendencias": {"restricao_destino_1406": len(ids) + sum(pend.values())}}
    ins("CMINCENTIVO", [1, "Incentivo padrão de exemplo", 2])
    ins("CMINCENTIVO", [2, "Incentivo  sem tipo de dado", None])
    ins("CMINCENTIVO", [3, "Incentivo de tipo inexistente", 7])
    # 3 gravados (o tipo 7 não existe: NULL com pai_inexistente); vigência estimada e 0 presumidos em todos
    esp["CMINCENTIVO"] = {"gravados": 3, "pendencias": {"vigencia_sem_fonte": 3, "valor_presumido": 6,
                                                        "pai_inexistente": 1}}
    return esp
