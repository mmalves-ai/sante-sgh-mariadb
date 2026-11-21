"""Fatia L5-04 (cadastros e administração, domínios do cadastro-base): tabelas da origem e dados 100% falsos.

Carregadas pelo mapa: complexidade e porte do estabelecimento, finalidade do endereço, tipo de telefone, capacidade
civil, classe da fonte pagadora e escolaridade. Clínica, estado civil e feriados ficam fora até o motor ter a regra
genérica de que precisam (gravar sem ela daria valor errado em silêncio). As demais tabelas da fatia ficam fora
da carga (NAO_CARREGADAS, com o motivo; pedidos ao integrador em docs/obra/fatias/f4/saida/L5-04.json).
Anomalias: descrição nula (NOT NULL no destino), colisão de caixa em código de 1 caractere (código único no destino),
nome com espaços repetidos; feriado com ano 9999 (todo ano), clínica inativa e estado civil por sexo (fora da carga).
"""
import datetime
import pathlib

# o motor aplica a regra do brief (codigo_colisao_caixa) ou a colisão cai na restrição do destino (1062)? O esperado
# acompanha o motor: a conferência da carga confere o efeito REAL, e muda sozinha quando o integrador aplicar a regra.
MOTOR_APLICA_COLISAO = "colisoes_caixa" in (pathlib.Path(__file__).resolve().parents[1] / "carga_mapa.py").read_text(
    encoding="utf-8")

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
"""

# tabelas da fatia fora da carga: o destino do modelo exige o que a origem não dá sem regra genérica nova no motor
NAO_CARREGADAS = {
    "FAMEDSOL": "solicitante externo exige conselho, número e UF do conselho (a origem só tem o número); fusão com o "
                "outro cadastro de solicitante",
    "FPECIV": "reaproveita o domínio-base do estado civil (TBECIV): falta regra de casar pelo código existente",
    "GETABFUN": "pessoa física sem regra de CPF (zeros à esquerda) nem de pessoa já existente; conta bancária só "
                "quando houver banco; retenção exige estabelecimento, tributo e alíquota",
    "REPACAGN": "pré-cadastro exige o estabelecimento do cliente (sem coluna na origem)",
    "SIPACAGN": "pré-cadastro exige o estabelecimento do cliente (sem coluna na origem)",
    "RESEGUR": "titular exige a cobertura do paciente (referência não gerada pelo mapa)",
    "SHTECNIC": "só marcador sem dado; profissional exige pessoa física",
    "SITECNIC": "profissional exige pessoa física gravada antes (ordem de destinos)",
    "TBCBOPRO": "inscrição exige conselho (tabela fora do mapa) e sequência",
    "TBESPPRO": "par especialidade e procedimento exige referência declarada e início de vigência",
    "TBFONTE_PAGADORA": "mesmo destino de TBCLASSC com código único: falta regra de domínio compartilhado",
    "TBCLINICA": "situação A/I sem regra (a inativa entraria ativa e a mudança de situação não seria detectada) e "
                 "natureza presumida sem pendência: falta regra booleano_ai e valor_presumido",
    "TBECIV": "o código de negócio é COD (as referências apontam por ele), com uma linha por sexo: falta regra de "
              "domínio compartilhado (fundir as variantes do mesmo COD num id); gravar o ID duplicaria o domínio",
    "TBFERIAD": "ano 9999 = todo ano (recorrência anual com dia e mês): falta regra; e abrangência presumida sem "
                "pendência. Gravar tudo como data única tornaria o feriado fixo dia útil",
}


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
    return {
        "TBCOMPLEXIDADE_HOSPITALAR": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "TBPORTE_HOSPITALAR": {"gravados": 4, "pendencias": {}},
        "CDTPENDERECO": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1}},
        "FPTPTEL": ({"gravados": 2, "pendencias": {"codigo_colisao_caixa": 2}} if MOTOR_APLICA_COLISAO  # as duas
                    else {"gravados": 3, "pendencias": {"restricao_destino_1062": 1}}),
        "TBCAPACIDADE_CIVIL": {"gravados": 3, "pendencias": {}},
        "TBCLASSC": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1}},
        "TBESCOLARIDADE": {"gravados": 5, "pendencias": {}},
    }
