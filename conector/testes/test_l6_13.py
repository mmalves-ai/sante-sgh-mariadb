"""Fatia F4 L6-13 (prontuário, assinatura e assistência, módulo PEP): declarações e plano da carga dirigida pelo mapa.
Nenhuma das 23 tabelas é carregada hoje: cada uma depende de regra genérica que o motor não tem ou de pai bloqueado
(motivos em colunas.d/L6-13.tsv, pedidos em docs/obra/fatias/f4/saida/L6-13.json). As declarações prontas ficam
comentadas e são conferidas aqui contra o DDL. Só metadado e a imagem SINTÉTICA (dados 100% falsos)."""
import csv
import datetime
import pathlib
import random
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_13

FATIA = "colunas.d/L6-13.tsv"
CONECTOR = pathlib.Path(__file__).resolve().parents[1]
RAIZ = CONECTOR.parent
ARQ = CONECTOR / "mapa" / "declarado" / FATIA
CAMPOS = ["tabela", "coluna", "destino", "regra", "depara", "via", "motivo"]


def _ddl():
    """DDL do destino quando o repositório inteiro está à vista (no container do conector só há conector/)."""
    d = RAIZ / "db" / "migracoes"
    return "\n".join(p.read_text(encoding="utf-8") for p in sorted(d.rglob("*.sql"))) if d.exists() else ""


def _prontas():
    """Declarações prontas e comentadas ('#' seguido de uma linha completa do TSV)."""
    out = []
    for l in ARQ.read_text(encoding="utf-8").splitlines():
        if l.startswith("#") and not l.startswith("#---"):
            out.append(dict(zip(CAMPOS, next(csv.reader([l[1:]], delimiter="\t")))))
    return out


