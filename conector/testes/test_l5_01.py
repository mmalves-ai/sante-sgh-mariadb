"""Fatia L5-01 (cadastros e administração): declarações sobre o mapa real e carga na imagem SINTÉTICA (dados 100%
falsos, sintetica_d/l5_01.py). Só contagens e regras; nenhum dado real."""
import re
import unittest

from sante_conector import carga_mapa, mapa, sentinela

CARREGADAS = ["FPCON", "TBGRUUSU", "PREMAILCFG", "PREMAILMODULO", "PRLOCPACDEFAULT", "PRTERMOCAD", "PRTERMOACEITE",
              "PRTIPO_JUSTIF_EXPORTACAO", "PRTPNOTIFEMAIL", "RPMATRIZ_GUT_TIPO", "RPMATRIZ_GUT_DESCRICAO", "TBCENARIO",
              "TBCFGLOGIN", "TBDICIONARIO_TBUSERS", "DIPERMPS", "TBCTRPRTUSU", "TBAGEUSE"]
# descarte de produto em declarado/sem_carga.tsv (decisões em docs/obra/passagens/F4-decisoes-destino.md)
DESCARTADAS = ["TBDIGITAR", "TBDIGITAR_CNSCADPAC", "TBDIGITAR_FILIACAO"]
# rodada 3: nenhuma tabela bloqueada (DIPERMPS e TBCTRPRTUSU carregam pelos mecanismos da rodada 2)
AGUARDAM = []
# colunas da origem das tabelas carregadas que ficam fora da declaração (nenhuma: toda coluna sem destino é declarada
# com o motivo); colunas de chave contam como lidas
SEM_DECLARACAO_ACEITA = []


