"""Fatia L5-11 (cadastros e administração, módulo RH): declarações e plano da carga dirigida pelo mapa.
Só metadado do mapa e do DDL do modelo; dados só da imagem SINTÉTICA (sintetica_d/l5_11.py)."""
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_11

DECLARADAS = {"FPVACINA", "POTPCONTTEMP"}
# o destino aceitaria o literal 'outro', mas o chute esconderia a classificação (sinal neutro e banco de horas
# desligado no movimento, intervalo fora da jornada) ou duplicaria o conceito (vale e tipo de vale como benefícios
# irmãos, com colisão de beneficio.codigo e sem o vínculo ao tipo): mesmo critério de AGUARDAM_DEPARA
AGUARDAM_CLASSIFICACAO = {"FPVALE": "beneficio", "PETPINTERVALO": "tipo_intervalo", "PETP_MOVIM": "tipo_movimento_ponto"}
# destino com classificador NOT NULL sem padrão e sem valor neutro, que a origem não traz: aguardam o de-para de valor
# declarado e a recusa por linha do erro 1364 (pedidos em docs/obra/fatias/f4/saida/L5-11.json)
AGUARDAM_DEPARA = {"PEPERIOD_JUSTIF": ("abrangencia_justificativa", "abrangencia"),
                   "POCLASSIFMARC": ("classificacao_marcacao", "sentido"),
                   "POREPHOMOLOGADO": ("tipo_relogio_ponto", "categoria_portaria"),
                   "POTPHORA": ("tipo_hora", "natureza"),
                   "POTPTRABFOLGA": ("regime_jornada", "carga_semanal_minutos")}
# domínio que vira valor de CHECK no consumidor, catálogo oficial (só de-para) ou mecanismo (parâmetro): sem carga
SEM_CARGA = {"FPTP_SAL", "FPTP_TREINAMENTO_CAPACITACAO", "STEMITENTE", "PEPARAM", "PODIA", "POPROGSIT",
             "POPROSITUACAO", "PETP_INTEGR_EVENTO", "POBANCOHRTP", "POTPINIBANCO", "POTPJORNADA"}


def _raiz():
    return Path("/app") if Path("/app/db/migracoes").exists() else mapa.RAIZ


class FatiaL511(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["_arquivo"].endswith("L5-11.tsv")]
        cls.ddl = mapa.ler_ddl(_raiz())

    def test_fatia_inteira_classificada(self):
        fatia = {r["tabela"] for r in self.m["tabelas"] if r.get("ordem", "").isdigit() and 182 <= int(r["ordem"]) <= 202}
        self.assertEqual(fatia, DECLARADAS | set(AGUARDAM_DEPARA) | set(AGUARDAM_CLASSIFICACAO) | SEM_CARGA)

    def test_plano_so_com_as_declaradas(self):
        p = carga_mapa.planejar(self.m, DECLARADAS | SEM_CARGA | set(AGUARDAM_DEPARA) | set(AGUARDAM_CLASSIFICACAO))
        self.assertEqual({x["tabela"] for x in p}, DECLARADAS)
        for x in p:
            self.assertEqual(len(x["destinos"]), 1, x["tabela"])  # destino secundário do mapa não é usado

    def test_colunas_existem_no_ddl_e_regra_valida(self):
        self.assertEqual({c["tabela"] for c in self.decl}, DECLARADAS)
        for c in self.decl:
            t, col = c["destino"].split(".")
            self.assertIn(col, self.ddl[t]["colunas"], c["destino"])
            if c["regra"]:
                self.assertIn(c["regra"], sentinela.REGRAS)
            self.assertNotEqual(c["regra"], "chave_origem")  # chave própria vira código, não referência
            if c["destino"].endswith(".codigo"):
                self.assertEqual(c["regra"], "texto", c["destino"])  # VARCHAR no destino: soma de controle igual

    def test_sem_literal_de_classificador(self):
        """Classificador nunca entra por chute: nem literal, nem tabela que aguarda classificação."""
        self.assertFalse([c for c in self.decl if c["coluna"].startswith("=")])
        self.assertFalse({c["tabela"] for c in self.decl} & set(AGUARDAM_CLASSIFICACAO))
        for t, dt in AGUARDAM_CLASSIFICACAO.items():
            r = next(x for x in self.m["tabelas"] if x["tabela"] == t)
            self.assertIn(dt, r["tabelas_destino"].split(";"), t)

    def test_limite_semanal_fora_da_faixa_tem_caso_zero(self):
        self.assertIn("(5, 0)", Path(l5_11.__file__).read_text())

    def test_aguardam_depara_tem_obrigatoria_sem_padrao(self):
        """Se o DDL ganhar padrão (ou valor neutro 'outro') nessas colunas, a tabela pode ser declarada: o teste avisa."""
        for t, (dt, col) in AGUARDAM_DEPARA.items():
            r = next(x for x in self.m["tabelas"] if x["tabela"] == t)
            self.assertIn(dt, r["tabelas_destino"].split(";"), t)
            linhas = self.ddl[dt]["create"].splitlines()
            linha = next(x for x in linhas if re.match(r"\s+%s\s" % col, x))
            self.assertIn("NOT NULL", linha)
            self.assertNotIn("DEFAULT", linha)
            self.assertNotIn("'outro'", "".join(x for x in linhas if (col + " IN") in x))

    def test_sintetica_cobre_as_declaradas(self):
        self.assertEqual(set(re.findall(r"CREATE TABLE (\w+)", l5_11.DDL)), DECLARADAS)
        for c in self.decl:
            if c["coluna"][:1] in "=@":
                continue
            ddl_t = re.search(r"CREATE TABLE %s \((.*?)\);" % c["tabela"], l5_11.DDL, re.S).group(1)
            self.assertRegex(ddl_t, r"\b%s\b" % c["coluna"])


if __name__ == "__main__":
    unittest.main()
