"""Fatia L5-06 (cadastros e administração, módulo CAD): plano dirigido pelo mapa real, regras declaradas e imagem
sintética. Sem banco e só com valores inventados; a carga e a conciliação na imagem SINTÉTICA rodam em
`tools/obra/conferir-fatia-f4.sh L5-06`."""
import datetime
import os
import random
import unittest
from pathlib import Path

from sante_conector import carga_mapa, depara, mapa, sentinela
from sante_conector.sintetica_d import l5_06

CARREGADAS = l5_06.CARREGADAS
SEM_CARGA = l5_06.SEM_CARGA
DIR = Path(os.environ.get("CONECTOR_MAPA_DIR") or mapa.DIR_PACOTE) / "declarado"
DECL = DIR / "colunas.d" / "L5-06.tsv"


class PlanoL506(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(CARREGADAS + SEM_CARGA))}

    def col(self, t, c, dt=None):
        return next(x for d in self.plano[t]["destinos"] if dt in (None, d) for x in self.plano[t]["colunas"][d]
                    if x["coluna"] == c)

    def test_carregadas_em_ordem_e_sem_carga_fora(self):
        self.assertEqual(list(self.plano), CARREGADAS)

    def test_destinos(self):
        for t in ["HTTBCBOPRO", "HTTBCBOPRO_TBUNIDAD", "HTTBHOSPIT"]:
            self.assertEqual(self.plano[t]["destinos"], ["trilha_auditoria"], t)
        # o dado fiscal é secundário opcional; conta bancária, configuração TISS e contrato por estabelecimento
        # ficam para o cliente (decisões em docs/obra/passagens/F4-decisoes-destino.md)
        self.assertEqual(self.plano["TBPROFIS"]["destinos"], ["profissional", "profissional_dado_fiscal",
                                                              "pessoa_fisica", "usuario_profissional"])
        self.assertTrue(self.plano["TBPROFIS"]["opcoes"]["pessoa_fisica"]["antes"])
        self.assertTrue(self.plano["TBPROFIS"]["opcoes"]["profissional_dado_fiscal"]["opcional"])
        self.assertEqual(self.plano["TBCONVEN"]["destinos"], ["fonte_pagadora"])

    def test_situacao_pelo_depara_de_valores(self):
        # sem o de-para, fonte encerrada e profissional desligado entrariam com o padrão (ativos)
        self.assertEqual(self.col("TBCONVEN", "SITUACAO")["valores"], {"A": "ativa", "I": "inativa"})
        self.assertEqual(self.col("TBPROFIS", "SITUACAO")["valores"], {"A": "ativo", "I": "inativo"})

    def test_referencias_declaradas(self):
        self.assertEqual(self.col("TBCONVEN", "CLASSE")["referencia"], "TBCLASSC")
        self.assertEqual(self.col("HTCONVEN", "CLASSIFICACAO")["referencia"], "TBCLASSC")
        self.assertEqual(self.col("TBMEDESP", "ESP")["referencia"], "TBESPEC")
        for t in ("HTTBCBOPRO", "HTTBCBOPRO_TBUNIDAD"):
            self.assertEqual(self.col(t, "USUARIO")["referencia"], "TBUSERS", t)
        # a trilha do estabelecimento diz qual estabelecimento mudou e onde
        self.assertEqual({c["destino"]: c["referencia"] for c in self.plano["HTTBHOSPIT"]["colunas"]["trilha_auditoria"]
                          if c["coluna"] == "COD"}, {"entidade_id": "TBHOSPIT", "estabelecimento_id": "TBHOSPIT"})
        for t, dt in [("TBMEDESP", "profissional_especialidade"), ("TBCBOPRO_TBCONVEN", "profissional_fonte_pagadora")]:
            c = next(x for x in self.plano[t]["colunas"][dt] if x["destino"] == "profissional_id")
            self.assertEqual([p.get("tabela") or p.get("coluna") for p in c["passos"]],
                             ["TBCBOPRO", "ID_TBPROFIS", "TBPROFIS"], t)

    def test_lotacao_da_trilha_pela_chave_composta_sem_depara_cbo(self):
        # CBOPRO é o ID da inscrição: a lotação sai da chave composta (CBOPRO,UNIDAD), nunca do de-para cbo
        c = self.col("HTTBCBOPRO_TBUNIDAD", "CBOPRO")
        self.assertEqual(c["destino"], "entidade_id")
        self.assertEqual(c["passos"][0]["modo"], "composta")
        self.assertEqual(c["passos"][0]["tabela"], "TBCBOPRO_TBUNIDAD")
        self.assertEqual(c["passos"][0]["arg"], ["CBOPRO", "UNIDAD"])

    def test_cbo_pelo_codigo_da_linha_pai_nunca_pelo_id(self):
        c = self.col("TBCBOSUS_TBESPEC", "ID_TBCBOSUS")
        self.assertEqual(c["depara"], "cbo")
        self.assertEqual([p.get("tabela") or p.get("coluna") for p in c["passos"]], ["TBCBOSUS", "COD"])

    def test_retrato_por_linha_e_sem_hash_constante(self):
        self.assertEqual(self.col("HTCONVEN", "#retrato")["destino"], "dados")
        for c in self.m["colunas_decl"]:
            if c["tabela"] in CARREGADAS and (c.get("destino") or "").endswith(".hash_dados"):
                self.assertTrue(c["coluna"].startswith("#sha256:#retrato"), c)
            if c["tabela"] in CARREGADAS and (c.get("destino") or "").endswith((".dados", ".dados_antes",
                                                                                 ".dados_depois")):
                self.assertTrue(c["coluna"].startswith("#retrato"), c)
        # HTCONVEN: o retrato cobre todas as colunas da tabela
        self.assertEqual(set(self.plano["HTCONVEN"]["retrato"]),
                         {"ID", "ID_TBCONVEN", "DATA_HORA_HISTORICO", "NOME", "CLASSIFICACAO"})

    def test_historicos_com_retrato_de_todas_as_colunas_e_hash_do_mesmo_json(self):
        for t, dt in [("HTPACIENTE", "paciente_versao"), ("HTPACTELEFONE", "trilha_auditoria"),
                      ("HTPROFIS", "profissional_versao"), ("HTPROFISTEL", "trilha_auditoria"),
                      ("HTATENDRESP", "trilha_auditoria"), ("HTTBCBOPRO", "trilha_auditoria"),
                      ("HTTBCBOPRO_TBUNIDAD", "trilha_auditoria"), ("HTTBHOSPIT", "trilha_auditoria")]:
            self.assertEqual(self.plano[t]["destinos"], [dt], t)
            k = next(x for x in self.plano[t]["retratos"] if x.startswith("#retrato:*"))
            self.assertTrue(self.plano[t]["retratos"][k]["todas"], t)
            if dt != "trilha_auditoria":
                self.assertIn("#sha256:#retrato:*", [c["coluna"] for c in self.plano[t]["colunas"][dt]], t)
            else:  # o histórico da origem guarda o estado DEPOIS da alteração (F4-decisoes-destino.md seção 4)
                self.assertEqual([c["destino"] for c in self.plano[t]["colunas"][dt]
                                  if c["coluna"].startswith("#retrato")], ["dados_depois"], t)
        # o telefone do histórico nunca vira versão própria do cadastro (o retrato da versão é o cadastro completo)
        for c in self.m["colunas_decl"]:
            if c["tabela"] in ("HTPACTELEFONE", "HTPROFISTEL"):
                self.assertFalse((c.get("destino") or "").startswith(("paciente_versao", "profissional_versao")), c)
        # HTTBHOSPIT: nenhuma credencial no retrato
        r = self.plano["HTTBHOSPIT"]["retratos"]["#retrato:*-USUARIO_PROXY,USERPROV"]
        self.assertFalse({"USUARIO_PROXY", "USERPROV", "SENHAPROV", "SENHA_PROXY"} & set(r.get("colunas") or []), r)

    def test_telefone_e_responsavel_pela_versao_pai(self):
        cam = lambda t, dst: [p.get("tabela") or p.get("coluna") for c in self.plano[t]["colunas"][
            self.plano[t]["destinos"][0]] if c["destino"] == dst for p in c["passos"]]
        self.assertEqual(cam("HTPACTELEFONE", "entidade_id"), ["HTPACIENTE", "ID_RICADPAC", "RICADPAC"])
        self.assertEqual(cam("HTPACTELEFONE", "ocorrido_em"), ["HTPACIENTE", "DATA_HORA_HISTORICO"])
        self.assertEqual(cam("HTPROFISTEL", "entidade_id"), ["HTPROFIS", "ID_TBPROFIS", "TBPROFIS"])
        self.assertEqual(cam("HTATENDRESP", "entidade_id"), ["HTATENDIMENTO", "ID_ATCABECATEND", "ATCABECATEND"])
        self.assertEqual(cam("HTATENDRESP", "ocorrido_em"), ["HTATENDIMENTO", "DATA_HORA_HISTORICO"])

    def test_regra_do_cadastro_desdobrada_por_campo(self):
        p = self.plano["ATPARAMGERAL"]
        self.assertEqual(p["destinos"], ["regra_campo_cadastro"])
        des = p["opcoes"]["regra_campo_cadastro"]["desdobrar"]
        self.assertEqual(len(des), l5_06.CAMPOS_REGRA)
        self.assertEqual(len({r for _, r in des}), len(des))  # rótulo (campo|entidade) único
        self.assertEqual(len({r.split("|")[0] for _, r in des}), len(des))  # um campo, uma regra
        ent = {r.split("|")[1] for _, r in des}
        self.assertLessEqual(ent, {"paciente", "pessoa_fisica", "documento_pessoa", "endereco_pessoa",
                                   "telefone_pessoa", "responsavel_paciente"})
        # os S/N antigos do telefone ficam fora: o campo novo (código da lista) é o mesmo
        self.assertFalse({"DIGITAR_TELEFONE", "DIGITAR_TEL_CONTATO", "DIGITAR_CELULAR"} & {c for c, _ in des})
        item = next(c for c in p["colunas"]["regra_campo_cadastro"] if c["coluna"] == "#item")
        # lista confirmada por contagem na imagem de referência (TBDIGITAR: 1 Não, 2 Sim, 3 Obrigatório; T/F nas
        # marcações CHAR); 0 fica fora da lista e nunca oculta
        self.assertEqual(item["valores"], {"T": "opcional", "F": "oculto", "S": "opcional", "N": "oculto",
                                           "0": "opcional", "1": "oculto", "2": "opcional", "3": "obrigatorio",
                                           "4": "opcional"})
        self.assertLessEqual(set(item["valores"].values()), {"obrigatorio", "opcional", "oculto", "somente_leitura"})

    def test_sem_carga_comentadas_ou_pedidas(self):
        linhas = [x.split("\t") for x in DECL.read_text(encoding="utf-8").splitlines() if x.startswith("#")]
        self.assertEqual({x[0][1:] for x in linhas}, set(SEM_CARGA) - {"TBEMPHOSLOGO"})


