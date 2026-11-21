"""Leitor da origem: Firebird embarcado, transação SNAPSHOT READ ONLY, valores em bytes crus.

- Texto (CHAR/VARCHAR, qualquer charset) sai como `bytes` por CAST para CHARACTER SET OCTETS: são os bytes
  gravados, com o preenchimento de CHAR; nada é transliterado.
- BLOB de texto sai como BLOB binário (bytes).
- Leitura por faixa de PK inteira (`ler_faixa`) ou por chave composta/ordem declarada (`ler_por_chave`, keyset).
- Nomes de tabela e coluna vêm só do catálogo (RDB$) e são conferidos; nada de SQL montado com entrada livre.
- Nunca grava; nenhum valor de linha vai para log.
"""
import datetime
import decimal
import hashlib
import re

from firebird.driver import connect, driver_config, tpb, Isolation, TraAccessMode

driver_config.fb_client_library.value = "/opt/firebird/lib/libfbclient.so"
IDENT = re.compile(r"^[A-Z][A-Z0-9_$]{0,62}$")
TIPOS_TEXTO = (14, 37)
TIPOS_INTEIROS = (7, 8, 16)
NOME_TIPO = {7: "smallint", 8: "integer", 16: "bigint", 10: "float", 27: "double", 12: "date", 13: "time",
             35: "timestamp", 14: "char", 37: "varchar", 261: "blob", 23: "boolean"}


def _q(nome):
    if not IDENT.match(nome):
        raise ValueError("identificador fora do padrão do catálogo")
    return '"%s"' % nome


