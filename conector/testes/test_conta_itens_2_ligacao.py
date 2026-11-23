"""conta-itens-2, conferidor final (ADR 0006, 3): o item de tabela licenciada LIGADO ao item do espelho nunca é tocado
pelo conector. Sintético, dados 100% falsos, sem banco (o banco é simulado pelas consultas que o código faz).

- Sincronizar, linha 3 removida da origem: o item 9601 do espelho fica com excluido_em NULL; só o conector_origem é
  marcado (causa: _marcar fazia UPDATE excluido_em no item do espelho).
- 2a passada, linha 3 alterada e sem ligar mais ao 9601 (código fora do espelho, marca mudou, outro item): a reaplicação
  nunca usa o 9601 como alvo; a linha é tratada como nova, com a pendência ligacao_espelho_desfeita.
- Espelho do catálogo vazio no cliente: espelho_nao_carregado (alta), nunca cópia "própria" do licenciado.
- FATOR 100 e SITUACAO inativa no item 3 ligado: personalização do hospital sem destino, visível por coluna.
"""
import unittest

from sante_conector import carga_mapa, sincronizar

PLANO = [{"tabela": "TBMATMED", "destinos": ["item_referencia_matmed"], "opcoes": {},
          "ligacoes": [{"espelho": {"catalogo": "brasindice"}, "coluna": "COD", "cond": None}]}]


class _Cur:
    def __init__(self, log):
        self.log = log

    def execute(self, sql, args=None):
        self.log.append((sql, args))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Banco:
    """cm simulado: item 9601 é do espelho (origem 'sistema'); 9700 foi criado pela migração."""

    def __init__(self, espelho_vazio=False):
        self.plano, self.ctl, self.sinc_res, self.log, self.cont, self.pend = PLANO, "ctl", {}, [], {}, []
        self.espelho_vazio = espelho_vazio
        self.rs = []

    def _nome_ent(self, t, dt):
        return dt

    def _info(self, dt):
        return {"excluido_em": 1, "origem": 1}

    def _todas(self, sql, args=()):
        if sql.startswith("SELECT origem FROM"):
            return [("sistema",)] if args[0] == 9601 else [("migracao",)]
        if "COUNT(*) FROM item_referencia_matmed" in sql:
            return [(0 if self.espelho_vazio else 1,)]
        if "FROM ctl.conector_origem" in sql:
            return self.rs
        raise AssertionError(sql)

    def _c(self):
        return _Cur(self.log)

    def _pendencia(self, t, chave, regra, g):
        self.pend.append((t, chave, regra, g))


class MarcarLigado(unittest.TestCase):
    def test_linha_removida_nao_exclui_o_item_do_espelho(self):
        cm = _Banco()
        cm.rs = [(11, "item_referencia_matmed", 9601)]
        marcadas, sem = sincronizar._marcar(cm, "TBMATMED", "3", True)
        self.assertEqual((marcadas, sem), (0, 0))
        self.assertFalse([s for s, _ in cm.log if "`item_referencia_matmed`" in s])  # o 9601 fica intacto
        self.assertEqual([a for s, a in cm.log if "conector_origem" in s], [(11,)])   # só o controle é marcado
        self.assertEqual(cm.sinc_res["mantidas_espelho"], 1)

    def test_reativacao_tambem_nao_toca_o_espelho(self):
        cm = _Banco()
        cm.rs = [(11, "item_referencia_matmed", 9601)]
        sincronizar._marcar(cm, "TBMATMED", "3", False)
        self.assertFalse([s for s, _ in cm.log if "`item_referencia_matmed`" in s])

    def test_item_proprio_criado_pela_migracao_continua_excluido(self):
        cm = _Banco()
        cm.rs = [(12, "item_referencia_matmed", 9700)]
        self.assertEqual(sincronizar._marcar(cm, "TBMATMED", "8", True), (1, 0))
        self.assertTrue([s for s, _ in cm.log if "`item_referencia_matmed`" in s])


def _carga(atualizar, espelho_vazio=False):
    c = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
    b = _Banco(espelho_vazio)
    c.plano, c.cont, c._todas, c._info, c._pendencia, c._atualizar = b.plano, b.cont, b._todas, b._info, b._pendencia, atualizar
    return c, b


class DesfazerLigacao(unittest.TestCase):
    def test_codigo_fora_do_espelho_nunca_reaplica_sobre_o_9601(self):
        for ligado in (None, 9602):  # COD trocado para fora do espelho / marca mudou; ou liga a outro item
            c, b = _carga((9601, b"h", b"d", None, None))
            self.assertTrue(c._desfazer_ligacao("TBMATMED", "3", PLANO[0], "item_referencia_matmed", ligado))
            self.assertIsNone(c._atualizar)                                # tratada como nova: nasce própria/religa
            self.assertEqual(b.pend, [("TBMATMED", "3", "ligacao_espelho_desfeita", "media")])

    def test_mesma_ligacao_ou_item_proprio_seguem_como_antes(self):
        for ant, ligado in ((9601, 9601), (9700, None)):  # liga ao mesmo; item próprio da migração reaplica
            c, b = _carga((ant, b"h", b"d", None, None))
            self.assertFalse(c._desfazer_ligacao("TBMATMED", "3", PLANO[0], "item_referencia_matmed", ligado))
            self.assertEqual(c._atualizar[0], ant)
            self.assertEqual(b.pend, [])


class EspelhoCarregado(unittest.TestCase):
    def test_espelho_vazio_recusa(self):
        self.assertFalse(_carga(None, espelho_vazio=True)[0]._espelho_carregado("brasindice"))
        self.assertTrue(_carga(None)[0]._espelho_carregado("simpro"))
        self.assertTrue(_carga(None, espelho_vazio=True)[0]._espelho_carregado("cbhpm"))  # outro catálogo: não se aplica
        self.assertEqual(carga_mapa.GRAVIDADE_REGRA["espelho_nao_carregado"], "alta")


class Personalizacao(unittest.TestCase):
    def test_fator_e_situacao_do_hospital_visiveis(self):
        nomes = ["descricao", "situacao", "fator_divisao", "unidade_medida_id"]
        hosp = ["Item exemplo licenciado", "inativo", 100.0, None]
        esp = ["Item exemplo do espelho", "ativo", None, None]
        self.assertEqual(carga_mapa.personalizacao_perdida(nomes, hosp, esp), ["situacao", "fator_divisao"])
        presumido = [None, carga_mapa._PADRAO("ativo"), None, None]
        self.assertEqual(carga_mapa.personalizacao_perdida(nomes, presumido, esp), [])  # presumido não é personalização


if __name__ == "__main__":
    unittest.main()