class PlanoL501(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(CARREGADAS + DESCARTADAS + AGUARDAM))}

    def _cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_so_as_carregaveis_entram_e_na_ordem_do_mapa(self):
        self.assertEqual(set(self.plano), set(CARREGADAS))
        ordem = {r["tabela"]: int(r["ordem"]) for r in self.m["tabelas"] if r["tabela"] in CARREGADAS}
        self.assertEqual([p for p in self.plano], sorted(CARREGADAS, key=ordem.get))
        lista = list(self.plano)
        self.assertLess(lista.index("RPMATRIZ_GUT_TIPO"), lista.index("RPMATRIZ_GUT_DESCRICAO"))
        self.assertLess(lista.index("PRTERMOCAD"), lista.index("PRTERMOACEITE"))

    def test_descartes_com_causa_de_produto(self):
        sc = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        for t in DESCARTADAS:
            self.assertEqual(sc[t]["situacao"], "descarte", t)
            self.assertIn(sc[t]["causa"], {"sem_valor", "mecanismo_do_produto"}, t)
            self.assertTrue(sc[t]["motivo"].strip(), t)

    def test_destinos_e_regras_declaradas(self):
        perfil = self._cols("TBGRUUSU", "perfil_acesso")
        self.assertEqual(perfil["codigo"]["coluna"], "#codigo_derivado:NOME:30")  # chave preservada; longa: derivada
        self.assertEqual(perfil["nome"]["regra"], "texto_nome")
        g = self._cols("RPMATRIZ_GUT_DESCRICAO", "grau_priorizacao_gut")
        self.assertEqual((g["dimensao_priorizacao_gut_id"]["regra"], g["dimensao_priorizacao_gut_id"]["referencia"]),
                         ("chave_origem", "RPMATRIZ_GUT_TIPO"))
        # login do usuário pela chave de TBUSERS (referência declarada)
        for t, dt in [("PRLOCPACDEFAULT", "preferencia_usuario"), ("PRTERMOACEITE", "aceite_termo_uso"),
                      ("TBDICIONARIO_TBUSERS", "dicionario_usuario")]:
            self.assertEqual(self._cols(t, dt)["usuario_id"]["referencia"], "TBUSERS", t)
        # só um destino por tabela de vários destinos no mapa (o outro não tem fonte honesta: decisão registrada)
        self.assertEqual(self.plano["PRLOCPACDEFAULT"]["destinos"], ["preferencia_usuario"])
        self.assertEqual(self.plano["TBCFGLOGIN"]["destinos"], ["politica_senha"])
        # tipo de notificação por e-mail é finalidade de envio, não canal
        self.assertEqual(self.plano["PRTPNOTIFEMAIL"]["destinos"], ["finalidade_email"])
        self.assertTrue(self._cols("PRTPNOTIFEMAIL", "finalidade_email")["codigo"]["coluna"].endswith(":notificacao_"))
        termo = self._cols("PRTERMOCAD", "termo_uso_versao")
        self.assertEqual(termo["hash_texto"]["coluna"], "#sha256:TERMO_CONCORDANCIA_USO_PEP")
        self.assertEqual(termo["situacao"]["valores"], {"1": "publicado", "0": "revogado", "": "rascunho"})
        pol = self._cols("TBCFGLOGIN", "politica_senha")
        self.assertEqual(pol["tamanho_minimo"]["regra"], "piso:8")
        self.assertEqual(pol["inatividade_sessao_minutos"]["regra"], "minutos_em_timestamp")
        # o aceite periódico e o período vêm da origem (quantidade x unidade em dias), nunca presumidos
        self.assertEqual(pol["exige_aceite_periodico"]["coluna"], "SOLIC_TERMO_ACEITE_PERIODICO")
        self.assertEqual(pol["exige_aceite_periodico"]["regra"], "booleano_sn")
        self.assertEqual(pol["periodicidade_aceite_dias"]["coluna"],
                         "#dias:QTDE_PERIODO_TERMO_ACEITE,TIPO_PERIODO_TERMO_ACEITE")
        self.assertEqual(sentinela.periodo_em_dias(6, sentinela.unidade_periodo("M"))[0], 180)
        self.assertEqual(sentinela.periodo_em_dias(15, sentinela.unidade_periodo("D")), (15, None))

    def test_nenhuma_coluna_da_origem_sem_declaracao(self):
        # toda coluna da origem das tabelas carregadas está declarada (com destino ou com o motivo de não ter):
        # nada some em silêncio (permissões de prontuário, política de senha, hora UTC)
        decl = {(c["tabela"], c["coluna"]) for c in self.m["colunas_decl"]}
        usadas = {(t, n) for t, n in decl}
        for t, n in list(decl):
            for pre in ("#codigo_derivado:", "#sha256:", "#cofre:", "#dias:"):
                if n.startswith(pre):
                    for x in n[len(pre):].split(":")[0].split(","):
                        usadas.add((t, x))
        chave = {r["tabela"]: r["chave"].split(",") for r in self.m["tabelas"]}
        faltam = [(r["tabela"], r["coluna"]) for r in mapa.ler_tsv(mapa.DIR_PACOTE / "colunas.tsv")
                  if r["tabela"] in CARREGADAS and (r["tabela"], r["coluna"]) not in usadas
                  and r["coluna"] not in chave.get(r["tabela"], [])]
        self.assertEqual(sorted(faltam), sorted(SEM_DECLARACAO_ACEITA))

    def test_hora_local_em_coluna_utc_marcada_por_linha(self):
        # coluna UTC que recebe a hora local: o literal presumido concorrente deixa valor_presumido em cada linha
        for t, dt, dc in [("PRTERMOACEITE", "aceite_termo_uso", "ocorrido_em"),
                          ("PRTERMOCAD", "termo_uso_versao", "vigencia_inicio")]:
            cs = [c["coluna"] for c in self.plano[t]["colunas"][dt] if c["destino"] == dc]
            self.assertEqual(cs[-1], "=~hora_local", (t, dc))
            self.assertEqual(len(cs), 2, (t, dc))

    def test_tipo_de_agenda_do_usuario_carrega(self):
        self.assertEqual(self.plano["TBAGEUSE"]["destinos"], ["usuario_tipo_agenda", "categoria_agenda"])
        op = self.plano["TBAGEUSE"]["opcoes"]["categoria_agenda"]
        self.assertTrue(op.get("antes"))
        self.assertEqual(op.get("adotar"), ["codigo"])
        uta = self._cols("TBAGEUSE", "usuario_tipo_agenda")
        self.assertEqual(uta["categoria_agenda_id"]["coluna"], "@id:categoria_agenda")
        self.assertEqual(uta["usuario_id"]["referencia"], "TBUSERS")
        cat = self._cols("TBAGEUSE", "categoria_agenda")
        self.assertEqual(cat["codigo"]["coluna"], "#codigo_derivado:TPAGE:30:tipo_agenda_")
        self.assertEqual(cat["ativo"]["coluna"], "=0")
        self.assertEqual(carga_mapa.codigo_derivado("0", 30, "tipo_agenda_"), ("tipo_agenda_0", False))

    def test_restricoes_de_acesso_carregam(self):
        # recorte por prestador de serviço: tipo de escopo gravado antes (adotado pelo código) e ligado por @id
        self.assertEqual(self.plano["DIPERMPS"]["destinos"], ["usuario_escopo", "tipo_escopo_acesso"])
        self.assertTrue(self.plano["DIPERMPS"]["opcoes"]["tipo_escopo_acesso"].get("antes"))
        self.assertEqual(self.plano["DIPERMPS"]["opcoes"]["tipo_escopo_acesso"].get("adotar"), ["codigo"])
        esc = self._cols("DIPERMPS", "usuario_escopo")
        self.assertEqual(esc["tipo_escopo_acesso_id"]["coluna"], "@id:tipo_escopo_acesso")
        self.assertEqual(esc["usuario_id"]["referencia"], "TBUSERS")
        passo = esc["entidade_id"]["passos"][0]  # ref:TBPRESER.(ATO,COD,MODULO)=(ATO,PS,MODULO)
        self.assertEqual((passo["modo"], passo["tabela"]), ("alt_composta", "TBPRESER"))
        self.assertEqual((esc["pode_operar"]["coluna"], esc["pode_operar"]["regra"]), ("PERM_GRA", "booleano_sn"))
        self.assertEqual(esc["vigencia_inicio"]["coluna"], "@vigencia_carga")
        tipo = self._cols("DIPERMPS", "tipo_escopo_acesso")
        self.assertEqual((tipo["codigo"]["coluna"], tipo["entidade"]["coluna"]),
                         ("=prestador_servico", "=prestador_terceiro"))
        # tipos de prontuário: a letra vira um tipo de documento clínico (criado inativo uma vez, adotado depois)
        self.assertEqual(self.plano["TBCTRPRTUSU"]["destinos"], ["usuario_tipo_prontuario", "tipo_documento_clinico"])
        self.assertTrue(self.plano["TBCTRPRTUSU"]["opcoes"]["tipo_documento_clinico"].get("antes"))
        utp = self._cols("TBCTRPRTUSU", "usuario_tipo_prontuario")
        self.assertEqual(utp["tipo_documento_clinico_id"]["coluna"], "@id:tipo_documento_clinico")
        self.assertEqual((utp["pode_ler"]["coluna"], utp["pode_escrever"]["coluna"]), ("=1", "=1"))
        doc = self._cols("TBCTRPRTUSU", "tipo_documento_clinico")
        self.assertEqual(doc["codigo"]["coluna"], "#codigo_derivado:OPCAO:30:prontuario_")
        self.assertEqual((doc["categoria"]["coluna"], doc["ativo"]["coluna"]), ("=outro", "=0"))
        self.assertEqual(carga_mapa.codigo_derivado("D", 30, "prontuario_"), ("prontuario_D", False))

    def test_nenhuma_credencial_gravada_em_claro(self):
        decl = [c for c in self.m["colunas_decl"] if c.get("_arquivo", "").endswith("L5-01.tsv")]
        self.assertTrue(decl)
        self.assertEqual([c["coluna"] for c in decl if "SENHA_AUTENTICACAO" in c["coluna"]],
                         ["#cofre:SENHA_AUTENTICACAO"])
        cols = self._cols("PREMAILCFG", "servidor_email")
        self.assertEqual(cols["seguranca"]["valores"], {"1": "ssl_tls", "0": "nenhuma", "": "nenhuma"})
        # sem a senha no cofre o servidor entra inativo: o produto nunca envia sem autenticar
        self.assertEqual(cols["ativo"]["coluna"], "=0")
        self.assertEqual(cols["exige_autenticacao"]["coluna"], "=0")

    def test_descartes_e_bloqueios_declarados(self):
        arq = mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv"
        sem = {l.split("\t")[0] for l in arq.read_text(encoding="utf-8").splitlines()[1:] if l.strip()}
        self.assertTrue(set(DESCARTADAS) <= sem)
        self.assertFalse(set(AGUARDAM) & sem)

    def test_regras_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", b"Enfermagem   plantao "), ("Enfermagem plantao", None))
        self.assertEqual(a("texto", 7), ("7", None))
        self.assertEqual(a("booleano_sn", b"X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_sn", b"T"), (True, None))
        self.assertEqual(a("texto", b" Enfermagem   plantao "), ("Enfermagem   plantao", None))
        self.assertEqual(a("inteiro_zero_nulo", 0), (None, None))


