"""Fatia L6-16 (prontuário, assinatura e assistência, módulo CC): declarações planejadas, regras das colunas e coerência
da imagem sintética. Sem banco; só valores inventados. A carga e a conciliação rodam em `conector.sh conferir-fatia
L6-16`."""
import decimal
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
# bloco cirúrgico (rodada 3): destinos na ordem da gravação (o primeiro é o principal)
DESTINOS_BLOCO = {
    "CCSALAS": ["sala_cirurgica"], "CCSALAS_TBUSERS": ["permissao_sala_usuario"], "CCCADCIR": ["ato_cirurgico"],
    "CCAGENDA": ["agendamento_cirurgico", "procedimento_cirurgico", "agendamento_cirurgico_procedimento"],
    "CCHISAGE": ["reagendamento_cirurgico"],
    "CCPROEXT": ["agendamento_cirurgico_procedimento", "procedimento_cirurgico"],
    "CCLANCIR": ["ato_cirurgico_procedimento", "procedimento_cirurgico"]}
CADASTROS = set(DESTINOS) - {"CCPARAM", "CCAGENDA_EXC_CANC"}
# colunas NOT NULL sem padrão de cada destino (fora id e auditoria): todas têm de vir declaradas
OBRIGATORIAS = {
    "configuracao_usuario_bloco": {"estabelecimento_id", "usuario_id"},
    "local_bloco": {"codigo", "descricao", "etapa_painel"}, "tipo_movimento_bloco": {"codigo", "descricao", "efeito"},
    "carater_cirurgia": {"codigo", "descricao"}, "modo_ventilatorio": {"codigo", "descricao"},
    "posicao_cirurgica": {"codigo", "descricao"}, "tipo_sinal_monitorado": {"codigo", "descricao", "sigla"},
    "funcao_equipe_cirurgica": {"codigo", "descricao"}, "tipo_anestesia": {"codigo", "descricao"},
    "registro_excluido": {"estabelecimento_id", "entidade", "entidade_id", "operacao", "justificativa", "dados",
                          "ocorrido_em", "usuario_id"},
    "sala_cirurgica": {"estabelecimento_id", "unidade_cirurgica_id", "codigo", "descricao"},
    "permissao_sala_usuario": {"sala_cirurgica_id", "usuario_id"},
    "ato_cirurgico": {"estabelecimento_id", "numero", "atendimento_id", "paciente_id", "sala_cirurgica_id",
                      "carater_cirurgia_id"},
    "agendamento_cirurgico": {"estabelecimento_id", "numero", "paciente_id", "cirurgiao_profissional_id",
                              "carater_cirurgia_id", "solicitado_em"},
    "procedimento_cirurgico": {"codigo", "descricao"},
    "agendamento_cirurgico_procedimento": {"agendamento_cirurgico_id", "sequencia", "procedimento_cirurgico_id"},
    "reagendamento_cirurgico": {"agendamento_cirurgico_id", "operacao", "ocorrido_em", "usuario_id"},
    "ato_cirurgico_procedimento": {"ato_cirurgico_id", "sequencia", "procedimento_cirurgico_id"}}


