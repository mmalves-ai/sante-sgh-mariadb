"""Fatia F4 L5-10 (cadastros e administração, módulo RH): declarações, de-para de valores e plano da carga dirigida
pelo mapa. Só metadado do mapa e a imagem SINTÉTICA (dados 100% falsos); a conciliação roda em conector.sh
conferir-fatia."""
import pathlib
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_10

FATIA = "colunas.d/L5-10.tsv"
RAIZ = pathlib.Path(__file__).resolve().parents[2]


def _ddl():
    """{tabela: texto do CREATE TABLE} do DDL de destino (db/migracoes), no repositório ou no container."""
    for r in (RAIZ, pathlib.Path("/app")):
        d = r / "db/migracoes"
        if d.is_dir():
            txt = "\n".join(f.read_text(encoding="utf-8") for f in sorted(d.rglob("*.sql")))
            return {m.group(1): m.group(0) for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\)[^;]*;", txt, re.S)}
    return None


def _check(ddl, tabela, coluna):
    """Valores do CHECK `coluna IN (...)` da tabela, ou None se a coluna não tem CHECK de lista."""
    m = re.search(r"CHECK \(.*?\b%s IN \(([^)]*)\)" % coluna, ddl.get(tabela, ""))
    return {x.strip().strip("'") for x in m.group(1).split(",")} if m else None


def _sem_carga():
    p = pathlib.Path(mapa.__file__).resolve().parents[1] / "mapa" / "declarado" / "sem_carga.tsv"
    return {r["tabela"]: r for r in mapa.ler_tsv(p)} if p.exists() else {}


