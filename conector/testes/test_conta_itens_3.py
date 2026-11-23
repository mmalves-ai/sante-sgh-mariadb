"""conta-itens-3 (proposta B): a linha de TBMATMED LIGADA ao item do espelho grava ou adota os destinos secundários,
que são do cliente (o item faturável do item de referência), com `@id` = o item do espelho, que nunca é tocado.
Também: Sincronizar da linha ligada (a origem vence no mesmo id), ligação desfeita (o item faturável registrado segue
no mesmo id, sem segundo `matmed_<ID>`) e secundário declarado depois da carga (completado na linha já carregada).
Sintético, dados 100% falsos, sem banco (gravação simulada). A prova no banco é a conferência das fatias L8-03 e
L8-06 (CONFERIR_DESTINO)."""
import unittest
from unittest import mock

from sante_conector import carga_mapa
from sante_conector import sincronizar as sincronizar_mod

P = {"tabela": "TBMATMED", "destinos": ["item_referencia_matmed", "item_faturavel", "grupo_faturamento"],
     "opcoes": {"grupo_faturamento": {"antes": True, "agrupar": ["TAB"], "adotar": ["codigo"]},
                "item_faturavel": {"adotar": ["item_referencia_matmed_id"]}},
     "colunas": {"item_referencia_matmed": [],
                 "item_faturavel": [{"coluna": "@id", "destino": "item_referencia_matmed_id"},
                                    {"coluna": "@id:grupo_faturamento", "destino": "grupo_faturamento_id"}],
                 "grupo_faturamento": []}}
DTS = P["destinos"]


def _carga(adotar_item=False, existente=None, cabecalho=None, codigo="matmed_3"):
    c = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
    c.cont, c.origem, c.gravados, c.reg, c.pend, c.atualizados = {}, {}, [], [], [], []
    c.existente = {"TBMATMED": dict(existente or {})}
    c._atualizar = c._desfeito = None
    c._grp, c._cab = ("1", 1), {}

    def gravar(dt, v, adotar, complementa=False, ativo=()):
        c.gravados.append((dt, dict(v)))
        if dt == "item_faturavel" and adotar_item:
            return 77, True
        return {"grupo_faturamento": 501, "item_faturavel": 701}[dt], False
    c._gravar_ou_adotar = gravar
    c._cabecalho = lambda t, dt, chave, principal=False: (cabecalho, cabecalho is not None)
    c._registrar = lambda t, k, ent, rid, h, hd=None, recusa=None: c.reg.append((k, ent, rid))
    c._pendencia = lambda t, k, r, g: c.pend.append(r)
    c._todas = lambda sql, args=(): [(codigo,)]
    return c


VALS = {"item_faturavel": [(None, {"codigo": "matmed_3", "tipo_item": "material"})],
        "grupo_faturamento": [(None, {"codigo": "tabela_matmed_1"})]}
CAMPOS = {"item_faturavel": [(["codigo"], ["matmed_3"])], "grupo_faturamento": [(["codigo"], ["tabela_matmed_1"])]}
REG3 = {"3": (9601, b"h", b"d", None, None), "3/item_faturavel": (701, b"h", b"d", None, None),
        "3/grupo_faturamento": (501, b"h", b"d", None, None)}


