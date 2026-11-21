"""Fatia L8-18 (relatórios): declarações, referências declaradas na via, literais dentro do CHECK do destino, regras
das colunas e coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L8-18`."""
import random
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_18

RAIZ = Path(__file__).resolve().parents[1]  # /app no container (db/migracoes montado só leitura)
CARREGADAS = set(l8_18.CARREGADAS)
NA_IMAGEM = CARREGADAS | set(l8_18.NAO_CARREGADAS)
DESTINOS = {"TBAGRUPRELAT": ["agrupamento_relatorio"], "TBEDITREL": ["relatorio", "triagem_relatorio_legado"],
            "TBAGRUPRELAT_TBEDITREL": ["agrupamento_relatorio_item"], "TBEDITPARAM": ["relatorio_parametro"],
            "TBEDITREL_GRUUSU": ["relatorio_permissao"], "TBEDITREL_TBUSERS": ["relatorio_permissao"],
            "TBOPCAOREL": ["categoria_relatorio"]}


def _ddl_destino():
    out = {}
    for f in sorted((RAIZ / "db/migracoes/19_REL").glob("*.sql")):
        for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\)", f.read_text(encoding="utf-8"), re.S):
            out[m.group(1)] = m.group(2)
    return out


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, NA_IMAGEM)}
        cls.ddl = _ddl_destino()

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), CARREGADAS)
        for t, dts in DESTINOS.items():
            self.assertEqual(self.plano[t]["destinos"], dts, t)

    def test_nao_carregadas_sem_destino(self):
        for t in l8_18.NAO_CARREGADAS:
            decl = [c for c in self.mapa["colunas_decl"] if c["tabela"] == t]
            self.assertTrue(decl, t)  # declarada com motivo
            self.assertFalse([c for c in decl if c.get("destino")], t)

    def test_obrigatorias_sem_padrao_cobertas(self):
        for t, dts in DESTINOS.items():
            for dt in dts:
                obrig = {m.group(1) for m in re.finditer(r"^\s*(\w+)\s+[^\n]*?NOT NULL(?![^\n]*DEFAULT)",
                                                          self.ddl[dt], re.M)}
                obrig -= {"id", "criado_em", "CONSTRAINT"}  # CHECK com NOT NULL não é coluna
                self.assertTrue(obrig <= set(self.cols(t, dt)), "%s.%s: %s" % (t, dt, sorted(obrig - set(self.cols(t, dt)))))

    def test_referencias(self):
        ref = lambda t, dt, c: (self.cols(t, dt)[c]["regra"], self.cols(t, dt)[c]["referencia"])  # noqa: E731
        self.assertEqual(ref("TBEDITREL", "relatorio", "modulo_sistema_id"), ("chave_origem", "TBMODULO"))
        self.assertEqual(ref("TBEDITREL", "relatorio", "criado_por"), ("chave_origem", "TBUSERS"))
        self.assertEqual(ref("TBEDITREL", "triagem_relatorio_legado", "modulo_sistema_id"), ("chave_origem", "TBMODULO"))
        self.assertEqual(ref("TBEDITREL_GRUUSU", "relatorio_permissao", "relatorio_id"), ("chave_origem", "TBEDITREL"))
        self.assertEqual(ref("TBEDITREL_GRUUSU", "relatorio_permissao", "perfil_acesso_id"), ("chave_origem", "TBGRUUSU"))
        self.assertEqual(ref("TBEDITREL_TBUSERS", "relatorio_permissao", "usuario_id"), ("chave_origem", "TBUSERS"))
        self.assertEqual(ref("TBAGRUPRELAT_TBEDITREL", "agrupamento_relatorio_item", "relatorio_id"),
                         ("chave_origem", "TBEDITREL"))
        self.assertEqual(ref("TBEDITPARAM", "relatorio_parametro", "relatorio_id"), ("chave_origem", "TBEDITREL"))
        self.assertEqual(ref("TBOPCAOREL", "categoria_relatorio", "modulo_sistema_id"), ("chave_origem", "TBMODULO"))

    def test_triagem_ligada_e_consulta_so_especificacao(self):
        tri = self.cols("TBEDITREL", "triagem_relatorio_legado")
        self.assertEqual(tri["relatorio_id"]["coluna"], "@id")
        self.assertEqual(tri["estabelecimento_id"]["coluna"], "@estabelecimento")
        self.assertEqual((tri["especificacao"]["coluna"], tri["especificacao"]["regra"]), ("TEXTOSQL", "texto_longo"))
        rel = self.cols("TBEDITREL", "relatorio")
        self.assertTrue(rel["consulta_definicao"]["coluna"].startswith("="))  # SQL da origem nunca vai ao catálogo
        self.assertNotIn("situacao", rel)  # rascunho (padrão do destino) até a triagem

    def test_literais_dentro_do_check(self):
        for t, dts in DESTINOS.items():
            for dt in dts:
                for dc, c in self.cols(t, dt).items():
                    if not c["coluna"].startswith("="):
                        continue
                    m = re.search(r"CHECK \(%s IN \(([^)]*)\)\)" % dc, self.ddl[dt])
                    if m:
                        self.assertIn("'%s'" % c["coluna"].lstrip("=~"), m.group(1), "%s.%s" % (dt, dc))

    def test_regras_das_colunas(self):
        self.assertEqual(sentinela.aplicar("inteiro_zero_nulo", 0)[0], None)  # versão 0: padrão 1
        self.assertEqual(sentinela.aplicar("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar("texto_nome", "  Relatório   exemplo   sete "), ("Relatório exemplo sete", None))
        x, p = sentinela.aplicar("texto_longo", l8_18.CONSULTA.encode("cp1252"))
        self.assertEqual((x, p), (l8_18.CONSULTA, None))  # quebras e espaços internos preservados
        self.assertEqual(self.cols("TBEDITPARAM", "relatorio_parametro")["sequencia"]["coluna"], "#seq:ID_TBEDITREL")


class Imagem(unittest.TestCase):
    def test_coerencia(self):
        lidas = {}
        esp = l8_18.linhas(random.Random(1), lambda t, v: lidas.setdefault(t, []).append(v))
        self.assertEqual(set(lidas), NA_IMAGEM)
        self.assertEqual(set(esp), CARREGADAS)
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items() if r.startswith("restricao_") or r == "pai_pendente")
            self.assertEqual(e["gravados"] + recusas, len(lidas[t]), t)
        self.assertEqual(set(re.findall(r"CREATE TABLE (\w+)", l8_18.DDL)), NA_IMAGEM)

    def test_sem_endereco_real(self):
        lidas = {}
        l8_18.linhas(random.Random(1), lambda t, v: lidas.setdefault(t, []).append(v))
        for t, ls in lidas.items():
            for v in ls:
                for x in v:
                    if isinstance(x, str) and "@" in x:
                        self.assertTrue(x.endswith(".invalid"), t)


class PerdasEPresumidos(unittest.TestCase):
    """Achados da avaliação: perdas declaradas com motivo e campos da triagem presumidos (nunca fato falso)."""

    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, NA_IMAGEM)}

    def test_parametro_colunas_perdidas_declaradas(self):
        decl = {c["coluna"]: c for c in self.mapa["colunas_decl"] if c["tabela"] == "TBEDITPARAM"}
        for col in ("ORDEM", "VISIVEL", "TIPO_DEFAULT"):
            self.assertIn(col, decl)
            self.assertFalse(decl[col].get("destino"), col)
            self.assertIn("PERDA DECLARADA", decl[col]["motivo"], col)
        self.assertIn("PERDA DECLARADA", decl["#seq:ID_TBEDITREL"]["motivo"])

    def test_triagem_agregados_presumidos(self):
        tri = {c["destino"]: c for c in self.plano["TBEDITREL"]["colunas"]["triagem_relatorio_legado"]}
        for dc in ("quantidade_parametros", "acesso_restrito"):
            self.assertTrue(tri[dc]["coluna"].startswith("=~"), dc)


