"""Fatia L6-05 (prontuário, assinatura e assistência, PEP): plano da carga dirigida pelo mapa, cobertura das colunas
obrigatórias do destino, regras de coluna e coerência da imagem sintética. Só dados inventados (sintetica_d/l6_05.py)."""
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_05

CARREGADAS = ["GETABVIA", "PRAGRAVOTPARQUETIPO", "PRAGRAVOPERGUNTA", "PRAGRUPBALANCO", "PRASSINANTE",
              "PRBHINTENSIDADE", "PRBHTIPOFECHAMENTO", "PRBHTPELIMINA", "PRCAB_IDENTIFIC_PAC",
              "PRCAMPOSLOCALIZACAOPACIENTE", "PRDADOSENVIOOPERADORA", "PRFAVORITO_EXIBIR", "PRFA_UTILIZACAO", "PRFICHAREL", "PRFILTROCLASSIF", "PRFILTROUSUARIO",
              "PRFINALIDADETRAT", "PRFORMULA", "PRFREQUENCIA", "PRHRRELATIVA"]
# descarte de produto (declarado/sem_carga.tsv), com a causa aceita
DESCARTADAS = {"PRCADRESP": "duplicado", "PREMAILOPCAO": "mecanismo_do_produto",
               "PRLAYIMPPRESC": "mecanismo_do_produto"}
# dado que o hospital usa e que ainda não carrega: declaração pronta, comentada, à espera do pedido (saida/L6-05.json);
# nunca descarte (a ficha do antimicrobiano é clínica; o leiaute é do hospital)
BLOQUEADAS = {"GECADANTIMI": "pedido 14"}
AGUARDAM = list(DESCARTADAS) + list(BLOQUEADAS)
# chaves de atributo que a tela do painel exibe (COLUNAS_PAINEL, packages/contratos/src/pep/documentos.ts)
COLUNAS_PAINEL = {"leito", "paciente", "idade", "atendimento", "entrada", "dias", "convenio", "medico", "alergias",
                  "alertas"}
# tabela -> destinos (principal primeiro); as outras têm um destino só
MULTIDESTINO = {"PRDADOSENVIOOPERADORA": ["informacao_clinica_operadora", "grupo_informacao_clinica_operadora"],
                "PRFICHAREL": ["modelo_impressao_clinica", "tipo_modelo_impressao"]}
# colunas da origem declaradas sem destino, de propósito (motivo na declaração)
SEM_DESTINO = {("GETABVIA", "ID_TBTISSVIAADMIN"), ("PRFINALIDADETRAT", "ID_TBTISSFINTRAT"),
               ("PRFILTROUSUARIO", "ATENDIMENTO"), ("PRFREQUENCIA", "TP_PRESCRICAO"), ("PRFORMULA", "ATIVO")} | {("PRFICHAREL", c) for c in ("ID_FICHAREL", "COD", "NOMECOMP", "NOMECLASSE", "NOME",
                                                 "COMPONENTE", "CONTEUDO", "PARENT", "TIPO", "SEQUENCIA")}
DECLARADO = Path(__file__).resolve().parents[1] / "mapa" / "declarado"
# coluna clínica sem fonte direta: de-para de valores pelo nome ou pelo número de doses, nunca literal presumido
POR_VALORES = {("PRAGRUPBALANCO", "tipo"), ("PRASSINANTE", "papel"), ("PRBHTIPOFECHAMENTO", "periodo_horas"),
               ("PRBHTIPOFECHAMENTO", "parcial"), ("PRFREQUENCIA", "tipo")}
PRESUMIDOS = {"PRFORMULA": ["=~peso", "=~0"]}


def _mapa():
    try:
        return mapa.carregar_execucao()
    except FileNotFoundError:
        return None


def _raiz_ddl():
    for r in (Path(__file__).resolve().parents[2], Path("/app")):
        if (r / "db/migracoes").is_dir():
            return r
    return None


