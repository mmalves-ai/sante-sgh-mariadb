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
         "PREVOLTIPOACO", "PRPADEVOL", "PRFORMULCOMP", "PRMANCHESTER", "PRPARAM", "PRPAREVOLIMG", "PRASSINATURA_CAB",
         "PRRESPOSTA")
# rodada 3 (revisão): a forma de PRRESPOSTA é desta fatia (a imagem da L6-10 a apagou)
FORMA_FORA = set()


_DIR = Path(os.environ.get("CONECTOR_MAPA_DIR") or mapa.DIR_PACOTE)
DESCARTE = {}  # rodada 5 (ADR 0006): nenhum descarte
# rodada 3 (revisão do achado): bloqueadas por falta de mecanismo, com a declaração pronta e comentada; nunca descarte
BLOQUEADA = set()  # conferidor r4: PRPAREVOLIMG carrega com #arquivo


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
        ordem = {r["tabela"]: int(r["ordem"]) for r in self.m["tabelas"] if r["tabela"] in FATIA}
        self.assertEqual(list(self.plano), sorted(self.plano, key=ordem.get))
        # o modelo antes dos campos, os campos antes do leiaute e das opções
        pos = list(self.plano).index
        self.assertLess(pos("PREVOLUCAO"), pos("PRPADEVOL"))
        self.assertLess(pos("PRPADEVOL"), pos("PRFORMULCOMP"))
        varios = {"PRITEMNAOPAD": ["item_nao_padronizado", "unidade_prescricao"],
                  "PRKITMED": ["kit_prescricao", "unidade_prescricao"],
                  "PRITENSKITMED": ["kit_prescricao_item", "unidade_prescricao"],
                  "PRKITSOLITENS": ["kit_prescricao_item", "unidade_prescricao"],
                  "PRPADEVOL": ["modelo_campo", "unidade_resposta"],
                  "PRITEM_GEITENS": ["parametro_clinico_item", "item_prescritivel"],
                  "PREVOLUCAO": ["modelo_documento_clinico", "modelo_documento_versao"],
                  "PRPARAM": ["parametro_valor", "credencial_integracao", "trilha_auditoria", "logotipo_estabelecimento"],
                  "TBKITPRO": ["kit_cuidado_enfermagem", "kit_cuidado_enfermagem_item", "unidade_prescricao"]}
        for t, p in self.plano.items():
            self.assertEqual(p["destinos"], varios.get(t, p["destinos"][:1]), t)

    def test_cobertura_total_da_fatia(self):
        """Toda tabela da fatia carrega, é descarte de produto com motivo ou está BLOQUEADA por falta de mecanismo
        (nunca descarte para fugir de trabalho; regra 23)."""
        for t, causa in DESCARTE.items():
            self.assertEqual((self.sem_carga[t]["situacao"], self.sem_carga[t]["causa"]), ("descarte", causa))
            self.assertTrue(self.sem_carga[t]["motivo"].strip())
            self.assertNotIn(t, self.plano)
        for t in BLOQUEADA:
            self.assertEqual((self.sem_carga[t]["situacao"], self.sem_carga[t]["causa"]), ("bloqueada", "regra_faltante"), t)
            self.assertNotIn(t, self.plano)
        self.assertEqual(set(self.plano) | set(DESCARTE) | BLOQUEADA, set(FATIA))
        texto = (_DIR / "declarado" / "colunas.d" / "L6-11.tsv").read_text(encoding="utf-8")
        self.assertNotIn("[bloqueia]", texto)
        for t in BLOQUEADA - {"PRPAREVOLIMG"}:  # declaração pronta e comentada
            self.assertIn("\n#%s\t" % t, texto, t)

    def test_referencias_declaradas_e_valores(self):
        via = {(c["tabela"], c["coluna"], c["destino"]): c.get("via", "") for c in self.decl if c.get("destino")}
        # unidade de prescrição pelo código da origem (TBUNICON), criada antes e adotada pelo código; nunca mais pela
        # sigla de integração de TBUNIDADEMEDIDA (casava em 7 de 53 códigos)
        self.assertFalse(any("SIGLA_API" in v for v in via.values()))
        for t, c, d in [("PRITEMNAOPAD", "UNI_PRESC", "item_nao_padronizado"),
                        ("PRKITMED", "ID_TBUNICON_UNI_PRESC", "kit_prescricao"),
                        ("PRITENSKITMED", "ID_TBUNICON_UNI_PRESC", "kit_prescricao_item"),
                        ("PRKITSOLITENS", "ID_TBUNICON_UNI_PRESC", "kit_prescricao_item")]:
            self.assertEqual(via[(t, c, "unidade_prescricao.codigo")], "unidade_prescricao;antes;adotar:codigo")
            self.assertEqual(via[(t, c, "unidade_prescricao.descricao")], "unidade_prescricao;ref:TBUNICON>NOME")
            self.assertEqual(via[(t, c, "unidade_prescricao.unidade_medida_id")], "unidade_prescricao;ref:TBUNICON")
            self.assertIn((t, "@id:unidade_prescricao", d + ".unidade_prescricao_id"), via)
        self.assertEqual(via[("PRKITMED", "ID_GEITENS", "kit_prescricao.nome")], "ref:GEITENS>NOME")
        self.assertEqual(via[("PRFAVORITO", "ID_PRLOCPACDEFAULT", "painel_filtro_usuario.usuario_id")],
                         "ref:PRLOCPACDEFAULT>USUARIO>TBUSERS")
        for spec in set(x[4:] for v in via.values() for x in v.split(";") if x.startswith("ref:")):
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
                      "especialidade_medica_id": "TBESPEC", "alergeno_id": "TBALERGIA",
                      "tipo_documento_clinico_id": "PRTPASSINATURA",
                      "modelo_documento_clinico_id": "PREVOLUCAO",
                      "entidade_id": "PRFILTROCLASSIF",
                      "classificacao_filtro_painel_id": "PRFILTROCLASSIF",  # r6: vínculo filtro x classificação
                      "classificacao_despesa_id": "TBCLASSI",
                      "principio_ativo_cliente_id": "TBPRINC"}  # r6: princípio do hospital (L7-07)  # r5: trilha do filtro do painel  # PRPAREVOLIMG (conferidor r4)
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

    def test_rodada3_mecanismos(self):
        """As tabelas destravadas usam só mecanismos genéricos do motor, com a forma decidida."""
        decl = {(c["tabela"], c["coluna"], c["destino"]): c for c in self.decl if c.get("destino")}
        via = {k: c.get("via", "") for k, c in decl.items()}
        # item prescritível criado antes do parâmetro e adotado pelo insumo; o parâmetro liga pelo @id do secundário
        self.assertEqual(via[("PRITEM_GEITENS", "ID_GEITENS", "item_prescritivel.insumo_id")],
                         "item_prescritivel;ref:GEITENS;antes;adotar:insumo_id")
        self.assertIn(("PRITEM_GEITENS", "@id:item_prescritivel", "parametro_clinico_item.item_prescritivel_id"), decl)
        self.assertIn("ref:GEITENS@codigo", via[("PRITEM_GEITENS", "ID_GEITENS", "item_prescritivel.codigo")])
        self.assertIn("cod:tipo_item_prescricao.codigo",
                      via[("PRITEM_GEITENS", "=~6", "item_prescritivel.tipo_item_prescricao_id")])
        # r6 (ADR 0006): princípio do HOSPITAL (principio_ativo_cliente, L7-07, ligado ao oficial pelo DCB); o
        # catálogo oficial continua nunca gravado
        for t, d in (("PRITEMNAOPAD_TBPRINC", "item_nao_padronizado_principio"), ("TBALERGIA_TBPRINC",
                                                                                 "alergeno_principio_ativo")):
            self.assertEqual(via[(t, "ID_TBPRINC", d + ".principio_ativo_cliente_id")], "ref:TBPRINC")
        self.assertFalse(any(c["destino"].startswith("principio_ativo.") for c in self.decl if c.get("destino")))
        # versão atual do modelo como destino secundário de PREVOLUCAO; campo, leiaute e opção ligados a ela
        self.assertEqual(via[("PRPADEVOL", "ID_EVOLUCAO", "modelo_campo.modelo_documento_versao_id")],
                         "ref:PREVOLUCAO/modelo_documento_versao")
        self.assertEqual(via[("PRFORMULCOMP", "ID_PRPADEVOL", "modelo_layout.modelo_documento_versao_id")],
                         "ref:PRPADEVOL>ID_EVOLUCAO>PREVOLUCAO/modelo_documento_versao")
        self.assertIn(("PREVOLUCAO", "=1000", "modelo_documento_versao.numero_versao"), decl)
        for spec in set(x[4:] for v in via.values() for x in v.split(";") if x.startswith("ref:")):
            self.assertIsNotNone(mapa.passos_ref(spec), spec)
        self.assertNotIn("PRPAREVOLIMG", self.sem_carga)  # conferidor r4: carrega com #arquivo

    def test_pergunta_lida_pela_ligacao(self):
        """Guarda do descarte 'duplicado' de PRPERGUNTA (L6-10): o campo do modelo lê da pergunta, na origem, o título,
        o tipo, a unidade, o texto padrão, o reaproveitamento e a situação; nada de tipo presumido."""
        via = {(c["destino"], c.get("via", "")) for c in self.decl if c["tabela"] == "PRPADEVOL" and c.get("destino")}
        lidas = {v.split(";")[0 if v.startswith("ref:") else 1][len("ref:PRPERGUNTA>"):] for d, v in via
                 if "ref:PRPERGUNTA>" in v}
        self.assertTrue({"DESCRICAO", "TIPOPERG", "UNIDPERG", "CONTEVOL", "MANTERHIST", "ATIVO"} <= lidas, lidas)
        self.assertFalse(any(c["coluna"].startswith("=~") for c in self.decl if c["tabela"] == "PRPADEVOL"))
        self.assertNotIn(("modelo_campo.editavel", ""), via)  # ATIVO é exclusão, não edição
        par = {(v["coluna"], v["destino"], v["valor_origem"]): v["valor_destino"] for v in self.m["valores"]
               if v["tabela"] == "PRPADEVOL"}
        tipo = {o: d for (c, dt, o), d in par.items() if dt == "modelo_campo.tipo_campo"}
        self.assertEqual((tipo["1"], tipo["2"], tipo["4"], tipo["6"], tipo["12"], tipo["13"]),
                         ("secao", "data", "escolha", "decimal", "multipla", "escolha"))
        self.assertEqual(par[("ID_PRPERGUNTA", "modelo_campo.destino_estruturado", "19")], "alergia")
        self.assertEqual(par[("ATIVO", "modelo_campo.excluido_em", "0")], "@data_carga")
        self.assertEqual(par[("ID_PRPERGUNTA", "modelo_campo.excluido_em", "0")], "@data_carga")
        self.assertEqual(par[("ATIVO", "modelo_campo.excluido_em", "1")], "")
        self.assertEqual(par[("ID_PRPERGUNTA", "modelo_campo.reuso_horas", "1")], "65535")
        self.assertEqual(sentinela.aplicar("booleano_sn", "F"), (False, None))  # o domínio da origem é T/F

    def test_colunas_e_regras(self):
        def dest(t):
            p = self.plano[t]
            return {c["destino"]: (c["coluna"], c["regra"]) for c in p["colunas"][p["destinos"][0]]}
        self.assertEqual(dest("PREVOLUCAO")["tipo_registro"][0], "=~outro")
        # decisão 61: o código do modelo é o COD da origem em maiúsculas; a chave como texto é a concorrente de reserva
        p0 = self.plano["PREVOLUCAO"]
        self.assertEqual([(c["coluna"], c["regra"]) for c in p0["colunas"][p0["destinos"][0]] if c["destino"] == "codigo"],
                         [("COD", "codigo_maiusculo"), ("ID_EVOLUCAO", "texto")])
        self.assertIn("COD", p0["lidas"])
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
        for t, c in (("TBCBARAREACAOADVERSA", "ID_DIGITAL"), ("PREVOLTIPOACO", "NOME")):
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
        self.assertEqual(set(l6_11.COLUNAS), set(FATIA) - FORMA_FORA)
        for t in set(FATIA) - FORMA_FORA:  # a forma que outra fatia já define (PRPADEVOL, pai lido pela L6-10) não é repetida
            self.assertTrue(("CREATE TABLE %s (" % t) in l6_11.DDL or l6_11._definida_fora(t), t)
        for t in ("PRLOCPACDEFAULT", "TBPROENF", "TBUNIDADEMEDIDA", "HTPACIENTE", "HTATENDIMENTO", "TBCBOPRO",
                  "PRTPASSINATURA", "PRPERGUNTA", "PRRESPOSTA", "TBPRINC", "PRCADRESP", "PRASSINATURA_DOC"):
            # pais lidos na origem (forma da dona ou do dicionário)
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
            if t == "PRPARAM":  # r6: desdobrado (gravados = parâmetros): uma linha só (global), nenhuma recusada
                self.assertEqual((recusas, len(linhas[t])), (0, 1), t)
                continue
            self.assertEqual(e["gravados"] + recusas, len(linhas[t]), t)

    def test_documento_sem_evento_e_ultimo_evento(self):
        """Situação atual pelo MAIOR ID do evento (sem empate no mesmo instante); cabeçalho sem evento carrega pelo
        atendimento (autor = assistente, momento = entrada) e pela situação nativa de migração, na ordem declarada."""
        ordem = {}
        for c in self.decl:
            if c["tabela"] == "PRASSINATURA_CAB" and c.get("destino"):
                ordem.setdefault(c["destino"], []).append((c["coluna"], c.get("via", "")))
        sit = ordem["documento_prontuario.situacao_documento_prontuario_id"]
        self.assertIn(">max:ID>ID_PRSITDOCUMENTO>", sit[0][1])
        self.assertNotIn("max:DATA_HORA_EVENTO", sit[0][1])
        # R12 (lote R, P3b): o cabeçalho sem evento entra como documento lançado à espera de assinatura, presumido
        # (concorrente pelo código da situação nativa, com valor_presumido)
        self.assertEqual(sit[1:], [("=~lancado", "cod:situacao_documento_prontuario.codigo")])
        prof = ordem["documento_prontuario.profissional_id"]
        self.assertIn("min:DATA_HORA_EVENTO", prof[0][1])
        self.assertEqual(prof[1], ("ID_HTATENDIMENTO", "ref:HTATENDIMENTO>ID_TBCBOPRO_ASSISTENTE>TBCBOPRO>ID_TBPROFIS>TBPROFIS"))
        for d in ("referencia_em", "lancado_em"):
            vs = ordem["documento_prontuario." + d]
            self.assertEqual([c for c, _ in vs], ["ID", "ID_HTATENDIMENTO"], d)
        for _, v in sum(ordem.values(), []):
            for x in v.split(";"):
                if x.startswith("ref:"):
                    self.assertIsNotNone(mapa.passos_ref(x[4:]), x)


if __name__ == "__main__":
    unittest.main()
