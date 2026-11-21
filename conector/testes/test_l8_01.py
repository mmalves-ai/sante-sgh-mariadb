"""Fatia L8-01 (faturamento e restantes, módulo FAT), rodada de cobertura total: declarações, plano da carga dirigida
pelo mapa, descartes e regras das colunas. Sem banco; só valores inventados (a conciliação na imagem SINTÉTICA roda em
`conector.sh conferir-fatia L8-01`)."""
import csv
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_01

FATIA = list(l8_01.FATIA)
CARREGADAS = {"FCTPMOTGLOSA": "grupo_motivo_glosa", "RPDEDUTIVEL": "tipo_deducao_irrf",
              "FAPARUSU": "competencia_trabalho_usuario", "FCPARUSU": "competencia_trabalho_usuario",
              "FIPARUSU": "competencia_trabalho_usuario", "FCCODCON": "codigo_prestador_fonte_pagadora",
              "FCCPSCON": "codigo_prestador_fonte_pagadora",
              "FCFECMES": "fechamento_competencia_fonte_pagadora", "FCORCAME": "orcamento_particular"}
DESCARTES = {"FCEMPAUDPLANSERV": "sem_valor", "FCPROCUNIBHMED": "sem_valor", "FCREFUND": "licenciado",
             "FCTPPGTONFSE": "mecanismo_do_produto", "RECONTAS": "duplicado"}
BLOQUEADAS = {"FCHORATE", "FCGUIAS", "FCORCPAD", "FCORLAME", "FCPORANE", "RICGUIAS", "FCCRECUN", "FCDIAEXT",
              "FCDIAINT"}
PROF = "TBCBOPRO>ID_TBPROFIS>TBPROFIS"


def _decl():
    with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L8-01.tsv", encoding="utf-8") as f:
        return list(f)


