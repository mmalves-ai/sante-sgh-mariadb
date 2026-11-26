"""Fatia L7-01 (SADT e suprimentos, módulo SADT): declarações, plano da carga dirigida pelo mapa e regras das colunas.
Sem banco; só valores inventados (a conciliação na imagem SINTÉTICA roda em `conector.sh conferir-fatia L7-01`)."""
import csv
import os
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l7_01

FATIA = ["PRHEMOTLAN", "SHCLIENT", "SHCONDUTA", "SHESTFINAL", "SHEXAME", "SHINTER", "SHDOACAO", "SHLOCAL", "SHMOTDEV",
         "SHMOV", "SHPARAM", "SHPERGUN", "SHREACAO", "SHREQUISICAO", "SHBOLSA", "SHRESPOSTA", "SHTPTRANSF",
         "SIASSLAUDO_IMPRESSAO", "SICADATE_EXCLUSAO", "SICOLETE"]
CARREGADAS = {"SHCONDUTA": "conduta_reacao_transfusional", "SHESTFINAL": "destino_final_bolsa",
              "SHEXAME": "tipo_teste_imuno_hematologico",
              "SHREACAO": "tipo_reacao_transfusional", "SHMOTDEV": "motivo_devolucao_bolsa",
              "SHMOV": "tipo_movimento_bolsa", "SHPERGUN": "pergunta_triagem_doador", "SHTPTRANSF": "tipo_transfusao",
              "SICADATE_EXCLUSAO": "trilha_auditoria", "SICOLETE": "dispositivo_coleta",
              "PRHEMOTLAN": "hemocomponente", "SHCLIENT": "servico_hemoterapia_fornecedor",
              "SHINTER": "tipo_reacao_transfusional", "SHDOACAO": "doacao_sangue",
              "SHLOCAL": "local_guarda_hemocomponente", "SHRESPOSTA": "grupo_resposta",
              "SHBOLSA": "bolsa_hemocomponente", "SIASSLAUDO_IMPRESSAO": "trilha_auditoria",
              # r5 (ADR 0006): parâmetros do estabelecimento e pedido ao fornecedor na trilha, com retrato
              "SHPARAM": "parametro_valor", "SHREQUISICAO": "trilha_auditoria"}
DESCARTADAS = {}
# prefixos de motivo aceitos nas declarações da fatia: a fatia original e as correções das recusas da carga (fase 2)
PREFIXOS = ("L7-01: ", "recusas fase 2 (P4): ", "recusas-fase2 C1c (pedido 2 do K2): ")


