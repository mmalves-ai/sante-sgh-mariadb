"""Regras de sentinela por coluna (F4 L4, item 5): o que a origem guarda como convenção vira valor neutro.

Toda coluna mapeada tem uma regra em `conector/mapa/colunas.tsv` (gerada por tipo e nome) ou em
`conector/mapa/declarado/colunas.tsv` (declarada, vale por cima da gerada). Nenhuma convenção da origem (S/N, HHMM,
data fictícia, CHAR com espaços, texto em CP1252) chega à porta do domínio. Mensagens e pendências levam só a regra, nunca o valor.
"""
import datetime
import decimal
import re

from .texto import cp1252_para_texto

REGRAS = {
    "texto": "CP1252 para utf8mb4; só as pontas aparadas (quebras de linha e espaços internos preservados); vazio vira NULL",
    "texto_nome": "nome de pessoa ou entidade: CP1252 para utf8mb4, espaços repetidos colapsados e aparados; vazio vira NULL",
    "texto_char": "CHAR de tamanho fixo: só os espaços de preenchimento à direita aparados; vazio vira NULL",
    "texto_longo": "BLOB SUB_TYPE 1 (texto): CP1252 para utf8mb4 sem mexer em quebras de linha nem espaços; vazio vira "
                   "NULL; o hash da conciliação continua sobre os bytes crus",
    "codigo_char": "código de 1 caractere: preenchimento aparado, caixa preservada (origem com comparação binária: 'a' e "
                   "'A' são códigos distintos); o de-para próprio do lote dá o valor de destino; colisão de caixa num "
                   "mesmo domínio: pendência codigo_colisao_caixa",
    "booleano_sn": "S/N, T/F, V/F, Y/N e 1/0 viram booleano; vazio vira NULL; outro valor: pendência valor_fora_do_dominio",
    "booleano_01": "inteiro 0/1 vira booleano; outro valor: pendência valor_fora_do_dominio",
    "booleano": "booleano nativo da origem",
    "booleano_ai": "A (ativo) vira TRUE, I (inativo) FALSE; vazio vira NULL; outro valor: pendência valor_fora_do_dominio",
    "data": "DATE; 1899-12-30, 1900-01-01 e ano < 1800 viram NULL com pendência data_sentinela",
    "data_hora": "TIMESTAMP com destino DATETIME; data sentinela com hora 00:00 vira NULL com pendência data_sentinela; "
                 "data sentinela com hora preenchida vira NULL com pendência hora_sem_data (o lote declara "
                 "hora_em_timestamp se o destino for TIME)",
    "hora_em_timestamp": "TIMESTAMP que guarda só a hora (convenção 1899-12-30 HH:MM): vira TIME; outra data: a hora "
                         "é usada e fica pendência hora_com_data",
    "hora": "TIME, sem conversão",
    "hora_hhmm": "inteiro HHMM vira TIME; fora de 0..2359 ou minuto >= 60: pendência hora_invalida",
    "inteiro": "inteiro, sem conversão",
    "inteiro_zero_nulo": "inteiro em que 0 é a convenção de 'sem valor' (ex.: sem limite): 0 vira NULL, sem pendência",
    "decimal": "NUMERIC com a escala da origem, sem perda",
    "flutuante": "DOUBLE/FLOAT vira DECIMAL pelo texto do valor (sem ruído binário)",
    "blob": "BLOB binário (SUB_TYPE 0): bytes originais, nunca convertidos, com sha256 guardado para a conciliação",
    "chave_origem": "id de outra tabela da origem: resolvido pelo conector_origem; pai ausente ou pendente: pai_pendente",
}
# regras cujo destino é coluna TIME / DATETIME (o verificador confere contra o tipo da coluna declarada no DDL)
REGRAS_TIME = {"hora", "hora_hhmm", "hora_em_timestamp"}
DATA_ZERO = datetime.date(1899, 12, 30)
SENTINELAS_DATA = {datetime.date(1899, 12, 30), datetime.date(1900, 1, 1)}
VERDADEIRO = {"S", "T", "V", "Y", "1"}
FALSO = {"N", "F", "0"}
# nome de coluna que indica sim/não (CHAR(1)); o lote confirma e pode declarar outra regra
_BOOL = re.compile(r"^(FL|FLG|FLAG|IND|IN|EH|E|TEM|POSSUI|PERMITE|EXIGE|USA|UTILIZA|OBRIG|OBRIGA|GERA|SN|HABILITA|"
                   r"BLOQ|EXIBE|MOSTRA|IMPRIME|CONTROLA|ACEITA|INFORMA|ENVIA|COBRA|COBRAR)(_|$)|"
                   r"(^|_)(ATIVO|ATIVA|INATIVO|BLOQUEADO|BLOQUEADA|CANCELADO|CANCELADA|URGENTE|EXCLUIDO|PADRAO|"
                   r"OBRIGATORIO|OBRIGATORIA|PRINCIPAL|LIBERADO|LIBERADA|CONFIRMADO|SN)$")
