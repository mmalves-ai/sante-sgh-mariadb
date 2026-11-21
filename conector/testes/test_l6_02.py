"""Fatia L6-02 (recepção: recepções, guichês, locais, painéis, geradores e senhas): declarações planejadas, regras e
de-para de valores das colunas e coerência da imagem sintética. Sem banco; só valores inventados. A carga e a
conciliação rodam em `conector.sh conferir-fatia L6-02`."""
import csv
import datetime
import json
import pathlib
import random
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_01, l6_02

TABELAS = set(l6_02.CARREGADAS)
PARES = {  # de-para de valores pedido ao integrador (declarado/valores.tsv; L6-02.json)
    ("TBGERASENHA", "TIPO", "gerador_senha.tipo"): {"0": "geral", "2": "profissional", "3": "especialidade",
                                                    "4": "agenda", "5": "diverso"},
    ("TBSENHAATEND", "PRIORIDADE", "senha_emitida.prioritaria"): {"0": "1", "1": "1", "2": "0"},
    ("TBSENHAATEND", "SITUACAO", "senha_emitida.situacao"): {"": "aguardando", "G": "aguardando", "C": "chamada",
                                                             "A": "em_atendimento", "L": "atendida",
                                                             "S": "suspensa"},
}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | set(l6_02.BLOQUEADAS)
                                                                         | set(l6_02.DESCARTADAS))}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        self.assertEqual(self.plano["TBSENHAATEND"]["destinos"], ["senha_emitida"])
        self.assertEqual(self.plano["TBSENHAATEND_REPACAGD"]["destinos"], ["senha_emitida_marcacao"])
        self.assertEqual(self.plano["TBSENHAATEND_SIPACAGD"]["destinos"], ["senha_emitida_marcacao"])
        self.assertEqual(self.plano["TBFLUXOATEND"]["destinos"], ["evento_senha"])
        # o histórico vai só para a trilha: o segundo destino do mapa (atendimento) criaria atendimentos falsos
        self.assertEqual(self.plano["HTATENDIMENTO"]["destinos"], ["trilha_auditoria"])
        # rodada 5 (correção): tipo de atendimento no cadastro de tipos (categoria_atendimento), inativo; nunca
        # como módulo de recepção
        self.assertIn("TBTIPO_ATENDIMENTO", l6_02.CARREGADAS)
        self.assertEqual(self.plano["TBTIPO_ATENDIMENTO"]["destinos"][0], "categoria_atendimento")
        self.assertNotIn("modulo_recepcao", {c["destino"].split(".")[0] for c in self.mapa["colunas_decl"]
                                             if c["tabela"] == "TBTIPO_ATENDIMENTO" and c.get("destino")})

    def test_obrigatorias_do_destino_cobertas(self):
        obrig = {("TBRECEPCAO", "ponto_recepcao"): {"estabelecimento_id", "codigo", "descricao"},
                 ("TBGUICHE", "guiche_recepcao"): {"ponto_recepcao_id", "numero"},
                 ("TBLOCAL", "local_atendimento"): {"estabelecimento_id", "ponto_recepcao_id", "codigo", "descricao"},
                 ("PNCONFIG", "painel_chamada"): {"estabelecimento_id", "tipo_painel_id", "descricao"},
                 ("TBGERASENHA", "gerador_senha"): {"ponto_recepcao_id", "descricao", "prefixo"},
                 ("TBSENHAATEND", "senha_emitida"): {"estabelecimento_id", "gerador_senha_id", "data_referencia",
                                                     "numero", "codigo_exibicao", "emitida_em"},
                 ("ATCABECATEND_TBSENHAATEND", "atendimento_senha"): {"atendimento_id", "senha_emitida_id"},
                 ("TBSENHAATEND_SIPACAGD", "senha_emitida_marcacao"): {"senha_emitida_id", "marcacao_horario_id"},
                 ("TBFLUXOATEND", "evento_senha"): {"senha_emitida_id", "operacao", "ocorrido_em",
                                                    "acao_fluxo_senha_id", "local_atendimento_id"},
                 ("HTATENDIMENTO", "trilha_auditoria"): {"ocorrido_em", "acao", "entidade"}}
        for (t, dt), cs in obrig.items():
            self.assertTrue(cs <= set(self.cols(t, dt)), (t, cs - set(self.cols(t, dt))))

    def test_referencias(self):
        c = self.cols("TBSENHAATEND", "senha_emitida")
        self.assertEqual((c["emitida_usuario_id"]["regra"], c["emitida_usuario_id"]["referencia"]),
                         ("chave_origem", "TBUSERS"))
        self.assertEqual(c["gerador_senha_id"]["referencia"], "TBGERASENHA")
        self.assertEqual(c["estabelecimento_id"]["coluna"], "@estabelecimento")
        e = self.cols("TBLOCALENCATE", "local_atendimento_encaminhamento")
        self.assertEqual({e["local_atendimento_id"]["referencia"], e["destino_local_atendimento_id"]["referencia"]},
                         {"TBLOCAL"})
        self.assertEqual(self.cols("TBSENHAATEND_SIPACAGD", "senha_emitida_marcacao")["marcacao_horario_id"]["referencia"],
                         "SIPACAGD")

    def test_evento_e_historico(self):
        f = self.cols("TBFLUXOATEND", "evento_senha")
        self.assertEqual(f["acao_fluxo_senha_id"]["passos"], [{"tabela": "TBACAOFLUXOSENHA", "modo": "alt", "arg": "SIGLA"}])
        self.assertEqual(f["acao_fluxo_senha_id"]["regra"], "chave_origem")
        self.assertEqual((f["usuario_id"]["referencia"], f["senha_emitida_id"]["referencia"],
                          f["local_atendimento_id"]["referencia"]), ("TBUSERS", "TBSENHAATEND", "TBLOCAL"))
        self.assertEqual((f["operacao"]["coluna"], f["ocorrido_em"]["regra"]), ("=inclusao", "data_hora"))
        h = self.cols("HTATENDIMENTO", "trilha_auditoria")
        self.assertEqual((h["acao"]["coluna"], h["entidade"]["coluna"], h["dados_antes"]["coluna"]),
                         ("=alteracao", "=atendimento", "#retrato:*"))
        self.assertEqual(h["entidade_id"]["referencia"], "ATCABECATEND")
        # o histórico é a versão ANTERIOR: retrato em dados_antes, como HTPROCTO (L8-06); dados_depois nulo
        self.assertNotIn("dados_depois", h)
        # retrato COMPLETO da versão anterior (todas as colunas da origem, sem segredo)
        self.assertEqual(mapa.spec_retrato("#retrato:*"), {"todas": True, "exceto": [], "extras": []})

    def test_horario_do_local_em_pares(self):
        c = self.cols("TBLOCALHORA", "local_atendimento_horario")
        self.assertEqual(self.plano["TBLOCALHORA"]["destinos"], ["local_atendimento_horario"])
        self.assertEqual(c["local_atendimento_id"]["referencia"], "TBLOCAL")
        self.assertEqual({k: c[k]["coluna"] for k in ("hora_inicio", "hora_fim", "dia_semana", "dia_nao_util")},
                         {"hora_inicio": "#item", "hora_fim": "#item2", "dia_semana": "#rotulo",
                          "dia_nao_util": "#rotulo2"})
        self.assertEqual((c["hora_inicio"]["regra"], c["hora_fim"]["regra"]), ("hora", "hora"))
        via = next(d["via"] for d in self.mapa["colunas_decl"] if d["tabela"] == "TBLOCALHORA" and d["coluna"] == "#item")
        pares = dict(p.split("=") for p in via.split(":", 1)[1].split(","))
        # 7 dias + feriado; 1 domingo a 7 sábado (CHECK do destino); feriado: dia_semana nulo, dia não útil
        self.assertEqual(len(pares), 8)
        self.assertEqual(sorted(v for k, v in pares.items() if not k.startswith("FERIADO")),
                         ["%d|0" % d for d in range(1, 8)])
        self.assertEqual(pares["FERIADO_INICIO+FERIADO_FINAL"], "|1")
        for k in pares:
            a, b = k.split("+")
            self.assertEqual((a.rsplit("_", 1)[1], b.rsplit("_", 1)[1], a.rsplit("_", 1)[0]),
                             ("INICIO", "FINAL", b.rsplit("_", 1)[0]))

    def test_descartes_com_causa_de_produto(self):
        # no sem_carga.tsv ou, até o integrador aplicar, no pedido do L6-02.json; nunca "bloqueada esperando decisão"
        raiz = pathlib.Path(mapa.__file__).resolve().parents[1]
        with open(raiz / "mapa/declarado/sem_carga.tsv", encoding="utf-8") as f:
            sc = {r["tabela"]: r for r in csv.DictReader(f, delimiter="\t")}
        js = next((r / "docs/obra/fatias/f4/saida/L6-02.json" for r in (raiz.parent, raiz)
                   if (r / "docs/obra/fatias/f4/saida/L6-02.json").exists()), None)
        pedido = ""
        if js is None and not set(l6_02.DESCARTADAS) <= set(sc):
            self.skipTest("pedido do L6-02.json fora do container (docs/ não montado); conferido no repositório")
        if js:
            pedido = " ".join(p["mudanca"] for p in json.loads(js.read_text(encoding="utf-8"))["pedidos"]
                              if "sem_carga" in p["arquivo"])
        causas = {"sem_valor", "duplicado", "licenciado", "catalogo_oficial", "mecanismo_do_produto"}
        for t in l6_02.DESCARTADAS:
            if t in sc:
                self.assertEqual(sc[t]["situacao"], "descarte", t)
                self.assertIn(sc[t]["causa"], causas, t)
            else:
                self.assertTrue(re.search(r"(^|\n)%s\tdescarte\t(%s)\t\S" % (t, "|".join(causas)), pedido), t)

    def test_atconta_so_descartada_com_atendimento_conta_declarada(self):
        # ATCONTA só é descarte `duplicado` com outra fonte de atendimento_conta DECLARADA (carga das contas, L8-05 e
        # L8-06); pedido aberto não basta: sem a fonte, o atendimento migrado com conta apareceria sem conta e poderia
        # ser excluído (porta-propria.ts consulta atendimento_conta). Até lá: BLOQUEADA em sem_carga.tsv
        raiz = pathlib.Path(mapa.__file__).resolve().parents[1]
        with open(raiz / "mapa/declarado/sem_carga.tsv", encoding="utf-8") as f:
            sc = {r["tabela"]: r for r in csv.DictReader(f, delimiter="\t")}
        fonte = {c["tabela"] for c in self.mapa["colunas_decl"] if c["tabela"] != "ATCONTA"
                 and c.get("destino") in ("atendimento_conta.conta_hospitalar_id", "atendimento_conta.atendimento_id")}
        completa = {t for t in fonte if {c["destino"] for c in self.mapa["colunas_decl"] if c["tabela"] == t}
                    >= {"atendimento_conta.conta_hospitalar_id", "atendimento_conta.atendimento_id"}}
        if completa >= {"FCCTAEXT", "RICONTAS"}:
            # fonte declarada: ATCONTA é descarte `duplicado` só com a PROVA derivado declarada (ADR 0006, 1)
            pv = {x["tabela"]: x for x in self.mapa.get("provas") or []}
            self.assertEqual((pv["ATCONTA"]["tipo"], pv["ATCONTA"]["chave"]), ("derivado", ["ID_ATCABECATEND", "COD_CONTA"]))
            self.assertIn("atendimento_conta", pv["ATCONTA"]["sql"])
            return
        self.assertIn("ATCONTA", sc)
        self.assertEqual(sc["ATCONTA"]["situacao"], "bloqueada")
        self.assertIn("ATCONTA", l6_02.BLOQUEADAS)
        self.assertNotIn("ATCONTA", l6_02.DESCARTADAS)

    def test_contadores_da_recepcao_em_sequencia_inativa(self):
        c = self.cols("REPARAM", "sequencia_negocio")
        self.assertEqual(self.plano["REPARAM"]["destinos"], ["sequencia_negocio"])
        self.assertEqual((c["proximo_valor"]["coluna"], c["proximo_valor"]["regra"]), ("#item", "inteiro_nao_negativo"))
        self.assertEqual(c["tipo"]["coluna"], "#rotulo")
        self.assertEqual(c["ativo"]["coluna"], "=~0")   # inativa e presumida: o cliente confere antes de ligar
        via = next(x for x in self.mapa["colunas_decl"] if x["tabela"] == "REPARAM" and x["coluna"] == "#item")["via"]
        rot = dict(p.split("=") for p in via.split("desdobrar:")[1].split(";")[0].split(","))
        self.assertEqual(set(rot), {"ULTPRONT", "ULTREG", "ULTPRTFAM", "PRTANT", "PRT_OTMU", "PRTA_OTMU",
                                    "CTR_PAG_REG"})
        for col, tipo in rot.items():   # nome de negócio, nunca o nome da coluna da origem (regra 1)
            self.assertTrue(tipo.startswith("origem_recepcao_") and len(tipo) <= 60, col)
            self.assertNotIn(col.lower(), tipo)
        self.assertEqual(len(set(rot.values())), len(rot))

    def test_de_para_de_valores(self):
        for (t, col, dest), pares in PARES.items():
            c = self.cols(t, dest.split(".")[0])[dest.split(".")[1]]
            self.assertEqual((c["coluna"], c["regra"], c["depara"]), (col, "codigo_char", "valores"))
            if c["valores"]:  # depois que o integrador acrescentar os pares
                self.assertEqual(c["valores"], pares)

    def test_situacao_nunca_cancelada_sem_motivo(self):
        # CHECK ck_senha_emitida_cancelamento: cancelada exige motivo de cancelamento, que a origem não tem
        self.assertNotIn("cancelada", PARES[("TBSENHAATEND", "SITUACAO", "senha_emitida.situacao")].values())

    def test_situacoes_dentro_do_check_do_modelo(self):
        # a última definição de ck_senha_emitida_situacao nas migrações (03_tabelas.sql acrescenta 'suspensa')
        defs = []
        aqui = pathlib.Path(mapa.__file__).resolve()
        raiz = next(r for r in (aqui.parents[1], aqui.parents[2]) if (r / "db" / "migracoes").is_dir())  # container | repo
        for arq in mapa._arquivos_ddl(raiz):
            defs += re.findall(r"ck_senha_emitida_situacao CHECK \(situacao IN \(([^)]*)\)", arq.read_text(encoding="utf-8"))
        self.assertTrue(defs)
        permitidas = set(re.findall(r"'(\w+)'", defs[-1]))
        sits = set(PARES[("TBSENHAATEND", "SITUACAO", "senha_emitida.situacao")].values())
        self.assertLessEqual(sits, permitidas)
        self.assertIn("suspensa", sits)

    def test_prioridade_sem_grupo_declarado(self):
        # perda registrada (pedido no L6-02.json): o grupo legal não vai para a senha até haver de-para antes da referência
        self.assertNotIn("grupo_prioridade_legal_id", self.cols("TBSENHAATEND", "senha_emitida"))

    def test_literais_presumidos(self):
        self.assertEqual(self.cols("PNCONFIG", "painel_chamada")["descricao"]["coluna"], "=~Painel de chamada")
        self.assertEqual(self.cols("TBGERASENHA", "gerador_senha")["descricao"]["coluna"], "=~Gerador de senha")

    def test_bloqueadas_sem_declaracao(self):
        decl = {c["tabela"] for c in self.mapa["colunas_decl"] if c.get("destino")}
        self.assertFalse(decl & (set(l6_02.BLOQUEADAS) | set(l6_02.DESCARTADAS)))


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_longo", b"Aguarde\r\n  pelo painel  "), ("Aguarde\r\n  pelo painel  ", None))
        self.assertEqual(a("texto", b"   "), (None, None))
        self.assertEqual(a("texto", 10), ("10", None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_ai", "I"), (False, None))
        self.assertEqual(a("booleano_ai", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_zero_nulo", 0), (None, None))
        self.assertEqual(a("codigo_char", "G"), ("G", None))
        self.assertEqual(a("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(a("data_hora", datetime.datetime(1899, 12, 30)), (None, "data_sentinela"))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_02.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items()
                          if k.startswith(("restricao_destino_", "pai_pendente", "sem_item_a_gravar")))
            # tabela desdobrada: "gravados" conta itens; a conta é por linha da origem com item
            self.assertEqual(cont[t], l6_02.DESDOBRADAS.get(t, e["gravados"]) + recusas, t)

    def test_ddl_so_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l6_02.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, TABELAS | {"ATCONTA"})   # ATCONTA: só a prova derivado a lê (rodada 5)

    def test_acoes_da_l6_01_que_o_evento_usa(self):
        # o esperado do evento supõe as ações da L6-01 (REQUER): letras únicas, 'c' e 'C' distintas, X recusada, Z ausente
        siglas = [a[1] for a in l6_01.ACOES]
        self.assertEqual(len(siglas), len(set(siglas)))
        self.assertTrue({"C", "c", "A", "F", "X"} <= set(siglas) and "Z" not in siglas)
        self.assertFalse(next(a for a in l6_01.ACOES if a[1] == "X")[2].strip())
        self.assertEqual(l6_02.REQUER, ["L6-01"])
        self.assertNotIn("PNTIPO", l6_02.PAIS_EXTERNOS)  # vem da L6-01 (pai externo duplicaria o conector_origem)

    def test_situacoes_e_prioridades_cobertas(self):
        senhas = []
        l6_02.linhas(random.Random(1), lambda t, v: senhas.append(v) if t == "TBSENHAATEND" else None)
        sits, prios = {v[6] for v in senhas}, {v[5] for v in senhas}
        self.assertTrue(set("GCALS") <= sits and "" in sits and "Z" in sits)
        self.assertEqual(prios, {"0", "1", "2"})


if __name__ == "__main__":
    unittest.main()
