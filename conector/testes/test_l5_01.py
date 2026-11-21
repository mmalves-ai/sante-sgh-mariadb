"""Fatia L5-01 (cadastros e administração): declarações sobre o mapa real e carga na imagem SINTÉTICA (dados 100%
falsos, sintetica_d/l5_01.py). Só contagens e regras; nenhum dado real."""
import unittest

from sante_conector import carga_mapa, mapa, sentinela

CARREGADAS = ["TBGRUUSU", "PREMAILCFG", "PREMAILMODULO", "PRLOCPACDEFAULT", "PRTERMOCAD", "PRTERMOACEITE",
              "PRTIPO_JUSTIF_EXPORTACAO", "PRTPNOTIFEMAIL", "RPMATRIZ_GUT_TIPO", "RPMATRIZ_GUT_DESCRICAO", "TBCENARIO",
              "TBCFGLOGIN", "TBDICIONARIO_TBUSERS"]
# descarte de produto em declarado/sem_carga.tsv (decisões em docs/obra/passagens/F4-decisoes-destino.md)
DESCARTADAS = ["FPCON", "TBAGEUSE", "TBDIGITAR", "TBDIGITAR_CNSCADPAC", "TBDIGITAR_FILIACAO"]
# bloqueio explícito ao dono: restrições de acesso em uso que pedem mecanismo no motor (pedido em saida/L5-01.json)
AGUARDAM = ["DIPERMPS", "TBCTRPRTUSU"]


