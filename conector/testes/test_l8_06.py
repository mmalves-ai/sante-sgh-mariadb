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
# sem regra do motor (pedidos em docs/obra/fatias/f4/saida/L8-06.json): declaração pronta, comentada
BLOQUEADAS = {"FCCTAAUD", "FCCTAEXT", "FCLANAUD", "FCLANEXT", "RICONTAS", "FCINTEGRPA", "FCTISSLOTEPROT",
              "TBHISTTABDTH", "TBHISTTABMM", "TBHISTTABTHME", "TBHISTTABTHMI",
              "REPROEXT", "RIPROEXT"}  # as duas últimas: complemento do item de FCLANEXT (não mais descarte)
DESCARTES = {"FCLANEXTSEQITEM": "sem_valor", "TBHISTBR": "licenciado"}
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
        for dc, ref in [("tipo_lancamento_id", "TBTPLANC"), ("funcao_equipe_cobranca_id", "TBGRAUPARTPROC"),
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

    def test_bloqueadas_comentadas_e_descartes(self):
        self.assertFalse(BLOQUEADAS & set(self.plano))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in BLOQUEADAS | set(DESCARTES)])
        texto = (RAIZ / "mapa/declarado/colunas.d/L8-06.tsv").read_text(encoding="utf-8")
        for t in BLOQUEADAS:
            self.assertIn("#%s\t-\t" % t, texto, t)  # causa da falta de regra do motor, para a cobertura
        sc = {r["tabela"]: r for r in mapa.ler_tsv(RAIZ / "mapa/declarado/sem_carga.tsv")}
        for t, causa in DESCARTES.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(sc[t]["motivo"].startswith("L8-06"))


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
            if t == "TBTISSWEBSERV" and l8_06.REFERENCIA_OBRIGATORIA:
                recusas += 2  # transação nunca vista para a mesma fonte: recusada com a referência obrigatória
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