_HHMM = re.compile(r"^(HORA|HR|HORARIO)(_[A-Z0-9]+)?$|_(HORA|HR)$")
# TIMESTAMP com nome de hora: guarda só a hora (convenção Delphi 1899-12-30 HH:MM)
_HORA_TS = re.compile(r"^(HORA|HORAS|HR|HOR|HORARIO)(_|$)")
# nome de pessoa ou entidade (VARCHAR): espaços repetidos colapsados
_NOME = re.compile(r"^(NOME|NOM|RAZAO_SOCIAL|RAZAO|FANTASIA|NOME_FANTASIA|APELIDO)(_[A-Z0-9]+)?$|_NOME$")
_QTD = re.compile(r"QTD|QTDE|TOTAL|HORAS|CARGA|MINUTO|SEGUNDO|INTERVALO|TEMPO|DURACAO")
# códigos de tipo do dicionário do Firebird (RDB$FIELD_TYPE)
TIPOS = {7: "SMALLINT", 8: "INTEGER", 16: "BIGINT", 10: "FLOAT", 27: "DOUBLE", 12: "DATE", 13: "TIME",
         35: "TIMESTAMP", 37: "VARCHAR", 14: "CHAR", 261: "BLOB", 23: "BOOLEAN"}


def forma(tipo, tam, escala):
    """Texto da forma da coluna de origem, só metadado (ex.: VARCHAR(70), NUMERIC(escala 2))."""
    t = TIPOS.get(tipo, "TIPO%s" % tipo)
    if tipo in (14, 37):
        return "%s(%s)" % (t, tam)
    if tipo in (7, 8, 16) and escala < 0:
        return "NUMERIC(%s,%s)" % ({7: 4, 8: 9, 16: 18}[tipo], -escala)
    return t


def classificar(nome, tipo, tam, escala, subtipo=0):
    """Regra gerada pela forma, pelo subtipo (BLOB) e pelo nome da coluna de origem (o lote de domínio confirma ou
    declara outra)."""
    if tipo in (7, 8, 16) and escala < 0:
        return "decimal"
    if tipo in (10, 27):
        return "flutuante"
    if tipo == 12:
        return "data"
    if tipo == 35:
        return "hora_em_timestamp" if _HORA_TS.search(nome) else "data_hora"
    if tipo == 13:
        return "hora"
    if tipo == 261:
        return "texto_longo" if subtipo == 1 else "blob"
    if tipo == 23:
        return "booleano"
    if tipo in (7, 8, 16):
        if nome == "ID" or nome.startswith("ID_"):
            return "chave_origem"
        if _HHMM.search(nome) and not _QTD.search(nome):
            return "hora_hhmm"
        if tipo == 7 and _BOOL.search(nome):
            return "booleano_01"
        return "inteiro"
    if tipo in (14, 37) and tam == 1:
        return "booleano_sn" if _BOOL.search(nome) else "codigo_char"
    if tipo == 14:
        return "texto_char"
    return "texto_nome" if _NOME.search(nome) else "texto"


