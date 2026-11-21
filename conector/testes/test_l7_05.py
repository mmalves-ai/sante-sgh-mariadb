"""Fatia L7-05 (SADT e suprimentos, módulo SUP): declarações planejadas, regras das colunas e coerência da imagem
sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia L7-05`."""
import datetime
import decimal
import json
import os
import random
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l7_05

TABELAS = set(l7_05.CARREGADAS)
# fase 2 (autorreferência do local de estoque): a linha fica gravada, a pendência não é recusa
FASE2 = {"GELOCARM"}
# complementa: sem a linha do pai a recusa é pai_inexistente (UPDATE sem alvo)
COMPLEMENTA = {"GECONITL", "GEDESPDS"}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | set(l7_05.BLOQUEADAS))}

    def cols(self, t, dt):
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        self.assertEqual(self.plano["GELOCARM"]["destinos"], ["local_estoque"])
        self.assertEqual(self.plano["GEKITRAS"]["destinos"], ["kit_rastreavel"])
        self.assertEqual(self.plano["GECAPELAMP_GEGRUPOMP"]["destinos"], ["capela_manipulacao_grupo"])

    def test_obrigatorias_do_destino_cobertas(self):
        obrig = {("GECAPELAMP", "capela_manipulacao"): {"estabelecimento_id", "codigo", "nome"},
                 ("GEGRUPOMP", "grupo_manipulacao"): {"codigo", "descricao"},
                 ("GECAPELAMP_GEGRUPOMP", "capela_manipulacao_grupo"): {"capela_manipulacao_id",
                                                                        "grupo_manipulacao_id"},
                 ("GEGRUPOS", "grupo_insumo"): {"codigo", "descricao", "natureza"},
                 ("GEITEACAODOSE", "acao_dose"): {"codigo", "descricao"},
                 ("GEKITS", "kit_material"): {"estabelecimento_id", "codigo", "nome"},
                 ("GELOCARM", "local_estoque"): {"estabelecimento_id", "codigo", "nome", "tipo"},
                 ("GEKITRAS", "kit_rastreavel"): {"estabelecimento_id", "codigo", "nome", "local_estoque_id"},
                 ("GEDESCOM", "destino_entrega_compra"): {"estabelecimento_id", "codigo", "descricao"}}
        for (t, dt), cs in obrig.items():
            self.assertTrue(cs <= set(self.cols(t, dt)), (t, cs - set(self.cols(t, dt))))

    def test_referencias(self):
        k = self.cols("GEKITRAS", "kit_rastreavel")
        self.assertEqual(k["local_estoque_id"]["referencia"], "GELOCARM")
        self.assertEqual(k["kit_material_id"]["referencia"], "GEKITS")
        self.assertEqual((k["criado_por"]["regra"], k["criado_por"]["referencia"]), ("chave_origem", "TBUSERS"))
        self.assertEqual(self.cols("GELOCARM", "local_estoque")["origem_local_estoque_id"]["referencia"], "GELOCARM")
        a = self.cols("GECAPELAMP_GEGRUPOMP", "capela_manipulacao_grupo")
        self.assertEqual((a["capela_manipulacao_id"]["referencia"], a["grupo_manipulacao_id"]["referencia"]),
                         ("GECAPELAMP", "GEGRUPOMP"))
        for t, dt in [("GECAPELAMP", "capela_manipulacao"), ("GEKITS", "kit_material"),
                      ("GELOCARM", "local_estoque"), ("GEKITRAS", "kit_rastreavel")]:
            self.assertEqual(self.cols(t, dt)["estabelecimento_id"]["coluna"], "@estabelecimento")

    def test_uf_pelo_catalogo_oficial(self):
        self.assertEqual(self.cols("GEDESCOM", "destino_entrega_compra")["unidade_federativa_id"]["depara"], "ibge_uf")

    def test_literais_presumidos(self):
        self.assertEqual(self.cols("GEGRUPOS", "grupo_insumo")["natureza"]["coluna"], "=~outro")
        self.assertEqual(self.cols("GELOCARM", "local_estoque")["tipo"]["coluna"], "=~outro")
        # ação da dose: sem de-para, notifica e bloqueia entram presumidos (pendência por linha), nunca em silêncio
        a = self.cols("GEITEACAODOSE", "acao_dose")
        self.assertEqual((a["notifica"]["coluna"], a["bloqueia"]["coluna"]), ("=~0", "=~0"))

    def test_situacao_da_capela_por_de_para(self):
        c = self.cols("GECAPELAMP", "capela_manipulacao")["situacao"]
        self.assertEqual((c["coluna"], c["depara"]), ("FUNCIONAMENTO", "valores"))
        self.assertEqual(c["valores"], {"S": "disponivel", "N": "inativa"})

    def test_prazo_do_grupo_nao_recusa_fora_da_faixa(self):
        # negativo ou acima do CHECK (365) vira NULL com pendência; o grupo (pai NOT NULL do insumo) é gravado
        self.assertEqual(self.cols("GEGRUPOS", "grupo_insumo")["prazo_entrega_dias"]["regra"], "inteiro_faixa:0,365")

    def test_cep_e_cnpj_inteiros_com_zeros_a_esquerda(self):
        # integração L7: regra genérica de zeros à esquerda e de documento (dígito verificador)
        c = self.cols("GEDESCOM", "destino_entrega_compra")
        self.assertEqual(c["cep"]["regra"], "inteiro_zeros_esquerda:8")
        self.assertEqual(c["cnpj"]["regra"], "cnpj")

    def test_estoque_cobertura_total(self):
        obrig = {("GEATUALIZASALDO", "recalculo_saldo_estoque"): {"estabelecimento_id", "operacao", "ocorrido_em",
                                                                  "competencia_inicio", "competencia_fim", "motivo"},
                 ("GECADTRA", "documento_estoque"): {"estabelecimento_id", "numero", "tipo", "movimentado_em"},
                 ("GELANTRA", "documento_estoque_item"): {"documento_estoque_id", "sequencia", "insumo_id",
                                                          "unidade_medida_id", "quantidade"},
                 ("GEESTINI", "inventario_estoque"): {"estabelecimento_id", "numero", "local_estoque_id", "tipo",
                                                      "data_corte", "abertura_usuario_id", "aberto_em"},
                 ("GEGERSEQ", "sequencia_documento_estoque"): {"estabelecimento_id", "tipo_movimento_estoque_id"},
                 ("GELIMLOC", "parametro_reposicao"): {"estabelecimento_id", "insumo_id", "local_estoque_id"}}
        for (t, dt), cs in obrig.items():
            self.assertEqual(self.plano[t]["destinos"][0], dt)
            self.assertTrue(cs <= set(self.cols(t, dt)), (t, cs - set(self.cols(t, dt))))
        # competência composta de ANO+MES; documento: número único pelo ID, tipo transferência (fato), situação pela
        # consolidação (nunca concluído com consolidado falso)
        r = self.cols("GEATUALIZASALDO", "recalculo_saldo_estoque")
        self.assertEqual(r["competencia_inicio"]["coluna"], "#data:ANO_PROC,MES_PROC")
        self.assertEqual(r["situacao"]["valores"], {"S": "concluido", "N": "falhou", "": "falhou"})
        d = self.cols("GECADTRA", "documento_estoque")
        self.assertEqual((d["numero"]["coluna"], d["tipo"]["coluna"], d["situacao"]["coluna"]),
                         ("ID", "=transferencia", "CONSOL"))
        self.assertEqual((d["situacao"]["depara"], d["situacao"]["valores"]),
                         ("valores", {"S": "concluido", "N": "aberto", "": "aberto"}))
        self.assertEqual(d["consolidado"]["coluna"], "CONSOL")
        self.assertEqual(d["destino_local_estoque_id"]["referencia"], "GELOCARM")
        i = self.cols("GELANTRA", "documento_estoque_item")
        self.assertEqual([x["tabela"] for x in i["unidade_medida_id"]["passos"] if "tabela" in x],
                         ["GEITENS", "TBUNICON"])
        self.assertEqual(self.cols("GEGERSEQ", "sequencia_documento_estoque")["proximo_numero"]["regra"], "piso:1")
        self.assertEqual(self.plano["GEESTINI"]["destinos"], ["inventario_estoque", "inventario_estoque_contagem"])
        self.assertEqual(self.cols("GEESTINI", "inventario_estoque_contagem")["inventario_estoque_id"]["coluna"], "@id")
        self.assertEqual(self.cols("GEESTINI", "inventario_estoque")["situacao"]["valores"],
                         {"S": "aprovado", "N": "aberto", "": "aberto"})

    def test_fechamento_nunca_entra_aberto(self):
        # a linha da origem só existe para mês FECHADO: entra 'fechado' com a data do fechamento presumida (tipar:
        # data em DATETIME), nunca 'aberto' (liberaria movimento retroativo)
        f = self.cols("GEFECMES", "fechamento_estoque")
        self.assertEqual(f["situacao"]["coluna"], "=fechado")
        self.assertEqual(f["fechado_em"]["coluna"], "=~@data_carga")
        self.assertEqual(f["competencia"]["coluna"], "#data:ANO,MES")
        self.assertEqual(f["exportado_contabilidade"]["regra"], "booleano_sn")
        self.assertNotIn("=~aberto", {c["coluna"] for c in f.values()})

    def test_saldo_mensal_pelo_saldo_do_local_e_insumo(self):
        p = self.plano["GEARMLOC"]
        self.assertEqual(p["destinos"], ["saldo_estoque_mensal", "saldo_estoque"])
        op = p["opcoes"]["saldo_estoque"]
        self.assertTrue(op["antes"])
        self.assertEqual(op["adotar"], ["local_estoque_id", "insumo_id"])
        m = self.cols("GEARMLOC", "saldo_estoque_mensal")
        self.assertEqual(m["saldo_estoque_id"]["coluna"], "@id:saldo_estoque")
        self.assertEqual((m["quantidade_final"]["coluna"], m["valor_final"]["coluna"]), ("QTDE", "VALOR"))
        s = self.cols("GEARMLOC", "saldo_estoque")
        self.assertEqual((s["local_estoque_id"]["referencia"], s["insumo_id"]["referencia"]), ("GELOCARM", "GEITENS"))
        # o movimento do mês completa o saldo mensal de mesma chave (UPDATE), sem linha nova
        c = self.plano["GECONITL"]
        self.assertTrue(c["opcoes"]["saldo_estoque_mensal"]["complementa"])
        self.assertEqual([x["tabela"] for x in self.cols("GECONITL", "saldo_estoque_mensal")["id"]["passos"]
                          if "tabela" in x], ["GEARMLOC"])

    def test_itens_do_estoque_inicial_na_rodada_do_cabecalho(self):
        i = self.cols("GELANESI", "inventario_estoque_item")
        self.assertEqual(i["inventario_estoque_id"]["referencia"], "GEESTINI")
        self.assertEqual(i["inventario_estoque_contagem_id"]["passos"][-1].get("destino"), "inventario_estoque_contagem")
        self.assertEqual(i["sequencia"]["coluna"], "#seq:DOC")
        self.assertEqual([x["tabela"] for x in i["unidade_medida_id"]["passos"] if "tabela" in x],
                         ["GEITENS", "TBUNICON"])
        self.assertEqual(i["situacao"]["valores"], {"S": "ok", "N": "pendente", "": "pendente"})

    def test_descricao_do_servico_completa_o_item_de_compra(self):
        p = self.plano["GEDESPDS"]
        self.assertEqual(p["destinos"], ["pedido_compra_item"])
        self.assertTrue(p["opcoes"]["pedido_compra_item"]["complementa"])
        d = self.cols("GEDESPDS", "pedido_compra_item")
        self.assertEqual(d["descricao_servico"]["regra"], "texto_longo")
        self.assertEqual([x["tabela"] for x in d["id"]["passos"] if "tabela" in x], ["GELANPED"])

    def test_transferencia_grava_movimento_de_saida(self):
        # rodada 3: o item de transferência também grava a SAÍDA do local de origem no razão (a GERASVALTRANSFLOTE, da
        # L7-07, aponta o lote para esse movimento por ref:GELANTRA/movimento_estoque)
        self.assertEqual(self.plano["GELANTRA"]["destinos"], ["documento_estoque_item", "movimento_estoque"])
        m = self.cols("GELANTRA", "movimento_estoque")
        obrig = {"estabelecimento_id", "local_estoque_id", "ocorrido_em", "competencia", "tipo_movimento_estoque_id",
                 "natureza", "insumo_id", "unidade_medida_id", "quantidade", "quantidade_estoque", "usuario_id"}
        self.assertTrue(obrig <= set(m), obrig - set(m))
        self.assertEqual((m["natureza"]["coluna"], m["tipo_movimento_estoque_id"]["coluna"]), ("=saida", "=migracao_saida"))
        self.assertEqual(m["tipo_movimento_estoque_id"]["cod"], ("tipo_movimento_estoque", "codigo"))
        for dc in ("local_estoque_id", "contrapartida_local_estoque_id"):
            self.assertEqual([x["tabela"] for x in m[dc]["passos"] if "tabela" in x], ["GECADTRA", "GELOCARM"])
        self.assertEqual(m["competencia"]["regra"], "data_primeiro_dia_mes")
        self.assertEqual(m["documento_estoque_item_id"]["coluna"], "@id")
        self.assertEqual(m["documento_estoque_id"]["referencia"], "GECADTRA")

    def test_sequencia_do_ano_e_do_mes(self):
        # SEQ é o PRÓXIMO número (captura de assinatura do sistema antigo); MES 0 é a sequência do ano
        s = self.cols("GEGERSEQ", "sequencia_documento_estoque")
        self.assertEqual(s["proximo_numero"]["regra"], "piso:1")
        self.assertEqual(s["reinicio"]["coluna"], "MES")
        self.assertEqual(s["reinicio"]["valores"], dict({"0": "anual"}, **{str(i): "mensal" for i in range(1, 13)}))

    def test_presumidos_visiveis_nunca_zero_silencioso(self):
        self.assertEqual(self.cols("GEARMLOC", "saldo_estoque")["quantidade"]["coluna"], "=~0")
        self.assertEqual(self.cols("GECONITL", "saldo_estoque_mensal")["quantidade_saida_paciente"]["coluna"], "=~0")

    def test_consumo_e_lote_nao_sao_descartados(self):
        # rodada 3: consumo por centro de custo e lote por documento CARREGAM (dado financeiro e sanitário); rodada 4:
        # o consumo carrega somado por ano, mês, centro de custo e insumo (agrupar: no destino principal)
        raiz = Path(mapa.__file__).resolve().parents[1] / "mapa" / "declarado"
        sem = {r["tabela"] for r in mapa.ler_tsv(raiz / "sem_carga.tsv")}
        self.assertFalse({"GEKONCDC", "GECTRVMM"} & sem)
        pronta = (raiz / "colunas.d" / "L7-05.tsv").read_text(encoding="utf-8")
        self.assertIn("\nGEKONCDC\t#grupo_somar:VALOR\tconsumo_centro_custo.valor_liquido", pronta)
        decl = {(c["tabela"], c["coluna"], c["destino"]): c for c in self.mapa["colunas_decl"]}
        self.assertEqual(decl[("GEKONCDC", "ANO", "consumo_centro_custo.ano")]["via"], "agrupar:ANO,MES,CDC,ITEM")
        self.assertIn(("GEKONCDC", "#grupo_json:DOC,DATA,QTDE,VALOR", "consumo_centro_custo.dados"), decl)
        # o local: primeiro o estoque padrão do centro de custo (constante no grupo), depois o do documento
        locais = [c["coluna"] for c in self.mapa["colunas_decl"]
                  if c["tabela"] == "GEKONCDC" and c["destino"] == "consumo_centro_custo.local_estoque_id"]
        self.assertEqual(locais, ["CDC", "DOC"])
        self.assertIn("GEKONCDC", self.plano)
        # o lote por documento carrega desde a rodada 3 (conferidor): declaração ativa, não comentada
        self.assertIn("\nGECTRVMM\tLOTE\tlote_insumo.numero_lote", pronta)
        self.assertNotIn("\n#GECTRVMM\t", pronta)

    def test_bloqueadas_sem_destino(self):
        com_destino = {c["tabela"] for c in self.mapa["colunas_decl"] if c["destino"]}
        self.assertFalse(com_destino & set(l7_05.BLOQUEADAS))


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Almoxarifado   central "), ("Almoxarifado central", None))
        self.assertEqual(a("texto_nome", "   "), (None, None))
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_01", 1), (True, None))
        self.assertEqual(a("booleano_01", 7), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_zero_nulo", 0), (None, None))
        self.assertEqual(a("inteiro_zero_nulo", 12345), (12345, None))
        self.assertEqual(a("inteiro_nao_negativo", -5), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_nao_negativo", 0), (0, None))
        self.assertEqual(a("piso:1", 0), (1, "valor_elevado_ao_minimo"))
        self.assertEqual(a("piso:1", 15), (15, None))
        self.assertEqual(a("decimal_nao_negativo", decimal.Decimal("-5")), (None, "valor_fora_do_dominio"))
        self.assertEqual(carga_mapa.data_composta(2025, 3), (datetime.date(2025, 3, 1), None))
        self.assertEqual(carga_mapa.data_composta(2025, 13), (None, "valor_fora_do_dominio"))
        self.assertEqual(carga_mapa.data_composta(2025, None), (None, None))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l7_05.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            if t == "GEHORMED":  # desdobrado: "gravados" conta itens (10 de uma linha) e a outra não tem item
                self.assertEqual(cont[t], 1 + e["pendencias"]["sem_item_a_gravar"], t)
                continue
            pref = ("restricao_destino_",) if t in FASE2 else ("restricao_destino_", "pai_pendente")
            pref += ("pai_inexistente",) if t in COMPLEMENTA else ()
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(pref))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
        for t in l7_05.BLOQUEADAS:  # presença na imagem, nada esperado no destino
            self.assertEqual(cont[t], 2, t)

    def test_ddl_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l7_05.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, TABELAS | set(l7_05.BLOQUEADAS) | set(l7_05.PAIS_NA_IMAGEM))

    def test_colunas_das_linhas_batem_com_o_ddl(self):
        ncols = {}
        for stmt in l7_05.DDL.split(";"):
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
        l7_05.linhas(random.Random(1), lambda t, v: vistos.append((t, len(v))))
        for t, n in vistos:
            self.assertEqual(n, ncols[t], t)



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
    def test_consumo_somado_por_grupo(self):
        """GEKONCDC: 4 linhas gravadas em 3 grupos; o grupo 2025/3, centro 11, insumo 1 soma os 2 documentos e os
        guarda no JSON; o local é o estoque padrão do centro (11 -> local 1)."""
        from sante_conector import conferencia
        lidos = {}

        def ler(cc):
            with cc.cursor() as c:
                c.execute("SELECT k.ano, k.mes, CAST(k.quantidade_liquida AS CHAR), CAST(k.valor_liquido AS CHAR),"
                          " k.dados, l.codigo FROM consumo_centro_custo k JOIN local_estoque l ON"
                          " l.id=k.local_estoque_id ORDER BY k.ano, k.mes, k.quantidade_liquida")
                lidos["kon"] = [list(x) for x in c.fetchall()]
        r = conferencia.conferir("L7-05", depois_da_primeira=ler)
        self.assertEqual(r["erros"], [])
        kon = lidos["kon"]
        self.assertEqual(len(kon), 3)
        self.assertEqual([(k[0], k[1], k[2], k[3], str(k[5])) for k in kon],
                         [(2025, 3, "3.5000", "17.50", "1"), (2025, 3, "4.0000", "8.00", "1"),
                          (2025, 4, "1.0000", "5.00", "1")])
        docs = json.loads(kon[0][4])
        self.assertEqual(len(docs), 2)
        self.assertIn("100", json.dumps(docs))
        self.assertIn("101", json.dumps(docs))


if __name__ == "__main__":
    unittest.main()