class L6_13(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["_arquivo"].endswith(FATIA)]
        cls.todas = set(l6_13.COLUNAS)
        cls.por = {r["tabela"]: r for r in cls.m["tabelas"]}
        cls.prontas = _prontas()

    def test_fatia_tem_as_23_tabelas_na_declaracao_e_na_imagem(self):
        self.assertEqual(len(self.todas), 23)
        self.assertEqual({c["tabela"] for c in self.decl}, self.todas)
        self.assertEqual(set(re.findall(r"CREATE TABLE (\w+)", l6_13.DDL)), self.todas)

    def test_imagem_com_a_forma_do_mapa(self):
        geradas = {}
        for c in self.m["colunas"]:
            if c["tabela"] in self.todas:
                geradas.setdefault(c["tabela"], []).append(c["coluna"])
        for t in self.todas:
            self.assertEqual([c for c, _, _, _ in l6_13.COLUNAS[t]], geradas[t], t)
            self.assertEqual(",".join(l6_13.CHAVE[t]), self.por[t]["chave"], t)

    def test_nenhuma_tabela_da_fatia_no_plano(self):
        self.assertEqual([p["tabela"] for p in carga_mapa.planejar(self.m, self.todas)], [])

    def test_cada_coluna_declarada_uma_vez_sem_destino_e_com_motivo(self):
        vistas = {}
        for c in self.decl:
            self.assertEqual(c["destino"], "", (c["tabela"], c["coluna"]))
            self.assertRegex(c["motivo"], r"^(bloqueada|não aproveitada): ", (c["tabela"], c["coluna"]))
            vistas[(c["tabela"], c["coluna"])] = vistas.get((c["tabela"], c["coluna"]), 0) + 1
        self.assertTrue(all(n == 1 for n in vistas.values()))
        esperadas = {(t, c) for t in self.todas for c, _, _, _ in l6_13.COLUNAS[t]}
        self.assertEqual(set(vistas), esperadas)

    def test_cada_tabela_tem_o_motivo_do_bloqueio(self):
        texto = ARQ.read_text(encoding="utf-8")
        for t in self.todas:
            self.assertRegex(texto, r"\n#--- %s: bloqueada: \S" % t)

    def test_prontas_validas_contra_mapa_e_regras(self):
        self.assertGreater(len(self.prontas), 150)
        for c in self.prontas:
            dt, _, dc = c["destino"].partition(".")
            self.assertIn(c["tabela"], self.todas)
            self.assertIn(dt, self.por[c["tabela"]]["tabelas_destino"].split(";"), c)
            self.assertTrue(dc, c)
            if c["regra"]:
                self.assertIn(c["regra"], sentinela.REGRAS, c)
            ref = mapa.referencia_declarada(c)
            if ref:
                self.assertIn(ref, self.por, c)
            if not c["coluna"][:1] in "=@#":
                self.assertIn(c["coluna"], [x for x, _, _, _ in l6_13.COLUNAS[c["tabela"]]], c)

    def test_prontas_existem_no_ddl(self):
        ddl = _ddl()
        if not ddl:
            self.skipTest("DDL do destino fora do container")
        for c in self.prontas:
            dt, _, dc = c["destino"].partition(".")
            corpo = re.search(r"CREATE TABLE %s \((.*?)\n\)" % dt, ddl, re.S)
            self.assertTrue(corpo, dt)
            alter = "".join(re.findall(r"ALTER TABLE %s\b(.*?);" % dt, ddl, re.S))
            self.assertRegex(corpo.group(1) + alter, r"\s%s\s" % dc, c["destino"])

    def test_bloqueio_dito_na_pronta_que_aponta_destino_errado_do_pai(self):
        # quem aponta TBCBOPRO (inscrição no conselho) nunca grava direto em coluna de profissional
        for c in self.prontas:
            if "TBCBOPRO" in c["coluna"]:
                self.assertTrue(c["motivo"].startswith("[bloqueia]"), c)
        # nenhuma pronta no segundo destino de PRITENSESQ (duplicaria cada componente)
        self.assertFalse([c for c in self.prontas if c["destino"].startswith("prescricao_item_solucao_componente.")])
        # literal só onde o valor é fato da origem (inclusão, checagem, resultado em texto), nunca presumido em silêncio
        lit = sorted({c["coluna"] for c in self.prontas if c["coluna"].startswith("=")})
        self.assertEqual(lit, ["=inclusao", "=texto"])
        # o evento do horário sai da situação da linha (de-para de valores), nunca de literal
        ev = [c for c in self.prontas if c["destino"] == "horario_administracao_evento.evento"]
        self.assertEqual([(c["coluna"], c["depara"]) for c in ev], [("ID_PRSITUACAOCHECAGEM", "valores")])

    def test_coluna_de_profissional_nunca_descartada_sem_motivo(self):
        # TBCBOPRO é autoria (quem checou, suspendeu, aprazou): bloqueada ou com motivo próprio, nunca genérico
        for c in self.decl:
            if "TBCBOPRO" in c["coluna"]:
                self.assertNotEqual(c["motivo"], "não aproveitada: sem coluna correspondente no destino", c)

    def test_item_padronizado_vai_para_item_prescritivel(self):
        # ck_*_04: item_prescritivel_id ou item_nao_padronizado_id; GEITENS nunca no insumo (apresentação)
        for t in ("PRPRESCMED", "PRITENSESQ", "PRITENSGLICEMIA"):
            g = [c for c in self.prontas if c["tabela"] == t and c["coluna"] == "ID_GEITENS"]
            self.assertEqual(len(g), 1, t)
            self.assertTrue(g[0]["destino"].endswith(".item_prescritivel_id"), g[0])
            self.assertTrue(g[0]["motivo"].startswith("[bloqueia]"), g[0])

    def test_coluna_not_null_sem_padrao_e_situacao_derivada_declaradas(self):
        dest = {c["destino"] for c in self.prontas}
        for d in ("prescricao_item_velocidade.ocorrido_em", "receita_medica.situacao", "exame_lancado_prontuario.situacao",
                  "registro_tempo_evento.situacao", "alta_medica.situacao", "horario_administracao.administrado_por_profissional_id",
                  "prescricao_item_medicamento.tempo_infusao_minutos", "prescricao_item_medicamento.intervalo_doses_minutos"):
            self.assertIn(d, dest)

    def test_esperado_vazio_e_anomalias_da_imagem(self):
        vals = {}
        self.assertEqual(l6_13.linhas(random.Random(1), lambda t, v: vals.setdefault(t, []).append(v)), {})
        self.assertEqual(sum(len(v) for v in vals.values()), 92)
        zero = datetime.datetime(1899, 12, 30)
        self.assertEqual(sentinela.aplicar("data_hora", zero)[1], "data_sentinela")
        self.assertEqual(sentinela.aplicar("data_hora", zero + datetime.timedelta(hours=7, minutes=30))[1],
                         "hora_sem_data")
        self.assertEqual(sentinela.aplicar("booleano_sn", "x")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.colisoes_caixa(["S", "N", "x", "s"]), [["S", "s"]])
        # a imagem leva as duas datas sentinela na primeira data e hora anulável de PRRECEITA
        cols = [c for c, _, _, _ in l6_13.COLUNAS["PRRECEITA"]]
        i = cols.index("DATA_HORA_SUSPENSAO")
        self.assertEqual([v[i] for v in vals["PRRECEITA"][2:]], [zero, zero + datetime.timedelta(hours=7, minutes=30)])


if __name__ == "__main__":
    unittest.main()
