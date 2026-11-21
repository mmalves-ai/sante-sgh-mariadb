"""Fatia L6-12 (prontuário, assinatura e assistência, módulo PEP): declarações prontas e bloqueadas.

Sem banco; só a imagem SINTÉTICA e valores inventados. A fatia depende da referência pela coluna do pai (paciente,
atendimento e profissional vêm por tabela intermediária da origem): até o motor ter isso, nada da fatia entra na carga
e as declarações ficam comentadas em colunas.d/L6-12.tsv. Estes testes garantem que (1) nada entra hoje, (2) as
declarações comentadas apontam colunas reais do destino, com regras válidas, e cobrem os NOT NULL de todos os
destinos (ou nomeiam o pedido que falta), e (3) nenhuma referência de outra entidade ficou declarada como direta: a via
encadeada é conferida salto a salto contra o mapa.
"""
import datetime
import random
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_12

TSV = mapa.DIR_PACOTE / "declarado" / "colunas.d" / "L6-12.tsv"
CAMPOS = ("tabela", "coluna", "destino", "regra", "depara", "via", "motivo")
INTERMEDIARIAS = {"HTPACIENTE", "HTATENDIMENTO", "TBCBOPRO"}
AUDITORIA = {"id", "criado_em", "origem", "versao"}
# NOT NULL sem padrão que a carga coluna a coluna ainda não supre, com o pedido (saida/L6-12.json) que os resolve
AGUARDAM_PEDIDO = {
    ("PRALERGIAPAC_TBPRINC", "alergia_paciente_principio"): {"principio_ativo_id"},  # pedido 3
    ("PRASSINATURA_CAB", "documento_prontuario"): {"entidade_origem", "entidade_origem_id", "lancado_em",
                                                   "profissional_id", "referencia_em",
                                                   "situacao_documento_prontuario_id", "titulo"},  # pedido 6b
    ("PRCABEC_MONITORIZACAO", "monitorizacao_paciente"): {"responsavel_profissional_id"},  # pedido 7
    ("PRCABEVOL", "registro_assistencial"): {"impressao_digital"},  # pedido 6a
    ("PRPRESCHEMO", "prescricao_item_hemocomponente"): {"hemocomponente_id", "quantidade",
                                                        "unidade_prescricao_id"},  # pedido 3
}
NAO_COLUNA = {"CONSTRAINT", "KEY", "UNIQUE", "PRIMARY", "FULLTEXT", "INDEX", "CHECK"}


def _raiz():
    return Path("/app") if Path("/app/db/migracoes").exists() else mapa.RAIZ


