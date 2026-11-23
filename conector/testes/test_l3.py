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

class C8Contatos(unittest.TestCase):
    """C8 (ADR 0006 e 0007, 18): máscara vazia não é telefone; DDD do outro telefone; município pelo CEP; sem
    evidência, recusa visível e o dado na observação da pessoa. Só valores inventados."""

    def _carga(self, evidencia=(), existente=None, pfid=9):
        b = _Banco()
        c = carga.Carga(None, b, "ctl", 7, 1)
        c.existente = {"RICADPAC": dict(existente or {})}
        c.tipo = {("tipo_telefone", "residencial"): 1, ("tipo_telefone", "celular"): 2,
                  ("tipo_endereco", "residencial"): 3, ("tipo_documento_identificacao", "rg"): 4}
        c.municipio, c.municipio6, c.municipio_cod = {"1111111": 50}, {}, {50: "1111111"}
        c._todas = lambda sql, args=(): ([(pfid,)] if "FROM paciente" in sql else [(1,)] if "MAX(sequencia)" in sql
                                         else list(evidencia))
        c._avisos_ant = {}
        return c, b

    @staticmethod
    def _linha(fone="", cel="", end="", cep="", ibge=""):
        return {"IDENT": None, "ENDERECO": end, "CEP": cep, "IBGE": ibge, "NUMERO": "10", "COMPL": None,
                "BAIRRO": "Centro", "FONE": fone, "CELULAR": cel}

    def _regras(self, c):
        return sorted(p[2] for p in c.pend)

    def test_mascara_vazia_nao_e_telefone(self):
        c, b = self._carga()
        out = c._sub_paciente("1", self._linha(fone="(  )    -    ", cel="(11) 98888-7777"), 9, b"h" * 16)
        self.assertEqual([(e, k) for e, k, _ in out], [("telefone_pessoa", "1/telefone_celular")])
        self.assertEqual(self._regras(c), [])
        self.assertFalse(c._presente("FONE", " ( ) - "))
        self.assertTrue(c._presente("CELULAR", "11988887777"))

    def test_ddd_do_outro_telefone(self):
        c, b = self._carga()
        out = c._sub_paciente("2", self._linha(fone="3333-4444", cel="(21) 98888-7777"), 9, b"h" * 16)
        self.assertEqual(len([v for _, _, v in out if v != carga.RECUSADO]), 2)
        self.assertEqual(self._regras(c), ["telefone_ddd_do_outro_telefone"])

    def test_telefone_sem_evidencia_recusa_e_anota(self):
        c, b = self._carga()
        out = c._sub_paciente("3", self._linha(cel="12"), 9, b"h" * 16)
        self.assertEqual([v for _, _, v in out], [carga.RECUSADO])
        self.assertEqual(self._regras(c), ["telefone_invalido"])
        self.assertTrue(any(x.startswith("UPDATE pessoa_fisica SET observacao") for x in b.log))

    def test_municipio_pelo_cep_e_pela_faixa(self):
        c, b = self._carga(evidencia=[("95000000", 50, 1), ("95010000", 50, 2), ("95010200", 50, 1)])
        c._enderecos_adiados = []
        for chave, cep in (("4", "95000-000"), ("5", "95010-100"), ("6", "01000-000")):
            out = c._sub_paciente(chave, self._linha(end="Rua A", cep=cep), 9, b"h" * 16)
            self.assertEqual([e for e, _, _ in out], [carga.ADIAR_ENDERECO])  # nada gravado antes da evidência
            c._enderecos_adiados.append(out[0][2])
        c._resolver_enderecos()
        self.assertEqual(self._regras(c), ["endereco_sem_cep_ou_municipio", "municipio_estimado_pela_faixa_do_cep",
                                           "municipio_estimado_pelo_cep"])
        self.assertNotEqual(c.origem["endereco_pessoa"]["4/endereco"], carga.RECUSADO)
        self.assertNotEqual(c.origem["endereco_pessoa"]["5/endereco"], carga.RECUSADO)
        self.assertEqual(c.origem["endereco_pessoa"]["6/endereco"], carga.RECUSADO)
        self.assertTrue(any(x.startswith("UPDATE pessoa_fisica SET observacao") for x in b.log))

    def test_faixa_exige_evidencia_minima(self):
        # um endereço só na faixa (ou só estimados, que a consulta exclui) não basta: recusa visível
        c, b = self._carga(evidencia=[("95010000", 50, 2)])
        c._enderecos_adiados = []
        out = c._sub_paciente("8", self._linha(end="Rua A", cep="95010-100"), 9, b"h" * 16)
        c._enderecos_adiados.append(out[0][2])
        c._resolver_enderecos()
        self.assertEqual(self._regras(c), ["endereco_sem_cep_ou_municipio"])
        vistos = []
        c._todas = lambda sql, args=(): vistos.append(sql) or []
        c._evidencia_cep()
        self.assertTrue("NOT IN" in vistos[0] and "municipio_estimado_pela_faixa_do_cep" in vistos[0])

    def test_endereco_adiado_tem_registro_provisorio_e_retoma(self):
        # execução interrompida depois do commit do lote e antes de resolver: a 2a passada resolve o endereço
        c, b = self._carga()
        c._sub_paciente("4", self._linha(end="Rua A", cep="95000-000"), 9, b"h" * 16)
        prov = c.existente["RICADPAC"]["4/endereco"]
        self.assertEqual((prov[0], prov[3]), (None, "endereco_aguarda_evidencia"))
        c2, _ = self._carga(evidencia=[("95000000", 50, 1)], existente={"4": (77, b"h" * 16, None, None, None),
                                                                         "4/endereco": prov})
        c2._enderecos_adiados, c2.origem = [], {}
        c2._subs_ja_carregadas("4", self._linha(end="Rua A", cep="95000-000"), True, h=b"h" * 16)
        self.assertEqual(len(c2._enderecos_adiados), 1)
        c2._resolver_enderecos()
        self.assertNotEqual(c2.origem["endereco_pessoa"]["4/endereco"], carga.RECUSADO)
        self.assertEqual(self._regras(c2), ["municipio_estimado_pelo_cep"])

    def test_aviso_da_subchave_gravada_e_reemitido(self):
        h = b"h" * 16
        c, _ = self._carga(existente={"1": (77, h, None, None, None), "1/endereco": (5, h, b"r" * 16, None, None)})
        c._avisos_ant = {"RICADPAC": {"1/endereco": {("municipio_estimado_pelo_cep", "baixa")}}}
        c.origem = {}
        c._subs_ja_carregadas("1", self._linha(end="Rua A", cep="95000-000"), True, h=h)
        self.assertEqual(self._regras(c), ["municipio_estimado_pelo_cep"])

    def test_reprocessa_telefone_recusado_do_paciente_gravado(self):
        h = b"h" * 16
        ex = {"1": (77, h, None, None, None), "1/telefone_celular": (None, h, None, "telefone_invalido", "baixa")}
        lin = self._linha(fone="(21) 3333-4444", cel="98888-7777")
        c, _ = self._carga(existente=ex)
        c.origem = {}
        c._subs_ja_carregadas("1", lin, True, h=h)  # sem reprocessar: a recusa antiga só é reemitida
        self.assertEqual(c.origem["telefone_pessoa"]["1/telefone_celular"], carga.RECUSADO)
        c, b = self._carga(existente=ex)
        c.reprocessar, c.origem = True, {}
        c._subs_ja_carregadas("1", lin, True, h=h)
        self.assertNotEqual(c.origem["telefone_pessoa"]["1/telefone_celular"], carga.RECUSADO)
        self.assertIsNotNone(c.existente["RICADPAC"]["1/telefone_celular"][0])
        self.assertEqual(self._regras(c), ["telefone_ddd_do_outro_telefone"])
        self.assertEqual(c.cont["recusadas_reprocessadas"], 1)

    def test_sem_cep_recusa_na_hora_e_anota(self):
        c, b = self._carga()
        out = c._sub_paciente("7", self._linha(end="Rua B"), 9, b"h" * 16)
        self.assertEqual([v for _, _, v in out], [carga.RECUSADO])
        self.assertEqual(self._regras(c), ["endereco_sem_cep_ou_municipio"])


if __name__ == "__main__":
    unittest.main()
