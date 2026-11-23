"""Fatia L5-05 (cadastros e administração): plano da carga dirigida pelo mapa, cobertura das colunas obrigatórias do
destino, regras de coluna e coerência da imagem sintética. Só dados inventados (sintetica_d/l5_05.py)."""
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_05

# na ordem do mapa (C3, 2026-11-22: TBUNIDAD depende de TBCBOPRO, que agora vem depois de TBPROFIS)
CARREGADAS = ["TBGENERO_SOCIAL", "TBGERSEQ", "TBGRAU_INST", "TBGRUCONVEN", "TBMEDSOL", "TBMUIBGE", "TBORGAOEMIS",
              "TBPARENTE", "TBPESQUIPLANO", "TBRELIG", "TBSEXO", "TBTIPOATEUNIDADE", "TBTIPOTELEFONE",
              "TBTPDOCUMENTO", "TBUNID_IDADE", "TBVULNERABILIDADE_SOCIAL", "TBEMPHOS", "TBEMPHOSLOGO", "TBUNIDAD",
              "TBCBOPRO_TBUNIDAD"]  # lotação depois de TBPROFIS
# descarte com motivo de produto (declarado/sem_carga.tsv)
DESCARTE = {"TBPESSOA": "duplicado"}
# declaradas e comentadas até o motor ter o mecanismo: nenhuma desde a rodada 3 (conselho_classe em depara.CATALOGOS)
AGUARDAM = []


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
        self.plano = carga_mapa.planejar(self.m, set(CARREGADAS + AGUARDAM + list(DESCARTE)))

    def test_so_as_carregaveis_entram_em_ordem(self):
        self.assertEqual([p["tabela"] for p in self.plano], CARREGADAS)

    def test_um_destino_por_tabela_e_literal_fora_da_leitura(self):
        por = {p["tabela"]: p for p in self.plano}
        for p in self.plano:
            if p["tabela"] != "TBEMPHOS":
                self.assertEqual(len(p["destinos"]), 1, p["tabela"])
        # empresa: mantenedora (principal) e a pessoa jurídica dela gravada ANTES (adotada pelo CNPJ), ligada por @id
        self.assertEqual(por["TBEMPHOS"]["destinos"], ["mantenedora", "pessoa_juridica", "pessoa_fisica",
                                                       "trilha_auditoria"])
        self.assertTrue(por["TBEMPHOS"]["opcoes"]["pessoa_juridica"].get("antes"))
        self.assertEqual(por["TBEMPHOS"]["opcoes"]["pessoa_juridica"]["adotar"], ["cnpj"])
        self.assertIn("@id:pessoa_juridica",
                      [c["coluna"] for c in por["TBEMPHOS"]["colunas"]["mantenedora"]])
        perfil = por["TBTIPOATEUNIDADE"]
        self.assertNotIn("=~outro", perfil["lidas"])
        self.assertIn({"coluna": "=~outro", "destino": "categoria", "regra": "", "depara": "", "referencia": "",
                       "valores": None},
                      perfil["colunas"]["perfil_unidade"])
        # gerador de números: destino decidido (sequência de negócio), não a regra do prontuário
        self.assertEqual(por["TBGERSEQ"]["destinos"], ["sequencia_negocio"])

    def test_adocao_do_que_o_l3_criou(self):
        por = {p["tabela"]: p for p in self.plano}
        self.assertEqual(por["TBSEXO"]["opcoes"]["sexo"]["adotar"], ["sigla"])
        self.assertEqual(por["TBTIPOTELEFONE"]["opcoes"]["tipo_telefone"]["adotar"], ["codigo"])
        self.assertEqual(por["TBTPDOCUMENTO"]["opcoes"]["tipo_documento_identificacao"]["adotar"], ["codigo"])
        self.assertEqual(por["TBCBOPRO_TBUNIDAD"]["opcoes"]["lotacao_profissional"]["adotar"],
                         ["profissional_id", "estabelecimento_id", "ocupacao_cbo_id"])

    def test_referencias_encadeadas_da_inscricao(self):
        """CBOPRO é id da inscrição: profissional e ocupação vêm pela cadeia, nunca pelo de-para CBO sobre o id."""
        por = {p["tabela"]: p for p in self.plano}
        cols = {c["destino"]: c for c in por["TBCBOPRO_TBUNIDAD"]["colunas"]["lotacao_profissional"]}
        self.assertEqual([x.get("tabela") or x.get("coluna") for x in cols["profissional_id"]["passos"]],
                         ["TBCBOPRO", "ID_TBPROFIS", "TBPROFIS"])
        self.assertEqual([x.get("tabela") or x.get("coluna") for x in cols["ocupacao_cbo_id"]["passos"]],
                         ["TBCBOPRO", "ID_TBCBOSUS", "TBCBOSUS", "COD"])
        self.assertEqual(cols["ocupacao_cbo_id"]["depara"], "cbo")
        # forma alternativa (passos): a simples herdaria o de-para cbo gerado para CBOPRO e o aplicaria ao id
        self.assertEqual(cols["inscricao_conselho_id"]["passos"], [{"tabela": "TBCBOPRO", "modo": "alt", "arg": "ID"}])
        un = {c["destino"]: c for c in por["TBUNIDAD"]["colunas"]["unidade_assistencial"]}
        self.assertEqual(un["farmaceutico_profissional_id"]["passos"][-1]["tabela"], "TBPROFIS")

    def test_diretor_e_autorizador_pelo_profissional(self):
        """CPF e, de reserva, CNS do profissional (chave alternativa), concorrentes na mesma coluna do destino."""
        por = {p["tabela"]: p for p in self.plano}
        cols = [c for c in por["TBUNIDAD"]["colunas"]["unidade_assistencial"]
                if c["destino"] in ("diretor_profissional_id", "autorizador_profissional_id")]
        self.assertEqual([(c["destino"], c["coluna"], c["passos"]) for c in cols], [
            ("diretor_profissional_id", "CPF_DIR", [{"tabela": "TBPROFIS", "modo": "alt", "arg": "CPF"}]),
            ("diretor_profissional_id", "CNS_DIR", [{"tabela": "TBPROFIS", "modo": "alt", "arg": "CNS"}]),
            ("autorizador_profissional_id", "CPF_AUT", [{"tabela": "TBPROFIS", "modo": "alt", "arg": "CPF"}]),
            ("autorizador_profissional_id", "CNS_AUT", [{"tabela": "TBPROFIS", "modo": "alt", "arg": "CNS"}])])

    def test_mantenedora_responsavel_dmed_e_retrato_fiscal(self):
        p = {p["tabela"]: p for p in self.plano}["TBEMPHOS"]
        self.assertTrue(p["opcoes"]["pessoa_fisica"].get("antes"))
        self.assertTrue(p["opcoes"]["pessoa_fisica"].get("opcional"))
        self.assertEqual(p["opcoes"]["pessoa_fisica"]["adotar"], ["cpf"])
        man = {c["destino"]: c for c in p["colunas"]["mantenedora"]}
        self.assertEqual(man["responsavel_pessoa_fisica_id"]["coluna"], "@id:pessoa_fisica")
        self.assertEqual(man["tipo_declarante_dmed"]["valores"],
                         {"1": "prestador_saude", "2": "operadora", "3": "prestador_e_operadora"})
        tr = {c["destino"]: c["coluna"] for c in p["colunas"]["trilha_auditoria"]}
        self.assertEqual(tr["dados_depois"], "#retrato:*")
        self.assertEqual(tr["entidade_id"], "@id")

    def test_municipio_parte_fiscal_na_trilha(self):
        """A parte oficial do município nunca é gravada; a configuração fiscal do cliente vai para a trilha."""
        p = {p["tabela"]: p for p in self.plano}["TBMUIBGE"]
        self.assertEqual(p["destinos"], ["trilha_auditoria"])
        tr = {c["destino"]: c for c in p["colunas"]["trilha_auditoria"]}
        self.assertEqual(tr["entidade_id"]["depara"], "ibge_municipio")
        self.assertTrue(tr["dados_depois"]["coluna"].startswith("#retrato:VALOR_MIN_RETENCAO_ISS,"))
        for c in ("NOME", "UF", "MUNICIPIO_TOM"):
            self.assertNotIn(c, p["lidas"])

    def test_unidade_de_idade_pelo_nome(self):
        por = {p["tabela"]: p for p in self.plano}
        cols = {c["destino"]: c for c in por["TBUNID_IDADE"]["colunas"]["unidade_idade"]}
        calc, sig = cols["unidade_calculo"]["valores"], cols["sigla"]["valores"]
        self.assertEqual({calc["Anos"], calc["Meses"], calc["DIAS"], calc["Horas"], calc["Semanas"]},
                         {"ano", "mes", "dia", "hora", "semana"})
        self.assertTrue(set(calc.values()) <= {"ano", "mes", "semana", "dia", "hora"})  # CHECK do destino
        self.assertEqual(len(set(sig[k] for k in ("Ano", "Mês", "Semana", "Dia", "Hora"))), 5)  # sigla única
        self.assertNotIn("Décadas", calc)

    def test_descartes_e_comentadas(self):
        """Descarte com causa de produto e fora do plano; as comentadas não entram até o mecanismo existir."""
        import csv
        dirm = Path(mapa.__file__).resolve().parents[1] / "mapa" / "declarado"
        if not (dirm / "sem_carga.tsv").exists():
            self.skipTest("declarações ausentes")
        sc = {r["tabela"]: r for r in csv.DictReader(open(dirm / "sem_carga.tsv", encoding="utf-8"), delimiter="\t")}
        for t, causa in DESCARTE.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa), t)
        nomes = [p["tabela"] for p in self.plano]
        for t in list(DESCARTE) + AGUARDAM:
            self.assertNotIn(t, nomes)

    def test_codigo_numerico_vira_texto(self):
        for p in self.plano:
            for c in p["colunas"][p["destinos"][0]]:
                if c["destino"] == "codigo":
                    if c["coluna"].startswith("#codigo_derivado:"):
                        self.assertEqual(c["regra"], "texto_nome", p["tabela"])
                    else:
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


