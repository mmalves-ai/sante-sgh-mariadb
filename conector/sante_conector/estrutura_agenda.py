"""Extrator determinístico do texto livre da agenda (ADR 0009, decisão 27): funções puras, sem banco.

O texto da agenda (observação, orientação da marcação e observação por convênio) vira regras estruturadas, como
MELHOR ESTIMATIVA (`situacao_revisao` = estimada: já vale), e o texto original fica inteiro ao lado. Cada trecho do
texto vira um `trecho_texto_agenda`: interpretado (com o tipo da regra) ou NÃO interpretado (com o motivo), e o trecho
não interpretado continua valendo pelo texto. Posições em caracteres, base 0, fim exclusivo.

Formatos reconhecidos (seção 2 da resposta do agente de marcação):
- valor particular de consulta ("VALOR DA/DE CONSULTA PARTICULAR: R$ 250,00", com "R$:", ponto ou vírgula, por
  extenso e forma de pagamento; a forma de pagamento fica como trecho não interpretado). Valor de exame sem item, valor
  em parcelas, valor de procedimento citado e valor "para paciente de convênio" (decisão 24: preço de convênio vem do
  convênio) ficam NÃO interpretados;
- convênio aceito ou recusado em lista ("CONVÊNIOS COM/SEM CREDENCIAMENTO: A, B, C"), pelo nome no cadastro de fontes
  pagadoras (sem acento, sem espaço: "SUL AMERICA" = "SULAMÉRICA"); nome que só começa outro (marca) vale para todas
  as fontes da marca; nome que começa pelo nome de uma fonte e traz mais (ex.: "ALFA S10") é SUBPLANO dessa fonte;
- subplano ("NÃO ATENDEMOS (O) SUBPLANO X E Y"): no texto por convênio, plano dentro do convênio; no geral, pelo nome;
- convênio aceito com condição ("NECESSÁRIO SOLICITAR AUTORIZAÇÃO PRÉVIA" no texto por convênio; "PARA O(S)
  CONVÊNIO(S) A, B E C, ..." no geral): cobertura aceita, com a condição na observação;
- preparo: "NÃO É NECESSÁRIO PREPARO", documentos ("NO DIA DO EXAME É NECESSÁRIO TRAZER ..."), bloco que começa por
  "PREPARO..."/"ORIENTAÇÕES" até a próxima linha reconhecida (jejum em horas quando o bloco cita um só jejum);
- restrições: faixa etária ("TODAS AS IDADES", "A PARTIR DE N ANOS", "ATÉ N ANOS", "DE N A M ANOS"), sexo
  ("SOMENTE MULHERES"/"APENAS HOMENS"), retorno ("NÃO ATENDE RETORNO", "RETORNO EM ATÉ N DIAS") e encaixe
  ("NÃO FAZ ENCAIXE").
Nunca registra valor de texto em log: o chamador só conta.
"""
import hashlib
import re
import unicodedata

VERSAO = "conector-1"
MAX_DESCRICAO = 60000      # agenda_preparo.descricao é TEXT (64 KiB); o texto inteiro fica no texto original
MAX_OBSERVACAO = 500


def normalizar(s):
    """Mesmo tamanho do texto: maiúsculas sem acento; o que não é letra nem dígito vira espaço (posições valem)."""
    out = []
    for ch in s or "":
        d = "".join(x for x in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(x))
        b = (d[:1] or " ").upper()[:1]
        out.append(b if b.isalnum() else " ")
    return "".join(out)


def chave(s):
    """Chave de casamento por nome: só letras e dígitos, maiúsculas, sem acento ("Sul América" = "SULAMERICA")."""
    return normalizar(s).replace(" ", "")


def hash_texto(texto):
    """Os 16 primeiros bytes do SHA-256 do texto em UTF-8 (o mesmo de UNHEX(LEFT(SHA2(texto,256),32)))."""
    return hashlib.sha256((texto or "").encode("utf-8")).digest()[:16]


