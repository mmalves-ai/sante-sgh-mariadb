"""Fatia L6-02 (recepção: recepções, guichês, locais, painéis, geradores e senhas): declarações planejadas, regras e
de-para de valores das colunas e coerência da imagem sintética. Sem banco; só valores inventados. A carga e a
conciliação rodam em `conector.sh conferir-fatia L6-02`."""
import datetime
import pathlib
import random
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_02

TABELAS = set(l6_02.CARREGADAS)
PARES = {  # de-para de valores pedido ao integrador (declarado/valores.tsv; L6-02.json)
    ("TBGERASENHA", "TIPO", "gerador_senha.tipo"): {"0": "geral", "2": "profissional", "3": "especialidade",
                                                    "4": "agenda", "5": "diverso"},
    ("TBSENHAATEND", "PRIORIDADE", "senha_emitida.prioritaria"): {"0": "1", "1": "1", "2": "0"},
    ("TBSENHAATEND", "SITUACAO", "senha_emitida.situacao"): {"": "aguardando", "G": "aguardando", "C": "chamada",
                                                             "A": "em_atendimento", "L": "atendida",
                                                             "S": "suspensa"},
}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | set(l6_02.BLOQUEADAS))}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        self.assertEqual(self.plano["TBSENHAATEND"]["destinos"], ["senha_emitida"])
        self.assertEqual(self.plano["TBSENHAATEND_REPACAGD"]["destinos"], ["senha_emitida_marcacao"])
        self.assertEqual(self.plano["TBSENHAATEND_SIPACAGD"]["destinos"], ["senha_emitida_marcacao"])
        # tipo de pré-atendimento não é módulo de recepção: sem declaração até o destino ser revisto (L6-02.json)
        self.assertIn("TBTIPO_ATENDIMENTO", l6_02.BLOQUEADAS)

    def test_obrigatorias_do_destino_cobertas(self):
        obrig = {("TBRECEPCAO", "ponto_recepcao"): {"estabelecimento_id", "codigo", "descricao"},
                 ("TBGUICHE", "guiche_recepcao"): {"ponto_recepcao_id", "numero"},
                 ("TBLOCAL", "local_atendimento"): {"estabelecimento_id", "ponto_recepcao_id", "codigo", "descricao"},
                 ("PNCONFIG", "painel_chamada"): {"estabelecimento_id", "tipo_painel_id", "descricao"},
                 ("TBGERASENHA", "gerador_senha"): {"ponto_recepcao_id", "descricao", "prefixo"},
                 ("TBSENHAATEND", "senha_emitida"): {"estabelecimento_id", "gerador_senha_id", "data_referencia",
                                                     "numero", "codigo_exibicao", "emitida_em"},
                 ("ATCABECATEND_TBSENHAATEND", "atendimento_senha"): {"atendimento_id", "senha_emitida_id"},
                 ("TBSENHAATEND_SIPACAGD", "senha_emitida_marcacao"): {"senha_emitida_id", "marcacao_horario_id"}}
        for (t, dt), cs in obrig.items():
            self.assertTrue(cs <= set(self.cols(t, dt)), (t, cs - set(self.cols(t, dt))))

    def test_referencias(self):
        c = self.cols("TBSENHAATEND", "senha_emitida")
        self.assertEqual((c["emitida_usuario_id"]["regra"], c["emitida_usuario_id"]["referencia"]),
                         ("chave_origem", "TBUSERS"))
        self.assertEqual(c["gerador_senha_id"]["referencia"], "TBGERASENHA")
        self.assertEqual(c["estabelecimento_id"]["coluna"], "@estabelecimento")
        e = self.cols("TBLOCALENCATE", "local_atendimento_encaminhamento")
        self.assertEqual({e["local_atendimento_id"]["referencia"], e["destino_local_atendimento_id"]["referencia"]},
                         {"TBLOCAL"})
        self.assertEqual(self.cols("TBSENHAATEND_SIPACAGD", "senha_emitida_marcacao")["marcacao_horario_id"]["referencia"],
                         "SIPACAGD")

    def test_de_para_de_valores(self):
        for (t, col, dest), pares in PARES.items():
            c = self.cols(t, dest.split(".")[0])[dest.split(".")[1]]
            self.assertEqual((c["coluna"], c["regra"], c["depara"]), (col, "codigo_char", "valores"))
            if c["valores"]:  # depois que o integrador acrescentar os pares
                self.assertEqual(c["valores"], pares)

    def test_situacao_nunca_cancelada_sem_motivo(self):
        # CHECK ck_senha_emitida_cancelamento: cancelada exige motivo de cancelamento, que a origem não tem
        self.assertNotIn("cancelada", PARES[("TBSENHAATEND", "SITUACAO", "senha_emitida.situacao")].values())

    def test_situacoes_dentro_do_check_do_modelo(self):
        # a última definição de ck_senha_emitida_situacao nas migrações (03_tabelas.sql acrescenta 'suspensa')
        defs = []
        aqui = pathlib.Path(mapa.__file__).resolve()
        raiz = next(r for r in (aqui.parents[1], aqui.parents[2]) if (r / "db" / "migracoes").is_dir())  # container | repo
        for arq in mapa._arquivos_ddl(raiz):
            defs += re.findall(r"ck_senha_emitida_situacao CHECK \(situacao IN \(([^)]*)\)", arq.read_text(encoding="utf-8"))
        self.assertTrue(defs)
        permitidas = set(re.findall(r"'(\w+)'", defs[-1]))
        sits = set(PARES[("TBSENHAATEND", "SITUACAO", "senha_emitida.situacao")].values())
        self.assertLessEqual(sits, permitidas)
        self.assertIn("suspensa", sits)

    def test_prioridade_sem_grupo_declarado(self):
        # perda registrada (pedido no L6-02.json): o grupo legal não vai para a senha até haver de-para antes da referência
        self.assertNotIn("grupo_prioridade_legal_id", self.cols("TBSENHAATEND", "senha_emitida"))

    def test_literais_presumidos(self):
        self.assertEqual(self.cols("PNCONFIG", "painel_chamada")["descricao"]["coluna"], "=~Painel de chamada")
        self.assertEqual(self.cols("TBGERASENHA", "gerador_senha")["descricao"]["coluna"], "=~Gerador de senha")

    def test_bloqueadas_sem_declaracao(self):
        decl = {c["tabela"] for c in self.mapa["colunas_decl"]}
        self.assertFalse(decl & set(l6_02.BLOQUEADAS))


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_longo", b"Aguarde\r\n  pelo painel  "), ("Aguarde\r\n  pelo painel  ", None))
        self.assertEqual(a("texto", b"   "), (None, None))
        self.assertEqual(a("texto", 10), ("10", None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_ai", "I"), (False, None))
        self.assertEqual(a("booleano_ai", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_zero_nulo", 0), (None, None))
        self.assertEqual(a("codigo_char", "G"), ("G", None))
        self.assertEqual(a("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(a("data_hora", datetime.datetime(1899, 12, 30)), (None, "data_sentinela"))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_02.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_ddl_so_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l6_02.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, TABELAS)

    def test_situacoes_e_prioridades_cobertas(self):
        senhas = []
        l6_02.linhas(random.Random(1), lambda t, v: senhas.append(v) if t == "TBSENHAATEND" else None)
        sits, prios = {v[6] for v in senhas}, {v[5] for v in senhas}
        self.assertTrue(set("GCALS") <= sits and "" in sits and "Z" in sits)
        self.assertEqual(prios, {"0", "1", "2"})


if __name__ == "__main__":
    unittest.main()
