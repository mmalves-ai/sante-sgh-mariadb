"""Fatia L8-04 (faturamento e restantes, módulo FAT): declarações planejadas, regras das colunas e coerência da imagem
sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L8-04`."""
import decimal
import random
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_04

TABELAS = set(l8_04.CARREGADAS)
RECUSA = ("restricao_destino_", "pai_pendente", "codigo_colisao_caixa")


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | set(l8_04.BLOQUEADAS))}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        # segundo destino do mapa (favorecido_repasse) não se aplica ao domínio de tipos
        self.assertEqual(self.plano["TBRPATPREPASSE"]["destinos"], ["tipo_prestador_repasse"])
        self.assertEqual(self.plano["TBTIPO_PROCEDIMENTO"]["destinos"], ["tipo_lancamento"])
        self.assertEqual(self.plano["TBTPLANC"]["destinos"], ["tipo_lancamento"])
        self.assertEqual(self.plano["TBGRAUPARTPROC"]["destinos"], ["funcao_equipe_cobranca"])
        # cobertura: destinos decididos (F4-decisoes-destino.md)
        self.assertEqual(self.plano["TBPRESER"]["destinos"], ["prestador_terceiro"])
        self.assertEqual(self.plano["TBSUBDES"]["destinos"], ["subgrupo_natureza_financeira"])
        self.assertEqual(self.plano["TBTABTHM"]["destinos"], ["preco_procedimento", "item_faturavel"])
        self.assertEqual(self.plano["TBFORMULAPAGTO"]["destinos"], ["regra_via_acesso"])

    def test_obrigatorias_do_destino_cobertas(self):
        obrig = {("TBRPATPREPASSE", "tipo_prestador_repasse"): {"codigo", "descricao", "categoria"},
                 ("TBSRVCON", "tipo_servico_contratado"): {"codigo", "descricao", "categoria"},
                 ("TBTABATO", "grupo_ato"): {"codigo", "descricao"},
                 ("TBTIPO_PROCEDIMENTO", "tipo_lancamento"): {"codigo", "descricao", "natureza"},
                 ("TBTPLANC", "tipo_lancamento"): {"codigo", "descricao", "natureza"},
                 ("TBGRAUPARTPROC", "funcao_equipe_cobranca"): {"codigo", "descricao", "tipo_funcao"},
                 ("TBPRESER", "prestador_terceiro"): {"estabelecimento_id", "codigo", "nome", "tipo_pessoa"},
                 ("TBSUBDES", "subgrupo_natureza_financeira"): {"grupo_natureza_financeira_id", "codigo", "descricao",
                                                                "classificacao"},
                 ("TBTABTHM", "preco_procedimento"): {"tabela_preco_id", "sequencia", "item_faturavel_id"},
                 ("TBFORMULAPAGTO", "regra_via_acesso"): {"descricao", "via_acesso_cirurgico_id", "ordem_procedimento",
                                                          "percentual", "vigencia_inicio"}}
        for (t, dt), cs in obrig.items():
            self.assertTrue(cs <= set(self.cols(t, dt)), (t, cs - set(self.cols(t, dt))))

    def test_literais_presumidos(self):
        for t, dt, c, v in [("TBRPATPREPASSE", "tipo_prestador_repasse", "categoria", "=~outro"),
                            ("TBSRVCON", "tipo_servico_contratado", "categoria", "=~outro"),
                            ("TBTPLANC", "tipo_lancamento", "natureza", "=~servico_hospitalar"),
                            ("TBTPLANC", "tipo_lancamento", "gera_repasse", "=~0"),
                            ("TBGRAUPARTPROC", "funcao_equipe_cobranca", "tipo_funcao", "=~outro"),
                            ("TBFORMULAPAGTO", "regra_via_acesso", "vigencia_inicio", "@vigencia_carga")]:
            self.assertEqual(self.cols(t, dt)[c]["coluna"], v, (t, c))
        # recusas fase 2 (P6, A05): o tipo de pessoa do prestador sai do documento (11 dígitos física, 14 jurídica),
        # nunca mais presumido jurídica
        tp = self.cols("TBPRESER", "prestador_terceiro")["tipo_pessoa"]
        self.assertEqual((tp["coluna"], tp["regra"]), ("CGC_CPF", "tipo_pessoa_documento"))

    def test_regras_das_colunas(self):
        g = self.cols("TBTABATO", "grupo_ato")
        self.assertEqual((g["cobra_filme"]["regra"], g["alta_complexidade"]["regra"]), ("booleano_sn", "booleano_sn"))
        t = self.cols("TBTIPO_PROCEDIMENTO", "tipo_lancamento")
        self.assertEqual((t["codigo"]["coluna"], t["codigo"]["regra"]), ("CODIGO", "codigo_char"))
        self.assertEqual(t["sigla"]["coluna"], "CODIGO")
        for tab, dt in [("TBRPATPREPASSE", "tipo_prestador_repasse"), ("TBSRVCON", "tipo_servico_contratado"),
                        ("TBTPLANC", "tipo_lancamento"), ("TBGRAUPARTPROC", "funcao_equipe_cobranca")]:
            self.assertEqual(self.cols(tab, dt)["descricao"]["regra"], "texto_nome", tab)

    def test_natureza_e_repasse_pelo_codigo(self):
        # a natureza e a base de repasse vêm do código da origem, nunca presumidas; fora do domínio não tem par
        t = self.cols("TBTIPO_PROCEDIMENTO", "tipo_lancamento")
        nat, rep = t["natureza"], t["gera_repasse"]
        self.assertEqual((nat["coluna"], nat["regra"], rep["coluna"], rep["regra"]),
                         ("CODIGO", "codigo_char", "CODIGO", "codigo_char"))
        self.assertEqual(nat["valores"], {"SH": "servico_hospitalar", "SP": "servico_profissional",
                                          "MM": "material_medicamento"})
        self.assertEqual(rep["valores"], {"SH": "0", "SP": "1", "MM": "0"})
        self.assertNotIn("mm", nat["valores"])

    def test_referencias_e_complemento(self):
        p = self.cols("TBTABTHM", "preco_procedimento")
        self.assertEqual((p["tabela_preco_id"]["coluna"], p["tabela_preco_id"]["referencia"]), ("TAB", "TBCTRTHM"))
        self.assertEqual(p["item_faturavel_id"]["referencia"], "TBPROCTO")
        self.assertEqual(p["sequencia"]["coluna"], "COD")
        i = self.cols("TBTABTHM", "item_faturavel")
        self.assertTrue(self.plano["TBTABTHM"]["opcoes"]["item_faturavel"]["complementa"])
        self.assertEqual(i["id"]["referencia"], "TBPROCTO")
        self.assertEqual(i["grupo_ato_id"]["referencia"], "TBTABATO")
        self.assertEqual(i["sexo_permitido"]["valores"], {"M": "masculino", "F": "feminino", "A": "ambos"})
        s = self.cols("TBSUBDES", "subgrupo_natureza_financeira")
        self.assertEqual(s["grupo_natureza_financeira_id"]["referencia"], "TBGRUDES")
        f = self.cols("TBFORMULAPAGTO", "regra_via_acesso")
        self.assertEqual(f["tipo_lancamento_id"]["referencia"], "TBTPLANC")
        # via de acesso pelo código TISS no cadastro do produto (a tabela de vias da origem é terminologia oficial)
        v = f["via_acesso_cirurgico_id"]
        self.assertEqual((v["coluna"], v["regra"], v["cod"]), ("ID_TBTISSVIAACES", "inteiro",
                                                                ("via_acesso_cirurgico", "codigo_tiss")))
        self.assertNotIn("TBTISSVIAACES", self.plano)
        self.assertEqual((f["ordem_procedimento"]["regra"], f["percentual"]["regra"]), ("piso:1", "faixa:0,999"))
        pr = self.cols("TBPRESER", "prestador_terceiro")
        self.assertEqual((pr["cnpj"]["regra"], pr["cep"]["regra"], pr["cnes"]["regra"]),
                         ("cnpj_de_documento", "inteiro_zeros_esquerda:8", "inteiro_zeros_esquerda:7"))  # P6 (A05, R14)
        self.assertEqual((pr["cnpj"]["coluna"], pr["cpf"]["coluna"], pr["cpf"]["regra"]),
                         ("CGC_CPF", "CGC_CPF", "cpf_de_documento"))
        self.assertEqual(pr["aceita_cessao_credito"]["valores"], {"S": "0", "N": "1"})

    def test_achados_da_revisao(self):
        # código da função com prefixo de domínio: três origens gravam a mesma coluna única
        g = self.cols("TBGRAUPARTPROC", "funcao_equipe_cobranca")
        self.assertEqual(g["codigo"]["coluna"], "#codigo_derivado:ID:30:grau_part_")
        # referências do prestador e do subgrupo (antes descartadas com 'pede X carregado')
        pr = self.cols("TBPRESER", "prestador_terceiro")
        self.assertEqual((pr["centro_custo_id"]["referencia"], pr["empresa_fornecedora_id"]["referencia"]),
                         ("TBCENCUS", "TBFORNEC"))
        self.assertIn("profissional_id", pr)
        self.assertEqual(pr["base_repasse"]["valores"], {"C": "cobrado", "R": "recebido"})
        self.assertEqual(self.cols("TBSUBDES", "subgrupo_natureza_financeira")["centro_custo_id"]["referencia"],
                         "TBCENCUS")
        # preço: situação A/I e modelo por índice quando há CH (nunca o padrão silencioso)
        p = self.cols("TBTABTHM", "preco_procedimento")
        self.assertEqual(p["ativo"]["regra"], "booleano_ai")
        self.assertEqual((p["modelo_valor"]["coluna"], p["modelo_valor"]["regra"]), ("CH", "preenchido"))
        self.assertEqual(p["modelo_valor"]["valores"], {"1": "indice", "0": "valor"})
        # critério da fórmula: presumido visível (valor_presumido), não o padrão calado
        self.assertEqual(self.cols("TBFORMULAPAGTO", "regra_via_acesso")["criterio_ordem"]["coluna"], "=~maior_valor")
        # a via de acesso não é dada como carregada na imagem: a conciliação prova a dependência real
        self.assertNotIn("TBTISSVIAACES", l8_04.PAIS_EXTERNOS)

    def test_descartes_com_motivo_de_produto(self):
        raiz = Path(mapa.__file__).resolve().parents[1] / "mapa" / "declarado" / "sem_carga.tsv"
        sc = {r["tabela"]: r for r in mapa.ler_tsv(raiz)}
        for t in l8_04.DESCARTADAS:
            self.assertEqual(sc[t]["situacao"], "descarte", t)
            self.assertIn(sc[t]["causa"], {"licenciado", "mecanismo_do_produto", "catalogo_oficial"}, t)
            self.assertTrue(sc[t]["motivo"].startswith("L8-04: "), t)
        self.assertNotIn("TBPERTHM", sc)  # acordo do cliente: carrega (L8-03), nunca descarte
        self.assertNotIn("TBPERTHM", {d["tabela"] for d in self.mapa["colunas_decl"]
                                      if d.get("_arquivo", "").endswith("L8-04.tsv")})

    def test_acordo_de_emissao_nao_e_descarte(self):
        # TBEMIREFMATMED: configuração do hospital por fonte pagadora e item; espera o item faturável do mat/med
        raiz = Path(mapa.__file__).resolve().parents[1] / "mapa" / "declarado" / "sem_carga.tsv"
        sc = {r["tabela"]: r for r in mapa.ler_tsv(raiz)}
        # r4: bloqueada pelo MODELO (o item faturável de mat/med exige insumo; pedido de item_referencia_matmed_id na
        # exceção, saida/L8-04.json), nunca descarte
        # conferidor r4: modelo aplicado (12_FAT/13): carrega pelo item de referência de mat/med
        self.assertNotIn("TBEMIREFMATMED", sc)
        self.assertNotIn("TBEMIREFMATMED", l8_04.DESCARTADAS)
        self.assertIn("TBEMIREFMATMED", l8_04.CARREGADAS)
        self.assertIn("TBEMIREFMATMED", self.plano)

    def test_bloqueadas_fora_do_plano(self):
        # presentes na imagem, as bloqueadas nunca entram no plano de carga: zero linha no destino
        self.assertFalse(set(self.plano) & set(l8_04.BLOQUEADAS))

    def test_terminologia_tiss_nunca_gravada(self):
        # grau de participação TISS é catálogo oficial: a tabela nunca entra; o termo vem pelo de-para oficial
        # tiss:35 (a chave da origem é o código TISS: 0 a 13 na imagem), e o tipo e a ordem do auxiliar pelo grau
        self.assertNotIn("TBTISSPOSPROF", self.plano)
        decl = [d for d in self.mapa["colunas_decl"] if d["tabela"] == "TBGRAUPARTPROC"]
        por = {(d["coluna"], d["destino"].split(".")[-1]): d for d in decl if d["destino"]}
        self.assertEqual(por[("ID_TBTISSPOSPROF", "grau_participacao_termo_terminologia_id")]["depara"], "tiss:35")
        self.assertEqual(por[("ID_TBTISSPOSPROF", "tipo_funcao")]["depara"], "valores")
        self.assertEqual(por[("ID_TBTISSPOSPROF", "ordem_auxiliar")]["depara"], "valores")
        self.assertIn(("=~outro", "tipo_funcao"), por)  # reserva para a função sem grau
        val = {(v["destino"].split(".")[-1], v["valor_origem"]): v["valor_destino"] for v in self.mapa["valores"]
               if v["tabela"] == "TBGRAUPARTPROC"}
        self.assertEqual(val[("tipo_funcao", "0")], "cirurgiao")
        self.assertEqual(val[("tipo_funcao", "6")], "anestesista")
        self.assertEqual({k for (c, k), x in val.items() if c == "tipo_funcao" and x == "auxiliar"}, {"1", "2", "3", "4"})
        self.assertEqual({k: x for (c, k), x in val.items() if c == "ordem_auxiliar" and x},
                         {"1": "1", "2": "2", "3": "3", "4": "4"})

    def test_classificacao_do_subgrupo_pelo_grupo(self):
        # o tipo do grupo (receita ou despesa) é copiado do destino do pai, nunca presumido
        c = [d for d in self.mapa["colunas_decl"] if d["tabela"] == "TBSUBDES"
             and d["destino"] == "subgrupo_natureza_financeira.classificacao"]
        self.assertEqual(len(c), 1)
        self.assertEqual((c[0]["coluna"], c[0]["via"].split(";")[0]), ("GRUPO", "ref:TBGRUDES@tipo"))

    def test_bloqueadas_sem_destino(self):
        com_destino = {c["tabela"] for c in self.mapa["colunas_decl"] if c["destino"]}
        self.assertFalse(com_destino & set(l8_04.BLOQUEADAS))
        # TBPERTHM, TBREFMEMTUSS, TBREFUNI e TBTIPPRO passaram à L8-03 (rodada 3); TBEMIREFMATMED entrou pelo índice
        # R5: as 4 listas que estavam no L8-05.tsv voltaram à dona pelo índice
        self.assertEqual(len(TABELAS) + len(l8_04.BLOQUEADAS), 26)

    def test_credito_da_producao(self):
        # rodada 3: profissional e ocupação pela inscrição (encadeadas), tipo de conta pelo código no catálogo do
        # produto; T e nulo = todas (NULL sem pendência), nunca escopo ampliado em silêncio
        self.assertEqual(self.plano["FCCRECUN"]["destinos"], ["regra_credito_producao"])
        c = self.cols("FCCRECUN", "regra_credito_producao")
        self.assertEqual(c["estabelecimento_id"]["coluna"], "@estabelecimento")
        self.assertEqual(c["fonte_pagadora_id"]["referencia"], "TBCONVEN")
        self.assertEqual(c["ocupacao_cbo_id"]["depara"], "cbo")
        tc = c["tipo_conta_id"]
        self.assertEqual((tc["coluna"], tc["regra"], tc["cod"]), ("CONTAS", "codigo_char", ("tipo_conta", "codigo")))
        self.assertEqual(tc["valores"], {"I": "internacao", "E": "externa", "A": "ambulatorial", "U": "urgencia",
                                         "T": ""})
        decl = {(d["coluna"], d["destino"]) for d in self.mapa["colunas_decl"] if d["tabela"] == "FCCRECUN"}
        self.assertIn(("CRM", ""), decl)  # duplicado da inscrição: sem destino

    def test_terminologia_do_tipo_de_lancamento(self):
        # rodada 3: terminologia TISS pelo número da tabela (catálogo oficial nunca gravado), tipo da mesma fatia
        c = self.cols("TBTISSTERMO_TBTPLANC", "terminologia_tipo_lancamento")
        self.assertEqual((c["terminologia_id"]["coluna"], c["terminologia_id"]["depara"]),
                         ("ID_TBTISSTERMO", "terminologia"))
        self.assertEqual(c["tipo_lancamento_id"]["referencia"], "TBTPLANC")
        self.assertNotIn("TBTISSTERMO", self.plano)


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Laboratório   clínico "), ("Laboratório clínico", None))
        self.assertEqual(a("texto_nome", "   "), (None, None))
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("codigo_char", "sp")[0], "sp")
        self.assertEqual(a("cnpj", int(l8_04.cnpj_falso(112223330001))), (l8_04.cnpj_falso(112223330001), None))
        self.assertEqual(a("cnpj", 12345678000100), (None, "documento_invalido"))
        self.assertEqual(a("inteiro_zeros_esquerda:8", 1310100), ("01310100", None))
        self.assertEqual(a("piso:1", 0)[1], "valor_elevado_ao_minimo")
        self.assertEqual(a("faixa:0,999", decimal.Decimal("1500")), (None, "valor_fora_do_dominio"))

    def test_colisao_de_caixa_no_codigo(self):
        grupos = sentinela.colisoes_caixa(["SH", "SP", "MM", "mm", "XX"])
        achatado = {x for g in (grupos.values() if isinstance(grupos, dict) else grupos) for x in g}
        self.assertEqual(achatado, {"MM", "mm"})


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_04.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(RECUSA))
            self.assertEqual(cont[t], e["gravados"] + recusas + l8_04.RECUSADAS_SEM_PAI.get(t, 0), t)
        for t in l8_04.BLOQUEADAS:  # presença na imagem, nada esperado no destino
            self.assertEqual(cont[t], 2, t)

    def test_r5_listas_carregam_como_parametro_de_lista(self):
        # R5 (ADR 0006): nenhuma lista é descarte; cada uma vira opções de um parâmetro de lista do faturamento
        raiz = Path(mapa.__file__).resolve().parents[1] / "mapa" / "declarado" / "sem_carga.tsv"
        sc = {r["tabela"]: r for r in mapa.ler_tsv(raiz)}
        plano = {p["tabela"]: p for p in carga_mapa.planejar(mapa.carregar_execucao(), set(l8_04.LISTAS_R5))}
        for t in l8_04.LISTAS_R5:
            self.assertNotIn(t, sc, t)
            self.assertEqual(plano[t]["destinos"], ["parametro_opcao", "modulo_sistema", "parametro_definicao"], t)

    def test_ddl_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l8_04.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, TABELAS | set(l8_04.BLOQUEADAS) | set(l8_04.CADEIA) | {"TBCBOSUS"})

    def test_colunas_das_linhas_batem_com_o_ddl(self):
        ncols = {}
        for stmt in l8_04.DDL.split(";"):
            s = " ".join(stmt.split())
            if s.startswith("CREATE TABLE"):
                corpo = s[s.index("(") + 1:s.rindex(")")].split(", PRIMARY KEY")[0]
                n, prof = 1, 0
                for ch in corpo:
                    prof += ch == "("
                    prof -= ch == ")"
                    n += ch == "," and prof == 0
                ncols[s.split()[2]] = n
        vistos = []
        l8_04.linhas(random.Random(1), lambda t, v: vistos.append((t, len(v))))
        for t, n in vistos:
            self.assertEqual(n, ncols[t], t)


if __name__ == "__main__":
    unittest.main()
