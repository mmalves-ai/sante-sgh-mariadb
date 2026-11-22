"""L10 do conector (F4): relatório de conciliação curto (ADR 0007, item 22). Regras puras (classe da decisão, rótulo
neutro da prova, o que não carregou, decisões do cliente) e, no container, a resolução das pendências entre execuções
na base de controle do cliente de teste exclusivo `f4r6_l10` (criada e apagada aqui). Só dados falsos."""
import json
import os
import tempfile
import unittest

from sante_conector import relatorio

CODIGO = "f4r6_l10"

MAPA = {
    "tabelas": [{"tabela": t} for t in ("TA", "TB", "TC", "TD", "TE", "TF")],
    "sem_carga": [{"tabela": "TC", "situacao": "descarte", "causa": "mecanismo_do_produto"},
                  {"tabela": "TD", "situacao": "descarte", "causa": "duplicado"}],
    "provas": [{"tabela": "TC", "sql": "SELECT co.chave_original, x.n FROM sequencia_negocio x"
                                       " JOIN {ctl}.conector_origem co ON co.id_destino = x.id"},
               {"tabela": "TF", "sql": "SELECT a.k FROM `atendimento_conta` a JOIN conta_hospitalar c ON 1"}],
}
ENTIDADES = {
    "paciente": {"tabela_origem": "TA", "registros_origem": 10, "registros_destino": 9, "recusados": 1,
                 "conferido": True},
    "pessoa_fisica": {"tabela_origem": "TA", "registros_origem": 9, "registros_destino": 9, "recusados": 0,
                      "conferido": True},
    "consulta": {"tabela_origem": "TB", "registros_origem": 5, "registros_destino": 5, "recusados": 0,
                 "conferido": True},
}


class Regras(unittest.TestCase):
    def test_classe(self):
        self.assertEqual(relatorio.classe("tabela_sem_mapa", "alta")[0], "plataforma")
        self.assertEqual(relatorio.classe("catalogo_oficial_ausente_municipio_ibge", "alta")[0], "plataforma")
        self.assertEqual(relatorio.classe("conflito_origem_venceu", "media")[0], "cliente")
        self.assertEqual(relatorio.classe("alteracao_aguarda_sincronizar", "baixa")[0], "cliente")
        self.assertEqual(relatorio.classe("virada_de_dia", "baixa")[0], "informativa")
        self.assertEqual(relatorio.classe("pai_pendente", "alta")[0], "informativa")
        self.assertEqual(relatorio.classe("cpf_duplicado", "alta"), ("cliente", relatorio.ACAO_PADRAO))

    def test_destino_da_prova_sem_nome_da_origem(self):
        self.assertEqual(relatorio.destino_da_prova(MAPA["provas"][0]["sql"]), "sequencia_negocio")
        self.assertEqual(relatorio.destino_da_prova(MAPA["provas"][1]["sql"]), "atendimento_conta+conta_hospitalar")
        self.assertEqual(relatorio.destino_da_prova("SELECT 1 FROM esquema.tab"), "destino")
        rot = relatorio.rotulos_das_provas(MAPA["provas"] + [{"tabela": "TG", "sql": "SELECT 1 FROM sequencia_negocio"}])
        self.assertEqual(rot["TG"], "sequencia_negocio#2")

    def test_montar(self):
        abertas = [("TA", "cpf_duplicado", "alta", 1), ("TA", "pai_pendente", "alta", 2),
                   ("TB", "conflito_origem_venceu", "media", 3), ("TB", "virada_de_dia", "baixa", 4),
                   ("TX", "tabela_sem_mapa", "alta", 1), ("TC", "prova_nao_conferida", "alta", 1),
                   ("TB", "exclusao_em_massa_aguarda_confirmacao", "critica", 1)]
        resolvidas = [("TA", "cpf_duplicado", "alta", 2), ("TB", "valor_fora_do_dominio", "media", 1)]
        provas = {"TC": {"tipo": "mecanismo", "linhas_origem": 3, "iguais": 2, "divergentes": 1,
                         "faltando_no_destino": 0, "sobrando_no_destino": 0, "conferido": False},
                  "TF": {"tipo": "derivado", "linhas_origem": 4, "iguais": 4, "conferido": True}}
        r = relatorio.montar(abertas, resolvidas, ENTIDADES,
                             contagens={"TA": 10, "TB": 5, "TC": 3, "TD": 7, "TE": 2, "TF": 4, "TV": 0},
                             plano=["TA", "TB"], mapa_exec=MAPA, provas=provas,
                             sem_mapa={"tabelas": 1, "registros": 6}, rede=True)
        t = r["totais"]
        self.assertEqual((t["entidades"], t["conferidas"], t["recusados"]), (3, 3, 1))
        # abertas: 13 da carga + sem prova (TD) + bloqueada (TE)
        self.assertEqual((t["abertas"], t["criticas"], t["resolvidas"]), (15, 1, 3))
        regras = {(g["entidade"], g["regra"]): g for g in r["porRegra"]}
        self.assertEqual(regras[("paciente", "cpf_duplicado")]["resolvidas"], 2)
        self.assertEqual(regras[("consulta", "valor_fora_do_dominio")]["abertas"], 0)
        self.assertEqual(regras[("imagem", "tabela_sem_mapa")]["decisao"], "plataforma")
        self.assertIn(("prova:sequencia_negocio", "prova_nao_conferida"), regras)
        self.assertEqual(r["porRegra"][0]["gravidade"], "critica")
        dec = [d["regra"] for d in r["decisoesCliente"]]
        self.assertEqual(dec, ["exclusao_em_massa_aguarda_confirmacao", "cpf_duplicado", "conflito_origem_venceu"])
        self.assertEqual(t["decisoesCliente"], 5)
        nc = r["naoCarregado"]
        self.assertEqual(nc["recusados"], [{"entidade": "paciente", "recusados": 1}])
        self.assertEqual(nc["bloqueadas"], {"tabelas": 1, "registros": 2})
        self.assertEqual(nc["semMapa"], {"tabelas": 1, "registros": 6})
        causas = {x["causa"]: x for x in nc["semCarga"]}
        self.assertEqual((causas["mecanismo_do_produto"]["provasFalhas"], causas["duplicado"]["semProva"]), (1, 1))
        self.assertEqual([p["destino"] for p in r["provas"]],
                         ["sequencia_negocio", "atendimento_conta+conta_hospitalar"])  # a que falhou primeiro
        self.assertEqual((r["saidasExternas"], r["redeSemRotaExterna"]), (0, True))
        texto = json.dumps(r)
        for nome in ("TA", "TB", "TC", "TD", "TE", "TF", "TX"):  # nada de nome da origem no relatório
            self.assertNotIn('"%s"' % nome, texto)

    def test_rede(self):
        with tempfile.NamedTemporaryFile("w", delete=False) as f:
            f.write("Iface\tDestination\tGateway\neth0\t0012A8C0\t00000000\n")
        self.assertTrue(relatorio.rede_sem_rota_externa(f.name))
        with open(f.name, "a") as g:
            g.write("eth0\t00000000\t0112A8C0\n")
        self.assertFalse(relatorio.rede_sem_rota_externa(f.name))
        os.remove(f.name)
        self.assertIsNone(relatorio.rede_sem_rota_externa("/nao/existe"))


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001
        return False