class L5_10(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["_arquivo"].endswith(FATIA)]
        cls.todas = set(l5_10.CARREGADAS) | set(l5_10.DESCARTADAS)
        cls.esp = l5_10.linhas(__import__("random").Random(1), lambda t, v: None)
        cls.plano = {x["tabela"]: x for x in carga_mapa.planejar(cls.m, cls.todas)}
        cls.val = {}
        for v in cls.m["valores"]:
            if v["tabela"] in cls.todas:
                cls.val.setdefault((v["tabela"], v["coluna"], v["destino"]), {})[v["valor_origem"]] = v["valor_destino"]

    def test_fatia_tem_as_21_tabelas_e_a_imagem_tambem(self):
        self.assertEqual(len(self.todas), 21)
        self.assertEqual({c["tabela"] for c in self.decl}, self.todas)
        self.assertEqual(set(re.findall(r"CREATE TABLE (\w+)", l5_10.DDL)), self.todas)

    def test_plano_com_todas_carregadas(self):
        dest = {t: x["destinos"] for t, x in self.plano.items()}
        for t, d in {"FPTP_FUNC": ["tipo_colaborador"], "FPTPFERIAS": ["tipo_ferias"], "FPTP_EVENTO": ["tipo_rubrica"],
                     "FPTP_FOLHA": ["tipo_folha"], "FPTP_REFER": ["tipo_referencia_rubrica"]}.items():
            self.assertEqual(dest[t], d, t)
        for t in l5_10.LISTAS:  # lista do hospital: opção principal, módulo e definição antes (adotados)
            self.assertEqual(dest[t][0], "parametro_opcao", t)
            self.assertEqual(set(dest[t]), {"parametro_opcao", "modulo_sistema", "parametro_definicao"}, t)
        self.assertEqual(set(self.plano), self.todas)

    def test_tipo_de_vale_nao_vira_beneficio(self):
        # FPTPVALE é a classificação (beneficio.tipo); gravá-lo em beneficio criaria benefício que não existe
        self.assertFalse([c for c in self.decl if c["tabela"] == "FPTPVALE" and c["destino"].startswith("beneficio")])

    def test_nenhuma_tabela_da_fatia_em_sem_carga_e_listas_ativas(self):
        sc = _sem_carga()
        self.assertFalse(self.todas & set(sc))  # zero descarte e zero bloqueio (ADR 0006)
        chaves = set()
        for t in l5_10.LISTAS:
            d = {(c["destino"], c["coluna"]): c for c in self.decl if c["tabela"] == t and c["destino"]}
            ch = [k[1] for k in d if k[0] == "parametro_definicao.chave"]
            self.assertEqual(len(ch), 1, t)
            self.assertRegex(ch[0], r"^=rh\.lista\.[a-z_]+$", t)
            chaves.add(ch[0])
            self.assertIn(("parametro_opcao.origem", "=migracao"), d, t)
            self.assertFalse([k for k in d if k[0] == "parametro_opcao.ativo"], t)  # ativa pelo padrão
            # o rótulo nunca recusa: sem descrição, o código
            rot = [c["coluna"] for c in self.decl if c["tabela"] == t and c["destino"] == "parametro_opcao.rotulo"]
            self.assertEqual(len(rot), 2, t)
            self.assertEqual(rot[1], self.plano[t]["chave"][0], t)
        self.assertEqual(len(chaves), len(l5_10.LISTAS))  # uma definição por lista

    def test_literal_de_classificacao_so_presumido(self):
        # literal sem pendência gravaria regra de pagamento errada em silêncio: só =~ (valor_presumido)
        lit = {(c["tabela"], c["destino"]): c["coluna"] for c in self.decl if c["coluna"].startswith("=")
               and c["tabela"] not in l5_10.LISTAS}
        self.assertEqual(lit, {("FPTP_FOLHA", "tipo_folha.ativo"): "=~1",
                               ("FPTPFERIAS", "tipo_ferias.categoria"): "=~individual"})

    def test_depara_de_valores_cabe_no_check_do_destino(self):
        rub = self.val[("FPTP_EVENTO", "TP_EVENTO", "tipo_rubrica.natureza")]
        sinal = self.val[("FPTP_EVENTO", "TP_EVENTO", "tipo_rubrica.sinal")]
        # as 5 letras da origem, com evidência (leitura das rubricas do legado); J informativa dedutora
        self.assertEqual(rub, {"P": "provento", "D": "desconto", "B": "base", "I": "informativa", "J": "informativa"})
        self.assertEqual(set(rub), set(sinal))
        for k, nat in rub.items():  # sinal coerente com a natureza
            self.assertEqual(sinal[k], {"provento": "1", "desconto": "-1"}.get(nat, "0"), k)
        uni = self.val[("FPTP_REFER", "TP_REFER", "tipo_referencia_rubrica.unidade")]
        self.assertEqual(uni, {"V": "valor", "H": "horas", "D": "dias", "P": "percentual", "R": "quantidade"})
        ind = self.val[("FPTP_FOLHA", "ID_FPTPFOLHAESOC", "tipo_folha.indicador_apuracao_esocial")]
        self.assertEqual(ind, {"1": "mensal", "2": "anual"})
        ddl = _ddl()
        if ddl is not None:
            for (t, c, d), pares in self.val.items():
                tab, col = d.split(".")
                dom = _check(ddl, tab, col)
                if dom is not None:
                    self.assertTrue(set(pares.values()) <= dom, (t, d, set(pares.values()) - dom))

    def test_categoria_da_folha_coerente_com_o_indicativo_e_revisavel(self):
        ind = self.val[("FPTP_FOLHA", "ID_FPTPFOLHAESOC", "tipo_folha.indicador_apuracao_esocial")]
        cat = self.val[("FPTP_FOLHA", "ID_FPTPFOLHAESOC", "tipo_folha.categoria")]
        for k, v in ind.items():  # anual é 13º; mensal nunca é 13º
            self.assertEqual(cat[k].startswith("decimo_terceiro"), v == "anual", k)
        self.assertEqual(cat[""], "mensal")  # sem indicativo: presumido, não recusado
        # a categoria derivada é presumida fora do 13º: toda linha leva valor_presumido (marca no ativo)
        cols = [c["coluna"] for c in self.plano["FPTP_FOLHA"]["colunas"]["tipo_folha"]]
        self.assertTrue(any(c.startswith("=~") for c in cols))

    def test_rotulo_cabe_no_destino(self):
        ddl = _ddl()
        if ddl is None:
            self.skipTest("DDL de destino fora do alcance")
        tam = int(re.search(r"rotulo\s+VARCHAR\((\d+)\)", ddl["parametro_opcao"]).group(1))
        for t in l5_10.LISTAS:
            corpo = re.search(r"CREATE TABLE %s \((.*?)\);" % t, l5_10.DDL).group(1)
            larg = max([int(x) for x in re.findall(r"VARCHAR\((\d+)\)", corpo)] or [0])
            regra = [c["regra"] for c in self.decl if c["tabela"] == t and c["destino"] == "parametro_opcao.rotulo"][0]
            if larg > tam:
                self.assertEqual(regra, "texto_resumo:%d" % tam, t)

    def test_indicativo_de_apuracao_nao_e_referencia_ao_catalogo(self):
        c = [x for x in self.plano["FPTP_FOLHA"]["colunas"]["tipo_folha"] if x["coluna"] == "ID_FPTPFOLHAESOC"
             and x["destino"] == "indicador_apuracao_esocial"]
        self.assertEqual(len(c), 1)
        self.assertEqual((c[0]["regra"], c[0]["depara"]), ("inteiro", "valores"))

    def test_codigo_de_uma_letra_preserva_caixa(self):
        for t, dt in (("FPTP_EVENTO", "tipo_rubrica"), ("FPTP_REFER", "tipo_referencia_rubrica")):
            cod = [x for x in self.plano[t]["colunas"][dt] if x["destino"] == "codigo"]
            self.assertEqual([x["regra"] for x in cod], ["codigo_char"], t)

    def test_colisao_de_caixa_nos_codigos_da_imagem(self):
        cod = {}
        l5_10.linhas(None, lambda t, v: cod.setdefault(t, []).append(v[0]))
        self.assertEqual(sentinela.colisoes_caixa(cod["FPTP_EVENTO"]), [["P", "p"]])
        self.assertEqual(sentinela.colisoes_caixa(cod["FPTP_REFER"]), [["H", "h"]])
        self.assertEqual(sentinela.aplicar("codigo_char", "p"), ("p", None))

    def test_regras_da_fatia(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "  Tipo   colaborador ")[0], "Tipo colaborador")
        self.assertEqual(sentinela.aplicar("texto_nome", "   ")[0], None)

    def test_esperado_da_imagem_nas_carregadas(self):
        self.assertEqual(set(self.esp), set(l5_10.CARREGADAS))
        self.assertEqual(l5_10.DESCARTADAS, ())
        self.assertEqual(self.esp["FPTP_EVENTO"]["pendencias"]["codigo_colisao_caixa"], 2)
        self.assertEqual(self.esp["FPTP_REFER"]["pendencias"]["codigo_colisao_caixa"], 2)
        self.assertEqual(self.esp["FPTP_FOLHA"]["pendencias"]["valor_presumido"], 7)  # toda linha lida
        self.assertEqual(self.esp["FPTPDEPENDENT"]["gravados"], 4)  # o sem descrição entra com o código no rótulo



if __name__ == "__main__":
    unittest.main()