class Leitor:
    def __init__(self, banco, usuario="SYSDBA"):
        self.con = connect(banco, user=usuario, charset="UTF8")
        self.tm = self.con.transaction_manager(tpb(Isolation.SNAPSHOT, access_mode=TraAccessMode.READ))
        self.tm.begin()
        self._colunas = {}

    def fechar(self):
        try:
            if self.tm.is_active():
                self.tm.rollback()
        finally:
            self.con.close()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.fechar()

    def _cur(self):
        c = self.tm.cursor()
        c.stream_blob_threshold = 1 << 30
        return c

    def consultar(self, sql, params=None):
        with self._cur() as c:
            c.execute(sql, params or ())
            return c.fetchall()

    # ---------- catálogo ----------
    def somente_leitura(self):
        return bool(self.consultar("SELECT MON$READ_ONLY FROM MON$DATABASE")[0][0])

    def tabelas(self):
        return [r[0].strip() for r in self.consultar(
            "SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG,0)=0 "
            "AND RDB$VIEW_BLR IS NULL AND RDB$RELATION_TYPE IN (0) ORDER BY 1")]

    def colunas(self, tabela):
        if tabela not in self._colunas:
            rows = self.consultar(
                "SELECT rf.RDB$FIELD_NAME, f.RDB$FIELD_TYPE, COALESCE(f.RDB$FIELD_LENGTH,0), "
                "COALESCE(f.RDB$FIELD_SUB_TYPE,0), COALESCE(f.RDB$FIELD_SCALE,0), COALESCE(rf.RDB$NULL_FLAG,0) "
                "FROM RDB$RELATION_FIELDS rf JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME=rf.RDB$FIELD_SOURCE "
                "WHERE rf.RDB$RELATION_NAME=? AND f.RDB$COMPUTED_BLR IS NULL ORDER BY rf.RDB$FIELD_POSITION",
                (tabela,))
            self._colunas[tabela] = [
                {"nome": r[0].strip(), "tipo": NOME_TIPO.get(r[1], str(r[1])), "codigo_tipo": r[1],
                 "bytes": r[2], "subtipo": r[3], "escala": r[4], "obrigatoria": bool(r[5])} for r in rows]
        return self._colunas[tabela]

    def chave_primaria(self, tabela):
        return [r[0].strip() for r in self.consultar(
            "SELECT s.RDB$FIELD_NAME FROM RDB$RELATION_CONSTRAINTS c JOIN RDB$INDEX_SEGMENTS s "
            "ON s.RDB$INDEX_NAME=c.RDB$INDEX_NAME WHERE c.RDB$RELATION_NAME=? AND c.RDB$CONSTRAINT_TYPE="
            "'PRIMARY KEY' ORDER BY s.RDB$FIELD_POSITION", (tabela,))]

    def generators(self):
        nomes = [r[0].strip() for r in self.consultar(
            "SELECT RDB$GENERATOR_NAME FROM RDB$GENERATORS WHERE COALESCE(RDB$SYSTEM_FLAG,0)=0 ORDER BY 1")]
        return {n: self.consultar("SELECT GEN_ID(%s, 0) FROM RDB$DATABASE" % _q(n))[0][0] for n in nomes}

    def contar(self, tabela):
        return self.consultar("SELECT COUNT(*) FROM %s" % _q(tabela))[0][0]

    # ---------- leitura em bytes crus ----------
    def _expr(self, col):
        n = _q(col["nome"])
        if col["codigo_tipo"] in TIPOS_TEXTO:
            return "CAST(%s AS VARCHAR(%d) CHARACTER SET OCTETS)" % (n, max(col["bytes"], 1))
        if col["codigo_tipo"] == 261 and col["subtipo"] == 1:
            return "CAST(%s AS BLOB SUB_TYPE BINARY)" % n
        return n

    def _select(self, tabela, colunas):
        cols = self.colunas(tabela)
        if colunas:
            por = {c["nome"]: c for c in cols}
            cols = [por[c] for c in colunas]
        return [c["nome"] for c in cols], ", ".join(self._expr(c) for c in cols)

    def limites(self, tabela, pk):
        return tuple(self.consultar("SELECT MIN(%s), MAX(%s) FROM %s" % (_q(pk), _q(pk), _q(tabela)))[0])

    def ler_faixa(self, tabela, pk, inicio, fim, colunas=None):
        """Linhas com inicio <= pk < fim, ordenadas pela PK inteira. Devolve (nomes, gerador de tuplas)."""
        nomes, sel = self._select(tabela, colunas)
        sql = ("SELECT %s FROM %s WHERE %s >= ? AND %s < ? ORDER BY %s"
               % (sel, _q(tabela), _q(pk), _q(pk), _q(pk)))

        def linhas():
            with self._cur() as c:
                c.execute(sql, (inicio, fim))
                yield from c
        return nomes, linhas()

    def faixas(self, tabela, pk, bloco=10000):
        mn, mx = self.limites(tabela, pk)
        if mn is None:
            return
        ini = (mn // bloco) * bloco
        while ini <= mx:
            yield ini, ini + bloco
            ini += bloco

    def ler_por_chave(self, tabela, chaves, apos=None, limite=10000, colunas=None):
        """Keyset por chave composta (ou ordem declarada): linhas com chave > `apos`, até `limite`."""
        nomes, sel = self._select(tabela, colunas)
        ordem = ", ".join(_q(k) for k in chaves)
        where, params = "", []
        if apos is not None:
            ors = []
            for i in range(len(chaves)):
                partes = ["%s = ?" % _q(k) for k in chaves[:i]] + ["%s > ?" % _q(chaves[i])]
                ors.append("(" + " AND ".join(partes) + ")")
                params += list(apos[:i + 1])
            where = " WHERE " + " OR ".join(ors)
        return nomes, self.consultar(
            "SELECT FIRST %d %s FROM %s%s ORDER BY %s" % (int(limite), sel, _q(tabela), where, ordem), params)


def _canon(v):
    if v is None:
        return b"N"
    if isinstance(v, (bytes, bytearray)):
        return b"B%d:" % len(v) + bytes(v)
    if isinstance(v, bool):
        return b"L1" if v else b"L0"
    if isinstance(v, int):
        return b"I" + str(v).encode()
    if isinstance(v, decimal.Decimal):
        return b"D" + str(v).encode()
    if isinstance(v, float):
        return b"F" + repr(v).encode()
    if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
        return b"T" + v.isoformat().encode()
    if isinstance(v, str):  # não deveria ocorrer (texto vem em OCTETS); fica determinístico mesmo assim
        b = v.encode("utf-8", "surrogatepass")
        return b"S%d:" % len(b) + b
    raise TypeError("tipo não previsto no hash: %s" % type(v).__name__)


def hash_linha(valores):
    """Hash de 128 bits (BLAKE2b) sobre os bytes crus da linha, com separação de tipo e tamanho."""
    h = hashlib.blake2b(digest_size=16)
    for v in valores:
        c = _canon(v)
        h.update(b"%d|" % len(c))
        h.update(c)
    return h.hexdigest()


def hash_bloco(hashes):
    h = hashlib.blake2b(digest_size=16)
    for x in hashes:
        h.update(bytes.fromhex(x))
    return h.hexdigest()
