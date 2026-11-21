"""Fatia L6-16 (prontuário, assinatura e assistência, módulo CC): declarações planejadas, regras das colunas e coerência
da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia
L6-16`."""
import random
import unittest

from sante_conector import carga_mapa, mapa, sentinela
from sante_conector.sintetica_d import l6_16

TABELAS = set(l6_16.CARREGADAS)
NA_IMAGEM = TABELAS | set(l6_16.NAO_CARREGADAS) | set(l6_16.PAIS_ORIGEM)
DESTINOS = {
    "CCPARAM": "configuracao_usuario_bloco", "CCTIPOLOCALBLC": "local_bloco",
    "CCTIPOMOVIMENTACAOPAC": "tipo_movimento_bloco", "CCTPURGENCIA": "carater_cirurgia",
    "PRFA_CAD_MODO_RESPIR": "modo_ventilatorio", "PRFA_CAD_POSICAO_CIR": "posicao_cirurgica",
    "PRFA_TIPO_SINAL": "tipo_sinal_monitorado", "PRTIPO_PROFISSIONAL": "funcao_equipe_cirurgica",
    "TBANESTESIA": "tipo_anestesia", "CCAGENDA_EXC_CANC": "registro_excluido"}
CADASTROS = set(DESTINOS) - {"CCPARAM", "CCAGENDA_EXC_CANC"}
# colunas NOT NULL sem padrão de cada destino (fora id e auditoria): todas têm de vir declaradas
OBRIGATORIAS = {
    "configuracao_usuario_bloco": {"estabelecimento_id", "usuario_id"},
    "local_bloco": {"codigo", "descricao", "etapa_painel"}, "tipo_movimento_bloco": {"codigo", "descricao", "efeito"},
    "carater_cirurgia": {"codigo", "descricao"}, "modo_ventilatorio": {"codigo", "descricao"},
    "posicao_cirurgica": {"codigo", "descricao"}, "tipo_sinal_monitorado": {"codigo", "descricao", "sigla"},
    "funcao_equipe_cirurgica": {"codigo", "descricao"}, "tipo_anestesia": {"codigo", "descricao"},
    "registro_excluido": {"estabelecimento_id", "entidade", "entidade_id", "operacao", "justificativa", "dados",
                          "ocorrido_em", "usuario_id"}}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, NA_IMAGEM)}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][DESTINOS[t]]}

    def test_tabelas_e_destinos(self):
        self.assertEqual(set(self.plano), TABELAS)
        for t, dt in DESTINOS.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)

    def test_obrigatorias_do_destino_cobertas(self):
        for t, dt in DESTINOS.items():
            self.assertTrue(OBRIGATORIAS[dt] <= set(self.cols(t)), t)

    def test_agenda_excluida_vira_registro_excluido(self):
        p = self.cols("CCAGENDA_EXC_CANC")
        self.assertEqual(p["entidade"]["coluna"], "=agendamento_cirurgico")
        self.assertEqual(p["operacao"]["coluna"], "=~exclusao")
        self.assertEqual(p["dados"]["coluna"], "#retrato")
        self.assertEqual(p["entidade_id"]["coluna"], "ID")
        self.assertEqual(p["paciente_id"]["referencia"], "RICADPAC.PRONT")
        self.assertEqual(p["atendimento_id"]["referencia"], "RECADATE")
        self.assertEqual(p["usuario_id"]["referencia"], "TBUSERS")
        self.assertEqual(p["ocorrido_em"]["regra"], "data_hora")
        self.assertEqual(p["estabelecimento_id"]["coluna"], "@estabelecimento")

    def test_sem_carga_com_motivo_e_pedido(self):
        from pathlib import Path
        arq = Path(mapa.__file__).resolve().parents[1] / "mapa/declarado/colunas.d/L6-16.tsv"
        coment = {}
        for linha in arq.read_text(encoding="utf-8").splitlines():
            if linha.startswith("#"):
                coment[linha[1:].split("\t")[0]] = linha
        # cada tabela sem carga tem a linha comentada com o motivo e o pedido (declaração pronta em saida/L6-16.json)
        self.assertEqual(set(coment), set(l6_16.NAO_CARREGADAS))
        for t, linha in coment.items():
            self.assertIn("saida/L6-16.json", linha, t)

    def test_nao_carregadas_sem_declaracao(self):
        decl = {c["tabela"] for c in self.mapa["colunas_decl"]}
        for t in l6_16.NAO_CARREGADAS:
            self.assertNotIn(t, decl, t)

    def test_usuario_pelo_login_e_estabelecimento_unico(self):
        p = self.cols("CCPARAM")
        self.assertEqual(p["usuario_id"]["referencia"], "TBUSERS")
        self.assertEqual(p["usuario_id"]["regra"], "chave_origem")
        self.assertEqual(p["estabelecimento_id"]["coluna"], "@estabelecimento")
        for dc in ("pode_ver_mapa_salas", "pode_alterar_agendamento", "pode_cancelar_agendamento",
                   "pode_registrar_cirurgia", "pode_lancar_opme"):
            self.assertEqual(p[dc]["regra"], "booleano_sn", dc)

    def test_permissoes_do_agendamento(self):
        decl = {c["coluna"]: c for c in self.mapa["colunas_decl"] if c["tabela"] == "CCPARAM"}
        p = self.cols("CCPARAM")
        # desagendar (tirar da agenda com situação) é o cancelamento do produto; excluir não tem par (o produto não apaga)
        self.assertEqual(p["pode_cancelar_agendamento"]["coluna"], "PERMITIR_DESAGENDAR")
        self.assertEqual(p["pode_ver_mapa_salas"]["coluna"], "CON_AGE")
        # a origem não controla quem cria: FALSE presumido, nunca concedido sem decisão do cliente
        self.assertEqual(p["pode_criar_agendamento"]["coluna"], "=~0")
        for c in ("PERMITIR_EXCLUIR_AGENDAMENTO", "PERMITIR_ATENDER_AGENDAMENTO", "DIG_RESER"):
            self.assertFalse(decl[c]["destino"], c)
        # toda coluna da origem tem declaração com motivo (aproveitada ou descartada)
        for nome, _, _ in l6_16.colunas("CCPARAM"):
            self.assertIn(nome, decl, nome)
            self.assertTrue(decl[nome]["motivo"].strip(), nome)

    def test_codigo_texto_booleanos_e_presumidos(self):
        for t in CADASTROS:
            c = self.cols(t)
            self.assertEqual(c["codigo"]["regra"], "texto", t)
            self.assertEqual(c["ativo"]["regra"], "booleano_sn", t)
        presumidos = {"CCTIPOLOCALBLC": "etapa_painel", "CCTIPOMOVIMENTACAOPAC": "efeito"}
        for t, dc in presumidos.items():
            self.assertTrue(self.cols(t)[dc]["coluna"].startswith("=~"), t)
        # natureza e grupo pelo NOME (de-para de valores), nunca um literal único para todas as linhas
        for t, dc in (("CCTPURGENCIA", "natureza"), ("TBANESTESIA", "grupo")):
            c = self.cols(t)[dc]
            self.assertEqual((c["coluna"], c["depara"]), ("NOME", "valores"), t)

    def _valor(self, t, dc, raw):
        """Valor que o motor grava (mesmo caminho de CargaMapa._converter: regra e de-para de valores)."""
        cm = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
        cm.subtipo = {}
        pend = []
        x, recusa, _ = cm._converter(t, "1", self.plano[t], {}, self.cols(t)[dc], raw, pend)
        self.assertIsNone(recusa)
        return carga_mapa.tipar(x, "tinyint" if dc.startswith("pode_") else "varchar"), [p[0] for p in pend]

    def test_valor_gravado_nos_casos_de_anomalia(self):
        # permissão ausente ou nula é NEGADA (nunca o padrão TRUE de pode_ver_mapa_salas)
        for dc in ("pode_ver_mapa_salas", "pode_alterar_agendamento", "pode_cancelar_agendamento",
                   "pode_reservar_sala", "pode_registrar_cirurgia", "pode_lancar_consumo", "pode_lancar_opme",
                   "pode_registrar_dados_ccih"):
            self.assertEqual(self._valor("CCPARAM", dc, None), (0, []), dc)
            self.assertEqual(self._valor("CCPARAM", dc, "S"), (1, []), dc)
            self.assertEqual(self._valor("CCPARAM", dc, "N"), (0, []), dc)
        self.assertEqual(self._valor("CCPARAM", "pode_ver_mapa_salas", "X"), (None, ["valor_fora_do_dominio"]))
        nat = lambda n: self._valor("CCTPURGENCIA", "natureza", n.encode("cp1252"))
        self.assertEqual(nat("ELETIVA"), ("eletiva", []))
        self.assertEqual(nat("Urgência"), ("urgencia", []))
        self.assertEqual(nat("EMERGÊNCIA"), ("emergencia", []))
        self.assertEqual(nat("Caráter exemplo"), (None, ["valor_fora_do_dominio"]))
        grp = lambda n: self._valor("TBANESTESIA", "grupo", n.encode("cp1252"))
        self.assertEqual(grp("GERAL"), ("geral", []))
        self.assertEqual(grp("Raquidiana"), ("neuraxial", []))
        self.assertEqual(grp("PERIDURAL"), ("neuraxial", []))
        self.assertEqual(grp("Bloqueio"), ("regional", []))
        self.assertEqual(grp("Sedação"), ("sedacao", []))
        self.assertEqual(grp("Local"), ("local", []))
        self.assertEqual(grp("GERAL + PERIDURAL"), ("combinada", []))
        self.assertEqual(grp("Técnica exemplo"), (None, ["valor_fora_do_dominio"]))

    def test_colunas_da_agenda_excluida_todas_declaradas(self):
        decl = {c["coluna"]: c for c in self.mapa["colunas_decl"] if c["tabela"] == "CCAGENDA_EXC_CANC"}
        for nome, _, _ in l6_16.colunas("CCAGENDA_EXC_CANC"):
            self.assertIn(nome, decl, nome)
            self.assertTrue(decl[nome]["motivo"].strip(), nome)
        for pessoal in ("PACIENTE", "CPF", "FONE", "E_MAIL_PACIENTE", "DATA_NASCIMENTO"):
            self.assertFalse(decl[pessoal]["destino"], pessoal)

    def test_icone_fora_com_motivo(self):
        self.assertNotIn("icone_arquivo_id", self.cols("PRFA_CAD_POSICAO_CIR"))
        motivos = " ".join(c["motivo"] for c in self.mapa["colunas_decl"] if c["tabela"] == "PRFA_CAD_POSICAO_CIR")
        self.assertIn("arquivo", motivos)


