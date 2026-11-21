"""Fatia L5-11 (cadastros e administração, módulo RH): declarações e plano da carga dirigida pelo mapa.
Só metadado do mapa e do DDL do modelo; dados só da imagem SINTÉTICA (sintetica_d/l5_11.py)."""
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l5_11

DECLARADAS = {"FPVACINA", "POTPCONTTEMP", "PEPERIOD_JUSTIF", "PETP_MOVIM", "POCLASSIFMARC", "POTPTRABFOLGA",
              "POTPHORA", "PETPINTERVALO", "POREPHOMOLOGADO", "FPVALE"}
# rodada 5 (ADR 0006): listas fixas sem prova possível entram como listas do hospital (parametro_opcao sob
# parametro_definicao migracao.<lista>); a configuração do ponto (PEPARAM) entra inteira como parâmetro json
LISTAS = {"POPROGSIT", "POPROSITUACAO", "POBANCOHRTP", "PETP_INTEGR_EVENTO"}
DECLARADAS = DECLARADAS | LISTAS | {"PEPARAM"}
# classificador NOT NULL sem fonte na origem: literal presumido (=~), com pendência valor_presumido por linha
PRESUMIDOS = {"PEPERIOD_JUSTIF": ("abrangencia_justificativa", "abrangencia"),
              "PETP_MOVIM": ("tipo_movimento_ponto", "natureza"),
              "POCLASSIFMARC": ("classificacao_marcacao", "sentido"),
              "POTPTRABFOLGA": ("regime_jornada", "tipo_regime"),
              "POTPHORA": ("tipo_hora", "natureza"),
              "PETPINTERVALO": ("tipo_intervalo", "categoria"),
              "POREPHOMOLOGADO": ("tipo_relogio_ponto", "categoria_portaria"),
              "FPVALE": ("beneficio", "tipo")}
# descarte de produto (declarado/sem_carga.tsv): domínio de CHECK no consumidor, catálogo oficial, parâmetro
SEM_CARGA = {"FPTP_SAL", "FPTP_TREINAMENTO_CAPACITACAO", "STEMITENTE", "PODIA", "POTPINIBANCO", "POTPJORNADA"}
# BLOQUEADAS com pedido (sem_carga.tsv `bloqueada`): parâmetros do ponto sem definição no produto; listas legais do
# eSocial até o item do hospital (pedido r5-1 da L5-07)
BLOQUEADAS = {"POTPJORNADA", "FPTP_SAL", "FPTP_TREINAMENTO_CAPACITACAO", "STEMITENTE"}


def _raiz():
    return Path("/app") if Path("/app/db/migracoes").exists() else mapa.RAIZ


