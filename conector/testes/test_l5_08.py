"""Fatia L5-08 (cadastros e administração, módulo RH): declarações sobre o mapa real e regras de coluna.

Sem banco; só valores inventados. A carga na imagem SINTÉTICA é a conferência da fatia
(`tools/obra/conferir-fatia-f4.sh L5-08`).
"""
import copy
import datetime
import os
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_08

FATIA = {"FPEPC", "FPESOCAUTORIA", "FPESOCCADRESEV", "FPESOCDESONER", "FPESOCINDAVISO", "FPESOCINDPROC",
         "FPESOCINDSUSP", "FPESOCMOTAFAS", "FPESOCORIRETIF", "FPESOCPARAMS1210", "FPESOCPTOELET", "FPESOCTPAVISO",
         "FPESOCTPJORTRAB", "FPESOCTRABTEMP", "FPEXPAGNOCIVO", "FPGRAUEXPAGNOC", "FPHSTDIAAFAST", "FPINDICDECPRO",
         "FPINTAGRUP", "FPINTROTINA", "FPLOTACAOTRIB", "FPMOTAFAST"}
CARREGADAS = {"FPMOTAFAST": ["motivo_afastamento"], "FPHSTDIAAFAST": ["tabela_legal_vigencia"]}


class DeclaracoesL5_08(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, FATIA) if p["tabela"] in FATIA}

    def test_so_as_carregaveis_entram_no_plano(self):
        self.assertEqual(set(self.plano), set(CARREGADAS))
        for t, dts in CARREGADAS.items():
            self.assertEqual(self.plano[t]["destinos"], dts)

    def test_nenhum_destino_oficial_declarado(self):
        ofic = {r["tabela"]: set((r.get("destinos_oficiais") or "").split(";")) - {""} for r in self.m["tabelas"]}
        for c in self.m["colunas_decl"]:
            if c["tabela"] in FATIA:
                self.assertNotIn(c["destino"].split(".")[0], ofic.get(c["tabela"], set()), c)

    def test_colunas_do_motivo(self):
        cols = {c["coluna"]: c for c in self.plano["FPMOTAFAST"]["colunas"]["motivo_afastamento"]}
        self.assertEqual(cols["ID"]["destino"], "codigo")
        self.assertEqual(cols["DESCRICAO"]["destino"], "descricao")

    def test_colunas_da_tabela_legal(self):
        cols = {c["coluna"]: c["destino"] for c in self.plano["FPHSTDIAAFAST"]["colunas"]["tabela_legal_vigencia"]}
        self.assertEqual(cols, {"=dias_afastamento_empresa": "tipo_tabela", "DATA_VIGENCIA": "vigencia_inicio",
                                "NUM_DIA": "quantidade_dias"})


