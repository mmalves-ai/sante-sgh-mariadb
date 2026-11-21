"""Mecanismos da rodada 5 do conector (F4; ADR 0006 e 0007, continuidade): rascunho do autor, ligação ao espelho,
semente do espelho, prova de "não copiar", vigência pela evidência, credenciais copiadas (hash, argon2id, cofre),
código derivado filho -> pai, mescla não destrutiva e chave composta com componente encadeado. Só dados falsos
(imagem sintética `exemplo_r5`)."""
import base64
import datetime
import os
import unittest

from sante_conector import carga_mapa, continuidade, mapa
from sante_conector.sintetica_d import exemplo_r5 as ex

TABS = {t["tabela"] for t in ex.MAPA_TESTE["tabelas"]}
CHAVE_FALSA = base64.b64encode(bytes(range(32))).decode()


def _tem(mod):
    try:
        __import__(mod)
        return True
    except ImportError:
        return False


class Sintaxe(unittest.TestCase):
    def test_chave_composta_com_componente_encadeado(self):
        ps = mapa.passos_ref("TBTABTHM(CON>TBCONVEN>THM,THM)@item_faturavel_id")
        self.assertEqual(ps[0]["arg"], ["CON", "THM"])
        self.assertEqual(ps[0]["cadeias"][0], [{"tabela": "TBCONVEN", "modo": "chave", "arg": None}, {"coluna": "THM"}])
        self.assertEqual(ps[0]["coluna_destino"], "item_faturavel_id")
        self.assertEqual(mapa.colunas_da_linha(ps[0]), ["CON", "THM"])
        self.assertEqual(mapa.tabelas_dos_passos(ps), ["TBTABTHM", "TBCONVEN"])
        self.assertIsNone(mapa.passos_ref("T(A>U,B)"))          # componente encadeado tem de terminar em coluna
        self.assertEqual(mapa.passos_ref("T(A,B)")[0]["arg"], ["A", "B"])

    def test_espelho_e_especiais(self):
        self.assertEqual(mapa.espelho_spec("espelho:simpro@EDICAO"),
                         {"catalogo": "simpro", "edicao_coluna": "EDICAO", "edicao": ""})
        self.assertEqual(mapa.espelho_spec("espelho:cbhpm@=2020.1")["edicao"], "2020.1")
        self.assertIsNone(mapa.espelho_spec("espelho:outro"))
        for n in ("#vigencia", "#vigencia:A,B", "#senha:S", "#senha_hash:S:md5", "#senha_hash:S:bcrypt"):
            self.assertTrue(mapa._ESPECIAIS.fullmatch(n), n)
        self.assertFalse(mapa._ESPECIAIS.fullmatch("#senha_hash:S:rot13"))

    def test_verificador(self):
        decl = [dict(c, _arquivo="x") for c in ex.MAPA_TESTE["colunas_decl"]]
        self.assertEqual(mapa.erros_especiais_e_opcoes(decl, ex.MAPA_TESTE["tabelas"], {}), [])
        ruim = [dict(decl[0], via="autor")]
        self.assertTrue(any("autor sem ref" in e for e in mapa.erros_especiais_e_opcoes(ruim, [], {})))
        ruim = [dict(decl[0], via="espelho:xpto")]
        self.assertTrue(any("espelho: mal formado" in e for e in mapa.erros_especiais_e_opcoes(ruim, [], {})))
        oc = {c["tabela"]: set() for c in ex.MAPA_TESTE["colunas"]}
        for c in ex.MAPA_TESTE["colunas"]:
            oc[c["tabela"]].add(c["coluna"])
        self.assertEqual(mapa.erros_provas(ex.MAPA_TESTE["provas"], oc), [])
        ruins = [dict(ex.MAPA_TESTE["provas"][0], sql="DELETE FROM x"), dict(ex.MAPA_TESTE["provas"][0], tipo="?")]
        self.assertEqual(len(mapa.erros_provas(ruins, oc)), 2)

    def test_plano(self):
        plano = {p["tabela"]: p for p in carga_mapa.planejar(ex.MAPA_TESTE, TABS, excluir=frozenset())}
        self.assertNotIn(ex.SAL, plano)
        itm = plano[ex.ITM]["colunas"]["ex6_item"][0]
        self.assertEqual(itm["pai_derivado"], ex.GRP)
        mat = plano[ex.MAT]
        self.assertEqual(mat["colunas"]["ex6_material"][0]["espelho"]["edicao_coluna"], "EDICAO")
        self.assertIn("EDICAO", mat["lidas"])
        self.assertTrue(plano[ex.RASC]["colunas"]["ex6_rascunho"][0]["autor"])
        self.assertIsNone(plano[ex.PLA]["colunas"]["ex6_plano"][1]["vigencia"])
        self.assertEqual(plano[ex.USU]["segredos"], {"SENHA_MD5", "SENHA_CLARA", "SMTP_SENHA"})