class _Sinc:
    """sincronizar_mod com o banco simulado: item faturável criado pela migração; UPDATE anotado."""
    def __init__(self, c):
        self.c = c

    def __enter__(self):
        c = self.c
        self.ps = [mock.patch.object(sincronizar_mod, "criado_pelo_conector", lambda cm, dt, rid: True),
                   mock.patch.object(sincronizar_mod, "conflito", lambda *a: False),
                   mock.patch.object(sincronizar_mod, "atualizar",
                                     lambda cm, dt, rid, v, padrao=(): c.atualizados.append((dt, rid, dict(v))) or rid)]
        for x in self.ps:
            x.start()

    def __exit__(self, *a):
        for x in self.ps:
            x.stop()


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
        self.assertEqual(c._cab, {("TBMATMED", "1"): 501})  # as outras linhas da tabela usam o grupo

    def test_grupo_da_tabela_ja_gravado_e_usado_sem_pendencia(self):
        c = _carga(cabecalho=501)
        c._secundarias_ligado("TBMATMED", "4", b"h", P, DTS, DTS, 9601, VALS, CAMPOS)
        self.assertEqual([g[0] for g in c.gravados], ["item_faturavel"])
        self.assertEqual(c.gravados[0][1]["grupo_faturamento_id"], 501)
        self.assertEqual(c.pend, [])

    def test_outra_tabela_ligada_ao_mesmo_item_adota(self):
        c = _carga(adotar_item=True)
        c._secundarias_ligado("TBMATMED", "9", b"h", P, DTS, DTS, 9601, VALS, CAMPOS)
        self.assertIn(("9/item_faturavel", "item_faturavel", 77), c.reg)
        self.assertEqual(c.pend, ["adotado_existente"])

    def test_sincronizar_da_linha_ligada_alterada_a_origem_vence(self):
        c = _carga(existente=REG3, cabecalho=501)
        c._atualizar = REG3["3"]
        vals = {"item_faturavel": [(None, {"codigo": "matmed_3", "descricao": "NOVA"})],
                "grupo_faturamento": VALS["grupo_faturamento"]}
        with _Sinc(c):
            c._secundarias_ligado("TBMATMED", "3", b"h2", P, DTS, DTS, 9601, vals, CAMPOS)
        self.assertEqual([g[0] for g in c.gravados], [])  # nada adotado nem inserido
        self.assertEqual(c.atualizados, [("item_faturavel", 701, {
            "codigo": "matmed_3", "descricao": "NOVA", "item_referencia_matmed_id": 9601, "grupo_faturamento_id": 501})])
        self.assertNotIn("adotado_existente", c.pend)

    def test_ligacao_desfeita_religa_no_mesmo_item_faturavel(self):
        c = _carga(existente=REG3, cabecalho=501)
        c._desfeito = REG3["3"]  # Sincronizar: o código mudou para outro item do espelho
        with _Sinc(c):
            c._secundarias_ligado("TBMATMED", "3", b"h2", P, DTS, DTS, 9700, VALS, CAMPOS)
        self.assertEqual(c.gravados, [])  # nenhum segundo matmed_3 (uq_item_faturavel_codigo)
        self.assertEqual([(a[1], a[2]["item_referencia_matmed_id"]) for a in c.atualizados], [(701, 9700)])

    def test_ligacao_desfeita_item_proprio_reaplica_o_registrado(self):
        # a linha entra como própria (gravar): o secundário vai ao mesmo id, apontando o item próprio novo
        c = _carga(existente=REG3)
        with _Sinc(c):
            self.assertEqual(c._alvo_secundario("TBMATMED", "3/item_faturavel", "item_faturavel",
                                                P["opcoes"]["item_faturavel"], VALS["item_faturavel"][0][1], REG3["3"]),
                             (701, False))
            self.assertEqual(c._alvo_secundario("TBMATMED", "3/item_faturavel", "item_faturavel",
                                                P["opcoes"]["item_faturavel"], {}, None), (None, False))

    def test_compartilhado_dona_mantem_e_adotante_grava_o_seu(self):
        reg = dict(REG3, **{"9/item_faturavel": (701, b"h", b"d", None, None)})  # 9 adotou o item de 3
        op, v3 = P["opcoes"]["item_faturavel"], VALS["item_faturavel"][0][1]
        with _Sinc(_carga()):
            dona = _carga(existente=reg)
            self.assertEqual(dona._alvo_secundario("TBMATMED", "3/item_faturavel", "item_faturavel", op, v3,
                                                   reg["3"]), (701, True))
            adot = _carga(existente=reg)
            self.assertEqual(adot._alvo_secundario("TBMATMED", "9/item_faturavel", "item_faturavel", op,
                                                   {"codigo": "matmed_9"}, reg["3"]), (None, False))


class SecundarioACompletar(unittest.TestCase):
    def test_linha_ja_carregada_ganha_o_secundario_novo(self):
        c = _carga(existente={"3": REG3["3"], "4": (9602, b"h", b"d", None, None)})
        c._preparar_completar(P)
        self.assertEqual(c._secundarias_a_completar(P, "3"), ["item_faturavel", "grupo_faturamento"])
        c._valores = lambda p, linha, chave: (VALS, CAMPOS, [], None, [])
        c._completar_secundarias("TBMATMED", "3", b"h", P, DTS, DTS, {}, 9601, ["item_faturavel", "grupo_faturamento"])
        self.assertEqual(c.gravados[1][1]["item_referencia_matmed_id"], 9601)
        self.assertEqual(c.cont.get("secundarias_completadas"), 1)

    def test_secundario_ja_registrado_nao_completa(self):
        c = _carga(existente=REG3)
        c._preparar_completar(P)
        self.assertEqual(c._secundarias_a_completar(P, "3"), [])

    def test_recusa_da_linha_fica_visivel(self):
        c = _carga(existente={"3": REG3["3"]})
        c._valores = lambda p, linha, chave: (None, None, [], ("texto_vazio", "media"), [])
        c._completar_secundarias("TBMATMED", "3", b"h", P, DTS, DTS, {}, 9601, ["item_faturavel"])
        self.assertEqual((c.gravados, c.pend), ([], ["secundario_ausente"]))


if __name__ == "__main__":
    unittest.main()
