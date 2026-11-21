"""Fatia L6-12 (prontuário, assinatura e assistência, módulo PEP): cobertura total pelo mapa.

Sem banco; só a imagem SINTÉTICA e valores inventados. Garante que (1) as 11 tabelas carregáveis entram no plano e as
outras são descarte de produto ou a bloqueada nomeada (catálogo oficial sem de-para); (2) as declarações apontam
colunas reais da origem e do destino, com regra válida, e cobrem os NOT NULL de todos os destinos; (3) paciente,
atendimento, profissional e usuário nunca vêm por referência direta à tabela intermediária: a via encadeada é
conferida salto a salto contra o mapa; (4) o de-para de valores da fatia tem os pares usados; (5) a imagem sintética
traz toda tabela da fatia, as intermediárias com todas as colunas do dicionário e o esperado de cada carregada.
"""
import csv
import datetime
import hashlib
import random
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_12

VALORES = mapa.DIR_PACOTE / "declarado" / "valores.d" / "L6-12.tsv"
SEM_CARGA = mapa.DIR_PACOTE / "declarado" / "sem_carga.tsv"
CARREGADAS = {"PRGEDIMP", "PRPRESC", "PRLANGERAL", "PRPRESCPROCED", "PRPRESCDIETA", "PRCARACTLAN", "PRPRESCHEMO", "PRCABEVOL",
              "PRCONTEVOL", "PRALERGIAPAC", "PRATESTREQIMP", "PRASSINATURA_DOC", "PRPRESCMED", "PRITENSGERAL",
              "PREVOLPAC", "PRALERGIAPAC_TBPRINC"}
# cadastros de outras fatias lidos por chave alternativa/encadeada e carregados pela declaração delas
DE_OUTRAS = {"PRHEMOTLAN", "TBUNIDADEMEDIDA", "PREVOLUCAO", "PRPADEVOL", "PRRESPOSTA", "PRTPASSINATURA"}
# lidas só pela encadeada terminada em coluna, sem carga (TBPRINC: descarte catalogo_oficial na L7-07)
# rodada 4: PRASSINATURA_CAB passa a carregar (L6-11, documento do prontuário) e TBPRINC também (L7-07,
# principio_ativo_cliente): só lidas ficam a pergunta e o catálogo de respostas
SO_LEITURA = {"PRPERGUNTA", "PRCADRESP"}
DESCARTES = {"PRASS_DOC_PREXAMEASS", "PRCABEC_MONITORIZACAO", "PRPLANPRESC", "PRCABEVOLTMP",
             "PRALERGIAPACTMP", "PRALERGIAPACTMP_TBPRINC"}
# o anexo do prontuário só existe como binário na origem: bloqueada até o mecanismo de arquivo (#arquivo, M4)
BLOQUEADA = set()  # conferidor r4: PRGEDIMP carrega com #arquivo
INTERMEDIARIAS = {"HTPACIENTE", "HTATENDIMENTO", "TBCBOPRO"}
COMPLEMENTAM = {"PRCONTEVOL"}
AUDITORIA = {"id", "criado_em", "origem", "versao"}
NAO_COLUNA = {"CONSTRAINT", "KEY", "UNIQUE", "PRIMARY", "FULLTEXT", "INDEX", "CHECK"}
CAUSAS = {"sem_valor", "duplicado", "licenciado", "catalogo_oficial", "mecanismo_do_produto"}


def _raiz():
    return Path("/app") if Path("/app/db/migracoes").exists() else mapa.RAIZ


def _not_null_sem_padrao(create):
    cols = set()
    for linha in create.splitlines():
        p = linha.strip().split()
        corpo = linha.split("COMMENT")[0]
        if len(p) > 2 and re.fullmatch(r"\w+", p[0]) and p[0].upper() not in NAO_COLUNA and "NOT NULL" in corpo \
                and "DEFAULT" not in corpo and "AUTO_INCREMENT" not in corpo:
            cols.add(p[0])
    return cols - AUDITORIA


