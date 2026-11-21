"""Fatia L8-05 (faturamento e restantes, módulo FAT): declarações planejadas, regras das colunas, descartes e coerência
da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia
L8-05`."""
import random
import unittest
from pathlib import Path

from sante_conector import carga, carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_05

TABELAS = set(l8_05.CARREGADAS)
DESTINOS = {"TBTIPPLANO": ["plano_fonte_pagadora"], "TBTABDTH": ["preco_diaria_taxa"],
            "TBTPPROFPROC": ["funcao_equipe_cobranca"], "TBCODATI": ["codigo_prestador_fonte_pagadora"],
            "TBCODATI_TBUSERS": ["usuario_codigo_prestador"], "TBCONVEN_TBTISSPARDEF": ["valor_padrao_campo_tiss"],
            "TBEMIREF": ["referencia_emissao_matmed"], "TBENTCON": ["calendario_entrega_fatura"],
            "TBVLRTHM": ["preco_procedimento_valor"], "TBTIPPLCONV": ["diaria_por_plano_local"],
            "TBTISS": ["regra_apresentacao_tiss", "configuracao_tiss_fonte_pagadora"],
            "TBVLRDTH": ["preco_diaria_taxa_valor"], "FCCTAEXT": ["conta_hospitalar"],
            "FCDIAEXT": ["conta_hospitalar_segurado"]}
OBRIGATORIAS = {
    "TBTIPPLANO": {"fonte_pagadora_id", "codigo", "descricao"},
    "TBTABDTH": {"tabela_preco_id", "sequencia", "codigo", "nome", "tipo_item"},
    "TBTPPROFPROC": {"codigo", "descricao", "tipo_funcao"},
    "TBCODATI": {"estabelecimento_id", "fonte_pagadora_id", "tipo_prestador", "codigo_operadora", "vigencia_inicio"},
    "TBCODATI_TBUSERS": {"codigo_prestador_fonte_pagadora_id", "usuario_id"},
    "TBCONVEN_TBTISSPARDEF": {"fonte_pagadora_id", "campo_tiss", "valor_padrao", "vigencia_inicio"},
    "TBEMIREF": {"fonte_pagadora_id", "classificacao_despesa_id"},
    "TBENTCON": {"estabelecimento_id", "fonte_pagadora_id", "competencia", "entrega_inicio", "entrega_fim"},
    "TBVLRTHM": {"preco_procedimento_id", "ocorrido_em", "vigencia_inicio"},
    "TBTIPPLCONV": {"fonte_pagadora_id", "preco_diaria_taxa_id", "vigencia_inicio"},
    "TBTISS": {"estabelecimento_id", "fonte_pagadora_id", "versao_padrao_tiss_id"},
    "TBVLRDTH": {"preco_diaria_taxa_id", "ocorrido_em", "vigencia_inicio", "valor"},
    "FCCTAEXT": {"estabelecimento_id", "numero", "atendimento_id", "paciente_id", "fonte_pagadora_id",
                 "tipo_conta_id", "natureza", "competencia", "inicio_em"},
    "FCDIAEXT": {"conta_hospitalar_id", "numero_carteira"},
}