def _sem_carga():
    with open(mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv", encoding="utf-8") as f:
        return {r["tabela"]: r for r in csv.DictReader(f, delimiter="\t")}


class L801(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][CARREGADAS[t]]}

    def test_fatia_inteira_classificada(self):
        self.assertEqual(len(FATIA), 23)
        self.assertEqual(set(CARREGADAS) | set(DESCARTES) | BLOQUEADAS, set(FATIA))
        self.assertFalse(set(CARREGADAS) & set(DESCARTES) or set(CARREGADAS) & BLOQUEADAS
                         or set(DESCARTES) & BLOQUEADAS)

    def test_so_as_carregaveis_entram_com_o_destino_certo(self):
        self.assertEqual(set(self.plano), set(CARREGADAS))
        for t, dt in CARREGADAS.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_descartes_com_causa_de_produto_e_motivo(self):
        sc = _sem_carga()
        for t, causa in DESCARTES.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(sc[t]["motivo"].startswith("L8-01: "), t)
        self.assertEqual(sc["FCREFUND"]["causa"], "licenciado")  # regra 7: mat/med comercial nunca entra

    def test_bloqueadas_tem_motivo_e_pedido(self):
        linhas = _decl()
        for t in BLOQUEADAS:
            self.assertTrue(any(l.startswith("#--- %s: bloqueada: " % t) and "L8-01.json" in l for l in linhas), t)

    def test_competencia_por_modulo_e_ano_mes(self):
        for t, mod in (("FAPARUSU", "sus_ambulatorial"), ("FCPARUSU", "fonte_pagadora"),
                       ("FIPARUSU", "sus_internacao")):
            c = self.cols(t)
            self.assertEqual(c["modulo"]["coluna"], "=" + mod, t)
            self.assertEqual(c["competencia"]["coluna"], "#data:ANOPRO,MESPRO", t)
            self.assertEqual((c["usuario_id"]["coluna"], c["usuario_id"]["referencia"]), ("USUARIO", "TBUSERS"), t)
            self.assertEqual(c["usuario_id"]["regra"], "chave_origem", t)  # regra declarada desligaria a ref
            self.assertEqual(c["estabelecimento_id"]["coluna"], "@estabelecimento", t)
        # preferências soltas do faturista não vão para a competência
        self.assertEqual({x["coluna"] for x in self.cols("FCPARUSU").values()},
                         {"@estabelecimento", "USUARIO", "=fonte_pagadora", "#data:ANOPRO,MESPRO"})

    def test_codigo_no_convenio(self):
        c = self.cols("FCCODCON")
        self.assertEqual(c["tipo_prestador"]["coluna"], "=profissional")
        self.assertEqual(c["profissional_id"]["referencia"], PROF)
        self.assertEqual(c["fonte_pagadora_id"]["referencia"], "TBCONVEN")
        self.assertEqual(c["fonte_pagadora_id"]["regra"], "chave_origem")  # regra declarada desligaria a ref
        self.assertEqual(c["vigencia_inicio"]["coluna"], "@vigencia_carga")
        self.assertEqual(c["valor_consulta"]["regra"], "decimal_nao_negativo")
        h = self.cols("FCCPSCON")
        self.assertEqual(h["tipo_prestador"]["coluna"], "=~estabelecimento")
        self.assertNotIn("profissional_id", h)

    def test_repetidos_adotam_sem_sobrescrever(self):
        op = {t: self.plano[t]["opcoes"] for t in ("FAPARUSU", "FCPARUSU", "FCCPSCON")}
        for t in ("FAPARUSU", "FCPARUSU"):
            self.assertEqual(op[t]["competencia_trabalho_usuario"]["adotar"], ["usuario_id", "modulo"], t)
        self.assertEqual(op["FCCPSCON"]["codigo_prestador_fonte_pagadora"]["adotar"],
                         ["estabelecimento_id", "fonte_pagadora_id", "tipo_prestador"])

    def test_bloqueadas_nao_entram_no_plano(self):
        # tipo de conta sem id (NULO = todos os tipos) e conta por chave alternativa composta: nada gravado
        for t in ("FCCRECUN", "FCDIAEXT", "FCDIAINT"):
            self.assertNotIn(t, self.plano, t)

    def test_fechamento_e_orcamento(self):
        f = self.cols("FCFECMES")
        self.assertEqual(f["competencia"]["coluna"], "#data:ANO,MES")
        self.assertEqual(f["data_abertura"]["coluna"], "#data:ANO,MES")
        self.assertEqual((f["situacao"]["coluna"], f["fechado_em"]["regra"]), ("=fechada", "data_hora"))
        o = self.cols("FCORCAME")
        self.assertEqual(o["paciente_id"]["referencia"], "RICADPAC.PRONT")
        self.assertEqual((o["validade_ate"]["coluna"], o["data_orcamento"]["coluna"]), ("DATA", "DATA"))
        self.assertEqual(o["cpf_interessado"]["regra"], "cpf")
        self.assertEqual(o["situacao"]["coluna"], "=~emitido")
        self.assertEqual((o["forma_pagamento"]["coluna"], o["forma_pagamento"]["depara"]), ("PARCELADO", "valores"))
        with open(mapa.DIR_PACOTE / "declarado" / "valores.d" / "L8-01.tsv", encoding="utf-8") as f:
            pares = {r["valor_origem"]: r["valor_destino"] for r in csv.DictReader(f, delimiter="\t")}
        self.assertEqual(pares, {"S": "parcelado", "s": "parcelado", "N": "a_vista", "n": "a_vista"})

    def test_codigos_e_descricoes(self):
        g = self.cols("FCTPMOTGLOSA")
        self.assertEqual((g["codigo"]["coluna"], g["codigo"]["regra"]), ("ID", "inteiro"))
        self.assertNotIn("codigo_tiss", g)  # sem evidência do domínio: nada presumido
        d = self.cols("RPDEDUTIVEL")
        self.assertEqual(d["natureza"]["coluna"], "=~outra")
        self.assertEqual(carga_mapa.tipar(sentinela.aplicar("inteiro", 7)[0], "varchar"), "7")

    def test_regras_das_colunas(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "  Guia   exemplo  ")[0], "Guia exemplo")
        self.assertIsNone(sentinela.aplicar("texto_nome", "   ")[0])
        self.assertEqual(carga_mapa.data_composta(2026, 13), (None, "valor_fora_do_dominio"))
        self.assertEqual(carga_mapa.data_composta(None, None), (None, None))
        self.assertEqual(sentinela.aplicar("cpf", 12345678900), (None, "documento_invalido"))
        self.assertEqual(sentinela.aplicar("decimal_nao_negativo", -5)[1], "valor_fora_do_dominio")

    def test_declaracoes_com_motivo_e_so_da_fatia(self):
        rows = [r for r in csv.DictReader(_decl(), delimiter="\t") if not r["tabela"].startswith("#")]
        for r in rows:
            self.assertIn(r["tabela"], CARREGADAS)
            self.assertTrue(r["motivo"].startswith("L8-01: "))

    def test_imagem_sintetica_cobre_as_carregadas(self):
        lidas = []
        esp = l8_01.linhas(random.Random(1), lambda t, v: lidas.append(t))
        self.assertEqual(set(esp), set(CARREGADAS))
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items() if r.startswith("restricao_destino_"))
            self.assertEqual(e["gravados"] + recusas, lidas.count(t), t)
        self.assertTrue(set(l8_01.PAIS_EXTERNOS) >= {"TBCONVEN", "TBUSERS", "TBPROFIS", "FCCTAEXT", "RICONTAS"})


if __name__ == "__main__":
    unittest.main()
