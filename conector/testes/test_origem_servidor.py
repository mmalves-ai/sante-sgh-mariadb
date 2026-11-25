"""Origem firebird_servidor (obra carga-painel, ADR 0010): senha pelo cofre de arquivo (mesmo formato do CofreArquivo da
API) ou por variável fora de produção, carregar_origem por tipo, pedido de pausa e, contra o servidor simulado, o
teste de conexão, a identidade da base e a transação somente leitura.

Os testes do servidor rodam quando FB_SIM_LEITOR_USUARIO e FB_SIM_LEITOR_SENHA estão no ambiente (o servidor simulado
de infra/firebird-simulado, DSN em FB_SIM_DSN, padrão fb-prontocardio/3050:prontocardio). Nada aqui imprime senha nem
valor de linha: só contagens e metadados técnicos.
"""
import base64
import os
import tempfile
import unittest
from unittest import mock

from sante_conector import cli, origem

# Vetor gerado pelo node:crypto no formato de apps/api/.../assinatura/infra/cofre.ts (cifrarComChave): chave de teste
# 32 bytes 0x07, iv 12 bytes 0x01, texto "senha-de-teste". Prova que o Python decifra o que a API grava.
CHAVE_TESTE = base64.b64encode(bytes([7]) * 32).decode()
ENVELOPE_NODE = "v1.AQEBAQEBAQEBAQEB.qy0xXDRP_ERhFucVs0pk0g.BYTn3_GSiGv8oLlSBFI"
REF = "cofre:conector/cliente-teste/firebird-senha"
ARQ_NODE = "e4c131f49bb185d1d151dec2a20d39232f648b74aa4af6d10cbd2c73e72e2404.seg"  # sha256(REF), como na API


def _servidor(ref="env:FB_SIM_LEITOR_SENHA", usuario=None, dsn=None):
    dsn = dsn or os.environ.get("FB_SIM_DSN", "fb-prontocardio/3050:prontocardio")
    host, resto = dsn.split("/", 1)
    porta, banco = resto.split(":", 1)
    return origem.OrigemServidor(host=host, porta=int(porta), banco=banco,
                                 usuario=usuario or os.environ.get("FB_SIM_LEITOR_USUARIO", "X"), senha_referencia=ref)


class Senha(unittest.TestCase):
    def test_cofre_formato_da_api(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, ARQ_NODE), "w") as f:
                f.write(ENVELOPE_NODE + "\n")
            env = {"COFRE_DIR": d, "PLATAFORMA_CHAVE_MESTRA": CHAVE_TESTE, "AMBIENTE": "producao"}
            self.assertEqual(origem.senha(_servidor(REF), env), "senha-de-teste")

    def test_cofre_ida_e_volta_python(self):
        from sante_conector import continuidade
        import hashlib
        with tempfile.TemporaryDirectory() as d:
            chave = bytes(range(32))
            ref = "cofre:conector/pc/firebird-senha"
            with open(os.path.join(d, hashlib.sha256(ref.encode()).hexdigest() + ".seg"), "w") as f:
                f.write(continuidade.cifrar(chave, "outra"))
            env = {"COFRE_DIR": d, "PLATAFORMA_CHAVE_MESTRA": base64.b64encode(chave).decode()}
            self.assertEqual(origem.senha(_servidor(ref), env), "outra")

    def test_cofre_falhas_sem_segredo(self):
        with tempfile.TemporaryDirectory() as d:
            env = {"COFRE_DIR": d, "PLATAFORMA_CHAVE_MESTRA": CHAVE_TESTE}
            with self.assertRaisesRegex(origem.OrigemErro, "não definida no cofre"):
                origem.senha(_servidor(REF), env)
            with open(os.path.join(d, ARQ_NODE), "w") as f:
                f.write(ENVELOPE_NODE)
            env["PLATAFORMA_CHAVE_MESTRA"] = base64.b64encode(bytes(32)).decode()
            with self.assertRaisesRegex(origem.OrigemErro, "não decifrada"):
                origem.senha(_servidor(REF), env)
        with self.assertRaisesRegex(origem.OrigemErro, "cofre indisponível"):
            origem.senha(_servidor(REF), {"COFRE_DIR": "relativo", "PLATAFORMA_CHAVE_MESTRA": CHAVE_TESTE})
        for ruim in ("cofre:psc/1/x/client-secret", "cofre:conector/../firebird-senha", "senha-em-claro", ""):
            with self.assertRaisesRegex(origem.OrigemErro, "referência de senha inválida"):
                origem.senha(_servidor(ruim), {})

    def test_env_so_fora_de_producao(self):
        self.assertEqual(origem.senha(_servidor("env:SENHA_X"), {"SENHA_X": "abc"}), "abc")
        with self.assertRaisesRegex(origem.OrigemErro, "produção"):
            origem.senha(_servidor("env:SENHA_X"), {"SENHA_X": "abc", "AMBIENTE": "producao"})
        with self.assertRaisesRegex(origem.OrigemErro, "não definida"):
            origem.senha(_servidor("env:SENHA_X"), {})

    def test_repr_sem_referencia(self):
        self.assertNotIn("FB_SIM_LEITOR_SENHA", repr(_servidor()))