class ConferenciaL501(unittest.TestCase):
    def test_carga_concilia_reexecuta_e_mostra_edicao(self):
        from sante_conector import conferencia

        def editar(cc):
            with cc.cursor() as c:
                c.execute("UPDATE cenario_alerta SET descricao='editado', versao=versao+1 ORDER BY id LIMIT 1")
        r = conferencia.conferir("L5-01", depois_da_primeira=editar)
        self.assertEqual(r["erros"], [])
        e = r["entidades"]
        self.assertEqual((e["perfil_acesso"]["registros_destino"], e["perfil_acesso"]["recusados"]), (8, 1))
        self.assertEqual((e["grau_priorizacao_gut"]["registros_destino"], e["grau_priorizacao_gut"]["recusados"]),
                         (15, 4))
        self.assertEqual(e["politica_senha"]["registros_destino"], 1)
        self.assertEqual(e["servidor_email"]["registros_destino"], 3)
        self.assertNotIn("canal_notificacao", e)
        self.assertNotIn("configuracao_setor_prontuario", e)
        self.assertEqual(r["segunda"]["pendencias_por_regra"].get("cenario_alerta:edicao_no_destino:media"), 1)
        # tipos de prontuário: 5 concessões (A criado uma vez e adotado 2 vezes; B e C criados), 2 recusadas
        self.assertEqual((e["usuario_tipo_prontuario"]["registros_destino"],
                          e["usuario_tipo_prontuario"]["recusados"]), (5, 2))
        # tipos de agenda: 4 concessões (tipo 0 criado uma vez e adotado 2 vezes; 2 criado), login inexistente recusado
        self.assertEqual((e["usuario_tipo_agenda"]["registros_destino"], e["usuario_tipo_agenda"]["recusados"]),
                         (4, 1))

    def _cenario(self, externo=False, pai_antes=False):
        """Conferência da fatia com o mapa ajustado: `externo` dá o prestador como já carregado (fora do plano);
        `pai_antes` simula a aresta de ordem DIPERMPS -> TBPRESER pedida no L5-01.json."""
        import copy
        from sante_conector import conferencia, sintetica
        mod = sintetica.modulo_fatia("L5-01")
        original, ext, flag = mapa.carregar_execucao, mod.PAIS_EXTERNOS, mod.PRESTADOR_JA_CARREGADO
        m = copy.deepcopy(original())
        ordem = {r["tabela"]: r for r in m["tabelas"]}
        if externo:
            ordem["TBPRESER"]["tabelas_destino"] = ""
            mod.PAIS_EXTERNOS, mod.PRESTADOR_JA_CARREGADO = dict(ext, TBPRESER=["1", "2", "3", "4"]), True
        if pai_antes:
            ordem["DIPERMPS"]["ordem"] = str(int(ordem["TBPRESER"]["ordem"]) + 1)
        mapa.carregar_execucao = lambda d=None: m
        try:
            return conferencia.conferir("L5-01")
        finally:
            mapa.carregar_execucao, mod.PAIS_EXTERNOS, mod.PRESTADOR_JA_CARREGADO = original, ext, flag

    def test_recorte_por_prestador_ja_carregado(self):
        r = self._cenario(externo=True)
        self.assertEqual(r["erros"], [])
        e = r["entidades"]
        # 4 recortes gravados (1 cria o tipo de escopo, 3 adotam); ambíguo, inexistente e login inexistente recusados
        self.assertEqual((e["usuario_escopo"]["registros_destino"], e["usuario_escopo"]["recusados"]), (4, 3))
        self.assertNotIn("prestador_terceiro", e)

    def test_recorte_com_a_aresta_de_ordem(self):
        r = self._cenario(pai_antes=True)
        self.assertEqual(r["erros"], [])
        self.assertEqual(r["entidades"]["usuario_escopo"]["recusados"], 7)



