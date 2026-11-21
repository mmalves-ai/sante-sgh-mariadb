"""De-para de valores da origem com os catálogos OFICIAIS já carregados (F4 L4, item 4).

Catálogo oficial nunca é criado nem alterado pelo conector (AGENTS.md regra 7): o código da origem é normalizado e
procurado no catálogo; ausente ou inválido vira pendência (sem valor), e a linha segue a regra da coluna (NULL se
opcional, recusa se obrigatória). Quais colunas usam cada catálogo está em `conector/mapa/colunas.tsv` (coluna
`depara`) e as tabelas da origem que SÃO catálogo oficial em `conector/mapa/declarado/catalogos.tsv`.
"""
import re

from .texto import cp1252_para_texto


def _s(v):
    if v is None:
        return ""
    if isinstance(v, (bytes, bytearray)):
        v = cp1252_para_texto(v) or ""
    return str(v).strip().upper()


def _digitos(v):
    return re.sub(r"\D", "", _s(v))


def norm_cid10(v):
    s = re.sub(r"[\s.\-*+]", "", _s(v))
    return s if re.fullmatch(r"[A-Z][0-9]{2}[0-9A-Z]?", s) else None


def norm_sigtap(v):
    d = _digitos(v)
    return d.zfill(10) if 0 < len(d) <= 10 and int(d) > 0 else None


def norm_cbo(v):
    s = re.sub(r"[^0-9A-Z]", "", _s(v))
    return s if len(s) == 6 else None


def norm_municipio(v):
    """Município pelo código de 6 dígitos (o 7.º é verificador): a origem guarda ora 6, ora 7."""
    d = _digitos(v)
    return d[:6] if len(d) in (6, 7) and int(d) > 0 else None


def norm_uf(v):
    s = _s(v)
    return s if re.fullmatch(r"[A-Z]{2}", s) else None


def norm_conselho(v):
    """Conselho profissional pela sigla (CRM, COREN...): só letras, em maiúsculas, como o CHECK do catálogo."""
    s = re.sub(r"[\s.\-]", "", _s(v))
    return s if re.fullmatch(r"[A-Z]{2,10}", s) else None


def norm_banco(v):
    d = _digitos(v)
    return d.zfill(3) if 0 < len(d) <= 3 else None


def norm_cfop(v):
    """CFOP (Convênio SINIEF s/n.º de 1970): 4 dígitos, o 1.º de 1 a 7 (entrada 1-3, saída 5-7). A origem guarda
    ora o número (1102), ora o texto com ponto ('1.102'); pontuação e espaços não contam. Outro tamanho ou 1.º dígito
    fora de 1-3 e 5-7: inválido (pendência `catalogo_codigo_invalido`)."""
    s = re.sub(r"[\s.\-/]", "", _s(v))
    return s if re.fullmatch(r"[1235-7][0-9]{3}", s) else None


def norm_versao_tiss(v):
    """Versão do padrão TISS (ex.: 4.03.00): a origem guarda '04.03.00', '4.3.0' ou '040300'; vira 'M.mm.pp'."""
    s = _s(v)
    m = re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{1,2})", s) or re.fullmatch(r"(\d{2})(\d{2})(\d{2})", s)
    return "%d.%02d.%02d" % tuple(int(x) for x in m.groups()) if m else None


def _chave_versao_tiss(c):
    return norm_versao_tiss(c) or c


def norm_esocial(v):
    """Código de tabela oficial trabalhista (eSocial): texto aparado em maiúsculas; código só de dígitos sem os zeros
    à esquerda (a origem guarda 1 e o catálogo '01')."""
    s = _s(v).upper()
    if not s or len(s) > 20 or not re.fullmatch(r"[0-9A-Z.\-]+", s):
        return None
    return s.lstrip("0") or "0" if s.isdigit() else s


# catálogo -> tabela e coluna de código do destino (conferidas no DDL pelo verificador), normalização da origem e
# como a chave do catálogo é reduzida para casar com a normalização
CATALOGOS = {
    "cid10": dict(tabela="termo_terminologia", coluna="codigo_termo", normalizar=norm_cid10, chave=lambda c: c,
                  filtro="terminologia_id = (SELECT id FROM terminologia WHERE codigo = 'cid10')",
                  descricao="CID-10 (DATASUS), categoria ou subcategoria sem ponto"),
    "sigtap": dict(tabela="procedimento_sigtap", coluna="codigo_sigtap", normalizar=norm_sigtap, chave=lambda c: c,
                   filtro=None, descricao="procedimento da tabela unificada do SUS, 10 dígitos"),
    "cbo": dict(tabela="ocupacao_cbo", coluna="codigo_cbo", normalizar=norm_cbo, chave=lambda c: c, filtro=None,
                descricao="ocupação CBO, 6 posições"),
    "ibge_municipio": dict(tabela="municipio_ibge", coluna="codigo_ibge", normalizar=norm_municipio,
                           chave=lambda c: c[:6], filtro=None, descricao="município IBGE pelos 6 primeiros dígitos"),
    "ibge_uf": dict(tabela="unidade_federativa", coluna="sigla", normalizar=norm_uf, chave=lambda c: c.upper(),
                    filtro=None, descricao="unidade federativa pela sigla"),
    "banco": dict(tabela="banco", coluna="codigo_compensacao", normalizar=norm_banco, chave=lambda c: c,
                  filtro=None, descricao="banco pelo código de compensação (COMPE), 3 dígitos"),
    "cfop": dict(tabela="cfop", coluna="codigo_cfop", normalizar=norm_cfop, chave=lambda c: c, filtro=None,
                 descricao="CFOP pelo código de 4 dígitos (ponto e espaços não contam)"),
    "versao_tiss": dict(tabela="versao_padrao_tiss", coluna="codigo_tiss", normalizar=norm_versao_tiss,
                        chave=_chave_versao_tiss, filtro="componente = 'troca'",
                        descricao="versão do padrão TISS de troca com a operadora (ex.: 4.03.00; zeros não contam)"),
    "terminologia": dict(tabela="terminologia", coluna="numero_tabela_tiss", normalizar=norm_esocial,
                         chave=norm_esocial, filtro=None,
                         descricao="terminologia pelo número da tabela no padrão TISS (ex.: 18, 22; zeros não contam)"),
    "conselho_classe": dict(tabela="conselho_classe", coluna="sigla", normalizar=norm_conselho,
                            chave=lambda c: c.upper(), filtro=None,
                            descricao="conselho profissional pela sigla (CRM, COREN...)"),
}


