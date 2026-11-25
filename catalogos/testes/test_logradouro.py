"""Carregador oficial das espécies de logradouro (02-CAD linha 14), com página sintética no formato da tabela de
tipos de logradouro do leiaute do eSocial. Roda no host: python3 -I -m unittest discover -s catalogos/testes"""
import importlib.util
import unittest
from pathlib import Path

LOGRADOURO = Path(__file__).resolve().parents[1] / "carregadores/logradouro.py"


def _mod():
    esp = importlib.util.spec_from_file_location("carregador_logradouro_teste", LOGRADOURO)
    mod = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(mod)
    return mod


def _pagina(linhas, titulo="Tabela 20 - Tipos de Logradouro", id_tabela="20"):
    corpo = "".join(f'<tr>\n<td>{c}</td>\n<td class="texto">{d}</td>\n</tr>\n' for c, d in linhas)
    outra = '<table id="19"><thead><tr><th colspan="2">Tabela 19 - Outra</th></tr></thead>' \
            '<tbody><tr><td>X</td><td>Não é logradouro</td></tr></tbody></table>'
    return (f'<html><body>{outra}<table id="{id_tabela}" class="tabela"><thead><tr><th id="t_20" colspan="2">{titulo}'
            f'</th></tr><tr class="grupo"><td>CÓDIGO</td><td>DESCRIÇÃO</td></tr></thead><tbody>{corpo}</tbody></table>'
            f'<table id="21"><tbody><tr><td>Y</td><td>Depois</td></tr></tbody></table></body></html>')


def _linhas(n):
    return [(f"T{i:02d}", f"Tipo sintético {i}") for i in range(n)]


class LeituraDaTabela(unittest.TestCase):
    def setUp(self):
        self.m = _mod()

    def test_le_so_a_tabela_de_tipos_de_logradouro_em_ordem_de_codigo(self):
        linhas = _linhas(self.m.MINIMO) + [("R", "Rua"), ("AV", "Avenida"), ("A V", "Área Verde"), ("V-E", "Via Expressa"), ("CXA", "Caixa d&#39;Água &amp; Poço")]
        lidas = self.m.ler(_pagina(linhas))
        self.assertEqual(len(lidas), self.m.MINIMO + 5)
        self.assertEqual(lidas, sorted(lidas))
        d = dict(lidas)
        self.assertEqual(d["R"], "Rua")
        self.assertEqual(d["A V"], "Área Verde")
        self.assertEqual(d["V-E"], "Via Expressa")
        self.assertEqual(d["CXA"], "Caixa d'Água & Poço")
        self.assertNotIn("X", d)
        self.assertNotIn("Y", d)

    def test_recusa_arquivo_sem_a_tabela_ou_com_outro_titulo(self):
        with self.assertRaises(RuntimeError):
            self.m.ler(_pagina(_linhas(self.m.MINIMO), id_tabela="99"))
        with self.assertRaises(RuntimeError):
            self.m.ler(_pagina(_linhas(self.m.MINIMO), titulo="Tabela 20 - Outra coisa"))

    def test_recusa_tabela_curta_codigo_fora_da_forma_e_codigo_repetido(self):
        with self.assertRaises(RuntimeError):
            self.m.ler(_pagina(_linhas(self.m.MINIMO - 1)))
        with self.assertRaises(RuntimeError):
            self.m.ler(_pagina(_linhas(self.m.MINIMO) + [("rua longa", "Rua")]))
        for ruim in ("rua", "ABCDE", "A-", "-A", ""):
            with self.assertRaises(RuntimeError):
                self.m.ler(_pagina(_linhas(self.m.MINIMO) + [(ruim, "Rua")]))
        with self.assertRaises(RuntimeError):
            self.m.ler(_pagina(_linhas(self.m.MINIMO) + [("T01", "Repetido")]))

    def test_texto_do_sql_escapa_apostrofo_e_barra(self):
        self.assertEqual(self.m._txt("Caixa d'Água"), "'Caixa d''Água'")
        self.assertEqual(self.m._txt("a\\b"), "'a\\\\b'")


class FonteAusenteOuBancoSemChave(unittest.TestCase):
    """A carga não termina em silêncio: banco sem a chave única ou sem espécies e sem a fonte baixada é erro."""

    def _com(self, chave, ativas, arquivo_existe=False):
        m = _mod()
        m.ARQUIVO = Path(__file__).resolve().parent / ("test_logradouro.py" if arquivo_existe else "nao-existe.html")
        m.AVISOS = []
        chamadas = []

        def falso_sql(banco, entrada):
            chamadas.append(entrada)
            return f"{chave}\t{ativas}\n"

        m._sql = falso_sql
        return m, chamadas

    def test_banco_sem_a_chave_unica_e_erro_antes_de_qualquer_gravacao(self):
        m, chamadas = self._com(0, 0, arquivo_existe=True)
        with self.assertRaisesRegex(RuntimeError, "migração 03_CAD/97"):
            m.carregar("cliente_sintetico")
        self.assertEqual(len(chamadas), 1)
        self.assertNotIn("INSERT", chamadas[0])

    def test_fonte_ausente_em_banco_sem_especies_e_erro(self):
        m, chamadas = self._com(1, 0)
        with self.assertRaisesRegex(RuntimeError, "não baixada"):
            m.carregar("cliente_sintetico")
        self.assertEqual(len(chamadas), 1)

    def test_fonte_ausente_em_banco_ja_carregado_mantem_e_avisa(self):
        m, chamadas = self._com(1, 182)
        self.assertEqual(m.carregar("cliente_sintetico"), {"especie_logradouro": 182})
        self.assertEqual(len(m.AVISOS), 1)
        self.assertIn("mantidas as 182", m.AVISOS[0])
        self.assertEqual(len(chamadas), 1)


if __name__ == "__main__":
    unittest.main()
