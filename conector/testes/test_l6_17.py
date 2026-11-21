"""Fatia L6-17 (prontuário, assinatura e assistência, módulo HOT): declarações planejadas, regras das colunas e
coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L6-17`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_17

TABELAS = set(l6_17.CARREGADAS)
BLOQUEADAS = set(l6_17.NAO_CARREGADAS)
DESTINO = {"CHCRITICIDADE": "criticidade_area", "CHAREA": "area_higienizavel", "CHOCORRENCIA": "tipo_ocorrencia_limpeza",
           "CHSITUACAO": "situacao_limpeza", "CVTERMINALFAB": "fabricante_terminal_acesso",
           "CVTPIDENTIFIC": "forma_identificacao_visitante", "CVTPSITACESSO": "situacao_acesso_visitante",
           "CVTPTERMINAL": "modelo_terminal_acesso", "CVTPVISITADO": "tipo_visitado", "CVTPVISITANTE": "tipo_visitante",
           "GDPRONTCADOPER": "operacao_movimento_prontuario", "PRCARACTDIE": "caracteristica_dieta",
           "CHTPLIMPEZA": "modalidade_limpeza", "CHPROFISLIMP": "profissional_higienizacao",
           "CHAREA_CHPROFISLIMP": "escala_higienizacao", "CHPROFLIMPTEL": "profissional_higienizacao_telefone"}
# gravados = 0 na imagem sintética só enquanto o pedido de código compartilhado não for aplicado (texto no L6-17.json)
AGUARDA_PEDIDO = {"CHPROFISLIMP": "ck_profissional_higienizacao_vinculo",
                  "CHAREA_CHPROFISLIMP": "ck_profissional_higienizacao_vinculo", "CHPROFLIMPTEL": "#juntar:"}
SEM_CODIGO = {"CHAREA", "CHPROFISLIMP", "CHAREA_CHPROFISLIMP", "CHPROFLIMPTEL"}
PRESUMIDOS = {("CHCRITICIDADE", "classificacao_sanitaria"): "=~critica",
              ("CHOCORRENCIA", "modalidade"): "=~emergencial", ("CHSITUACAO", "etapa"): "=~aguardando",
              ("CVTPSITACESSO", "permite_entrada"): "=~0", ("CVTPTERMINAL", "tipo"): "=~terminal",
              ("CVTPVISITADO", "alvo"): "=~outro", ("CVTPVISITANTE", "categoria"): "=~outro",
              ("GDPRONTCADOPER", "tipo"): "=~registro", ("GDPRONTCADOPER", "sentido"): "=~neutro",
              ("PRCARACTDIE", "categoria"): "=~outra", ("PRCARACTDIE", "tipo_resposta"): "=~nenhuma",
              ("CHTPLIMPEZA", "tipo"): "=~concorrente", ("CHPROFISLIMP", "vinculo"): "=~proprio"}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS)}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][DESTINO[t]]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t, dt in DESTINO.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_codigo_e_descricao_cobertos(self):
        for t in DESTINO:
            if t in SEM_CODIGO:
                continue
            cs = self.cols(t)
            self.assertEqual(cs["codigo"]["regra"], "texto", t)
            self.assertIn("descricao", cs, t)
        self.assertTrue({"estabelecimento_id", "sigla", "nome", "criticidade_area_id"} <= set(self.cols("CHAREA")))
        self.assertIn("ordem", self.cols("CHSITUACAO"))
        self.assertIn("fabricante_terminal_acesso_id", self.cols("CVTPTERMINAL"))

    def test_presumidos_e_estabelecimento(self):
        for (t, dc), lit in PRESUMIDOS.items():
            self.assertEqual(self.cols(t)[dc]["coluna"], lit, (t, dc))
        self.assertEqual(self.cols("CHAREA")["estabelecimento_id"]["coluna"], "@estabelecimento")

    def test_referencias(self):
        self.assertEqual(self.cols("CHAREA")["criticidade_area_id"]["referencia"], "CHCRITICIDADE")
        self.assertEqual(self.cols("CVTPTERMINAL")["fabricante_terminal_acesso_id"]["referencia"], "CVTERMINALFAB")
        anterior = self.cols("CHSITUACAO")["anterior_situacao_limpeza_id"]
        self.assertEqual(anterior["referencia"], "CHSITUACAO")
        self.assertIn("CHSITUACAO", self.plano["CHSITUACAO"]["duas_fases"])
        self.assertEqual(self.cols("CHPROFISLIMP")["usuario_id"]["referencia"], "TBUSERS")
        esc = self.cols("CHAREA_CHPROFISLIMP")
        self.assertEqual(esc["area_higienizavel_id"]["referencia"], "CHAREA")
        self.assertEqual(esc["profissional_higienizacao_id"]["referencia"], "CHPROFISLIMP")
        un = self.cols("PRCARACTDIE")["unidade_medida_id"]
        self.assertEqual(un["referencia"], "PRUNIDRESPOSTA>NOME>TBUNICON")
        self.assertEqual([x.get("tabela") or x.get("coluna") for x in un["passos"]], ["PRUNIDRESPOSTA", "NOME", "TBUNICON"])
        self.assertIn("L6-08", l6_17.REQUER)
        tel = self.cols("CHPROFLIMPTEL")
        self.assertEqual(tel["profissional_higienizacao_id"]["referencia"], "CHPROFISLIMP")
        self.assertEqual(tel["tipo_telefone_id"]["referencia"], "TBTIPOTELEFONE")

    def test_cobertura_das_antes_bloqueadas(self):
        # rodada de cobertura: tempo em minutos, vigência da carga, sequência por profissional, CPF validado
        self.assertEqual(self.cols("CHTPLIMPEZA")["tempo_previsto_minutos"]["regra"], "minutos_em_timestamp")
        self.assertEqual(self.cols("CHAREA_CHPROFISLIMP")["vigencia_inicio"]["coluna"], "@vigencia_carga")
        self.assertEqual(self.cols("CHPROFLIMPTEL")["sequencia"]["coluna"], "#seq:ID_CHPROFISLIMP")
        self.assertEqual(self.cols("CHPROFISLIMP")["cpf"]["regra"], "cpf")
        self.assertEqual(self.cols("CHPROFISLIMP")["estabelecimento_id"]["coluna"], "@estabelecimento")
        # funcionário e terceirizada estão fora do mapa: nenhuma ponta de vínculo inventada, mas a coluna fica
        # registrada (sem destino, com motivo), nunca ignorada em silêncio
        decl = {(c["tabela"], c["coluna"]): c for c in self.mapa["colunas_decl"]}
        for c in ("ID_CHTERCEIRO", "ID_FPFUNC_COD_EMP", "ID_FPFUNC_COD_FUNC"):
            self.assertEqual(decl[("CHPROFISLIMP", c)].get("destino") or "", "")
            self.assertIn("pedido", decl[("CHPROFISLIMP", c)]["motivo"])

    def test_toda_coluna_da_origem_tem_destino_ou_motivo(self):
        # nenhuma coluna da origem das tabelas da fatia some em silêncio: ou tem destino, ou fica registrada sem
        # destino com o motivo (pedido ou descarte); a chave entra pelo conector_origem
        decl = {(c["tabela"], c["coluna"]): c for c in self.mapa["colunas_decl"]}
        chaves = {t: set((r.get("chave") or "").split(",")) for t in TABELAS for r in self.mapa["tabelas"]
                  if r["tabela"] == t}
        for c in self.mapa["colunas"]:
            t, n = c["tabela"], c["coluna"]
            if t not in TABELAS or n in chaves[t]:
                continue
            self.assertIn((t, n), decl, (t, n))
            d = decl[(t, n)]
            self.assertTrue(d.get("destino") or d.get("motivo"), (t, n))
        for x in [("PRCARACTDIE", "POSSIVEIS_RESPOSTAS"), ("PRCARACTDIE", "TIPO"), ("PRCARACTDIE", "TPRESP"),
                  ("PRCARACTDIE", "OLD_UNIDRESP"), ("CVTPVISITADO", "COD_TP_VISITADO"),
                  ("CVTPVISITANTE", "COD_TP_VISITANTE"), ("CHPROFLIMPTEL", "ID_TBDDD")]:
            self.assertEqual(decl[x].get("destino") or "", "", x)

    def test_carga_efetiva(self):
        # toda tabela carregada com linhas na imagem sintética grava ao menos uma linha, salvo as que esperam um
        # pedido de código compartilhado (modelo ou motor) registrado no saida/L6-17.json: cobertura só de fachada
        # (gravados = 0 com origem não vazia) nunca passa sem o pedido explícito
        import json
        import os
        saida = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "obra", "fatias", "f4", "saida", "L6-17.json")
        # o container de testes não monta docs/: lá vale só a lista explícita; no repositório, o pedido tem de existir
        pedidos = json.dumps(json.load(open(saida, encoding="utf-8")), ensure_ascii=False) \
            if os.path.exists(saida) else None
        cont = {}
        esp = l6_17.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        for t, e in esp.items():
            if e["gravados"] == 0 and cont.get(t):
                self.assertIn(t, AGUARDA_PEDIDO, t)
                if pedidos is not None:
                    self.assertIn(AGUARDA_PEDIDO[t], pedidos, t)
        self.assertEqual({t for t, e in esp.items() if e["gravados"] == 0}, set(AGUARDA_PEDIDO))

    def test_unica_alimentadora(self):
        for t, dt in DESTINO.items():
            outras = {c["tabela"] for c in self.mapa["colunas_decl"]
                      if (c.get("destino") or "").startswith(dt + ".")} - {t}
            self.assertEqual(outras, set(), dt)

    def test_presuncao_do_lado_restritivo(self):
        # situação de acesso sem classificação nunca libera a entrada por presunção (Bloqueado/Restrito na imagem)
        self.assertEqual(self.cols("CVTPSITACESSO")["permite_entrada"]["coluna"], "=~0")
        self.assertNotIn("exige_autorizacao", self.cols("CVTPSITACESSO"))
        self.assertEqual(self.cols("CHCRITICIDADE")["classificacao_sanitaria"]["coluna"], "=~critica")

    def test_nenhuma_bloqueada(self):
        self.assertEqual(BLOQUEADAS, set())


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "Quarto  101".encode("cp1252")), ("Quarto 101", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("texto", "  Diabética  ".encode("cp1252")), ("Diabética", None))
        self.assertEqual(a("texto", 7), ("7", None))
        self.assertEqual(a("booleano_sn", b"S"), (True, None))
        self.assertEqual(a("booleano_sn", b"X")[1], "valor_fora_do_dominio")
        import datetime
        dz = datetime.datetime
        self.assertEqual(a("minutos_em_timestamp", dz(1899, 12, 30, 1, 30)), (90, None))
        self.assertEqual(a("minutos_em_timestamp", dz(1899, 12, 30, 0, 0)), (None, None))
        self.assertEqual(a("minutos_em_timestamp", dz(2020, 1, 1, 0, 45)), (45, "hora_com_data"))
        self.assertEqual(a("cpf", "12345678909"), ("12345678909", None))
        self.assertEqual(a("cpf", "11111111111")[1], "documento_invalido")


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_17.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertEqual(set(cont), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
