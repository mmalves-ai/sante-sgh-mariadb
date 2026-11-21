"""Fatia F4 L5-10 (cadastros e administração, módulo RH): declarações e plano da carga dirigida pelo mapa.
Só metadado do mapa e a imagem SINTÉTICA (dados 100% falsos); a conciliação roda em conector.sh conferir-fatia."""
import pathlib
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_10

FATIA = "colunas.d/L5-10.tsv"
RAIZ = pathlib.Path(__file__).resolve().parents[2]


def _ddl():
    """DDL do destino quando o repositório inteiro está à vista (no container do conector só há conector/)."""
    return "\n".join(p.read_text(encoding="utf-8") for p in sorted((RAIZ / "db" / "migracoes").rglob("*.sql")))


class L5_10(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["_arquivo"].endswith(FATIA)]
        cls.todas = set(l5_10.CARREGADAS) | set(l5_10.BLOQUEADAS) | set(l5_10.NAO_CARREGADAS)
        cls.esp = l5_10.linhas(__import__("random").Random(1), lambda t, v: None)

    def test_fatia_tem_as_21_tabelas_e_a_imagem_tambem(self):
        self.assertEqual(len(self.todas), 21)
        self.assertEqual({c["tabela"] for c in self.decl}, self.todas)
        self.assertEqual(set(re.findall(r"CREATE TABLE (\w+)", l5_10.DDL)), self.todas)

    def test_plano_so_com_a_carregada(self):
        p = carga_mapa.planejar(self.m, self.todas)
        self.assertEqual([(x["tabela"], x["destinos"]) for x in p], [("FPTP_FUNC", ["tipo_colaborador"])])

    def test_sem_literal_fixo_de_classificacao(self):
        # literal sem pendência de revisão gravaria regra de pagamento errada: nenhum na fatia
        self.assertEqual([c for c in self.decl if c["coluna"].startswith("=")], [])

    def test_bloqueadas_sem_destino_e_com_motivo_do_depara(self):
        for c in self.decl:
            if c["tabela"] in l5_10.BLOQUEADAS:
                self.assertEqual(c["destino"], "", c["tabela"])
                self.assertTrue(c["motivo"].startswith("bloqueada até o de-para de valores"), c["tabela"])

    def test_indicativo_de_apuracao_e_aproveitado_no_motivo(self):
        c = [c for c in self.decl if c["tabela"] == "FPTP_FOLHA" and c["coluna"] == "ID_FPTPFOLHAESOC"]
        self.assertEqual(len(c), 1)
        self.assertIn("tipo_folha.indicador_apuracao_esocial", c[0]["motivo"])
        self.assertNotIn("não aproveitada", c[0]["motivo"])

    def test_nao_carregadas_citam_destino_que_existe_no_ddl(self):
        ddl = _ddl()
        for c in self.decl:
            if c["tabela"] in l5_10.NAO_CARREGADAS:
                self.assertEqual(c["destino"], "", c["tabela"])
                self.assertTrue(c["motivo"].startswith("não carregada"), c["tabela"])
                for tab, col in re.findall(r"-> (\w+)\.(\w+)", c["motivo"]) if ddl else ():
                    corpo = re.search(r"CREATE TABLE %s \((.*?)\n\)" % tab, ddl, re.S)
                    self.assertTrue(corpo, tab)
                    self.assertRegex(corpo.group(1), r"\n\s+%s\s" % col, "%s.%s" % (tab, col))
        # sem promessa de de-para que não existe: quem cita codigo_esocial diz que ele está pendente
        for c in self.decl:
            if "codigo_esocial" in c["motivo"] and c["tabela"] != "FPTPFOLHAESOC":
                self.assertIn("pedido L5-10.json", c["motivo"], c["tabela"])

    def test_colisao_de_caixa_nos_codigos_da_imagem(self):
        cod = {}
        l5_10.linhas(None, lambda t, v: cod.setdefault(t, []).append(v[0]))
        self.assertEqual(sentinela.colisoes_caixa(cod["FPTP_EVENTO"]), [["P", "p"]])
        self.assertEqual(sentinela.colisoes_caixa(cod["FPTP_REFER"]), [["H", "h"]])
        self.assertEqual(sentinela.aplicar("codigo_char", "p"), ("p", None))

    def test_regras_da_fatia(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "  Tipo   colaborador ")[0], "Tipo colaborador")
        self.assertEqual(sentinela.aplicar("texto_nome", "   ")[0], None)

    def test_esperado_da_imagem_so_na_carregada(self):
        self.assertEqual(set(self.esp), set(l5_10.CARREGADAS))
        self.assertEqual(self.esp["FPTP_FUNC"], {"gravados": 5, "pendencias": {"restricao_destino_1048": 1}})


if __name__ == "__main__":
    unittest.main()
