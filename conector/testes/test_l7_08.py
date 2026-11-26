"""Fatia L7-08 (SADT e suprimentos, módulo SUP): declarações, plano e imagem sintética. Sem banco; só valores
inventados. Rodada 3 de cobertura: 23 tabelas declaradas (GEANTIMI incluída), GEPARAM e GEQTDELOTEVALLOTEDOCSAIDA
descartadas. A conciliação na imagem SINTÉTICA roda em
`conector.sh conferir-fatia L7-08`."""
import random
import pathlib
import unittest

from sante_conector import carga_mapa, mapa
from sante_conector.sintetica_d import l7_08

FATIA = tuple(l7_08.FORMAS)


class FatiaL708(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["tabela"] in FATIA]
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def _d(self, t, col, destino=None):
        return [c for c in self.decl if c["tabela"] == t and c["coluna"] == col
                and (destino is None or c.get("destino") == destino)]

    def test_fatia_tem_as_25_tabelas_e_particao(self):
        self.assertEqual(len(FATIA), 25)
        partes = set(l7_08.CARREGADAS) | set(l7_08.BLOQUEADAS) | set(l7_08.DESCARTADAS)
        self.assertEqual(partes, set(FATIA))
        self.assertEqual(len(l7_08.CARREGADAS) + len(l7_08.BLOQUEADAS) + len(l7_08.DESCARTADAS), 25)

    def test_declaradas_e_plano(self):
        com_destino = {c["tabela"] for c in self.decl if c.get("destino")}
        self.assertEqual(com_destino, set(l7_08.CARREGADAS))
        self.assertEqual(set(self.plano), set(l7_08.CARREGADAS))
        self.assertTrue(all(c.get("_arquivo", "").endswith("L7-08.tsv") for c in self.decl))
        for c in self.decl:
            self.assertTrue(c["motivo"].strip(), c["coluna"])

    def test_referencia_simples_usa_a_chave_do_pai(self):
        # regra declarada diferente de chave_origem numa ref:T simples gravaria o código cru como id
        for c in self.decl:
            via = [x for x in (c.get("via") or "").split(";") if x.startswith("ref:")]
            if via and mapa.ref_simples(via[0][4:]):
                self.assertIn(c["regra"], ("", "chave_origem"), (c["tabela"], c["coluna"]))

    def test_documento_de_estoque(self):
        nums = {t: self._d(t, c)[0] for t in ("GECADSAI", "GECADDEV") for c in
                [x["coluna"] for x in self.decl if x["tabela"] == t and x.get("destino") == "documento_estoque.numero"]}
        prefixos = {t: c["coluna"].split(":")[-1] for t, c in nums.items()}
        self.assertEqual(len(set(prefixos.values())), 2, prefixos)  # números não colidem entre saída e devolução
        for t in ("GECADSAI", "GECADDEV"):
            mov = [c for c in self.decl if c["tabela"] == t and c.get("destino") == "documento_estoque.movimentado_em"]
            # inclusão; sem ela, a data do documento à meia-noite (colunas concorrentes, nessa ordem; tipar)
            self.assertEqual([(c["coluna"], c["regra"]) for c in mov], [("DATA_HORA_INCLUSAO", "data_hora"),
                                                                         ("DATA", "data")])
        # tipo da saída pelo destino (de-para), nunca presumido; atendimento pelo atendimento ou pela internação (PAC)
        tipo = [c for c in self.decl if c["tabela"] == "GECADSAI" and c.get("destino") == "documento_estoque.tipo"]
        self.assertEqual([(c["coluna"], c["depara"]) for c in tipo], [("DEST", "valores")])
        at = [c for c in self.decl if c["tabela"] == "GECADSAI" and c.get("destino") == "documento_estoque.atendimento_id"]
        self.assertEqual([(c["coluna"], c["via"]) for c in at],
                         [("PAC", "ref:RICADINT>ID_ATCABECATEND>ATCABECATEND"), ("CONTA", "ref:RECADATE")])
        self.assertTrue(self._d("GECADDEV", "=devolucao_interna", "documento_estoque.tipo"))

    def test_complementos(self):
        for t, col, dt in [("GEINFVENEXT", "ID_GECADSAI", "documento_estoque.id"),
                           ("PRINTEGRACAOESTOQUE", "ID_PRCHKGERAL", "horario_administracao.id")]:
            c = self._d(t, col, dt)
            self.assertEqual(len(c), 1, t)
            self.assertIn("complementa", c[0]["via"].split(";"))

    def test_toda_coluna_da_origem_declarada(self):
        # coluna omitida sem declaração some em silêncio: cada coluna fora da chave é carregada ou tem motivo
        chaves = {t: set(ch.split(",")) for t, (ch, _) in l7_08.FORMAS.items()}
        for t in l7_08.CARREGADAS:
            usadas = set()
            for c in self.decl:
                if c["tabela"] != t:
                    continue
                n = c["coluna"]
                usadas.add(n.split(":")[1] if n.startswith("#") and ":" in n else n)
                if n.startswith("#item@"):
                    usadas.add(n[6:])
                for op in (c.get("via") or "").split(";"):  # r6: colunas desdobradas (uma linha por coluna)
                    if op.startswith("desdobrar:"):
                        usadas |= {x.split("=")[0] for x in op[10:].split(",")}
            faltam = {c for c, _, _ in l7_08.COLUNAS[t]} - chaves[t] - usadas
            self.assertFalse(faltam, (t, sorted(faltam)))

    def test_centro_de_custo_pelo_codigo(self):
        # recusas fase 2 (A07): ID_TBCENCUS casa pela chave do pai (COD), não pela coluna ID (66 de 66 pelo COD)
        vias = {(t, c["destino"]): c["via"] for t in ("GEUSERS_TBCENCUS", "PRPARINTEGEST")
                for c in self._d(t, "ID_TBCENCUS")}
        self.assertEqual(vias, {
            ("GEUSERS_TBCENCUS", "usuario_estoque_centro_custo.centro_custo_id"): "ref:TBCENCUS",
            ("PRPARINTEGEST", "regra_integracao_prescricao.centro_custo_id"): "ref:TBCENCUS",
            ("PRPARINTEGEST", "regra_integracao_prescricao.atendente_local_estoque_id"): "ref:TBCENCUS>LOCARM>GELOCARM"})
        for t in ("GECADSAI", "GECADDEV"):
            self.assertEqual(self._d(t, "CDC")[0]["via"], "ref:TBCENCUS")

    def test_documento_usuarios_e_situacao(self):
        for t in ("GECADSAI", "GECADDEV"):
            self.assertEqual(self._d(t, "USUARIO")[0]["destino"], "documento_estoque.criado_por")
            self.assertEqual(self._d(t, "USU_CONS")[0]["destino"], "documento_estoque.concluido_usuario_id")
            sit = self._d(t, "CONSOL", "documento_estoque.situacao")
            self.assertEqual(sit[0]["depara"], "valores")
            self.assertFalse(self._d(t, "=concluido"))

    def test_sem_duas_fontes_na_mesma_coluna_e_saldo_vigente_fora(self):
        # r6: a quantidade líquida vai à coluna própria do lote da saída (complementa), nunca à bruta
        q = {c["destino"] for c in self.decl if c["tabela"] == "GEQTDELOTEVALLOTEDOCSAIDA" and c.get("destino")}
        self.assertEqual(q, {"movimento_lote.id", "movimento_lote.quantidade_liquida"})
        self.assertFalse([c for c in self.decl if c.get("destino") == "inventario_estoque_lote.saldo_sistema"])
        self.assertNotIn("GEQTDELOTEVALLOTEDOCSAIDA", l7_08.BLOQUEADAS)
        self.assertEqual(l7_08.DESCARTADAS, ())

    def test_regra_presumida_entra_inativa(self):
        self.assertTrue(self._d("PRPARINTEGEST", "=0", "regra_integracao_prescricao.ativo"))

    def test_presumidos_e_vigencia(self):
        pres = [c["coluna"] for c in self.decl if c["tabela"] == "PRPARINTEGEST" and c["coluna"].startswith("=~")]
        self.assertEqual(len(pres), 3)
        # tipo e momento pelo código da origem (de-para); o presumido é só a reserva, declarada depois
        for col, dc in [("TP_INTEGRACAO", "tipo_integracao"), ("MOMENTO_INTEGRACAO", "momento_integracao")]:
            fontes = [c for c in self.decl if c["tabela"] == "PRPARINTEGEST" and
                      c.get("destino") == "regra_integracao_prescricao." + dc]
            self.assertEqual(fontes[0]["coluna"], col)
            self.assertEqual(fontes[0]["depara"], "valores")
            self.assertTrue(fontes[1]["coluna"].startswith("=~"))
        self.assertTrue(self._d("GEUSERS_TBCENCUS", "@vigencia_carga", "usuario_estoque_centro_custo.vigencia_inicio"))

    def test_pais_externos_de_fora_da_fatia(self):
        self.assertFalse(set(l7_08.PAIS_EXTERNOS) & set(FATIA))

    def test_imagem_sintetica_deterministica_e_esperado(self):
        def gerar():
            saida = []
            esp = l7_08.linhas(random.Random(7), lambda t, v: saida.append((t, tuple(v))))
            return saida, esp
        a, esp = gerar()
        b, _ = gerar()
        self.assertEqual(a, b)
        self.assertEqual(set(esp), set(l7_08.CARREGADAS))
        por = {}
        for t, v in a:
            cols = l7_08.COLUNAS[t] if t in l7_08.COLUNAS else l7_08.ORIGEM_PAIS[t][1]
            self.assertEqual(len(v), len(cols), t)
            por[t] = por.get(t, 0) + 1
        self.assertEqual(set(por), set(FATIA) | set(l7_08.ORIGEM_PAIS))
        self.assertFalse(set(l7_08.ORIGEM_PAIS) & set(FATIA))
        self.assertLessEqual(set(l7_08.ORIGEM_PAIS), set(l7_08.PAIS_EXTERNOS))
        cols = [c for c, _, _ in l7_08.COLUNAS["GEANTIMI"]]
        self.assertEqual(len([v for t, v in a if t == "GEANTIMI" and v[cols.index("DATA_INT")] is not None]), 1)
        self.assertIn("PRIMARY KEY (ANO,MES,DOC,SEQ,ITEM)", l7_08.DDL)


    def test_rodada3_movimentos_requisicao_dispensacao(self):
        doc = "ref:GECADSAI.(ANO,MES,DOC)=(ANO,MES,DOC)"
        # movimento de saída e item do documento ligados ao documento pela chave alternativa composta
        self.assertEqual(self._d("GELANSAI", "DOC", "movimento_estoque.documento_estoque_id")[0]["via"], doc)
        self.assertEqual(self.plano["GELANSAI"]["destinos"][0], "movimento_estoque")
        self.assertIn("documento_estoque_item", self.plano["GELANSAI"]["destinos"])
        self.assertTrue(self._d("GELANSAI", "@id", "documento_estoque_item.movimento_estoque_id"))
        # tipo de movimento: semente nativa de migração pelo código (nunca presumido)
        for t, v in [("GELANSAI", "=migracao_saida"), ("GELANDEV", "=migracao_entrada")]:
            c = self._d(t, v, "movimento_estoque.tipo_movimento_estoque_id")
            self.assertEqual(c[0]["via"], "cod:tipo_movimento_estoque.codigo", t)
        # momento: o do item, depois o do documento, depois a data do documento (colunas concorrentes, nessa ordem)
        oc = [c["coluna"] for c in self.decl if c["tabela"] == "GELANSAI" and c.get("destino") ==
              "movimento_estoque.ocorrido_em"]
        self.assertEqual(oc, ["DATA_HORA_INCLUSAO", "MES", "SEQ"])
        # lote da devolução pelo movimento SECUNDÁRIO de GELANDEV
        self.assertEqual(self._d("GERASVALDEVLOTE", "ID_GELANDEV")[0]["via"], "ref:GELANDEV/movimento_estoque")
        # requisição: cabeçalho agrupado por documento; setor funcional agrupado por local de consumo
        self.assertIn("agrupar:ANO,MES,DOC", self._d("GELANSAIREQ", "@estabelecimento")[0]["via"].split(";"))
        self.assertIn("agrupar:LOC_CONS", self._d("GECADDISPENSACAO", "LOC_CONS", "setor_funcional.codigo")[0]
                      ["via"].split(";"))
        self.assertTrue(self._d("GECADDISPENSACAO", "@id:setor_funcional", "dispensacao.setor_funcional_id"))
        # entrega ao setor acha o setor pelo código do local de consumo do documento
        self.assertIn("cod:setor_funcional.codigo",
                      self._d("GECTRLENTREGADOCSAIDA", "ID_GECADSAI", "entrega_setor.setor_funcional_id")[0]["via"])
        # r6: nenhuma bloqueada (regra 23): GEPARAM em parametro_valor do usuário pela semente estoque.* (11_SUP/09)
        self.assertEqual(l7_08.BLOQUEADAS, ())
        pv = self._d("GEPARAM", "#item", "parametro_valor.valor")[0]["via"]
        self.assertIn("desdobrar:", pv)
        self.assertIn("cod:parametro_definicao.chave",
                      self._d("GEPARAM", "#rotulo", "parametro_valor.parametro_definicao_id")[0]["via"])
        self.assertEqual(self._d("GEPARAM", "#item@CONS_AUT", "parametro_valor.valor")[0]["depara"], "valores")
        semente = next(r / "db/migracoes/11_SUP/09_chaves.sql" for r in pathlib.Path(__file__).resolve().parents
                       if (r / "db/migracoes/11_SUP/09_chaves.sql").exists()).read_text("utf-8")
        for rot in [x.split("=")[1] for x in pv.split("desdobrar:")[1].split(";")[0].split(",")]:
            self.assertIn("'" + rot + "'", semente)  # toda opção tem definição na semente
        # a liberação aponta a ficha de GECADANTIMI e a liberação anterior (autorreferência)
        lib = "liberacao_antimicrobiano."
        self.assertEqual(self._d("GEANTIMI", "ID_GECADANTIMI", lib + "ficha_antimicrobiano_id")[0]["via"],
                         "ref:GECADANTIMI")
        self.assertEqual(self._d("GEANTIMI", "ID_GEANTIMI_ORIGEM_TRAT",
                                 lib + "anterior_liberacao_antimicrobiano_id")[0]["via"], "ref:GEANTIMI")
        self.assertEqual(self._d("GEANTIMI", "DATA_INT", lib + "decisao")[0]["regra"], "preenchido")
        self.assertTrue(self._d("GEANTIMI", "#retrato:*", lib + "dados"))


if __name__ == "__main__":
    unittest.main()
