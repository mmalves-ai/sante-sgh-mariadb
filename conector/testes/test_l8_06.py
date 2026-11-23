"""Fatia L8-06 (faturamento e restantes, módulo FAT): declarações planejadas, regras das colunas, descartes e coerência
da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia
L8-06`."""
import datetime
import random
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_06

TABELAS = set(l8_06.CARREGADAS)
# rodada 3: nenhum descarte e nenhuma bloqueada (FCLANEXTSEQITEM e TBHISTBR carregam como trilha)
BLOQUEADAS = set()
DESCARTES = {}
C = "credencial_fonte_pagadora"
E = "endpoint_tiss_fonte_pagadora"
RAIZ = Path(__file__).resolve().parents[1]


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS | set(DESCARTES))}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        self.assertEqual(self.plano["TBTISSWEBSERV"]["destinos"], [E, C])
        self.assertEqual(self.plano["TBREPGER"]["destinos"], ["regra_repasse", "regra_repasse_item"])
        self.assertEqual(self.plano["HTPROCTO"]["destinos"], ["trilha_auditoria"])  # nunca item novo por versão

    def test_endpoint_tiss(self):
        cs = self.cols("TBTISSWEBSERV", E)
        self.assertEqual(cs["estabelecimento_id"]["coluna"], "@estabelecimento")
        self.assertEqual(cs["forma_envio"]["coluna"], "=servico_web")
        self.assertEqual(cs["tipo_autenticacao"]["depara"], "valores")
        lidas = {c["coluna"] for c in self.mapa["colunas_decl"] if c["tabela"] == "TBTISSWEBSERV"}
        self.assertFalse({"SENHA_PRESTADOR", "SENHA_PRESTADOR_PADRAO_HASH_MD5"} & lidas)  # senha só pelo #cofre
        self.assertNotIn("referencia_cofre", cs)
        cr = self.cols("TBTISSWEBSERV", C)
        self.assertEqual(cr["credencial_integracao_id"]["coluna"], "#cofre:SENHA_PRESTADOR")
        self.assertEqual(cr["login"]["coluna"], "LOGIN_PRESTADOR")
        self.assertEqual(cr["tipo_acesso"]["coluna"], "=webservice_tiss")
        self.assertEqual(cr["vigencia_inicio"]["coluna"], "@vigencia_carga")
        self.assertEqual(set(cr["autenticacao"]["valores"].values()), {"basica", "nenhuma"})
        op = mapa.opcoes_destino([c for c in self.mapa["colunas_decl"] if c["tabela"] == "TBTISSWEBSERV"])
        self.assertEqual(op[C]["adotar"], ["estabelecimento_id", "fonte_pagadora_id", "tipo_acesso"])

    def test_periodo_e_pendencia_da_conta(self):
        p = self.cols("FCFAIPAC", "conta_hospitalar_periodo")
        self.assertEqual(p["sequencia"]["coluna"], "#seq:ID_FCCTAEXT")  # SEQ repete entre tipos de lançamento
        self.assertEqual(p["competencia"]["regra"], "data_primeiro_dia_mes")
        self.assertEqual(p["tipo_lancamento_id"]["referencia"], "TBTPLANC")  # o período é de um tipo, não de todos
        self.assertEqual(p["conta_hospitalar_id"]["referencia"], "FCCTAEXT")
        q = self.cols("FCIRREGULARID", "pendencia_conta")
        self.assertEqual(q["situacao"]["coluna"], "=~resolvida")
        self.assertEqual(q["resolvido_em"]["coluna"], "DATA_HORA_FIM")
        self.assertEqual(q["tipo_pendencia_conta_id"]["referencia"], "TBIRREGULARID")

    def test_repasse(self):
        r = self.cols("TBREPGER", "regra_repasse")
        self.assertEqual(r["evento_repasse_id"]["referencia"], "RPEVENTO")
        self.assertEqual(r["beneficiario"]["depara"], "valores")
        i = self.cols("TBREPGER", "regra_repasse_item")
        self.assertEqual(i["regra_repasse_id"]["coluna"], "@id")
        for dc, ref in [("fonte_pagadora_id", "TBCONVEN"), ("especialidade_medica_id", "TBESPEC"),
                        ("unidade_assistencial_id", "TBUNIDAD"), ("centro_custo_id", "TBCENCUS")]:
            self.assertEqual(i[dc]["referencia"], ref, dc)
        self.assertEqual(set(i["escopo_conta"]["valores"].values()), {"internacao", "externa", "todas"})
        self.assertEqual(i["quantidade_final"]["regra"], "decimal_zero_nulo")
        # critérios da regra: nenhum filtro da origem fica de fora (a regra migrada não fica mais ampla)
        for dc, ref in [("tipo_lancamento_id", "TBTPLANC"), ("grupo_ato_id", "TBTABATO"),
                        ("local_atendimento_id", "TBLOCAL"), ("cooperativa_medica_id", "TBCOOPER")]:
            self.assertEqual(i[dc]["referencia"], ref, dc)
        self.assertEqual([x.get("tabela") or x.get("coluna") for x in i["profissional_id"]["passos"]],
                         ["TBCBOPRO", "ID_TBPROFIS", "TBPROFIS"])
        self.assertEqual(i["profissional_id"]["passos"][0]["arg"], "COD")  # código do prestador, não o ID
        pr = self.cols("TBREPGER_TBCBOPRO", "regra_repasse_profissional")
        self.assertEqual([x["tabela"] for x in pr["profissional_id"]["passos"] if "tabela" in x],
                         ["TBCBOPRO", "TBPROFIS"])
        self.assertEqual(pr["vigencia_inicio"]["passos"][-1], {"coluna": "DATA"})

    def test_trilha_e_lote(self):
        t = self.cols("HTPROCTO", "trilha_auditoria")
        self.assertEqual((t["acao"]["coluna"], t["entidade"]["coluna"], t["dados_antes"]["coluna"]),
                         ("=alteracao", "=item_faturavel", "#retrato"))
        lt = self.cols("FCCTAEXT_FCTISSLOTEPROT", "lote_tiss_conta")
        self.assertEqual((lt["lote_tiss_id"]["referencia"], lt["conta_hospitalar_id"]["referencia"]),
                         ("FCTISSLOTEPROT", "FCCTAEXT"))

    def test_sem_bloqueadas_e_descartes(self):
        texto = (RAIZ / "mapa/declarado/colunas.d/L8-06.tsv").read_text(encoding="utf-8")
        for t in TABELAS:
            self.assertNotIn("#%s\t" % t, texto, t)  # nenhuma declaração da fatia fica comentada
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in DESCARTES])
        sc = {r["tabela"]: r for r in mapa.ler_tsv(RAIZ / "mapa/declarado/sem_carga.tsv")}
        for t, causa in DESCARTES.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(sc[t]["motivo"].startswith("L8-06"))
        for t in BLOQUEADAS:  # nunca descarte: o dado carrega quando o pedido for atendido
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("bloqueada", "mecanismo_pedido"), t)
            self.assertIn("#%s\t" % t, texto, t)  # declaração pronta, comentada

    def test_conta_e_guia_da_internacao(self):
        self.assertEqual(self.plano["RICONTAS"]["destinos"], ["conta_hospitalar", "tipo_conta", "atendimento_conta"])  # pedido L6-02: vínculo opcional
        c = self.cols("RICONTAS", "conta_hospitalar")
        self.assertEqual(c["tipo_conta_id"]["coluna"], "@id:tipo_conta")  # criado uma vez e adotado, nunca duplicado
        self.assertEqual(c["natureza"]["coluna"], "=internacao")
        op = mapa.opcoes_destino([x for x in self.mapa["colunas_decl"] if x["tabela"] == "RICONTAS"])
        self.assertEqual(op["tipo_conta"]["adotar"], ["codigo"])
        s = self.cols("FCDIAINT", "conta_hospitalar_segurado")
        self.assertEqual(s["conta_hospitalar_id"]["passos"][0]["modo"], "alt_composta")
        self.assertEqual(s["numero_carteira"]["passos"][-1], {"coluna": "MATRIC"})
        self.assertEqual(self.cols("FCDIAINT", "conta_hospitalar")["observacao"]["coluna"], "DIAG")
        g = self.cols("RICGUIAS", "guia_fonte_pagadora")
        self.assertEqual(g["tipo_guia"]["coluna"], "=internacao")
        self.assertEqual([x.get("tabela") for x in g["paciente_id"]["passos"] if "tabela" in x], ["RICADINT", "RICADPAC"])

    def test_lote_acordo_itens_e_auditoria(self):
        lt = self.cols("FCTISSLOTEPROT", "lote_tiss")
        self.assertEqual(lt["versao_padrao_tiss_id"]["depara"], "versao_tiss")
        self.assertEqual(set(lt["tipo_guia"]["valores"].values()),
                         {"consulta", "sp_sadt", "resumo_internacao", "honorario_individual"})
        for t in ("TBHISTTABDTH", "TBHISTTABMM", "TBHISTTABTHME", "TBHISTTABTHMI"):
            self.assertEqual(self.plano[t]["destinos"], ["contrato_tabela_vigencia", "contrato_fonte_pagadora"], t)
            op = mapa.opcoes_destino([x for x in self.mapa["colunas_decl"] if x["tabela"] == t])
            self.assertEqual(op["contrato_fonte_pagadora"]["adotar"], ["estabelecimento_id", "numero"], t)
        it = self.cols("FCLANEXT", "conta_hospitalar_item")
        self.assertEqual(it["sequencia"]["coluna"], "#seq:ID_FCCTAEXT")
        self.assertEqual(self.plano["FCLANEXT"]["destinos"], ["conta_hospitalar_item", "trilha_auditoria"])
        sit = [c for c in self.plano["FCLANEXT"]["colunas"]["conta_hospitalar_item"] if c["destino"] == "situacao"]
        self.assertEqual(sit[0]["valores"], {"1": "glosado", "0": "lancado", "": "lancado"})  # C12: só com motivo
        self.assertEqual([c["coluna"] for c in sit], ["GLOSADO", "=lancado", "=~lancado"])
        self.assertEqual(tuple(it["motivo_glosa_id"]["cod"]), ("motivo_glosa", "codigo_tuss"))
        self.assertEqual(it["tecnica_termo_terminologia_id"]["depara"], "tiss:48")
        tr = self.cols("FCLANEXT", "trilha_auditoria")
        self.assertEqual((tr["entidade"]["coluna"], tr["entidade_id"]["coluna"]), ("=conta_hospitalar_item", "@id"))
        self.assertTrue(mapa.opcoes_destino([x for x in self.mapa["colunas_decl"]
                                             if x["tabela"] == "FCLANEXT"])["trilha_auditoria"]["opcional"])
        pr = self.cols("FCINTEGRPA", "producao_repasse")
        # C11: função = titular (tipo de profissional 1), nunca o ATO do item (grupo de ato, não grau de participação)
        self.assertEqual(pr["funcao_equipe_cobranca_id"]["coluna"], "=tipo_prof_1")
        self.assertEqual(tuple(pr["funcao_equipe_cobranca_id"]["cod"]), ("funcao_equipe_cobranca", "codigo"))
        self.assertEqual(self.plano["FCLANAUD"]["destinos"], ["trilha_auditoria"])
        self.assertEqual(self.cols("FCLANAUD", "trilha_auditoria")["dados_antes"]["coluna"], "#retrato:*")
        for t, ent in (("FCLANEXTSEQITEM", "=conta_hospitalar_item"), ("TBHISTBR", "=tabela_preco")):
            self.assertEqual(self.plano[t]["destinos"], ["trilha_auditoria"], t)
            self.assertEqual(self.cols(t, "trilha_auditoria")["entidade"]["coluna"], ent, t)
            self.assertEqual(self.cols(t, "trilha_auditoria")["dados_depois"]["coluna"], "#retrato:*", t)
        for t in ("REPROEXT", "RIPROEXT"):
            self.assertEqual(self.cols(t, "conta_hospitalar_item")["tecnica_termo_terminologia_id"]["depara"], "tiss:48")

class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto", b"  https://x.exemplo.invalid/ws  "), ("https://x.exemplo.invalid/ws", None))
        self.assertEqual(a("decimal_zero_nulo", 0), (None, None))
        self.assertEqual(a("inteiro_zero_nulo", 0), (None, None))
        self.assertEqual(str(a("data_primeiro_dia_mes", datetime.datetime(2025, 3, 17, 8))[0]), "2025-03-01")
        self.assertEqual(a("hora_hhmm", 700)[0].strftime("%H:%M"), "07:00")


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_06.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertEqual(set(cont) - TABELAS, set(l8_06.CADEIA))
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            if t in ("FCDIAINT", "REPROEXT"):  # complementa sem a linha do pai: recusa com pai_inexistente
                recusas += e["pendencias"].get("pai_inexistente", 0)
            if t == "TBTISSWEBSERV" and l8_06.REFERENCIA_OBRIGATORIA:
                recusas += 2  # transação nunca vista para a mesma fonte: recusada com a referência obrigatória
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
