"""Fatia L6-11 (prontuário, assinatura e assistência, módulo PEP): declarações, plano e imagem sintética. Sem banco;
só valores inventados. A carga e a conciliação na imagem SINTÉTICA rodam em `conector.sh conferir-fatia L6-11`."""
import os
import random
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_11

FATIA = ("PRITEMNAOPAD", "PRITEMNAOPAD_GETABVIA", "PRITEM_GEITENS", "PRKITMED", "PRITENSKITMED",
         "PRKITSOLITENS", "TBKITPRO", "PRITEMNAOPAD_TBPRINC", "TBALERGIA_TBPRINC", "PRAGRUP_PRFILTROCLASSIF",
         "PRLOCAL_ASSISTENCIA", "TBCBARAREACAOADVERSA", "PRFAVORITO", "PRPROTGERALESP", "PREVOLUCAO", "PREVOLESPEC",
         "PREVOLTIPOACO", "PRPADEVOL", "PRFORMULCOMP", "PRMANCHESTER", "PRPARAM", "PRPAREVOLIMG", "PRASSINATURA_CAB")


_DIR = Path(os.environ.get("CONECTOR_MAPA_DIR") or mapa.DIR_PACOTE)
DESCARTE = {"PRAGRUP_PRFILTROCLASSIF": "sem_valor", "PRPARAM": "mecanismo_do_produto"}
# destino decidido; a declaração completa está comentada e a linha [bloqueia] espera o mecanismo compartilhado (M1 a M4)
BLOQUEADAS = ("PRITEM_GEITENS", "PRITEMNAOPAD_TBPRINC", "TBALERGIA_TBPRINC", "PRPADEVOL", "PRFORMULCOMP",
              "PRASSINATURA_CAB", "PRPAREVOLIMG")


def _sem_carga():
    return {r["tabela"]: r for r in mapa.ler_tsv(_DIR / "declarado" / "sem_carga.tsv")}