class Plano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapa = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.mapa, NA_IMAGEM)}

    def cols(self, t):
        return {c["destino"]: c for c in self.plano[t]["colunas"][DESTINOS[t]]}

    def test_tabelas_e_destinos(self):
        # pais de outras fatias na imagem (só para as referências) podem ser planejados pela fatia dona
        self.assertTrue(TABELAS <= set(self.plano))
        self.assertTrue(set(self.plano) - TABELAS <= set(l6_16.PAIS_ORIGEM))
        for t, dt in DESTINOS.items():
            self.assertEqual(self.plano[t]["destinos"], [dt], t)
        for t, dts in DESTINOS_BLOCO.items():
            self.assertEqual(self.plano[t]["destinos"], dts, t)

    def test_obrigatorias_do_destino_cobertas(self):
        for t, dt in DESTINOS.items():
            self.assertTrue(OBRIGATORIAS[dt] <= set(self.cols(t)), t)
        for t, dts in DESTINOS_BLOCO.items():
            for dt in dts:
                decl = {c["destino"] for c in self.plano[t]["colunas"][dt]}
                self.assertTrue(OBRIGATORIAS[dt] <= decl, (t, dt, OBRIGATORIAS[dt] - decl))

    def test_agenda_excluida_vira_registro_excluido(self):
        p = self.cols("CCAGENDA_EXC_CANC")
        self.assertEqual(p["entidade"]["coluna"], "=agendamento_cirurgico")
        self.assertEqual(p["operacao"]["coluna"], "=~exclusao")
        # a identificação informada na agenda fica no retrato (sem prontuário é a única)
        self.assertEqual(p["dados"]["coluna"], "#retrato:*-AXREG_ID_PROCEDURE")
        self.assertEqual(p["entidade_id"]["coluna"], "ID")
        pac = [c["referencia"] for c in self.plano["CCAGENDA_EXC_CANC"]["colunas"]["registro_excluido"]
               if c["destino"] == "paciente_id"]
        self.assertEqual(pac, ["RICADPAC.PRONT", "RICADPAC.CPF"])
        self.assertEqual(p["atendimento_id"]["referencia"], "RECADATE")
        self.assertEqual(p["usuario_id"]["referencia"], "TBUSERS")
        self.assertEqual(p["ocorrido_em"]["regra"], "data_hora")
        self.assertEqual(p["estabelecimento_id"]["coluna"], "@estabelecimento")

    def test_nenhuma_tabela_sem_carga(self):
        from pathlib import Path
        arq = Path(mapa.__file__).resolve().parents[1] / "mapa/declarado/colunas.d/L6-16.tsv"
        self.assertFalse([l for l in arq.read_text(encoding="utf-8").splitlines() if l.startswith("#")])
        self.assertEqual(l6_16.NAO_CARREGADAS, ())

    def test_colunas_do_bloco_todas_declaradas_com_motivo(self):
        for t in DESTINOS_BLOCO:
            decl = {c["coluna"]: c for c in self.mapa["colunas_decl"] if c["tabela"] == t}
            gerado = [c["coluna"] for c in self.mapa["colunas"] if c["tabela"] == t]
            self.assertTrue(gerado, t)
            for nome in gerado:
                self.assertIn(nome, decl, (t, nome))
                self.assertTrue(decl[nome]["motivo"].strip(), (t, nome))

    def test_sala_unidade_unica_e_ato_com_horarios(self):
        p = {c["destino"]: c for c in self.plano["CCSALAS"]["colunas"]["sala_cirurgica"]}
        self.assertEqual(p["unidade_cirurgica_id"]["coluna"], "@unico:unidade_cirurgica")
        a = {}
        for c in self.plano["CCCADCIR"]["colunas"]["ato_cirurgico"]:
            a.setdefault(c["destino"], []).append(c["coluna"])
        self.assertEqual(a["fim_cirurgia_em"], ["#data_hora:DATA,HORA_T,HORA_I"])
        self.assertEqual(a["entrada_sala_em"], ["#data_hora:DATA,HORA_IA", "#data_hora:DATA,HORA_I"])
        self.assertEqual(a["saida_sala_em"], ["#data_hora:DATA,HORA_TA,HORA_IA", "#data_hora:DATA,HORA_T,HORA_I"])
        self.assertEqual(a["situacao"], ["=realizado"])

    def test_agenda_carater_presumido_e_procedimento_principal(self):
        g = {c["destino"]: c for c in self.plano["CCAGENDA"]["colunas"]["agendamento_cirurgico"]
             if c["destino"] != "solicitado_em"}
        self.assertEqual(g["carater_cirurgia_id"]["coluna"], "=~eletiva")
        sit = [c["coluna"] for c in self.plano["CCAGENDA"]["colunas"]["agendamento_cirurgico"]
               if c["destino"] == "situacao"]
        # bloqueio da grade e situação da origem antes do presumido (nunca agendado para o que a origem diz outro);
        # V-D1 (pedido 67): sem situação, 'nao_informada' presumida (neutra, não acionável), nunca agendado
        self.assertEqual(sit, ["HORA_BLOQUEADA", "ID_TBSITAGE", "=~nao_informada"])
        pac = [c["coluna"] for c in self.plano["CCAGENDA"]["colunas"]["agendamento_cirurgico"]
               if c["destino"] == "paciente_id"]
        self.assertEqual(pac, ["PRONT", "CPF"])
        op = self.plano["CCAGENDA"]["opcoes"]
        self.assertTrue(op["procedimento_cirurgico"].get("antes"))
        self.assertTrue(op["procedimento_cirurgico"].get("opcional"))
        self.assertTrue(op["agendamento_cirurgico_procedimento"].get("opcional"))
        for t in ("CCAGENDA", "CCPROEXT", "CCLANCIR"):
            self.assertIn("procedimento_cirurgico", self.plano[t]["destinos"], t)

    def test_justificativa_da_origem_antes_do_texto_fixo(self):
        js = [c["coluna"] for c in self.plano["CCAGENDA_EXC_CANC"]["colunas"]["registro_excluido"]
              if c["destino"] == "justificativa"]
        self.assertEqual(js[0], "JUSTIF")
        self.assertTrue(js[1].startswith("="))

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

    def _valor_de(self, t, dt, col, dc, raw):
        cm = carga_mapa.CargaMapa.__new__(carga_mapa.CargaMapa)
        cm.subtipo = {}
        pend = []
        c = [x for x in self.plano[t]["colunas"][dt] if x["coluna"] == col and x["destino"] == dc][0]
        x, recusa, _ = cm._converter(t, "1", self.plano[t], {}, c, raw, pend)
        self.assertIsNone(recusa)
        return x, [p[0] for p in pend]

    def test_situacao_bloqueio_sangue_e_contaminacao(self):
        sit = lambda col, v: self._valor_de("CCAGENDA", "agendamento_cirurgico", col, "situacao", v)
        for cod, esperado in (("C", "confirmado"), ("A", "confirmado"), ("S", "realizado"), ("N", "nao_informada"),
                              ("R", "agendado"), ("X", "cancelado"), ("F", "cancelado"), ("U", "suspenso"),
                              ("HR", "horario_bloqueado"), ("Q", "horario_bloqueado")):
            self.assertEqual(sit("ID_TBSITAGE", cod), (esperado, []), cod)
        self.assertEqual(sit("ID_TBSITAGE", "ZZ"), (None, ["valor_fora_do_dominio"]))
        self.assertEqual(sit("ID_TBSITAGE", None), (None, []))
        self.assertEqual(sit("HORA_BLOQUEADA", "S"), ("horario_bloqueado", []))
        self.assertEqual(sit("HORA_BLOQUEADA", "N"), (None, []))
        self.assertEqual(sit("HORA_BLOQUEADA", None), (None, []))
        san = lambda v: self._valor_de("CCAGENDA", "agendamento_cirurgico", "QTSAN", "reserva_hemocomponente", v)
        self.assertEqual(san(decimal.Decimal("2.000")), ("1", []))
        self.assertEqual(san(decimal.Decimal("0.000")), (None, []))
        self.assertEqual(san(None), (None, []))
        self.assertEqual(san(decimal.Decimal("0.500")), (None, ["valor_fora_do_dominio"]))
        pot = lambda v: self._valor_de("CCCADCIR", "ato_cirurgico", "POT_CONT", "classe_contaminacao_cirurgica_id", v)
        for v, classe in (("L", "limpa"), ("p", "potencialmente_contaminada"), ("C", "contaminada"),
                          ("I", "infectada"), ("S", "infectada")):
            self.assertEqual(pot(v), (classe, []), v)
        self.assertEqual(pot("Y"), (None, ["valor_fora_do_dominio"]))
        c = [x for x in self.plano["CCCADCIR"]["colunas"]["ato_cirurgico"] if x["coluna"] == "POT_CONT"][0]
        self.assertEqual(c["cod"], ("classe_contaminacao_cirurgica", "classe"))

    def test_historico_liga_a_agenda_com_o_registro(self):
        refs = [c["referencia"] for c in self.plano["CCHISAGE"]["colunas"]["reagendamento_cirurgico"]
                if c["destino"] == "agendamento_cirurgico_id"]
        self.assertEqual(refs[0], "CCAGENDA.(SALA,DATA_HORA,REG)=(SALA_R,DATA_HORA_R,REG)")
        self.assertEqual(refs[1], "CCAGENDA.REG")

    def test_dependencias_de_ordem_declaradas(self):
        o = {r["tabela"]: int(r["ordem"]) for r in self.mapa["tabelas"] if (r.get("ordem") or "").isdigit()}
        for filha, pai in (("CCHISAGE", "CCAGENDA"), ("CCPROEXT", "CCAGENDA"), ("CCHISAGE", "CCSALAS"),
                           ("CCHISAGE", "TBPROFIS"), ("CCCADCIR", "TBCONVEN"), ("CCSALAS", "TBCENCUS"),
                           ("CCAGENDA", "TBPROFIS"), ("CCAGENDA", "TBCONVEN")):
            self.assertLess(o[pai], o[filha], (filha, pai))

    def test_colunas_da_agenda_excluida_todas_declaradas(self):
        decl = {c["coluna"]: c for c in self.mapa["colunas_decl"] if c["tabela"] == "CCAGENDA_EXC_CANC"}
        for nome, _, _ in l6_16.colunas("CCAGENDA_EXC_CANC"):
            self.assertIn(nome, decl, nome)
            self.assertTrue(decl[nome]["motivo"].strip(), nome)
        for pessoal in ("PACIENTE", "FONE", "E_MAIL_PACIENTE", "DATA_NASCIMENTO"):
            self.assertFalse(decl[pessoal]["destino"], pessoal)
            self.assertIn("retrato", decl[pessoal]["motivo"], pessoal)

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