class RegrasL506(unittest.TestCase):
    def test_sentinelas_das_colunas_declaradas(self):
        a = sentinela.aplicar
        self.assertEqual(a("texto", 300001), ("300001", None))
        self.assertEqual(a("inteiro_zeros_esquerda:6", 5711), ("005711", None))
        self.assertEqual(a("inteiro_zeros_esquerda:6", 0), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_zeros_esquerda:11", 123456789012), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("inteiro_nao_negativo", -1), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("faixa:0,100", 150), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_sn", "X"), (None, "valor_fora_do_dominio"))
        self.assertEqual(a("booleano_sn", "S"), (True, None))
        self.assertEqual(a("texto_nome", "  Dr.  Exemplo   1 "), ("Dr. Exemplo 1", None))
        self.assertEqual(a("data", datetime.date(1899, 12, 30)), (None, "data_sentinela"))
        self.assertEqual(a("data_hora", datetime.datetime(1899, 12, 30, 10, 15)), (None, "hora_sem_data"))
        self.assertEqual(a("texto_longo", "a\r\n  b "), ("a\r\n  b ", None))

    def test_id_do_cbo_nunca_e_o_codigo(self):
        # na sintética o ID substituto nunca coincide com um código CBO válido (falharia se o ID fosse tratado como código)
        d = depara.Depara("cbo", [(c, i) for i, c in l5_06.CBO_POR_ID.items() if len(c) == 6])
        for i, cod in l5_06.CBO_POR_ID.items():
            self.assertNotEqual(str(i), cod)
            self.assertIsNone(d.resolver(i)[0])
        self.assertEqual(d.resolver(l5_06.CBO_POR_ID[1])[0], 1)