class ContinuidadeR5(unittest.TestCase):
    """ADR 0006: a conexão do sistema antigo entra como evento de sessão; as listas de exigência têm prova."""
    def test_fpcon_evento_sessao_e_provas_das_listas(self):
        m = mapa.carregar_execucao()
        d = {(c["coluna"], c["destino"]) for c in m["colunas_decl"] if c["tabela"] == "FPCON"}
        self.assertIn(("=entrada", "evento_sessao.tipo_evento"), d)
        self.assertIn(("DATA_HORA", "evento_sessao.ocorrido_em"), d)
        provadas = {p["tabela"]: p for p in m["provas"]}
        for t in ("TBDIGITAR", "TBDIGITAR_CNSCADPAC", "TBDIGITAR_FILIACAO"):
            self.assertEqual(provadas[t]["tipo"], "derivado", t)
            self.assertTrue(provadas[t]["sql"].upper().startswith("SELECT"), t)


class ProvasComRotulo(unittest.TestCase):
    """Revisão r5 (ADR 0006): a prova das listas liga código E rótulo (rótulo trocado no mesmo código derruba)."""
    def test_valores_com_rotulo(self):
        m = mapa.carregar_execucao()
        pv = {p["tabela"]: p for p in m["provas"]}
        for t, col in [("TBDIGITAR", "DESCRICAO"), ("TBDIGITAR_CNSCADPAC", "DESCRICAO"),
                       ("TBDIGITAR_FILIACAO", "DESCRICAO"), ("TBTIPOREPRE", "DESCRICAO"), ("TBTIPOOID", "NOME"),
                       ("TBPROCBACKUP", "DESCRICAO"), ("TBSITBACKUP", "DESCRICAO"), ("TBTPPERM_RICADPAC", "DESCRICAO")]:
            self.assertEqual(pv[t]["valores"], [("ID", "inteiro"), (col, "texto_nome")], t)
            self.assertIn("'", pv[t]["sql"], t)  # o SQL traz o rótulo esperado de cada código
        self.assertIn("'Mãe'", pv["TBDIGITAR_FILIACAO"]["sql"])
        self.assertIn("'Obrig.atend.SUS'", pv["TBDIGITAR_CNSCADPAC"]["sql"])
        # revisão 2: o equivalente vem do CHECK VIVO do destino; Titular = paciente (ck_consentimento_titular)
        for t in ("TBDIGITAR", "TBDIGITAR_CNSCADPAC", "TBDIGITAR_FILIACAO", "TBTIPOREPRE", "TBTIPOOID",
                  "TBTPPERM_RICADPAC"):
            self.assertIn("information_schema.CHECK_CONSTRAINTS", pv[t]["sql"], t)
            self.assertNotIn("%", pv[t]["sql"], t)  # pymysql formata com args=()
        self.assertIn("'Titular' AS rotulo, 'paciente'", pv["TBTIPOREPRE"]["sql"])
        # filiação e CNS 4: com o parâmetro reduzido a uma regra única do campo, a prova falha (visível)
        self.assertIn("r.campo = 'filiacao'", pv["TBDIGITAR_FILIACAO"]["sql"])
        self.assertIn("r.campo = 'cns'", pv["TBDIGITAR_CNSCADPAC"]["sql"])

    def test_prova_da_identidade(self):
        m = mapa.carregar_execucao()
        pv = {p["tabela"]: p for p in m["provas"]}["TBPESSOA"]
        self.assertEqual((pv["tipo"], pv["chave"]), ("derivado", ["CPF_CNPJ"]))
        self.assertIn("{ctl}.conector_origem", pv["sql"])
        self.assertNotIn("%", pv["sql"])
        for x in ("entidade_destino = 'pessoa_fisica'", "entidade_destino = 'pessoa_juridica'", "beneficiario_plano",
                  "mantenedora", "profissional", "empresa_fornecedora"):
            self.assertIn(x, pv["sql"], x)

if __name__ == "__main__":
    unittest.main()
