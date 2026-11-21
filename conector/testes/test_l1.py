"""Autoconferência do L1 (abridor e leitura) sobre a imagem SINTÉTICA do cliente de exemplo.

Roda dentro do container do conector, privilegiado e sem rede: `conector/conector.sh testes`.
"""
import os
import shutil
import tempfile
import unittest

from sante_conector import abridor, caminho, imagem, sintetica, texto
from sante_conector.leitor import Leitor, hash_linha, hash_bloco

TRAB = os.environ.get("CONECTOR_TRABALHO_DIR", "/trabalho")
ORIG = os.path.join(TRAB, "origens-teste")
ARQ = "exemplo-v1.fdb"
MANIF = None


def setUpModule():
    global MANIF
    shutil.rmtree(ORIG, ignore_errors=True)
    os.makedirs(ORIG)
    MANIF = sintetica.gerar(os.path.join(ORIG, ARQ))
    os.environ["CONECTOR_ORIGENS_DIR"] = ORIG


def tearDownModule():
    shutil.rmtree(ORIG, ignore_errors=True)


def _assinatura(p):
    st = os.stat(p)
    return caminho.sha256_arquivo(p), st.st_mtime_ns, st.st_size


class Caminho(unittest.TestCase):
    def test_aceita_sintetica(self):
        v = caminho.validar_origem(ARQ)
        self.assertEqual((v["ods"], v["pagina"]), (12, 8192))

    def test_recusas(self):
        fora = tempfile.mkdtemp(dir=TRAB)
        try:
            shutil.copy(os.path.join(ORIG, ARQ), os.path.join(fora, "x.fdb"))
            os.symlink(os.path.join(fora, "x.fdb"), os.path.join(ORIG, "link.fdb"))
            with open(os.path.join(ORIG, "falso.fdb"), "wb") as f:
                f.write(b"\x00" * 8192)
            with open(os.path.join(ORIG, "texto.txt"), "w") as f:
                f.write("x")
            with open(os.path.join(ORIG, ARQ), "rb") as o, open(os.path.join(ORIG, "truncado.fdb"), "wb") as d:
                d.write(o.read(8192 * 3 + 100))
            os.mkdir(os.path.join(ORIG, "pasta.fdb"))
            casos = {"../x.fdb": "sai da pasta", os.path.join(fora, "x.fdb"): "relativo", "link.fdb": "symlink",
                     "falso.fdb": "cabeçalho", "texto.txt": "extensão", "truncado.fdb": "truncado",
                     "pasta.fdb": "regular", "nao-existe.fdb": "inexistente", "": "relativo"}
            for rel, motivo in casos.items():
                with self.assertRaises(caminho.OrigemRecusada, msg=rel) as cm:
                    caminho.validar_origem(rel)
                self.assertIn(motivo, str(cm.exception), rel)
            lst = {x["relativo"]: x["aceito"] for x in caminho.listar_origens()}
            self.assertTrue(lst[ARQ])
            self.assertFalse(lst["falso.fdb"])
            self.assertNotIn("texto.txt", lst)
        finally:
            for n in ("link.fdb", "falso.fdb", "texto.txt", "truncado.fdb"):
                if os.path.lexists(os.path.join(ORIG, n)):
                    os.unlink(os.path.join(ORIG, n))
            os.rmdir(os.path.join(ORIG, "pasta.fdb"))
            shutil.rmtree(fora)


class ConfrontoGstat(unittest.TestCase):
    def test_conjunto_de_tabelas_conta_como_divergencia(self):
        reg = {"contagens": {"A": 1, "B": 2}}
        imagem.confrontar_gstat(reg, None, gs={"A": 1, "B": 2})
        self.assertEqual((reg["gstat"]["divergentes"], reg["gstat"]["registros_total"]), (0, 3))
        reg = {"contagens": {"A": 1, "B": 2, "C": 0}}
        imagem.confrontar_gstat(reg, None, gs={"A": 1, "B": 3, "OCULTA": 5})
        g = reg["gstat"]
        self.assertEqual(g["divergentes"], 3)
        self.assertEqual(g["so_no_gstat"], ["OCULTA"])
        self.assertEqual(g["so_no_leitor"], ["C"])
        self.assertEqual(g["registros_total"], 9)
        self.assertEqual(g["divergencias"]["B"]["motivo"], "contagem")