class FatiaL611(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["tabela"] in FATIA]
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}
        cls.sem_carga = _sem_carga()

    def test_so_as_tabelas_carregaveis_tem_destino(self):
        com_destino = {c["tabela"] for c in self.decl if c.get("destino")}
        self.assertEqual(com_destino, set(l6_11.CARREGADAS))
        self.assertTrue(all(c.get("_arquivo", "").endswith("L6-11.tsv") for c in self.decl))
        for c in self.decl:  # coluna sem destino sempre com motivo
            self.assertTrue(c["motivo"].strip(), c["coluna"])

    def test_plano_na_ordem_do_mapa(self):
        self.assertEqual(list(self.plano), ["PRITEMNAOPAD", "PRITEMNAOPAD_GETABVIA", "PRKITMED", "PRITENSKITMED",
                                            "PRKITSOLITENS", "TBKITPRO", "PRLOCAL_ASSISTENCIA", "TBCBARAREACAOADVERSA",
                                            "PRFAVORITO", "PRPROTGERALESP", "PREVOLUCAO", "PREVOLESPEC",
                                            "PREVOLTIPOACO", "PRMANCHESTER"])
        for t, p in self.plano.items():
            self.assertEqual(p["destinos"], ["kit_cuidado_enfermagem", "kit_cuidado_enfermagem_item"]
                             if t == "TBKITPRO" else p["destinos"][:1], t)

    def test_cobertura_total_da_fatia(self):
        """Toda tabela da fatia carrega, é descarte de produto com motivo ou está bloqueada com declaração comentada e
        pedido (mecanismo compartilhado)."""
        for t, causa in DESCARTE.items():
            self.assertEqual((self.sem_carga[t]["situacao"], self.sem_carga[t]["causa"]), ("descarte", causa))
            self.assertTrue(self.sem_carga[t]["motivo"].strip())
            self.assertNotIn(t, self.plano)
        self.assertEqual(set(self.plano) | set(DESCARTE) | set(BLOQUEADAS), set(FATIA))
        texto = (_DIR / "declarado" / "colunas.d" / "L6-11.tsv").read_text(encoding="utf-8")
        for t in BLOQUEADAS:
            self.assertIn("#%s\t" % t, texto)
            self.assertIn("[bloqueia] M", "\n".join(l for l in texto.splitlines() if l.startswith("#%s\t" % t)))
        self.assertNotIn("PRPAREVOLIMG", self.sem_carga)

    def test_referencias_declaradas_e_valores(self):
        via = {(c["tabela"], c["coluna"], c["destino"]): c.get("via", "") for c in self.decl if c.get("destino")}
        sigla = "ref:TBUNIDADEMEDIDA.SIGLA_API"
        for t, c, d in [("PRITEMNAOPAD", "UNI_PRESC", "item_nao_padronizado.unidade_prescricao_id"),
                        ("PRKITMED", "ID_TBUNICON_UNI_PRESC", "kit_prescricao.unidade_prescricao_id"),
                        ("PRITENSKITMED", "ID_TBUNICON_UNI_PRESC", "kit_prescricao_item.unidade_prescricao_id"),
                        ("PRKITSOLITENS", "ID_TBUNICON_UNI_PRESC", "kit_prescricao_item.unidade_prescricao_id")]:
            self.assertEqual(via[(t, c, d)], sigla)
        self.assertEqual(via[("PRKITMED", "ID_GEITENS", "kit_prescricao.nome")], "ref:GEITENS>NOME")
        self.assertEqual(via[("TBKITPRO", "ID_GEUNIPRESC", "kit_cuidado_enfermagem_item.unidade_prescricao_id")],
                         "ref:GEUNIPRESC>UNI_PRESC>" + sigla[4:])
        self.assertEqual(via[("PRFAVORITO", "ID_PRLOCPACDEFAULT", "painel_filtro_usuario.usuario_id")],
                         "ref:PRLOCPACDEFAULT>USUARIO>TBUSERS")
        for spec in set(v[4:] for v in via.values() if v.startswith("ref:")):
            self.assertIsNotNone(mapa.passos_ref(spec), spec)
        par = {(v["tabela"], v["destino"], v["valor_origem"]): v["valor_destino"] for v in self.m["valores"]
               if v["tabela"] in FATIA}
        self.assertEqual(par[("PRKITMED", "kit_prescricao.tipo_atendimento", "A")], "ambulatorial")
        self.assertEqual(par[("PRFAVORITO", "painel_filtro_usuario.tipo_atendimento", "A")], "ambulatorio")
        self.assertEqual(par[("PRFAVORITO", "painel_filtro_usuario.nome", "I")], "Internação")
        self.assertEqual(par[("PRKITSOLITENS", "kit_prescricao_item.papel", "1")], "principal")
        self.assertEqual(par[("PRMANCHESTER", "nivel_prioridade.cor_hexadecimal", "clRed")], "#FF0000")
        self.assertEqual(par[("PRMANCHESTER", "nivel_prioridade.cor_hexadecimal", "$000080FF")], "#FF8000")
        self.assertEqual(par[("PRMANCHESTER", "nivel_prioridade.nome_cor", "$000080FF")], "laranja")
        ordem = {v: int(o) for (t, d, v), o in par.items() if d == "nivel_prioridade.ordem"}
        self.assertLess(ordem["clRed"], ordem["$000080FF"])
        self.assertLess(ordem["$000080FF"], ordem["clYellow"])
        self.assertLess(ordem["clYellow"], ordem["clGreen"])
        self.assertLess(ordem["clGreen"], ordem["clBlue"])
        self.assertLess(ordem["clBlue"], ordem["clBlack"])
        self.assertLess(ordem["clBlack"], ordem["clWhite"])
        por_cor = {v.upper(): o for v, o in ordem.items()}  # $00..ff e $00..FF são a mesma cor
        self.assertEqual(len(set(por_cor.values())), len(por_cor))  # ordem única no contexto
        self.assertEqual(par[("PRLOCAL_ASSISTENCIA", "local_assistencia.tipo_atendimento", "A")], "ambulatorial")
        self.assertTrue(all(len(v) == 7 and v.startswith("#") for (t, d, _), v in par.items()
                            if d.endswith("cor_hexadecimal")))
        # código derivado com prefixo de domínio: não colide com o código puro dos kits de solução
        self.assertEqual(carga_mapa.codigo_derivado("12", 30, "kitmed_"), ("kitmed_12", False))

    def test_referencias(self):
        ref = {(t, c["destino"]): c["referencia"] for t, p in self.plano.items()
               for c in p["colunas"][p["destinos"][0]] if c["regra"] == "chave_origem" and not c.get("passos")}
        novas = {k: ref.pop(k) for k in list(ref)
                 if k[0] not in ("PRPROTGERALESP", "PREVOLUCAO", "PREVOLESPEC", "PREVOLTIPOACO")}
        por_coluna = {"tipo_item_prescricao_id": "PRTPLAN", "item_nao_padronizado_id": "PRITEMNAOPAD",
                      "via_de_uso_id": "GETABVIA", "insumo_id": "GEITENS", "unidade_prescricao_id": "TBUNIDADEMEDIDA",
                      "cuidado_enfermagem_id": "TBPROENF", "acomodacao_id": "TBACOMODLEITO",
                      "especialidade_medica_id": "TBESPEC"}
        for (t, d), r in novas.items():
            esperado = {"PRITENSKITMED": "PRKITMED", "PRKITSOLITENS": "PRKITSOL"}.get(t) \
                if d == "kit_prescricao_id" else por_coluna[d]
            self.assertEqual(r, esperado, (t, d))
        self.assertEqual(ref, {
            ("PRPROTGERALESP", "protocolo_prescricao_id"): "PRPROTGERAL",
            ("PRPROTGERALESP", "especialidade_medica_id"): "TBESPEC",
            ("PREVOLUCAO", "tipo_documento_clinico_id"): "PRTPCOMP",
            ("PREVOLESPEC", "modelo_documento_clinico_id"): "PREVOLUCAO",
            ("PREVOLESPEC", "especialidade_medica_id"): "TBESPEC",
            ("PREVOLTIPOACO", "modelo_documento_clinico_id"): "PREVOLUCAO",
            ("PREVOLTIPOACO", "categoria_acomodacao_id"): "TBTIPOACOMOD"})

    def test_colunas_e_regras(self):
        def dest(t):
            p = self.plano[t]
            return {c["destino"]: (c["coluna"], c["regra"]) for c in p["colunas"][p["destinos"][0]]}
        self.assertEqual(dest("PREVOLUCAO")["tipo_registro"][0], "=~outro")
        self.assertEqual(dest("PREVOLUCAO")["codigo"], ("ID_EVOLUCAO", "texto"))
        self.assertEqual(dest("TBCBARAREACAOADVERSA")["codigo"], ("CODIGO", "codigo_char"))
        self.assertEqual(dest("TBCBARAREACAOADVERSA")["ativo"][1], "booleano_sn")
        self.assertEqual(dest("PRLOCAL_ASSISTENCIA")["ativo"], ("SITUACAO", "booleano_ai"))
        self.assertNotIn("=~outro", self.plano["PREVOLUCAO"]["lidas"])
        self.assertEqual(dest("PRLOCAL_ASSISTENCIA")["tipo_atendimento"], ("TIPO_ATENDIMENTO", "codigo_char"))
        self.assertIn("TIPO_ATENDIMENTO", self.plano["PRLOCAL_ASSISTENCIA"]["lidas"])
        self.assertEqual(dest("PRMANCHESTER")["sigla"], ("COD_PROTOCOLO", "texto"))
        self.assertEqual(dest("PRMANCHESTER")["ordem"], ("COR", "texto"))  # ordem pela cor, nunca pelo ID
        for c in ("TP_ATENDIMENTO", "CODCAB", "LAYOUT_VISUALIZACAO_IMPRESSAO", "FASE", "OLD_TIPOCOMP"):
            self.assertNotIn(c, self.plano["PREVOLUCAO"]["lidas"])
        for t, c in (("TBCBARAREACAOADVERSA", "ID_DIGITAL"), ("PREVOLTIPOACO", "NOME"), ("PREVOLUCAO", "COD")):
            self.assertNotIn(c, self.plano[t]["lidas"])

    def test_regras_de_valor(self):
        self.assertEqual(sentinela.aplicar("texto", "  Evolução   diária\r\nexemplo ")[0], "Evolução   diária\r\nexemplo")
        self.assertEqual(sentinela.aplicar("texto_nome", "  Edema   de glote exemplo ")[0], "Edema de glote exemplo")
        self.assertEqual(sentinela.aplicar("booleano_ai", "I"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_ai", "X")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("booleano_sn", "X")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("texto", 7), ("7", None))
        self.assertEqual(len(sentinela.colisoes_caixa(["ab12", "AB12", "RX001"])), 1)

    def test_imagem_sintetica_tem_todas_as_tabelas_e_o_esperado(self):
        self.assertEqual(set(l6_11.COLUNAS), set(FATIA))
        for t in FATIA:  # a forma que outra fatia já define (PRPADEVOL, pai lido pela L6-10) não é repetida
            self.assertTrue(("CREATE TABLE %s (" % t) in l6_11.DDL or l6_11._definida_fora(t), t)
        for t in ("PRLOCPACDEFAULT", "TBPROENF", "TBUNIDADEMEDIDA"):  # pais lidos na origem, forma da dona
            self.assertEqual(l6_11.DDL.count("CREATE TABLE %s (" % t), 1)
        linhas = {}
        esp = l6_11.linhas(random.Random(1), lambda t, v: linhas.setdefault(t, []).append(v))
        self.assertEqual(set(esp), set(l6_11.CARREGADAS))
        for t, cols in l6_11.COLUNAS.items():
            for v in linhas.get(t, []):
                self.assertEqual(len(v), len(cols))
        for t, e in esp.items():  # lidas = gravadas + recusadas
            recusas = sum(n for k, n in e["pendencias"].items()
                          if k.startswith("restricao_destino_") or k in ("pai_pendente", "codigo_colisao_caixa"))
            self.assertEqual(e["gravados"] + recusas, len(linhas[t]), t)


if __name__ == "__main__":
    unittest.main()
