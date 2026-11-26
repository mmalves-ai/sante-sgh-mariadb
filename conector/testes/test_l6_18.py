"""Fatia L6-18 (prontuário, assinatura e assistência, módulo HOT): declarações planejadas, regras das colunas e
coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L6-18`."""
import datetime
import random
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_18

TABELAS = set(l6_18.CARREGADAS)
BLOQUEADAS = set(l6_18.NAO_CARREGADAS)
DESCARTADAS = set(l6_18.DESCARTADAS)


# recusas-fase2 C1c (pedido 2 do K2): S/N e 1/0 viram o booleano do contrato por chave
ITEM_ESPECIFICO = {"CVPARAM": ["#item@GRAVAR_FOTO_BANCO", "#item@IMPRIME_ETIQ_SEM_PRE_VIZUALIZAR",
                               "#item@DIGITAR_DATA_NASCIMENTO", "#item@DIGITAR_CELULAR", "#item@DIGITAR_DOCUMENTO"]}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS | DESCARTADAS)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        esperado = {"PRTPREFEIC": ["refeicao_do_dia"], "RISETOR": ["setor_tramite"], "PRVIAADMIN": ["via_dieta"],
                    "TBDIETAS": ["modalidade_dieta"], "PRCARACT_TBDIETAS": ["modalidade_dieta_caracteristica"],
                    "CHTPLIMPEZA_GEITENS": ["material_modalidade_limpeza"], "PRHORPAD": ["horario_refeicao"],
                    "TBLEITO_CHPROFISLIMP": ["leito_profissional_higienizacao"],
                    "CHSOLICITLIMP": ["solicitacao_limpeza"], "CHEXECLIMPEZA": ["execucao_limpeza"],
                    "CHSOLICITLIMP_TBLEITO": ["solicitacao_limpeza_local"],
                    "GDPRONTMOVIM": ["movimento_prontuario", "volume_prontuario"]}
        for t, d in esperado.items():
            self.assertEqual(self.plano[t]["destinos"], d, t)

    def test_obrigatorias_do_destino_cobertas(self):
        self.assertTrue({"codigo", "descricao", "ordem"} <= set(self.cols("PRTPREFEIC", "refeicao_do_dia")))
        self.assertTrue({"codigo", "descricao"} <= set(self.cols("RISETOR", "setor_tramite")))
        self.assertTrue({"codigo", "descricao", "modalidade"} <= set(self.cols("PRVIAADMIN", "via_dieta")))
        self.assertTrue({"codigo", "descricao"} <= set(self.cols("TBDIETAS", "modalidade_dieta")))
        self.assertTrue({"modalidade_dieta_id", "caracteristica_dieta_id"}
                        <= set(self.cols("PRCARACT_TBDIETAS", "modalidade_dieta_caracteristica")))
        self.assertTrue({"modalidade_limpeza_id", "insumo_id", "quantidade"}
                        <= set(self.cols("CHTPLIMPEZA_GEITENS", "material_modalidade_limpeza")))
        self.assertTrue({"estabelecimento_id", "refeicao_do_dia_id", "horario_inicio", "horario_fim",
                         "horario_corte_mapa"} <= set(self.cols("PRHORPAD", "horario_refeicao")))
        self.assertTrue({"leito_hospitalar_id", "profissional_higienizacao_id", "vigencia_inicio"}
                        <= set(self.cols("TBLEITO_CHPROFISLIMP", "leito_profissional_higienizacao")))
        self.assertTrue({"estabelecimento_id", "numero", "motivo_geracao", "modalidade_limpeza_id",
                         "situacao_limpeza_id", "solicitante_usuario_id", "solicitada_em"}
                        <= set(self.cols("CHSOLICITLIMP", "solicitacao_limpeza")))
        self.assertTrue({"estabelecimento_id", "solicitacao_limpeza_id", "situacao_limpeza_id"}
                        <= set(self.cols("CHEXECLIMPEZA", "execucao_limpeza")))
        self.assertTrue({"solicitacao_limpeza_id", "sequencia", "leito_hospitalar_id"}
                        <= set(self.cols("CHSOLICITLIMP_TBLEITO", "solicitacao_limpeza_local")))

    def test_presumidos(self):
        self.assertEqual(self.cols("RISETOR", "setor_tramite")["tipo"]["coluna"], "=~unidade")

    def test_tipo_de_dieta_pelas_consumidoras(self):
        # modalidade e classe vêm do nome do tipo de dieta (TBTPDIETA lida pela ref encadeada), nunca presumidas
        for t, dt, dc, col in [("PRVIAADMIN", "via_dieta", "modalidade", "ID_TBTPDIETA"),
                               ("TBDIETAS", "modalidade_dieta", "classe", "TPDIETA")]:
            todas = [x for x in self.plano[t]["colunas"][dt] if x["destino"] == dc]
            c = todas[0]
            self.assertEqual((c["coluna"], c["referencia"], c["depara"]), (col, "TBTPDIETA>NOME", "valores"), t)
            # P2b: na via, sem tipo de dieta (ou sem par), a concorrente pelo NOME da própria via; na modalidade, nenhuma
            self.assertEqual([(x["coluna"], x["depara"]) for x in todas[1:]],
                             [("NOME", "valores")] if t == "PRVIAADMIN" else [], t)
            self.assertEqual(c["valores"].get("ENTERAL"), "enteral", t)
            self.assertEqual(c["valores"].get("Parenteral"), "parenteral", t)
            self.assertNotIn("Especial exemplo", c["valores"], t)
        self.assertNotIn("ativo", self.cols("PRVIAADMIN", "via_dieta"))
        self.assertEqual(self.cols("TBDIETAS", "modalidade_dieta")["ativo"]["coluna"], "SITUACAO")

    def test_ordem_em_texto(self):
        # ORDEM é VARCHAR na origem: texto não numérico vira NULL com valor_fora_do_dominio (tipar), sem exceção
        self.assertEqual(self.cols("PRCARACT_TBDIETAS", "modalidade_dieta_caracteristica")["ordem"]["regra"], "texto")
        self.assertIs(carga_mapa.tipar("2º", "smallint"), carga_mapa.NAO_NUMERICO)
        self.assertIs(carga_mapa.tipar("1.0", "smallint"), carga_mapa.NAO_NUMERICO)

    def test_horario_padrao(self):
        c = self.cols("PRHORPAD", "horario_refeicao")
        self.assertEqual(c["horario_inicio"]["regra"], "hora_hhmm")
        self.assertEqual(c["horario_corte_mapa"]["coluna"], "HORARIO")
        self.assertEqual(c["horario_fim"]["coluna"], "=~23:59:59")
        self.assertEqual(c["estabelecimento_id"]["coluna"], "@estabelecimento")
        self.assertEqual(c["refeicao_do_dia_id"]["referencia"], "PRTPREFEIC")

    def test_vigencia_sem_fonte(self):
        c = self.cols("TBLEITO_CHPROFISLIMP", "leito_profissional_higienizacao")
        self.assertEqual(c["vigencia_inicio"]["coluna"], "@vigencia_carga")

    def test_limpeza_referencias_declaradas(self):
        sit = self.cols("CHSOLICITLIMP", "solicitacao_limpeza")["situacao_limpeza_id"]
        self.assertEqual(sit["referencia"], "CHEXECLIMPEZA.ID_CHSOLICITLIMP>ID_CHSITUACAO>CHSITUACAO")
        self.assertEqual([p.get("tabela") or p.get("coluna") for p in sit["passos"]],
                         ["CHEXECLIMPEZA", "ID_CHSITUACAO", "CHSITUACAO"])
        self.assertEqual(sit["passos"][0]["modo"], "alt")
        self.assertEqual(self.cols("CHSOLICITLIMP", "solicitacao_limpeza")["solicitante_usuario_id"]["referencia"],
                         "TBUSERS")
        self.assertEqual(self.cols("CHSOLICITLIMP", "solicitacao_limpeza")["motivo_geracao"]["coluna"], "=~manual")
        mod = self.cols("CHEXECLIMPEZA", "execucao_limpeza")["modalidade_limpeza_id"]
        self.assertEqual(mod["referencia"], "CHSOLICITLIMP>ID_CHTPLIMPEZA>CHTPLIMPEZA")
        # quem executou: login > usuário > profissional pela chave alternativa do destino; nunca a auditoria
        ex = self.cols("CHEXECLIMPEZA", "execucao_limpeza")
        self.assertEqual(ex["profissional_higienizacao_id"]["coluna"], "USUARIO_EXECUTANTE")
        self.assertEqual(ex["profissional_higienizacao_id"]["referencia"], "TBUSERS")
        self.assertEqual(ex["profissional_higienizacao_id"]["cod"], ("profissional_higienizacao", "usuario_id"))
        self.assertNotIn("criado_por", ex)
        self.assertEqual(self.cols("CHSOLICITLIMP_TBLEITO", "solicitacao_limpeza_local")["sequencia"]["coluna"],
                         "#seq:ID_CHSOLICITLIMP")

    def test_continuidade_r5(self):
        # ADR 0006: nada da fatia fica em sem_carga.tsv; parâmetros e lista entram pela definição do produto
        sc = {r["tabela"] for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        self.assertFalse({"TBTPDIETA", "CHPARAM", "CVPARAM"} & sc)
        self.assertEqual(DESCARTADAS, set())
        # rodada 6: TBTPDIETA é a lista do produto 'nutricao.tipoDieta' (definição adotada pela chave); CHPARAM e
        # CVPARAM gravam UM valor por chave do produto (desdobrar), com a definição achada pela chave
        # (cod:parametro_definicao.chave), nunca a linha inteira em JSON numa chave da migração
        self.assertEqual(self.plano["TBTPDIETA"]["destinos"][0], "parametro_opcao")
        c = {x["destino"]: x for x in self.mapa["colunas_decl"] if x["tabela"] == "TBTPDIETA"}
        self.assertEqual(c["parametro_definicao.chave"]["coluna"], "=nutricao.tipoDieta")
        for t in ("CHPARAM", "CVPARAM"):
            self.assertEqual(self.plano[t]["destinos"][0], "parametro_valor", t)
            c = {}
            for x in self.mapa["colunas_decl"]:
                if x["tabela"] == t:
                    c.setdefault(x["destino"], x)  # a primeira declarada do destino: o desdobrar geral
            self.assertEqual(c["parametro_valor.valor"]["coluna"], "#item", t)
            # recusas-fase2 C1c (pedido 2 do K2): as chaves booleanas têm declaração própria (#item@CHAVE) depois
            especificas = [x["coluna"] for x in self.mapa["colunas_decl"]
                           if x["tabela"] == t and x["destino"] == "parametro_valor.valor"][1:]
            self.assertEqual(especificas, ITEM_ESPECIFICO.get(t, []), t)
            self.assertIn("desdobrar:", c["parametro_valor.valor"]["via"], t)
            self.assertEqual(c["parametro_valor.parametro_definicao_id"]["coluna"], "#rotulo", t)
            self.assertIn("cod:parametro_definicao.chave", c["parametro_valor.parametro_definicao_id"]["via"], t)
            self.assertNotIn("parametro_definicao.chave", c, t)
        c = {x["destino"]: x for x in self.mapa["colunas_decl"] if x["tabela"] == "CVPARAM"}
        # a senha mestra nunca vira valor de parâmetro: só o cofre (ADR 0007, 17)
        self.assertNotIn("SENHA_MASTER_LIB_VISITA", c["parametro_valor.valor"]["via"])
        self.assertEqual(c["credencial_integracao.referencia_cofre"]["coluna"], "#cofre:SENHA_MASTER_LIB_VISITA")
        # o literal da descrição da credencial é o texto exato (já esteve estragado: "=S (origem)enha ...")
        self.assertEqual(c["credencial_integracao.descricao"]["coluna"], "=Senha mestra de liberação de visita")

    def test_referencias(self):
        refs = {("TBDIETAS", "modalidade_dieta", "local_estoque_id"): "GELOCARM",
                ("PRCARACT_TBDIETAS", "modalidade_dieta_caracteristica", "modalidade_dieta_id"): "TBDIETAS",
                ("PRCARACT_TBDIETAS", "modalidade_dieta_caracteristica", "caracteristica_dieta_id"): "PRCARACTDIE",
                ("CHTPLIMPEZA_GEITENS", "material_modalidade_limpeza", "modalidade_limpeza_id"): "CHTPLIMPEZA",
                ("CHTPLIMPEZA_GEITENS", "material_modalidade_limpeza", "insumo_id"): "GEITENS"}
        for (t, dt, dc), pai in refs.items():
            self.assertEqual(self.cols(t, dt)[dc]["referencia"], pai, (t, dc))

    def test_unica_alimentadora(self):
        for t, dt in [("PRTPREFEIC", "refeicao_do_dia"), ("RISETOR", "setor_tramite"), ("PRVIAADMIN", "via_dieta"),
                      ("TBDIETAS", "modalidade_dieta")]:
            outras = {c["tabela"] for c in self.mapa["colunas_decl"]
                      if (c.get("destino") or "").startswith(dt + ".")} - {t}
            self.assertEqual(outras, set(), dt)

    def test_tramite_do_prontuario(self):
        # um volume de prontuário antigo por paciente, gravado antes do movimento e adotado nas seguintes
        p = self.plano["GDPRONTMOVIM"]
        op = mapa.opcoes_destino(self.mapa_decl("GDPRONTMOVIM"))["volume_prontuario"]
        self.assertTrue(op["antes"])
        self.assertEqual(op["adotar"], ["estabelecimento_id", "paciente_id", "tipo_documento_arquivo_id",
                                        "numero_volume"])
        m = self.cols("GDPRONTMOVIM", "movimento_prontuario")
        self.assertEqual(m["volume_prontuario_id"]["coluna"], "@id:volume_prontuario")
        self.assertEqual(m["excluido_em"]["regra"], "booleano_sn")
        v = self.cols("GDPRONTMOVIM", "volume_prontuario")
        self.assertEqual(v["tipo_documento_arquivo_id"]["coluna"], "=prontuario-antigo")
        self.assertEqual(v["numero_volume"]["coluna"], "=1")
        pares = {x["valor_origem"]: x["valor_destino"] for x in self.mapa["valores"]
                 if x["tabela"] == "GDPRONTMOVIM" and x["coluna"] == "EXCLUIDO"}
        self.assertEqual(pares, {"1": "@data_carga", "0": "", "": ""})
        # setores de trâmite lidos (no hash) e sem destino até o modelo ganhar as colunas (pedido 2 do L6-18.json)
        semdest = {c["coluna"] for c in self.mapa_decl("GDPRONTMOVIM") if not c.get("destino")}
        # guarda: chegando as colunas ao DDL (pedido 2, F2.2), os setores PRECISAM ganhar destino (pré-requisito da
        # virada do módulo de arquivo); sem elas, ficam lidos e sem destino
        raiz = next((r for r in (Path(__file__).resolve().parents[2], Path("/app")) if (r / "db/migracoes").is_dir()),
                    None)
        self.assertIsNotNone(raiz, "DDL do modelo ausente: a guarda dos setores de trâmite não pode rodar")
        cols_mov = mapa.ler_ddl(raiz)["movimento_prontuario"]["colunas"]
        destinos = {c["coluna"]: c.get("destino") for c in self.mapa_decl("GDPRONTMOVIM")}
        for col, dc in [("ID_RISETOR_ORIGEM", "saida_setor_tramite_id"),
                        ("ID_RISETOR_DESTINO", "destino_setor_tramite_id")]:
            if dc in cols_mov:
                self.assertEqual(destinos[col], "movimento_prontuario." + dc, col)
            else:
                self.assertIn(col, semdest)
        self.assertIn("ID_RIMOTIVO", semdest)
        self.assertEqual(p["destinos"][0], "movimento_prontuario")

    def mapa_decl(self, t):
        return [c for c in self.mapa["colunas_decl"] if c["tabela"] == t]

    def test_bloqueadas_e_descartadas_sem_destino(self):
        # descartadas em declarado/sem_carga.tsv
        fora = BLOQUEADAS | DESCARTADAS
        self.assertFalse(fora & set(self.plano))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in fora and c.get("destino")])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Almoço   principal ".encode("cp1252")), ("Almoço principal", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("texto", 12), ("12", None))
        self.assertEqual(a("booleano_ai", b"A"), (True, None))
        self.assertEqual(a("booleano_ai", b"I"), (False, None))
        self.assertEqual(a("booleano_ai", b"X")[1], "valor_fora_do_dominio")
        self.assertEqual(carga_mapa.tipar("3", "smallint"), 3)
        self.assertEqual(a("hora_hhmm", "0700")[0], datetime.time(7, 0))
        self.assertEqual(a("hora_hhmm", "2575")[1], "hora_invalida")
        self.assertEqual(a("booleano_sn", b"X")[1], "valor_fora_do_dominio")