class Texto(unittest.TestCase):
    def test_tabela_c1_deterministica(self):
        b = bytes(range(0x80, 0xA0))
        s = texto.cp1252_para_texto(b)
        self.assertEqual(len(s), 32)
        self.assertEqual(s[0], "€")            # 0x80 euro
        self.assertEqual(s[0x81 - 0x80], "\x81")     # sem caractere: controle C1 de mesmo código
        self.assertEqual(s[0x9F - 0x80], "Ÿ")
        self.assertEqual(texto.texto_para_cp1252(s), b)
        todos = bytes(range(256))
        self.assertEqual(texto.texto_para_cp1252(texto.cp1252_para_texto(todos)), todos)
        self.assertEqual(texto.cp1252_para_texto(b"a\xe7\xe3o  ", aparar=True), "ação")


class AbridorELeitura(unittest.TestCase):
    def setUp(self):
        self.orig = os.path.join(ORIG, ARQ)
        self.antes = _assinatura(self.orig)

    def tearDown(self):
        self.assertEqual(_assinatura(self.orig), self.antes, "o arquivo de origem mudou")

    def test_snapshot_registro_e_gstat(self):
        o = caminho.validar_origem(ARQ)
        with abridor.abrir(o["absoluto"], modo="snapshot", cow_mb=64) as ab:
            self.assertTrue(ab.dispositivo.startswith("/dev/mapper/sscon-"))
            with Leitor(ab.dispositivo) as lt:
                reg = imagem.registrar(lt, o, ab)
            imagem.confrontar_gstat(reg, ab.dispositivo)
        self.assertEqual(reg["contagens"], MANIF["contagens"])
        self.assertTrue(reg["somente_leitura_na_abertura"])
        self.assertEqual(reg["gstat"]["divergentes"], 0, reg["gstat"]["divergencias"])
        self.assertEqual(reg["generators"], 1)
        self.assertIsNotNone(ab.cow_usado_bytes)
        self.assertLess(ab.cow_usado_bytes, 1 << 20)
        self.assertFalse(os.path.exists(ab.dispositivo))
        self.assertEqual([f for f in os.listdir(TRAB) if f.startswith("cow-")], [])

    def test_leitura_bytes_crus_faixas_e_chave(self):
        o = caminho.validar_origem(ARQ)
        with abridor.abrir(o["absoluto"], modo="snapshot", cow_mb=64) as ab, Leitor(ab.dispositivo) as lt:
            # faixas de PK inteira cobrem exatamente a tabela
            self.assertEqual(lt.chave_primaria("EX_PESSOA"), ["ID"])
            total, hs = 0, []
            for ini, fim in lt.faixas("EX_PESSOA", "ID", bloco=1000):
                _, it = lt.ler_faixa("EX_PESSOA", "ID", ini, fim)
                linhas = list(it)
                self.assertTrue(all(ini <= l[0] < fim for l in linhas))
                total += len(linhas)
                hs += [hash_linha(l) for l in linhas]
            self.assertEqual(total, MANIF["contagens"]["EX_PESSOA"])
            _, it = lt.ler_faixa("EX_PESSOA", "ID", 0, 10 ** 9)
            self.assertEqual(hash_bloco(hs), hash_bloco([hash_linha(l) for l in it]))
            # texto em bytes crus, inclusive 0x80-0x9F e o preenchimento de CHAR
            nomes, it = lt.ler_faixa("EX_TEXTO_CP1252", "ID", 1, 4)
            linhas = list(it)
            self.assertEqual(nomes, ["ID", "BRUTO", "FIXO"])
            self.assertEqual(linhas[0][1], bytes.fromhex(MANIF["bytes_c1_hex"]))
            self.assertEqual(linhas[0][2], b"abc" + b" " * 7)
            self.assertEqual(linhas[1][1], bytes.fromhex(MANIF["bytes_acento_hex"]))
            self.assertEqual(texto.cp1252_para_texto(linhas[1][2], aparar=True), "ação")
            self.assertEqual(linhas[2][1:], (None, None))
            # blobs em bytes (binário e texto)
            _, it = lt.ler_faixa("EX_ANEXO", "ID", 1, 21)
            anexos = list(it)
            self.assertEqual({l[0]: len(l[1]) for l in anexos}, {int(k): v for k, v in MANIF["anexo_tamanhos"].items()})
            self.assertTrue(all(isinstance(l[2], bytes) and l[2].startswith(bytes.fromhex(MANIF["bytes_acento_hex"]))
                                for l in anexos))
            # chave composta por keyset
            self.assertEqual(lt.chave_primaria("EX_ITEM_COMP"), ["PEDIDO", "SEQ"])
            vistos, apos = [], None
            while True:
                _, lote = lt.ler_por_chave("EX_ITEM_COMP", ["PEDIDO", "SEQ"], apos, limite=97)
                if not lote:
                    break
                vistos += [(l[0], l[1]) for l in lote]
                apos = vistos[-1]
            self.assertEqual(len(vistos), MANIF["contagens"]["EX_ITEM_COMP"])
            self.assertEqual(vistos, sorted(set(vistos)))
            # keyset só sobre chave provada única e NOT NULL
            self.assertEqual(lt.chaves_unicas_de("EX_ITEM_COMP"), [["PEDIDO", "SEQ"]])
            _, lote = lt.ler_por_chave("EX_ITEM_COMP", ["SEQ", "PEDIDO"], None, limite=5)
            self.assertEqual(len(lote), 5)
            for ruim in (["SEQ"], ["PEDIDO"], [], ["PEDIDO", "SEQ", "DESCR"]):
                with self.assertRaises(ValueError, msg=ruim):
                    lt.ler_por_chave("EX_ITEM_COMP", ruim, None, limite=10)
            # sem PK: keyset recusado (empates e NULL seriam pulados); passada única cobre o COUNT(*)
            self.assertEqual(lt.chave_primaria("EX_TRILHA"), [])
            self.assertEqual(lt.chaves_unicas_de("EX_TRILHA"), [])
            for ruim in (["TEXTO"], ["QUANDO"], ["QUANDO", "TEXTO"]):
                with self.assertRaises(ValueError, msg=ruim):
                    lt.ler_por_chave("EX_TRILHA", ruim, None, limite=10)
            n = lt.contar("EX_TRILHA")
            self.assertEqual(n, MANIF["contagens"]["EX_TRILHA"])
            _, it = lt.ler_tudo("EX_TRILHA")
            self.assertEqual(sum(1 for _ in it), n)
            # hash determinístico e sensível a uma só coluna
            self.assertEqual(hash_linha((1, b"S", None)), hash_linha((1, b"S", None)))
            self.assertNotEqual(hash_linha((1, b"S", None)), hash_linha((1, b"N", None)))
            self.assertNotEqual(hash_linha((b"ab", b"c")), hash_linha((b"a", b"bc")))

    def test_plano_b_copia_com_guarda(self):
        o = caminho.validar_origem(ARQ)
        # sem autorização explícita do dono, a cópia é recusada; modo automático não existe
        for modo, kw in (("copia", {}), ("copia", {"plano_b_autorizado": False}), ("auto", {})):
            with self.assertRaises(abridor.AbridorErro, msg=modo):
                with abridor.abrir(o["absoluto"], modo=modo, reserva_gb=0, **kw):
                    pass
        self.assertEqual([f for f in os.listdir(TRAB) if f.startswith("copia-")], [])
        with self.assertRaises(abridor.AbridorErro) as cm:
            with abridor.abrir(o["absoluto"], modo="copia", reserva_gb=10 ** 6, plano_b_autorizado=True):
                pass
        self.assertIn("guarda de disco", str(cm.exception))
        with abridor.abrir(o["absoluto"], modo="copia", reserva_gb=0, plano_b_autorizado=True) as ab:
            destino = ab.dispositivo
            with Leitor(ab.dispositivo) as lt:
                self.assertEqual(lt.contar("EX_PESSOA"), MANIF["contagens"]["EX_PESSOA"])
                self.assertTrue(lt.somente_leitura())
        self.assertEqual(ab.modo, "copia")
        self.assertFalse(os.path.exists(destino))

    def test_falha_do_snapshot_nunca_cai_na_copia(self):
        o = caminho.validar_origem(ARQ)
        orig_loop, orig_sh = abridor._loop, abridor._sh
        for falha in ("loop", "somente_leitura"):
            if falha == "loop":
                def _loop(*a, **k):
                    raise abridor.AbridorErro("losetup falhou (simulado)")
                abridor._loop = _loop
            else:
                def _sh(*args):
                    if args[:2] == ("blockdev", "--getro"):
                        return "0"
                    return orig_sh(*args)
                abridor._sh = _sh
            try:
                with self.assertRaises(abridor.AbridorErro, msg=falha):
                    with abridor.abrir(o["absoluto"], cow_mb=64, plano_b_autorizado=True):
                        self.fail("não deveria abrir")
            finally:
                abridor._loop, abridor._sh = orig_loop, orig_sh
        self.assertEqual([f for f in os.listdir(TRAB) if f.startswith(("copia-", "cow-"))], [])

    def test_snapshot_sempre_limpa_em_erro(self):
        o = caminho.validar_origem(ARQ)
        with self.assertRaises(ZeroDivisionError):
            with abridor.abrir(o["absoluto"], modo="snapshot", cow_mb=64, nome="erro-proposital") as ab:
                1 / 0
        self.assertFalse(os.path.exists("/dev/mapper/sscon-erro-proposital"))
        self.assertEqual([f for f in os.listdir(TRAB) if f.startswith("cow-")], [])
