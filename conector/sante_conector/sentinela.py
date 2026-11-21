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
    "hora_hhmm": "inteiro HHMM (ou texto 'HHMM'/'HH:MM') vira TIME; fora de 0..2359 ou minuto >= 60: pendência hora_invalida",
    "inteiro_nao_negativo": "inteiro em que negativo não tem sentido: negativo vira NULL com valor_fora_do_dominio (linha gravada)",
    "decimal_zero_nulo": "NUMERIC em que 0 é a convenção de 'sem valor': 0 vira NULL, sem pendência",
    "inteiro": "inteiro, sem conversão",
    "inteiro_zero_nulo": "inteiro em que 0 é a convenção de 'sem valor' (ex.: sem limite): 0 vira NULL, sem pendência",
    "decimal": "NUMERIC com a escala da origem, sem perda",
    "flutuante": "DOUBLE/FLOAT vira DECIMAL pelo texto do valor (sem ruído binário)",
    "blob": "BLOB binário (SUB_TYPE 0): bytes originais, nunca convertidos, com sha256 guardado para a conciliação",
    "chave_origem": "id de outra tabela da origem: resolvido pelo conector_origem; pai ausente ou pendente: pai_pendente",
    "preenchido": "texto ou valor presente vira TRUE, vazio (só espaços) FALSE; nulo fica nulo (padrão do destino)",
    "decimal_positivo": "NUMERIC que só tem sentido maior que zero (CHECK > 0): zero ou negativo vira NULL com "
                        "valor_fora_do_dominio (linha gravada, fica o padrão do destino)",
    "cnpj": "documento de pessoa jurídica (inteiro ou texto): só dígitos, 14 com zeros à esquerda; dígito verificador "
            "errado, todos iguais ou mais de 14 dígitos: NULL com documento_invalido (nunca o valor no log); 0 vira NULL",
    "cpf": "documento de pessoa física (inteiro ou texto): só dígitos, 11 com zeros à esquerda; dígito verificador "
           "errado, todos iguais ou mais de 11 dígitos: NULL com documento_invalido (nunca o valor no log)",
    "cpf_cnpj": "documento de pessoa (inteiro ou texto): até 11 dígitos é CPF, até 14 é CNPJ (com zeros à esquerda); "
                "inválido: NULL com documento_invalido",
    "decimal_nao_negativo": "NUMERIC em que negativo não tem sentido (CHECK >= 0): negativo vira NULL com "
                            "valor_fora_do_dominio (linha gravada); zero fica",
    "competencia_aaaamm": "competência em inteiro ou texto AAAAMM vira DATE do 1º dia do mês; mês fora de 1..12, ano "
                          "< 1800 ou forma inválida: NULL com valor_fora_do_dominio; 0 ou vazio vira NULL",
    "data_primeiro_dia_mes": "DATE/TIMESTAMP vira DATE do 1º dia do mês (competência); data sentinela vira NULL com "
                             "data_sentinela",
    "minutos_em_timestamp": "TIMESTAMP (ou TIME) que guarda uma DURAÇÃO como hora (1899-12-30 HH:MM) vira inteiro de "
                            "minutos (HH*60+MM); 00:00 vira NULL; outra data: os minutos da hora e pendência hora_com_data",
    "minutos_hhmm": "DURAÇÃO em inteiro ou texto HHMM (ou HH:MM; texto cru CP1252 aceito) vira inteiro de minutos "
                    "('0030' -> 30, '0100' -> 60); vazio ou 0000 vira NULL; minuto >= 60 ou forma inválida: NULL com "
                    "valor_fora_do_dominio",
    "email": "endereço de e-mail (local@dominio.tld, pontas aparadas); sem esse formato: NULL com valor_fora_do_dominio",
}
# regras cujo destino é coluna TIME / DATETIME (o verificador confere contra o tipo da coluna declarada no DDL)
REGRAS_TIME = {"hora", "hora_hhmm", "hora_em_timestamp"}