class FatiaL612(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.todas = {(c["tabela"], c["coluna"]): c for c in cls.m["colunas"]}
        cls.chaves = {r["tabela"]: r["chave"] for r in cls.m["tabelas"]}
        cls.decl = [c for c in cls.m["colunas_decl"] if c["tabela"] in l6_12.FORMAS and c.get("destino")]
        cls.ddl = mapa.ler_ddl(_raiz())

    def test_plano_tem_as_carregadas_e_so_elas(self):
        plano = carga_mapa.planejar(self.m, set(l6_12.FORMAS))  # só as da fatia (sem os cadastros de outras)
        self.assertEqual({p["tabela"] for p in plano}, CARREGADAS)
        self.assertEqual(CARREGADAS | DESCARTES | BLOQUEADA, set(l6_12.FORMAS))
        with open(SEM_CARGA, encoding="utf-8") as f:
            sem = {r["tabela"]: r for r in csv.DictReader(f, delimiter="\t")}
        for t in BLOQUEADA:
            self.assertEqual((sem[t]["situacao"], sem[t]["causa"]), ("bloqueada", "regra_faltante"), t)
        for t in DESCARTES:
            self.assertEqual(sem[t]["situacao"], "descarte", t)
            self.assertIn(sem[t]["causa"], CAUSAS, t)
            self.assertTrue(sem[t]["motivo"], t)

    def test_declaracoes_apontam_colunas_reais(self):
        self.assertGreater(len(self.decl), 100)
        for c in self.decl:
            t, col = c["tabela"], c["coluna"]
            self.assertTrue(c["motivo"], (t, col))
            fonte = carga_mapa.fonte_especial(col) if col[:1] in "=@#" else col
            if fonte:
                self.assertIn((t, fonte), self.todas, (t, col))
            if c["regra"]:
                self.assertTrue(c["regra"] in sentinela.REGRAS or sentinela.regra_conhecida(c["regra"]),
                                (t, col, c["regra"]))
            dt, dc = c["destino"].split(".")
            self.assertIn(dc, self.ddl[dt]["colunas"], (t, col, dc))

    def test_declaracoes_cobrem_os_not_null_de_todos_os_destinos(self):
        por_dt = {}
        for c in self.decl:
            if c["tabela"] not in COMPLEMENTAM:  # completa a linha do pai: não insere
                dt, dc = c["destino"].split(".")
                por_dt.setdefault((c["tabela"], dt), set()).add(dc)
        self.assertIn(("PRALERGIAPAC", "alergia_paciente_evento"), por_dt)
        faltas = {k: _not_null_sem_padrao(self.ddl[k[1]]["create"]) - cols for k, cols in por_dt.items()}
        self.assertEqual({k: v for k, v in faltas.items() if v}, {})

    def test_complemento_aponta_o_id_do_pai(self):
        for t in COMPLEMENTAM:
            ids = [c for c in self.decl if c["tabela"] == t and c["destino"].endswith(".id")]
            self.assertEqual(len(ids), 1, t)
            self.assertIn("complementa", ids[0]["via"], t)

    def test_referencia_de_outra_entidade_nunca_direta(self):
        # coluna que aponta histórico do paciente, do atendimento ou a inscrição no conselho só pela via encadeada;
        # cada salto existe: a coluna está na tabela do salto e aponta (referência gerada) a tabela seguinte, ou,
        # sem referência gerada (login em texto), tem a forma da chave da tabela seguinte
        vistos = 0
        for c in self.decl:
            via = mapa.referencia_declarada(c)
            passos = mapa.passos_ref(via) if via else None
            g = self.todas.get((c["tabela"], c["coluna"]), {})
            if g.get("referencia") in INTERMEDIARIAS:
                self.assertTrue(passos and len(passos) >= 3, (c["tabela"], c["coluna"], c["destino"]))
            if not passos or len(passos) < 2:
                continue
            for i in range(1, len(passos), 2):
                pai, col = passos[i - 1]["tabela"], passos[i]["coluna"]
                self.assertIn((pai, col), self.todas, (c["tabela"], c["coluna"], pai, col))
                if i + 1 < len(passos) and passos[i + 1]["modo"] == "chave":
                    prox = passos[i + 1]["tabela"]
                    ref = self.todas[(pai, col)]["referencia"]
                    if ref:
                        self.assertEqual(ref, prox, (c["tabela"], c["coluna"], pai, col))
                    else:
                        self.assertEqual(self.todas[(pai, col)]["forma"],
                                         self.todas[(prox, self.chaves[prox])]["forma"], (c["tabela"], pai, col))
            vistos += 1
        self.assertGreaterEqual(vistos, 20)

    def test_usuario_vem_pelo_login_do_profissional(self):
        cadeia = "ref:TBCBOPRO>ID_TBPROFIS>TBPROFIS>ID_TBUSERS>TBUSERS"
        usuario = {c["destino"]: c["via"] for c in self.decl if c["tabela"] == "PRCABEVOL"
                   and c["destino"].endswith("_usuario_id")}
        self.assertEqual(usuario, {"registro_assistencial.autor_usuario_id": cadeia,
                                   "registro_assistencial.suspenso_por_usuario_id": cadeia})
        self.assertNotIn(("TBCBOPRO", "ID_TBUSERS"), self.todas)

    def test_valores_da_fatia(self):
        with open(VALORES, encoding="utf-8") as f:
            pares = {}
            for r in csv.DictReader(f, delimiter="\t"):
                pares.setdefault((r["tabela"], r["coluna"], r["destino"]), {})[r["valor_origem"]] = r["valor_destino"]
        usados = {(c["tabela"], c["coluna"], c["destino"]) for c in self.decl if c["depara"] == "valores"}
        self.assertEqual(set(pares), usados)
        self.assertEqual(pares[("PRALERGIAPAC", "RETIRAR_VINCULO_PACIENTE", "alergia_paciente.ativa")],
                         {"1": "0", "0": "1"})
        # situação derivada da suspensão (regra preenchido: "1" com suspensão, "" o nulo), nunca exclusão lógica
        for t, d, sim, nao in [("PRPRESC", "prescricao.situacao", "suspensa", "vencida"),
                               ("PRCABEVOL", "registro_assistencial.situacao", "suspenso", "finalizado"),
                               ("PRATESTREQIMP", "documento_emitido.situacao", "suspenso", "valido")]:
            self.assertEqual(pares[(t, "DATA_HORA_SUSPENSAO", d)], {"1": sim, "": nao})
        self.assertEqual(pares[("PRPRESC", "TP_PRESCRICAO", "prescricao.tipo")], {"G": "medica"})
        self.assertNotIn("registro_assistencial.excluido_em", {c["destino"] for c in self.decl})
        self.assertEqual(sentinela.aplicar("preenchido", datetime.datetime(2026, 1, 1)), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", "T"), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("data_hora", datetime.datetime(1899, 12, 30))[1], "data_sentinela")

    def test_impressao_digital_e_o_sha256_do_texto_migrado(self):
        imp = {c["tabela"]: c["coluna"] for c in self.decl if c["destino"] == "registro_assistencial.impressao_digital"}
        # provisória na inclusão (NOT NULL) e substituída pelo hash do texto que completa o registro
        # o motor ainda não tira do resumo do pai a coluna que o complemento regrava (pedido): até lá a marca é
        # NÃO CALCULADA: zeros presumidos (valor_presumido por linha), nunca um hash que pareça válido (o SHA-256 do
        # vazio afirmaria que o texto é vazio)
        self.assertEqual(imp, {"PRCABEVOL": "=~" + "0" * 64})
        self.assertNotEqual("0" * 64, hashlib.sha256(b"").hexdigest())

    def test_sem_destino_de_unidade_ou_significado_duvidoso(self):
        destinos = {(c["tabela"], c["coluna"]): c["destino"] for c in self.decl}
        for k in [("PRPRESC", "OLD_ALTURA"), ("PRPRESC", "OLD_TFG"), ("PRPRESCMED", "INTERVALO_ENTRE_DOSES")]:
            self.assertNotIn(k, destinos)
        self.assertEqual(destinos[("PRPRESCHEMO", "CODALF_SITABPRO")], "prescricao_item_hemocomponente.hemocomponente_id")

    def test_imagem_sintetica(self):
        nomes = set(l6_12.FORMAS) | set(l6_12.INTERMEDIARIAS)
        self.assertTrue(DE_OUTRAS <= set(l6_12.INTERMEDIARIAS))
        self.assertEqual(l6_12.DDL.count("CREATE TABLE "), len(nomes))
        for t in nomes:  # intermediárias com todas as colunas do dicionário: a declaração de outra fatia acha a sua
            self.assertEqual({c for c, _ in l6_12._colunas(t)}, {c for (tt, c) in self.todas if tt == t}, t)
        vistos = {}
        esperado = l6_12.linhas(random.Random(1), lambda t, v: vistos.__setitem__(t, vistos.get(t, 0) + 1))
        self.assertEqual(set(esperado), CARREGADAS)
        self.assertEqual(set(vistos), nomes)
        # intermediária carregada (por esta ou por outra fatia) nunca é pai externo; só a que fica fora do plano
        plano = {p["tabela"] for p in carga_mapa.planejar(self.m, nomes)}
        self.assertFalse(set(l6_12.PAIS_EXTERNOS) & plano)
        self.assertEqual(set(l6_12.PAIS_EXTERNOS) & nomes, set())
        self.assertFalse(SO_LEITURA & plano)

    def test_principio_ativo_pelo_catalogo_oficial(self):
        d = {c["coluna"]: c for c in self.decl if c["tabela"] == "PRALERGIAPAC_TBPRINC"}
        c = d["ID_TBPRINC"]
        self.assertEqual(c["destino"], "alergia_paciente_principio.principio_ativo_id")
        self.assertEqual(set(c["via"].split(";")), {"ref:TBPRINC>COD_DCB", "cod:principio_ativo.codigo_dcb"})
        self.assertEqual(sentinela.aplicar(c["regra"], "1234")[0], "01234")
        self.assertEqual(sentinela.aplicar(c["regra"], "00777")[0], "00777")
        # o catálogo oficial nunca é destino declarado (regra 7)
        self.assertFalse([x for x in self.decl if x["destino"].startswith("principio_ativo.")])


class ConferenciaL612(unittest.TestCase):
    def test_carga_pela_cadeia_concilia_e_grava_os_avos(self):
        from sante_conector import conferencia, controle
        ctl = controle.nome_ctl("cfl6_12")
        lido = {}

        def ler(cc):
            with cc.cursor() as c:
                def ids(tab, chave):
                    c.execute("SELECT id_destino FROM `%s`.conector_origem WHERE tabela_origem=%%s AND"
                              " chave_original=%%s" % ctl, (tab, chave))
                    return c.fetchone()[0]

                def um(sql, *a):
                    c.execute(sql, a)
                    return c.fetchone()
                lido["ext"] = {k: ids(*k) for k in [("RICADPAC", "1"), ("RICADPAC", "2"), ("ATCABECATEND", "1"),
                                                    ("ATCABECATEND", "2"), ("TBPROFIS", "1"),
                                                    ("TBUSERS", "USR1"), ("TBUSERS", "USR2")]}
                lido["presc"] = um("SELECT paciente_id, atendimento_id, prescritor_profissional_id, situacao FROM"
                                   " prescricao WHERE numero=1")
                lido["reg"] = [um("SELECT r.autor_usuario_id, r.suspenso_por_usuario_id, r.situacao, r.excluido_em,"
                                  " r.impressao_digital = REPEAT('0', 64), LEFT(r.texto_consolidado, 11),"
                                  " r.corrige_registro_assistencial_id"
                                  " FROM registro_assistencial r JOIN `%s`.conector_origem o ON o.id_destino=r.id AND"
                                  " o.tabela_origem='PRCABEVOL' AND o.chave_original=%%s" % ctl, k) for k in ("1", "2")]
                lido["reg1"] = ids("PRCABEVOL", "1")
                lido["alergia"] = um("SELECT ativa, paciente_id, registrado_em FROM alergia_paciente ORDER BY id LIMIT 1")
                lido["inativa"] = um("SELECT inativado_em, inativado_por_usuario_id FROM alergia_paciente WHERE NOT ativa")
                c.execute("SELECT situacao FROM documento_emitido ORDER BY situacao")
                lido["doc"] = [x[0] for x in c.fetchall()]
                lido["hemo"] = um("SELECT quantidade, CHAR_LENGTH(indicacao_clinica), hemocomponente_id IS NOT NULL,"
                                  " unidade_prescricao_id IS NOT NULL, nao_ajustar_horario"
                                  " FROM prescricao_item_hemocomponente")
                lido["med"] = um("SELECT tempo_infusao_minutos, item_nao_padronizado_id IS NOT NULL, dose"
                                 " FROM prescricao_item_medicamento")
                c.execute("SELECT sequencia FROM prescricao_item_material ORDER BY sequencia")
                lido["mat"] = [x[0] for x in c.fetchall()]
                c.execute("SELECT tipo_valor, COUNT(*), COUNT(modelo_campo_opcao_id), COUNT(valor_hora)"
                          " FROM registro_assistencial_resposta GROUP BY tipo_valor")
                lido["resp"] = c.fetchall()
                c.execute("SELECT d.paciente_id, d.atendimento_id, d.entidade_origem, d.entidade_origem_id,"
                          " d.referencia_em, d.titulo, COUNT(e.id) FROM documento_prontuario d LEFT JOIN"
                          " documento_prontuario_evento e ON e.documento_prontuario_id=d.id GROUP BY d.id"
                          " ORDER BY d.entidade_origem_id")
                lido["docpront"] = c.fetchall()
                lido["opcao"] = um("SELECT COUNT(*), COUNT(DISTINCT modelo_campo_id), MIN(rotulo) FROM modelo_campo_opcao")
                c.execute("SELECT p.codigo_dcb FROM alergia_paciente_principio a JOIN principio_ativo p"
                          " ON p.id=a.principio_ativo_id ORDER BY p.codigo_dcb")
                lido["princ"] = [x[0] for x in c.fetchall()]
        r = conferencia.conferir("L6-12", depois_da_primeira=ler)
        self.assertEqual(r["erros"], [])
        ext = lido["ext"]
        # paciente, atendimento e profissional pelos avós (a referência direta daria os ids das intermediárias)
        self.assertEqual(lido["presc"], (ext[("RICADPAC", "1")], ext[("ATCABECATEND", "2")], ext[("TBPROFIS", "1")],
                                         "vencida"))
        # suspenso na origem = situação suspenso, nunca excluído; impressão digital não calculada (zeros presumidos)
        self.assertEqual(lido["reg"][0], (ext[("TBUSERS", "USR1")], None, "finalizado", None, 1, "Evolução 10", None))
        self.assertEqual(lido["reg"][1], (ext[("TBUSERS", "USR2")], ext[("TBUSERS", "USR2")], "suspenso", None, 1,
                                          "Evolução 11", lido["reg1"]))
        self.assertEqual(lido["alergia"], (1, ext[("RICADPAC", "1")], datetime.datetime(2026, 3, 2, 9, 30)))
        self.assertEqual(lido["inativa"], (datetime.datetime(2026, 3, 2, 15, 30), ext[("TBUSERS", "USR2")]))
        self.assertEqual(lido["doc"], ["suspenso", "valido", "valido", "valido"])
        self.assertEqual(lido["hemo"], (2, 2280, 1, 1, 1))  # indicação inteira (TEXT), hemocomponente e unidade
        self.assertEqual(lido["med"], (30, 1, 500))
        self.assertEqual(lido["mat"], [1, 2])
        # hora '0830' em bytes ainda sai hora_invalida (pedido: hora_hhmm decodificar bytes): nenhuma hora gravada
        self.assertEqual(list(lido["resp"]), [("opcao", 4, 4, 1)])
        # documento do prontuário pelo primeiro evento de cada cabeçalho (agrupado): o documento 1 tem dois eventos
        # gravados (o terceiro, sem momento, recusa); o cabeçalho nunca visto não cria documento
        T0 = datetime.datetime(2026, 3, 2, 8, 30)
        self.assertEqual([tuple(x) for x in lido["docpront"]],
                         [(ext[("RICADPAC", "1")], ext[("ATCABECATEND", "1")], "documento_migrado", 1,
                           T0 + datetime.timedelta(hours=1), "Tipo de assinatura falso", 2),
                          (ext[("RICADPAC", "2")], None, "documento_migrado", 2, T0 + datetime.timedelta(hours=2),
                           "Tipo de assinatura falso", 1)])
        # rodada 4: as opções da origem (PRRESPOSTA) carregam pela L6-11 (por_pai: uma por campo de cada modelo da
        # pergunta), antes das respostas; a resposta adota a opção do campo x código
        self.assertEqual(tuple(lido["opcao"]), (4, 4, "Resposta falsa 1"))
        # princípio pelo código DCB no catálogo oficial (zeros à esquerda normalizados)
        self.assertEqual(lido["princ"], ["00777", "01234"])


if __name__ == "__main__":
    unittest.main()
