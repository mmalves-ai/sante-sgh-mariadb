"""Fatia L6-15 (internação, módulo INT): plano dirigido pelo mapa e regras das colunas.

Sem banco; só a imagem SINTÉTICA e valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L6-15`.
"""
import datetime
import os
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_15

FATIA = set(l6_15.CARREGADAS) | set(l6_15.NAO_CARREGADAS)


class PlanoL615(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, FATIA)}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_so_as_carregaveis_entram_na_carga(self):
        self.assertEqual(len(FATIA), 22)
        self.assertEqual(len(l6_15.CARREGADAS), 22)
        self.assertEqual(set(self.plano), set(l6_15.CARREGADAS))

    def test_ordem_do_mapa(self):
        ordem = [p["tabela"] for p in carga_mapa.planejar(self.m, FATIA)]
        base = ["TBDESFECHO_INTERNACAO", "TBMOTALT", "TBREGUL_SISTEMA", "TBREGUL_SERVICO", "TBTIPOACOMOD",
                "RELOCLEITO", "RELEITO", "REOCUPLEITO"]
        self.assertEqual([t for t in ordem if t in base], base)
        # o leito vem antes de quem o completa e de quem o aponta; a internação antes das movimentações
        for antes, depois in [("RILEITOS", "TBLEITO"), ("TBLEITO", "HTLEITO"), ("RILEITOS", "RICADINT"),
                              ("RICADINT", "RITRANSF"), ("RICADINT", "RIALTA_EXCLUSAO"), ("RICADINT", "RITRFCLI"),
                              ("RICADINT", "RITRFMED"), ("TBTIPOACOMOD", "TBACOMODLEITO"), ("TBMOTALT", "RICADINT")]:
            self.assertLess(ordem.index(antes), ordem.index(depois), (antes, depois))

    def test_destinos(self):
        esperado = {"TBDESFECHO_INTERNACAO": ["desfecho_internacao"], "TBMOTALT": ["motivo_saida_hospitalar"],
                    "TBREGUL_SISTEMA": ["central_reguladora", "sistema_externo"],
                    "TBREGUL_SERVICO": ["servico_regulacao"], "TBTIPOACOMOD": ["categoria_acomodacao"],
                    "RELOCLEITO": ["local_observacao"],
                    "RELEITO": ["leito_observacao"], "REOCUPLEITO": ["ocupacao_leito_observacao"],
                    "TBTISSREGINT": ["regime_atendimento_internacao"],
                    "RILEITOS": ["leito_hospitalar"], "TBLEITO": ["leito_hospitalar"],
                    "TBACOMODLEITO": ["acomodacao"], "RICADINT": ["internacao", "trilha_auditoria"],
                    "RIPREINT": ["agendamento_internacao", "trilha_auditoria"], "RITRANSF": ["transferencia_leito"],
                    "RIALTA_EXCLUSAO": ["trilha_auditoria"], "RIEXCINT": ["trilha_auditoria"],
                    "HTLEITO": ["trilha_auditoria"], "RITRFCLI": ["troca_internacao"],
                    "RITRFCON": ["troca_internacao"], "RITRFESP": ["troca_internacao"],
                    "RITRFMED": ["troca_internacao"]}
        for t, dts in esperado.items():
            self.assertEqual(self.plano[t]["destinos"], dts, t)

    def test_referencias_pelo_conector_origem(self):
        for t, dt, dc, ref in [("TBREGUL_SERVICO", "servico_regulacao", "central_reguladora_id", "TBREGUL_SISTEMA"),
                               ("RELOCLEITO", "local_observacao", "centro_custo_id", "TBCENCUS"),
                               ("RELEITO", "leito_observacao", "local_observacao_id", "RELOCLEITO"),
                               ("RELEITO", "leito_observacao", "tipo_leito_observacao_id", "RETPLEITO"),
                               ("REOCUPLEITO", "ocupacao_leito_observacao", "atendimento_id", "RECADATE"),
                               ("REOCUPLEITO", "ocupacao_leito_observacao", "leito_observacao_id", "RELEITO")]:
            self.assertEqual(self.cols(t, dt)[dc]["referencia"], ref, (t, dc))

    def test_estabelecimento_nunca_fixo(self):
        for t, dt in [("TBREGUL_SERVICO", "servico_regulacao"), ("RELOCLEITO", "local_observacao"),
                      ("RELEITO", "leito_observacao"), ("REOCUPLEITO", "ocupacao_leito_observacao")]:
            self.assertEqual(self.cols(t, dt)["estabelecimento_id"]["coluna"], "@estabelecimento", t)

    def test_classificacao_sem_fonte_e_presumida(self):
        for t, dt, dc, lit in [("TBDESFECHO_INTERNACAO", "desfecho_internacao", "obito", "=~0"),
                               ("TBREGUL_SISTEMA", "central_reguladora", "esfera", "=~estadual"),
                               ("TBREGUL_SERVICO", "servico_regulacao", "tipo", "=~internacao"),
                               ("TBTIPOACOMOD", "categoria_acomodacao", "tipo", "=~outro")]:
            self.assertEqual(self.cols(t, dt)[dc]["coluna"], lit, (t, dc))
        self.assertEqual(self.cols("TBREGUL_SISTEMA", "sistema_externo")["categoria"]["coluna"], "=regulacao")

    def test_destino_com_padrao_significativo_e_presumido_nunca_silencioso(self):
        # finalidade tem padrão no destino: sem de-para do TIPO, o literal presumido marca cada linha
        self.assertEqual(self.cols("REOCUPLEITO", "ocupacao_leito_observacao")["finalidade"]["coluna"], "=~observacao")

    def test_significado_pela_origem_nunca_presumido(self):
        # sexo, situação, ativo e classe do motivo de saída vêm da origem (de-para de valores ou regra), não de literal
        for t, dt, dc, col, regra, dp in [
                ("RELOCLEITO", "local_observacao", "sexo_permitido", "ID_TBSEXO", None, "valores"),
                ("REOCUPLEITO", "ocupacao_leito_observacao", "situacao", "DATA_HORA_SAIDA", "preenchido", "valores"),
                ("TBMOTALT", "motivo_saida_hospitalar", "ativo", "STATUS", "booleano_ai", None),
                ("TBMOTALT", "motivo_saida_hospitalar", "tipo_saida", "COD", "inteiro", "valores"),
                ("TBMOTALT", "motivo_saida_hospitalar", "exige_declaracao_obito", "COD", "inteiro", "valores"),
                ("TBMOTALT", "motivo_saida_hospitalar", "encerra_internacao", "COD", "inteiro", "valores")]:
            c = self.cols(t, dt)[dc]
            self.assertEqual(c["coluna"], col, (t, dc))
            if regra:
                self.assertEqual(c["regra"], regra, (t, dc))
            if dp:
                self.assertEqual(c["valores"] is not None, True, (t, dc))
        self.assertEqual(self.cols("RELOCLEITO", "local_observacao")["sexo_permitido"]["passos"] is not None, True)

    def pares(self, t, col, dest):
        return {v["valor_origem"]: v["valor_destino"] for v in self.m["valores"]
                if (v["tabela"], v["coluna"], v["destino"]) == (t, col, dest)}

    def test_motivo_de_saida_pela_tabela_da_aih(self):
        tipo = self.pares("TBMOTALT", "COD", "motivo_saida_hospitalar.tipo_saida")
        obito = self.pares("TBMOTALT", "COD", "motivo_saida_hospitalar.exige_declaracao_obito")
        encerra = self.pares("TBMOTALT", "COD", "motivo_saida_hospitalar.encerra_internacao")
        revelia = self.pares("TBMOTALT", "COD", "motivo_saida_hospitalar.alta_a_revelia")
        sus = self.pares("TBMOTALT", "COD", "motivo_saida_hospitalar.codigo_sus")
        self.assertEqual(set(tipo), set(obito), set(encerra))
        self.assertEqual(set(tipo), set(revelia))
        self.assertEqual(set(tipo), set(sus))
        for k, v in tipo.items():
            # CHECK do destino: óbito exige a declaração; e só óbito a exige
            self.assertEqual(obito[k] == "1", v == "obito", k)
            self.assertEqual(encerra[k] == "0", v == "permanencia", k)
            self.assertEqual(sus[k], k)
        for k, v in [("11", "alta"), ("21", "permanencia"), ("31", "transferencia"), ("41", "obito"),
                     ("42", "obito"), ("43", "obito"), ("51", "administrativa"), ("16", "evasao"), ("14", "a_pedido")]:
            self.assertEqual(tipo[k], v, k)

    def test_sexo_e_situacao(self):
        self.assertEqual(self.pares("RELOCLEITO", "ID_TBSEXO", "local_observacao.sexo_permitido"),
                         {"F": "feminino", "M": "masculino", "I": "qualquer"})
        self.assertEqual(self.pares("REOCUPLEITO", "DATA_HORA_SAIDA", "ocupacao_leito_observacao.situacao"),
                         {"1": "encerrada", "": "ativa"})

    def test_regime_tiss_adota_a_semente_e_guarda_o_do_hospital(self):
        # ADR 0006 (4): o código TISS (1..3) adota a semente pelo codigo_tiss; fora da faixa entra como do hospital
        c = self.cols("TBTISSREGINT", "regime_atendimento_internacao")
        self.assertEqual(c["codigo_tiss"]["regra"], "inteiro_faixa:1,3")
        decl = [x for x in self.m["colunas_decl"] if x["tabela"] == "TBTISSREGINT"
                and x.get("destino") == "regime_atendimento_internacao.codigo_tiss"]
        self.assertIn("adotar:codigo_tiss", decl[0]["via"])

    def test_literais_presumidos_depois_das_referencias(self):
        # pai_pendente recusa antes dos literais: a contagem de valor_presumido da imagem depende desta ordem
        nomes = [c["coluna"] for c in self.plano["REOCUPLEITO"]["colunas"]["ocupacao_leito_observacao"]]
        self.assertGreater(nomes.index("=~observacao"), nomes.index("ID_RELEITO"))

    def test_regras_de_data_e_texto(self):
        c = self.cols("REOCUPLEITO", "ocupacao_leito_observacao")
        self.assertEqual(c["data_hora_entrada"]["regra"], "data_hora")
        self.assertEqual(c["data_hora_saida"]["regra"], "data_hora")
        self.assertEqual(c["justificativa"]["regra"], "texto_longo")

    def test_nada_de_destino_oficial(self):
        por = {r["tabela"]: r for r in self.m["tabelas"]}
        for t in self.plano:
            self.assertEqual(por[t].get("destinos_oficiais") or "", "", t)

    def test_nao_carregadas_tem_motivo(self):
        decl = {}
        for c in self.m["colunas_decl"]:
            decl.setdefault(c["tabela"], []).append(c)
        for t in l6_15.NAO_CARREGADAS:
            self.assertTrue(decl.get(t), t)
            for c in decl[t]:
                self.assertEqual(c.get("destino") or "", "", t)
                self.assertIn("F4-decisoes-destino.md", c["motivo"], t)

    def test_internacao_tem_todas_as_obrigatorias(self):
        c = self.cols("RICADINT", "internacao")
        for dc in ("estabelecimento_id", "numero", "atendimento_id", "paciente_id", "data_hora_entrada",
                   "carater_admissao_id", "modalidade_internacao_id", "unidade_internacao_id", "acomodacao_id",
                   "especialidade_medica_id", "medico_assistente_profissional_id", "fonte_pagadora_id"):
            self.assertIn(dc, c, dc)
        self.assertEqual(c["data_hora_entrada"]["coluna"], "#data_hora:ENTRADA,HORAENT")
        self.assertEqual(c["data_hora_alta"]["coluna"], "#data_hora:ALTA,HORASAI")
        self.assertEqual(c["unidade_internacao_id"]["passos"][-1].get("destino"), "unidade_internacao")
        self.assertEqual(c["cid_principal_termo_terminologia_id"]["depara"], "cid10")
        self.assertEqual(c["estabelecimento_id"]["coluna"], "@estabelecimento")

    def test_catalogos_base_pelo_codigo_nunca_id_fixo(self):
        # caráter, modalidade, situação do leito, motivo da troca e tipo da troca: pelo código do catálogo-base
        for t, dt, dc, tab in [("RICADINT", "internacao", "carater_admissao_id", "carater_admissao"),
                               ("RICADINT", "internacao", "modalidade_internacao_id", "modalidade_internacao"),
                               ("RIPREINT", "agendamento_internacao", "carater_admissao_id", "carater_admissao"),
                               ("RILEITOS", "leito_hospitalar", "situacao_leito_id", "situacao_leito"),
                               ("RITRANSF", "transferencia_leito", "motivo_troca_leito_id", "motivo_troca_leito"),
                               ("RITRFCLI", "troca_internacao", "tipo_troca_internacao_id", "tipo_troca_internacao")]:
            cs = [c for c in self.plano[t]["colunas"][dt] if c["destino"] == dc]
            self.assertTrue(cs, (t, dc))
            for c in cs:
                self.assertEqual(c.get("cod"), (tab, "codigo"), (t, dc))
        # sigla sem par cai no literal concorrente declarado DEPOIS (a primeira com valor vence)
        nomes = [c["coluna"] for c in self.plano["RICADINT"]["colunas"]["internacao"]
                 if c["destino"] == "carater_admissao_id"]
        self.assertEqual(nomes, ["CARINT", "=~eletiva"])

    def test_codigos_medidos_na_referencia(self):
        # caráter 1/2 (AIH/TISS), situação do leito A/I, tipo do quarto I: medidos (só contagens) na referência
        for t, dt in (("RICADINT", "internacao"), ("RIPREINT", "agendamento_internacao")):
            self.assertEqual(self.pares(t, "CARINT", dt + ".carater_admissao_id"), {"1": "eletiva", "2": "urgencia"})
            self.assertEqual(self.pares(t, "REGIME", dt + ".regime_atendimento_internacao_id"),
                             {"1": "1", "2": "2", "3": "3"})
        self.assertEqual(self.pares("RILEITOS", "STATUS", "leito_hospitalar.situacao_leito_id"),
                         {"A": "livre", "I": "inativo"})
        self.assertEqual(self.pares("TBACOMODLEITO", "TP_ATENDIMENTO", "acomodacao.tipo_atendimento"),
                         {"I": "internacao"})

    def test_situacao_da_internacao_e_da_pre_internacao_pela_evidencia(self):
        # alta só com motivo; médico da alta sem motivo = alta médica; nunca pela data (sentinela nas abertas)
        nomes = [c["coluna"] for c in self.plano["RICADINT"]["colunas"]["internacao"] if c["destino"] == "situacao"]
        self.assertEqual(nomes, ["MOTIVO", "ID_TBCBOPRO_ALTA_MEDICA"])
        self.assertEqual(self.pares("RICADINT", "MOTIVO", "internacao.situacao"), {"1": "alta"})
        nomes = [c["coluna"] for c in self.plano["RIPREINT"]["colunas"]["agendamento_internacao"]
                 if c["destino"] == "situacao"]
        self.assertEqual(nomes, ["PRONT", "=~nao_compareceu"])
        ms = [c["coluna"] for c in self.plano["RICADINT"]["colunas"]["internacao"]
              if c["destino"] == "medico_assistente_profissional_id"]
        self.assertEqual(ms, ["ID_TBCBOPRO_MEDASS", "MEDASS"])

    def test_colunas_sem_destino_proprio_ficam_no_retrato(self):
        decl = [c for c in self.m["colunas_decl"] if c["tabela"] in ("RICADINT", "RIPREINT")]
        for c in decl:
            if not c.get("destino"):
                self.assertTrue("retrato" in c["motivo"] or "chave" in c["motivo"] or "lida pela" in c["motivo"]
                                or "parte da" in c["motivo"], (c["tabela"], c["coluna"]))
        for t in ("RICADINT", "RIPREINT"):
            self.assertIn("trilha_auditoria", self.plano[t]["destinos"])

    def test_complementos_e_leitos_por_chave_composta(self):
        self.assertEqual(self.cols("TBACOMODLEITO", "acomodacao")["id"]["passos"][0]["modo"], "composta")
        self.assertEqual(self.cols("TBLEITO", "leito_hospitalar")["id"]["passos"][0]["modo"], "alt")
        t = self.cols("RITRANSF", "transferencia_leito")
        for dc, cols in [("origem_leito_hospitalar_id", ["BLOCOO", "ACOMODO", "LEITOO"]),
                         ("destino_leito_hospitalar_id", ["BLOCOD", "ACOMODD", "LEITOD"])]:
            self.assertEqual(t[dc]["passos"][0]["modo"], "alt_composta")
            self.assertEqual(t[dc]["passos"][0]["cols"], cols)
        self.assertEqual(self.cols("RITRFMED", "troca_internacao")["novo_profissional_id"]["passos"][0]["arg"],
                         "CNPJ_CPF")

    def test_exclusoes_e_historico_com_retrato(self):
        for t in ("RIALTA_EXCLUSAO", "RIEXCINT", "HTLEITO"):
            c = self.cols(t, "trilha_auditoria")
            self.assertEqual(c["dados_antes"]["coluna"], "#retrato:*", t)
            self.assertEqual(c["entidade"]["coluna"][0], "=", t)

    def test_rictrloc_saiu_da_fatia(self):
        self.assertFalse(any(c["tabela"] == "RICTRLOC" and "L6-15" in c.get("_arquivo", "")
                             for c in self.m["colunas_decl"]))