class Continuidade(unittest.TestCase):
    def test_hash_importado(self):
        self.assertEqual(continuidade.hash_importado(ex.MD5_FALSO.upper(), "md5"), (ex.MD5_FALSO, None))
        self.assertEqual(continuidade.hash_importado(bytes.fromhex(ex.MD5_FALSO), "md5"), (ex.MD5_FALSO, None))
        b64 = base64.b64encode(bytes.fromhex(ex.MD5_FALSO)).decode()
        self.assertEqual(continuidade.hash_importado(b64, "md5"), (ex.MD5_FALSO, None))
        self.assertEqual(continuidade.hash_importado("nao-e-hash", "md5"), (None, "senha_hash_invalido"))
        self.assertEqual(continuidade.hash_importado(None, "sha1"), (None, None))

    def test_chave_e_referencia(self):
        self.assertIsNone(continuidade.chave_mestra({}))
        self.assertIsNone(continuidade.chave_mestra({"PLATAFORMA_CHAVE_MESTRA": "curta"}))
        self.assertEqual(len(continuidade.chave_mestra({"PLATAFORMA_CHAVE_MESTRA": CHAVE_FALSA})), 32)
        r = continuidade.referencia_cofre("servidor_email", "referencia_cofre", "T", "1")
        self.assertTrue(r.startswith("cofre:migracao/servidor_email/referencia_cofre/"))
        self.assertEqual(r, continuidade.referencia_cofre("servidor_email", "referencia_cofre", "T", "1"))

    @unittest.skipUnless(_tem("cryptography"), "biblioteca de cifra só no container do conector")
    def test_envelope_v1(self):
        k = continuidade.chave_mestra({"PLATAFORMA_CHAVE_MESTRA": CHAVE_FALSA})
        env = continuidade.cifrar(k, "segredo-falso")
        self.assertEqual(env.split(".")[0], "v1")
        self.assertNotIn("segredo-falso", env)
        self.assertEqual(continuidade.decifrar(k, env), "segredo-falso")
        self.assertIsNone(continuidade.decifrar(bytes(32), env))

    @unittest.skipUnless(_tem("argon2"), "argon2 só no container do conector")
    def test_argon2id(self):
        from argon2 import PasswordHasher
        h = continuidade.argon2id("senha-falsa")
        self.assertTrue(h.startswith("$argon2id$"))
        self.assertTrue(PasswordHasher().verify(h, "senha-falsa"))

    def test_evidencia_e_comparar(self):
        cols = [("DTCAD", 12), ("DTVALIDADE", 12), ("DATA_INCLUSAO", 35), ("DT_NASC", 12), ("NOME", 37)]
        self.assertEqual(continuidade.colunas_de_evidencia(cols), ["DTCAD", "DATA_INCLUSAO"])
        self.assertIsNone(continuidade.data_valida(datetime.date(1899, 12, 30)))
        self.assertEqual(continuidade.data_valida(datetime.datetime(2015, 1, 2, 3, 4)), datetime.date(2015, 1, 2))
        r = continuidade.comparar({"1": "6", "2": "1.5", "3": "0"}, {"1": "6", "2": "2", "4": "1"})
        self.assertEqual((r["iguais"], r["divergentes"], r["faltando_no_destino"], r["sobrando_no_destino"],
                          r["conferido"]), (1, 1, 1, 1, False))
        self.assertTrue(carga_mapa._ao_menos(5, 4) and carga_mapa._ao_menos("a", "a"))
        self.assertFalse(carga_mapa._ao_menos(3, 4))


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001 (fora do container: sem MariaDB)
        return False


NO_CONTAINER = os.path.exists("/opt/firebird/bin/isql") and _mariadb()