class _Cur:
    def __init__(self, linhas):
        self.linhas, self.sql = list(linhas), []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass

    def execute(self, sql, params=None):
        self.sql.append((sql, params))

    def fetchone(self):
        return self.linhas.pop(0) if self.linhas else None


class _Conn:
    def __init__(self, linhas):
        self.cur = _Cur(linhas)
        self.commits = 0

    def cursor(self):
        return self.cur

    def begin(self):
        pass

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass


class Carregar(unittest.TestCase):
    def test_servidor_e_arquivo(self):
        o = origem.carregar_origem(_Conn([(5, "firebird_servidor", "Servidor", None, None, None, "h", 3050, "alias",
                                           "LEITOR", REF, '{"ods": "12.0"}')]), 5)
        self.assertIsInstance(o, origem.OrigemServidor)
        self.assertEqual((o.dsn, o.identidade_base), ("h/3050:alias", {"ods": "12.0"}))
        o = origem.carregar_origem(_Conn([(6, "firebird_arquivo", None, "a/b.fdb", 10, "f" * 64, None, None, None,
                                           None, None, None)]), 6)
        self.assertIsInstance(o, origem.OrigemArquivo)
        with self.assertRaises(origem.OrigemErro):
            origem.carregar_origem(_Conn([]), 7)
        with self.assertRaises(origem.OrigemErro):
            origem.carregar_origem(_Conn([(8, "outro") + (None,) * 10]), 8)

    def test_testar_origem_de_arquivo(self):
        r = origem.testar(origem.OrigemArquivo(id=1, caminho_relativo="x.fdb", tamanho_bytes=1, sha256="0" * 64))
        self.assertFalse(r["ok"])


class Pausar(unittest.TestCase):
    def _pausar(self, linhas):
        conn = _Conn(linhas)
        with mock.patch.object(cli, "_json") as j:
            rc = cli._pausar(conn, 9, admin_id=2)
        return rc, j.call_args[0][0], conn

    def test_rodando_grava_pedido(self):
        rc, saida, conn = self._pausar([("gravando", None), ("2026-11-24 10:00:00.000",)])
        self.assertIsNone(rc)
        self.assertEqual((saida["execucao_id"], saida["estado"]), (9, "gravando"))
        self.assertTrue(any("pausa_solicitada_por=%s" in s for s, _ in conn.cur.sql))
        self.assertEqual(conn.commits, 1)

    def test_pedido_ja_feito_nao_regrava(self):
        rc, saida, conn = self._pausar([("pausando", "2026-11-24 09:00:00.000")])
        self.assertIsNone(rc)
        self.assertFalse(any(s.startswith("UPDATE") for s, _ in conn.cur.sql))

    def test_fila_final_inexistente(self):
        for linhas, codigo in (([("fila", None)], 409), ([("concluida", None)], 409), ([], 404)):
            rc, saida, _ = self._pausar(linhas)
            self.assertEqual((rc, saida["erro"]), (3, codigo))