class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, TABELAS | set(l8_05.BLOQUEADAS))}

    def cols(self, t, dt=None):
        dt = dt or DESTINOS[t][0]
        return {c["destino"]: c for c in self.plano[t]["colunas"][dt]}

    def decl(self, t):
        return [c for c in self.mapa["colunas_decl"] if c["tabela"] == t]

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t, dts in DESTINOS.items():
            self.assertEqual(self.plano[t]["destinos"], dts, t)

    def test_obrigatorias_do_destino_cobertas(self):
        for t, cs in OBRIGATORIAS.items():
            self.assertTrue(cs <= set(self.cols(t)), (t, cs - set(self.cols(t))))

    def test_referencias(self):
        esperado = {("TBTIPPLANO", "fonte_pagadora_id"): "TBCONVEN", ("TBTABDTH", "tabela_preco_id"): "TBCTRDTH",
                    ("TBCODATI", "fonte_pagadora_id"): "TBCONVEN",
                    ("TBCODATI_TBUSERS", "codigo_prestador_fonte_pagadora_id"): "TBCODATI",
                    ("TBCODATI_TBUSERS", "usuario_id"): "TBUSERS",
                    ("TBCONVEN_TBTISSPARDEF", "fonte_pagadora_id"): "TBCONVEN",
                    ("TBCONVEN_TBTISSPARDEF", "campo_tiss"): "TBTISSPARDEF>NOME",
                    ("TBEMIREF", "classificacao_despesa_id"): "TBCLASSI",
                    ("TBENTCON", "fonte_pagadora_id"): "TBCONVEN",
                    ("TBVLRTHM", "preco_procedimento_id"): "TBTABTHM(TAB,COD)"}
        for (t, dc), ref in esperado.items():
            self.assertEqual(self.cols(t)[dc]["referencia"], ref, (t, dc))
        # a chave composta do pai é a do mapa (TAB,COD), na mesma ordem
        self.assertEqual(self.cols("TBVLRTHM")["preco_procedimento_id"]["passos"][0]["arg"], ["TAB", "COD"])

    def test_pais_externos_sao_os_referenciados(self):
        refs = set()
        for t in TABELAS:
            for cs in self.plano[t]["colunas"].values():
                for c in cs:
                    if c.get("referencia"):
                        refs.add(c["referencia"].split(">")[0].split("(")[0].split(".")[0].split("@")[0])
        # o parâmetro TISS só é lido da origem (referência encadeada): não está na imagem desta fatia; o cadastro de
        # versões TISS está na imagem só como origem (catálogo oficial, nunca gravado)
        self.assertEqual(refs - TABELAS - {"TBTISSPARDEF"} - set(l8_05.SO_ORIGEM), set(l8_05.PAIS_EXTERNOS))

    def test_pais_externos_carregados_ou_dependencia_registrada(self):
        """Pai dado como carregado na conferência precisa carregar (destino em colunas.d ou carga do L3); senão a
        dependência bloqueante fica no motivo da coluna que o referencia."""
        com_destino = {c["tabela"] for c in self.mapa["colunas_decl"] if c["destino"]} | set(carga.ORDEM)
        for pai in l8_05.PAIS_EXTERNOS:
            if pai in com_destino:
                continue
            ms = [d["motivo"] for t in TABELAS for d in self.decl(t)
                  if d["destino"] and pai in (d.get("via") or "") + (d.get("referencia") or "")]
            ms += [d["motivo"] for t in TABELAS for d in self.decl(t) if d["destino"] and not d.get("via")
                   and pai in d["motivo"]]
            self.assertTrue(any("DEPENDÊNCIA BLOQUEANTE: " + pai in m for m in ms), pai)

    def test_codigo_com_prefixo_de_dominio(self):
        c = self.cols("TBTPPROFPROC")
        self.assertEqual(c["codigo"]["coluna"], "#codigo_derivado:ID:30:tipo_prof_")
        self.assertEqual(c["tipo_funcao"]["coluna"], "=~outro")
        self.assertEqual(carga_mapa.codigo_derivado("3", 30, "tipo_prof_"), ("tipo_prof_3", False))

    def test_senha_nunca_em_coluna(self):
        for c in self.mapa["colunas_decl"]:
            if c["tabela"] in ("TBCODATI", "TBTISS") and "SENHA" in c["coluna"] and c["destino"]:
                self.assertTrue(c["coluna"].startswith("#cofre:"), c["coluna"])
        self.assertEqual(self.cols("TBCODATI")["credencial_fonte_pagadora_id"]["coluna"], "#cofre:SENHA_PRESTADOR")

    def test_vigencia_e_estabelecimento(self):
        for t in ("TBCODATI", "TBCONVEN_TBTISSPARDEF"):
            self.assertEqual(self.cols(t)["vigencia_inicio"]["coluna"], "@vigencia_carga", t)
        for t in ("TBCODATI", "TBENTCON"):
            self.assertEqual(self.cols(t)["estabelecimento_id"]["coluna"], "@estabelecimento", t)

    def test_competencia_e_janela_da_entrega(self):
        c = self.cols("TBENTCON")
        self.assertEqual(c["competencia"]["regra"], "data_primeiro_dia_mes")
        self.assertEqual((c["entrega_inicio"]["coluna"], c["entrega_fim"]["coluna"]), ("ENTREGA", "ENTREGA"))

    def test_depara_de_valores(self):
        c = self.cols("TBEMIREF")
        self.assertEqual(c["origem_codigo"]["valores"], {"S": "referencia", "N": "proprio"})
        self.assertEqual(c["origem_descricao"]["valores"], {"S": "referencia", "N": "proprio"})
        self.assertEqual(c["preco_base"]["valores"], {"S": "preco_fabrica", "N": "preco_maximo_consumidor"})

    def test_comentadas_bloqueadas_sem_gravar_errado(self):
        """Correção da rodada 3: contador do último número (TBSEGUIA), de-para sem as dimensões da chave (TBINTCRC),
        auditoria com total zero presumido e conclusão sem condição (FCCTAAUD) e acordo de mat/med (TBPERMEM,
        TBEMIREFMATMED) ficam com a declaração pronta e COMENTADA: nada delas é gravado nem contado como carregado."""
        com = _comentadas()
        ativas = {c["tabela"] for c in self.mapa["colunas_decl"]}
        sc = {r["tabela"] for r in mapa.ler_tsv(Path(mapa.DIR_PACOTE) / "declarado/sem_carga.tsv")}
        for t in l8_05.COMENTADAS:
            self.assertIn(t, com, t)
            self.assertNotIn(t, ativas, t)
            self.assertNotIn(t, TABELAS, t)
            self.assertNotIn(t, sc, t)  # bloqueio visível, nunca descarte
            self.assertTrue(all("BLOQUEADA" in m[-1] or "NÃO é descarte" in m[-1] for m in com[t]), t)
        # o total da cópia nunca entra como zero presumido; a conclusão não sai da data da gravação
        aud = {(m[1], m[2]) for m in com["FCCTAAUD"]}
        self.assertFalse({x for x in aud if x[0].startswith("=~") and "valor" in x[1]})
        self.assertFalse({x for x in aud if x[1] in ("auditoria_conta.concluida_em", "auditoria_conta.resultado",
                                                     "auditoria_conta_versao.valor_total_conta")})
        # acordo de mat/med: item pelo item faturável que TBMATMED gravar, valor, percentual e quantidade da origem
        pm = {m[2]: m[5] for m in com["TBPERMEM"] if m[2]}
        self.assertEqual(pm["preco_negociado_matmed.item_faturavel_id"], "ref:TBMATMED/item_faturavel")
        self.assertEqual(pm["preco_negociado_matmed.fonte_pagadora_id"], "ref:TBCONVEN")
        self.assertTrue({"preco_negociado_matmed.valor_unitario", "preco_negociado_matmed.percentual_ajuste",
                         "preco_negociado_matmed.quantidade_fixa", "preco_negociado_matmed.vigencia_inicio"} <= set(pm))

    def test_tbtabdth_mantida(self):
        c = self.cols("TBTABDTH")
        self.assertEqual((c["codigo"]["coluna"], c["sequencia"]["coluna"]), ("OPE", "OPE"))
        self.assertEqual(c["ativo"]["regra"], "booleano_ai")
        self.assertEqual(c["tipo_item"]["coluna"], "=~taxa")
        decl = {d["coluna"] for d in self.decl("TBTABDTH")}
        self.assertFalse({x for x, _, _ in l8_05.COLUNAS["TBTABDTH"]} - decl - {"ID"})

    def test_descartes_com_causa_de_produto(self):
        sc = {r["tabela"]: r for r in mapa.ler_tsv(Path(mapa.DIR_PACOTE) / "declarado/sem_carga.tsv")}
        for t in l8_05.DESCARTES:
            self.assertEqual(sc[t]["situacao"], "descarte", t)
            self.assertIn(sc[t]["causa"], {"sem_valor", "duplicado", "licenciado", "catalogo_oficial",
                                           "mecanismo_do_produto"}, t)
            self.assertTrue(sc[t]["motivo"], t)

    def test_nao_carregadas_sem_destino(self):
        com_destino = {c["tabela"] for c in self.mapa["colunas_decl"] if c["destino"]}
        self.assertFalse(com_destino & set(l8_05.BLOQUEADAS))
        self.assertEqual(set(l8_05.BLOQUEADAS), set(l8_05.DESCARTES) | set(l8_05.COMENTADAS))

    def test_diaria_por_plano_e_valor_da_diaria(self):
        c = self.cols("TBTIPPLCONV")
        self.assertEqual(c["plano_fonte_pagadora_id"]["referencia"], "TBTIPPLANO")
        self.assertNotIn("contrato_fonte_pagadora_id", c)  # nulo = qualquer acordo da fonte (modelo 12_FAT/11)
        self.assertNotIn("categoria_acomodacao_id", c)
        v = self.cols("TBVLRDTH")["preco_diaria_taxa_id"]
        self.assertEqual((v["passos"][0]["modo"], v["passos"][0]["arg"], v["passos"][0]["cols"]),
                         ("alt_composta", ["TAB", "OPE"], ["TAB", "OPE"]))

    def test_tiss_versao_pelo_catalogo_oficial_e_segredo_fora(self):
        for dt in DESTINOS["TBTISS"]:
            c = self.cols("TBTISS", dt)["versao_padrao_tiss_id"]
            self.assertEqual((c["depara"], c["referencia"]), ("versao_tiss", "TBVERSAOTISS>COD_VERSAO_TISS"))
        for d in self.decl("TBTISS"):
            if "SENHA" in d["coluna"] or "CERTIFICADO" in d["coluna"]:
                self.assertFalse(d["destino"], d["coluna"])

    def test_conta_auditoria_e_segurado(self):
        c = self.cols("FCCTAEXT")
        self.assertEqual(c["tipo_conta_id"]["cod"], ("tipo_conta", "codigo"))
        self.assertEqual(c["tipo_conta_id"]["valores"],
                         {"A": "ambulatorial", "E": "externa", "U": "urgencia", "I": "internacao"})
        self.assertEqual(set(c["natureza"]["valores"].values()) - {"ambulatorial", "externo", "pronto_atendimento",
                                                                   "internacao", "domiciliar"}, set())
        self.assertEqual(c["paciente_id"]["passos"][0].get("coluna_destino"), "paciente_id")
        self.assertEqual(c["atendimento_id"]["referencia"], "RECADATE")
        s = self.cols("FCDIAEXT")
        self.assertEqual(s["numero_carteira"]["passos"][-1], {"coluna": "MATRICULA"})
        self.assertEqual(s["conta_hospitalar_id"]["passos"][0]["arg"], ["ANOPRO", "MESPRO", "COD"])


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        import datetime
        a = sentinela.aplicar
        self.assertEqual(a("texto_nome", "  Auxiliar   um "), ("Auxiliar um", None))
        self.assertEqual(a("texto_nome", "   "), (None, None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_nao_negativo", -1), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_ai", "I"), (False, None))
        self.assertEqual(a("data_primeiro_dia_mes", datetime.date(2025, 2, 10)), (datetime.date(2025, 2, 1), None))


