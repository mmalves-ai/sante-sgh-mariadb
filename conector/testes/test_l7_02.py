"""Fatia L7-02 (SADT e suprimentos, módulo SADT): declarações planejadas, regras das colunas e coerência da imagem
sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L7-02`."""
import datetime
import random
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l7_02

TABELAS = set(l7_02.CARREGADAS)
BLOQUEADAS = set(l7_02.NAO_CARREGADAS)
DESTINO = {"SICTRPSR": "grupo_resposta", "SIESPEC": "especialidade_diagnostica", "SIKITEXA": "kit_exame",
           "SIKITITE": "kit_exame_item",
           "SIMATERI": "material_biologico", "SIMETODO": "metodo_analitico", "SIMODULO": "setor_diagnostico",
           "SIPACSMODALID": "modalidade_imagem", "SIOBSERV": "texto_padrao_resultado",
           "SIPARGER": "responsavel_laudo_setor", "SIPACSVISIMG": "visualizador_imagem",
           **{t: "parametro_valor" for t in l7_02.SIPAR}}
# outras alimentadoras conhecidas do mesmo destino, em domínio de código disjunto (prefixo próprio)
# (SIMODULO_SIWEBATOS, L8-16, só complementa o setor com o canal de aviso, coluna que SIMODULO não grava)
# SIMODULO_SIWEBATOS virou descarte (mecanismo_do_produto) na rodada 2 (L8-16): só SIMODULO alimenta o setor
OUTRAS_ALIMENTADORAS = {"grupo_resposta": {"SHRESPOSTA"},
                        # r5: o visualizador do portal (L7-03) usa o código = ID; o desta fatia, visualizador_<ID>
                        "visualizador_imagem": {"SIWEBVISULIMG"}}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS)}

    def cols(self, t, dt=None):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt or DESTINO[t]]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t, d in DESTINO.items():
            self.assertEqual(self.plano[t]["destinos"][0], d, t)

    def test_obrigatorias_do_destino_cobertas(self):
        obrig = {"SICTRPSR": {"codigo", "descricao"}, "SIESPEC": {"codigo", "descricao"},
                 "SIKITEXA": {"codigo", "nome"},
                 "SIKITITE": {"kit_exame_id", "sequencia", "exame_id", "quantidade"}, "SIMATERI": {"codigo", "descricao"},
                 "SIMETODO": {"codigo", "descricao"},
                 "SIMODULO": {"estabelecimento_id", "codigo", "nome", "tipo"},
                 "SIPACSMODALID": {"codigo", "descricao", "sigla_padrao"},
                 "SIOBSERV": {"codigo", "descricao", "texto"},
                 "SIPARGER": {"setor_diagnostico_id", "profissional_id", "vigencia_inicio", "assina_laudo",
                              "responsavel_tecnico"}}
        for t, o in obrig.items():
            self.assertTrue(o <= set(self.cols(t)), t)

    def test_especiais(self):
        s = self.cols("SIMODULO")
        self.assertEqual(s["estabelecimento_id"]["coluna"], "@estabelecimento")
        self.assertEqual(s["tipo"]["coluna"], "=~outro")
        self.assertEqual(self.cols("SIKITEXA")["hora_sugerida_coleta"]["regra"], "hora_em_timestamp")
        self.assertEqual(self.cols("SIKITEXA")["gera_bateria"]["regra"], "booleano_sn")
        self.assertEqual(self.cols("SIMETODO")["descricao_laudo"]["regra"], "texto_longo")
        # classificação sem origem: presumida 'outro' por linha, nunca o padrão do destino em silêncio
        self.assertEqual(self.cols("SIESPEC")["tipo_servico"]["coluna"], "=~outro")
        self.assertEqual(self.cols("SIMATERI")["tipo"]["coluna"], "=~outro")
        # sigla única sem caixa: codigo_char faz o motor recusar o grupo inteiro (codigo_colisao_caixa)
        self.assertEqual(self.cols("SIPACSMODALID")["sigla_padrao"]["regra"], "codigo_char")

    def test_unica_alimentadora(self):
        for t, dt in DESTINO.items():
            if dt == "parametro_valor":  # r5: valor por definição (escopo próprio), muitas alimentadoras
                continue
            outras = {c["tabela"] for c in self.mapa["colunas_decl"]
                      if (c.get("destino") or "").startswith(dt + ".")} - {t}
            self.assertEqual(outras, OUTRAS_ALIMENTADORAS.get(dt, set()), dt)
        comp = [c for c in self.mapa["colunas_decl"] if c["tabela"] == "SIMODULO_SIWEBATOS"]
        # r5 (L8-16): virou lista do hospital (parametro_opcao); se voltar ao setor, só por complementa
        no_setor = [c for c in comp if (c.get("destino") or "").startswith("setor_diagnostico.")]
        self.assertTrue(not no_setor or any("complementa" in (c.get("via") or "").split(";") for c in no_setor))
        proprias = set(self.cols("SIMODULO")) - {"setor_diagnostico.id"}
        self.assertFalse(proprias & {c.get("destino") for c in comp})

    def test_grupo_resposta_sem_colisao_no_codigo(self):
        # SICTRPSR grava a chave inteira (só dígitos); SHRESPOSTA grava sempre com o prefixo 'triagem_': os dois
        # domínios nunca se cruzam em uq_grupo_resposta_codigo
        dec = [c for c in self.mapa["colunas_decl"] if c.get("destino") == "grupo_resposta.codigo"]
        por = {c["tabela"]: c for c in dec}
        self.assertEqual(set(por), {"SICTRPSR", "SHRESPOSTA"})
        self.assertEqual((por["SICTRPSR"]["coluna"], por["SICTRPSR"]["regra"]), ("COD", "texto"))
        self.assertTrue(por["SHRESPOSTA"]["coluna"].startswith("#codigo_derivado:"))
        pre = por["SHRESPOSTA"]["coluna"].split(":")[3]
        self.assertEqual(pre, "triagem_")
        for cod in (0, 1, 17, 32767):
            self.assertTrue(sentinela.aplicar("texto", cod)[0].isdigit())
        self.assertFalse(carga_mapa.codigo_derivado("12", 30, pre)[0].isdigit())

    def test_texto_padrao_por_codigo_derivado_do_texto(self):
        c = self.cols("SIOBSERV")
        self.assertEqual(c["codigo"]["coluna"], "#codigo_derivado:OBS:30")
        self.assertEqual(c["codigo"]["regra"], "texto_longo")
        self.assertEqual(c["texto"]["regra"], "texto_longo")
        via = {x["destino"]: x["via"] for x in self.mapa["colunas_decl"] if x["tabela"] == "SIOBSERV"}
        self.assertEqual(via["texto_padrao_resultado.setor_diagnostico_id"], "ref:SIMODULO")
        curto, m1 = carga_mapa.codigo_derivado("Amostra hemolisada.", 30)
        self.assertEqual((curto, m1), ("Amostra hemolisada.", False))
        longo, m2 = carga_mapa.codigo_derivado("x" * 64, 30)
        self.assertTrue(m2 and len(longo) <= 30)

    def test_responsavel_do_laboratorio(self):
        c = self.cols("SIPARGER")
        via = {x["destino"]: x["via"] for x in self.mapa["colunas_decl"] if x["tabela"] == "SIPARGER"}
        self.assertTrue(via["responsavel_laudo_setor.setor_diagnostico_id"].startswith("ref:SIMODULO;"))
        self.assertIn("adotar:setor_diagnostico_id,profissional_id",
                      via["responsavel_laudo_setor.setor_diagnostico_id"].split(";"))
        self.assertTrue(via["responsavel_laudo_setor.profissional_id"].startswith(
            "ref:TBCBOPRO>ID_TBPROFIS>TBPROFIS;"))
        self.assertEqual(c["assina_laudo"]["coluna"], "=1")
        self.assertEqual(c["responsavel_tecnico"]["coluna"], "=1")
        self.assertEqual(c["vigencia_inicio"]["coluna"], "@vigencia_carga")
        # r5: SIPARRX (com o responsável padrão do digitador) carrega como preferência do usuário, linha inteira
        sc = {r["tabela"]: r for r in mapa.ler_tsv(Path(mapa.__file__).resolve().parents[1] / "mapa/declarado/sem_carga.tsv")}
        self.assertFalse(({"SIPARGER", "SIPACSVISIMG"} | set(l7_02.SIPAR)) & set(sc))
        rx = {x["destino"]: x["coluna"] for x in self.mapa["colunas_decl"] if x["tabela"] == "SIPARRX"}
        self.assertEqual(rx["parametro_valor.valor"], "#retrato:*")
        self.assertEqual(rx["parametro_definicao.chave"], "=migracao.preferencias_imagem")

    def test_bloqueadas_sem_destino(self):
        # dependem de regra genérica, de ordem do mapa ou de decisão do dono (docs/obra/fatias/f4/saida/L7-02.json)
        self.assertFalse(BLOQUEADAS & set(self.plano))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in BLOQUEADAS and c.get("destino")])

    def test_item_do_kit(self):
        c = self.cols("SIKITITE")
        via = {x["destino"]: x["via"] for x in self.mapa["colunas_decl"] if x["tabela"] == "SIKITITE"}
        self.assertEqual(via["kit_exame_item.kit_exame_id"], "ref:SIKITEXA")
        self.assertEqual(via["kit_exame_item.exame_id"], "ref:SITABPRO(ATO,EXAME)")
        self.assertEqual(c["sequencia"]["coluna"], "#seq:KIT")
        self.assertEqual(c["quantidade"]["regra"], "piso:1")
        # o exame (SITABPRO) vem antes do item pela dependência declarada (o gerador do mapa a põe na ordem)
        dec = mapa.ler_tsv(Path(mapa.__file__).resolve().parents[1] / "mapa/declarado/dependencias.tsv")
        self.assertIn(("SIKITITE", "SITABPRO"), {(d["tabela"], d["depende_de"]) for d in dec})

    def test_descartes_com_motivo_de_produto(self):
        sc = {r["tabela"]: r for r in mapa.ler_tsv(Path(mapa.__file__).resolve().parents[1] / "mapa/declarado/sem_carga.tsv")}
        for t in l7_02.DESCARTADAS:
            self.assertEqual(sc[t]["situacao"], "descarte", t)
            self.assertIn(sc[t]["causa"], {"sem_valor", "mecanismo_do_produto"}, t)
            self.assertTrue(sc[t]["motivo"], t)
        self.assertEqual(set(l7_02.NAO_CARREGADAS), set(l7_02.DESCARTADAS) | set(l7_02.AGUARDAM_REGRA))

    def test_secundario_de_material_fora(self):
        # de_para_material_apoio exige laboratorio_apoio_id sem origem: só o destino principal é carregado
        self.assertNotIn("de_para_material_apoio", self.plano["SIMATERI"]["destinos"])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "Reagente  e não reagente".encode("cp1252")), ("Reagente e não reagente", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("texto", 12), ("12", None))
        self.assertEqual(a("booleano_sn", b"S"), (True, None))
        self.assertEqual(a("booleano_sn", b"N"), (False, None))
        self.assertEqual(a("booleano_sn", b"X")[1], "valor_fora_do_dominio")
        self.assertEqual(a("hora_em_timestamp", datetime.datetime(1899, 12, 30, 7, 0)), (datetime.time(7, 0), None))
        self.assertEqual(a("hora_em_timestamp", datetime.datetime(2025, 3, 10, 8, 15)),
                         (datetime.time(8, 15), "hora_com_data"))
        t = "Método\r\n  com  leitura  ".encode("cp1252")
        self.assertEqual(a("texto_longo", t)[0], "Método\r\n  com  leitura  ")


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l7_02.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(BLOQUEADAS <= set(cont))
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items()
                          if k.startswith(("restricao_destino_", "pai_pendente", "codigo_colisao_caixa")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_linhas_com_a_forma_do_ddl(self):
        f = l7_02.formas()
        self.assertEqual(set(f), TABELAS | BLOQUEADAS | set(l7_02.FORMA_SO))
        vistos = []
        l7_02.linhas(random.Random(2), lambda t, v: vistos.append((t, len(v))))
        for t, n in vistos:
            self.assertEqual(n, len(f[t]), t)

    def test_siglas_por_caixa_todas_recusadas(self):
        # 'CT', 'CT' e 'ct' formam um grupo: nenhuma grava (o esperado conta as três como codigo_colisao_caixa)
        sig = {}
        esp = l7_02.linhas(random.Random(4), lambda t, v: sig.setdefault(v[0], v[1]) if t == "SIPACSMODALID" else None)
        cods = [sentinela.aplicar("codigo_char", x)[0] for x in sig.values()]
        grupos = sentinela.colisoes_caixa(cods)
        self.assertEqual(grupos, [["CT", "ct"]])
        no_grupo = [k for k, x in sig.items() if x is not None and x.casefold() == "ct"]
        self.assertEqual(len(no_grupo), esp["SIPACSMODALID"]["pendencias"]["codigo_colisao_caixa"])

    def test_classificacao_presumida_em_toda_linha(self):
        cont = {}
        esp = l7_02.linhas(random.Random(5), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        for t in ("SIESPEC", "SIMATERI", "SIMODULO"):
            self.assertEqual(esp[t]["pendencias"]["valor_presumido"], cont[t], t)

    def test_quantidade_do_kit_elevada_a_um(self):
        a = sentinela.aplicar
        self.assertEqual(a("piso:1", 0), (1, "valor_elevado_ao_minimo"))
        self.assertEqual(a("piso:1", -2), (1, "valor_elevado_ao_minimo"))
        self.assertEqual(a("piso:1", 3), (3, None))
        self.assertEqual(a("piso:1", None), (None, None))

    def test_senha_gerencial_so_no_cofre(self):
        # ADR 0007 (17): a senha (falsa) da imagem vai ao cofre pela credencial; nunca entra no retrato
        f = [c for c, _, _ in l7_02.formas()["SIPARLAB"]]
        i = f.index("SENHAGERENCIAL")
        linhas = []
        l7_02.linhas(random.Random(3), lambda t, v: linhas.append(v) if t == "SIPARLAB" else None)
        self.assertEqual(sum(1 for v in linhas if v[i] is not None), 1)
        self.assertTrue(mapa.SEGREDO_NOME.search("SENHAGERENCIAL") if hasattr(mapa.SEGREDO_NOME, "search")
                        else any(s in "SENHAGERENCIAL" for s in mapa.SEGREDO_NOME))
        m = mapa.carregar_execucao()
        d = {x["destino"]: x for x in m["colunas_decl"] if x["tabela"] == "SIPARLAB"}
        self.assertEqual(d["credencial_integracao.referencia_cofre"]["coluna"], "#cofre:SENHAGERENCIAL")
        self.assertIn("destino_se:SENHAGERENCIAL", d["credencial_integracao.referencia_cofre"]["via"])


if __name__ == "__main__":
    unittest.main()