NO_CONTAINER = os.path.exists("/opt/firebird/bin/isql") and _mariadb()


@unittest.skipUnless(NO_CONTAINER, "só no container do conector, com o MariaDB da rede interna")
class ResolucaoF4r6L10(unittest.TestCase):
    def test_abertas_resolvidas_entre_execucoes(self):
        from sante_conector import banco, controle
        cliente, ctl = "cliente_" + CODIGO, controle.nome_ctl(CODIGO)
        root = banco.conectar(None, multi=True)
        try:
            with root.cursor() as c:
                for b in (cliente, ctl):
                    c.execute("DROP DATABASE IF EXISTS `%s`" % b)
                c.execute("CREATE DATABASE `%s`" % cliente)
            controle.preparar(root, CODIGO, cliente)
            cr = banco.conectar(ctl, autocommit=False)

            def pend(eid, linhas):
                with cr.cursor() as c:
                    c.executemany("INSERT INTO pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                                  " criado_em) VALUES (%s,%s,%s,%s,%s,UTC_TIMESTAMP(3))",
                                  [(eid,) + x for x in linhas])
                cr.commit()
            pend(1, [("TA", "1", "cpf_duplicado", "alta"), ("TA", "2", "cpf_duplicado", "alta"),
                     ("TX", None, "tabela_sem_mapa", "alta"), ("TB", "9", "virada_de_dia", "baixa")])
            r1 = relatorio.gerar(cr, ctl, 1, ENTIDADES)
            self.assertEqual((r1["totais"]["abertas"], r1["totais"]["resolvidas"]), (4, 0))
            # 2: a chave 2 foi corrigida na origem; a tabela fora do mapa e a 1 continuam
            pend(2, [("TA", "1", "cpf_duplicado", "alta"), ("TX", None, "tabela_sem_mapa", "alta")])
            r2 = relatorio.gerar(cr, ctl, 2, ENTIDADES)
            self.assertEqual((r2["totais"]["abertas"], r2["totais"]["resolvidas"]), (2, 2))
            g = {(x["entidade"], x["regra"]): x for x in r2["porRegra"]}
            self.assertEqual((g[("paciente", "cpf_duplicado")]["abertas"],
                              g[("paciente", "cpf_duplicado")]["resolvidas"]), (1, 1))
            self.assertEqual(g[("consulta", "virada_de_dia")]["resolvidas"], 1)
            # 3: nada mais; a chave 1 aberta em 1 e em 2 conta UMA resolução
            r3 = relatorio.gerar(cr, ctl, 3, ENTIDADES)
            self.assertEqual((r3["totais"]["abertas"], r3["totais"]["resolvidas"]), (0, 2))
            with cr.cursor() as c:
                c.execute("SELECT COUNT(*) FROM pendencia WHERE situacao='aberta'")
                self.assertEqual(c.fetchone()[0], 0)
            # 4: repetir não resolve de novo
            self.assertEqual(relatorio.gerar(cr, ctl, 4, ENTIDADES)["totais"]["resolvidas"], 0)
            cr.close()
        finally:
            with root.cursor() as c:
                for b in (cliente, ctl):
                    c.execute("DROP DATABASE IF EXISTS `%s`" % b)
            root.close()


if __name__ == "__main__":
    unittest.main()