def _comentadas():
    """{tabela: [campos]} das declarações comentadas desta fatia."""
    saida = {}
    for l in (Path(mapa.DIR_PACOTE) / "declarado/colunas.d/L8-05.tsv").read_text(encoding="utf-8").splitlines():
        if l.startswith("#") and "\t" in l:
            p = l[1:].split("\t")
            saida.setdefault(p[0], []).append(p)
    return saida


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l8_05.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items()
                          if k.startswith("restricao_destino_") or k == "pai_pendente")
            self.assertEqual(cont[t], e["gravados"] + recusas, t)
        for t in l8_05.BLOQUEADAS + l8_05.SO_ORIGEM:  # presença na imagem, nada esperado no destino
            self.assertEqual(cont[t], 2, t) if t not in l8_05.COM_LINHAS else self.assertGreater(cont[t], 2, t)

    def test_cada_carregada_prova_linhas_gravadas(self):
        """Toda tabela contada como carregada afirma linhas GRAVADAS no destino (a conciliação da conferência compara
        com o que o banco tem). Exceção registrada: o campo TISS do valor padrão é lido de TBTISSPARDEF, que está só na
        imagem da L8-04; aqui as 2 linhas provam a recusa visível (pai_inexistente + 1048)."""
        esp = l8_05.linhas(random.Random(1), lambda t, v: None)
        for t, e in esp.items():
            if t == "TBCONVEN_TBTISSPARDEF":
                self.assertEqual((e["gravados"], e["pendencias"]["pai_inexistente"]), (0, 2))
                continue
            self.assertGreater(e["gravados"], 0, t)

    def test_ddl_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l8_05.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, TABELAS | set(l8_05.BLOQUEADAS) | set(l8_05.SO_ORIGEM))
        self.assertEqual(len(criadas), 26)
        self.assertNotIn("TBTISSPARDEF", criadas)  # DDL da L8-04 (imagem conjunta dos lotes)

    def test_colunas_das_linhas_batem_com_a_forma(self):
        vistos = []
        l8_05.linhas(random.Random(1), lambda t, v: vistos.append((t, len(v))))
        for t, n in vistos:
            self.assertEqual(n, len(l8_05.COLUNAS[t]), t)


if __name__ == "__main__":
    unittest.main()