_DINHEIRO = re.compile(r"R\$\s*:?\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)")


def valores(linha):
    """[(inicio, fim, valor em centavos)] dos valores em reais da linha."""
    out = []
    for m in _DINHEIRO.finditer(linha):
        t = m.group(1)
        if "," in t:
            inteiro, _, dec = t.replace(".", "").partition(",")
        elif re.fullmatch(r"\d+\.\d{1,2}", t):
            inteiro, _, dec = t.partition(".")
        else:
            inteiro, dec = t.replace(".", ""), ""
        out.append((m.start(), m.end(), int(inteiro) * 100 + int((dec + "00")[:2])))
    return out


def resolver_convenio(nome, fontes):
    """[(fonte_id, subplano ou None)] pelo nome citado; [] se não casa. `fontes`: [{"id", "nome"}]."""
    k = chave(nome)
    if len(k) < 2:
        return []
    exatas = [f["id"] for f in fontes if chave(f["nome"]) == k]
    if exatas:
        return [(i, None) for i in exatas]
    marca = [f["id"] for f in fontes if chave(f["nome"]).startswith(k)]
    if marca:
        return [(i, None) for i in marca]
    sup = [(len(chave(f["nome"])), f["id"]) for f in fontes
           if len(chave(f["nome"])) >= 3 and k.startswith(chave(f["nome"]))]
    if sup:
        n = max(t for t, _ in sup)
        ids = [i for t, i in sup if t == n]
        if len(ids) == 1:
            return [(ids[0], " ".join(nome.split()))]
    # a primeira palavra é a de uma única fonte (marca: "ALFA S10" no convênio "ALFA SAÚDE"): subplano dela
    p1 = normalizar(nome).split()
    if len(p1) > 1 and len(p1[0]) >= 3:
        ids = [f["id"] for f in fontes if normalizar(f["nome"]).split()[:1] == p1[:1]]
        if len(ids) == 1:
            return [(ids[0], " ".join(nome.split()))]
    return []


def _linhas(texto):
    """[(inicio, fim)] de cada linha não vazia, sem os espaços, marcadores e controles das pontas."""
    out = []
    for m in re.finditer(r"[^\n]+", texto):
        a, b = m.start(), m.end()
        while a < b and (texto[a].isspace() or texto[a] in "\u0095·•-*" or unicodedata.category(texto[a]) == "Cc"):
            a += 1
        while b > a and (texto[b - 1].isspace() or unicodedata.category(texto[b - 1]) == "Cc"):
            b -= 1
        if b > a:
            out.append((a, b))
    return out


def _pedacos(texto, a, b, separar_e):
    """Nomes de uma lista em texto[a:b]: separados por vírgula ou ';' (e por ' E ' quando pedido): [(ini, fim)]."""
    partes, ini = [], a
    for i in range(a, b + 1):
        if i == b or texto[i] in ",;":
            partes.append((ini, i))
            ini = i + 1
    out = []
    for x, y in partes:
        segs = [(x, y)]
        if separar_e:
            n = normalizar(texto[x:y])
            segs, p = [], x
            for m in re.finditer(r" E ", n):
                segs.append((p, x + m.start()))
                p = x + m.end()
            segs.append((p, y))
        for s, e in segs:
            while s < e and (texto[s].isspace() or texto[s] in ".:-/"):
                s += 1
            while e > s and (texto[e - 1].isspace() or texto[e - 1] in ".:-/"):
                e -= 1
            if e > s:
                out.append((s, e))
    return out


_PREPARO_INICIO = re.compile(r"^ *(PREPARO|PREPAROS|ORIENTACOES|ORIENTACAO)\b")
_RECONHECIDA = re.compile(r"^ *(VALOR|VALORES|CONVENIOS? +(SEM|COM) +CREDENCIAMENTO|NAO +ATENDEMOS|FAIXA +ETARIA|"
                          r"NO +DIA +DO +EXAME|NAO +E +NECESSARIO +PREPARO|NECESSARIO +SOLICITAR|PARA +((O|OS) +)?"
                          r"(PACIENTES? +(DO|DOS) +)?CONVENIOS?)\b")