def _comentadas():
    saida = []
    for linha in TSV.read_text(encoding="utf-8").splitlines():
        if linha.startswith("#") and not linha.startswith("#L6-12\t"):
            saida.append(dict(zip(CAMPOS, linha[1:].split("\t"))))
    return saida


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
        cls.tabelas = {r["tabela"]: r for r in cls.m["tabelas"] if r["tabela"] in l6_12.FORMAS}
        cls.geradas = {(c["tabela"], c["coluna"]): c for c in cls.m["colunas"] if c["tabela"] in l6_12.FORMAS}
        cls.decl = _comentadas()
        cls.ddl = mapa.ler_ddl(_raiz())

    def test_nada_da_fatia_entra_na_carga_hoje(self):
        self.assertEqual(len(self.tabelas), 23)
        self.assertEqual(carga_mapa.planejar(self.m, set(l6_12.FORMAS)), [])
        self.assertFalse([c for c in self.m["colunas_decl"] if c["tabela"] in l6_12.FORMAS and c.get("destino")])

    def test_declaracoes_comentadas_apontam_colunas_reais(self):
        com_destino = [c for c in self.decl if c["destino"]]
        self.assertGreater(len(com_destino), 100)
        for c in self.decl:
            t, col = c["tabela"], c["coluna"]
            self.assertIn(t, self.tabelas, t)
            self.assertTrue(c["motivo"], (t, col))
            if col[:1] not in "=@#?":
                self.assertIn((t, col), self.geradas, (t, col))
            for cond in re.findall(r"(?:^|[:|])(\w+)(?:=\w+|>@carga)?(?=[:|]|$)", col[2:] if col[:2] == "=?" else
                                   col[1:] if col[:1] == "?" else ""):
                if cond.isupper():  # coluna citada no literal ou na cópia condicional existe na origem
                    self.assertIn((t, cond), self.geradas, (t, col, cond))
            if c["regra"]:
                self.assertIn(c["regra"], sentinela.REGRAS, (t, col))
            if c["destino"]:
                dt, dc = c["destino"].split(".")
                self.assertIn(dt, self.tabelas[t]["tabelas_destino"].split(";"), (t, col))
                self.assertIn(dc, self.ddl[dt]["colunas"], (t, col, dc))

    def _via_encadeada(self, via):
        """`ref:<PAI>.<COL>>[<PAI2>.<COL2>>...]<FIM>` em saltos [(tabela, coluna)] + tabela final."""
        m = re.fullmatch(r"ref:((?:\w+\.\w+>)+)(\w+)", via or "")
        if not m:
            return None, None
        return [tuple(s.split(".")) for s in m.group(1).rstrip(">").split(">")], m.group(2)

    def test_referencia_de_outra_entidade_nunca_direta(self):
        # paciente, atendimento e profissional pela tabela intermediária só pela via encadeada, e cada salto existe:
        # a coluna está na tabela do salto e aponta (referência gerada) a tabela seguinte
        todas = {(c["tabela"], c["coluna"]): c for c in self.m["colunas"]}
        chaves = {r["tabela"]: r["chave"] for r in self.m["tabelas"]}
        vistos = 0
        for c in self.decl:
            g = self.geradas.get((c["tabela"], c["coluna"]), {})
            if not (c["destino"] and g.get("referencia") in INTERMEDIARIAS):
                continue
            saltos, fim = self._via_encadeada(c["via"])
            self.assertTrue(saltos, (c["tabela"], c["coluna"], c["via"]))
            self.assertEqual(saltos[0][0], g["referencia"], (c["tabela"], c["coluna"]))
            for i, (pai, col) in enumerate(saltos):
                proximo = saltos[i + 1][0] if i + 1 < len(saltos) else fim
                self.assertIn((pai, col), todas, (c["tabela"], c["coluna"], pai, col))
                ref = todas[(pai, col)]["referencia"]
                if ref:
                    self.assertEqual(ref, proximo, (c["tabela"], c["coluna"], pai, col))
                else:  # sem referência gerada (login em texto): mesma forma da chave da tabela seguinte
                    self.assertEqual(todas[(pai, col)]["forma"], todas[(proximo, chaves[proximo])]["forma"],
                                     (c["tabela"], c["coluna"], pai, col, proximo))
            vistos += 1
        self.assertGreaterEqual(vistos, 20)

    def test_usuario_vem_pelo_login_do_profissional(self):
        # a inscrição no conselho não guarda o login: autor e quem suspendeu vêm por inscrição -> profissional -> usuário
        cadeia = "ref:TBCBOPRO.ID_TBPROFIS>TBPROFIS.ID_TBUSERS>TBUSERS"
        usuario = {c["destino"]: c["via"] for c in self.decl if c["tabela"] == "PRCABEVOL"
                   and c["destino"].endswith("_usuario_id")}
        self.assertEqual(usuario, {"registro_assistencial.autor_usuario_id": cadeia,
                                   "registro_assistencial.suspenso_por_usuario_id": cadeia})
        self.assertNotIn(("TBCBOPRO", "ID_TBUSERS"), {(c["tabela"], c["coluna"]) for c in self.m["colunas"]})

    def test_referencia_pela_coluna_do_destino_do_pai(self):
        # `ref:<PAI>><coluna>`: a coluna existe no destino principal do pai
        for c in self.decl:
            m = re.fullmatch(r"ref:(\w+)>([a-z_]+)", c["via"] or "")
            if m:
                principal = self.tabelas[m.group(1)]["tabelas_destino"].split(";")[0]
                self.assertIn(m.group(2), self.ddl[principal]["colunas"], (c["tabela"], c["coluna"], c["via"]))

    def test_cadeia_da_prescricao_cobre_os_not_null(self):
        for t in l6_12.CADEIA:
            self.assertEqual(len({c["destino"].split(".")[0] for c in self.decl if c["tabela"] == t and c["destino"]}),
                             1, t)

    def test_declaracoes_cobrem_os_not_null_de_todos_os_destinos(self):
        # toda tabela com declaração, cada destino (principal e secundários): NOT NULL sem padrão declarado, ou à
        # espera de um pedido nomeado em saida/L6-12.json (nada falta em silêncio)
        por_dt = {}
        for c in self.decl:
            if c["destino"]:
                dt, dc = c["destino"].split(".")
                por_dt.setdefault((c["tabela"], dt), set()).add(dc)
        self.assertIn(("PRALERGIAPAC", "alergia_paciente_evento"), por_dt)
        faltas = {k: _not_null_sem_padrao(self.ddl[k[1]]["create"]) - cols for k, cols in por_dt.items()}
        self.assertEqual({k: v for k, v in faltas.items() if v}, AGUARDAM_PEDIDO)

    def test_regras_das_anomalias_da_imagem(self):
        self.assertEqual(sentinela.aplicar("booleano_sn", "X")[1], "valor_fora_do_dominio")
        self.assertEqual(sentinela.aplicar("booleano_sn", "S"), (True, None))
        self.assertEqual(sentinela.aplicar("data_hora", datetime.datetime(1899, 12, 30))[1], "data_sentinela")

    def test_imagem_sintetica_com_a_forma_e_sem_esperado(self):
        self.assertFalse(l6_12.ATIVA)
        self.assertEqual(l6_12.DDL.count("CREATE TABLE "), 23)
        for t in l6_12.FORMAS:
            self.assertEqual({c for c, _ in l6_12._colunas(t)}, {c for (tt, c) in self.geradas if tt == t}, t)
        vistos = {}
        esperado = l6_12.linhas(random.Random(1), lambda t, v: vistos.__setitem__(t, vistos.get(t, 0) + 1))
        self.assertEqual(esperado, {})
        self.assertEqual(set(vistos), set(l6_12.FORMAS))


if __name__ == "__main__":
    unittest.main()
