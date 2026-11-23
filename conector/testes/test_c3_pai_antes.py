"""C3 (F4 liberação, 2026-11-22): a inscrição no conselho (TBCBOPRO) não gravou nenhuma linha pelo mapa. A coluna
NOT NULL inscricao_conselho.profissional_id vem do profissional pela referência encadeada
`ref:TBCBOPRO>ID_TBPROFIS>TBPROFIS`, mas o ciclo (TBCBOPRO, TBFORNEC, TBPROFIS, TBUNIDAD) estava quebrado em
TBCBOPRO>TBPROFIS: a inscrição vinha ANTES do profissional (ordem 54 contra 798). Sem poder adiar (a coluna é NOT NULL,
fora das duas fases), toda linha dava pai_inexistente e depois 1048, com cascata no credenciamento, na lotação e na
especialidade do profissional. Não era o fork: com 1 ou N gravadores o pai simplesmente não estava carregado.

Causa corrigida no mapa (quebra invertida para TBPROFIS>TBCBOPRO em declarado/ciclos.tsv, pedido L5-04) e as
arestas que faltavam para referências por passos (declarado/dependencias.tsv). Este teste reproduz a causa com um mapa
sintético (ordem e ondas dos gravadores) e guarda a invariante no mapa real: toda referência a uma tabela que carrega
DEPOIS precisa ser adiável (duas fases) e o destino aceitar NULL; senão a linha daria pai_inexistente sempre."""
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, paralelo


def _tab(t, ordem, chave="ID"):
    return {"tabela": t, "tabelas_destino": t.lower(), "ordem": str(ordem), "chave": chave}


def _col(t, coluna, destino, via=""):
    return {"tabela": t, "coluna": coluna, "destino": destino, "via": via, "regra": "", "depara": ""}


def _mapa_sintetico(quebra):
    """Inscrição (INSC) e profissional (PROF) em ciclo: INSC.ID_PROF (NOT NULL no destino, pela encadeada pela própria
    linha) e PROF.ID_INSC_RESP (sem coluna declarada). Ordem pelo mapa.ordenar com a quebra dada."""
    arestas = {("INSC", "PROF"), ("PROF", "INSC")}
    ordem, ciclos = mapa.ordenar(["INSC", "PROF"], arestas, {quebra}, lambda n: (0, n))
    assert not ciclos
    m = {"tabelas": [_tab(t, i) for i, t in enumerate(ordem, 1)],
         "deps": [{"tabela": f, "depende_de": p, "quebra": "duas_fases" if (f, p) == quebra else ""}
                  for f, p in sorted(arestas)],
         "colunas": [],
         "colunas_decl": [_col("INSC", "ID", "insc.profissional_id", "ref:INSC>ID_PROF>PROF"),
                          _col("INSC", "COD", "insc.numero"), _col("PROF", "NOME", "prof.nome")]}
    return m


_DDL = {"insc": {"create": "CREATE TABLE insc (\n  id BIGINT NOT NULL,\n  profissional_id BIGINT NOT NULL,\n"
                           "  numero VARCHAR(20) NULL\n);", "alter": []}}


def _refs_para_depois(plano, ddl):
    """[(tabela, destino.coluna, pai, motivo)]: referência a pai que carrega depois e que a carga não pode adiar (fora
    das duas fases) ou adia para coluna NOT NULL (o INSERT sem ela é recusado)."""
    pos = {p["tabela"]: i for i, p in enumerate(plano)}
    ruins = []
    for p in plano:
        for dt, cs in p["colunas"].items():
            for c in cs:
                ps = c.get("passos")
                if ps:
                    if "tabela" not in ps[-1]:
                        continue
                    pai, adia = ps[-1]["tabela"], carga_mapa._passos_em_duas_fases(c, p)
                elif c.get("regra") == "chave_origem" and c.get("referencia") and not carga_mapa._especial(c["coluna"]):
                    pai, adia = c["referencia"], c["referencia"] in p["duas_fases"]
                else:
                    continue
                if pai == p["tabela"] or pai not in pos or pos[pai] < pos[p["tabela"]]:
                    continue
                if not adia:
                    ruins.append((p["tabela"], "%s.%s" % (dt, c["destino"]), pai, "pai_inexistente"))
                elif _not_null(ddl, dt, c["destino"]):
                    ruins.append((p["tabela"], "%s.%s" % (dt, c["destino"]), pai, "duas_fases_em_not_null"))
    return sorted(set(ruins))


