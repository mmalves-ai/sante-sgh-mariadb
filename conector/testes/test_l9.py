"""L9 do conector (F4): Sincronizar. Prova do plano F4, seção 6.1, no cliente de teste exclusivo `f4r6_l9` (criado e
apagado aqui): carga da versão 1 da imagem sintética `exemplo_l9`, edição manual no destino, Sincronizar com a versão 2
(alteração só de coluna, linhas novas, apagadas e antigas alteradas), conflito com a ORIGEM VENCENDO e a edição
guardada, exclusão lógica, reativação (versão 1 de novo), alerta de exclusão em massa, hash por bloco e sequência
própria pelo generator. Conciliação 100% em toda execução. Só dados falsos."""
import json
import os
import time
import unittest

from sante_conector import carga_mapa, sincronizar
from sante_conector.sintetica_d import exemplo_l9 as ex

CODIGO = "f4r6_l9"


class Regras(unittest.TestCase):
    def test_exclusao_em_massa(self):
        self.assertFalse(sincronizar.em_massa(3, 6000))
        self.assertTrue(sincronizar.em_massa(50, 100))           # metade de uma tabela pequena: alerta
        self.assertTrue(sincronizar.em_massa(5, 5))              # tabela pequena esvaziada: alerta
        self.assertFalse(sincronizar.em_massa(4, 10))            # abaixo do mínimo de linhas
        self.assertFalse(sincronizar.em_massa(51, 1000))         # abaixo da fração
        self.assertFalse(sincronizar.em_massa(900, 1000, confirmado=True))
        self.assertTrue(sincronizar.em_massa(1, 10, limite=(0.0, 0)))

    def test_suporta_e_chave(self):
        p = {"destinos": ["a", "b"], "opcoes": {"b": {"agrupar": ["X"]}}}
        self.assertTrue(sincronizar.suporta(None, p))            # o agrupado também é reaplicado
        self.assertTrue(sincronizar.suporta(None, {"destinos": ["a"], "opcoes": {}}))
        self.assertEqual(sincronizar._chave_ctl("7", "7", "a", True, False), "7")
        self.assertEqual(sincronizar._chave_ctl("7", "7", "b", False, False), "7/b")
        self.assertEqual(sincronizar._chave_ctl("7/r", "7", "b", False, False), "7/b/r")
        self.assertTrue(sincronizar._e_base("7", ["a", "b"]))
        self.assertFalse(sincronizar._e_base("7/b", ["a", "b"]))


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001
        return False


NO_CONTAINER = os.path.exists("/opt/firebird/bin/isql") and _mariadb()