class HoraVazia(unittest.TestCase):
    @unittest.expectedFailure  # pedido 15 de saida/L6-16.json: hoje a hora vazia vira meia-noite
    def test_hora_vazia_nao_vira_meia_noite(self):
        import datetime
        d = datetime.date(2026, 3, 2)
        self.assertEqual(carga_mapa.data_hora_composta(d, None), (None, "hora_ausente"))
        self.assertEqual(carga_mapa.data_hora_composta(d, "    ", "0745", True), (None, "hora_ausente"))


class Sintetica(unittest.TestCase):
    def test_esperado_coerente_com_as_linhas(self):
        cont = {}
        esp = l6_16.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), TABELAS)
        for t, e in esp.items():
            recusas = sum(n for k, n in e["pendencias"].items() if k.startswith(("restricao_destino_", "pai_pendente")))
            self.assertEqual(cont[t], e["gravados"] + recusas, t)

    def test_casos_da_rodada_3b_na_imagem(self):
        ag = []
        l6_16.linhas(random.Random(1), lambda t, v: ag.append(v) if t == "CCAGENDA" else None)
        n = [x for x, _, _ in l6_16.colunas("CCAGENDA")]
        sit = {v[n.index("ID_TBSITAGE")] for v in ag}
        self.assertTrue({"C", "S", "X", "HR", "ZZ", None} <= sit)
        self.assertIn("S", [v[n.index("HORA_BLOQUEADA")] for v in ag])
        self.assertTrue([v for v in ag if v[n.index("PRONT")] is None and v[n.index("CPF")]])

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
