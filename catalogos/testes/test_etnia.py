"""Carregador oficial das etnias indígenas (02-CAD linha 15), com CNV sintético no formato do arquivo de conversão das
tabelas auxiliares do SIA/SUS. Roda no host: python3 -I -m unittest discover -s catalogos/testes"""
import importlib.util
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

ETNIA = Path(__file__).resolve().parents[1] / "carregadores/etnia.py"


def _mod():
    esp = importlib.util.spec_from_file_location("carregador_etnia_teste", ETNIA)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


def _cnv(linhas, declarado=None):
    corpo = "".join(f"   {s:04d}  {d:<50} {c}\r\n" for s, (c, d) in enumerate(linhas, 1))
    return f"{len(linhas) if declarado is None else declarado} 4\r\n" + corpo


def _linhas(n):
    return [(f"{i:04d}", f"POVO SINTETICO {i}") for i in range(1, n + 1)]


class LeituraDoCnv(unittest.TestCase):
    def setUp(self):
        self.m = _mod()

    def test_le_codigo_e_nome_com_nomes_alternativos_em_ordem_de_codigo(self):
        linhas = _linhas(self.m.MINIMO)[::-1] + [("0901", "POVO A (NOME B, NOME\xadC)"), ("0902", "POVO D'E"), ("0903", "N" * 48 + "XY")]
        lidas = self.m.ler_cnv(_cnv(linhas))
        self.assertEqual(len(lidas), self.m.MINIMO + 3)
        self.assertEqual(lidas, sorted(lidas))
        d = dict(lidas)
        self.assertEqual(d["0901"], "POVO A (NOME B, NOMEC)")
        self.assertEqual(d["0902"], "POVO D'E")
        self.assertEqual(d["0903"], "N" * 48 + "XY")  # nome na largura toda da coluna, um só espaço antes do código

    def test_nome_cortado_na_largura_da_coluna_fica_com_os_alternativos_completos_e_avisa(self):
        # o arquivo oficial corta em 50 caracteres no meio da lista de nomes alternativos (ex.: 0055, 0060, 0161)
        cortados = [
            ("0901", "POVO GAVIAO SINTETICO (PUKOBIE, PYKOPJE, GAVIAO DO"),  # corte no meio de um nome
            ("0902", "POVO NAMBI SINTETIC (NEGAROTE ,MAMAIN\xadDE, LATUNDE,"),  # corte logo após a vírgula
            ("0903", "POVO SEM ALTERNATIVO COMPLETO (ABCDEFGHIJKLMNOPQRS"),  # nenhum alternativo inteiro
            ("0904", "POVO COMPLET (CURIPACO, CURRIPACO, CORIPACO, WAKU)"),  # enche a coluna, mas fechado
            ("0905", "POVO CURTO (WAYAMPI, OYAMPI, )"),  # item vazio, sem corte
            ("0906", "POVO HIFEN (ALFA, BE\xadTA,"),  # cortado com o hífen invisível: sobra espaço antes do código
        ]
        self.assertEqual([len(d) for _, d in cortados[:4]], [50, 50, 50, 50])
        self.m.AVISOS = []
        d = dict(self.m.ler_cnv(_cnv(_linhas(self.m.MINIMO) + cortados)))
        self.assertEqual(d["0901"], "POVO GAVIAO SINTETICO (PUKOBIE, PYKOPJE)")
        self.assertEqual(d["0902"], "POVO NAMBI SINTETIC (NEGAROTE, MAMAINDE, LATUNDE)")
        self.assertEqual(d["0903"], "POVO SEM ALTERNATIVO COMPLETO")
        self.assertEqual(d["0904"], "POVO COMPLET (CURIPACO, CURRIPACO, CORIPACO, WAKU)")
        self.assertEqual(d["0905"], "POVO CURTO (WAYAMPI, OYAMPI)")
        self.assertEqual(d["0906"], "POVO HIFEN (ALFA, BETA)")
        for nome in d.values():
            self.assertEqual(nome.count("("), nome.count(")"), nome)
        avisos = [a for a in self.m.AVISOS if "cortado" in a]
        self.assertEqual(sorted(a.split(":")[0] for a in avisos), ["etnia 0901", "etnia 0902", "etnia 0903", "etnia 0906"])

    def test_recusa_cabeçalho_ausente_ou_quantidade_divergente(self):
        with self.assertRaisesRegex(RuntimeError, "cabeçalho"):
            self.m.ler_cnv(_cnv(_linhas(self.m.MINIMO)).split("\n", 1)[1])
        with self.assertRaisesRegex(RuntimeError, "declara"):
            self.m.ler_cnv(_cnv(_linhas(self.m.MINIMO), declarado=self.m.MINIMO + 1))

    def test_recusa_tabela_curta_codigo_fora_da_forma_e_repetido(self):
        with self.assertRaisesRegex(RuntimeError, "mínimo"):
            self.m.ler_cnv(_cnv(_linhas(self.m.MINIMO - 1)))
        for ruim in ("123", "12345", "A001", "1,2"):
            with self.assertRaisesRegex(RuntimeError, "fora da forma"):
                self.m.ler_cnv(_cnv(_linhas(self.m.MINIMO) + [(ruim, "POVO")]))
        with self.assertRaisesRegex(RuntimeError, "repetido"):
            self.m.ler_cnv(_cnv(_linhas(self.m.MINIMO) + [("0001", "REPETIDO")]))

    def test_le_o_membro_do_pacote_sem_caixa_e_recusa_pacote_sem_ele(self):
        with tempfile.TemporaryDirectory() as d:
            bom = Path(d) / "bom.zip"
            with zipfile.ZipFile(bom, "w") as z:
                z.writestr("CNV/ETNIA.CNV", _cnv(_linhas(self.m.MINIMO)).encode("latin-1"))
                z.writestr("CNV/RACA_COR.CNV", "2 2\n")
            self.assertEqual(len(self.m.ler(bom)), self.m.MINIMO)
            ruim = Path(d) / "ruim.zip"
            with zipfile.ZipFile(ruim, "w") as z:
                z.writestr("CNV/RACA_COR.CNV", "2 2\n")
            with self.assertRaisesRegex(RuntimeError, "único"):
                self.m.ler(ruim)

    def test_texto_do_sql_escapa_apostrofo_e_barra(self):
        self.assertEqual(self.m._txt("D'E"), "'D''E'")
        self.assertEqual(self.m._txt("a\\b"), "'a\\\\b'")


