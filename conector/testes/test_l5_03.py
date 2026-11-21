"""Fatia L5-03 (cadastros e administração): declarações planejadas, regras das colunas, descartes e coerência da imagem
sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L5-03`."""
import csv
import datetime
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_03

TABELAS = {"TBOID", "TBTPMINISTCER", "TBTPACAOAUDIT", "TBALERTA"} | set(l5_03.TABELAS)
DESCARTES = {"TBTPPERM_RICADPAC": "mecanismo_do_produto", "TBHISTSENHA": "sem_valor"}
NA_IMAGEM = TABELAS | set(l5_03.CADEIA)


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, NA_IMAGEM)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_todas_as_tabelas_da_fatia_carregam(self):
        self.assertTrue(TABELAS <= set(self.plano), sorted(TABELAS - set(self.plano)))

    def test_destinos(self):
        d = {t: self.plano[t]["destinos"] for t in TABELAS}
        self.assertEqual(d["TBUSUCPL"], ["usuario_vinculo_profissional"])
        self.assertEqual(d["TBUSERCON"], d["TBUSERS_TBCONVEN"])
        self.assertEqual(d["CCCADCIR_EXCLUSAO"], ["registro_excluido"])
        self.assertEqual(d["TBLANTRILHASGH"], ["evento_auditoria_registro"])

    def test_descartes_com_causa_de_produto(self):
        with open(mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv", encoding="utf-8") as f:
            sc = {r["tabela"]: r for r in csv.DictReader(f, delimiter="\t")}
        for t, causa in DESCARTES.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa))
            self.assertNotIn(t, self.mapa_decl())

    def mapa_decl(self):
        return {c["tabela"] for c in self.mapa["colunas_decl"]}

    def test_login_pela_chave_do_usuario(self):
        for t, col in [("TBUNIUSE", "usuario_unidade"), ("TBUSERCON", "usuario_fonte_pagadora"),
                       ("TBUSERS_TBPAPEL", "usuario_papel_seguranca"), ("TBLOCAL_TBUSERS", "usuario_local_atendimento"),
                       ("TBCABTRILHA", "evento_auditoria"), ("TBUSUCPL", "usuario_vinculo_profissional")]:
            self.assertEqual(self.cols(t, col)["usuario_id"]["referencia"], "TBUSERS", t)

    def test_adocao_sem_duplicar(self):
        self.assertEqual(self.plano["TBUSERS_TBCONVEN"]["opcoes"]["usuario_fonte_pagadora"]["adotar"],
                         ["usuario_id", "fonte_pagadora_id"])
        self.assertEqual(self.plano["TBUSERSCOMPL"]["opcoes"]["preferencia_usuario"]["adotar"], ["usuario_id"])
        # mesmo usuário e papel em outra ocupação: consolidado por adoção, nunca recusado pelo UNIQUE
        self.assertEqual(self.plano["TBUSERS_TBPAPEL"]["opcoes"]["usuario_papel_seguranca"]["adotar"],
                         ["usuario_id", "papel_seguranca_id"])

    def test_presuncoes_marcadas(self):
        for t, dt, dc in [("PRJUSTIF_IMP_EXPORTACAO", "exportacao_documento", "tipo_operacao"),
                          ("PRJUSTIF_IMP_EXPORTACAO", "exportacao_documento", "formato"),
                          ("TBLANTRILHASGH", "evento_auditoria_registro", "operacao"),
                          ("CCCADCIR_EXCLUSAO", "registro_excluido", "justificativa"),
                          ("SIPACAGD_EXCLUSAO", "registro_excluido", "justificativa")]:
            self.assertTrue(self.cols(t, dt)[dc]["coluna"].startswith("=~"), (t, dc))

    def test_documento_exportado_tipo_e_id(self):
        e = self.cols("PRJUSTIF_IMP_EXPORTACAO", "exportacao_documento")
        self.assertEqual(e["entidade_id"]["coluna"], "ID_TABELA")
        self.assertTrue(e["entidade"]["coluna"].startswith("#codigo_derivado:ID_PRTPASSINATURA:"))
        self.assertTrue({"ID_TABELA", "ID_PRTPASSINATURA"} <= set(self.plano["PRJUSTIF_IMP_EXPORTACAO"]["retrato"]))
        self.assertEqual(carga_mapa.codigo_derivado("2", 64, "doc_anterior_tipo_"),
                         ("doc_anterior_tipo_2", False))

    def test_cadeias(self):
        c = self.cols("TBUSERS_TBPAPEL", "usuario_papel_seguranca")["ocupacao_cbo_id"]
        self.assertEqual((c["depara"], [p.get("tabela") or p.get("coluna") for p in c["passos"]]),
                         ("cbo", ["TBCBOPRO", "ID_TBCBOSUS", "TBCBOSUS", "COD"]))
        e = self.cols("PRJUSTIF_IMP_EXPORTACAO", "exportacao_documento")["usuario_id"]
        self.assertEqual((e["passos"][0]["modo"], e["passos"][0]["arg"]), ("alt", "ID_TBCBOPRO"))
        self.assertEqual(self.cols("TBCABTRILHA", "evento_auditoria")["paciente_id"]["passos"][-1]["tabela"], "RICADPAC")
        self.assertEqual(self.cols("TBUSUCPL", "usuario_vinculo_profissional")["profissional_id"]["passos"][-1]["tabela"],
                         "TBPROFIS")

    def test_sequencia_por_pai(self):
        for t, dt in [("TBALERTA_TBOPCOES_TBEVENTOS", "alerta_gatilho"), ("TBLANTRALERTA", "evento_auditoria_alerta"),
                      ("TBLANTRILHASGH", "evento_auditoria_registro")]:
            self.assertTrue(self.cols(t, dt)["sequencia"]["coluna"].startswith("#seq:ID_TB"), t)

    def test_alerta_sexo_repeticao_e_faixa(self):
        a = self.cols("TBALERTA", "regra_alerta")
        self.assertEqual(a["sexo_aplicavel"]["valores"], {"F": "feminino", "M": "masculino"})
        self.assertEqual(a["repeticao"]["coluna"], "=~sempre")
        self.assertEqual(a["idade_maxima_anos"]["regra"], "inteiro_zero_nulo")
        self.assertEqual(a["mensagem"]["regra"], "texto_resumo:1000")

    def test_papel_inativo_termina_na_carga(self):
        v = self.cols("TBUSERS_TBPAPEL", "usuario_papel_seguranca")["vigencia_fim"]["valores"]
        self.assertEqual((v.get("0"), v.get("1")), ("@data_carga", ""))

    def test_segredo_e_indicadores_nunca_lidos(self):
        lidas = set(self.plano["TBUSUCPL"]["lidas"])
        self.assertFalse({"SENHA_SEC", "SENHA_CAN_NF"} & lidas)
        self.assertEqual(lidas, {"EMPRESA", "USUARIO", "ID_TBCBOPRO"})

    def test_tipo_acao_auditavel_uma_so_alimentadora(self):
        outras = sorted({c["tabela"] for c in self.mapa["colunas_decl"]
                         if (c.get("destino") or "").startswith("tipo_acao_auditavel.")} - {"TBTPACAOAUDIT"})
        self.assertEqual(outras, [], "combinar o espaço de código de tipo_acao_auditavel (L5-03.json)")


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Alerta   nove ".encode("cp1252")), ("Alerta nove", None))
        self.assertEqual(a("texto", b"  Atributo\r\ncom quebra  "), ("Atributo\r\ncom quebra", None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(a("inteiro_zero_nulo", 0), (None, None))
        self.assertEqual(a("texto_resumo:1000", ("palavra " * 150).encode("cp1252"))[1], "texto_resumido")


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l5_03.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_ddl_da_fatia_e_das_cadeias(self):
        criadas = {l.split()[2] for l in l5_03.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, NA_IMAGEM | {"TBCBOSUS"})

    def test_dados_falsos(self):
        vals = []
        l5_03.linhas(random.Random(1), lambda t, v: vals.extend(x for x in v if isinstance(x, str)))
        logins = {x for x in vals if x.startswith("USR.")}
        self.assertTrue(logins <= {l5_03.A, l5_03.B, l5_03.C, l5_03.D, l5_03.Z})


if __name__ == "__main__":
    unittest.main()
