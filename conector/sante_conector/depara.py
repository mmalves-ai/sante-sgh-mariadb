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


def norm_banco(v):
    d = _digitos(v)
    return d.zfill(3) if 0 < len(d) <= 3 else None


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
}


def consulta(catalogo):
    """SQL que lê os pares (código, id) do catálogo oficial no banco do cliente."""
    c = CATALOGOS[catalogo]
    sql = "SELECT %s, id FROM %s WHERE %s IS NOT NULL" % (c["coluna"], c["tabela"], c["coluna"])
    return sql + (" AND " + c["filtro"] if c["filtro"] else "")


class Depara:
    """Resolve valores da origem para o id do catálogo oficial. Sem acesso a banco: recebe os pares já lidos."""

    def __init__(self, catalogo, pares):
        self.catalogo = catalogo
        c = CATALOGOS[catalogo]
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
