"""F4 liberação (2026-11-22): o item de mat/med (TBMATMED, L8-03) teve 20.000 de 20.000 linhas recusadas com
`licenca_nao_comprovada` no recorte da cadeia. O filtro de linha `so_se:TAB>TBCTRMEM>REF_BRA=N,F` lê a marca de licença
na tabela de mat/med (TBCTRMEM), mas não havia aresta TBMATMED -> TBCTRMEM (a origem não tem FK e a via `so_se:` não
gera dependência). Sem a aresta, o fecho do recorte não puxava TBCTRMEM e, na carga, nada garante a tabela antes do
item. CORREÇÃO DO TEXTO (conferidor F4): a causa dada no commit 84c694b4 não procede. `_ler_pai` lê o pai da ORIGEM,
sem depender da ordem de carga; e o pai ausente fazia a linha PASSAR no filtro (o nulo casava com o vazio de
`N,F,`), não cair. As 20.000 recusas do recorte eram de tabelas licenciadas de fato: na origem, TBMATMED tem 125.201
linhas de tabela própria (REF_BRA=F e REF_SIMP=F) e 785.213 de licenciadas (T em uma das duas), e as 20.000 primeiras
pela chave (as do recorte) são TODAS de tabela licenciada (REF_BRA=T; medido por contagem, 22/11). A aresta continua certa (o fecho do recorte precisa do pai); o pai ausente agora RECUSA a
linha (FiltroComPaiAusente, abaixo, e a TBMATMED 7 da sintética L8-03).

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


class FiltroComPaiAusente(unittest.TestCase):
    """Conferidor F4: pai inexistente pela encadeada NÃO é "valor vazio". Antes, o nulo casava com o vazio de
    `REF_BRA=N,F,` e a linha de tabela licenciada (ou fora do recorte) passava como PRÓPRIA (fere a regra 7 e o ADR
    0006). Com o pai ausente a condição fica fora e a regra do pai vai para a pendência (ADR 0007, 19). A carga
    sintética (L8-03, TBMATMED 7, tabela 9 sem linha em TBCTRMEM) confere a recusa pela gravação."""
    COND = "TAB>TBCTRMEM>REF_BRA=N,F,!licenca_nao_comprovada"

    def _c(self, pai):
        c = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
        c._origem_pai = {("TBCTRMEM", "REF_BRA"): pai}
        return c

    def test_tabela_sem_linha_no_pai_fica_fora_com_pendencia(self):
        c, pend = self._c({"1": "F", "3": "T"}), []
        cond = mapa.condicao(self.COND)
        self.assertTrue(c._cond({"TAB": 1}, cond))          # própria (domínio real T/F)
        self.assertFalse(c._cond({"TAB": 3}, cond))         # licenciada
        self.assertFalse(c._cond({"TAB": 9}, cond, pend))   # sem linha em TBCTRMEM: nunca própria
        self.assertEqual(pend, [("pai_inexistente", "media")])

    def test_pai_fora_da_imagem_fica_fora(self):
        pend = []
        self.assertFalse(self._c({})._cond({"TAB": 1}, mapa.condicao(self.COND), pend))
        self.assertEqual(pend, [("pai_inexistente", "media")])


if __name__ == "__main__":
    unittest.main()
