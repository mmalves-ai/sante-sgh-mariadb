"""F4 liberação (2026-11-22): o item de mat/med (TBMATMED, L8-03) teve 20.000 de 20.000 linhas recusadas com
`licenca_nao_comprovada` no recorte da cadeia. O filtro de linha `so_se:TAB>TBCTRMEM>REF_BRA=N,F` lê a marca de licença
na tabela de mat/med (TBCTRMEM), mas não havia aresta TBMATMED -> TBCTRMEM (a origem não tem FK e a via `so_se:` não
gera dependência). Sem a aresta, o fecho do recorte não puxava TBCTRMEM e, na carga, nada garante a tabela antes do
item: o pai não carregado vira valor nulo na condição e TODA linha (inclusive a da tabela PRÓPRIA do hospital) caía no
filtro. Na carga real a ordem do mapa salvou por acaso (125.201 próprias gravadas, 785.213 licenciadas puladas).

Causa corrigida no mapa (declarado/dependencias.tsv: TBMATMED, TBVLRMEM, TBPERMEM e TBREFMEMTUSS -> TBCTRMEM). Este
teste reproduz a causa com um mapa sintético (filtro pelo pai sem a aresta: o fecho não puxa o pai) e guarda a
invariante no mapa real: toda condição de linha (`so_se:`, `se:`, `destino_se:`) que lê coluna de OUTRA tabela pela
encadeada tem a aresta filha -> pai, o fecho puxa o pai e o plano carrega o pai antes."""
import re
import unittest

from sante_conector import carga_mapa, mapa
from sante_conector.medir_carga import fecho

_PAI_COND = re.compile(r"(?:so_se|se|destino_se):[A-Z0-9_$]+>([A-Z0-9_$]+)>")


def _pais_de_condicao(colunas_decl):
    """{(tabela, pai)}: condições de linha que leem coluna do pai pela encadeada."""
    out = set()
    for c in colunas_decl:
        for x in (c.get("via") or "").split(";"):
            m = _PAI_COND.match(x)
            if m and m.group(1) != c["tabela"]:
                out.add((c["tabela"], m.group(1)))
    return out


class FiltroPeloPaiSintetico(unittest.TestCase):
    def _mapa(self, com_aresta):
        deps = [{"tabela": "ITEM", "depende_de": "TAB", "quebra": ""}] if com_aresta else []
        return {"tabelas": [{"tabela": "ITEM", "depende_de": "TAB" if com_aresta else ""},
                            {"tabela": "TAB", "depende_de": ""}], "deps": deps,
                "colunas_decl": [{"tabela": "ITEM", "coluna": "NOME", "destino": "item.nome",
                                  "via": "so_se:TAB>TAB>MARCA=N,F,!licenca_nao_comprovada"}]}

    def test_sem_aresta_o_fecho_nao_puxa_o_pai_do_filtro(self):
        m = self._mapa(False)
        self.assertEqual(_pais_de_condicao(m["colunas_decl"]), {("ITEM", "TAB")})
        self.assertNotIn("TAB", fecho(m, {"ITEM"}))  # a causa: toda linha cairia no filtro

    def test_com_aresta_o_fecho_puxa_o_pai(self):
        self.assertIn("TAB", fecho(self._mapa(True), {"ITEM"}))

    def test_condicao_le_o_pai_pela_encadeada(self):
        c = mapa.condicao("TAB>TBCTRMEM>REF_BRA=N,F!licenca_nao_comprovada")
        self.assertEqual((c["coluna"], [x["tabela"] for x in c["passos"] if "tabela" in x], c["regra"]),
                         ("TAB", ["TBCTRMEM"], "licenca_nao_comprovada"))


class FiltroPeloPaiMapaReal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.arestas = {(d["tabela"], d["depende_de"]) for d in cls.m["deps"]}
        cls.carregaveis = {t["tabela"] for t in cls.m["tabelas"]}

    def test_toda_condicao_pelo_pai_tem_aresta(self):
        falta = sorted(x for x in _pais_de_condicao(self.m["colunas_decl"])
                       if x[0] in self.carregaveis and x[1] in self.carregaveis and x not in self.arestas)
        self.assertEqual(falta, [])

    def test_item_de_matmed_puxa_e_carrega_a_tabela_antes(self):
        for filho in ("TBMATMED", "TBVLRMEM", "TBPERMEM", "TBREFMEMTUSS"):
            self.assertIn("TBCTRMEM", fecho(self.m, {filho}), filho)
        plano = [p["tabela"] for p in carga_mapa.planejar(self.m, self.carregaveis)]
        self.assertLess(plano.index("TBCTRMEM"), plano.index("TBMATMED"))


if __name__ == "__main__":
    unittest.main()