class Regras(unittest.TestCase):
    def test_conversoes_da_fatia(self):
        a = sentinela.aplicar
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("booleano_sn", "N"), (False, None))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("texto_nome", "  Sala   exemplo  ".encode("cp1252")), ("Sala exemplo", None))
        self.assertEqual(a("texto", " Controlado a volume ".encode("cp1252")), ("Controlado a volume", None))
        self.assertEqual(a("texto", 12), ("12", None))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_16.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_casos_pedidos_no_l6_16_json(self):
        # usuário repetido com permissões opostas e CON_AGE nulo ficam na imagem para provar os pedidos
        par = []
        l6_16.linhas(random.Random(1), lambda t, v: par.append(v) if t == "CCPARAM" else None)
        idx = [n for n, _, _ in l6_16.colunas("CCPARAM")].index("CON_AGE")
        a = [v[idx] for v in par if v[0] == "USR_EXEMPLO_A"]
        self.assertEqual(sorted(a), ["N", "S"])
        self.assertIn(None, [v[idx] for v in par if v[0] == "USR_EXEMPLO_E"])

    def test_linhas_com_o_numero_de_colunas_do_ddl(self):
        def conferir(t, v):
            self.assertEqual(len(v), len(l6_16.colunas(t)), t)
        l6_16.linhas(random.Random(1), conferir)

    def test_ddl_so_das_tabelas_da_fatia(self):
        criadas = {l.split()[2] for l in l6_16.DDL.splitlines() if l.startswith("CREATE TABLE")}
        self.assertEqual(criadas, NA_IMAGEM)


if __name__ == "__main__":
    unittest.main()