def _decl():
    with open(mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L7-01.tsv", encoding="utf-8") as f:
        return list(f)


# R9: coluna anulável com pai pendente grava com a coluna nula (aviso pai_pendente, religada no reprocessamento);
# nestas tabelas a pendência é aviso, não recusa
PAI_PENDENTE_AVISO = {"SHBOLSA"}


class L701(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(FATIA))}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][CARREGADAS[t]]}

    def decl(self, t, d):
        """Declarações do destino `d` da tabela `t`, na ordem do mapa (a primeira e as concorrentes)."""
        return [c for c in self.plano[t]["colunas"][CARREGADAS[t]] if c["destino"] == d]

    def test_cobertura_total_carrega_ou_descarta(self):
        self.assertEqual(set(self.plano), set(CARREGADAS))
        self.assertEqual(set(CARREGADAS) | set(DESCARTADAS), set(FATIA))
        for t, dt in CARREGADAS.items():
            self.assertEqual(self.plano[t]["destinos"][0], dt, t)
        self.assertEqual(self.plano["SHRESPOSTA"]["destinos"], ["grupo_resposta", "resposta_padrao"])
        with open(mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv", encoding="utf-8") as f:
            sc = {r["tabela"]: r for r in csv.DictReader(f, delimiter="\t")}
        for t, causa in DESCARTADAS.items():
            self.assertEqual((sc[t]["situacao"], sc[t]["causa"]), ("descarte", causa), t)
            self.assertTrue(sc[t]["motivo"].startswith("L7-01: "), t)
        self.assertFalse(any(l.startswith("#--- ") for l in _decl()))
        self.assertFalse({"SHPARAM", "SHREQUISICAO"} & set(sc))
        # r6 (ADR 0006/0003): um valor por chave do produto (desdobrado), definição pela chave do catálogo do produto
        c = {}
        for x in self.m["colunas_decl"]:  # a primeira declarada de cada destino
            if x["tabela"] == "SHPARAM":
                c.setdefault(x["destino"], x)
        self.assertEqual(c["parametro_valor.valor"]["coluna"], "#item")
        # o literal da descrição da credencial é o texto exato (já esteve estragado: "=S (origem)enha ...")
        self.assertEqual(c["credencial_integracao.descricao"]["coluna"], "=Senha mestra da hemoterapia")
        # recusas-fase2 C1c (pedido 2 do K2): as 4 marcações S/N viram o booleano do contrato pelo de-para de valores
        sn = {x["coluna"]: x for x in self.plano["SHPARAM"]["colunas"]["parametro_valor"]
              if x["coluna"].startswith("#item@")}
        self.assertEqual(set(sn), {"#item@DIGITACAO_OBR_CPF", "#item@GRAVARIMGBANCO", "#item@LANCAR_TRANSFUSAO_APOS24H",
                                   "#item@LANCTRANSPRETRANS"})
        for k, x in sn.items():
            self.assertEqual((x["depara"], x["valores"]), ("valores", {"S": "true", "s": "true", "N": "false",
                                                                        "n": "false"}), k)
        self.assertIn("desdobrar:CEVS=sadt.hemoterapia.codigoCevs", c["parametro_valor.valor"]["via"])
        self.assertEqual(c["parametro_valor.parametro_definicao_id"]["coluna"], "#rotulo")
        self.assertEqual(c["parametro_valor.parametro_definicao_id"]["via"], "cod:parametro_definicao.chave")
        self.assertEqual(c["credencial_integracao.referencia_cofre"]["coluna"], "#cofre:SENHA_MASTER")

    def test_literais_e_presumidos(self):
        # nada presumido que mexa no estoque: situação e natureza pelo de-para do NOME (a primeira declarada)
        for t, d in (("SHESTFINAL", "situacao_bolsa"), ("SHMOV", "natureza")):
            self.assertEqual(self.decl(t, d)[0]["depara"], "valores", t)
        self.assertEqual(self.cols("SHESTFINAL")["situacao_bolsa"]["valores"]["DESCARTE"], "descartada")
        nat = self.decl("SHMOV", "natureza")
        self.assertEqual(nat[0]["valores"]["Transfusão"], "transfusao")
        self.assertNotIn("Estranho exemplo", nat[0]["valores"])
        # recusas fase 2 (P4, pedido 83 do mapa): nome sem par -> natureza 'correcao' presumida (sem baixa do
        # estoque), concorrente `senao` que tira a recusa de domínio da primeira; o cliente corrige no cadastro
        self.assertEqual([(x["coluna"], bool(x.get("senao"))) for x in nat], [("NOME", False), ("=~correcao", True)])
        self.assertEqual(self.cols("PRHEMOTLAN")["validade_dias"]["coluna"], "=~1")
        self.assertEqual(self.cols("PRHEMOTLAN")["faturavel"]["coluna"], "=~0")
        self.assertEqual(self.cols("SHLOCAL")["temperatura_minima"]["coluna"], "=~2")
        self.assertEqual(self.cols("SHLOCAL")["temperatura_maxima"]["coluna"], "=~6")
        # situação da bolsa pelo último movimento (nome do tipo, encadeado) e da doação pelo indicador de inaptidão
        sb = self.cols("SHBOLSA")["situacao"]
        self.assertEqual((sb["coluna"], sb["referencia"], sb["depara"]), ("CODMOV", "SHMOV>NOME", "valores"))
        self.assertEqual(sb["valores"]["Devolução"], "devolvida")
        self.assertEqual(sb["valores"]["ENTRADA"], "quarentena")
        self.assertNotIn("Transfusão", sb["valores"])  # transfundida exige data do destino que a bolsa não tem
        d = self.cols("SHDOACAO")
        self.assertEqual((d["situacao"]["valores"]["0"], d["situacao"]["valores"]["1"]), ("coletada", "inapto"))
        self.assertEqual((d["apto"]["valores"]["0"], d["apto"]["valores"]["1"]), ("1", "0"))
        self.assertTrue(d["motivo_inaptidao"]["valores"]["1"])
        bx = self.cols("SHMOV")["baixa_estoque"]["valores"]
        for n, v in (("Transfusão", "1"), ("DESCARTE", "1"), ("Perda", "1"), ("Devolução", "1"), ("ENTRADA", "0"),
                     ("Bloqueio", "0")):
            self.assertEqual(bx[n], v, n)
        for col in ("pesquisa_hemoglobina_s", "sorologia_aprovada"):
            self.assertEqual(self.cols("SHBOLSA")[col]["valores"], {"": ""}, col)
        self.assertEqual(self.cols("SHINTER")["natureza"]["coluna"], "=intercorrencia")
        self.assertEqual(self.cols("SHPERGUN")["tipo_resposta"]["coluna"], "=~sim_nao")
        self.assertEqual(self.cols("SHREACAO")["natureza"]["coluna"], "=~imunologica")
        self.assertEqual(self.cols("SHREACAO")["tempo_ocorrencia"]["coluna"], "=~imediata")
        self.assertEqual(self.cols("SHMOTDEV")["tipo"]["coluna"], "=~devolucao")
        sexo = self.cols("SHPERGUN")["sexo_aplicavel"]
        self.assertEqual((sexo["depara"], sexo["valores"]), ("valores", {"": ""}))
        c = self.cols("SICADATE_EXCLUSAO")
        self.assertEqual(c["acao"]["coluna"], "=exclusao")
        self.assertEqual(c["entidade"]["coluna"], "=requisicao_exame")

    def test_exclusao_vira_trilha_com_a_chave_e_sem_usuario_presumido(self):
        c = self.cols("SICADATE_EXCLUSAO")
        self.assertNotIn("usuario_id", c)  # USUARIO é o da requisição copiada, não quem excluiu
        self.assertEqual(c["ocorrido_em"]["regra"], "data_hora")
        self.assertEqual((c["correlacao"]["coluna"], c["correlacao"]["regra"]), ("ID_SICADATE", "flutuante"))
        self.assertEqual(carga_mapa.tipar(sentinela.aplicar("flutuante", 101.0)[0], "varchar"), "101.0")
        self.assertNotIn("entidade_id", c)

    def test_intercorrencia_da_doacao_com_prefixo_de_dominio(self):
        c = self.cols("SHINTER")["codigo"]["coluna"]
        self.assertEqual(c, "#codigo_derivado:CODINTER:30:intercorrencia_")
        self.assertEqual(carga_mapa.codigo_derivado("2", 30, "intercorrencia_"), ("intercorrencia_2", False))

    def test_referencias_declaradas(self):
        b = self.cols("SHBOLSA")
        self.assertEqual(b["hemocomponente_id"]["referencia"], "PRHEMOTLAN.CODALF")
        for d, ref in (("grupo_sanguineo_id", "TBTPSANGUINEO"), ("fator_rh_id", "TBFATORRH"),
                       ("doacao_sangue_id", "SHDOACAO"), ("servico_hemoterapia_fornecedor_id", "SHCLIENT"),
                       ("local_guarda_hemocomponente_id", "SHLOCAL"), ("recebida_por_usuario_id", "TBUSERS")):
            self.assertEqual(b[d]["referencia"], ref, d)
        self.assertEqual(self.cols("SHDOACAO")["doador_pessoa_fisica_id"]["referencia"], "SHDOADOR")
        self.assertEqual(self.cols("SHCLIENT")["empresa_fornecedora_id"]["referencia"], "TBFORNEC.NOME")
        self.assertEqual(self.cols("SIASSLAUDO_IMPRESSAO")["usuario_id"]["referencia"], "TBUSERS")
        self.assertEqual(self.cols("SIASSLAUDO_IMPRESSAO")["acao"]["coluna"], "=impressao")

    def test_pais_das_referencias_entram_antes(self):
        # ref: declarada sem FK na origem: a aresta em declarado/dependencias.tsv põe o pai antes na ordem
        ordem = {r["tabela"]: int(r["ordem"]) for r in self.m["tabelas"] if (r.get("ordem") or "").isdigit()}
        for filho, pai in (("SHCLIENT", "TBFORNEC"), ("SHDOACAO", "TBTPSANGUINEO"), ("SHDOACAO", "TBFATORRH"),
                           ("SHBOLSA", "TBTPSANGUINEO"), ("SHBOLSA", "TBFATORRH"), ("SHBOLSA", "SHMOV"),
                           ("SHBOLSA", "SHCLIENT"), ("SHBOLSA", "SHDOACAO")):
            self.assertLess(ordem[pai], ordem[filho], (filho, pai))

    def test_opcoes_de_resposta_em_grupo_por_pergunta(self):
        p = self.plano["SHRESPOSTA"]
        self.assertEqual(p["opcoes"]["grupo_resposta"]["adotar"], ["codigo"])
        g = {c["destino"]: c for c in p["colunas"]["grupo_resposta"]}
        self.assertEqual(g["descricao"]["referencia"], "SHPERGUN>DESCRICAO")
        r = {c["destino"]: c["coluna"] for c in p["colunas"]["resposta_padrao"]}
        self.assertEqual((r["grupo_resposta_id"], r["sequencia"]), ("@id", "#seq:COD_PERGUNTA"))

    def test_regras_das_colunas(self):
        c = self.cols("SHEXAME")
        for d in ("aplica_doador", "aplica_bolsa", "aplica_pre_transfusional"):
            self.assertEqual(c[d]["regra"], "booleano_sn")
        self.assertEqual(c["ordem"]["regra"], "inteiro_nao_negativo")
        self.assertEqual(self.cols("SICOLETE")["ativo"]["regra"], "booleano_ai")
        self.assertEqual(sentinela.aplicar("booleano_sn", "S"), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("booleano_ai", "I"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_ai", "Z")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("inteiro_nao_negativo", -1)[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("texto", "  Hidratar   exemplo  ")[0], "Hidratar   exemplo")
        self.assertEqual(sentinela.aplicar("texto_nome", "  Programada   exemplo ")[0], "Programada exemplo")
        self.assertIsNone(sentinela.aplicar("texto_nome", "   ")[0])

    def test_declaracoes_com_motivo_e_so_da_fatia(self):
        rows = [r for r in csv.DictReader(_decl(), delimiter="\t") if not r["tabela"].startswith("#")]
        for r in rows:
            self.assertIn(r["tabela"], CARREGADAS)
            self.assertNotIn(r["tabela"], DESCARTADAS)
            self.assertTrue(r["motivo"].startswith(PREFIXOS), (r["tabela"], r["coluna"]))

    def test_imagem_sintetica_cobre_as_carregadas(self):
        lidas = []
        esp = l7_01.linhas(random.Random(1), lambda t, v: lidas.append(t))
        self.assertEqual(set(esp), set(CARREGADAS))
        for t, e in esp.items():
            recusas = sum(n for r, n in e["pendencias"].items()
                          if r.startswith("restricao_destino_")
                          or (r == "pai_pendente" and t not in PAI_PENDENTE_AVISO))
            if t == "SHPARAM":  # r6: desdobrado, "gravados" conta itens (um por coluna preenchida da linha única)
                self.assertEqual((lidas.count(t), e["gravados"]), (1, 10))
                continue
            self.assertEqual(e["gravados"] + recusas, lidas.count(t), t)
        self.assertNotIn("TBFORNEC", l7_01.PAIS_EXTERNOS)  # alternativa lê a origem: fornecedor ausente

    def test_bolsa_liga_o_pedido_ao_fornecedor_r5(self):
        # r5 (achado): o pedido ao fornecedor grava o número na trilha (correlacao) e não se perde sem data
        # (vigência pela evidência, só quando a data falta); a trilha de cada bolsa copia o número do pedido gravado
        # (referência validada) e guarda o retrato da linha
        req = self.cols("SHREQUISICAO")
        self.assertEqual(req["trilha_auditoria.correlacao"]["coluna"] if "trilha_auditoria.correlacao" in req
                         else req["correlacao"]["coluna"], "ID_SHREQUISICAO")
        bt = {c["destino"]: c for c in self.plano["SHBOLSA"]["colunas"]["trilha_auditoria"]}
        self.assertIn("trilha_auditoria", self.plano["SHBOLSA"]["destinos"])
        self.assertEqual(bt["correlacao"]["coluna"], "ID_SHREQUISICAO")
        self.assertEqual(bt["entidade_id"]["coluna"], "@id")
        self.assertEqual(bt["acao"]["coluna"], "=operacao")
        self.assertTrue(bt["dados_depois"]["coluna"].startswith("#retrato:*"))
        rows = [r for r in csv.DictReader(_decl(), delimiter="\t")]
        via = {(r["tabela"], r["coluna"], r["destino"]): r["via"] for r in rows}
        self.assertEqual(via[("SHBOLSA", "ID_SHREQUISICAO", "trilha_auditoria.correlacao")],
                         "ref:SHREQUISICAO@correlacao;trilha_auditoria")
        self.assertEqual(via[("SHREQUISICAO", "#vigencia", "trilha_auditoria.ocorrido_em")],
                         "se:DATA_HORA=;trilha_auditoria")
        self.assertFalse([r for r in rows if r["tabela"] == "SHBOLSA" and r["coluna"] == "ID_SHREQUISICAO"
                          and not r["destino"]])
        self.assertNotIn("sem_valor", " ".join(r["motivo"] for r in rows if "SHREQUISICAO" in r["coluna"]))


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class ValoresNoDestino(unittest.TestCase):
    """Carga da imagem sintética e releitura dos valores gravados: acusa esperada velha da sintética (contagens e
    pendências por tabela) e confere os valores das correções das recusas da carga (fase 2, P4)."""

    @classmethod
    def setUpClass(cls):
        from sante_conector import conferencia
        lido = {}
        consultas = {
            "tipo_movimento_bolsa": "SELECT codigo, natureza, baixa_estoque FROM tipo_movimento_bolsa"
                                    " ORDER BY CAST(codigo AS UNSIGNED)",
            "impressao": "SELECT correlacao, ocorrido_em FROM trilha_auditoria WHERE acao = 'impressao'"
                         " AND entidade = 'emissao_laudo' ORDER BY ocorrido_em"}

        def ler(cc):
            with cc.cursor() as cur:
                for k, s in consultas.items():
                    cur.execute(s)
                    lido[k] = [tuple(r) for r in cur.fetchall()]
        cls.r = conferencia.conferir("L7-01", depois_da_primeira=ler)
        cls.lido = lido

    def test_conferencia_ok(self):
        self.assertEqual(self.r["erros"], [])

    def test_natureza_presumida_do_movimento_sem_par(self):
        # P4: o nome sem par (4) grava com a natureza 'correcao', sem baixa do estoque; a 5 sem nome é recusada
        self.assertEqual([(c, n, int(b)) for c, n, b in self.lido["tipo_movimento_bolsa"]],
                         [("1", "entrada", 0), ("2", "bloqueio", 0), ("3", "devolucao", 1), ("4", "correcao", 0),
                          ("6", "transfusao", 1)])

    def test_impressao_sem_data_pela_geracao_do_laudo(self):
        import datetime
        dt = datetime.datetime
        # P4: a 5 (impressão sem data) entra no instante da geração do laudo; a 3 (sem as duas) é recusada
        self.assertEqual(self.lido["impressao"], [
            ("0a1b2c3d-0000-4000-8000-000000000001", dt(2025, 6, 1, 9, 0)),
            ("0a1b2c3d-0000-4000-8000-000000000002", dt(2025, 6, 2, 9, 0)),
            (None, dt(2025, 6, 4, 9, 0)),
            ("0a1b2c3d-0000-4000-8000-000000000005", dt(2025, 6, 5, 8, 0))])


if __name__ == "__main__":
    unittest.main()