class Extracao:
    def __init__(self, texto):
        self.texto = texto
        self.precos, self.coberturas, self.restricoes, self.preparos, self.trechos = [], [], [], [], []

    def trecho(self, a, b, tipo=None, motivo=None):
        if b > a and not any(t["inicio"] == a and t["fim"] == b for t in self.trechos):
            self.trechos.append({"inicio": a, "fim": b, "interpretado": tipo is not None, "tipo_regra": tipo,
                                 "motivo": None if tipo else (motivo or "sem regra estruturada para este trecho")[:300]})

    def interpretados(self):
        return sum(1 for t in self.trechos if t["interpretado"])


def extrair(texto, campo, fonte_id=None, fontes=(), fonte_particular_id=None):
    """Regras estimadas e trechos de UM texto. `campo`: observacao | orientacao_marcacao | observacao_convenio
    (este com `fonte_id`). Devolve `Extracao` (precos, coberturas, restricoes, preparos, trechos)."""
    ex = Extracao(texto or "")
    t = ex.texto
    fontes = list(fontes)
    nome_fonte = next((f["nome"] for f in fontes if f["id"] == fonte_id), "")
    linhas = _linhas(t)
    i = 0
    while i < len(linhas):
        a, b = linhas[i]
        n = normalizar(t[a:b])
        if _PREPARO_INICIO.match(n):  # bloco de preparo até a próxima linha reconhecida
            j = i + 1
            while j < len(linhas) and not _RECONHECIDA.match(normalizar(t[linhas[j][0]:linhas[j][1]])):
                j += 1
            fim = linhas[j - 1][1]
            _preparo_bloco(ex, a, fim)
            i = j
            continue
        _linha(ex, a, b, n, campo, fonte_id, nome_fonte, fontes, fonte_particular_id)
        i += 1
    return ex


def _preparo_bloco(ex, a, b):
    t = ex.texto
    corpo = re.sub(r"[\u0080-\u009f]", "- ", t[a:b]).replace("\r", "")
    jejuns = re.findall(r"JEJUM +DE +(\d+)(?: +A +(\d+))? +HORAS", normalizar(corpo))
    jejum = None
    if len(jejuns) == 1:
        h = int(jejuns[0][1] or jejuns[0][0])
        jejum = h if 1 <= h <= 72 else None
    ex.preparos.append({"tipo": "preparo", "descricao": corpo[:MAX_DESCRICAO], "jejum_horas": jejum,
                        "trecho": (a, b)})
    ex.trecho(a, b, "preparo")