class Plano(unittest.TestCase):
    def setUp(self):
        self.m = _mapa()
        if self.m is None:
            self.skipTest("mapa do conector ausente")
        self.plano = carga_mapa.planejar(self.m, set(CARREGADAS + AGUARDAM))
        self.por = {p["tabela"]: p for p in self.plano}

    def _col(self, t, destino):
        p = self.por[t]
        return [c for c in p["colunas"][p["destinos"][0]] if c["destino"] == destino]

    def test_so_as_carregaveis_entram_em_ordem(self):
        self.assertEqual([p["tabela"] for p in self.plano], CARREGADAS)

    def test_descartes_com_causa_de_produto(self):
        raiz = Path(__file__).resolve().parents[1] / "mapa" / "declarado" / "sem_carga.tsv"
        if not raiz.exists():
            self.skipTest("mapa do conector ausente")
        sc = {r["tabela"]: r for r in mapa.ler_tsv(raiz)}
        for t, causa in DESCARTADAS.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(sc[t]["motivo"].strip(), t)
            self.assertNotIn(t, self.por)

    def test_bloqueadas_so_com_declaracao_pronta_e_pedido(self):
        """Só GECADANTIMI fica de fora sem descarte: declaração pronta comentada (motivo cita o pedido),
        nenhuma linha em sem_carga.tsv (não é descarte) e o pedido em aberto no saida/L6-05.json."""
        if not (DECLARADO / "sem_carga.tsv").exists():
            self.skipTest("mapa do conector ausente")
        sc = {r["tabela"] for r in mapa.ler_tsv(DECLARADO / "sem_carga.tsv")}
        self.assertFalse(sc & (set(CARREGADAS) | set(BLOQUEADAS)))
        txt = (DECLARADO / "colunas.d" / "L6-05.tsv").read_text(encoding="utf-8")
        coment = [l.split("\t") for l in txt.splitlines() if l.startswith("#")]
        self.assertEqual({c[0][1:] for c in coment}, set(BLOQUEADAS))
        for c in coment:
            self.assertIn(BLOQUEADAS[c[0][1:]], c[-1], c[:3])
        import json
        saida = Path(__file__).resolve().parents[2] / "docs/obra/fatias/f4/saida/L6-05.json"
        if saida.exists():
            abertos = [p for p in json.loads(saida.read_text(encoding="utf-8"))["pedidos"] if not p.get("atendido")]
            for t in BLOQUEADAS:
                self.assertTrue(any(t in p["mudanca"] + p["motivo"] for p in abertos), t)

    def test_coluna_do_painel_pela_chave_do_produto(self):
        """A chave do atributo vem do NOME por de-para para as chaves que a tela exibe (nunca o id da origem), e a
        preferência do usuário copia a chave que a coluna do painel gravou."""
        c = self._col("PRCAMPOSLOCALIZACAOPACIENTE", "chave_atributo")
        self.assertEqual([(x["coluna"], x["regra"]) for x in c], [("NOME", "texto_nome")])
        self.assertTrue(c[0]["valores"])
        self.assertLessEqual(set(c[0]["valores"].values()), COLUNAS_PAINEL)
        self.assertEqual(c[0]["valores"].get("Dias de internação"), "dias")
        u = self._col("PRFAVORITO_EXIBIR", "coluna")
        self.assertEqual(len(u), 1)
        decl = [r for r in mapa.ler_tsv(DECLARADO / "colunas.d" / "L6-05.tsv")
                if r["tabela"] == "PRFAVORITO_EXIBIR" and r["destino"] == "painel_coluna_usuario.coluna"]
        self.assertEqual(decl[0]["via"], "ref:PRCAMPOSLOCALIZACAOPACIENTE@chave_atributo")

    def test_informacao_operadora_com_grupo_padrao_gravado_antes(self):
        """A informação é o principal (PRTPRESPOSTA a aponta por ref:); o grupo, que a origem não tem e o modelo exige,
        é gravado antes, criado uma vez e adotado pelo código, e o principal recebe o id dele."""
        p = self.por["PRDADOSENVIOOPERADORA"]
        dp, dg = MULTIDESTINO["PRDADOSENVIOOPERADORA"]
        self.assertEqual(p["destinos"], [dp, dg])
        og = (p.get("opcoes") or {}).get(dg) or {}
        self.assertTrue(og.get("antes"))
        self.assertEqual(og.get("adotar"), ["codigo"])
        g = {c["destino"]: c["coluna"] for c in p["colunas"][dg]}
        self.assertEqual(g["codigo"], "=envio_operadora")
        d = {c["destino"]: c["coluna"] for c in p["colunas"][dp]}
        self.assertEqual(d["grupo_informacao_clinica_operadora_id"], "@id:" + dg)
        self.assertEqual(d["codigo"], "#codigo_derivado:ID:30:envio_")
        self.assertEqual(d["descricao"], "NOME")

    def test_cobertura_por_coluna(self):
        """Toda coluna da origem de tabela carregada tem declaração (com destino ou com motivo), e toda ref: termina
        numa tabela que carrega (nunca num descarte)."""
        if not (DECLARADO / "sem_carga.tsv").exists():
            self.skipTest("mapa do conector ausente")
        decl = [r for r in mapa.ler_tsv(DECLARADO / "colunas.d" / "L6-05.tsv") if not r["tabela"].startswith("#")]
        tem = {(r["tabela"], r["coluna"]) for r in decl}
        origem = mapa.ler_tsv(DECLARADO.parent / "colunas.tsv")
        chave = {t: set(p["chave"]) for t, p in self.por.items()}  # a chave da origem fica em conector_origem
        for r in origem:
            if r["tabela"] in CARREGADAS and r["coluna"] not in chave[r["tabela"]]:
                self.assertIn((r["tabela"], r["coluna"]), tem)
        for r in decl:
            if not r["destino"]:
                self.assertIn((r["tabela"], r["coluna"]), SEM_DESTINO)
                self.assertTrue(r["motivo"].strip(), r["coluna"])
        descarte = {r["tabela"] for r in mapa.ler_tsv(DECLARADO / "sem_carga.tsv")}
        for p in self.plano:
            for c in p["colunas"][p["destinos"][0]]:
                if c.get("passos"):
                    fim = [x["tabela"] for x in c["passos"] if x.get("tabela")][-1]
                    self.assertNotIn(fim, descarte, (p["tabela"], c["coluna"]))
                elif c.get("referencia"):
                    self.assertNotIn(c["referencia"], descarte, (p["tabela"], c["coluna"]))

    def test_codigo_da_via_e_escopo_do_filtro(self):
        d = self._col("GETABVIA", "codigo_interoperabilidade")[0]
        self.assertEqual((d["coluna"], d["regra"]), ("ID_DIGITAL", "texto"))
        e = self._col("PRFILTROUSUARIO", "escopo_atendimento")[0]
        self.assertEqual(e["coluna"], "TODOS_REGISTROS")
        self.assertEqual(e["valores"], {"S": "todos", "N": "atual"})

    def test_referencia_encadeada_ao_usuario_da_preferencia(self):
        u = self._col("PRFAVORITO_EXIBIR", "usuario_id")[0]
        self.assertEqual(u["coluna"], "LOCPACDEFAULT")
        self.assertEqual([(x.get("tabela"), x.get("coluna")) for x in u["passos"]],
                         [("PRLOCPACDEFAULT", None), (None, "USUARIO"), ("TBUSERS", None)])

    def test_um_destino_por_tabela(self):
        for p in self.plano:
            self.assertEqual(p["destinos"] if p["tabela"] in MULTIDESTINO else len(p["destinos"]),
                             MULTIDESTINO.get(p["tabela"], 1), p["tabela"])

    def test_referencias(self):
        self.assertEqual(self._col("PRAGRAVOPERGUNTA", "agravo_notificavel_id")[0]["referencia"], "PRAGRAVOTPARQUETIPO")
        u = self._col("PRFILTROUSUARIO", "usuario_id")[0]
        self.assertEqual((u["referencia"], u["regra"]), ("TBUSERS", "chave_origem"))

    def test_sequencia_pela_chave_da_origem(self):
        """A posição da pergunta é o id da origem (nunca muda): apagar uma pergunta e criar outra no diferencial não
        reusa a posição de ninguém (sem 1062) nem desloca as que ficaram. Nada de `#seq` contado na leitura."""
        s = self._col("PRAGRAVOPERGUNTA", "sequencia")[0]
        self.assertEqual((s["coluna"], s["regra"]), ("ID", "inteiro"))
        for p in self.plano:
            self.assertFalse([c for c in p["colunas"][p["destinos"][0]] if c["coluna"].startswith("#seq:")], p["tabela"])
        # diferencial simulado sobre as chaves: o valor de cada linha depende só dela
        antes = {1: 1, 2: 2, 3: 3}
        depois = {k: k for k in (1, 3, 4)}
        self.assertTrue(all(depois[k] == antes[k] for k in (1, 3)))
        self.assertNotIn(depois[4], [antes[k] for k in (1, 3)])

    def test_literais_fora_da_leitura_e_formula_inativa(self):
        self.assertNotIn("=texto", self.por["PRAGRAVOPERGUNTA"]["lidas"])
        for t, lits in PRESUMIDOS.items():
            cols = [c["coluna"] for c in self.por[t]["colunas"][self.por[t]["destinos"][0]]]
            for lit in lits:
                self.assertNotIn(lit, self.por[t]["lidas"], t)
                self.assertIn(lit, cols, t)
        # fórmula migrada sem validação da expressão: entra inativa, com pendência, nunca com o ATIVO da origem
        self.assertEqual(self._col("PRFORMULA", "ativo")[0]["coluna"], "=~0")
        self.assertNotIn("ATIVO", self.por["PRFORMULA"]["lidas"])

    def test_sem_presumido_que_muda_o_sentido_clinico(self):
        """Lado do balanço, papel de quem assina, período do fechamento e tipo da frequência vêm do de-para de valores:
        valor sem par vira NULL com valor_fora_do_dominio e a linha é recusada pelo NOT NULL (nada presumido)."""
        for t, d in POR_VALORES:
            c = self._col(t, d)
            self.assertEqual(len(c), 1, (t, d))
            self.assertIsNotNone(c[0]["valores"], (t, d))
            self.assertFalse(c[0]["coluna"].startswith("="), (t, d))
        tipo = self._col("PRFREQUENCIA", "tipo")[0]["valores"]
        self.assertEqual({tipo[str(i)] for i in range(1, 49)}, {"vezes_ao_dia"})
        self.assertEqual(tipo[""], "a_criterio_medico")
        self.assertNotIn("49", tipo)
        papel = self._col("PRASSINANTE", "papel")[0]["valores"]
        self.assertEqual((papel["Paciente"], papel["Testemunha"]), ("paciente", "testemunha"))
        grupo = self._col("PRAGRUPBALANCO", "tipo")[0]["valores"]
        self.assertEqual((grupo["GANHOS"], grupo["PERDAS"], grupo["PERDAS INSENSÍVEIS"]),
                         ("ganho", "perda", "perda_insensivel"))
        per = self._col("PRBHTIPOFECHAMENTO", "periodo_horas")[0]["valores"]
        self.assertNotIn("Parcial", per)
        self.assertEqual(self._col("PRBHTPELIMINA", "natureza")[0]["coluna"], "=perda")

    def test_regras_declaradas(self):
        self.assertEqual(self._col("GETABVIA", "codigo")[0]["regra"], "codigo_char")
        for d in ("exige_volume_medido", "exige_volume_estimado", "exige_intensidade", "exige_aspecto",
                  "exige_item_prescrito"):
            self.assertEqual(self._col("PRBHTPELIMINA", d)[0]["regra"], "booleano_sn", d)
        for p in self.plano:
            for c in p["colunas"][p["destinos"][0]]:
                if c["destino"] == "codigo" and not c["coluna"].startswith("#codigo_derivado:"):
                    self.assertIn(c["regra"], ("texto", "codigo_char"), p["tabela"])

    def test_obrigatorias_do_destino_cobertas(self):
        """Toda coluna NOT NULL sem padrão do destino é declarada (senão a inserção falha com 1364 e para a carga)."""
        raiz = _raiz_ddl()
        if raiz is None:
            self.skipTest("DDL do modelo ausente")
        ddl = mapa.ler_ddl(raiz)
        livres = {"id", "criado_em"}
        for p in self.plano:
            dt = p["destinos"][0]
            decl = {c["destino"] for c in p["colunas"][dt]}
            for linha in ddl[dt]["create"].splitlines()[1:]:
                x = linha.strip().split()
                if len(x) < 2 or not re.fullmatch(r"[a-z_0-9]+", x[0]) or x[0] in livres:
                    continue
                corpo = linha.upper()
                if "NOT NULL" in corpo and "DEFAULT" not in corpo and "AUTO_INCREMENT" not in corpo:
                    self.assertIn(x[0], decl, "%s.%s" % (dt, x[0]))