# Regras com parâmetro (`nome:parametro` no mapa): validadas por `regra_conhecida`.
REGRAS_PARAMETRO = {
    "inteiro_faixa": "inteiro_faixa:<min>,<max>: fora da faixa vira NULL com valor_fora_do_dominio (linha gravada; "
                     "ex.: prazo acima do CHECK do destino não recusa a linha inteira)",
    "inteiro_zeros_esquerda": "inteiro_zeros_esquerda:<n>: inteiro (ou texto de dígitos) vira texto de n dígitos com "
                              "zeros à esquerda (CEP); 0, negativo ou mais de n dígitos: NULL com valor_fora_do_dominio",
    "piso": "piso:<n>: número abaixo de n é ELEVADO a n com a pendência informativa valor_elevado_ao_minimo (baixa), "
            "em vez de recusar a linha pelo CHECK do destino (ex.: tamanho mínimo de senha da política)",
    "faixa": "faixa:<min>,<max>: número (inteiro ou decimal) fora da faixa vira NULL com valor_fora_do_dominio (linha "
             "gravada); limites decimais aceitos",
    "texto_resumo": "texto_resumo:<n>: texto (pontas aparadas) maior que n é cortado na última fronteira de palavra até "
                    "n (sem fronteira: corte em n) com a pendência informativa texto_resumido (baixa); use quando o "
                    "texto integral vai para outra coluna",
    # recorrência de datas (rodada 3): a origem marca a data que se repete todo ano com um ANO convencional (ex.: 9999)
    "ano_recorrente": "ano_recorrente:<ano>: DATE cujo ano é o ano-marca vira TRUE (a data se repete todo ano: só dia "
                      "e mês valem), outro ano FALSE (data única); com depara=valores, 1/0 viram o domínio do destino "
                      "(ex.: anual/data_unica); data sentinela: NULL com data_sentinela",
    "data_nao_recorrente": "data_nao_recorrente:<ano>: a DATE quando o ano não é o ano-marca (data única); no ano-marca, "
                           "NULL sem pendência (a data recorrente não tem ano); data sentinela: NULL com data_sentinela",
    "dia_recorrente": "dia_recorrente:<ano>: dia do mês (1..31) da DATE no ano-marca; outro ano: NULL sem pendência",
    "mes_recorrente": "mes_recorrente:<ano>: mês (1..12) da DATE no ano-marca; outro ano: NULL sem pendência",
}
REGRAS_RECORRENCIA = ("ano_recorrente", "data_nao_recorrente", "dia_recorrente", "mes_recorrente")

# período com a unidade em outra coluna (`#dias:<VALOR>,<UNIDADE>` na carga dirigida pelo mapa): dias por unidade.
# mês e ano são convenção (30 e 365 dias): o resultado leva a pendência baixa periodo_aproximado
DIAS_POR_UNIDADE = {"minuto": (1, 1440), "hora": (1, 24), "dia": (1, 1), "semana": (7, 1), "mes": (30, 1),
                    "ano": (365, 1)}  # (multiplicador, divisor): conta exata em Decimal
_UNIDADE_SINONIMO = {"minutos": "minuto", "min": "minuto", "horas": "hora", "h": "hora", "dias": "dia", "d": "dia",
                     "semanas": "semana", "s": "semana", "meses": "mes", "mês": "mes", "m": "mes", "anos": "ano",
                     "a": "ano"}


def _parametro(regra):
    """(nome, parâmetros) de uma regra com parâmetro válida; None se não for uma."""
    nome, sep, arg = (regra or "").partition(":")
    if not sep or nome not in REGRAS_PARAMETRO:
        return None
    try:
        if nome in ("faixa", "piso"):
            xs = tuple(decimal.Decimal(x) for x in arg.split(","))
            if any(not x.is_finite() for x in xs) or len(xs) != (2 if nome == "faixa" else 1):
                return None
            return (nome, xs) if nome == "piso" or xs[0] <= xs[1] else None
        if nome == "inteiro_faixa":
            a, b = (int(x) for x in arg.split(","))
            return (nome, (a, b)) if a <= b else None
        n = int(arg)
        return (nome, (n,)) if n > 0 else None
    except (ValueError, decimal.InvalidOperation):
        return None


def unidade_periodo(u):
    """Unidade de período canônica (minuto, hora, dia, semana, mes, ano) de um texto da origem (nome, plural ou letra
    D/S/M/A/H, sem caixa); None se desconhecida."""
    if u is None:
        return None
    s = _str(u).strip().lower()
    s = _UNIDADE_SINONIMO.get(s, s)
    return s if s in DIAS_POR_UNIDADE else None