def _linha(ex, a, b, n, campo, fonte_id, nome_fonte, fontes, fonte_particular_id):
    t = ex.texto
    linha = t[a:b]
    # valor
    if re.match(r"^ *VALOR(ES)?\b", n):
        vs = valores(linha)
        consulta = re.match(r"^ *VALOR +(DA|DE|DO) +CONSULTA +PARTICULAR\b", n) or (
            campo == "observacao_convenio" and fonte_id is not None and fonte_id == fonte_particular_id
            and re.match(r"^ *VALOR +(DA|DE|DO) +CONSULTA\b", n))
        if re.search(r"\bCONVENIOS?\b", n) and "PARTICULAR" not in n:
            ex.trecho(a, b, motivo="valor para paciente de convênio: o preço de convênio vem do convênio (decisão 24)")
        elif not vs:
            ex.trecho(a, b, motivo="valor sem quantia em reais reconhecível")
        elif len(vs) > 1:
            ex.trecho(a, b, motivo="valor em parcelas: a soma e o destino de cada parcela ficam para a revisão")
        elif not consulta:
            ex.trecho(a, b, motivo="valor de exame ou procedimento sem item resolvido: aguarda o item na revisão")
        elif fonte_particular_id is None:
            ex.trecho(a, b, motivo="fonte pagadora particular indefinida no cadastro")
        else:
            _, fim_v, centavos = vs[0]
            fim = a + fim_v
            m = re.match(r"\s*\([^)]*\)", linha[fim_v:])
            if m and re.search(r"\bREAIS\b", normalizar(m.group(0))):
                fim = a + fim_v + m.end()  # o valor por extenso entre parênteses faz parte do trecho do preço
            ex.precos.append({"alvo": "consulta", "valor_centavos": centavos, "trecho": (a, fim)})
            ex.trecho(a, fim, "preco")
            resto = re.search(r"[A-Za-z]", t[fim:b])
            if resto:
                ex.trecho(fim + resto.start(), b, motivo="forma de pagamento ou observação sem coluna estruturada")
        return
    # procedimento com valor sem o prefixo VALOR (tabela de exames numa agenda de consulta)
    if valores(linha):
        ex.trecho(a, b, motivo="valor de procedimento citado sem item resolvido: aguarda o item na revisão")
        return
    # convênio aceito ou recusado em lista
    m = re.match(r"^ *CONVENIOS? +(SEM|COM) +CREDENCIAMENTO\b", n)
    if m:
        aceita = m.group(1) == "COM"
        dois = linha.find(":")
        ini = a + (dois + 1 if dois >= 0 else m.end())
        for s, e in _pedacos(t, ini, b, separar_e=False):
            alvos = resolver_convenio(t[s:e], fontes)
            if not alvos and " E " in normalizar(t[s:e]):
                partes = _pedacos(t, s, e, separar_e=True)
                if all(resolver_convenio(t[x:y], fontes) for x, y in partes):
                    for x, y in partes:
                        _cobertura(ex, x, y, resolver_convenio(t[x:y], fontes), aceita, None)
                    continue
            if alvos:
                _cobertura(ex, s, e, alvos, aceita, None)
            else:
                ex.trecho(s, e, motivo="convênio citado sem cadastro correspondente")
        return
    # subplano não atendido
    m = re.match(r"^ *NAO +ATENDEMOS +(O +)?(SUBPLANOS? +)?", n)
    if m:
        for s, e in _pedacos(t, a + m.end(), b, separar_e=True):
            nome = " ".join(t[s:e].split())
            if fonte_id is not None:
                alvos = [(fonte_id, nome)]
                if chave(nome) == chave(nome_fonte):
                    alvos = [(fonte_id, None)]
            else:
                alvos = resolver_convenio(nome, fontes)
            if alvos:
                _cobertura(ex, s, e, alvos, False, None)
            else:
                ex.trecho(s, e, motivo="subplano citado sem convênio correspondente no cadastro")
        return
    # convênio aceito com condição
    if fonte_id is not None and re.match(r"^ *NECESSARIO +SOLICITAR\b", n):
        _cobertura(ex, a, b, [(fonte_id, None)], True, " ".join(linha.split())[:MAX_OBSERVACAO])
        return
    m = re.match(r"^ *PARA +((O|OS) +)?(PACIENTES? +(DO|DOS) +)?CONVENIOS? +", n)
    if m:
        virg = re.search(r",", linha[m.end():])
        fim_lista = a + m.end() + (virg.start() if virg else 0)
        if virg:
            nomes = _pedacos(t, a + m.end(), fim_lista, separar_e=True)
            res = [(s, e, resolver_convenio(t[s:e], fontes)) for s, e in nomes]
            if res and all(r for _, _, r in res):
                cond = " ".join(linha.split())[:MAX_OBSERVACAO]
                for s, e, r in res:
                    _cobertura(ex, s, e, r, True, cond)
                ex.trecho(fim_lista + 1, b, motivo="condição do convênio guardada na observação da cobertura")
                return
        ex.trecho(a, b, motivo="convênio com condição sem cadastro correspondente")
        return
    # preparo e documentos de uma linha
    if re.match(r"^ *NAO +E +NECESSARIO +PREPARO\b", n):
        ex.preparos.append({"tipo": "preparo", "descricao": " ".join(linha.split()), "jejum_horas": None,
                            "trecho": (a, b)})
        ex.trecho(a, b, "preparo")
        return
    if re.match(r"^ *(NO +DIA +DO +EXAME +)?(E +NECESSARIO +)?TRAZER\b", n) or re.match(
            r"^ *NO +DIA +DO +EXAME +E +NECESSARIO +TRAZER\b", n):
        ex.preparos.append({"tipo": "documento", "descricao": " ".join(linha.split()), "jejum_horas": None,
                            "trecho": (a, b)})
        ex.trecho(a, b, "preparo")
        return
    # restrições
    r = _restricao(n)
    if r:
        if fonte_id is not None:
            r["fonte_pagadora_id"] = fonte_id
        r["trecho"] = (a, b)
        ex.restricoes.append(r)
        ex.trecho(a, b, "restricao")
        return
    ex.trecho(a, b)


