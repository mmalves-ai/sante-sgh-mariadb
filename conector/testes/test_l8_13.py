"""Fatia L8-13 (operadora de planos: domínios): declarações, literais presumidos dentro do CHECK do destino, regras
das colunas e coerência da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em
`conector.sh conferir-fatia L8-13`."""
import random
import re
import unittest
from pathlib import Path

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l8_13

RAIZ = Path(__file__).resolve().parents[1]  # /app no container (db/migracoes montado só leitura)
CARREGADAS = set(l8_13.CARREGADAS)
NA_IMAGEM = CARREGADAS | set(l8_13.NAO_CARREGADAS)
DESTINO = {"CDSTATUSCAD": "situacao_cadastral_beneficiario", "CDACOMODTIPO": "tipo_acomodacao_plano", "CDDIAVENCCOB": "dia_vencimento_permitido",
           "CDGUIASTATUS": "situacao_guia_plano", "CDINCIDECOMIS": "incidencia_comissao",
           "CDMOTIVOBAIXA": "motivo_cancelamento_contrato", "CDMOTIVOSOLCART": "motivo_solicitacao_cartao",
           "CDORIGEMCOBR": "origem_cobranca_plano",
           "CDORIGEMGUIA": "origem_guia_plano", "CDPGTOBALCAOCP": "forma_pagamento_coparticipacao",
           "CDPLANOCLASSIF": "classificacao_plano", "CDMSGCOBRANCA": "mensagem_cobranca",
           "CDMOTMOVIMCAD": "motivo_movimento_cadastral", "CDSTATUSSOLCART": "situacao_solicitacao_cartao",
           "CDTPACUMULPOR": "nivel_acumulo_limite", "CDTPCOBRANCA": "forma_cobranca_plano",
           "CDTPCONTRATO": "tipo_contrato_plano"}


