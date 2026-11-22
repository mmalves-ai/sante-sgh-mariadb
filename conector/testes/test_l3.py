"""Autoconferência do L3 (carga.py): conversões, soma de controle de texto e regras de recusa, sem banco.

Roda junto com a suíte do conector (`conector/conector.sh testes`). Os casos de banco real ficam na prova ponta a
ponta do painel (imagem sintética). Aqui só valores inventados.
"""
import datetime
import unittest

import pymysql

from sante_conector import carga
from sante_conector.texto import cp1252_para_texto, texto_para_cp1252


class Conversoes(unittest.TestCase):
    def test_bruto_igual_a_reconversao_do_texto_em_todos_os_bytes(self):
        # para cada byte do CP1252 (inclusive 0x80-0x9F, 0xA0 e controles), a normalização nos bytes crus tem de dar
        # exatamente o que o texto gravado dá ao voltar para CP1252: é isso que a soma de controle compara
        for b in range(256):
            for cru in (bytes([b]), b"a" + bytes([b]) + b"z", bytes([b]) * 3 + b"  x  " + bytes([b])):
                t = carga.txt(cru)
                self.assertEqual(carga.bruto(cru), texto_para_cp1252(t) if t else None, hex(b))
        cru = b"  Jos\xe9   da  Silva\xa0\x96 " + b"x" * 200
        self.assertEqual(carga.bruto(cru, 150), texto_para_cp1252(carga.txt(cru, 150)))
        self.assertEqual(carga.bruto(b"abc def", 4), b"abc")  # corte não deixa espaço no fim

    def test_fmt_texto_e_bytes_casam(self):
        cru = "Conceição – “ok”".encode("cp1252")
        self.assertEqual(carga.fmt(cru), carga.fmt(cp1252_para_texto(cru)))
        self.assertNotEqual(carga.fmt("Conceicao"), carga.fmt("Conceição"))
        self.assertTrue(carga.fmt("日本").startswith("u"))  # fora do CP1252 nunca casa com bytes da origem

    def test_sentinelas_e_momento(self):
        for v in (datetime.datetime(1899, 12, 30), datetime.datetime(1900, 1, 1, 10), datetime.datetime(1700, 5, 5)):
            self.assertEqual(carga.momento(v), (None, True))
        self.assertEqual(carga.momento(None), (None, False))
        m, s = carga.momento(datetime.datetime(2025, 1, 2, 3, 4, 5, 123456))
        self.assertEqual((m.microsecond, s), (123000, False))
        self.assertEqual(carga.data(datetime.date(1899, 12, 30)), (None, True))

    def test_documentos_e_telefone(self):
        self.assertEqual(carga.cpf(12345678909), ("12345678909", False))
        self.assertEqual(carga.cpf(12345678900.0), (None, True))
        self.assertEqual(carga.cpf("111.111.111-11"), (None, True))
        self.assertEqual(carga.cpf(None), (None, False))
        self.assertEqual(carga.cnpj(11222333000181.0), ("11222333000181", False))
        self.assertEqual(carga.cnpj(0.0), (None, False))
        self.assertEqual(carga.telefone(b"(11) 3000-0000"), (("11", "30000000"), False))
        self.assertEqual(carga.telefone(b"+55 11 91234-5678"), (("11", "912345678"), False))
        self.assertEqual(carga.telefone(b"xx"), (None, False))
        self.assertEqual(carga.telefone(b"123"), (None, True))

    def test_login(self):
        self.assertEqual(carga.login_de(b"REC:01"), "rec.01")
        self.assertEqual(carga.login_de(b"JOAO SILVA"), "joao.silva")
        # 'JOÃO' e 'JOAO' são logins diferentes em Python, iguais na collation do destino: a carga confere no banco
        self.assertNotEqual(carga.login_de("JOÃO SILVA".encode("cp1252")), "joao.silva")


class _Cur:
    def __init__(self, b):
        self.b = b
        self.lastrowid = None
        self._r = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, args=()):
        self.b.log.append(sql.split(" (")[0][:60])
        if sql.startswith("INSERT INTO `%s`" % self.b.falhar):
            raise pymysql.err.IntegrityError(1062, "Duplicate entry 'valor real' for key")
        self.b.n += 1
        self.lastrowid = self.b.n
        self._r = [(0,)]

    def executemany(self, sql, linhas):
        self.b.log.append("PENDENCIAS %d" % len(linhas))

    def fetchone(self):
        return self._r[0] if self._r else None

    def fetchall(self):
        return []


