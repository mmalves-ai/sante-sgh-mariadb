"""Fatia L5-07 (cadastros do RH): plano dirigido pelo mapa, descarte de produto e regras das colunas. Só a imagem
SINTÉTICA."""
import re
import unicodedata
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_07

FATIA = set(l5_07.NAO_CARREGADAS) | {"FPCONDFUNC"}
DOMINIO_FIXO = {"FPADMESOCIAL", "FPCOND_TRAB_IMIGRANTE", "FPASOINDRESUL", "FPCOR", "FPDOSE_VACINA", "FPASOEXAMEORD",
                "FPASOINTEXAME", "FPASORESULTADO", "FPASOTIPO", "FPBR_PDH", "FPCATTIPO", "FPCATTPEMIS",
                "FPCATTPLOCACD", "FPCATTPREG", "FPCAUSA_AFASTAMENTO"}
SEM_VALOR = {"FPAFAST_COD", "FPAFAST_RAIS"}
# catálogo oficial: tabela de destino -> carregador versionado (None = ainda não existe; pedido em saida/L5-07.json)
CATALOGO = {"FPALIQRATCNAE": None, "FPCLASSIFTRIB": None, "FPCODALIQFPAS": None, "FPBANCOPIS": "bcb.py"}


def norm(s):
    """Descrição normalizada para o de-para de domínio: sem acento, minúsculas, espaços colapsados."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return " ".join(s.lower().split())


# de-para das listas fixas do eSocial pela DESCRIÇÃO oficial (nunca pela chave sintética da origem). None = código
# oficial sem valor no CHECK do modelo (decisão de modelo em F4-decisoes-destino.md): pendência por linha, sem presumir.
PARES = {
    ("vinculo_trabalho", "tipo_admissao"): {
        "Admissão": "admissao",
        "Transferência de empresa do mesmo grupo econômico ou transferência entre órgãos do mesmo Ente Federativo":
            "transferencia_mesmo_grupo",
        "Transferência de empresa consorciada ou de consórcio": None,
        "Transferência por motivo de sucessão, incorporação, cisão ou fusão": "transferencia_sucessao",
        "Transferência do empregado doméstico para outro representante da mesma unidade familiar": None,
        "Mudança de CPF": "mudanca_cpf",
        "Transferência quando a empresa sucedida é considerada inapta por inexistência de fato": None},
    ("estrangeiro_colaborador", "condicao_ingresso"): {
        "Refugiado": "refugiado", "Solicitante de refúgio": "solicitante_refugio",
        "Permanência no Brasil em razão de reunião familiar": None,
        "Beneficiado pelo acordo entre países do Mercosul": "residencia_mercosul",
        "Dependente de agente diplomático e/ou consular de países que mantêm convênio de reciprocidade para o "
        "exercício de atividade remunerada no Brasil": "dependente_diplomata",
        "Beneficiado pelo Tratado de Amizade, Cooperação e Consulta entre a República Federativa do Brasil e a "
        "República Portuguesa": None,
        "Outra condição": "outra"},
    ("exame_ocupacional", "indicacao_resultado"): {"Normal": "normal", "Alterado": "alterado", "Estável": "estavel",
                                                   "Agravamento": "agravamento"},
    ("exame_ocupacional", "ordem"): {"Referencial": "referencial", "Sequencial": "sequencial"},
    ("exame_ocupacional", "interpretacao"): {"EE": "exposicao_excessiva", "SC": "significado_clinico",
                                             "SC+": "significado_clinico_acima"},
    ("aso", "conclusao"): {"Apto": "apto", "Inapto": "inapto"},
    ("aso", "tipo"): {"Exame médico admissional": "admissional", "Exame médico periódico": "periodico",
                      "Exame médico de retorno ao trabalho": "retorno_trabalho",
                      "Exame médico de mudança de risco ocupacional": "mudanca_risco",
                      "Exame médico de monitoração pontual": "monitoracao_pontual",
                      "Exame médico demissional": "demissional"},
    ("comunicacao_acidente", "tipo"): {"Inicial": "inicial", "Reabertura": "reabertura",
                                       "Comunicação de óbito": "obito"},
    ("comunicacao_acidente", "iniciativa"): {"Iniciativa do empregador": "empregador",
                                             "Ordem judicial": "ordem_judicial",
                                             "Determinação de órgão fiscalizador": "determinacao_orgao"},
    ("comunicacao_acidente", "tipo_local"): {
        "Estabelecimento do empregador no Brasil": "estabelecimento_empregador",
        "Estabelecimento do empregador no exterior": "exterior",
        "Estabelecimento de terceiros onde o empregador presta serviços": "estabelecimento_terceiro",
        "Via pública": "via_publica", "Área rural": "area_rural", "Embarcação": "embarcacao", "Outros": "outros"},
    ("comunicacao_acidente", "registrador"): {
        "Empregador": "empregador", "Cooperativa": "cooperativa",
        "Sindicato de trabalhadores avulsos não portuários": "sindicato_avulso",
        "Órgão Gestor de Mão de Obra": "orgao_gestor_mao_obra", "Empregado": "empregado",
        "Dependente do empregado": "dependente", "Entidade sindical competente": "entidade_sindical",
        "Médico assistente": "medico", "Autoridade pública": "autoridade_publica"},
    ("vacina_colaborador", "dose"): {"Primeira dose": "primeira", "Segunda dose": "segunda",
                                     "Terceira dose": "terceira", "Reforço": "reforco", "Dose única": "unica"},
    ("colaborador", "raca_cor"): {"1": "branca", "2": "preta", "3": "parda", "4": "amarela", "5": "indigena",
                                  "6": "nao_informada"},
}


def _dominios():
    """{(tabela, coluna): {valores do CHECK}} lido do DDL de destino (db/migracoes/15_RH)."""
    for r in (Path(__file__).resolve().parents[2], Path("/app")):
        d = r / "db/migracoes/15_RH"
        if d.is_dir():
            txt = "\n".join(f.read_text(encoding="utf-8") for f in sorted(d.glob("*tabelas.sql")))
            out = {}
            for t, c in PARES:
                m = re.search(r"CONSTRAINT ck_%s_%s CHECK \(.*?%s IN \(([^)]*)\)" % (t, c, c), txt)
                if m:
                    out[(t, c)] = set(re.findall(r"'([^']*)'", m.group(1)))
            return out
    return None


class PlanoL507(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, FATIA)}
        arq = mapa.DIR_PACOTE / "declarado/sem_carga.tsv"
        cls.sem_carga = {r["tabela"]: r for r in mapa.ler_tsv(arq)}

    def test_so_a_condicao_do_colaborador_e_carregada(self):
        self.assertEqual(set(self.plano) & FATIA, {"FPCONDFUNC"})

    def test_cobertura_total_o_resto_e_descarte_de_produto(self):
        for t in l5_07.NAO_CARREGADAS:
            r = self.sem_carga.get(t)
            self.assertIsNotNone(r, t)
            self.assertEqual(r["situacao"], "descarte", t)
            esp = ("mecanismo_do_produto" if t in DOMINIO_FIXO else "sem_valor" if t in SEM_VALOR
                   else "catalogo_oficial")
            self.assertEqual(r["causa"], esp, t)
            self.assertTrue(r["motivo"].strip(), t)
        self.assertEqual(DOMINIO_FIXO | SEM_VALOR | set(CATALOGO), set(l5_07.NAO_CARREGADAS))

    def test_catalogo_oficial_sem_carregador_e_dito_no_motivo(self):
        raiz = Path(__file__).resolve().parents[2] / "catalogos/carregadores"
        for t, car in CATALOGO.items():
            mot = self.sem_carga[t]["motivo"]
            if car is None:
                self.assertIn("AINDA NÃO EXISTE", mot, t)
                self.assertIn("catalogo_oficial_faltante", mot, t)
            else:
                self.assertIn(car, mot, t)
                if raiz.is_dir():
                    self.assertTrue((raiz / car).is_file(), t)

    def test_aliquota_de_terceiros_aponta_o_consumidor_real_e_a_chave_composta(self):
        mot = self.sem_carga["FPCODALIQFPAS"]["motivo"]
        self.assertIn("FPLOTTRIBCAD.ID_FPCODALIQFPAS", mot)
        self.assertIn("lotacao_tributaria", mot)
        self.assertNotIn("encargo_folha", mot)
        self.assertIn("chave composta", mot)

    def test_dominio_fixo_traduz_pela_descricao_nunca_pela_chave(self):
        for t in DOMINIO_FIXO - {"FPCOR", "FPCAUSA_AFASTAMENTO"}:
            mot = self.sem_carga[t]["motivo"]
            self.assertIn("DESCRIÇÃO normalizada", mot, t)
            self.assertNotRegex(mot, r"ref:%s>ID\b" % t, t)

    def test_pares_oficiais_caem_no_check_do_modelo_e_codigo_sem_par_nao_presume(self):
        dom = _dominios()
        if dom is None:
            self.skipTest("DDL de destino ausente")
        for k, pares in PARES.items():
            self.assertIn(k, dom, k)
            chaves = [norm(d) for d in pares]
            self.assertEqual(len(chaves), len(set(chaves)), k)  # descrição normalizada não colide
            for d, v in pares.items():
                if v is not None:
                    self.assertIn(v, dom[k], (k, d))
        # códigos oficiais hoje sem valor no CHECK (decisão de modelo pendente de migração): ficam sem par
        self.assertEqual(sum(v is None for v in PARES[("vinculo_trabalho", "tipo_admissao")].values()), 3)
        self.assertEqual(sum(v is None for v in PARES[("estrangeiro_colaborador", "condicao_ingresso")].values()), 2)

    def test_condicao_vira_situacao_inativa_com_codigo_prefixado_e_categoria_presumida(self):
        p = self.plano["FPCONDFUNC"]
        self.assertEqual(p["destinos"], ["situacao_colaborador"])
        cols = {c["destino"]: c for c in p["colunas"]["situacao_colaborador"]}
        self.assertEqual(set(cols), {"codigo", "descricao", "categoria", "ativo"})
        self.assertEqual(cols["ativo"]["coluna"], "=0")  # sem consumidor nem evidência: inativa até a revisão
        self.assertEqual(cols["codigo"]["coluna"], "#codigo_derivado:ID:30:cond_")
        self.assertEqual(cols["descricao"]["regra"], "texto_nome")
        self.assertEqual(cols["categoria"]["coluna"], "=~outro")
        self.assertEqual(set(p["lidas"]), {"ID", "NOME"})

    def test_codigo_da_condicao_nunca_choca_com_codigo_de_um_caractere(self):
        for i in (1, 12, 300):
            cod, mudou = carga_mapa.codigo_derivado(str(i), 30, "cond_")
            self.assertEqual((cod, mudou), ("cond_%d" % i, False))
            self.assertGreater(len(cod), 1)

    def test_catalogos_oficiais_da_fatia_nunca_sao_destino_gravado(self):
        por = {r["tabela"]: r for r in self.m["tabelas"]}
        for t in FATIA - {"FPCONDFUNC", "FPDOSE_VACINA"}:
            self.assertTrue(por[t]["destinos_oficiais"], t)
            for c in self.m["colunas_decl"]:
                self.assertNotEqual(c["tabela"], t)

    def test_nomes_colapsam_espacos_e_nulo_fica_nulo(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "  Afastado   temporariamente  ")[0],
                         "Afastado temporariamente")
        self.assertEqual(sentinela.aplicar("texto_nome", None), (None, None))

    def test_esperado_da_imagem_sintetica(self):
        esp = l5_07.linhas(__import__("random").Random(1), lambda t, v: None)
        self.assertEqual(esp, {"FPCONDFUNC": {"gravados": 8, "pendencias": {"restricao_destino_1048": 1,
                                                                             "valor_presumido": 9}}})


if __name__ == "__main__":
    unittest.main()
