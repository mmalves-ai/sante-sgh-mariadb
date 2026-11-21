"""Fatia L6-04 (agenda: situações, confirmação e vínculos da agenda): situações da marcação,
fontes pagadoras aceitas por agenda e especialidades atendidas por agenda. O estado de confirmação da origem é de alergia, não da
marcação: fica fora da fatia até o integrador trocar o destino (pedido no L6-04.json). As outras 12 tabelas da fatia ficam fora
da carga até as regras genéricas pedidas em docs/obra/fatias/f4/saida/L6-04.json (agenda pela chave natural, data e
hora em duas colunas, horário derivado da marcação, parâmetros despivotados, arquivo do ícone).

Dados 100% falsos. Anomalias: descrição só de espaços e nula (NOT NULL no destino), nome com espaços repetidos
(colapsados), bytes CP1252 0x80-0x9F, S/N inválido e vazio (padrão do destino), código com colisão de caixa ('A' e 'a'
na chave única sem caixa do destino: as duas recusadas), significado presumido (valor_presumido em toda linha avaliada, também na recusada pela restrição; a
colisão de caixa recusa antes de avaliar),
aceita na marcação online e especialidade principal presumidas FALSE (valor_presumido em toda linha),
par agenda/fonte e agenda/especialidade repetido (chave única do destino), pai inexistente e pai zero em coluna
NOT NULL (recusa pela restrição), BLOB de texto com quebras e espaços preservados, ícone binário não lido.
Pais de fora da fatia (já carregados): REAGENDA (L6-03), TBCONVEN e TBESPEC (L5).
"""

DDL = """
CREATE TABLE TBSITAGE (COD VARCHAR(2) NOT NULL PRIMARY KEY, NOME VARCHAR(40), EXTENSAO VARCHAR(5),
  ICONE BLOB SUB_TYPE 0, INT_AGENDA_ONLINE CHAR(1));
CREATE TABLE REAGENDA_TBCONVEN (ID INTEGER NOT NULL PRIMARY KEY, ID_REAGENDA INTEGER NOT NULL,
  ID_TBCONVEN SMALLINT NOT NULL, OBS_AGEND_ONLINE BLOB SUB_TYPE 1);
CREATE TABLE REAGENDA_TBESPEC (ID INTEGER NOT NULL PRIMARY KEY, ID_REAGENDA INTEGER NOT NULL,
  ID_TBESPEC INTEGER NOT NULL);
"""
PAIS_EXTERNOS = {"REAGENDA": ["1", "2", "3"], "TBCONVEN": ["1", "2", "3"], "TBESPEC": ["1", "2", "3"]}

SIT, CONV, ESP = "TBSITAGE", "REAGENDA_TBCONVEN", "REAGENDA_TBESPEC"


def linhas(r, ins):
    icone = bytes(r.getrandbits(8) for _ in range(64))
    for v in [("A", "Aguardando exemplo", None, None, "S"),
              ("a", "Colide com A pela caixa", None, None, "N"),   # chave única sem caixa: codigo_colisao_caixa (as duas)
              ("CF", "Confirmada exemplo", "bmp", icone, "S"),     # ícone binário não lido (pedido de arquivo)
              ("R", "Realizada exemplo", None, None, None),        # vazio: padrão do destino (FALSE)
              ("X", None, None, None, "N"),                        # NOT NULL: restricao_destino_1048
              ("F", "  Falta   exemplo ", None, None, "Z"),        # S/N inválido: valor_fora_do_dominio
              ("B", "Bloqueada ação €", None, None, "N")]:
        ins(SIT, list(v))
    obs = lambda i: ("Aviso %d ao paciente\r\n  segunda linha  " % i).encode("cp1252")  # noqa: E731
    for v in [(1, 1, 1, obs(1)), (2, 1, 2, None), (3, 2, 1, obs(3)),
              (4, 2, 1, None),                    # par repetido: restricao_destino_1062
              (5, 3, 99, None),                   # fonte inexistente em NOT NULL: recusa pela restrição
              (6, 77, 1, None),                   # agenda inexistente em NOT NULL: recusa pela restrição
              (7, 3, 0, None),                    # zero = sem pai: NULL em NOT NULL, recusa pela restrição
              (8, 3, 3, "Aviso €“” ação".encode("cp1252"))]:
        ins(CONV, list(v))
    for v in [(1, 1, 1), (2, 1, 2), (3, 2, 3),
              (4, 2, 3),                          # par repetido: restricao_destino_1062
              (5, 3, 50),                         # especialidade inexistente em NOT NULL
              (6, 3, 1)]:
        ins(ESP, list(v))
    return {
        SIT: {"gravados": 4, "pendencias": {"valor_presumido": 5, "valor_fora_do_dominio": 1,
                                            "codigo_colisao_caixa": 2, "restricao_destino_1048": 1}},
        CONV: {"gravados": 4, "pendencias": {"valor_presumido": 8, "restricao_destino_1062": 1, "pai_inexistente": 2,
                                             "restricao_destino_1048": 3}},
        ESP: {"gravados": 4, "pendencias": {"valor_presumido": 6, "restricao_destino_1062": 1, "pai_inexistente": 1,
                                            "restricao_destino_1048": 1}},
    }
