"""Fatia L8-19 (qualidade: tipos de surto para notificação de agravo): imagem sintética.

Dados 100% falsos (nomes inventados). Anomalias cobertas:
- nome com espaços repetidos e nas pontas (texto_nome colapsa);
- nome só com espaços (vira nulo: NOT NULL no destino recusa só a linha, restricao_destino_1048);
- categoria obrigatória sem origem (literal presumido: valor_presumido por linha lida, também na recusada).
"""

DDL = """
CREATE TABLE TBTPSURTO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
"""
CARREGADAS = ("TBTPSURTO",)

_NOMES = ["Surto exemplo A", "  Surto   exemplo  B ", "Surto exemplo C", "Surto exemplo D", "   "]


def linhas(r, ins):
    for i, n in enumerate(_NOMES, 1):
        ins("TBTPSURTO", [i, n])
    return {"TBTPSURTO": {"gravados": 4, "pendencias": {"valor_presumido": 5, "restricao_destino_1048": 1}}}