class _Banco:
    def __init__(self, falhar=None):
        self.falhar, self.n, self.log = falhar, 0, []

    def cursor(self):
        return _Cur(self)

    def commit(self):
        self.log.append("COMMIT")


class Recusas(unittest.TestCase):
    def _carga(self, falhar=None):
        b = _Banco(falhar)
        c = carga.Carga(None, b, "ctl", 7, 1)
        c.existente = {"TBCONVEN": {}, "ATCABECATEND": {}}
        return c, b

    def test_restricao_do_destino_recusa_so_a_linha(self):
        c, b = self._carga(falhar="atendimento")

        def gravar():
            c._fonte(3)  # provisório criado dentro da linha: tem de ser desfeito junto
            c._inserir("atendimento", {"numero": "1"})
            return True
        self.assertIsNone(c._linha_nova("ATCABECATEND", "10", "atendimento", b"h" * 16, gravar))
        self.assertIn("ROLLBACK TO SAVEPOINT linha_conector", b.log)
        self.assertEqual(c.existente["TBCONVEN"], {})            # provisório desfeito na memória
        self.assertEqual(c.cont["provisorios"], 0)
        self.assertEqual([p[2] for p in c.pend], ["restricao_destino_1062"])  # nenhum valor, só o código
        self.assertEqual(c.existente["ATCABECATEND"]["10"][3], "restricao_destino_1062")
        c, b = self._carga(falhar="usuario")
        c._pendencia("X", "1", "y", "baixa")
        with self.assertRaises(pymysql.err.OperationalError):    # erro que não é de linha derruba a execução
            c._linha_nova("X", "1", "x", b"h", lambda: (_ for _ in ()).throw(pymysql.err.OperationalError(2013, "")))

    def test_pendencias_gravadas_no_mesmo_commit_das_linhas(self):
        c, b = self._carga()
        c._recusar("RICADPAC", "5", "paciente", b"h" * 16, "nome_ausente", "critica")
        c._commit()
        self.assertEqual(b.log[-2:], ["PENDENCIAS 1", "COMMIT"])
        self.assertEqual(c._buf, [])

    def test_recusada_reexecutada_reemite_a_regra_e_alterada_nao_regrava(self):
        c, b = self._carga()
        c.existente["RICADPAC"] = {"5": (None, b"h" * 16, None, "prontuario_duplicado", "critica"),
                                   "6": (9, b"a" * 16, b"r" * 32, None, None)}
        self.assertEqual(c._situacao("RICADPAC", "5", b"h" * 16)[0], "igual")
        self.assertEqual(c.pend[-1][2:4], ("prontuario_duplicado", "critica"))
        sit, ant = c._situacao("RICADPAC", "6", b"b" * 16)
        self.assertEqual(sit, "alterada")
        c._ja_carregada("paciente", "6", sit, ant)
        self.assertEqual(c.aguardam["paciente"], {"6"})
        self.assertNotIn("6", c.origem.get("paciente", {}))       # fora da soma, à espera do L9
        self.assertEqual(c.existente["RICADPAC"]["6"][1], b"a" * 16)  # hash guardado intocado
        self.assertFalse(any(x.startswith("INSERT INTO `ctl`.conector_origem") for x in b.log))

    def test_edicao_no_destino_vira_pendencia_e_divergencia_sem_rastro_falha(self):
        c, _ = self._carga()
        c.origem["usuario"] = {"1": "aa", "2": "bb"}
        so, sd, ed = c._conferir("usuario", "TBUSERS", {"1": ("aa", False), "2": ("cc", True)}, None, ())
        self.assertEqual((so == sd, ed), (True, 1))
        self.assertEqual(c.pend[-1][2], "edicao_no_destino")
        so, sd, ed = c._conferir("usuario", "TBUSERS", {"1": ("aa", False), "2": ("cc", False)}, None, ())
        self.assertNotEqual(so, sd)


if __name__ == "__main__":
    unittest.main()