class FatiaL511(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.decl = [c for c in cls.m["colunas_decl"] if c["_arquivo"].endswith("L5-11.tsv")]
        cls.ddl = mapa.ler_ddl(_raiz())

    def test_fatia_inteira_classificada(self):
        # a fatia é contígua na ordem do lote e do módulo (a numeração muda quando o gerador ganha dependências)
        esperado = DECLARADAS | SEM_CARGA
        por = {r["tabela"]: r for r in self.m["tabelas"]}
        ords = [int(por[t]["ordem"]) for t in esperado]
        mods = {(por[t]["lote"], por[t]["modulo"]) for t in esperado}
        fatia = {r["tabela"] for r in self.m["tabelas"] if r.get("ordem", "").isdigit()
                 and min(ords) <= int(r["ordem"]) <= max(ords) and (r["lote"], r["modulo"]) in mods}
        self.assertEqual(fatia, esperado)

    def test_plano_so_com_as_declaradas(self):
        p = carga_mapa.planejar(self.m, DECLARADAS | SEM_CARGA)
        self.assertEqual({x["tabela"] for x in p}, DECLARADAS)
        for x in p:
            if x["tabela"] in LISTAS:
                self.assertEqual(x["destinos"][0], "parametro_opcao", x["tabela"])
            elif x["tabela"] == "PEPARAM":
                self.assertEqual(x["destinos"][0], "parametro_definicao")
            else:
                self.assertEqual(len(x["destinos"]), 1, x["tabela"])  # destino secundário do mapa não é usado

    def test_colunas_existem_no_ddl_e_regra_valida(self):
        self.assertEqual({c["tabela"] for c in self.decl}, DECLARADAS)
        for c in self.decl:
            if not c["destino"]:  # SEM DESTINO, declarada (PEPARAM: parâmetro sem definição no produto)
                continue
            t, col = c["destino"].split(".")
            self.assertIn(col, self.ddl[t]["colunas"], c["destino"])
            if c["regra"]:
                sentinela.aplicar(c["regra"], None)  # regra conhecida (também as parametrizadas)
            self.assertNotEqual(c["regra"], "chave_origem")  # chave própria vira código, não referência
            if c["destino"].endswith(".codigo") and not c["destino"].startswith("modulo_sistema"):
                self.assertEqual(c["regra"], "texto", c["destino"])  # VARCHAR no destino: soma de controle igual

    def test_literal_so_presumido_e_dentro_do_check(self):
        """Literal só como presumido (=~), em classificador sem fonte, com valor aceito pelo CHECK do destino."""
        lits = [c for c in self.decl if c["coluna"].startswith("=") and c["tabela"] not in LISTAS | {"PEPARAM"}]  # nível fixo
        self.assertTrue(all(c["coluna"].startswith("=~") for c in lits))
        for t, (dt, col) in PRESUMIDOS.items():
            c = next(x for x in lits if x["tabela"] == t and x["destino"] == "%s.%s" % (dt, col))
            chk = next(x for x in self.ddl[dt]["create"].splitlines() if (col + " IN") in x)
            self.assertIn("'%s'" % c["coluna"][2:], chk, t)
        carga = next(c for c in lits if c["destino"] == "regime_jornada.carga_semanal_minutos")
        self.assertTrue(0 < int(carga["coluna"][2:]) <= 4320)

    def test_limite_semanal_fora_da_faixa_tem_caso_zero(self):
        self.assertIn("(5, 0)", Path(l5_11.__file__).read_text())
        c = next(x for x in self.decl if x["destino"] == "tipo_contrato_temporario.limite_horas_semanais")
        self.assertEqual(c["regra"], "faixa:1,44")
        self.assertEqual(sentinela.aplicar(c["regra"], 0), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar(c["regra"], 44), (44, None))

    def test_sem_carga_declarado_como_descarte(self):
        sc = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        self.assertEqual(sorted(SEM_CARGA - set(sc)), [])
        self.assertEqual(sorted(DECLARADAS & set(sc)), [])  # tabela carregada não fica também como descarte
        for t in SEM_CARGA & set(sc):
            self.assertEqual(sc[t]["situacao"], "bloqueada" if t in BLOQUEADAS else "descarte", t)
        # rodada 5: a configuração do ponto carrega inteira (retrato JSON de todas as colunas), uma definição por
        # empresa, até as definições pessoas.ponto.* do produto existirem (pedido em saida/L5-11.json)
        cs = {c["destino"]: c["coluna"] for c in self.decl if c["tabela"] == "PEPARAM"}
        self.assertEqual(cs["parametro_definicao.valor_padrao"], "#retrato:*")
        self.assertTrue(cs["parametro_definicao.chave"].startswith("#codigo_derivado:COD_EMP:"))
        self.assertFalse([c for c in self.decl if c["tabela"] == "PEPARAM" and c["coluna"][:1] != "="
                              and "ponto." in c["coluna"]])   # nenhuma chave de definição inventada

    def test_vale_com_codigo_prefixado(self):
        """FPVALE grava em beneficio(codigo) com o prefixo v; o tipo de vale (FPTPVALE) virou descarte de domínio do
        produto na rodada 2 (L5-10) e não grava mais código no mesmo cadastro."""
        c = next(x for x in self.decl if x["destino"] == "beneficio.codigo")
        self.assertEqual(c["coluna"], "#codigo_derivado:ID:30:v")
        pai = [x for x in self.m["colunas_decl"] if x["tabela"] == "FPTPVALE" and x["destino"] == "beneficio.codigo"]
        sc = {r["tabela"]: r for r in mapa.ler_tsv(mapa.DIR_PACOTE / "declarado/sem_carga.tsv")}
        # o tipo de vale (FPTPVALE, L5-10) não grava código sem prefixo no mesmo cadastro (situação dela é da L5-10)
        self.assertTrue(pai == [] and sc["FPTPVALE"]["situacao"] in ("descarte", "bloqueada")
                        or [x["coluna"] for x in pai] == ["ID"])

    def test_sintetica_cobre_as_declaradas(self):
        self.assertEqual(set(re.findall(r"CREATE TABLE (\w+)", l5_11.DDL)), DECLARADAS | set(l5_11.PROVADAS))
        for c in self.decl:
            if c["coluna"][:1] in "=@#":
                arg = c["coluna"].split(":")[1] if c["coluna"].startswith("#") and ":" in c["coluna"] else ""
                if re.fullmatch(r"[A-Z0-9_]+", arg):
                    self.assertRegex(l5_11.DDL, r"CREATE TABLE %s \((?s:.*?)\b%s\b" % (c["tabela"], arg))
                continue
            ddl_t = re.search(r"CREATE TABLE %s \((.*?)\);" % c["tabela"], l5_11.DDL, re.S).group(1)
            self.assertRegex(ddl_t, r"\b%s\b" % c["coluna"])


    def test_prova_das_listas_fixas(self):
        """Lista fixa descartada só COM prova derivado (ADR 0006, 1): código e rótulo; cada valor equivalente está no
        CHECK do domínio do produto (DDL do modelo)."""
        import glob, pathlib, re
        raiz = pathlib.Path("/app") if pathlib.Path("/app/db/migracoes").exists() else mapa.RAIZ
        pv = {x["tabela"]: x for x in mapa.carregar_execucao().get("provas") or []}
        sqls = "\n".join(open(f, encoding="utf-8").read() for f in glob.glob(str(raiz / "db/migracoes/*/*.sql")))
        for t, ck in {'PODIA': 'ck_horario_jornada_dia', 'POTPINIBANCO': 'ck_regra_banco_horas_criterio'}.items():
            self.assertEqual((pv[t]["tipo"], pv[t]["chave"], [v[0] for v in pv[t]["valores"]]), ("derivado", ["ID"], ["ID", "NOME"]))
            m = re.search(r"CONSTRAINT %s CHECK \((.*?)\),?\n" % ck, sqls)
            self.assertTrue(m, ck)
            vals = re.findall(r"'(\w+)' AS valor_produto", pv[t]["sql"])
            self.assertTrue(vals, t)
            for v in vals:
                self.assertIn("'%s'" % v, m.group(1), (t, v))


if __name__ == "__main__":
    unittest.main()