class SolicitanteExterno(unittest.TestCase):
    def setUp(self):
        m = _mapa()
        if m is None:
            self.skipTest("mapa do conector ausente")
        self.p = {p["tabela"]: p for p in carga_mapa.planejar(m, {"TBMEDSOL"})}["TBMEDSOL"]

    def test_conselho_uf_e_ocupacao_pelos_catalogos_oficiais(self):
        cols = {}
        for c in self.p["colunas"]["solicitante_externo"]:
            cols.setdefault(c["destino"], c)  # coluna concorrente: a primeira declarada é a da origem
        self.assertEqual(self.p["destinos"], ["solicitante_externo"])
        self.assertEqual(cols["conselho_classe_id"]["depara"], "conselho_classe")
        self.assertEqual(cols["conselho_unidade_federativa_id"]["depara"], "ibge_uf")
        self.assertEqual(cols["ocupacao_cbo_id"]["depara"], "cbo")
        self.assertEqual(cols["numero_conselho"]["regra"], "texto")
        self.assertNotIn("COD_CONVENIO", self.p["lidas"])

    def test_conselho_nulo_na_origem_presume_crm(self):
        # causa de 3.680 recusas 1048 na carga real: a origem não guarda o conselho em 3.678 cadastros antigos; a
        # melhor estimativa pela evidência (ADR 0007, 18) é CRM, presumida e só quando o conselho é NULO (a sigla fora
        # do catálogo continua recusando)
        cc = [c for c in self.p["colunas"]["solicitante_externo"] if c["destino"] == "conselho_classe_id"]
        self.assertEqual([c["coluna"] for c in cc], ["ID_TBCONSPROF", "=~CRM"])
        self.assertEqual(cc[1]["cod"], ("conselho_classe", "sigla"))
        self.assertEqual((cc[1]["se"]["coluna"], cc[1]["se"]["valores"]), ("ID_TBCONSPROF", [""]))

    def test_inscricao_repetida_adota_a_ja_gravada(self):
        # causa das recusas 1062 na carga real (1.250 linhas): o mesmo conselho, UF e número repetido é o mesmo
        # solicitante; a linha já gravada é adotada (mescla não destrutiva, ADR 0007, 20), nunca recusada
        self.assertEqual(self.p["opcoes"]["solicitante_externo"]["adotar"],
                         ["conselho_classe_id", "conselho_unidade_federativa_id", "numero_conselho"])

    def test_conselho_presumido_nao_adota(self):
        # ADR 0007 (18 e 20): o CRM presumido nunca é chave de identidade: com a chave já gravada, recusa para revisão
        # (adocao_por_valor_presumido), nunca funde o solicitante sem conselho com o CRM verdadeiro
        c = object.__new__(carga_mapa.CargaMapa)
        achou = []
        c._todas = lambda sql, args=(): achou
        v = {"conselho_classe_id": 1, "conselho_unidade_federativa_id": 35, "numero_conselho": "1001"}
        vals = {"solicitante_externo": [("", v)]}
        c._presumidas = {("solicitante_externo", "conselho_classe_id")}
        self.assertIsNone(c._adocao_presumida(self.p, vals))  # sem colisão: linha própria
        achou.append((7,))
        self.assertEqual(c._adocao_presumida(self.p, vals), ("adocao_por_valor_presumido", "alta"))
        c._presumidas = set()  # conselho da origem: a adoção normal (mesma pessoa) segue
        self.assertIsNone(c._adocao_presumida(self.p, vals))
        self.assertEqual(carga_mapa.GRAVIDADE_REGRA["adocao_por_valor_presumido"], "alta")

    def test_sigla_do_conselho_normalizada(self):
        from sante_conector import depara
        self.assertEqual(depara.norm_conselho(b" CRM "), "CRM")
        self.assertEqual(depara.norm_conselho("C.R.M"), "CRM")
        self.assertIsNone(depara.norm_conselho("1"))


