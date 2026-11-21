"""Fatia L5-02 (cadastros e administração, módulo ADM): plano dirigido pelo mapa e regras das colunas.

Sem banco; só a imagem SINTÉTICA e valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L5-02`.
"""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_02

FATIA = set(l5_02.CARREGADAS) | set(l5_02.NAO_CARREGADAS)


class PlanoL502(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, FATIA)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_so_as_declaradas_entram_na_carga(self):
        self.assertEqual(set(self.plano), set(l5_02.CARREGADAS))
        self.assertEqual(len(FATIA), 20)
        self.assertEqual(len(l5_02.CARREGADAS), 11)

    def test_menu_antigo_entra_como_referencia_inativa(self):
        # módulo, opção e evento do sistema antigo: referência histórica (trilha, alertas, relatórios), sempre
        # inativa e com código legado_*, para nunca se misturar ao menu e às ações do contrato do produto
        self.assertEqual(self.plano["TBOPCOES"]["destinos"], ["tela_sistema", "acao_sistema"])
        self.assertEqual(self.plano["TBEVENTOS"]["destinos"], ["acao_sistema"])
        for t, dt, pre in [("TBMODULO", "modulo_sistema", "legado_modulo_"), ("TBOPCOES", "tela_sistema", "legado_opcao_"),
                           ("TBOPCOES", "acao_sistema", "legado_opcao_"), ("TBEVENTOS", "acao_sistema", "legado_evento_")]:
            c = self.cols(t, dt)
            self.assertEqual(c["ativo"]["coluna"], "=0", (t, dt))
            self.assertTrue(c["codigo"]["coluna"].startswith("#codigo_derivado:ID:"), (t, dt))
            self.assertTrue(c["codigo"]["coluna"].endswith(":" + pre), (t, dt))
        a = self.cols("TBOPCOES", "acao_sistema")
        self.assertEqual((a["tela_sistema_id"]["coluna"], a["tipo_acao"]["coluna"]), ("@id", "=ver"))
        self.assertEqual(self.cols("TBEVENTOS", "acao_sistema")["tipo_acao"]["coluna"], "=~executar")
        self.assertEqual(self.cols("TBOPCOES", "tela_sistema")["ordem"]["regra"], "inteiro_nao_negativo")

    def test_concessoes_antigas_aguardam_o_motor(self):
        # papel x opção e perfil x opção: a ação de acesso é o destino SECUNDÁRIO da opção (pedido 4)
        for t in ("TBPAPEL_TBOPCOES", "TBPERUSU"):
            self.assertNotIn(t, self.plano, t)
        txt = (mapa.DIR_PACOTE / mapa.COLUNAS_D / "L5-02.tsv").read_text(encoding="utf-8")
        for t in ("TBPAPEL_TBOPCOES", "TBPERUSU"):
            ls = [x for x in txt.splitlines() if x.startswith("#%s\t" % t)]
            self.assertEqual(len(ls), 2, t)
            self.assertTrue(any("ref:TBOPCOES@acao_sistema" in x for x in ls), t)

    def test_papel_entra_com_origem_migracao(self):
        c = self.cols("TBPAPEL", "papel_seguranca")
        self.assertEqual(c["origem"]["coluna"], "=migracao")
        self.assertEqual(set(c), {"codigo", "nome", "origem", "limite_usuarios"})
        # 0 na origem é "sem limite": NULL no destino (CHECK > 0), sem recusar o papel
        self.assertEqual(c["limite_usuarios"]["regra"], "inteiro_zero_nulo")

    def test_codigos_numericos_viram_texto(self):
        # o número da origem vira o código VARCHAR do destino como texto (a soma de controle casa nos dois lados)
        for t, dt, col in [("TBLEITORBIOME", "modelo_leitor_biometrico", "ID"),
                           ("TBLGPDANONMOT", "base_legal_tratamento", "ID"),
                           ("TBLGPDANONUSERFUNCAO", "funcao_responsavel_lgpd", "ID"),
                           ("TBPAPEL", "papel_seguranca", "COD_PAPEL"), ("TBTERMCONREVTP", "tipo_termo_lgpd", "ID")]:
            c = self.cols(t, dt)["codigo"]
            self.assertEqual((c["coluna"], c["regra"]), (col, "texto"), t)

    def test_motivo_grava_descricao_e_explicacao(self):
        c = self.cols("TBLGPDANONMOT", "base_legal_tratamento")
        # o texto integral (até 999) cabe na explicação; a descrição curta (150) é o texto resumido, sem recusar a linha
        self.assertEqual((c["descricao"]["coluna"], c["descricao"]["regra"]), ("DESCRICAO", "texto_resumo:150"))
        self.assertEqual(c["explicacao"]["coluna"], "DESCRICAO")
        self.assertEqual(self.plano["TBLGPDANONMOT"]["lidas"].count("DESCRICAO"), 1)  # lida uma vez, duas colunas
        self.assertTrue(any(len(m[1]) > 150 for m in l5_02.MOTIVOS))

    def test_funcao_nao_cria_encarregado(self):
        self.assertEqual(self.plano["TBLGPDANONUSERFUNCAO"]["destinos"], ["funcao_responsavel_lgpd"])

    def test_tipo_de_termo_entra_com_finalidade_outra(self):
        self.assertEqual(self.cols("TBTERMCONREVTP", "tipo_termo_lgpd")["finalidade"]["coluna"], "=outra")

    def test_mensagem_e_destinatario(self):
        p = self.plano["TBMENSAG"]
        self.assertEqual(p["destinos"], ["mensagem_interna", "mensagem_interna_destinatario"])
        m, d = self.cols("TBMENSAG", "mensagem_interna"), self.cols("TBMENSAG", "mensagem_interna_destinatario")
        self.assertEqual(m["estabelecimento_id"]["coluna"], "@estabelecimento")
        self.assertEqual((m["remetente_usuario_id"]["coluna"], m["situacao"]["coluna"]), ("ORIGEM", "=enviada"))
        self.assertEqual(d["destinatario_usuario_id"]["coluna"], "USUARIO")
        self.assertEqual((d["mensagem_interna_id"]["coluna"], d["sequencia"]["coluna"]), ("@id", "=1"))
        self.assertEqual(d["lida"]["regra"], "preenchido")
        decl = {(c["coluna"], c["destino"]): c for c in self.m["colunas_decl"] if c["tabela"] == "TBMENSAG"}
        self.assertEqual((m["prioridade"]["coluna"], m["prioridade"]["depara"]), ("TIPO", "valores"))
        for col, dest in [("ORIGEM", "mensagem_interna.remetente_usuario_id"),
                          ("USUARIO", "mensagem_interna_destinatario.destinatario_usuario_id")]:
            self.assertIn("ref:TBUSERS", decl[(col, dest)]["via"])

    def valores(self, t, destino):
        return {v["valor_origem"]: v["valor_destino"] for v in self.m["valores"]
                if v["tabela"] == t and v["destino"] == destino}

    def test_nivel_de_criticidade_pelo_nome(self):
        # a severidade sai do NOME do nível, nunca da chave substituta
        c = self.cols("TBNVLCRITICID", "nivel_criticidade_auditoria")
        self.assertEqual((c["severidade"]["coluna"], c["severidade"]["depara"]), ("NOME", "valores"))
        v = self.valores("TBNVLCRITICID", "nivel_criticidade_auditoria.severidade")
        self.assertEqual({int(x) for x in v.values()}, set(range(8)))
        self.assertEqual((v["Emergência"], v["Erro"], v["Depuração"]), ("0", "3", "7"))

    def test_tipo_de_certificado_pelo_nome(self):
        c = self.cols("TBTIPOCERTIFICADO", "tipo_certificado")
        self.assertEqual((c["modalidade"]["coluna"], c["repositorio"]["coluna"]), ("NOME", "NOME"))
        mo = self.valores("TBTIPOCERTIFICADO", "tipo_certificado.modalidade")
        rp = self.valores("TBTIPOCERTIFICADO", "tipo_certificado.repositorio")
        self.assertEqual((mo["A1"], rp["A1"], mo["A3"], mo["Em nuvem"], rp["Em nuvem"]),
                         ("a1", "arquivo", "a3", "nuvem", "nuvem"))
        self.assertEqual(set(mo), set(rp))
        self.assertEqual(self.plano["TBTIPOCERTIFICADO"]["destinos"], ["tipo_certificado"])

    def test_prioridade_da_mensagem(self):
        v = self.valores("TBMENSAG", "mensagem_interna.prioridade")
        self.assertEqual(v, {"U": "urgente", "N": "normal", "S": "normal", "": "normal"})

    def test_permissao_sus_aguarda_o_motor(self):
        # declaração pronta, comentada: o motor ainda não desdobra o destino principal
        self.assertNotIn("TBPERMISSAO_SUS", self.plano)
        txt = (mapa.DIR_PACOTE / mapa.COLUNAS_D / "L5-02.tsv").read_text(encoding="utf-8")
        self.assertEqual(sum(1 for x in txt.splitlines() if x.startswith("#TBPERMISSAO_SUS\t")), 6)

    def test_nenhum_destino_oficial(self):
        por = {r["tabela"]: r for r in self.m["tabelas"]}
        for t in self.plano:
            self.assertEqual(por[t].get("destinos_oficiais") or "", "", t)


