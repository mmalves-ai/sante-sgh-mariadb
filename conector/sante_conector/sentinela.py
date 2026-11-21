"""Regras de sentinela por coluna (F4 L4, item 5): o que a origem guarda como convenção vira valor neutro.

Toda coluna mapeada tem uma regra em `conector/mapa/colunas.tsv` (gerada por tipo e nome) ou em
`conector/mapa/declarado/colunas.tsv` (declarada, vale por cima da gerada). Nenhuma convenção da origem (S/N, HHMM,
data fictícia, CHAR com espaços) chega à porta do domínio. Mensagens e pendências levam só a regra, nunca o valor.
"""
import datetime
import decimal
import re

from .texto import cp1252_para_texto

REGRAS = {
    "texto": "CP1252 para utf8mb4; espaços repetidos colapsados e aparados; vazio vira NULL",
    "texto_char": "CHAR de tamanho fixo: espaços de preenchimento aparados; vazio vira NULL",
    "codigo_char": "código de 1 caractere: aparado e em maiúsculas; o de-para próprio do lote dá o valor de destino",
    "booleano_sn": "S/N, T/F, V/F, Y/N e 1/0 viram booleano; vazio vira NULL; outro valor: pendência valor_fora_do_dominio",
    "booleano_01": "inteiro 0/1 vira booleano; outro valor: pendência valor_fora_do_dominio",
    "booleano": "booleano nativo da origem",
    "data": "DATE; 1899-12-30, 1900-01-01 e ano < 1800 viram NULL com pendência data_sentinela",
    "data_hora": "TIMESTAMP; as mesmas sentinelas da data; a hora 00:00 é preservada",
    "hora": "TIME, sem conversão",
    "hora_hhmm": "inteiro HHMM vira TIME; fora de 0..2359 ou minuto >= 60: pendência hora_invalida",
    "inteiro": "inteiro, sem conversão",
    "decimal": "NUMERIC com a escala da origem, sem perda",
    "flutuante": "DOUBLE/FLOAT vira DECIMAL pelo texto do valor (sem ruído binário)",
    "blob": "bytes originais, nunca convertidos, com sha256 guardado para a conciliação",
    "chave_origem": "id de outra tabela da origem: resolvido pelo conector_origem; pai ausente ou pendente: pai_pendente",
}
SENTINELAS_DATA = {datetime.date(1899, 12, 30), datetime.date(1900, 1, 1)}
VERDADEIRO = {"S", "T", "V", "Y", "1"}
FALSO = {"N", "F", "0"}
# nome de coluna que indica sim/não (CHAR(1)); o lote confirma e pode declarar outra regra
_BOOL = re.compile(r"^(FL|FLG|FLAG|IND|IN|EH|E|TEM|POSSUI|PERMITE|EXIGE|USA|UTILIZA|OBRIG|OBRIGA|GERA|SN|HABILITA|"
                   r"BLOQ|EXIBE|MOSTRA|IMPRIME|CONTROLA|ACEITA|INFORMA|ENVIA|COBRA|COBRAR)(_|$)|"
                   r"(^|_)(ATIVO|ATIVA|INATIVO|BLOQUEADO|BLOQUEADA|CANCELADO|CANCELADA|URGENTE|EXCLUIDO|PADRAO|"
                   r"OBRIGATORIO|OBRIGATORIA|PRINCIPAL|LIBERADO|LIBERADA|CONFIRMADO|SN)$")
_HHMM = re.compile(r"^(HORA|HR|HORARIO)(_[A-Z0-9]+)?$|_(HORA|HR)$")
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


def classificar(nome, tipo, tam, escala):
    """Regra gerada pela forma e pelo nome da coluna de origem (o lote de domínio confirma ou declara outra)."""
    if tipo in (7, 8, 16) and escala < 0:
        return "decimal"
    if tipo in (10, 27):
        return "flutuante"
    if tipo == 12:
        return "data"
    if tipo == 35:
        return "data_hora"
    if tipo == 13:
        return "hora"
    if tipo == 261:
        return "blob"
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
    return "texto"


def _txt(v):
    if v is None:
        return None
    s = cp1252_para_texto(v) if isinstance(v, (bytes, bytearray)) else str(v)
    s = re.sub(r"\s+", " ", s).strip()
    return s or None


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
    if regra in ("texto", "texto_char"):
        return _txt(v), None
    if regra == "codigo_char":
        s = _txt(v)
        return (s.upper() if s else None), None
    if regra == "booleano_sn":
        s = (_txt(v) or "").upper()
        if not s:
            return None, None
        if s in VERDADEIRO:
            return True, None
        if s in FALSO:
            return False, None
        return None, "valor_fora_do_dominio"
    if regra == "booleano_01":
        if v in (0, 1):
            return bool(v), None
        return None, "valor_fora_do_dominio"
    if regra == "booleano":
        return bool(v), None
    if regra in ("data", "data_hora"):
        return (None, "data_sentinela") if _data(v) else (v, None)
    if regra == "hora_hhmm":
        if isinstance(v, int) and 0 <= v <= 2359 and v % 100 < 60:
            return datetime.time(v // 100, v % 100), None
        return None, "hora_invalida"
    if regra == "flutuante":
        return decimal.Decimal(repr(float(v))), None
    if regra == "decimal":
        return (v if isinstance(v, decimal.Decimal) else decimal.Decimal(str(v))), None
    return v, None  # hora, inteiro, blob, chave_origem: sem conversão (blob em bytes originais)