def periodo_em_dias(valor, unidade):
    """(dias inteiros, pendência) de uma quantidade e da unidade CANÔNICA (`unidade_periodo`). Vazio: (None, None);
    negativo ou não numérico: NULL com valor_fora_do_dominio; unidade desconhecida: NULL com valor_fora_do_dominio;
    sem unidade: NULL com unidade_ausente. Mês e ano (30 e 365 dias) ou fração de dia truncada: periodo_aproximado."""
    if valor is None or (isinstance(valor, (str, bytes, bytearray)) and not _str(valor).strip()):
        return None, None
    try:
        x = valor if isinstance(valor, decimal.Decimal) else decimal.Decimal(
            repr(valor) if isinstance(valor, float) else _str(valor).strip() if isinstance(
                valor, (str, bytes, bytearray)) else str(valor))
    except decimal.InvalidOperation:
        return None, "valor_fora_do_dominio"
    if isinstance(valor, bool) or not x.is_finite() or x < 0:
        return None, "valor_fora_do_dominio"
    if unidade is None:
        return None, "unidade_ausente"
    u = unidade_periodo(unidade)
    if u is None:
        return None, "valor_fora_do_dominio"
    mult, div = DIAS_POR_UNIDADE[u]
    bruto = x * mult / div
    dias = int(bruto.to_integral_value(rounding=decimal.ROUND_FLOOR))
    return dias, ("periodo_aproximado" if u in ("mes", "ano") or bruto != dias else None)


def regra_conhecida(regra):
    """Regra simples de REGRAS ou regra com parâmetro bem formada (o verificador do mapa recusa as outras)."""
    return regra in REGRAS or _parametro(regra) is not None