class RegrasL5_08(unittest.TestCase):
    def test_codigo_inteiro_vira_texto(self):
        self.assertEqual(sentinela.aplicar("texto", 7), ("7", None))

    def test_descricao_apara_so_as_pontas(self):
        self.assertEqual(sentinela.aplicar("texto", "  Licença\r\n linha  ".encode("cp1252"))[0], "Licença\r\n linha")
        self.assertEqual(sentinela.aplicar("texto", b"   "), (None, None))

    def test_vigencia_sentinela(self):
        self.assertEqual(sentinela.aplicar("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(sentinela.aplicar("data", datetime.date(2026, 1, 1)), (datetime.date(2026, 1, 1), None))

    def test_esperado_da_imagem(self):
        vistos = []
        esp = l5_08.linhas(__import__("random").Random(1), lambda t, v: vistos.append(t))
        self.assertEqual(set(esp), set(CARREGADAS))
        self.assertEqual(vistos.count("FPMOTAFAST"), 12)
        self.assertEqual(vistos.count("FPHSTDIAAFAST"), 5)


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001
        return False


def _hst_ctl(sql):
    """Executa `sql` (com {ctl}) no banco de controle da conferência da fatia: simula a ORIGEM mudada entre as rodadas
    (a imagem sintética é fixa; mudar o hash ou a chave guardados equivale a mudar a linha na origem)."""
    from sante_conector import controle

    def f(cc):
        with cc.cursor() as c:
            c.execute(sql.format(ctl=controle.nome_ctl("cfl5_08")))
    return f


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class CorrecaoDeDiasNaVigencia(unittest.TestCase):
    """Achado da avaliação: o hospital corrige os dias de uma vigência já carregada (ex.: 15 para 30)."""

    def _por_regra(self, r, regra):
        return sum(n for k, n in r["segunda"]["pendencias_por_regra"].items()
                   if k.startswith("tabela_legal_vigencia:") and (":%s:" % regra) in k)

    def test_chave_do_mapa_com_os_dias_vira_apagada_mais_insercao(self):
        """Mapa atual (chave NUM_DIA,DATA_VIGENCIA): a troca dos dias some com a chave antiga e cria outra. Prova do
        defeito pedido ao integrador (saida/L5-08.json): deixa de valer quando a chave for só DATA_VIGENCIA."""
        from sante_conector import conferencia
        m = mapa.carregar_execucao()
        ch = [r for r in m["tabelas"] if r["tabela"] == "FPHSTDIAAFAST"][0]["chave"]
        if ch != "NUM_DIA,DATA_VIGENCIA":
            self.skipTest("chave do mapa já trocada: %s" % ch)
        sim = _hst_ctl("UPDATE `{ctl}`.conector_origem SET chave_original=CONCAT('30', SUBSTRING(chave_original, 3))"
                       " WHERE tabela_origem='FPHSTDIAAFAST' AND chave_original LIKE '15|2000%'")
        r = conferencia.conferir("L5-08", depois_da_primeira=sim)
        self.assertEqual(self._por_regra(r, "apagada_aguarda_sincronizar"), 1, r["segunda"])
        self.assertEqual(self._por_regra(r, "restricao_destino_1062"), 2, r["segunda"])  # a de sempre + a nova
        self.assertEqual(self._por_regra(r, "alteracao_aguarda_sincronizar"), 0, r["segunda"])

    def test_chave_pela_vigencia_vira_uma_alteracao(self):
        """Mapa pedido (chave DATA_VIGENCIA, a natural do destino com o tipo literal): a troca dos dias vira UMA
        pendência alteracao_aguarda_sincronizar (a origem vence no Sincronizar), sem apagada nem inserção recusada."""
        from sante_conector import conferencia
        m = copy.deepcopy(mapa.carregar_execucao())
        for r in m["tabelas"]:
            if r["tabela"] == "FPHSTDIAAFAST":
                r["chave"] = "DATA_VIGENCIA"
        sim = _hst_ctl("UPDATE `{ctl}`.conector_origem SET hash_linha=UNHEX(REPEAT('00',16))"
                       " WHERE tabela_origem='FPHSTDIAAFAST' AND chave_original LIKE '2000%'")
        l5_08.MAPA_TESTE = m
        try:
            r = conferencia.conferir("L5-08", depois_da_primeira=sim)
        finally:
            del l5_08.MAPA_TESTE
        # 2 = a correção simulada + a vigência repetida da imagem (15 e 60 em 2026-01-01): com a chave só pela data,
        # a repetida deixa de ser 1062 e passa por alteração. Por isso o pedido inclui a regra genérica de chave
        # repetida na origem (chave_duplicada_na_origem, recusa crítica); com ela, o esperado aqui vira 1.
        self.assertEqual(self._por_regra(r, "alteracao_aguarda_sincronizar"), 2, r["segunda"])
        self.assertEqual(self._por_regra(r, "apagada_aguarda_sincronizar"), 0, r["segunda"])
        self.assertEqual(self._por_regra(r, "restricao_destino_1062"), 0, r["segunda"])


if __name__ == "__main__":
    unittest.main()
