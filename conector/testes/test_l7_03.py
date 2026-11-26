"""Fatia L7-03 (SADT e suprimentos, módulo SADT): declarações planejadas, regras das colunas, de-para de valores e
coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L7-03`."""
import decimal
import os
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l7_03

TABELAS = set(l7_03.CARREGADAS)
BLOQUEADAS = set(l7_03.BLOQUEADAS)


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | BLOQUEADAS)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def prim(self, t, dt, dc):
        """A primeira declaração do destino `dt.dc` (as concorrentes vêm depois, na ordem do mapa)."""
        return next(c for c in self.plano[t]["colunas"][dt] if c["destino"] == dc)

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        esperado = {"SIPOSRES": ["resposta_padrao"], "SIRECIPI": ["recipiente_coleta"],
                    "SISTATUS_AMOSTRA": ["situacao_amostra"],
                    # a faixa de referência do analito no exame entrou (pedido 15 atendido no verificador)
                    "SITABELE": ["analito", "exame_analito", "faixa_referencia", "unidade_resultado"],
                    "SITABPRO": ["exame"],
                    # recusas fase 2 (P4): o exame do resultado padrão vem do secundário exame (real adotado ou
                    # o excluído da origem, criado de migração)
                    "SIRESPAD": ["modelo_resultado", "exame"],
                    "SITPEQVMODELO": ["modelo_comunicacao"], "SIWEBCADPERFIL": ["perfil_portal_resultado"],
                    "SIWEBCADPERFIL_SIPACSMODALID": ["perfil_portal_modalidade"],
                    "SIWEBCADPERFIL_TBUSERS": ["perfil_portal_usuario"], "SIWEBPARLAUDO": ["modelo_impressao_laudo"],
                    # cobertura: grandeza sem seção (a origem não tem seção); complementos; visualizador
                    "SITBGRAN": ["grandeza_laudo"],
                    "SIWEBPARPERFIL": ["perfil_portal_resultado"], "SIWEBVISULIMG": ["visualizador_imagem"],
                    "SIVARFORMULA": ["variavel_formula"]}
        for t, dts in esperado.items():
            self.assertEqual(self.plano[t]["destinos"], dts, t)

    def test_obrigatorias_do_destino_cobertas(self):
        req = {("SIPOSRES", "resposta_padrao"): {"grupo_resposta_id", "sequencia", "codigo", "descricao"},
               ("SIRECIPI", "recipiente_coleta"): {"codigo", "descricao"},
               ("SISTATUS_AMOSTRA", "situacao_amostra"): {"codigo", "descricao"},
               ("SITABELE", "analito"): {"codigo", "nome"},
               ("SITABELE", "exame_analito"): {"exame_id", "analito_id", "ordem"},
               ("SITABELE", "unidade_resultado"): {"codigo", "descricao", "simbolo"},
               ("SIRESPAD", "modelo_resultado"): {"exame_id", "nome", "vigencia_inicio"},
               ("SITABPRO", "exame"): {"codigo", "sigla", "nome", "tipo_servico"},
               ("SITPEQVMODELO", "modelo_comunicacao"): {"codigo", "descricao", "padrao_mensagem"},
               ("SIWEBCADPERFIL", "perfil_portal_resultado"): {"codigo", "descricao", "publico"},
               ("SIWEBCADPERFIL_SIPACSMODALID", "perfil_portal_modalidade"): {"perfil_portal_resultado_id",
                                                                               "modalidade_imagem_id"},
               ("SIWEBCADPERFIL_TBUSERS", "perfil_portal_usuario"): {"perfil_portal_resultado_id", "usuario_id"},
               ("SIWEBPARLAUDO", "modelo_impressao_laudo"): {"estabelecimento_id", "codigo", "descricao"},
               ("SITBGRAN", "grandeza_laudo"): {"exame_id", "codigo", "descricao"},
               ("SIWEBVISULIMG", "visualizador_imagem"): {"estabelecimento_id", "codigo", "nome", "url_base"},
               ("SIVARFORMULA", "variavel_formula"): {"formula_calculo_id", "sequencia", "identificador", "descricao",
                                                      "fonte"}}
        for (t, dt), cs in req.items():
            self.assertTrue(cs <= set(self.cols(t, dt)), (t, cs - set(self.cols(t, dt))))

    def test_referencias(self):
        ref = lambda t, dt, c: self.cols(t, dt)[c]["referencia"]  # noqa: E731
        self.assertEqual(ref("SIPOSRES", "resposta_padrao", "grupo_resposta_id"), "SICTRPSR")
        self.assertEqual(ref("SITABELE", "analito", "metodo_analitico_id"), "SIMETODO")
        self.assertEqual(ref("SITABELE", "exame_analito", "grupo_resposta_id"), "SICTRPSR")
        self.assertEqual(self.cols("SITABELE", "exame_analito")["analito_id"]["coluna"], "@id")
        self.assertEqual(self.cols("SITABELE", "exame_analito")["exame_id"]["passos"],
                         [{"tabela": "SITABPRO", "modo": "alt", "arg": "CODALF"}])
        # a unidade do cliente é criada uma vez e adotada pelas linhas seguintes; sem unidade não grava
        op = self.plano["SITABELE"]["opcoes"]["unidade_resultado"]
        self.assertTrue(op["opcional"])
        self.assertEqual(op["adotar"], ["codigo"])
        # rodada 3: gravada antes do analito, que liga a ela (sem unidade: NULL)
        self.assertTrue(op["antes"])
        self.assertEqual(self.cols("SITABELE", "analito")["unidade_resultado_id"]["coluna"], "@id:unidade_resultado")
        self.assertEqual(ref("SITABPRO", "exame", "especialidade_diagnostica_id"), "SIESPEC")
        self.assertEqual(ref("SITABPRO", "exame", "modalidade_imagem_id"), "SIPACSMODALID")
        # sexo: TBSEXO não entra no conector_origem (L3 pelas siglas; adoção pedida no L5-05): não aproveitado
        self.assertNotIn("sexo_id", self.cols("SITABPRO", "exame"))
        self.assertNotIn("TBSEXO", l7_03.PAIS_EXTERNOS)
        self.assertEqual(ref("SIWEBCADPERFIL_TBUSERS", "perfil_portal_usuario", "usuario_id"), "TBUSERS")
        self.assertEqual(ref("SIWEBPARLAUDO", "modelo_impressao_laudo", "setor_diagnostico_id"), "SIMODULO")
        # autorreferência: gravada em duas fases
        self.assertEqual(ref("SISTATUS_AMOSTRA", "situacao_amostra", "situacao_anterior_id"), "SISTATUS_AMOSTRA")
        self.assertIn("SISTATUS_AMOSTRA", self.plano["SISTATUS_AMOSTRA"]["duas_fases"])
        for t in self.plano:
            for dt in self.plano[t]["destinos"]:
                for c in self.plano[t]["colunas"][dt]:
                    if c["destino"].endswith("_id") and c["coluna"][:1] not in "=@" and not c.get("passos"):
                        self.assertEqual(c["regra"], "chave_origem", (t, c["destino"]))

    def test_literais_presumidos_e_estabelecimento(self):
        self.assertEqual(self.cols("SIRECIPI", "recipiente_coleta")["tipo"]["coluna"], "=~outro")
        self.assertEqual(self.cols("SITABPRO", "exame")["tipo_servico"]["coluna"], "=~outro")
        self.assertEqual(self.cols("SITPEQVMODELO", "modelo_comunicacao")["padrao_mensagem"]["coluna"],
                         "=~proprietario")
        self.assertEqual(self.cols("SIWEBCADPERFIL", "perfil_portal_resultado")["publico"]["coluna"],
                         "=~medico_externo")
        self.assertEqual(self.cols("SIWEBPARLAUDO", "modelo_impressao_laudo")["estabelecimento_id"]["coluna"],
                         "@estabelecimento")

    def test_codigos_como_texto(self):
        for t, dt in [("SIRECIPI", "recipiente_coleta"), ("SISTATUS_AMOSTRA", "situacao_amostra"),
                      ("SITABELE", "analito"), ("SITABPRO", "exame"), ("SITPEQVMODELO", "modelo_comunicacao"),
                      ("SIWEBCADPERFIL", "perfil_portal_resultado"), ("SIWEBPARLAUDO", "modelo_impressao_laudo"),
                      ("SIPOSRES", "resposta_padrao")]:
            self.assertEqual(self.cols(t, dt)["codigo"]["regra"], "texto", t)
        self.assertEqual(sentinela.aplicar("texto", 12), ("12", None))

    def test_tipo_resultado_por_valores(self):
        c = self.cols("SITABELE", "analito")["tipo_resultado"]
        self.assertEqual(c["depara"], "valores")
        self.assertEqual(c["valores"], {"S": "numerico", "N": "texto"})

    def test_segredos_e_layout_nunca_migram(self):
        decl = {(c["tabela"], c["coluna"]): c for c in self.mapa["colunas_decl"]}
        pronta = (mapa.DIR_PACOTE / "declarado/colunas.d/L7-03.tsv").read_text(encoding="utf-8")
        for col in ("SENHA_EXPORTACAO", "SENHA_FTP"):
            self.assertEqual(decl[("SITPEQV", col)]["destino"], "")
            # cada senha tem o seu #cofre (pendência segredo_aguarda_cofre própria): nunca gravada em claro
            self.assertIn("\nSITPEQV\t#cofre:%s\tinterface_equipamento.chave_cofre_credencial" % col, pronta)
        self.assertIn("\nSITPEQV\tCRIPTOGRAFIA_AES\tinterface_equipamento.criptografia\tbooleano_sn", pronta)
        for col in ("INTERFACE", "COD_LABORATORIO", "NOME_LABORATORIO", "USUARIO_FTP"):
            self.assertTrue(decl[("SITPEQV", col)]["motivo"].strip(), col)
        self.assertEqual(decl[("SIWEBPARLAUDO", "ARQUIVO_LAUDO")]["destino"], "")

    def test_declaracao_pronta_do_apoio(self):
        # rodada 4 (DDL 10_SADT/09): o apoio da interface e os exames do apoio carregam
        from sante_conector import mapa as m
        pronta = (mapa.DIR_PACOTE / "declarado/colunas.d/L7-03.tsv").read_text(encoding="utf-8").splitlines()
        self.assertFalse([l for l in pronta if l.startswith("#SITPEQV\t") or l.startswith("#SITBEXHP\t")])
        com = [l.split("\t") for l in pronta if l.split("\t")[0] in ("SITPEQV", "SITBEXHP") and l.split("\t")[2]]
        self.assertIn("SITPEQV", self.plano)
        self.assertIn("SITBEXHP", self.plano)
        dest = {(c[0], c[2]): c for c in com}
        self.assertIn("antes;opcional;adotar:codigo", dest[("SITPEQV", "laboratorio_apoio.codigo")][5])
        self.assertEqual(dest[("SITPEQV", "interface_equipamento.laboratorio_apoio_id")][1], "@id:laboratorio_apoio")
        self.assertEqual(dest[("SITPEQV", "laboratorio_apoio.ativo")][1], "=~0")
        via = dest[("SITBEXHP", "exame_laboratorio_apoio.exame_id")][5]
        passos = m.passos_ref(via[4:])
        self.assertEqual(passos[0]["modo"], "alt_composta")
        self.assertEqual(passos[0]["arg"], ["TIPO", "COD_EXAME"])
        self.assertEqual(passos[0]["coluna_destino"], "exame_id")
        self.assertEqual(m.passos_ref(dest[("SITBEXHP", "exame_laboratorio_apoio.laboratorio_apoio_id")][5][4:])[0]
                         .get("destino"), "laboratorio_apoio")
        for col in ("NECESSITA_PESO", "NECESSITA_ALTURA", "TEMPODIURESE", "VOLUMEDIURESE"):
            self.assertTrue(any(c[1] == col and c[3] == "booleano_sn" for c in com), col)
        # nenhuma senha no apoio nem nos exames do apoio
        self.assertFalse(any("SENHA" in c[1] and not c[1].startswith("#cofre:") and c[2] for c in com))

    def test_exame_ativo_tipo_e_sigla(self):
        # inativo entra inativo, desativado na data da carga (cumpre ck_exame_desativacao)
        ex = self.cols("SITABPRO", "exame")
        self.assertEqual(ex["ativo"]["coluna"], "SITUACAO")
        self.assertEqual(ex["ativo"]["regra"], "booleano_ai")
        self.assertEqual((ex["desativado_em"]["coluna"], ex["desativado_em"]["regra"]), ("SITUACAO", "booleano_ai"))
        self.assertEqual(ex["desativado_em"]["valores"], {"1": "", "0": "@data_carga", "": ""})
        self.assertEqual(ex["tipo_resultado"]["coluna"], "=~misto")
        # sigla em chave única sem caixa: codigo_char passa pela detecção de colisão de caixa
        self.assertEqual(self.prim("SITABPRO", "exame", "sigla")["regra"], "codigo_char")
        # recusas fase 2 (P4): concorrente presumida para o exame sem mnemônico (sigla derivada do código)
        self.assertEqual([c["coluna"] for c in self.plano["SITABPRO"]["colunas"]["exame"] if c["destino"] == "sigla"],
                         ["CODALF", "#codigo_derivado:ID:10:s"])
        self.assertEqual(sentinela.colisoes_caixa({"VDR": 1, "Vdr": 1, "GLI": 1}), [["VDR", "Vdr"]])
        self.assertEqual(self.plano["SITABELE"]["destinos"][0], "analito")

    def test_analito_titulo_e_limites_zero(self):
        an = self.cols("SITABELE", "analito")
        # a obrigatoriedade não vem do título: o analito fica com o padrão do destino
        self.assertNotIn("resultado_obrigatorio", an)
        ea = self.cols("SITABELE", "exame_analito")
        self.assertEqual((ea["titulo"]["coluna"], ea["titulo"]["regra"]), ("TITULO", "booleano_sn"))
        self.assertEqual(ea["obrigatorio"]["valores"], {"1": "0", "0": "", "": ""})
        self.assertEqual(ea["ordem"]["coluna"], "CODELE")
        for c in ("limite_minimo_aceito", "limite_maximo_aceito"):
            self.assertEqual(an[c]["regra"], "decimal_zero_nulo")
        self.assertEqual(sentinela.aplicar("decimal_zero_nulo", decimal.Decimal("0.0000")), (None, None))

    def test_bloqueadas_sem_destino(self):
        self.assertFalse(BLOQUEADAS & set(self.plano))
        self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] in BLOQUEADAS and c.get("destino")])


    def test_cobertura_referencia_composta_e_complementos(self):
        decl = {(c["tabela"], c["destino"]): c for c in self.mapa["colunas_decl"] if c.get("destino")}
        self.assertEqual(decl[("SITBGRAN", "grandeza_laudo.exame_id")]["via"], "ref:SITABPRO(ATO,EXAME)")
        self.assertEqual(mapa.passos_ref("SITABPRO(ATO,EXAME)"),
                         [{"tabela": "SITABPRO", "modo": "composta", "arg": ["ATO", "EXAME"]}])
        self.assertEqual(decl[("SIWEBPARPERFIL", "perfil_portal_resultado.id")]["via"], "ref:SIWEBCADPERFIL;complementa")
        # recusas fase 2 (P4): o exame do resultado padrão é o do secundário exame, que pela chave composta
        # (ATO,EXAME) copia o código do exame real e o adota
        self.assertEqual(decl[("SIRESPAD", "modelo_resultado.exame_id")]["coluna"], "@id:exame")
        ec = [c for c in self.mapa["colunas_decl"] if c["tabela"] == "SIRESPAD" and c["destino"] == "exame.codigo"]
        self.assertEqual([(c["coluna"], c["via"]) for c in ec],
                         [("ATO", "ref:SITABPRO(ATO,EXAME)@codigo;antes;adotar:codigo"),
                          ("#codigo_derivado:ATO+EXAME:30:exame_excluido_", "presumida")])
        self.assertEqual(self.plano["SIRESPAD"]["opcoes"]["exame"]["adotar"], ["codigo"])
        self.assertTrue(self.plano["SIWEBPARPERFIL"]["opcoes"]["perfil_portal_resultado"]["complementa"])
        # r5 (ADR 0006): a ligação interface x modelo entra na trilha da interface (retrato); o modelo ESCOLHIDO
        # continua vindo de uma só fonte (a SITPEQV), sem gravar por cima da interface
        self.assertEqual(self.plano["SITPEQV_SITPEQVMODELO"]["destinos"], ["trilha_auditoria"])
        self.assertEqual(decl[("SITPEQV_SITPEQVMODELO", "trilha_auditoria.entidade_id")]["via"],
                         "ref:SITPEQV;trilha_auditoria")
        # ordem: o exame vem antes do resultado padrão e do analito no exame
        ordem = {p["tabela"]: i for i, p in enumerate(carga_mapa.planejar(self.mapa, TABELAS))}
        self.assertLess(ordem["SITABPRO"], ordem["SIRESPAD"])
        self.assertLess(ordem["SITABPRO"], ordem["SITABELE"])
        # secao_laudo_estruturado não recebe linha: a origem não tem seção
        self.assertNotIn("secao_laudo_estruturado", self.plano["SITBGRAN"]["destinos"])

    def test_rodada3_revisao(self):
        # resultado padrão: HTML e, sem ele, o texto antigo (concorrentes, nessa ordem)
        dec = [c for c in self.mapa["colunas_decl"] if c["tabela"] == "SIRESPAD"
               and c.get("destino") == "modelo_resultado.texto_html"]
        self.assertEqual([c["coluna"] for c in dec], ["RESULTADO_HTML", "DESCR"])
        # variável de fórmula: fórmula do exame pela chave alternativa composta; fonte digitada presumida
        v = self.cols("SIVARFORMULA", "variavel_formula")
        self.assertEqual(v["formula_calculo_id"]["passos"][0]["modo"], "alt_composta")
        self.assertEqual(v["formula_calculo_id"]["passos"][0]["tabela"], "SIFORMUL")
        self.assertEqual(v["fonte"]["coluna"], "=~digitado")
        self.assertEqual(v["sequencia"]["coluna"], "#seq:EXAME")
        # faixa de referência: a declaração pronta entrou ativa (o verificador aceita @id:exame_analito)
        texto = (mapa.DIR_PACOTE / "declarado/colunas.d/L7-03.tsv").read_text(encoding="utf-8")
        self.assertNotIn("\n#SITABELE\t", texto)
        f = self.cols("SITABELE", "faixa_referencia")
        self.assertEqual(f["exame_analito_id"]["coluna"], "@id:exame_analito")
        self.assertEqual(f["referencia_minima"]["regra"], "decimal_zero_nulo")
        self.assertTrue(self.plano["SITABELE"]["opcoes"]["faixa_referencia"]["opcional"])
        self.assertEqual(f["referencia_maxima"]["regra"], "decimal_zero_nulo")
        self.assertEqual(f["referencia_texto"]["regra"], "texto_resumo:300")
        self.assertEqual(f["vigencia_inicio"]["coluna"], "@vigencia_carga")

    def test_visualizador_inativo_ate_ter_endereco(self):
        v = self.cols("SIWEBVISULIMG", "visualizador_imagem")
        self.assertEqual(v["url_base"]["coluna"], "=~about:blank")
        self.assertEqual(v["ativo"]["coluna"], "=~0")
        self.assertEqual(v["estabelecimento_id"]["coluna"], "@estabelecimento")

    def test_descartes_com_causa_de_produto(self):
        sc = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        self.assertNotIn("SIVARFORMULA", sc)  # rodada 3: carrega (fórmula da SIFORMUL)
        # r5 (ADR 0006): nenhum descarte; as listas do portal viram opções da lista do produto
        self.assertFalse({"SITPEQV_SITPEQVMODELO", "SIWEBPARDATA", "SIWEBPARTPATU"} & set(sc))
        self.assertEqual(set(l7_03.DESCARTADAS), set())
        for t, chave in (("SIWEBPARDATA", "migracao.periodo_portal_resultado"), ("SIWEBPARTPATU", "migracao.tipo_atualizacao_portal")):
            self.assertEqual(self.plano[t]["destinos"][0], "parametro_opcao", t)
            c = {x["destino"]: x["coluna"] for x in self.mapa["colunas_decl"] if x["tabela"] == t}
            self.assertEqual(c["parametro_definicao.chave"], "=" + chave)


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Hemoglobina   glicada ".encode("cp1252")), ("Hemoglobina glicada", None))
        self.assertEqual(a("texto_nome", b"   "), (None, None))
        self.assertEqual(a("booleano_ai", b"A"), (True, None))
        self.assertEqual(a("booleano_ai", b"X")[1], "valor_fora_do_dominio")
        self.assertEqual(a("booleano_sn", b"N"), (False, None))
        self.assertEqual(a("inteiro_nao_negativo", -5)[1], "valor_fora_do_dominio")
        texto = "Jejum de 4 horas.\r\n  Trazer pedido."
        self.assertEqual(a("texto_longo", texto.encode("cp1252")), (texto, None))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l7_03.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        self.assertTrue(BLOQUEADAS <= set(cont))
        for t, e in esp.items():
            recusam = ("restricao_destino_", "pai_pendente", "codigo_colisao_caixa")
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(recusam))
            if t == "SISTATUS_AMOSTRA":  # pai_pendente da autorreferência sai na fase 2: a linha fica gravada
                recusas -= e["pendencias"]["pai_pendente"]
            if t in ("SIWEBPARPERFIL", "SIVARFORMULA"):  # complemento / por_pai sem pai: recusa (pai_inexistente)
                recusas += e["pendencias"].get("pai_inexistente", 0)
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_colunas_da_origem(self):
        for t, cols in l7_03.COLUNAS.items():
            self.assertEqual(len(cols), len(set(cols)), t)
        self.assertEqual(set(l7_03.COLUNAS), TABELAS | BLOQUEADAS | set(l7_03.FORMA_SO) |
                         set(l7_03.PAIS_NA_IMAGEM))