class TestarOrigemCli(unittest.TestCase):
    def test_erro_do_driver_sai_em_json_sem_texto(self):
        class ErroDriver(Exception):
            pass

        class CurQuebrado(_Cur):
            def execute(self, sql, params=None):
                raise ErroDriver("Unknown column 'servidor_host' segredo-do-driver")

        conn = _Conn([])
        conn.cur = CurQuebrado([])
        conn.close = lambda: None
        from sante_conector import banco
        with mock.patch.object(banco, "conectar", return_value=conn), \
                mock.patch.object(banco, "plataforma_banco", return_value="x"), \
                mock.patch.object(cli, "_json") as j:
            rc = cli.main(["testar-origem", "cliente-x"])
        saida = j.call_args[0][0]
        self.assertEqual(rc, 3)
        self.assertEqual(set(saida), {"ok", "versaoServidor", "ods", "tabelas", "mensagem"})
        self.assertFalse(saida["ok"])
        self.assertIn("ErroDriver", saida["mensagem"])
        self.assertNotIn("segredo", saida["mensagem"])


@unittest.skipUnless(os.environ.get("FB_SIM_LEITOR_USUARIO") and os.environ.get("FB_SIM_LEITOR_SENHA"),
                     "servidor simulado sem credenciais no ambiente")
class ServidorSimulado(unittest.TestCase):
    def test_testar_ok(self):
        r = origem.testar(_servidor())
        self.assertTrue(r["ok"], r["mensagem"])
        self.assertGreater(r["tabelas"], 0)
        self.assertRegex(r["ods"], r"^\d+\.\d+$")
        self.assertTrue(r["versaoServidor"].startswith("3."))
        self.assertNotIn(os.environ["FB_SIM_LEITOR_SENHA"], repr(r))

    def test_identidade_e_transacao_somente_leitura(self):
        with origem.abrir_leitor_servidor(_servidor()) as lt:
            ident = origem.identidade_base(lt)
            self.assertEqual(set(ident), {"ods", "pagina_bytes", "criada_em", "nome_base", "versao_servidor"})
            self.assertIn(ident["pagina_bytes"], (4096, 8192, 16384, 32768))
            self.assertNotIn("/", ident["nome_base"] or "")
            tabs = lt.tabelas()
            self.assertEqual(len(tabs), origem.contar_tabelas(lt))
            self.assertIsInstance(lt.contar(tabs[0]), int)
            # transação SNAPSHOT + READ: a mesma fotografia e nenhuma escrita
            self.assertEqual(lt.consultar("SELECT RDB$GET_CONTEXT('SYSTEM', 'ISOLATION_LEVEL') FROM RDB$DATABASE")
                             [0][0].strip(), "SNAPSHOT")
            with self.assertRaises(Exception):
                lt.consultar("UPDATE RDB$DATABASE SET RDB$DESCRIPTION = NULL")

    def test_contar_generators_sem_usage(self):
        """O usuário só leitura (role de SELECT) conta os generators pelo catálogo; GEN_ID exigiria USAGE."""
        with origem.abrir_leitor_servidor(_servidor()) as lt:
            n = lt.contar_generators()
            self.assertIsInstance(n, int)
            self.assertGreaterEqual(n, 0)
            if n:
                with self.assertRaises(Exception):
                    lt.generators()

    def test_identidade_estavel_entre_conexoes(self):
        with origem.abrir_leitor_servidor(_servidor()) as a:
            ia = origem.identidade_base(a)
        with origem.abrir_leitor_servidor(_servidor()) as b:
            self.assertEqual(ia, origem.identidade_base(b))

    def test_senha_errada_mensagem_clara(self):
        with mock.patch.dict(os.environ, {"SENHA_ERRADA_TESTE": "nao-e-a-senha"}):
            r = origem.testar(_servidor("env:SENHA_ERRADA_TESTE"))
        self.assertFalse(r["ok"])
        self.assertIn("usuário ou senha", r["mensagem"])
        self.assertNotIn("nao-e-a-senha", r["mensagem"])

    def test_servidor_inacessivel(self):
        host = os.environ.get("FB_SIM_DSN", "fb-prontocardio/3050:prontocardio").split("/", 1)[0]
        r = origem.testar(_servidor(dsn="%s/3999:prontocardio" % host))
        self.assertFalse(r["ok"])
        self.assertIn("inacessível", r["mensagem"])

    def test_banco_inexistente(self):
        host = os.environ.get("FB_SIM_DSN", "fb-prontocardio/3050:prontocardio").split("/", 1)[0]
        r = origem.testar(_servidor(dsn="%s/3050:nao_existe" % host))
        self.assertFalse(r["ok"])
        self.assertTrue(r["mensagem"])


if __name__ == "__main__":
    unittest.main()