class RegrasL502(unittest.TestCase):
    def test_codigo_numerico_como_texto(self):
        self.assertEqual(sentinela.aplicar("texto", 13), ("13", None))

    def test_nome_colapsa_e_vazio_vira_nulo(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "Leitor  óptico   modelo A".encode("cp1252"))[0],
                         "Leitor óptico modelo A")
        self.assertEqual(sentinela.aplicar("texto_nome", b"   "), (None, None))

    def test_texto_preserva_quebra_interna(self):
        v, _ = sentinela.aplicar("texto", b"  Exerc\xedcio regular\r\nem processo  ")
        self.assertEqual(v, "Exercício regular\r\nem processo")

    def test_resumo_da_descricao(self):
        v, pr = sentinela.aplicar("texto_resumo:150", ("palavra " * 40).encode("cp1252"))
        self.assertLessEqual(len(v), 150)
        self.assertEqual(pr, "texto_resumido")

    def test_limite_zero_sem_limite(self):
        self.assertEqual(sentinela.aplicar("inteiro_zero_nulo", 0), (None, None))
        self.assertEqual(sentinela.aplicar("inteiro_zero_nulo", 3), (3, None))

    def test_leitura_preenchida(self):
        import datetime
        self.assertEqual(sentinela.aplicar("preenchido", datetime.datetime(2026, 2, 1, 10, 0)), (True, None))

    def test_sn_minusculo_e_fora_do_dominio(self):
        self.assertEqual(sentinela.aplicar("booleano_sn", b"s"), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", b"X"), (None, "valor_fora_do_dominio"))


class ImagemL502(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l5_02.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), set(l5_02.CARREGADAS))
        for t in l5_02.NAO_CARREGADAS:
            self.assertGreater(cont.get(t, 0), 0, t)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items()
                          if k.startswith("restricao_destino_") or k == "pai_pendente")
            self.assertEqual(e["gravados"] + recusas, cont[t], t)


if __name__ == "__main__":
    unittest.main()