# catálogos com parâmetro (`nome:<parâmetro>` no mapa): codigo_esocial:<código oficial da tabela> (ex.: 18, motivo de
# afastamento); codigo_fiscal:<tabela fiscal oficial> (ex.: modelo_documento, cst_pis: código fiscal oficial de outra
# tabela da escrituração, pela tabela e pelo código); tiss:<número da tabela TISS> (ex.: 61, termo da terminologia
# pelo código). O parâmetro só aceita [0-9A-Za-z_] (entra no filtro do SQL).
CATALOGOS_PARAMETRO = {
    "codigo_esocial": dict(tabela="codigo_esocial", coluna="codigo_esocial", normalizar=norm_esocial,
                           chave=norm_esocial, pai="tabela_esocial",
                           filtro="tabela_esocial_id = (SELECT id FROM tabela_esocial WHERE codigo_oficial = '{p}'"
                                  " OR codigo_oficial = LPAD('{p}', 2, '0') LIMIT 1)",
                           descricao="código de uma tabela oficial trabalhista (eSocial), pela tabela e pelo código; "
                                     "zeros à esquerda não contam"),
    "tiss": dict(tabela="termo_terminologia", coluna="codigo_termo", normalizar=norm_esocial, chave=norm_esocial,
                 pai="terminologia",
                 filtro="terminologia_id IN (SELECT id FROM terminologia WHERE numero_tabela_tiss = '{p}'"
                        " OR numero_tabela_tiss = LPAD('{p}', 2, '0'))",
                 descricao="termo de uma terminologia do padrão TISS pelo número da tabela e pelo código do termo; "
                           "zeros à esquerda não contam"),
    "codigo_fiscal": dict(tabela="codigo_fiscal_oficial", coluna="codigo_oficial", normalizar=norm_esocial,
                          chave=norm_esocial, pai="tabela_fiscal_oficial",
                          filtro="tabela_fiscal_oficial_id IN (SELECT id FROM tabela_fiscal_oficial"
                                 " WHERE tabela = '{p}') ORDER BY vigencia_fim IS NULL DESC, vigencia_inicio DESC",
                          descricao="código de uma tabela fiscal oficial (escrituração), pela tabela e pelo código; "
                                    "zeros à esquerda não contam; o código repetido por vigência casa com o vigente "
                                    "(o histórico revogado também casa: a nota antiga usa o código da época)"),
}


def catalogo(nome):
    """Configuração do catálogo `nome` (simples ou `nome:<parâmetro>`); None se desconhecido."""
    if nome in CATALOGOS:
        return CATALOGOS[nome]
    base, sep, p = (nome or "").partition(":")
    if sep and base in CATALOGOS_PARAMETRO and re.fullmatch(r"[0-9A-Za-z_]{1,20}", p):
        c = dict(CATALOGOS_PARAMETRO[base])
        c["filtro"] = c["filtro"].format(p=p)
        return c
    return None


def conhecido(nome):
    return catalogo(nome) is not None


def consulta(catalogo_):
    """SQL que lê os pares (código, id) do catálogo oficial no banco do cliente."""
    c = catalogo(catalogo_)
    sql = "SELECT %s, id FROM %s WHERE %s IS NOT NULL" % (c["coluna"], c["tabela"], c["coluna"])
    return sql + (" AND " + c["filtro"] if c["filtro"] else "")


class Depara:
    """Resolve valores da origem para o id do catálogo oficial. Sem acesso a banco: recebe os pares já lidos."""

    def __init__(self, catalogo, pares):
        self.catalogo = catalogo
        c = globals()["catalogo"](catalogo)
        self._norm = c["normalizar"]
        self._ids = {}
        for codigo, id_ in pares:
            if codigo is not None:
                self._ids.setdefault(c["chave"](str(codigo).strip()), id_)

    def resolver(self, valor):
        """(id, None) quando acha; (None, None) para vazio; (None, regra) para inválido ou inexistente."""
        if valor is None or _s(valor) in ("", "0"):
            return None, None
        k = self._norm(valor)
        if k is None:
            return None, "catalogo_codigo_invalido"
        if k not in self._ids:
            return None, "catalogo_codigo_inexistente"
        return self._ids[k], None
