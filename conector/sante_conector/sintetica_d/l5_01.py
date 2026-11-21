"""Fatia L5-01 (cadastros e administração): tabelas da origem com a forma do dicionário e dados 100% falsos.

Só as tabelas que a carga dirigida pelo mapa já carrega (as demais da fatia aguardam regra genérica no motor:
pedidos em docs/obra/fatias/f4/saida/L5-01.json). Anomalias: nome com espaços repetidos, código acima do tamanho
do destino, colisão de caixa na unicidade do destino, S/N inválido, vazio em coluna obrigatória do destino, pai
recusado (pai_pendente), pai inexistente, CHECK do destino (pontuação fora de 1..5),
duplicidade na unicidade (dimensão + pontuação). PRTPNOTIFEMAIL e TBCFGLOGIN ficam fora até a revisão do destino
e as regras de piso e conversão (pedidos no L5-01.json).
"""

DDL = """
CREATE TABLE TBGRUUSU (NOME VARCHAR(50) NOT NULL PRIMARY KEY, ATIVO CHAR(1));
CREATE TABLE PREMAILMODULO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE PRTIPO_JUSTIF_EXPORTACAO (ID INTEGER NOT NULL PRIMARY KEY, JUSTIFICATIVA_EXPORTACAO VARCHAR(200));
CREATE TABLE RPMATRIZ_GUT_TIPO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(20));
CREATE TABLE RPMATRIZ_GUT_DESCRICAO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(80) NOT NULL,
  ID_RPMATRIZ_GUT_TIPO INTEGER NOT NULL, PONTO INTEGER NOT NULL);
CREATE TABLE TBCENARIO (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(60) NOT NULL);
"""


def linhas(r, ins):
    # perfis: espaços repetidos (código preserva a chave: 'A   B' e 'A B' são perfis distintos; nome colapsa), código acima de 30 (1406), colisão de caixa na unicidade (1062),
    # S/N inválido (ativo fica com o padrão), ativo vazio (padrão)
    for nome, ativo in [("Faturamento", "S"), ("Recepcao central", "N"), ("Enfermagem   plantao", "S"),
                        ("Enfermagem plantao", "S"), ("Perfil de exemplo com nome bem comprido", "S"), ("ADMINISTRACAO", "S"),
                        ("Administracao", "N"), ("Laboratorio", "X"), ("Farmacia", None)]:
        ins("TBGRUUSU", [nome, ativo])
    for i, nome in [(1, "Laudo"), (2, "  Relatorio   agendado "), (3, "Convite de conta"), (4, "")]:
        ins("PREMAILMODULO", [i, nome])
    for i, j in [(1, "Pedido do paciente"), (2, "Auditoria interna"), (3, None), (4, "Justificativa longa " * 8),
                 (5, "Ordem judicial")]:
        ins("PRTIPO_JUSTIF_EXPORTACAO", [i, j])
    for i, nome in [(1, "Gravidade"), (2, "Urgencia"), (3, "Tendencia"), (4, None)]:
        ins("RPMATRIZ_GUT_TIPO", [i, nome])
    n = 0
    for tipo in (1, 2, 3):
        for ponto in range(1, 6):
            n += 1
            ins("RPMATRIZ_GUT_DESCRICAO", [n, "Grau %d da dimensao %d" % (ponto, tipo), tipo, ponto])
    ins("RPMATRIZ_GUT_DESCRICAO", [16, "Grau de dimensao recusada", 4, 1])     # pai recusado: pai_pendente
    ins("RPMATRIZ_GUT_DESCRICAO", [17, "Grau de dimensao inexistente", 9, 2])  # pai_inexistente + NOT NULL
    ins("RPMATRIZ_GUT_DESCRICAO", [18, "Grau fora da escala", 1, 7])           # CHECK 1..5
    ins("RPMATRIZ_GUT_DESCRICAO", [19, "Grau repetido", 2, 3])                 # unicidade dimensão + pontuação
    for i, nome in [(1, "Envio fiscal pendente"), (2, "Exame   atrasado")]:
        ins("TBCENARIO", [i, nome])
    return {
        "TBGRUUSU": {"gravados": 7, "pendencias": {"restricao_destino_1406": 1, "restricao_destino_1062": 1,
                                                   "valor_fora_do_dominio": 1}},
        "PREMAILMODULO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "PRTIPO_JUSTIF_EXPORTACAO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1,
                                                                   "restricao_destino_1406": 1}},
        "RPMATRIZ_GUT_TIPO": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "RPMATRIZ_GUT_DESCRICAO": {"gravados": 15, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                                  "restricao_destino_1048": 1,
                                                                  "restricao_destino_4025": 1,
                                                                  "restricao_destino_1062": 1}},
        "TBCENARIO": {"gravados": 2, "pendencias": {}},
    }