class SinteticaL506(unittest.TestCase):
    def test_tabelas_e_colunas_da_imagem_cobrem_o_plano(self):
        plano = [p for p in carga_mapa.planejar(mapa.carregar_execucao(), set(l5_06.COLUNAS))
                 if p["tabela"] not in l5_06.PAIS_NA_IMAGEM]
        self.assertEqual([p["tabela"] for p in plano], CARREGADAS)
        for p in plano:
            self.assertFalse(set(p["lidas"]) - set(l5_06.COLUNAS[p["tabela"]]), p["tabela"])

    def test_esperado_bate_com_as_linhas(self):
        cont = {}
        esp = l5_06.linhas(random.Random(1), lambda t, v: cont.__setitem__(t, cont.get(t, 0) + 1))
        self.assertEqual(set(esp), set(CARREGADAS))
        self.assertEqual(cont["ATPARAMGERAL"], 3)  # desdobrado: gravados = itens, conferidos na carga
        for t, e in esp.items():
            if t == "ATPARAMGERAL":
                continue
            recusas = sum(n for r, n in e["pendencias"].items() if r.startswith("restricao_destino") or r == "pai_pendente")
            self.assertEqual(e["gravados"] + recusas, cont[t], t)

    def test_vinculo_profissional_fonte_carrega_de_verdade(self):
        # o profissional do credenciamento vem pela inscrição: só existe se TBPROFIS carregar antes (aresta
        # TBCBOPRO_TBCONVEN -> TBPROFIS pedida ao integrador). Sem ela todo credenciamento seria recusado: falha aqui
        esp = l5_06.linhas(random.Random(1), lambda t, v: None)["TBCBOPRO_TBCONVEN"]
        self.assertEqual(esp["gravados"], 4)
        self.assertTrue(l5_06.profissional_antes_do_vinculo(),
                        "TBCBOPRO_TBCONVEN vem antes de TBPROFIS na ordem do mapa: credenciamento não grava")