def regra_efetiva(regra, subtipo):
    """Regra a aplicar com o dicionário VIVO da imagem do cliente: um BLOB de texto (SUB_TYPE 1) nunca segue como
    bytes, mesmo se o mapa foi gerado de um dicionário sem subtipo; um BLOB binário nunca é convertido como texto."""
    if regra == "blob" and subtipo == 1:
        return "texto_longo"
    if regra == "texto_longo" and subtipo == 0:
        return "blob"
    return regra


def colisoes_caixa(codigos):
    """Códigos de um mesmo domínio que só diferem pela caixa ('a' e 'A'): grupos ordenados, para a pendência
    codigo_colisao_caixa quando o destino não distingue caixa. Só códigos, nunca valores de linha."""
    grupos = {}
    for c in codigos:
        if c is not None:
            grupos.setdefault(c.casefold(), set()).add(c)
    return sorted(sorted(g) for g in grupos.values() if len(g) > 1)


def _str(v):
    return cp1252_para_texto(v) if isinstance(v, (bytes, bytearray)) else str(v)


def _txt(v, modo):
    """modo 'nome': colapsa espaços; 'pontas': apara só as pontas; 'preenchimento': só espaços à direita;
    'integral': nada muda. Vazio (ou só espaços) vira NULL."""
    if v is None:
        return None
    s = _str(v)
    if not s.strip():
        return None
    if modo == "nome":
        return re.sub(r"\s+", " ", s).strip()
    if modo == "pontas":
        return s.strip()
    if modo == "preenchimento":
        return s.rstrip(" ")
    return s


def _data(v):
    d = v.date() if isinstance(v, datetime.datetime) else v
    return d in SENTINELAS_DATA or d.year < 1800


def aplicar(regra, v):
    """Converte um valor cru da origem pela regra. Devolve (valor, regra_de_pendencia_ou_None); nunca o valor na
    pendência. Regra desconhecida é erro de programa (o verificador do mapa recusa antes)."""
    if regra not in REGRAS:
        raise KeyError("regra de coluna desconhecida: %s" % regra)
    if v is None:
        return None, None
    if regra == "texto":
        return _txt(v, "pontas"), None
    if regra == "texto_nome":
        return _txt(v, "nome"), None
    if regra in ("texto_char", "codigo_char"):
        return _txt(v, "preenchimento"), None
    if regra == "texto_longo":
        return _txt(v, "integral"), None
    if regra == "booleano_sn":
        s = (_txt(v, "pontas") or "").upper()
        if not s:
            return None, None
        if s in VERDADEIRO:
            return True, None
        if s in FALSO:
            return False, None
        return None, "valor_fora_do_dominio"
    if regra == "booleano_ai":
        s = (_txt(v, "pontas") or "").upper()
        if not s:
            return None, None
        return ({"A": True, "I": False}[s], None) if s in ("A", "I") else (None, "valor_fora_do_dominio")
    if regra == "inteiro_zero_nulo":
        return (None if v == 0 else v), None
    if regra == "booleano_01":
        if v in (0, 1):
            return bool(v), None
        return None, "valor_fora_do_dominio"
    if regra == "booleano":
        return bool(v), None
    if regra == "data":
        return (None, "data_sentinela") if _data(v) else (v, None)
    if regra == "data_hora":
        if not _data(v):
            return v, None
        com_hora = isinstance(v, datetime.datetime) and v.time() != datetime.time(0, 0)
        return None, ("hora_sem_data" if com_hora else "data_sentinela")
    if regra == "hora_em_timestamp":
        if not isinstance(v, datetime.datetime):
            return (v, None) if isinstance(v, datetime.time) else (None, "valor_fora_do_dominio")
        return v.time(), (None if v.date() == DATA_ZERO else "hora_com_data")
    if regra == "hora_hhmm":
        if isinstance(v, int) and 0 <= v <= 2359 and v % 100 < 60:
            return datetime.time(v // 100, v % 100), None
        return None, "hora_invalida"
    if regra == "flutuante":
        return decimal.Decimal(repr(float(v))), None
    if regra == "decimal":
        return (v if isinstance(v, decimal.Decimal) else decimal.Decimal(str(v))), None
    return v, None  # hora, inteiro, blob, chave_origem: sem conversão (blob em bytes originais)