class Regras(unittest.TestCase):
    def test_regras_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto", 5), ("5", None))
        self.assertEqual(a("texto_nome", "Convênios   privados".encode("cp1252")), ("Convênios privados", None))
        self.assertEqual(a("texto", b" Fundamental\r\nincompleto "), ("Fundamental\r\nincompleto", None))
        self.assertEqual(a("codigo_char", b"a"), ("a", None))
        self.assertEqual(a("codigo_char", b"A"), ("A", None))
        self.assertEqual(a("texto", b"   "), (None, None))
        self.assertEqual(a("booleano_sn", b"S"), (True, None))
        self.assertEqual(a("booleano_sn", b"X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.colisoes_caixa(["A", "a", "1"]), [["A", "a"]])
        self.assertEqual(a("inteiro_zeros_esquerda:8", 1310100), ("01310100", None))
        self.assertEqual(a("faixa:0,100", 150.0), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_ai", b"I"), (False, None))
        self.assertEqual(a("inteiro_nao_negativo", -5), (None, "valor_fora_do_dominio"))
        self.assertEqual(carga_mapa.codigo_derivado("SSP", 10), ("SSP", False))
        self.assertTrue(carga_mapa.codigo_derivado("Secretaria de Segurança Pública", 10)[1])
        self.assertEqual(carga_mapa.codigo_derivado("7", 60, "origem_"), ("origem_7", False))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l5_05.linhas(None, lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(sorted(esp), sorted(CARREGADAS))
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items()
                          if r.startswith("restricao_destino_") or r in ("codigo_colisao_caixa",
                                                                          "adocao_por_valor_presumido"))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
        for t in AGUARDAM + list(DESCARTE):
            self.assertNotIn("CREATE TABLE %s " % t, l5_05.DDL)
        self.assertEqual(l5_05.AUXILIARES, ["TBCONSPROF"])
        self.assertNotIn("TBCONSPROF", esp)
        self.assertEqual(set(l5_05.PAIS_EXTERNOS), {"TBPROFIS", "TBCBOPRO"})
        self.assertEqual(sentinela.aplicar("cnpj", int(l5_05.CNPJ_NOVO)), (l5_05.CNPJ_NOVO, None))
        self.assertEqual(sentinela.aplicar("cnpj", int(l5_05.CNPJ_EXISTENTE)), (l5_05.CNPJ_EXISTENTE, None))
        for c in (l5_05.CPF_RESP_NOVO, l5_05.CPF_RESP_EXISTENTE, l5_05.CPF_PROF_100, l5_05.CPF_SEM_PROF):
            self.assertEqual(sentinela.aplicar("cpf", int(c)), (c, None))

    def test_destino_do_l3_preparado(self):
        """As linhas que o L3 cria estão guardadas para a conferência da adoção pela chave natural."""
        for x in ("'M'", "'F'", "'I'", "'residencial'", "'celular'", "'rg'"):
            self.assertIn(x, l5_05.DESTINO_L3)
        self.assertIn(l5_05.DESTINO_L3, l5_05.PREPARO_DESTINO)



class ContinuidadeR5(unittest.TestCase):
    """ADR 0006: o logotipo vai ao armazenamento de arquivos (#arquivo), nunca ao banco."""
    def test_logotipo_por_arquivo(self):
        m = mapa.carregar_execucao()
        d = [c["coluna"] for c in m["colunas_decl"]
             if c["tabela"] == "TBEMPHOSLOGO" and c["destino"] == "logotipo_estabelecimento.arquivo_id"]
        self.assertEqual(d, ["#arquivo:LOGO_EMPRESA:logotipo", "#arquivo:LOGO_PREFEITURA:logotipo"])

if __name__ == "__main__":
    unittest.main()
