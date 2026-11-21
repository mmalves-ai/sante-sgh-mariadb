"""Fatia L8-02 (faturamento e restantes, módulo FAT): declarações, plano, de-para de valores e imagem sintética. Sem
banco; só valores inventados. Rodada de cobertura total: 10 tabelas carregadas pelo mapa; descartes e as que
aguardam modelo ou catálogo têm pedido em saida/L8-02.json. A conciliação na imagem SINTÉTICA roda em
`conector.sh conferir-fatia L8-02`."""
import random
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_02

FATIA = tuple(l8_02.FORMAS) + tuple(l8_02.NOVAS_R3)
AGUARDAM = set()  # RPLANRPA passou à L8-05 (dona pelo índice), rodada 4
DESCARTES = {"RPRPA_TBCBOPRO"}
# revisão da rodada 3: bloqueadas em sem_carga.tsv (não descarte) até outra fatia gravar o dado que justificaria o
# descarte (a escolha de cada fonte pagadora; o padrão do tipo de atendimento) ou o pai carregar (item do exame)
# r4: SIREFCON carrega (item pelo procedimento do exame); as listas de opções são descarte de produto
# r4 (revisão adversarial): as listas de opções seguem BLOQUEADAS até a L5-06 declarar a escolha de cada fonte pagadora
LISTAS_OPCOES = {"TBCONSBRASINATIVO", "TBCONSIDCALCVLR", "TBCONVCOBTXPA", "TBCONVCONSMAT", "TBCONVMEDREQATD"}
BLOQUEADAS = set(LISTAS_OPCOES)
LISTAS_SEM_CARGA = LISTAS_OPCOES | {"TBCONVPERCTAPAC", "TBCTRTAT"}
# colunas de TBCONVEN com a escolha da fonte pagadora (L5-06): só com elas declaradas a lista vira descarte
ESCOLHA_TBCONVEN = ("ID_TBCONVMEDREQATD", "ID_TBCONVCOBTXPA", "ID_TBCONVCONSMAT", "ID_TBCONVPERCTAPAC",
                    "ID_TBCONSBRASINATIVO", "ID_TBCONSIDCALCVLR_")
# rodada 3: declaradas aqui (índice da L8-02) e ainda com linhas sem destino em colunas.d/L8-03.tsv até o integrador
# tirá-las de lá (pedido em saida/L8-02.json)
EM_OUTRO_ARQUIVO_PEDIDO = {"TBCOOPER", "TBINDPRO"}