@unittest.skipUnless(NO_CONTAINER, "só no container do conector, com o MariaDB da rede interna")
class SincronizarF4r6L9(unittest.TestCase):
    def test_duas_imagens_edicao_conflito_exclusao_reativacao(self):
        from sante_conector import abridor, banco, controle, sintetica
        from sante_conector.leitor import Leitor
        d = os.path.join(os.environ.get("CONECTOR_TRABALHO_DIR", "/trabalho"), "l9-" + CODIGO)
        os.makedirs(d, exist_ok=True)
        arqs = {}
        for v in (1, 2):
            arqs[v] = os.path.join(d, "v%d.fdb" % v)
            for x in (arqs[v], arqs[v][:-4] + ".manifesto.json"):
                if os.path.exists(x):
                    os.remove(x)
            ex.VERSAO, ex.DDL = v, ex.ddl(v)
            sintetica.gerar(arqs[v], versao=v, fatias=["exemplo_l9"])
        ex.VERSAO, ex.DDL = 1, ex.ddl(1)
        cliente, ctl = "cliente_" + CODIGO, controle.nome_ctl(CODIGO)
        root = banco.conectar(None, multi=True)
        saida = {}

        def rodar(v, eid, sinc, **kw):
            with abridor.abrir(arqs[v], modo="snapshot", cow_mb=64) as ab, Leitor(ab.dispositivo) as lt:
                presentes = set(lt.tabelas())
                contagens = {t: lt.contar(t) for t in presentes}
                cc = banco.conectar(cliente, autocommit=False)
                try:
                    cm = carga_mapa.CargaMapa(lt, cc, ctl, eid, eid, ex.MAPA_TESTE, sincronizar=sinc, **kw)
                    t0 = time.monotonic()
                    res = cm.executar(presentes, contagens)
                    res["segundos"] = round(time.monotonic() - t0, 3)
                finally:
                    cc.close()
            ruins = [k for k, r in res["entidades"].items() if not r["conferido"]]
            self.assertEqual(ruins, [], "execução %d: conciliação divergiu: %r" % (
                eid, {k: res["entidades"][k] for k in ruins}))
            regras = {}
            for _, _, regra, _, _ in cm.pend:
                regras[regra] = regras.get(regra, 0) + 1
            return cm, res, regras

        def um(sql, args=()):
            with root.cursor() as c:
                c.execute(sql, args)
                return c.fetchall()

        def id_de(tab, chave):
            return um("SELECT id_destino FROM `%s`.conector_origem WHERE tabela_origem=%%s AND chave_original=%%s"
                      % ctl, (tab, chave))[0][0]
        try:
            with root.cursor() as c:
                for b in (cliente, ctl):
                    c.execute("DROP DATABASE IF EXISTS `%s`" % b)
                c.execute("CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci" % cliente)
            controle.preparar(root, CODIGO, cliente)
            root.select_db(cliente)
            banco.aplicar_script(root, ex.DDL_DESTINO)
            # 1) importação da versão 1
            _, r1, reg1 = rodar(1, 1, False)
            self.assertEqual(reg1.get("adotado_existente"), 1, reg1)      # o aluno 1 adota a pessoa do profissional 1
            self.assertEqual((r1["entidades"]["ex9_paciente"]["registros_destino"],
                              r1["entidades"]["ex9_consulta"]["registros_destino"]), (2010, 6000))
            self.assertEqual(r1["sincronizar"]["sequencias"], {"consulta": 24001})
            # 2) edição manual no destino (equipe avaliando): paciente 3 (também alterado na origem) e paciente 4
            p3, p4 = id_de(ex.PAC, "3"), id_de(ex.PAC, "4")
            with root.cursor() as c:
                c.execute("UPDATE ex9_paciente SET nome='EDITADO NO DESTINO', alterado_em=UTC_TIMESTAMP(3),"
                          " versao=versao+1 WHERE id=%s", (p3,))
                c.execute("UPDATE ex9_paciente SET telefone='1188888888', alterado_em=UTC_TIMESTAMP(3),"
                          " versao=versao+1 WHERE id=%s", (p4,))
                c.execute("UPDATE ex9_paciente SET unidade='EDITADA', alterado_em=UTC_TIMESTAMP(3), versao=versao+1"
                          " WHERE id=%s", (id_de(ex.PAC, "5"),))
                c.execute("UPDATE ex9_setor SET nome='SETOR EDITADO', alterado_em=UTC_TIMESTAMP(3), versao=versao+1"
                          " WHERE id=%s", (id_de(ex.SEM, "2"),))
            root.commit()
            # 3) Sincronizar com a versão 2
            cm2, r2, reg2 = rodar(2, 2, True)
            s2 = r2["sincronizar"]
            # 3 presenças + 2 pacientes antigos + profissional 3 (e a pessoa dele) + parcela 1 (e o título) + vínculo 1
            # + setor 1; o setor 2 (recusado pela restrição ao reaplicar) não conta, nem o conflito dele
            self.assertEqual(s2["atualizadas"], 11, s2)
            self.assertEqual(s2["conflitos"], 2)
            self.assertEqual(s2["conflitos_itens"], [
                {"tabela_origem": ex.PAC, "chave_original": "3", "tabela_destino": "ex9_paciente", "id_destino": p3,
                 "colunas": ["nome"]},
                {"tabela_origem": ex.VIN, "chave_original": "1", "tabela_destino": "ex9_paciente",
                 "id_destino": id_de(ex.PAC, "5"), "colunas": ["unidade"]}])
            # 3 antigas + profissionais 1 e 2 + parcela 2 + vínculo 2; o setor 3 (destino sem excluido_em) fica ativo
            self.assertEqual((s2["excluidas"], s2["reativadas"], s2["alertas_exclusao_em_massa"]), (7, 0, []))
            self.assertEqual(s2.get("exclusoes_sem_suporte"), 1)
            self.assertEqual(s2.get("cabecalhos_recalculados"), 1)
            self.assertEqual(reg2.get("exclusao_sem_suporte_no_destino"), 1)
            self.assertEqual(reg2.get("restricao_destino_1062"), 1)
            # compartilhadas: a pessoa do profissional 1 (o aluno usa) segue ativa; a do 2 foi excluída; o título 100
            # (a parcela 1 segue) ativo; o paciente 6 (o vínculo 2 sumiu) ativo
            def pes(tab, k):
                return um("SELECT excluido_em IS NULL, nome FROM ex9_pessoa WHERE id=%s",
                          (id_de(tab, k + "/ex9_pessoa"),))[0]
            self.assertEqual(pes(ex.PROF, "1")[0], 1)
            self.assertEqual(pes(ex.PROF, "2")[0], 0)
            self.assertEqual(pes(ex.PROF, "3"), (1, "PROF TRES ALTERADO"))     # a criada pela migração segue a origem
            self.assertEqual(um("SELECT excluido_em IS NULL, quantidade, valor_total FROM ex9_titulo WHERE id=%s",
                                (id_de(ex.PAR, "1/ex9_titulo"),))[0], (1, 1, 15))
            self.assertEqual(um("SELECT valor FROM ex9_parcela WHERE id=%s", (id_de(ex.PAR, "1"),))[0][0], 15)
            self.assertEqual(um("SELECT excluido_em IS NULL FROM ex9_parcela WHERE id=%s", (id_de(ex.PAR, "2"),))[0][0], 0)
            self.assertEqual(um("SELECT excluido_em IS NULL, unidade FROM ex9_paciente WHERE id=%s",
                                (id_de(ex.PAC, "6"),))[0], (1, "U2"))
            self.assertEqual(um("SELECT unidade FROM ex9_paciente WHERE id=%s", (id_de(ex.PAC, "5"),))[0][0], "U9")
            self.assertEqual(um("SELECT nome, prioridade FROM ex9_setor ORDER BY id"),
                             (("SETOR 1", 3), ("SETOR EDITADO", 4), ("SETOR 3", 2)))  # padrão; recusa; ativo
            self.assertEqual(s2["blocos"][ex.CON], {"total": 3, "iguais": 1, "alterados": 2})
            self.assertEqual(s2["sequencias"], {"consulta": 24021})
            self.assertEqual(reg2.get("conflito_origem_venceu"), 2)      # paciente 3 e vínculo 1
            self.assertEqual(reg2.get("edicao_no_destino"), 1)    # paciente 4: só o destino mudou, a edição fica
            self.assertNotIn("alteracao_aguarda_sincronizar", reg2)
            self.assertEqual(reg2.get("apagada_aguarda_sincronizar"), 1)     # só o setor 3 (sem exclusão lógica)
            self.assertEqual(um("SELECT nome FROM ex9_paciente WHERE id=%s", (p3,))[0][0],
                             "PACIENTE TESTE TRES ALTERADO")           # a origem venceu
            self.assertEqual(um("SELECT telefone FROM ex9_paciente WHERE id=%s", (p4,))[0][0], "1188888888")
            cf = um("SELECT colunas, edicao_destino, valor_origem, decisao FROM `%s`.conflito_sincronizar"
                    " ORDER BY id" % ctl)
            self.assertEqual(len(cf), 2)                      # o do setor 2 foi desfeito com a linha recusada
            self.assertEqual((json.loads(cf[1][1])["unidade"], json.loads(cf[1][2])), ("EDITADA", {"unidade": "U9"}))
            self.assertEqual(json.loads(cf[0][0]), ["nome"])
            self.assertEqual(json.loads(cf[0][1])["nome"], "EDITADO NO DESTINO")   # a edição guardada
            self.assertEqual(json.loads(cf[0][2]), {"nome": "PACIENTE TESTE TRES ALTERADO"})
            self.assertEqual(cf[0][3], "origem_venceu")
            self.assertEqual(um("SELECT presente FROM ex9_consulta WHERE id=%s", (id_de(ex.CON, "20"),))[0][0], 1)
            self.assertEqual(um("SELECT COUNT(*) FROM ex9_consulta WHERE excluido_em IS NOT NULL")[0][0], 2)
            self.assertEqual(um("SELECT COUNT(*) FROM ex9_paciente WHERE excluido_em IS NOT NULL")[0][0], 1)
            self.assertEqual(um("SELECT COUNT(*) FROM ex9_consulta WHERE excluido_em IS NULL")[0][0], 6003)
            self.assertEqual(r2["entidades"]["ex9_consulta"]["registros_destino"], 6003)
            saida["diferencial_segundos"] = r2["segundos"]
            saida["linhas_por_segundo"] = {t: x["linhas_por_segundo"] for t, x in r2["carga"]["por_tabela"].items()}
            # 4) a versão 1 volta: reativação das apagadas, exclusão das novas, a origem vence de novo (sem conflito)
            _, r3, reg3 = rodar(1, 3, True)
            s3 = r3["sincronizar"]
            self.assertEqual((s3["reativadas"], s3["excluidas"], s3["conflitos"]), (7, 7, 0))
            self.assertEqual(pes(ex.PROF, "2")[0], 1)                          # a pessoa do profissional 2 reativada
            self.assertEqual(um("SELECT quantidade, valor_total FROM ex9_titulo WHERE id=%s",
                                (id_de(ex.PAR, "1/ex9_titulo"),))[0], (2, 30))
            self.assertEqual(um("SELECT COUNT(*) FROM ex9_consulta WHERE excluido_em IS NULL")[0][0], 6000)
            self.assertEqual(um("SELECT nome FROM ex9_paciente WHERE id=%s", (p3,))[0][0], "PACIENTE TESTE 3")
            self.assertEqual(um("SELECT presente FROM ex9_consulta WHERE id=%s", (id_de(ex.CON, "20"),))[0][0], 0)
            # 5) exclusão em massa (limite zerado): nada é excluído, alerta crítico até a confirmação
            _, r4, reg4 = rodar(2, 4, True, limite_exclusao=(0.0, 0))
            s4 = r4["sincronizar"]
            self.assertEqual(s4["excluidas"], 0)
            self.assertEqual(sorted(a["tabela_origem"] for a in s4["alertas_exclusao_em_massa"]),
                             sorted([ex.CON, ex.PAC, ex.PROF, ex.PAR, ex.VIN, ex.SEM]))
            self.assertEqual(reg4.get("exclusao_em_massa_aguarda_confirmacao"), 6)
            self.assertEqual(um("SELECT COUNT(*) FROM ex9_consulta WHERE excluido_em IS NOT NULL")[0][0], 0)  # novas reativadas
            _, r5, _ = rodar(2, 5, True, limite_exclusao=(0.0, 0), confirmar_exclusao_em_massa=True)
            self.assertEqual(r5["sincronizar"]["excluidas"], 7)
            # limite global por execução: tabelas abaixo do limite somadas acima dele também esperam confirmação
            _, r6, _ = rodar(1, 6, True, limite_global=3)
            s6 = r6["sincronizar"]
            self.assertEqual((s6["excluidas"], s6["alerta_exclusao_global"]["apagadas"]), (0, 7))
            print("L9_MEDIDAS " + json.dumps(saida, sort_keys=True))
        finally:
            with root.cursor() as c:
                for b in (cliente, ctl):
                    c.execute("DROP DATABASE IF EXISTS `%s`" % b)
            root.close()


if __name__ == "__main__":
    unittest.main()