@unittest.skipUnless(NO_CONTAINER, "só no container do conector, com o MariaDB da rede interna")
class ConferenciaExemploR5(unittest.TestCase):
    def test_continuidade_carrega_concilia_e_reexecuta(self):
        from sante_conector import conferencia
        lidos = {}

        def q(c, sql):
            c.execute(sql)
            return [list(x) for x in c.fetchall()]

        def ler(cc):
            with cc.cursor() as c:
                lidos["usu"] = q(c, "SELECT login, LEFT(resumo_senha, 10), algoritmo, regravar_no_login,"
                                    " referencia_cofre_smtp IS NOT NULL FROM ex6_usuario ORDER BY id")
                lidos["cofre"] = q(c, "SELECT referencia, envelope FROM segredo_cofre")
                lidos["rasc"] = q(c, "SELECT u.login, DATE_FORMAT(r.iniciado_em, '%Y-%m-%d %H:%i'), r.situacao FROM"
                                     " ex6_rascunho r LEFT JOIN ex6_usuario u ON u.id=r.autor_usuario_id ORDER BY r.id")
                lidos["mat"] = q(c, "SELECT item_referencia_matmed_id FROM ex6_material ORDER BY id")
                lidos["pla"] = q(c, "SELECT CAST(vigencia_inicio AS CHAR) FROM ex6_plano ORDER BY id")
                lidos["itm"] = q(c, "SELECT g.codigo_origem FROM ex6_item i JOIN ex6_grupo g ON g.id=i.grupo_id"
                                    " ORDER BY i.id")
                lidos["pes"] = q(c, "SELECT cpf, nome, telefone FROM ex6_pessoa ORDER BY cpf")
                lidos["mescla"] = q(c, "SELECT coluna, valor_origem FROM historico_mescla_migracao")
                lidos["pac"] = q(c, "SELECT p.nome FROM ex6_pacote k LEFT JOIN ex6_preco p ON p.id=k.preco_id"
                                    " ORDER BY k.id")
        ant = os.environ.get("PLATAFORMA_CHAVE_MESTRA")
        os.environ["PLATAFORMA_CHAVE_MESTRA"] = CHAVE_FALSA
        try:
            r = conferencia.conferir("exemplo_r5", depois_da_primeira=ler)
        finally:
            if ant is None:
                os.environ.pop("PLATAFORMA_CHAVE_MESTRA", None)
            else:
                os.environ["PLATAFORMA_CHAVE_MESTRA"] = ant
        self.assertEqual(r["erros"], [])
        self.assertTrue(r["ok"])
        u = lidos["usu"]
        self.assertEqual(u[0], ["ana.teste", ex.MD5_FALSO[:10], "md5", 1, 0])
        self.assertEqual(u[1][:2] + u[1][2:], ["beto.teste", "$argon2id$", "argon2id", 0, 1])
        self.assertEqual(u[2], ["caio.teste", None, "md5", 1, 0])
        self.assertEqual(len(lidos["cofre"]), 1)
        self.assertNotIn("smtp-falso", lidos["cofre"][0][1])
        k = continuidade.chave_mestra({"PLATAFORMA_CHAVE_MESTRA": CHAVE_FALSA})
        self.assertEqual(continuidade.decifrar(k, lidos["cofre"][0][1]), "smtp-falso")
        self.assertEqual(lidos["rasc"], [["ana.teste", "2019-03-04 10:30", "aberto"],
                                         ["beto.teste", "2020-01-02 08:00", "aberto"],
                                         [None, "2021-05-06 09:15", "aberto"]])
        self.assertEqual(lidos["mat"], [[77], [None], [None], [78]])
        self.assertEqual(lidos["pla"], [["2015-06-01"], ["2015-06-01"]])
        self.assertEqual(lidos["itm"], [["CURTO"], ["CODIGO-MUITO-LONGO"], ["CODIGO-MUITO-LONGO"]])
        self.assertEqual(lidos["pes"], [["00000000191", "PESSOA JA CADASTRADA", "1199990000"],
                                        ["00000000272", "OUTRA PESSOA", None]])
        self.assertEqual(lidos["mescla"], [["nome", "NOME DA ORIGEM"]])
        self.assertEqual(lidos["pac"], [["CONSULTA T10"], ["CONSULTA T20"], [None]])
        self.assertEqual({t: (x["tipo"], x["conferido"], x["linhas_origem"]) for t, x in r["provas"].items()},
                         {ex.SAL: ("derivado", True, 2), ex.CTR: ("mecanismo", True, 1)})
        self.assertEqual(r["filho_pai"], {"ex6_item.grupo_id": {"pai": ex.GRP, "verificados": 3, "divergentes": 0,
                                                                "conferido": True}})
        self.assertEqual(r["continuidade"], {"mescla_preenchidas": 1, "mescla_conflitos": 1, "segredos_no_cofre": 1})