def _digitos(v):
    """Só os dígitos de um inteiro ou texto; None se houver outro caractere além de pontuação de documento."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return str(v) if v >= 0 else None
    if isinstance(v, decimal.Decimal):
        return str(int(v)) if v == v.to_integral_value() and v >= 0 else None
    s = _str(v).strip()
    if not re.fullmatch(r"[\d.\-/ ]*", s):
        return None
    return re.sub(r"\D", "", s)


def _dv_ok(d):
    """Dígitos verificadores de CPF (11) ou CNPJ (14)."""
    if len(set(d)) == 1:
        return False
    if len(d) == 11:
        pesos = [list(range(10, 1, -1)), list(range(11, 1, -1))]
    else:
        pesos = [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]
    for i, w in enumerate(pesos):
        r = sum(int(x) * p for x, p in zip(d, w)) % 11
        if int(d[len(w)]) != (0 if r < 2 else 11 - r):
            return False
    return True


def _documento(v, tamanhos):
    d = _digitos(v)
    if d is None:
        return None, "documento_invalido"
    if not d or int(d) == 0:  # vazio ou 0 (convenção de 'sem documento' em coluna numérica): NULL sem pendência
        return None, None
    for n in tamanhos:
        if len(d) <= n:
            d = d.zfill(n)
            return (d, None) if _dv_ok(d) else (None, "documento_invalido")
    return None, "documento_invalido"
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
    par = _parametro(regra)
    if regra not in REGRAS and par is None:
        raise KeyError("regra de coluna desconhecida: %s" % regra)
    if v is None:
        return None, None
    if par and par[0] in ("faixa", "piso"):
        try:
            x = v if isinstance(v, decimal.Decimal) else decimal.Decimal(_str(v).strip() if isinstance(
                v, (str, bytes, bytearray)) else str(v))
        except decimal.InvalidOperation:
            return None, "valor_fora_do_dominio"
        if not x.is_finite():
            return None, "valor_fora_do_dominio"
        if par[0] == "piso":
            n = par[1][0]
            if x < n:
                return (int(n) if n == n.to_integral_value() and isinstance(v, int) else n), "valor_elevado_ao_minimo"
            return (v if isinstance(v, int) else x), None
        a, b = par[1]
        return ((v if isinstance(v, int) else x), None) if a <= x <= b else (None, "valor_fora_do_dominio")
    if par and par[0] == "texto_resumo":
        s = _txt(v, "pontas")
        n = par[1][0]
        if s is None or len(s) <= n:
            return s, None
        corte = s[:n]
        if not s[n].isspace() and re.search(r"\s", corte):
            corte = corte.rsplit(None, 1)[0]
        return (corte.rstrip() or s[:n]), "texto_resumido"
    if regra == "minutos_em_timestamp":
        if isinstance(v, datetime.datetime):
            h, pend = v.time(), (None if v.date() == DATA_ZERO else "hora_com_data")
        elif isinstance(v, datetime.time):
            h, pend = v, None
        else:
            return None, "valor_fora_do_dominio"
        m = h.hour * 60 + h.minute
        return (m or None), (pend if m else None)
    if par and par[0] in REGRAS_RECORRENCIA:
        if not isinstance(v, (datetime.date, datetime.datetime)):
            return None, "valor_fora_do_dominio"
        if _data(v):
            return None, "data_sentinela"
        d = v.date() if isinstance(v, datetime.datetime) else v
        marca = d.year == par[1][0]
        if par[0] == "ano_recorrente":
            return marca, None
        if par[0] == "data_nao_recorrente":
            return (None if marca else d), None
        return ((d.day if par[0] == "dia_recorrente" else d.month) if marca else None), None
    if par and par[0] == "inteiro_faixa":
        a, b = par[1]
        try:
            n = int(v)
        except (TypeError, ValueError):
            return None, "valor_fora_do_dominio"
        inteiro = not isinstance(v, (decimal.Decimal, float)) or v == n
        return (n, None) if inteiro and a <= n <= b else (None, "valor_fora_do_dominio")
    if par:  # inteiro_zeros_esquerda
        d = _digitos(v)
        n = par[1][0]
        if not d or len(d) > n or int(d) == 0:
            return None, (None if d == "" else "valor_fora_do_dominio")
        return d.zfill(n), None
    if regra == "preenchido":
        return bool(_str(v).strip()) if isinstance(v, (str, bytes, bytearray)) else True, None
    if regra == "decimal_positivo":
        x = v if isinstance(v, decimal.Decimal) else decimal.Decimal(str(v))
        return (x, None) if x > 0 else (None, "valor_fora_do_dominio")
    if regra == "decimal_nao_negativo":
        x = v if isinstance(v, decimal.Decimal) else decimal.Decimal(str(v))
        return (x, None) if x >= 0 else (None, "valor_fora_do_dominio")
    if regra == "competencia_aaaamm":
        t = _str(v).strip() if isinstance(v, (str, bytes, bytearray)) else v
        if t == "" or t == 0:
            return None, None
        if isinstance(t, str):
            if not re.fullmatch(r"\d{6}", t):
                return None, "valor_fora_do_dominio"
            t = int(t)
        if isinstance(t, (decimal.Decimal, float)) and t != int(t) or isinstance(t, bool):
            return None, "valor_fora_do_dominio"
        n = int(t)
        ano, mes = divmod(n, 100)
        if not (1800 <= ano <= 9999 and 1 <= mes <= 12):
            return None, "valor_fora_do_dominio"
        return datetime.date(ano, mes, 1), None
    if regra == "data_primeiro_dia_mes":
        if not isinstance(v, (datetime.date, datetime.datetime)):
            return None, "valor_fora_do_dominio"
        if _data(v):
            return None, "data_sentinela"
        d = v.date() if isinstance(v, datetime.datetime) else v
        return d.replace(day=1), None
    if regra == "cnpj":
        return _documento(v, (14,))
    if regra == "cpf":
        return _documento(v, (11,))
    if regra == "cpf_cnpj":
        return _documento(v, (11, 14))
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
    if regra == "inteiro_nao_negativo":
        return (None, "valor_fora_do_dominio") if v is not None and v < 0 else (v, None)
    if regra == "decimal_zero_nulo":
        if v is None or v == 0:
            return None, None
        return (v if isinstance(v, decimal.Decimal) else decimal.Decimal(str(v))), None
    if regra == "minutos_hhmm":
        if isinstance(v, (bytes, bytearray, str)):
            t = _str(v).strip().replace(":", "")
            if not t:
                return None, None
            if not re.fullmatch(r"\d{1,6}", t):
                return None, "valor_fora_do_dominio"
            v = int(t)
        if isinstance(v, bool) or not isinstance(v, (int, decimal.Decimal)) or v != int(v) or v < 0:
            return None, "valor_fora_do_dominio"
        v = int(v)
        if v % 100 >= 60:
            return None, "valor_fora_do_dominio"
        m = v // 100 * 60 + v % 100
        return (m or None), None
    if regra == "email":
        t = _txt(v, "pontas")
        if t is None:
            return None, None
        return (t, None) if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s.]{2,}", t) else (None, "valor_fora_do_dominio")
    if regra == "hora_hhmm":
        if isinstance(v, (bytes, bytearray)):  # texto cru CP1252 de VARCHAR/CHAR (L6-04)
            v = _str(v)
        if isinstance(v, str):
            s = v.strip().replace(":", "")
            if not s:
                return None, None
            v = int(s) if re.fullmatch(r"\d{3,4}", s) else -1
        if isinstance(v, int) and 0 <= v <= 2359 and v % 100 < 60:
            return datetime.time(v // 100, v % 100), None
        return None, "hora_invalida"
    if regra == "flutuante":
        return decimal.Decimal(repr(float(v))), None
    if regra == "decimal":
        return (v if isinstance(v, decimal.Decimal) else decimal.Decimal(str(v))), None
    return v, None  # hora, inteiro, blob, chave_origem: sem conversão (blob em bytes originais)