class FonteAusenteOuBancoSemChave(unittest.TestCase):
    """A carga não termina em silêncio: banco sem a chave única ou sem etnias e sem a fonte baixada é erro."""

    def _com(self, chave, vigentes, arquivo_existe=False):
        m = _mod()
        m.ARQUIVO = Path(__file__) if arquivo_existe else Path(__file__).with_name("nao-existe.zip")
        m.AVISOS = []
        chamadas = []

        def falso_sql(banco, entrada):
            chamadas.append(entrada)
            return f"{chave}\t{vigentes}\n"

        m._sql = falso_sql
        return m, chamadas

    def test_banco_sem_a_chave_unica_e_erro_antes_de_qualquer_gravacao(self):
        m, chamadas = self._com(0, 0, arquivo_existe=True)
        with self.assertRaisesRegex(RuntimeError, "chave única"):
            m.carregar("cliente_sintetico")
        self.assertEqual(len(chamadas), 1)
        self.assertNotIn("INSERT", chamadas[0])

    def test_fonte_ausente_em_banco_sem_etnias_e_erro(self):
        m, chamadas = self._com(1, 0)
        with self.assertRaisesRegex(RuntimeError, "não baixada"):
            m.carregar("cliente_sintetico")
        self.assertEqual(len(chamadas), 1)

    def test_fonte_ausente_em_banco_ja_carregado_mantem_e_avisa(self):
        m, chamadas = self._com(1, 264)
        self.assertEqual(m.carregar("cliente_sintetico"), {"povo_indigena": 264})
        self.assertIn("mantidas as 264", m.AVISOS[0])
        self.assertEqual(len(chamadas), 1)

    def test_carga_grava_retira_quem_saiu_e_confere_o_total(self):
        m = _mod()
        m.AVISOS = []
        lidas = _linhas(m.MINIMO)
        m.ler = lambda arquivo: lidas
        m.versao = lambda: "2026-11-25"
        chamadas = []

        def falso_sql(banco, entrada):
            chamadas.append(entrada)
            return "1\t0\n" if len(chamadas) == 1 else f"{len(lidas)}\n"

        m._sql = falso_sql
        m.ARQUIVO = Path(__file__)
        self.assertEqual(m.carregar("cliente_sintetico"), {"povo_indigena": m.MINIMO})
        script = chamadas[1]
        self.assertIn("ON DUPLICATE KEY UPDATE", script)
        self.assertIn("vigencia_fim = DATE_SUB(UTC_DATE(), INTERVAL 1 DAY)", script)
        self.assertNotIn("DELETE", script)
        m._sql = lambda banco, entrada: "1\t0\n" if "information_schema" in entrada else "3\n"
        with self.assertRaisesRegex(RuntimeError, "esperava"):
            m.carregar("cliente_sintetico")


if __name__ == "__main__":
    unittest.main()
