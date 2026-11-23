"""conta-itens-3 (proposta B): a linha de TBMATMED LIGADA ao item do espelho grava ou adota os destinos secundários,
que são do cliente (o item faturável do item de referência), com `@id` = o item do espelho, que nunca é tocado.
Sintético, dados 100% falsos, sem banco (gravação simulada). A prova no banco é a conferência das fatias L8-03 e
L8-06 (CONFERIR_DESTINO)."""
import unittest

from sante_conector import carga_mapa

P = {"tabela": "TBMATMED", "destinos": ["item_referencia_matmed", "item_faturavel", "grupo_faturamento"],
     "opcoes": {"grupo_faturamento": {"antes": True, "adotar": ["codigo"]},
                "item_faturavel": {"adotar": ["item_referencia_matmed_id"]}},
     "colunas": {"item_referencia_matmed": [],
                 "item_faturavel": [{"coluna": "@id", "destino": "item_referencia_matmed_id"},
                                    {"coluna": "@id:grupo_faturamento", "destino": "grupo_faturamento_id"}],
                 "grupo_faturamento": []}}
DTS = P["destinos"]


def _carga(adotar_item=False):
    c = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
    c.cont, c.origem, c.gravados, c.reg, c.pend = {}, {}, [], [], []

    def gravar(dt, v, adotar, complementa=False, ativo=()):
        c.gravados.append((dt, dict(v)))
        if dt == "item_faturavel" and adotar_item:
            return 77, True
        return {"grupo_faturamento": 501, "item_faturavel": 701}[dt], False
    c._gravar_ou_adotar = gravar
    c._registrar = lambda t, k, ent, rid, h, hd=None, recusa=None: c.reg.append((k, ent, rid))
    c._pendencia = lambda t, k, r, g: c.pend.append(r)
    c._todas = lambda sql, args=(): [("matmed_3",)]
    return c


VALS = {"item_faturavel": [(None, {"codigo": "matmed_3", "tipo_item": "material"})],
        "grupo_faturamento": [(None, {"codigo": "tabela_matmed_1"})]}
CAMPOS = {"item_faturavel": [(["codigo"], ["matmed_3"])], "grupo_faturamento": [(["codigo"], ["tabela_matmed_1"])]}


class SecundariasLigado(unittest.TestCase):
    def test_item_faturavel_aponta_o_item_do_espelho(self):
        c = _carga()
        c._secundarias_ligado("TBMATMED", "3", b"h", P, DTS, DTS, 9601, VALS, CAMPOS)
        self.assertEqual([g[0] for g in c.gravados], ["grupo_faturamento", "item_faturavel"])  # `antes` primeiro
        v = c.gravados[1][1]
        self.assertEqual((v["item_referencia_matmed_id"], v["grupo_faturamento_id"]), (9601, 501))
        self.assertNotIn("item_referencia_matmed", [g[0] for g in c.gravados])  # o espelho nunca é gravado
        self.assertIn(("3/item_faturavel", "item_faturavel", 701), c.reg)
        self.assertIn(("3/grupo_faturamento", "grupo_faturamento", 501), c.reg)

    def test_outra_tabela_ligada_ao_mesmo_item_adota(self):
        c = _carga(adotar_item=True)
        c._secundarias_ligado("TBMATMED", "9", b"h", P, DTS, DTS, 9601, VALS, CAMPOS)
        self.assertIn(("9/item_faturavel", "item_faturavel", 77), c.reg)
        self.assertEqual(c.pend, ["adotado_existente"])


if __name__ == "__main__":
    unittest.main()