def _cobertura(ex, s, e, alvos, aceita, observacao):
    for fid, sub in alvos:
        ex.coberturas.append({"fonte_pagadora_id": fid, "subplano": sub, "aceita": aceita,
                              "observacao": observacao, "trecho": (s, e)})
    ex.trecho(s, e, "cobertura")


def _restricao(n):
    r = {}
    if re.match(r"^ *FAIXA +ETARIA\b", n):
        if re.search(r"\bTODAS +AS +IDADES\b", n):
            r["idade_minima_anos"] = 0
        m = re.search(r"\bDE +(\d+) +(A|ATE) +(\d+) +ANOS\b", n)
        if m:
            r["idade_minima_anos"], r["idade_maxima_anos"] = int(m.group(1)), int(m.group(3))
        else:
            m = re.search(r"\bA +PARTIR +DE +(\d+) +ANOS?\b", n) or re.search(r"\bACIMA +DE +(\d+) +ANOS?\b", n)
            if m:
                r["idade_minima_anos"] = int(m.group(1))
            m = re.search(r"\bATE +(\d+) +ANOS?\b", n)
            if m:
                r["idade_maxima_anos"] = int(m.group(1))
    elif re.match(r"^ *ATENDE +(CRIANCAS +|PACIENTES +)?A +PARTIR +DE +(\d+) +ANOS?\b", n):
        r["idade_minima_anos"] = int(re.match(r"^ *ATENDE +(CRIANCAS +|PACIENTES +)?A +PARTIR +DE +(\d+)", n).group(2))
    if re.search(r"\b(SOMENTE|APENAS|SO) +(ATENDE +)?(MULHERES|PACIENTES +DO +SEXO +FEMININO|SEXO +FEMININO)\b", n):
        r["sexo_atendido"] = "feminino"
    elif re.search(r"\b(SOMENTE|APENAS|SO) +(ATENDE +)?(HOMENS|PACIENTES +DO +SEXO +MASCULINO|SEXO +MASCULINO)\b", n):
        r["sexo_atendido"] = "masculino"
    if re.search(r"\bNAO +(ATENDE|FAZ|MARCA|REALIZA) +RETORNOS?\b", n):
        r["aceita_retorno"] = False
    m = re.search(r"\bRETORNO +(EM +ATE|ATE|EM) +(\d+) +DIAS\b", n)
    if m:
        r["dias_retorno"] = int(m.group(2))
    if re.search(r"\bNAO +(ATENDE|FAZ|MARCA|REALIZA|ACEITA) +ENCAIXES?\b", n):
        r["permite_encaixe"] = False
    for k in ("idade_minima_anos", "idade_maxima_anos"):
        if k in r and r[k] > 130:
            return {}
    if r.get("idade_maxima_anos") is not None and r.get("idade_minima_anos", 0) > r["idade_maxima_anos"]:
        return {}
    if r.get("dias_retorno") is not None and r["dias_retorno"] > 65535:
        return {}
    return r