if __name__ == "__main__":
    unittest.main()


class RevisaoL506(unittest.TestCase):
    """Achados da revisão da rodada 3: documento do profissional, pessoa física, vínculo com o usuário, sexo da
    especialidade e colunas não carregadas sempre com motivo."""
    @classmethod
    def setUpClass(cls):
        cls.m = mapa.carregar_execucao()
        cls.plano = {p["tabela"]: p for p in carga_mapa.planejar(cls.m, set(CARREGADAS + SEM_CARGA))}
        cls.decl = [c for c in cls.m["colunas_decl"] if c["tabela"] in CARREGADAS]

    def test_documento_do_profissional_concorrente_com_o_indice_da_origem(self):
        cpf = [c["coluna"] for c in self.plano["TBPROFIS"]["colunas"]["pessoa_fisica"] if c["destino"] == "cpf"]
        self.assertEqual(cpf, ["CNPJ_CPF", "CPF", "ID_TBPESSOA"])
        self.assertEqual(self.plano["TBPROFIS"]["opcoes"]["pessoa_fisica"]["adotar"], ["cpf"])

    def test_pessoa_fisica_e_vinculo_do_usuario(self):
        dts = self.plano["TBPROFIS"]["destinos"]
        self.assertIn("usuario_profissional", dts)
        op = self.plano["TBPROFIS"]["opcoes"]["usuario_profissional"]
        self.assertTrue(op["opcional"])
        self.assertEqual(op["adotar"], ["usuario_id"])
        pf = {c["destino"] for c in self.plano["TBPROFIS"]["colunas"]["pessoa_fisica"]}
        self.assertLessEqual({"data_nascimento", "sexo_id", "nome_mae", "cns"}, pf)

    def test_sexo_da_especialidade(self):
        c = next(c for c in self.plano["TBESPEC"]["colunas"]["especialidade_medica"] if c["coluna"] == "SEXO")
        self.assertEqual(c["valores"], {"A": "ambos", "F": "feminino", "M": "masculino"})

    def test_coluna_nao_carregada_sempre_com_motivo(self):
        for c in self.decl:
            if not c.get("destino"):
                self.assertIn("não carregada", c.get("motivo") or "", c)
        sem = {(c["tabela"], c["coluna"]) for c in self.decl if not c.get("destino")}
        for x in [("TBCONVEN", "CGC"), ("TBCONVEN", "COD_CON"), ("TBCONVEN", "VENC_CTR"), ("TBPROFIS", "CONTA"),
                  ("TBPROFIS", "ASS")]:
            self.assertIn(x, sem)