class Regras(unittest.TestCase):
    def test_regras_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto", 7), ("7", None))
        self.assertEqual(a("texto_nome", "Agravo  exemplo   dois".encode("cp1252")), ("Agravo exemplo dois", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("codigo_char", b"Ab"), ("Ab", None))
        self.assertEqual([sorted(g) for g in sentinela.colisoes_caixa(["Ab", "AB", "VO"])], [["AB", "Ab"]])
        self.assertEqual(a("booleano_sn", b"S"), (True, None))
        self.assertEqual(a("booleano_sn", b"X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro", 8), (8, None))
        self.assertEqual(a("inteiro_zero_nulo", 0), (None, None))
        import datetime
        self.assertEqual(a("hora_em_timestamp", datetime.datetime(1899, 12, 30, 6, 0)), (datetime.time(6, 0), None))
        self.assertEqual(a("hora_em_timestamp", datetime.datetime(2020, 5, 1, 22, 0)),
                         (datetime.time(22, 0), "hora_com_data"))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_05.linhas(None, lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(sorted(esp), sorted(CARREGADAS))
        recusa = ("restricao_destino_", "codigo_colisao_caixa", "pai_pendente")
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items() if r.startswith(recusa))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
        for t in AGUARDAM:
            self.assertNotIn("CREATE TABLE %s " % t, l6_05.DDL)
        # pai de fora da fatia só como origem da ref: encadeada (sem esperado desta fatia)
        self.assertIn("CREATE TABLE PRLOCPACDEFAULT ", l6_05.DDL)
        self.assertNotIn("PRLOCPACDEFAULT", esp)
        self.assertEqual(cont["PRLOCPACDEFAULT"], len(l6_05.PREFERENCIAS))

    def test_so_dados_inventados(self):
        self.assertTrue(all(u.startswith("usuario.exemplo.") for u in l6_05.PAIS_EXTERNOS["TBUSERS"]))


class LeiauteSemPerda(unittest.TestCase):
    def test_componentes_em_texto_no_json(self):
        """COMPONENTE e CONTEUDO são BLOB de TEXTO (SUB_TYPE 1 no dicionário vivo): o #grupo_json guarda as
        propriedades do leiaute como texto, nunca como hash (sha256:)."""
        self.assertRegex(l6_05.DDL, r"COMPONENTE BLOB SUB_TYPE 1, CONTEUDO BLOB SUB_TYPE 1")
        linhas = next(v for t, v, _ in l6_05.DADOS if t == "PRFICHAREL")
        amostras = [x for ln in linhas for x in ln[5:7] if x is not None]
        self.assertEqual(len(amostras), 4)
        for b in amostras:
            v = sentinela.aplicar(sentinela.regra_efetiva("texto_longo", 1), b)[0]
            j = carga_mapa._valor_json(v)
            self.assertIsInstance(j, str)
            self.assertFalse(j.startswith("sha256:"), j)
        self.assertIn("Left = 8", carga_mapa._valor_json(sentinela.aplicar("texto_longo", amostras[0])[0]))
        self.assertIn("Título falso", [carga_mapa._valor_json(sentinela.aplicar("texto_longo", b)[0]) for b in amostras])
        # a regra só viraria bytes (hash) num BLOB binário: é o subtipo vivo que decide, não o gerado
        self.assertEqual(sentinela.regra_efetiva("texto_longo", 0), "blob")


if __name__ == "__main__":
    unittest.main()