class RiscoEstabelecimento(unittest.TestCase):
    """Risco registrado (saida/L8-18.json): com nenhum ou vários estabelecimentos, o @estabelecimento da triagem
    (destino secundário) recusa a linha inteira, inclusive o relatório do catálogo. Quando o motor recusar só o
    destino secundário, este teste deve passar a esperar o principal gravado."""

    def test_varios_estabelecimentos_recusam_a_linha_inteira(self):
        c = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
        c._estab = None  # nenhum ou vários (LIMIT 2 devolveu 0 ou 2 ids)
        c.info = {"relatorio": {"titulo": (False, "varchar", None, False)},
                  "triagem_relatorio_legado": {"estabelecimento_id": (False, "bigint", None, False)}}
        c.seq, c.subtipo = {}, {}
        p = {"tabela": "TBEDITREL", "destinos": ["relatorio", "triagem_relatorio_legado"], "duas_fases": set(),
             "colunas": {"relatorio": [{"coluna": "=Relatorio falso", "destino": "titulo", "regra": "",
                                        "depara": "", "referencia": "", "valores": None}],
                         "triagem_relatorio_legado": [{"coluna": "@estabelecimento", "destino": "estabelecimento_id",
                                                       "regra": "", "depara": "", "referencia": "",
                                                       "valores": None}]}}
        vals, _, _, recusa, _ = c._valores(p, {}, "1")
        self.assertIsNone(vals)
        self.assertEqual(recusa, ("estabelecimento_indefinido", "alta"))