def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class Conferencia(unittest.TestCase):
    def test_apoio_por_exame_pela_equivalencia(self):
        """SITBEXHP 1: apoio da interface 1 (código 7), exame próprio HB copiado da equivalência 1/HGB, exige peso."""
        from sante_conector import conferencia
        lidos = {}

        def ler(cc):
            with cc.cursor() as c:
                c.execute("SELECT a.codigo, e.sigla, x.codigo_exame_apoio, x.exige_peso, x.exige_altura FROM"
                          " exame_laboratorio_apoio x JOIN laboratorio_apoio a ON a.id=x.laboratorio_apoio_id"
                          " JOIN exame e ON e.id=x.exame_id")
                lidos["apoio"] = [[str(v) for v in x] for x in c.fetchall()]
        r = conferencia.conferir("L7-03", depois_da_primeira=ler)
        self.assertEqual(r["erros"], [])
        self.assertEqual(lidos["apoio"], [["7", "HB", "HGB", "1", "0"]])

    def test_ligacao_interface_modelo_r5(self):
        # r5 (achado): a ligação vai à trilha como operação trazida da origem, datada pela evidência (nunca a carga)
        pl = {p["tabela"]: p for p in carga_mapa.planejar(mapa.carregar_execucao(), TABELAS | BLOQUEADAS)}
        t = {c["destino"]: c for c in pl["SITPEQV_SITPEQVMODELO"]["colunas"]["trilha_auditoria"]}
        self.assertEqual(t["acao"]["coluna"], "=operacao")
        self.assertEqual(t["ocorrido_em"]["coluna"], "#vigencia")
        self.assertIn("vigencia", t["ocorrido_em"])
        # conciliação na imagem: o modelo escolhido de cada interface pertence ao conjunto das ligações dela
        lig, esc = {}, {}
        def ins(tab, v):
            d = dict(zip(l7_03.COLUNAS[tab], v))
            if tab == "SITPEQV_SITPEQVMODELO":
                lig[d["ID"]] = (d["ID_SITPEQV"], d["ID_SITPEQVMODELO"])
            elif tab == "SITPEQV":
                esc[d["CODIGO"]] = d["ID_SITPEQV_SITPEQVMODELO"]
        l7_03.linhas(random.Random(1), ins)
        fora = [k for k, e in esc.items() if lig[e][0] != k and k != 4]  # a 4 é recusada (sem nome)
        self.assertEqual(fora, [])
        self.assertEqual(len([k for k, (i, _) in lig.items() if i == 1]), 2)  # escolhida + alternativa


if __name__ == "__main__":
    unittest.main()