def _not_null(ddl, tabela, coluna):
    x = (ddl or {}).get(tabela)
    if not x:
        return False
    ultima = None
    for txt in [x["create"]] + x["alter"]:
        for m in re.finditer(r"(?:^|\b(?:ADD|MODIFY) COLUMN (?:IF NOT EXISTS )?)\s*`?%s`?\s+\w+[^\n]*" % re.escape(coluna),
                             txt, re.M):
            ultima = m.group(0)
    return bool(ultima) and "NOT NULL" in ultima.upper()


class Sintetico(unittest.TestCase):
    def test_quebra_antiga_poe_o_filho_antes_do_pai(self):
        """A causa: quebrada no filho (INSC>PROF), a inscrição vem antes e a encadeada NOT NULL não acha o pai, com
        1 gravador (ordem do plano) e com N (ondas)."""
        m = _mapa_sintetico(("INSC", "PROF"))
        plano = carga_mapa.planejar(m, {"INSC", "PROF"}, excluir=frozenset())
        self.assertEqual([p["tabela"] for p in plano], ["INSC", "PROF"])
        # a encadeada termina em PROF, que está nas duas fases de INSC, mas a coluna é NOT NULL: a carga não adia
        # (pode_adiar pela nulidade do destino) e procura o pai já gravado, que não existe
        self.assertEqual(_refs_para_depois(plano, _DDL), [("INSC", "insc.profissional_id", "PROF", "duas_fases_em_not_null")])
        ond = paralelo.ondas(plano, m)
        self.assertEqual(ond, [[0], [1]])  # N gravadores: INSC numa onda antes do PROF

    def test_quebra_invertida_carrega_o_pai_antes(self):
        m = _mapa_sintetico(("PROF", "INSC"))
        plano = carga_mapa.planejar(m, {"INSC", "PROF"}, excluir=frozenset())
        self.assertEqual([p["tabela"] for p in plano], ["PROF", "INSC"])
        self.assertEqual(_refs_para_depois(plano, _DDL), [])
        ond = paralelo.ondas(plano, m)
        w = {plano[i]["tabela"]: k for k, o in enumerate(ond) for i in o}
        self.assertLess(w["PROF"], w["INSC"])  # gravadores: o profissional termina numa onda anterior

    def test_not_null_pelo_ddl(self):
        ddl = {"insc": dict(_DDL["insc"], alter=[])}
        self.assertTrue(_not_null(ddl, "insc", "profissional_id"))
        self.assertFalse(_not_null(ddl, "insc", "numero"))
        ddl["insc"]["alter"].append("ALTER TABLE insc MODIFY COLUMN profissional_id BIGINT NULL;")
        self.assertFalse(_not_null(ddl, "insc", "profissional_id"))


class MapaReal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = carga_mapa.planejar(cls.m, {r["tabela"] for r in cls.m["tabelas"]})
        # No container o modelo está em /app/db/migracoes (mapa.RAIZ resolve para "/", sem DDL): sem a raiz certa o
        # DDL vinha vazio, a checagem de NOT NULL falhava e a invariante das referências passava sem olhar nada.
        raiz = Path("/app") if Path("/app/db/migracoes").is_dir() else mapa.RAIZ
        cls.ddl = mapa.ler_ddl(raiz)

    def test_ddl_do_modelo_lido(self):
        self.assertIn("inscricao_conselho", self.ddl)
        self.assertGreater(len(self.ddl), 100)

    def test_profissional_antes_da_inscricao_e_dos_filhos(self):
        pos = {p["tabela"]: i for i, p in enumerate(self.plano)}
        for t in ("TBCBOPRO", "TBCBOPRO_TBCONVEN", "TBCBOPRO_TBUNIDAD", "TBMEDESP"):
            self.assertLess(pos["TBPROFIS"], pos[t], t)
        self.assertLess(pos["TBCBOPRO"], pos["TBCBOPRO_TBCONVEN"])
        insc = {c["destino"]: c for c in self.plano[pos["TBCBOPRO"]]["colunas"]["inscricao_conselho"]}
        self.assertFalse(carga_mapa._passos_em_duas_fases(insc["profissional_id"], self.plano[pos["TBCBOPRO"]]))
        self.assertTrue(_not_null(self.ddl, "inscricao_conselho", "profissional_id"))

    def test_ondas_dos_gravadores(self):
        ond = paralelo.ondas(self.plano, self.m)
        w = {self.plano[i]["tabela"]: k for k, o in enumerate(ond) for i in o}
        for t in ("TBCBOPRO", "TBCBOPRO_TBCONVEN", "TBCBOPRO_TBUNIDAD", "TBMEDESP"):
            self.assertLess(w["TBPROFIS"], w[t], t)

    def test_nenhuma_referencia_a_pai_que_carrega_depois(self):
        self.assertEqual(_refs_para_depois(self.plano, self.ddl), [])


if __name__ == "__main__":
    unittest.main()