class FatiaL802(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["tabela"] in FATIA and c["_arquivo"].endswith("L8-02.tsv")]
        cls.fora = {c["tabela"] for c in cls.m["colunas_decl"] if c["tabela"] in FATIA
                    and not c["_arquivo"].endswith("L8-02.tsv")}
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def _col(self, t, dest):
        cols = [c for cs in self.plano[t]["colunas"].values() for c in cs]
        return next(c for c in cols if c["destino"] == dest)

    def _via(self, t, dest):
        return next(c["via"] for c in self.decl if c["tabela"] == t and c.get("destino") == dest)

    def test_tabelas_cobertas(self):
        self.assertEqual(set(l8_02.CARREGADAS) | AGUARDAM | DESCARTES | BLOQUEADAS, set(FATIA))
        self.assertLessEqual(self.fora, EM_OUTRO_ARQUIVO_PEDIDO)
        for c in self.decl:
            self.assertTrue(c["motivo"].strip(), (c["tabela"], c["coluna"]))
            if c.get("regra"):
                self.assertTrue(sentinela.regra_conhecida(c["regra"]), c["regra"])
        # descartes não declaram colunas; as que aguardam declaram só colunas sem destino, com o motivo
        self.assertFalse({c["tabela"] for c in self.decl} & (DESCARTES | BLOQUEADAS))
        for c in self.decl:
            if c["tabela"] in AGUARDAM:
                self.assertFalse(c.get("destino"), (c["tabela"], c["coluna"]))
                self.assertRegex(c["motivo"], "pedido|aguarda")

    def test_plano_das_carregadas(self):
        self.assertEqual(set(self.plano), set(l8_02.CARREGADAS))
        for t, dt in [("RPEMPCALCIMP", "empresa_calculo_cumulativo_rpa"), ("RPEVENTO", "evento_repasse"),
                      ("RPINTEVE", "evento_repasse_contabil"), ("RPPARUSUEMP", "competencia_trabalho_usuario"),
                      ("RPRPA", "rpa"), ("SIORCAME", "orcamento_particular"),
                      ("SIEXAORC", "orcamento_particular_item")]:
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_mecanismos_da_cobertura(self):
        self.assertEqual(self._col("RPEMPCALCIMP", "vigencia_inicio")["coluna"], "@vigencia_carga")
        self.assertEqual(self._col("RPEMPCALCIMP", "considerado_estabelecimento_id")["coluna"], "@estabelecimento")
        self.assertEqual(self._via("RPINTEVE", "evento_repasse_contabil.evento_repasse_id"), "ref:RPEVENTO.COD")
        self.assertEqual(self._via("RPINTEVE", "evento_repasse_contabil.natureza_financeira_id"),
                         "ref:TBITEDES(GRUPO,SUBGRUPO,ITEM)")
        self.assertEqual(self._col("RPPARUSUEMP", "competencia")["coluna"], "#data:ANO_PROCESSAMENTO,MES_PROCESSAMENTO")
        self.assertEqual(self._via("RPPARUSUEMP", "competencia_trabalho_usuario.usuario_id"), "ref:TBUSERS")
        self.assertEqual(self._via("RPRPA", "rpa.profissional_id"),
                         "ref:RPRPA_TBCBOPRO>ID_TBCBOPRO>TBCBOPRO>ID_TBPROFIS>TBPROFIS")
        self.assertEqual(self._col("RPRPA", "competencia")["regra"], "data_primeiro_dia_mes")
        self.assertEqual(self._col("RPRPA", "situacao")["coluna"], "STATUS")
        self.assertEqual(self._col("RPRPA", "fato_gerador_em")["regra"], "competencia_aaaamm")
        self.assertEqual(self._via("SIORCAME", "orcamento_particular.paciente_id"), "ref:RICADPAC.PRONT")
        # carimbo de alteração nunca vira data de envio; totais sem fonte são presumidos (pendência por linha)
        self.assertFalse([c for c in self.decl if c.get("destino") == "rpa.enviado_esocial_em"])
        self.assertEqual(self._col("RPRPA", "valor_bruto")["coluna"], "=~0")
        for dc in ("valor_deducoes", "valor_retencoes", "valor_liquido"):
            self.assertEqual(self._col("RPRPA", dc)["coluna"], "=0")
        for dc in ("pessoa_juridica", "retem_irrf", "retem_inss", "categoria"):
            self.assertTrue(self._col("RPTIPOPRESTADOR", dc)["coluna"].startswith("=~"), dc)
        self.assertEqual(self._col("SIORCAME", "numero")["coluna"], "#codigo_derivado:NOME:1")
        self.assertEqual(self._via("SIEXAORC", "orcamento_particular_item.orcamento_particular_id"),
                         "ref:SIORCAME(NOME,ATO)")
        self.assertEqual(self._via("SIEXAORC", "orcamento_particular_item.descricao"), "ref:SITABPRO(ATO,EXAME)>NOME")
        self.assertEqual(self._col("SIEXAORC", "sequencia")["coluna"], "#seq:NOME")
        # referência a tabela: sem regra declarada (o valor é a chave do pai, nunca gravado como id)
        for c in self.decl:
            if c.get("via", "").startswith("ref:") and ">NOME" not in c["via"]:
                self.assertFalse(c.get("regra"), (c["tabela"], c["coluna"]))

    def test_depara_de_valores(self):
        c = self._col("TBCLASSI", "codigo_despesa_tiss")
        self.assertEqual(c["valores"], {"1": "01", "2": "02", "3": "03", "5": "05", "7": "07", "8": "08"})
        self.assertEqual(self._col("RPEVENTO", "natureza")["valores"],
                         {"V": "rendimento", "F": "rendimento", "D": "desconto"})
        self.assertEqual(self._col("RPEVENTO", "tipo_lancamento")["valores"],
                         {"V": "credito", "F": "credito", "D": "debito"})
        self.assertEqual(self._col("RPRPA", "situacao")["valores"], {"G": "emitido"})
        self.assertEqual(self._col("RPRPA", "metodo_envio")["valores"], {"E": "esocial"})

    def test_toda_coluna_da_origem_declarada_nas_carregadas(self):
        decl = {(c["tabela"], c["coluna"]) for c in self.decl}
        for c in self.decl:  # colunas lidas por especiais (#data:ANO,MES, #codigo_derivado:NOME:1, #seq:NOME)
            if c["coluna"][:1] == "#":
                decl |= {(c["tabela"], x) for x in re.split(r"[:,]", c["coluna"][1:]) if re.fullmatch(r"[A-Z0-9_]+", x)}
        for t in l8_02.CARREGADAS:
            cols = [c for c, _ in l8_02.COLS_INTER[t]] if t in l8_02.NOVAS_R3 else [c for c, _, _ in l8_02.COLUNAS[t]]
            falta = [c for c in cols if (t, c) not in decl]
            self.assertFalse(falta, t)

    def test_imagem_sintetica_deterministica_e_esperado(self):
        def gerar():
            saida = []
            esp = l8_02.linhas(random.Random(7), lambda t, v: saida.append((t, tuple(v))))
            return saida, esp
        a, esp = gerar()
        b, _ = gerar()
        self.assertEqual(a, b)
        self.assertEqual(set(esp), set(l8_02.CARREGADAS))
        por = {}
        for t, v in a:
            n = len(l8_02.COLS_INTER[t]) if t in l8_02.DO_DICIONARIO else len(l8_02.COLUNAS[t])
            self.assertEqual(len(v), n, t)
            por[t] = por.get(t, 0) + 1
        self.assertEqual(set(por), set(FATIA) | set(l8_02.INTERMEDIARIAS))
        for t, e in esp.items():
            self.assertLessEqual(e["gravados"], por[t], t)

    def test_esperado_exige_gravacao_e_pais_externos_seguem_a_ordem(self):
        esp = l8_02.esperado()
        for t in l8_02.CARREGADAS:
            self.assertGreater(esp[t]["gravados"], 0, t)
        certa = {"TBUSERS": -1, "RICADPAC": -1, "TBPROFIS": 1, "TBCONVEN": 1, "TBITEDES": 1, "RPEVENTO": 2,
                 "RPINTEVE": 3, "RPRPA": 3, "SIORCAME": 3, "SIEXAORC": 4, "RPPARUSUEMP": 3}
        self.assertEqual(l8_02.dependencias_fora_de_ordem(certa), [])
        errada = dict(certa, TBPROFIS=9, RPEVENTO=9)
        self.assertEqual(l8_02.dependencias_fora_de_ordem(errada), [("RPINTEVE", "RPEVENTO"), ("RPRPA", "TBPROFIS")])
        fora = {p for _, p in l8_02.dependencias_fora_de_ordem()}
        self.assertFalse(fora & set(l8_02.PAIS_EXTERNOS))

    def test_rodada3_cooperativa_indice_porte_e_equivalencia(self):
        # cooperativa: pessoa jurídica gravada ANTES e adotada pelo CNPJ; o principal liga pelo @id
        self.assertEqual(self.plano["TBCOOPER"]["destinos"][0], "cooperativa_medica")
        self.assertIn("pessoa_juridica", self.plano["TBCOOPER"]["destinos"])
        self.assertEqual(self._via("TBCOOPER", "pessoa_juridica.cnpj"), "pessoa_juridica;antes;adotar:cnpj")
        self.assertEqual(self._col("TBCOOPER", "pessoa_juridica_id")["coluna"], "@id:pessoa_juridica")
        self.assertEqual(self._col("TBCOOPER", "municipio_ibge_id")["depara"], "ibge_municipio")
        self.assertEqual(self._col("TBCOOPER", "banco_id")["depara"], "banco")
        self.assertEqual(self._col("TBCOOPER", "tipo_conta_bancaria")["valores"], {"C": "corrente", "P": "poupanca"})
        # índice por procedimento: fonte e item faturável (principal de TBPROCTO) pela chave
        self.assertEqual(self._via("TBINDPRO", "valor_indice_item.item_faturavel_id"), "ref:TBPROCTO.COD_PROCEDIMENTO")
        self.assertEqual(self._via("TBINDPRO", "valor_indice_item.fonte_pagadora_id"), "ref:TBCONVEN")
        # porte anestésico: data DATE em DATETIME (tipar) e retrato completo da linha no JSON
        self.assertEqual(self._col("FCPORANE", "ocorrido_em")["coluna"], "DATA_PORTE")
        self.assertEqual(self._col("FCPORANE", "dados")["coluna"], "#retrato:*")
        self.assertFalse([c for c in self.decl if c.get("destino", "").startswith(
            ("valor_porte_anestesico.porte_procedimento_id", "valor_porte_anestesico.quantidade_porte"))])
        # percentuais de repasse por tipo: não é descarte, aguarda modelo (pedido)
        for c in self.decl:
            if c["tabela"] == "TBCOOPER" and c["coluna"].startswith("P_R_"):
                self.assertRegex(c["motivo"], "aguarda modelo")
                self.assertNotRegex(c["motivo"], "TBREPGER, L8-06")

    def test_revisao_r3_bloqueadas_e_nao_descarte(self):
        from pathlib import Path
        base = Path(l8_02._MAPA) / "declarado"
        sc = {r["tabela"]: r for r in mapa.ler_tsv(base / "sem_carga.tsv")}
        # r4 (revisão): a lista só é descarte (domínio do produto) quando a escolha de cada fonte pagadora (colunas
        # ID_TBCONS*/ID_TBCONV* de TBCONVEN, L5-06, pedido 19) está declarada com destino; antes, bloqueada e visível
        escolha = [c for c in self.m["colunas_decl"] if c["tabela"] == "TBCONVEN" and c["destino"]
                   and c["coluna"].replace("#item@", "").startswith(ESCOLHA_TBCONVEN)]
        for t in LISTAS_SEM_CARGA - {"TBCTRTAT"}:
            if escolha:
                self.assertEqual(sc[t]["situacao"], "descarte", t)
            else:
                self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("bloqueada", "depende_declaracao_L5-06:TBCONVEN"), t)
        self.assertEqual((sc["TBCTRTAT"]["situacao"], sc["TBCTRTAT"]["causa"]), ("descarte", "mecanismo_do_produto"))
        # r4: SIREFCON carrega: item faturável pelo procedimento do exame (não depende de exame.item_faturavel_id)
        self.assertNotIn("SIREFCON", sc)
        self.assertIn("SIREFCON", self.plano)
        texto = (base / "colunas.d" / "L8-02.tsv").read_text(encoding="utf-8")
        self.assertIn("SIREFCON\tEXAME\tequivalencia_item_fonte_pagadora.item_faturavel_id\t\t\t"
                      "ref:SITABPRO(ATO,EXAME)>CODAMB>TBPROCTO.COD_PROCEDIMENTO>min:ID", texto)
        self.assertNotIn("ITEM_DO_EXAME", vars(l8_02))

    def test_rodada3_dependencias_fora_de_ordem_tem_pedido(self):
        import json
        from pathlib import Path
        p = Path(mapa.DIR_PACOTE).parents[1] / "docs/obra/fatias/f4/saida/L8-02.json"
        if not p.exists():  # no container só o conector é montado
            self.skipTest("docs fora do container")
        texto = p.read_text(encoding="utf-8")
        json.loads(texto)
        o = l8_02._ordem()
        for filho, pai in l8_02.DEPENDENCIAS_PEDIDAS_R3:
            if o.get(pai, 10 ** 9) >= o.get(filho, 0):
                self.assertIn("%s -> %s" % (filho, pai), texto)


if __name__ == "__main__":
    unittest.main()