class RegrasL615(unittest.TestCase):
    def test_nome_colapsa_e_vazio_vira_nulo(self):
        self.assertEqual(sentinela.aplicar("texto_nome", "Alta  melhorada".encode("cp1252"))[0], "Alta melhorada")
        self.assertEqual(sentinela.aplicar("texto_nome", b"   "), (None, None))

    def test_sn_fora_do_dominio(self):
        self.assertEqual(sentinela.aplicar("booleano_sn", "N"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X"), (None, "valor_fora_do_dominio"))

    def test_data_sentinela(self):
        self.assertEqual(sentinela.aplicar("data", datetime.date(1899, 12, 30))[1], "data_sentinela")
        self.assertEqual(sentinela.aplicar("data", datetime.date(2020, 1, 1)), (datetime.date(2020, 1, 1), None))

    def test_data_hora_com_data_sentinela(self):
        v, p = sentinela.aplicar("data_hora", datetime.datetime(1899, 12, 30, 10, 0))
        self.assertEqual((v, p), (None, "hora_sem_data"))

    def test_saida_sentinela_vira_nulo_com_pendencia(self):
        self.assertEqual(sentinela.aplicar("data_hora", datetime.datetime(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(sentinela.aplicar("data_hora", datetime.datetime(1899, 12, 30, 15, 30)),
                         (None, "hora_sem_data"))

    def test_texto_longo_preserva_quebra_e_espacos(self):
        v, _ = sentinela.aplicar("texto_longo", "Observação\r\n  pós-medicação  ".encode("cp1252"))
        self.assertEqual(v, "Observação\r\n  pós-medicação  ")


class ImagemL615(unittest.TestCase):
    def test_esperado_cobre_so_as_carregadas(self):
        lidas = []
        esp = l6_15.linhas(random.Random(1), lambda t, v: lidas.append(t))
        self.assertEqual(set(esp), set(l6_15.CARREGADAS))
        self.assertEqual(set(lidas), FATIA | set(l6_15.CADEIA) | set(l6_15.PAIS_ORIGEM))

    def test_ddl_tem_as_tabelas_da_fatia_e_os_pais_lidos(self):
        criadas = {x.split()[2] for x in l6_15.DDL.split(";") if x.strip().startswith("CREATE TABLE")}
        self.assertEqual(criadas, FATIA | set(l6_15.CADEIA) | set(l6_15.PAIS_ORIGEM))

    def test_valores_esperados_so_das_carregadas(self):
        m = mapa.carregar_execucao()
        destinos = {c["destino"].split(".")[0] for c in m["colunas_decl"]
                    if c["tabela"] in l6_15.CARREGADAS and c.get("destino")}
        for dt, filtro, col, _ in l6_15.VALORES_ESPERADOS:
            self.assertIn(dt, destinos, dt)
            self.assertTrue(filtro and col, dt)


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class SignificadoL615(unittest.TestCase):
    """A conciliação confere contagem e soma; aqui o destino é RELIDO e cada valor de VALORES_ESPERADOS comparado
    (de-para de valores, A/I, S/N, literais): coluna com significado trocado não passa."""

    def test_valores_relidos_do_destino(self):
        from sante_conector import conferencia
        lidos, faltam = {}, []

        def ler(cc):
            with cc.cursor() as cur:
                for i, (dt, filtro, col, _) in enumerate(l6_15.VALORES_ESPERADOS):
                    onde = " AND ".join("`%s` = %%s" % k for k in filtro)
                    cur.execute("SELECT `%s` FROM `%s` WHERE %s" % (col, dt, onde), list(filtro.values()))
                    rs = cur.fetchall()
                    if len(rs) != 1:
                        faltam.append((dt, filtro, len(rs)))
                    else:
                        v = rs[0][0] if not isinstance(rs[0], dict) else rs[0][col]
                        lidos[i] = v
        r = conferencia.conferir("L6-15", depois_da_primeira=ler)
        self.assertEqual(r["erros"], [])
        self.assertEqual(faltam, [])
        for i, (dt, filtro, col, esp) in enumerate(l6_15.VALORES_ESPERADOS):
            v = lidos[i]
            if isinstance(v, (datetime.datetime,)):
                v = v.strftime("%Y-%m-%d %H:%M:%S")
            elif isinstance(v, datetime.date):
                v = v.isoformat()
            if esp is not None and not isinstance(esp, str):
                v = None if v is None else int(v)
            self.assertEqual(v, esp, (dt, filtro, col))

