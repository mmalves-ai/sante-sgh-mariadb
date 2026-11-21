"""Fatia L5-12 (cadastros e administração, módulo RH): declarações, plano e imagem sintética. Sem banco; só valores
inventados. A carga e a conciliação na imagem SINTÉTICA rodam em `conector.sh conferir-fatia L5-12`."""
import datetime
import decimal
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_12

FATIA = ("STFIL_PREV", "STLOCAL", "STRESULT", "STTPASO", "STTPMEDIDAS", "TBTABIRR", "TBTPCONSTRUT", "TBTPCOOPERAT",
         "FPEVENTO", "FPLOTTRIBCAD", "FPREMESSA", "FPRESP", "FPRUBRICAFGTS_FPEVENTO", "FPRUBRICAINSS_FPEVENTO",
         "FPRUBRICAIRRF_FPEVENTO", "FPRUBRICASIND_FPEVENTO", "FPTPEVENTOAUT_TBEMPHOS", "PEJUSTIF", "TBTPTRIBUTO",
         "FPPARAM", "FPPARAMVIG")
OFICIAIS = ("STFIL_PREV", "STLOCAL", "STRESULT", "STTPASO", "STTPMEDIDAS")


class FatiaL512(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c.get("_arquivo", "").endswith("L5-12.tsv")
                    or c["tabela"] in FATIA]

    def test_so_as_tabelas_carregaveis_tem_declaracao(self):
        com_destino = {c["tabela"] for c in self.decl if c.get("destino")}
        self.assertEqual(com_destino, set(l5_12.CARREGADAS))
        for t in OFICIAIS + ("TBTPCONSTRUT", "TBTPCOOPERAT"):  # catálogo oficial e lista de domínio: nunca gravados
            self.assertNotIn(t, {c["tabela"] for c in self.decl})

    def test_plano_em_ordem_com_destino_principal(self):
        p = [x for x in carga_mapa.planejar(self.m, set(FATIA) | {"TBEMPHOS"}) if x["tabela"] in FATIA]
        self.assertEqual([x["tabela"] for x in p], [
            "FPEVENTO", "FPLOTTRIBCAD", "FPREMESSA", "FPRESP", "FPRUBRICAFGTS_FPEVENTO",
            "FPRUBRICAINSS_FPEVENTO", "FPRUBRICAIRRF_FPEVENTO", "FPRUBRICASIND_FPEVENTO", "FPTPEVENTOAUT_TBEMPHOS",
            "PEJUSTIF", "TBTPTRIBUTO", "FPPARAM", "FPPARAMVIG"])
        pl = {x["tabela"]: x for x in p}
        self.assertNotIn("TBTABIRR", pl)  # tabela legal pública: descarte (catálogo oficial), com motivo declarado
        self.assertTrue(any(d["tabela"] == "TBTABIRR" and not d["destino"] and "DESCARTE" in d["motivo"]
                            for d in self.decl))
        trib = {c["destino"]: c for c in pl["TBTPTRIBUTO"]["colunas"]["tributo_folha"]}
        self.assertEqual((trib["tipo"]["coluna"], trib["tipo"]["valores"]["1"], trib["tipo"]["valores"]["4"]),
                         ("ID", "fundo_garantia", "imposto_renda"))
        self.assertEqual((trib["codigo"]["coluna"], trib["codigo"]["regra"]), ("ID", "texto"))
        aut = {c["destino"]: c for c in pl["FPTPEVENTOAUT_TBEMPHOS"]["colunas"]["lancamento_automatico_rubrica"]}
        self.assertEqual(aut["evento_gatilho"]["coluna"], "ID_FPTPEVENTOAUT")
        self.assertEqual(set(aut["evento_gatilho"]["valores"].values()), {"outro"})
        rub = {c["destino"]: c for c in pl["FPEVENTO"]["colunas"]["rubrica"]}
        resp = {c["destino"]: c for c in pl["FPRESP"]["colunas"]["responsavel_legal_empregador"]}
        self.assertEqual((rub["ativo"]["regra"], resp["ativo"]["regra"]), ("booleano_ai", "booleano_ai"))

    def test_cadastro_do_empregador_pela_empresa(self):
        p = {x["tabela"]: x for x in carga_mapa.planejar(self.m, set(FATIA))}
        cols = {c["destino"]: c for c in p["FPPARAM"]["colunas"]["cadastro_empregador"]}
        trib = cols["tributaria_codigo_esocial_id"]
        self.assertEqual((trib["coluna"], trib["depara"]), ("COD_EMP", "codigo_esocial:8"))
        self.assertEqual(trib["passos"][-1].get("coluna"), "ID_FPCLASSIFTRIB")  # encadeada terminada em coluna
        self.assertEqual(cols["indicador_cooperativa"]["valores"],
                         {"0": "nao_cooperativa", "1": "trabalho", "2": "producao", "3": "outra"})
        self.assertEqual(cols["construtora"]["valores"], {"0": "0", "1": "1"})
        self.assertEqual(cols["responsavel_legal_empregador_id"]["referencia"], "FPRESP")
        self.assertEqual(cols["vigencia_inicio"]["coluna"], "@vigencia_carga")
        self.assertEqual(p["FPPARAM"]["colunas"]["cadastro_empregador"][0]["coluna"], "ID_RESP_EMP")  # recusa antes
        vig = {c["destino"]: c for c in p["FPPARAMVIG"]["colunas"]["trilha_auditoria"]}
        self.assertEqual(p["FPPARAMVIG"]["destinos"], ["trilha_auditoria"])
        self.assertEqual(vig["entidade_id"]["referencia"], "FPPARAM")
        self.assertEqual((vig["entidade"]["coluna"], vig["acao"]["coluna"], vig["dados_depois"]["coluna"]),
                         ("=cadastro_empregador", "=alteracao", "#retrato"))

    def test_aguarda_motor_ou_modelo_fica_declarado_com_motivo(self):
        """Coluna NOT NULL que aguarda o motor ou o modelo: fora do plano, com o motivo e o pedido (recusa 1364)."""
        p = {x["tabela"]: x for x in carga_mapa.planejar(self.m, set(FATIA))}
        faltam = {"FPEVENTO": ("rubrica", "natureza_rubrica_id"), "FPLOTTRIBCAD": ("lotacao_tributaria", "fpas_id"),
                  "FPTPEVENTOAUT_TBEMPHOS": ("lancamento_automatico_rubrica", "rubrica_id"),
                  "FPREMESSA": ("competencia_folha", "aberta_em")}
        for t in l5_12.INCIDENCIAS:
            faltam[t] = ("incidencia_rubrica", "codigo_incidencia_rubrica_id")
        for t, (dt, dc) in faltam.items():
            self.assertNotIn(dc, {c["destino"] for c in p[t]["colunas"][dt]}, t)
            self.assertTrue(any(d["tabela"] == t and not d["destino"] and "AGUARDA" in d["motivo"] for d in self.decl), t)
        rub = {c["destino"]: c for c in p["FPEVENTO"]["colunas"]["rubrica"]}
        self.assertEqual(rub["tipo_rubrica_id"]["referencia"], "FPTP_EVENTO")
        self.assertEqual(rub["tipo_referencia_rubrica_id"]["referencia"], "FPTP_REFER")
        comp = {c["destino"]: c for c in p["FPREMESSA"]["colunas"]["competencia_folha"]}
        self.assertEqual(comp["situacao"]["valores"], {"S": "fechada", "N": "aberta"})
        self.assertEqual(comp["tipo_folha_id"]["referencia"], "FPTP_FOLHA")

    def test_regras_de_valor(self):
        self.assertEqual(sentinela.aplicar("flutuante", 1904.98)[0], decimal.Decimal("1904.98"))
        self.assertEqual(sentinela.aplicar("texto_nome", "  Consulta   de rotina ")[0], "Consulta de rotina")
        self.assertEqual(sentinela.aplicar("texto_nome", "   ")[0], None)
        self.assertEqual(sentinela.aplicar("data", datetime.date(2016, 1, 1)), (datetime.date(2016, 1, 1), None))
        self.assertEqual(sentinela.aplicar("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(sentinela.aplicar("texto", 10), ("10", None))
        self.assertEqual(sentinela.aplicar("cpf", l5_12.cpf_falso(123456789))[1], None)
        self.assertEqual(sentinela.aplicar("cpf", "123"), (None, "documento_invalido"))
        self.assertEqual(sentinela.aplicar("faixa:1,31", 40), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar("booleano_sn", "S"), (True, None))
        self.assertEqual(sentinela.aplicar("booleano_ai", "I"), (False, None))
        self.assertEqual(sentinela.aplicar("booleano_ai", " "), (None, None))
        self.assertEqual(len(l5_12.cnpj_falso(998877660011)), 14)

    def test_imagem_sintetica_tem_todas_as_tabelas_e_o_esperado(self):
        self.assertEqual(set(l5_12.FATIA), set(FATIA))
        linhas = {}
        esp = l5_12.linhas(random.Random(1), lambda t, v: linhas.setdefault(t, []).append(v))
        self.assertEqual(set(esp) - {"TBEMPHOS"}, set(l5_12.CARREGADAS))
        self.assertEqual("TBEMPHOS" in esp, bool(l5_12.DONO_EMPRESA))  # esperado da dona + as 3 empresas desta fatia
        for t, cols in l5_12.COLUNAS.items():
            for v in linhas.get(t, []):
                self.assertEqual(len(v), len(cols))
        for t, e in ((t, e) for t, e in esp.items() if t != "TBEMPHOS"):  # lidas = gravadas + recusadas (recusa: restrição do destino ou pai pendente)
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith("restricao_destino_") or k == "pai_pendente")
            if t == "FPREMESSA":  # a mesma linha pode ter 1364 e outra pendência; todas recusadas
                recusas = e["pendencias"]["restricao_destino_1364"]
            self.assertEqual(e["gravados"] + recusas, len(linhas[t]))
        self.assertEqual(len(l5_12.COLUNAS["FPEVENTO"]), 113)


if __name__ == "__main__":
    unittest.main()