DESDOBRADAS = {"CHPARAM", "CVPARAM"}
R9_GRAVADAS = {"PRHORPAD": 1}


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_18.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(BLOQUEADAS | DESCARTADAS <= set(cont))
        for t, e in esp.items():
            if t in DESDOBRADAS:
                continue
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            # R9 (recusas-fase2): linha gravada com a coluna anulável NULL e pai_pendente (PRHORPAD 7, dieta recusada)
            self.assertEqual(cont[t], e["gravados"] + recusas - R9_GRAVADAS.get(t, 0), t)
        # desdobradas (rodada 6): "gravados" conta itens (uma linha do destino por coluna com valor), de uma linha só
        self.assertEqual({t: cont[t] for t in DESDOBRADAS}, {"CHPARAM": 1, "CVPARAM": 1})
        self.assertEqual({t: esp[t]["gravados"] for t in DESDOBRADAS}, {"CHPARAM": 2, "CVPARAM": 10})

    def test_sinonimos_do_tipo_de_dieta_r5(self):
        # r5 (achado; ADR 0007, 18): siglas e nomes usuais do domínio têm par nas duas consumidoras; o tipo próprio
        # sem par continua visível (valor_fora_do_dominio), nunca presumido
        pl = {p["tabela"]: p for p in carga_mapa.planejar(mapa.carregar_execucao(), TABELAS | BLOQUEADAS | DESCARTADAS)}
        for t, dt, dc in [("PRVIAADMIN", "via_dieta", "modalidade"), ("TBDIETAS", "modalidade_dieta", "classe")]:
            # a primeira declarada do destino (pelo tipo de dieta); a concorrente da PRVIAADMIN (pelo NOME, P2b) vem depois
            v = [c for c in pl[t]["colunas"][dt] if c["destino"] == dc][0]["valores"]
            for o, d in [("SNE", "enteral"), ("NPT", "parenteral"), ("VO", "oral"), ("Dieta zero", "jejum")]:
                self.assertEqual(v.get(o), d, (t, o))
            self.assertNotIn("Especial exemplo", v)


if __name__ == "__main__":
    unittest.main()