def _ddl_destino():
    """{tabela: texto do CREATE TABLE} do módulo da operadora no modelo."""
    out = {}
    for f in sorted((RAIZ / "db/migracoes/16_SGO").glob("*.sql")):
        for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\)", f.read_text(encoding="utf-8"), re.S):
            out[m.group(1)] = m.group(2)
    return out


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, NA_IMAGEM)}
        cls.ddl = _ddl_destino()

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][DESTINO[t]]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), CARREGADAS)
        for t, dt in DESTINO.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_nao_carregadas_sao_descarte_de_produto(self):
        # listas fixas que no modelo são domínio (CHECK) ou atributo: descarte com causa de produto, sem declaração
        sem = {r["tabela"]: r for r in mapa.ler_tsv(RAIZ / "mapa/declarado/sem_carga.tsv")}
        for t in l8_13.NAO_CARREGADAS:
            self.assertFalse([c for c in self.mapa["colunas_decl"] if c["tabela"] == t and c.get("destino")], t)
            self.assertEqual((sem[t]["situacao"], sem[t]["causa"]), ("descarte", "mecanismo_do_produto"), t)
            self.assertTrue(sem[t]["motivo"].startswith("L8-13:"), t)

    def test_mensagem_vigencia_da_carga(self):
        c = self.cols("CDMSGCOBRANCA")
        self.assertEqual(c["vigencia_inicio"]["coluna"], "@vigencia_carga")
        self.assertEqual(c["prioridade"]["regra"], "inteiro_zero_nulo")
        self.assertEqual(c["posicao"]["coluna"], "=~instrucao_boleto")
        # nenhuma data fictícia
        texto = (RAIZ / "mapa/declarado/colunas.d/L8-13.tsv").read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"=~?\d{4}-\d{2}-\d{2}", texto))

    def test_dominio_fixo_com_prefixo(self):
        # destino de código único que também recebe linhas cadastradas pelo cliente (outras fatias)
        for t in ("CDORIGEMCOBR", "CDORIGEMGUIA", "CDMOTMOVIMCAD", "CDTPACUMULPOR"):
            c = self.cols(t)["codigo"]
            self.assertEqual(c["depara"], "valores", t)
            self.assertEqual(c["valores"], {str(n): "sistema-%d" % n for n in range(100)}, t)

    def test_situacao_cadastral_carregada_e_tipo_presumido(self):
        # a situação cadastral do beneficiário é carregada no destino do mapa; o tipo do movimento não tem evidência
        # na origem: literal presumido, sem de-para por código inventado
        s = self.cols("CDSTATUSCAD")
        self.assertEqual((s["codigo"]["coluna"], s["descricao"]["coluna"]), ("ID", "NOME"))
        c = self.cols("CDMOTMOVIMCAD")["tipo_movimento"]
        self.assertEqual(c["coluna"], "=~alteracao")
        self.assertFalse(c.get("valores"))
        decl = [l for l in (RAIZ / "mapa/declarado/valores.d/L8-13.tsv").read_text(encoding="utf-8").splitlines()
                if "tipo_movimento" in l]
        self.assertEqual(decl, [])

    def test_categoria_regulatoria_reclassificacao_obrigatoria(self):
        for t in ("CDPLANOCLASSIF", "CDTPCONTRATO"):
            c = self.cols(t)["tipo_contratacao"]
            self.assertTrue(c["coluna"].startswith("=~"), t)
            self.assertFalse(c.get("valores"), t)
        texto = (RAIZ / "mapa/declarado/colunas.d/L8-13.tsv").read_text(encoding="utf-8")
        self.assertEqual(texto.count("RECLASSIFICAÇÃO OBRIGATÓRIA"), 2)

    def test_obrigatorias_sem_padrao_cobertas(self):
        for t, dt in DESTINO.items():
            corpo = self.ddl[dt]
            obrig = {m.group(1) for m in re.finditer(r"^\s*(\w+)\s+[^\n]*?NOT NULL(?![^\n]*DEFAULT)", corpo, re.M)}
            obrig -= {"id", "criado_em"}
            self.assertTrue(obrig <= set(self.cols(t)), "%s: %s" % (t, sorted(obrig - set(self.cols(t)))))

    def test_literais_dentro_do_check(self):
        for t, dt in DESTINO.items():
            for dc, c in self.cols(t).items():
                if not c["coluna"].startswith("="):
                    continue
                v = c["coluna"].lstrip("=~")
                m = re.search(r"CHECK \(%s IN \(([^)]*)\)\)" % dc, self.ddl[dt])
                if m:
                    self.assertIn("'%s'" % v, m.group(1), "%s.%s" % (dt, dc))

    def test_regras_das_colunas(self):
        self.assertEqual(self.cols("CDACOMODTIPO")["codigo"]["regra"], "texto")
        self.assertEqual(sentinela.aplicar("texto", 12), ("12", None))
        self.assertEqual([c["coluna"] for c in self.cols("CDMOTMOVIMCAD").values() if c["coluna"].startswith("=")],
                         ["=~alteracao"])
        self.assertEqual(sentinela.aplicar("texto_nome", "  Quarto   exemplo  B "), ("Quarto exemplo B", None))
        d = self.cols("CDDIAVENCCOB")
        self.assertEqual((d["dia"]["regra"], d["ativo"]["regra"]), ("inteiro", "booleano_sn"))
        self.assertEqual(sentinela.aplicar("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(sentinela.aplicar("inteiro_zero_nulo", 0)[0], None)  # prioridade planejada da mensagem

    def test_presumidos_marcados(self):
        for t in ("CDACOMODTIPO", "CDINCIDECOMIS", "CDMOTIVOBAIXA", "CDORIGEMCOBR", "CDORIGEMGUIA",
                  "CDPGTOBALCAOCP", "CDPLANOCLASSIF", "CDMOTMOVIMCAD", "CDTPACUMULPOR", "CDTPCOBRANCA", "CDTPCONTRATO", "CDMSGCOBRANCA"):
            self.assertTrue([c for c in self.cols(t).values() if c["coluna"].startswith("=~")], t)


class Imagem(unittest.TestCase):
    def test_coerencia(self):
        lidas = {}
        esp = l8_13.linhas(random.Random(1), lambda t, v: lidas.setdefault(t, []).append(v))
        self.assertEqual(set(lidas), NA_IMAGEM)
        self.assertEqual(set(esp), CARREGADAS)
        for t, e in esp.items():
            self.assertEqual(e["gravados"] + sum(n for r, n in e["pendencias"].items() if r.startswith("restricao_")),
                             len(lidas[t]), t)
        criadas = set(re.findall(r"CREATE TABLE (\w+)", l8_13.DDL))
        self.assertEqual(criadas, NA_IMAGEM)
