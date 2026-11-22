"""Fatia L8-15 (faturamento e restantes, módulo SGO): declarações planejadas, literais e coerência da imagem
sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L8-15`."""
import random
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_15

TABELAS = set(l8_15.CARREGADAS) | set(l8_15.NOVAS) | {"PSBENCPL"}
FORA = set(l8_15.NAO_CARREGADAS)
# tabelas cujo destino recebe códigos de várias origens: código = prefixo de domínio + chave, adoção pela descrição
POR_PREFIXO = {"PSTIPMEN": "origem_cobranca_plano", "PSTIPOGUIA": "tipo_guia_plano",
            "PSTPACUMULPOR": "nivel_acumulo_limite", "PSTPPERIODO": "unidade_prazo",
            "TBTIPOCOBRANCASGO": "origem_cobranca_plano", "TBTPPRESTADOR": "tipo_prestador_rede",
            "TBTPUNIDTEMPO": "unidade_prazo"}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | FORA)}

    def cols(self, t, d):
        return {c["destino"]: c for c in self.plano[t]["colunas"][d]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t in TABELAS - {"PSBENEFI", "PSBENCPL"} - set(l8_15.NOVAS):
            self.assertEqual(len(self.plano[t]["destinos"]), 1, t)
        # rodada 5 (ADR 0006): lista do hospital (opção, módulo e definição) e mescla do complemento
        for t in set(l8_15.NOVAS) - {"PSTPSVIGENCIA"}:
            self.assertEqual(self.plano[t]["destinos"], ["parametro_opcao", "modulo_sistema", "parametro_definicao"], t)
        # r5c (ADR 0006): a taxa por vigência carrega na trilha com o retrato até o carregador oficial da ANS
        self.assertEqual(self.plano["PSTPSVIGENCIA"]["destinos"], ["trilha_auditoria"])
        self.assertEqual(self.plano["PSBENCPL"]["destinos"][:2], ["beneficiario_plano", "pessoa_fisica"])
        # r5b: e-mail do complemento e a linha inteira em retrato no histórico do beneficiário (nada se perde)
        # r5c (ADR 0007, 17 e 20): a senha web do complemento vai à credencial do usuário do beneficiário (mescla)
        self.assertEqual(set(self.plano["PSBENCPL"]["destinos"][2:]),
                         {"email_pessoa", "movimento_cadastral_beneficiario", "credencial_usuario"})
        self.assertEqual(self.plano["PSBENEFI"]["destinos"],
                         ["beneficiario_plano", "pessoa_fisica", "documento_pessoa", "email_pessoa",
                          "grau_parentesco_dependente", "movimento_cadastral_beneficiario", "usuario",
                          "credencial_usuario", "conta_portal_beneficiario"])  # r5c: retrato e acesso ao portal
        self.assertEqual(self.plano["PSVENDAS"]["destinos"], ["proposta_adesao"])

    def test_codigo_com_prefixo_e_adocao_onde_o_destino_e_compartilhado(self):
        prefixos = set()
        for t, d in POR_PREFIXO.items():
            cs = self.cols(t, d)
            self.assertTrue(cs["codigo"]["coluna"].startswith("#codigo_derivado:"), t)
            prefixos.add(cs["codigo"]["coluna"].split(":")[3])
            self.assertEqual(cs["descricao"]["coluna"], "NOME", t)
            self.assertEqual(self.plano[t]["opcoes"][d].get("adotar"), ["descricao"], t)
        self.assertEqual(len(prefixos), len(POR_PREFIXO))  # um prefixo de domínio por origem
        self.assertEqual(carga_mapa.codigo_derivado("3", 30, "periodo_"), ("periodo_3", False))
        cs = self.cols("TBENVCOBEMAIL", "preferencia_envio_cobranca")
        self.assertEqual(cs["codigo"]["coluna"], "ID")

    def test_literais(self):
        self.assertEqual(self.cols("PSTIPMEN", "origem_cobranca_plano")["natureza"]["coluna"], "=~mensalidade")
        self.assertEqual(self.cols("TBTIPOCOBRANCASGO", "origem_cobranca_plano")["natureza"]["coluna"], "=~outra")
        self.assertEqual(self.cols("PSTPPERIODO", "unidade_prazo")["aplica_limite"]["coluna"], "=1")
        self.assertEqual(self.cols("TBTPUNIDTEMPO", "unidade_prazo")["aplica_contrato"]["coluna"], "=1")

    def test_canal_de_cobranca_presumido_no_valor_seguro(self):
        # a opção de NÃO enviar também é linha desta tabela: nunca presumir um canal que dispara envio
        self.assertEqual(self.cols("TBENVCOBEMAIL", "preferencia_envio_cobranca")["canal"]["coluna"], "=~nenhum")

    def test_comportamento_sem_origem_sempre_presumido(self):
        # colunas que mudam o comportamento nunca ficam com o padrão do destino em silêncio
        esperado = {("PSTIPOGUIA", "tipo_guia_plano", "internacao"): "=~0",
                    ("PSTIPOGUIA", "tipo_guia_plano", "exige_autorizacao"): "=~1",
                    ("TBSTATUSCREPLS", "situacao_movimento_rede", "comunica_ans"): "=~0",
                    ("TBSTATUSCREPLS", "situacao_movimento_rede", "ativa_prestador"): "=~0",
                    ("TBTPCONTRATOCREPLS", "tipo_contrato_rede", "contratacao_direta"): "=~1"}
        for (t, d, c), lit in esperado.items():
            self.assertEqual(self.cols(t, d)[c]["coluna"], lit, (t, c))

    def test_classificacao_heterogenea_nunca_literal_fixo(self):
        # natureza, unidade e canal variam por linha na origem: só presumido (=~), nunca literal definido
        for t, d, c in (("PSTIPMEN", "origem_cobranca_plano", "natureza"),
                        ("TBTIPOCOBRANCASGO", "origem_cobranca_plano", "natureza"),
                        ("PSTPPERIODO", "unidade_prazo", "unidade_base"),
                        ("TBTPUNIDTEMPO", "unidade_prazo", "unidade_base"),
                        ("TBREGIMEATEND", "regime_atendimento_rede", "natureza")):
            self.assertTrue(self.cols(t, d)[c]["coluna"].startswith("=~"), (t, c))

    def test_descartadas_com_causa_de_produto(self):
        # cobertura total: toda tabela fora da carga tem descarte com causa aceita e motivo (declarado/sem_carga.tsv)
        sc = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        # rodada 5 (ADR 0006): listas e complemento carregam; só o catálogo oficial da ANS fica de fora
        causas = {}  # r5c: PSTPSVIGENCIA carrega na trilha (retrato) até o carregador da ANS
        for t in list(l8_15.NOVAS) + ["PSBENCPL"]:
            self.assertNotIn(t, sc, t)
        self.assertNotIn("PSVENDAS", sc)
        # o descarte como catálogo oficial é coerente com declarado/catalogos.tsv
        cat = {r["tabela"] for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/catalogos.tsv")}
        self.assertTrue({t for t, c in causas.items() if c == "catalogo_oficial"} <= cat)
        # prova do motivo fora da própria fatia: os três domínios são valores fixos do produto por CHECK no DDL
        arq = [r / "db/migracoes/16_SGO/02_tabelas.sql" for r in (Path(__file__).resolve().parents[2], Path("/app"))]
        arq = [x for x in arq if x.is_file()]
        if not arq:
            self.skipTest("DDL fora do alcance")
        ddl = arq[0].read_text(encoding="utf-8")
        for chk in (r"favorecido IN \('operadora','prestador','ambos','beneficiario'\)",
                    r"forma_reajuste IN \('ipca','igpm'", r"tipo_vigencia IN \('determinada','indeterminada'\)"):
            self.assertRegex(ddl, chk)
        self.assertEqual(set(causas), FORA)
        for t, causa in causas.items():  # r5b: sem carregador oficial não é descarte resolvido: bloqueada, visível
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("bloqueada", causa + "_faltante"), t)
            self.assertTrue(sc[t]["motivo"], t)

    def test_beneficiario_nunca_sem_contrato_plano_e_pessoa(self):
        cs = self.cols("PSBENEFI", "beneficiario_plano")
        decl = {c["destino"]: (c["coluna"], c.get("via") or "") for c in self.mapa["colunas_decl"]
                if c["tabela"] == "PSBENEFI" and c.get("destino")}
        self.assertEqual(decl["beneficiario_plano.contrato_plano_id"], ("EMP", "ref:PSEMPBEN"))
        self.assertEqual(decl["beneficiario_plano.plano_comercializado_id"], ("PLANO", "ref:PSPLANOS"))
        self.assertEqual(decl["beneficiario_plano.pessoa_fisica_id"], ("@id:pessoa_fisica", ""))
        # obrigatórias do destino todas com fonte; situação presumida, nunca afirmada
        for c in ("tipo", "matricula", "data_adesao", "inicio_vigencia"):
            self.assertIn(c, cs)
        sit = [c for c in self.plano["PSBENEFI"]["colunas"]["beneficiario_plano"] if c["destino"] == "situacao"]
        self.assertEqual((sit[0]["coluna"], sit[0]["depara"]), ("STATUS", "valores"))
        self.assertEqual((cs["tipo"]["coluna"], cs["tipo"]["depara"]), ("DEP", "valores"))
        self.assertEqual(decl["beneficiario_plano.titular_beneficiario_plano_id"],
                         ("ID_PSBENEFI_VINCULO", "ref:PSBENEFI.ID"))
        self.assertEqual(cs["fim_vigencia"]["coluna"], "FIM_VIG")
        # PSBENCPL (rodada 5) só MESCLA no beneficiário e na pessoa adotados pelo id (adotar:id): nunca sobrescreve
        vias = [c.get("via") or "" for c in self.mapa["colunas_decl"] if c["tabela"] == "PSBENCPL" and c.get("destino", "").endswith(".id")]
        self.assertEqual(sorted(v.split(";")[-1] for v in vias), ["adotar:id", "adotar:id"])
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] == "PSBENCPL" and "complementa" in (c.get("via") or "")])

    def test_pessoa_nasce_do_beneficiario_e_grau_do_parentesco(self):
        # a pessoa física é gravada ANTES do beneficiário e adotada pelo CPF; nunca pelo índice descartado da origem
        op = self.plano["PSBENEFI"]["opcoes"]
        self.assertTrue(op["pessoa_fisica"]["antes"])
        self.assertEqual(op["pessoa_fisica"]["adotar"], ["cpf"])
        self.assertFalse(op["pessoa_fisica"]["opcional"])  # todo beneficiário tem pessoa (NOT NULL)
        pf = self.cols("PSBENEFI", "pessoa_fisica")
        self.assertEqual({c: pf[c]["coluna"] for c in ("nome", "cpf", "data_nascimento", "nome_mae", "cns")},
                         {"nome": "NOME", "cpf": "CPF", "data_nascimento": "NASC", "nome_mae": "MAE", "cns": "CNS"})
        self.assertEqual(pf["cpf"]["regra"], "cpf")
        self.assertEqual(pf["cns"]["regra"], "inteiro_zeros_esquerda:15")  # nunca recusa pelo CHECK de 15 dígitos
        self.assertEqual(pf["sexo_id"]["cod"], ("sexo", "sigla"))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] == "PSBENEFI"
                          and "TBPESSOA" in (c.get("via") or "")])
        # grau: criado ou adotado pelo código do parentesco, só no dependente (opcional), antes do beneficiário
        self.assertTrue(op["grau_parentesco_dependente"]["antes"] and op["grau_parentesco_dependente"]["opcional"])
        self.assertEqual(op["grau_parentesco_dependente"]["adotar"], ["codigo"])
        gr = self.cols("PSBENEFI", "grau_parentesco_dependente")
        self.assertEqual(gr["tipo_beneficiario"]["coluna"], "=dependente")
        self.assertEqual(gr["descricao"]["passos"][-1], {"coluna": "NOME"})
        bp = self.cols("PSBENEFI", "beneficiario_plano")
        self.assertEqual(bp["grau_parentesco_dependente_id"]["coluna"], "@id:grau_parentesco_dependente")

    def test_contato_e_documento_na_pessoa_do_beneficiario(self):
        op = self.plano["PSBENEFI"]["opcoes"]
        # identidade: uma linha só quando há número; adotada pela sequência da pessoa já cadastrada (sem choque)
        self.assertEqual(op["documento_pessoa"]["desdobrar"], [("IDENT", "1")])
        self.assertEqual(op["documento_pessoa"]["adotar"], ["pessoa_fisica_id", "sequencia"])
        doc = self.cols("PSBENEFI", "documento_pessoa")
        self.assertEqual(doc["pessoa_fisica_id"]["coluna"], "@id:pessoa_fisica")
        self.assertEqual((doc["tipo_documento_identificacao_id"]["coluna"],
                          doc["tipo_documento_identificacao_id"]["cod"]), ("=rg", ("tipo_documento_identificacao", "codigo")))
        self.assertEqual(doc["data_emissao"]["coluna"], "EXPEDICAO")
        # e-mail: opcional (inválido não grava), regra email, ligado à pessoa
        self.assertTrue(op["email_pessoa"]["opcional"])
        self.assertEqual(op["email_pessoa"]["adotar"], ["pessoa_fisica_id", "sequencia"])
        em = self.cols("PSBENEFI", "email_pessoa")
        self.assertEqual((em["email"]["coluna"], em["email"]["regra"]), ("EMAIL", "email"))
        self.assertEqual(em["pessoa_fisica_id"]["coluna"], "@id:pessoa_fisica")
        # telefone e endereço: sem destino estruturado (pedido r5c-1), preservados no retrato do movimento (ADR 0006)
        decl = {c["coluna"]: c for c in self.mapa["colunas_decl"] if c["tabela"] == "PSBENEFI"}
        self.assertEqual(self.cols("PSBENEFI", "movimento_cadastral_beneficiario")["dados"]["coluna"], "#retrato:*")
        for c, ped in (("FONE", "r5c-1"), ("CELULAR", "r5c-1"), ("ENDER", "r5c-1"), ("CEP", "r5c-1")):
            self.assertFalse(decl[c].get("destino"), c)
            self.assertIn(ped, decl[c]["motivo"], c)

    def test_obito_marca_a_pessoa_falecida(self):
        pf = [c for c in self.plano["PSBENEFI"]["colunas"]["pessoa_fisica"] if c["destino"] == "falecida"]
        self.assertEqual([(c["coluna"], c["regra"]) for c in pf],
                         [("NUM_DECLARACAO_OBITO", "preenchido"), ("ID_PFGUIAS_OBITO", "preenchido")])
        self.assertEqual(sentinela.aplicar("preenchido", "99999999"), (True, None))
        self.assertEqual(sentinela.aplicar("preenchido", None), (None, None))  # sem óbito: padrão falso do destino
        decl = {c["coluna"]: c for c in self.mapa["colunas_decl"] if c["tabela"] == "PSBENEFI"}
        self.assertIn("r5c-1", decl["ID_TBCID10_OBITO"]["motivo"])  # causa no retrato do movimento
        self.assertNotIn("pedido 8", decl["NUM_DECLARACAO_OBITO"]["motivo"])

    def test_cpf_falso_valido(self):
        for x in (l8_15.CPF_NOVO, l8_15.CPF_JA_CADASTRADO):
            self.assertEqual(sentinela.aplicar("cpf", x)[0], "%011d" % x)

    def test_situacao_e_tipo_pela_evidencia_nunca_ativo_presumido(self):
        pares = {}
        for v in self.mapa["valores"]:
            if v["tabela"] == "PSBENEFI":
                pares.setdefault(v["coluna"], {})[v["valor_origem"]] = v["valor_destino"]
        self.assertEqual(pares["DEP"]["0"], "titular")
        self.assertEqual({pares["DEP"][str(i)] for i in range(1, 100)}, {"dependente"})
        st = pares["STATUS"]
        # só A tem domínio documentado; nulo (sem código) é suspenso; nenhum outro código vira fato por par fixo
        self.assertEqual(st, {"A": "ativo", "": "suspenso"})
        # código sem par: NULL com valor_fora_do_dominio por linha, e o concorrente grava suspenso (nunca o padrão
        # 'ativo' do destino); a ordem declarada põe STATUS antes do literal
        sit = [c["coluna"] for c in self.plano["PSBENEFI"]["colunas"]["beneficiario_plano"]
               if c["destino"] == "situacao"]
        self.assertEqual(sit, ["STATUS", "=suspenso"])

    def test_venda_vira_proposta_efetivada_com_plano_e_contrato_do_beneficiario(self):
        cs = self.cols("PSVENDAS", "proposta_adesao")
        self.assertEqual(cs["situacao"]["coluna"], "=efetivada")
        self.assertEqual(cs["estabelecimento_id"]["coluna"], "@estabelecimento")
        decl = {c["destino"]: c.get("via") for c in self.mapa["colunas_decl"] if c["tabela"] == "PSVENDAS"
                and c.get("destino")}
        self.assertEqual(decl["proposta_adesao.plano_comercializado_id"], "ref:PSBENEFI>PLANO>PSPLANOS")
        self.assertEqual(decl["proposta_adesao.contrato_plano_id"], "ref:PSBENEFI>EMP>PSEMPBEN")

    def test_modelo_de_email_entra_inativo(self):
        cs = self.cols("TBTPEMAILPLS", "modelo_comunicacao_beneficiario")
        self.assertEqual(cs["ativo"]["coluna"], "=0")
        self.assertEqual(cs["canal"]["coluna"], "=email")
        self.assertTrue(cs["corpo"]["coluna"].startswith("=~"))

    def test_descartadas_sem_destino(self):
        decl = [c for c in self.mapa["colunas_decl"] if c["tabela"] in FORA]
        self.assertEqual(bool(decl), bool(FORA))  # r5c: nada fora da carga
        self.assertFalse([c for c in decl if c.get("destino")])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Taxa  adesão exemplo ".encode("cp1252")), ("Taxa adesão exemplo", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("texto", b"  Presencial  exemplo "), ("Presencial  exemplo", None))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_15.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(FORA <= set(cont))
        for t, e in esp.items():
            if t == "PSBENCPL":  # a linha sem beneficiário leva uma pai_inexistente por referência e a recusa
                self.assertEqual(cont[t], len(l8_15.PSBENCPL_LINHAS))
                continue
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_linhas_com_a_forma_do_ddl(self):
        vistos = []
        l8_15.linhas(random.Random(1), lambda t, v: vistos.append((t, len(v))))
        for t, n in vistos:
            self.assertEqual(n, len(l8_15.colunas(t)), t)


if __name__ == "__main__":
    unittest.main()