class PlanoL501(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(CARREGADAS + DESCARTADAS + AGUARDAM))}

    def _cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_so_as_carregaveis_entram_e_na_ordem_do_mapa(self):
        self.assertEqual(set(self.plano), set(CARREGADAS))
        ordem = {r["tabela"]: int(r["ordem"]) for r in self.m["tabelas"] if r["tabela"] in CARREGADAS}
        self.assertEqual([p for p in self.plano], sorted(CARREGADAS, key=ordem.get))
        lista = list(self.plano)
        self.assertLess(lista.index("RPMATRIZ_GUT_TIPO"), lista.index("RPMATRIZ_GUT_DESCRICAO"))
        self.assertLess(lista.index("PRTERMOCAD"), lista.index("PRTERMOACEITE"))

    def test_descartes_com_causa_de_produto(self):
        sc = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        for t in DESCARTADAS:
            self.assertEqual(sc[t]["situacao"], "descarte", t)
            self.assertIn(sc[t]["causa"], {"sem_valor", "mecanismo_do_produto"}, t)
            self.assertTrue(sc[t]["motivo"].strip(), t)

    def test_destinos_e_regras_declaradas(self):
        perfil = self._cols("TBGRUUSU", "perfil_acesso")
        self.assertEqual(perfil["codigo"]["coluna"], "#codigo_derivado:NOME:30")  # chave preservada; longa: derivada
        self.assertEqual(perfil["nome"]["regra"], "texto_nome")
        g = self._cols("RPMATRIZ_GUT_DESCRICAO", "grau_priorizacao_gut")
        self.assertEqual((g["dimensao_priorizacao_gut_id"]["regra"], g["dimensao_priorizacao_gut_id"]["referencia"]),
                         ("chave_origem", "RPMATRIZ_GUT_TIPO"))
        # login do usuário pela chave de TBUSERS (referência declarada)
        for t, dt in [("PRLOCPACDEFAULT", "preferencia_usuario"), ("PRTERMOACEITE", "aceite_termo_uso"),
                      ("TBDICIONARIO_TBUSERS", "dicionario_usuario")]:
            self.assertEqual(self._cols(t, dt)["usuario_id"]["referencia"], "TBUSERS", t)
        # só um destino por tabela de vários destinos no mapa (o outro não tem fonte honesta: decisão registrada)
        self.assertEqual(self.plano["PRLOCPACDEFAULT"]["destinos"], ["preferencia_usuario"])
        self.assertEqual(self.plano["TBCFGLOGIN"]["destinos"], ["politica_senha"])
        # tipo de notificação por e-mail é finalidade de envio, não canal
        self.assertEqual(self.plano["PRTPNOTIFEMAIL"]["destinos"], ["finalidade_email"])
        self.assertTrue(self._cols("PRTPNOTIFEMAIL", "finalidade_email")["codigo"]["coluna"].endswith(":notificacao_"))
        termo = self._cols("PRTERMOCAD", "termo_uso_versao")
        self.assertEqual(termo["hash_texto"]["coluna"], "#sha256:TERMO_CONCORDANCIA_USO_PEP")
        self.assertEqual(termo["situacao"]["valores"], {"1": "publicado", "0": "revogado", "": "rascunho"})
        pol = self._cols("TBCFGLOGIN", "politica_senha")
        self.assertEqual(pol["tamanho_minimo"]["regra"], "piso:8")
        self.assertEqual(pol["inatividade_sessao_minutos"]["regra"], "minutos_em_timestamp")
        # o aceite periódico vem da origem (nunca desligado na virada); só o período é presumido
        self.assertEqual(pol["exige_aceite_periodico"]["coluna"], "SOLIC_TERMO_ACEITE_PERIODICO")
        self.assertEqual(pol["exige_aceite_periodico"]["regra"], "booleano_sn")
        self.assertEqual(pol["periodicidade_aceite_dias"]["coluna"], "=~30")

    def test_nenhuma_credencial_gravada_em_claro(self):
        decl = [c for c in self.m["colunas_decl"] if c.get("_arquivo", "").endswith("L5-01.tsv")]
        self.assertTrue(decl)
        self.assertEqual([c["coluna"] for c in decl if "SENHA_AUTENTICACAO" in c["coluna"]],
                         ["#cofre:SENHA_AUTENTICACAO"])
        cols = self._cols("PREMAILCFG", "servidor_email")
        self.assertEqual(cols["seguranca"]["valores"], {"1": "ssl_tls", "0": "nenhuma", "": "nenhuma"})
        # sem a senha no cofre o servidor entra inativo: o produto nunca envia sem autenticar
        self.assertEqual(cols["ativo"]["coluna"], "=0")
        self.assertEqual(cols["exige_autenticacao"]["coluna"], "=0")

    def test_descartes_e_bloqueios_declarados(self):
        arq = mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv"
        sem = {l.split("\t")[0] for l in arq.read_text(encoding="utf-8").splitlines()[1:] if l.strip()}
        self.assertTrue(set(DESCARTADAS) <= sem)
        self.assertFalse(set(AGUARDAM) & sem)

    def test_regras_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", b"Enfermagem   plantao "), ("Enfermagem plantao", None))
        self.assertEqual(a("texto", 7), ("7", None))
        self.assertEqual(a("booleano_sn", b"X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_sn", b"T"), (True, None))
        self.assertEqual(a("texto", b" Enfermagem   plantao "), ("Enfermagem   plantao", None))
        self.assertEqual(a("inteiro_zero_nulo", 0), (None, None))


class ConferenciaL501(unittest.TestCase):
    def test_carga_concilia_reexecuta_e_mostra_edicao(self):
        from sante_conector import conferencia

        def editar(cc):
            with cc.cursor() as c:
                c.execute("UPDATE cenario_alerta SET descricao='editado', versao=versao+1 ORDER BY id LIMIT 1")
        r = conferencia.conferir("L5-01", depois_da_primeira=editar)
        self.assertEqual(r["erros"], [])
        e = r["entidades"]
        self.assertEqual((e["perfil_acesso"]["registros_destino"], e["perfil_acesso"]["recusados"]), (8, 1))
        self.assertEqual((e["grau_priorizacao_gut"]["registros_destino"], e["grau_priorizacao_gut"]["recusados"]),
                         (15, 4))
        self.assertEqual(e["politica_senha"]["registros_destino"], 1)
        self.assertEqual(e["servidor_email"]["registros_destino"], 3)
        self.assertNotIn("canal_notificacao", e)
        self.assertNotIn("configuracao_setor_prontuario", e)
        self.assertEqual(r["segunda"]["pendencias_por_regra"].get("cenario_alerta:edicao_no_destino:media"), 1)


if __name__ == "__main__":
    unittest.main()