@unittest.skipUnless(NO_CONTAINER and os.path.exists("/app/db/espelho/0001_espelho.sql"),
                     "só no container do conector, com o MariaDB e o DDL do espelho")
class SementeEspelho(unittest.TestCase):
    BANCO = "f4r5_espelho_teste"  # banco exclusivo deste teste: criado e apagado aqui

    def test_semente_uma_vez_por_edicao_com_conferencia(self):
        from sante_conector import abridor, banco, conferencia, semente_espelho, sintetica
        from sante_conector.leitor import Leitor
        d = os.path.join(os.environ.get("CONECTOR_TRABALHO_DIR", "/trabalho"), "semente-r5")
        os.makedirs(d, exist_ok=True)
        arq = os.path.join(d, "r5.fdb")
        if os.path.exists(arq):
            os.remove(arq)
        sintetica.gerar(arq, fatias=["exemplo_r5"])
        ddl = mapa.ler_ddl(conferencia.RAIZ_APP)
        root = banco.conectar(None, multi=True)
        try:
            with root.cursor() as c:
                c.execute("DROP DATABASE IF EXISTS `%s`" % self.BANCO)
                c.execute("CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci" % self.BANCO)
                c.execute("USE `%s`" % self.BANCO)
                for t in semente_espelho.TABELAS["matmed"]:
                    c.execute(conferencia._sem_fk(ddl[t]["create"]))
                    for a in ddl[t]["alter"]:
                        if "FOREIGN KEY" not in a:
                            c.execute(a)
                with open("/app/db/espelho/0001_espelho.sql", encoding="utf-8") as f:
                    c.execute(f.read())
                while c.nextset():
                    pass
            cx = banco.conectar(self.BANCO, autocommit=False, multi=True)
            try:
                with abridor.abrir(arq, modo="snapshot", cow_mb=64) as ab, Leitor(ab.dispositivo) as lt:
                    r1 = semente_espelho.semear(lt, cx, decl=ex.SEMENTE)
                    r2 = semente_espelho.semear(lt, cx, decl=ex.SEMENTE)
            finally:
                cx.close()
            e1, e2 = r1["simpro"]["E1"], r1["simpro"]["E2"]
            self.assertEqual((e1["origem"], e1["validas"], e1["espelho"], e1["conferido"], e1["situacao"]),
                             (2, 2, 2, True, "semeada"))
            self.assertEqual((e2["origem"], e2["validas"], e2["espelho"], e2["conferido"]), (2, 1, 1, True))
            self.assertEqual(sum(e2["recusadas"].values()), 1)
            self.assertEqual({k: v["situacao"] for k, v in r2["simpro"].items()}, {"E1": "ja_semeada", "E2": "ja_semeada"})
            with root.cursor() as c:
                c.execute("SELECT COUNT(*) FROM `%s`.item_referencia_matmed" % self.BANCO)
                self.assertEqual(c.fetchone()[0], 2)  # B-1 nas duas edições é um item só, com dois preços
                c.execute("SELECT catalogo, edicao, situacao FROM `%s`.edicao_espelho ORDER BY edicao" % self.BANCO)
                self.assertEqual([list(x) for x in c.fetchall()], [["simpro", "E1", "carregada"],
                                                                   ["simpro", "E2", "carregada"]])
            sem = semente_espelho.erros_declaracao({"simpro": {"tabela": "X", "campos": {"codigo": "A"}}},
                                                   semente_espelho.licenciados())
            self.assertEqual(len(sem), 1)
        finally:
            with root.cursor() as c:
                c.execute("DROP DATABASE IF EXISTS `%s`" % self.BANCO)
            root.close()


if __name__ == "__main__":
    unittest.main()
