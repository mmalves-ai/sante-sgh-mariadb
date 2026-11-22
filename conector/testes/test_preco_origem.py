"""ADR 0009, lote conector (volta 2): preço particular por médico da origem, vigência por evidência (decisão 16),
repasse integral da consulta particular e agenda -> profissional pelo nome. Nomes e valores SINTÉTICOS.

A parte pura roda em qualquer lugar; a parte com banco roda no container do conector, num banco descartável com o DDL
do modelo, e prova: a fonte particular é classificada pelos dados (nome + uso) e só ela ganha preço por médico; a
fonte de convênio fica descartada (decisão 24); a vigência vem da evidência mais antiga, nunca da data da carga; o
Sincronizar com valor novo fecha a regra anterior; o repasse integral vira regra a 100% no grupo de consulta; a agenda
sem profissional é ligada pelo nome, e a ambígua vira pendência."""
import datetime as dt
import os
import unittest
import uuid

from sante_conector import estruturar, preco_origem as po

D = dt.date
PROFS = {10: ["ANA CLARA EXEMPLO", "DRA ANA"], 11: ["BRUNO SINTETICO SOUZA", None], 12: ["CARLA SINTETICO SOUZA", None],
         13: ["DANIEL TESTE", "DR DANIEL"]}


class Puro(unittest.TestCase):
    def test_pelo_nome(self):
        self.assertEqual(po.profissional_pelo_nome("DRA ANA CLARA - CARDIOLOGIA", PROFS), ("ligada", 10))
        self.assertEqual(po.profissional_pelo_nome("DR BRUNO SINTETICO", PROFS), ("ligada", 11))
        self.assertEqual(po.profissional_pelo_nome("SINTETICO SOUZA ECO", PROFS), ("ambigua", 2))
        self.assertEqual(po.profissional_pelo_nome("ECOCARDIOGRAMA", PROFS), ("sem", 0))
        self.assertEqual(po.profissional_pelo_nome("DR DANIEL", PROFS), ("sem", 0))   # uma palavra só não basta
        self.assertEqual(po.profissional_pelo_nome("ANA SOUZA", PROFS), ("sem", 0))   # palavras de pessoas diferentes

    def test_evidencia_sem_sentinela_nem_futuro(self):
        hoje = D(2026, 11, 22)
        self.assertEqual(po.data_evidencia([D(1899, 12, 30), None, D(2019, 3, 1), dt.datetime(2018, 5, 2, 8)], hoje),
                         D(2018, 5, 2))
        self.assertIsNone(po.data_evidencia([D(2027, 1, 1), D(1900, 1, 1), None], hoje))

    def test_classificar_particular(self):
        f = [{"id": 1, "nome": "PARTICULAR", "tipo": "outro"}, {"id": 2, "nome": "PARTICULAR PACOTE", "tipo": "outro"},
             {"id": 3, "nome": "ALFA", "tipo": "outro", "classe": "PARTICULAR"}, {"id": 4, "nome": "BETA",
                                                                                  "tipo": "convenio"}]
        self.assertEqual(po.classificar_particular(f, {1}), ([], 1))          # nome + uso
        self.assertEqual(po.classificar_particular(f, {3}), ([], 3))          # classe + uso
        self.assertEqual(po.classificar_particular(f, {1, 2}), ([], None))    # ambígua: não estima
        self.assertEqual(po.classificar_particular(f, {4}), ([], None))       # convênio nunca vira particular
        f[1]["tipo"] = "particular"
        self.assertEqual(po.classificar_particular(f, {1}), ([2], None))      # o cadastro vence


def _mariadb():
    try:
        from sante_conector import banco
        banco.conectar(None).close()
        return True
    except Exception:  # noqa: BLE001
        return False


TABS = ("fonte_pagadora", "classe_fonte_pagadora", "plano_fonte_pagadora", "agenda_servico", "agenda_fonte_pagadora",
        "profissional", "pessoa_fisica", "inscricao_conselho", "horario_agenda", "codigo_prestador_fonte_pagadora",
        "preco_consulta_origem", "regra_repasse", "regra_repasse_item", "evento_repasse", "grupo_faturamento",
        "item_faturavel") + estruturar.REGRAS[1:] + ("regra_preco_particular", "texto_origem_agenda",
                                                       "trecho_texto_agenda")


@unittest.skipUnless(os.path.exists("/opt/firebird/bin/isql") and _mariadb(),
                     "só no container do conector, com o MariaDB da rede interna")
class Banco(unittest.TestCase):
    def test_preco_vigencia_repasse_e_ligacao(self):
        from sante_conector import banco, conferencia, mapa
        ddl = mapa.ler_ddl(conferencia.RAIZ_APP)
        nome = "cliente_adr9_conector_" + uuid.uuid4().hex[:8]
        root = banco.conectar(None, multi=True)
        cc = None
        try:
            with root.cursor() as c:
                c.execute("CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci" % nome)
            root.select_db(nome)
            banco.aplicar_script(root, ";\n".join(
                [conferencia._sem_fk(ddl[t]["create"]).rstrip().rstrip(";") for t in TABS]
                + [a.rstrip().rstrip(";") for t in TABS for a in ddl[t]["alter"] if "FOREIGN KEY" not in a]) + ";")
            cc = banco.conectar(nome, autocommit=False)

            def q(sql, args=()):
                with cc.cursor() as c:
                    c.execute(sql, args)
                    return c.fetchall()
            q("INSERT INTO classe_fonte_pagadora (id, codigo, descricao, natureza, criado_em) VALUES"
              " (1,'2','PARTICULAR','outro',NOW(3)),(2,'4','CONVENIOS','outro',NOW(3))")
            for i, n, k, t in [(1, "PARTICULAR", 1, "outro"), (2, "PARTICULAR CORTESIA", 1, "outro"),
                               (3, "ALFA SAUDE", 2, "operadora"), (4, "GAMA VIDA", 2, "outro")]:
                q("INSERT INTO fonte_pagadora (id, codigo, nome, tipo, classe_fonte_pagadora_id, origem, criado_em)"
                  " VALUES (%s,%s,%s,%s,%s,'migracao',NOW(3))", (i, str(i), n, t, k))
            for pid, nm in [(10, "ANA CLARA EXEMPLO"), (11, "BRUNO SINTETICO SOUZA"), (12, "CARLA SINTETICO SOUZA")]:
                q("INSERT INTO pessoa_fisica (id, nome, criado_em) VALUES (%s,%s,NOW(3))", (pid, nm))
                q("INSERT INTO profissional (id, pessoa_fisica_id, tipo, criado_em) VALUES (%s,%s,'assistencial',"
                  "NOW(3))", (pid, pid))
                q("INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id,"
                  " unidade_federativa_id, numero_inscricao, criado_em) VALUES (%s,1,1,1,%s,NOW(3))", (pid, str(pid * 7)))
            # agenda 1: do profissional 11 pela origem (CRM), criada em 2019; agenda 2: sem profissional, nome da Ana;
            # agenda 3: sem profissional, nome ambíguo (dois SINTETICO SOUZA)
            for aid, nm, prof, ini, obs in [
                    (1, "DR BRUNO", 11, None, "VALOR DA CONSULTA PARTICULAR: R$ 250,00"),
                    (2, "DRA ANA CLARA - CARDIOLOGIA", None, D(2021, 6, 1), "VALOR DO EXAME PARTICULAR: R$ 130,00"),
                    (3, "SINTETICO SOUZA ECO", None, D(1899, 12, 30), None)]:
                q("INSERT INTO agenda_servico (id, estabelecimento_id, nome, categoria_agenda_id, setor_funcional_id,"
                  " profissional_id, duracao_horario_minutos, vigencia_inicio, codigo_origem, observacao, origem,"
                  " criado_em) VALUES (%s,1,%s,1,1,%s,20,%s,%s,%s,'migracao',NOW(3))",
                  (aid, nm, prof, ini, str(aid), obs))
            q("INSERT INTO horario_agenda (estabelecimento_id, agenda_servico_id, data_referencia, inicio_em, fim_em,"
              " origem, criado_em) VALUES (1,2,'2020-02-03','2020-02-03 08:00','2020-02-03 08:20','migracao',NOW(3)),"
              "(1,3,'2017-04-05','2017-04-05 08:00','2017-04-05 08:20','migracao',NOW(3))")
            q("INSERT INTO evento_repasse (id, estabelecimento_id, codigo, nome, natureza, tipo_lancamento,"
              " vigencia_inicio, criado_em) VALUES (1,1,'P','PRODUCAO MEDICA','rendimento','credito','2010-01-01',"
              "NOW(3))")
            q("INSERT INTO grupo_faturamento (id, codigo, descricao, tipo_grupo, criado_em) VALUES"
              " (7,'C','CONSULTAS','honorario',NOW(3)),(8,'E','EXAMES','sadt',NOW(3))")
            cc.commit()
            origem = {"agendas": [("REAGENDA", "1", "DR BRUNO", D(2019, 8, 1)), ("REAGENDA", "2",
                                                                                "DRA ANA CLARA - CARDIOLOGIA", None),
                                  ("SIAGENDA", "3", "SINTETICO SOUZA ECO", D(1899, 12, 30))],
                      # código da fonte, número no conselho, valor: particular (1) e um convênio (4) com valor
                      "valores": [("1", "77", 300), ("1", "70", 280), ("4", "77", 90), ("9", "77", 10)],
                      "marca_integral": ["1"], "faltou": []}
            hoje = D(2026, 11, 22)
            r = po.executar(cc, origem, hoje=hoje)
            # ligação pelo nome: a agenda 2 ganhou a Ana; a 3 é ambígua (pendência), nada gravado
            self.assertEqual(r["ligacao_nome"], dict(sem_profissional=2, ligadas=1, ambiguas=1,
                                                     sem_correspondencia=0), r)
            self.assertEqual(q("SELECT id, profissional_id FROM agenda_servico ORDER BY id"), ((1, 11), (2, 10),
                                                                                                (3, None)))
            self.assertEqual(r["pendencias"], {po.REGRA_AMBIGUO + ":media": 1,
                                               "fonte:particular_estimada:baixa": 1}, r)
            # fonte particular estimada pelos dados: nome + uso (a 2, também PARTICULAR, não tem valor)
            self.assertEqual(q("SELECT id FROM fonte_pagadora WHERE tipo='particular'"), ((1,),))
            pp = r["preco_profissional"]
            self.assertEqual((pp["novas"], pp["aplicadas"], pp["pendentes"], pp["sem_fonte"]), (3, 2, 1, 1), pp)
            # quanto custa a consulta particular com o Bruno: 300, vigência da agenda dele (criação 2019), não hoje
            regras = q("SELECT profissional_id, alvo, valor, vigencia_inicio, situacao_revisao FROM"
                       " regra_preco_particular WHERE profissional_id IS NOT NULL ORDER BY 1")
            self.assertEqual([(p, a, str(v), i, s) for p, a, v, i, s in regras],
                             [(10, "consulta", "280.00", D(2020, 2, 3), "estimada"),
                              (11, "consulta", "300.00", D(2019, 8, 1), "estimada")])
            # o convênio GAMA (outro) fica pendente e nunca vira regra (decisão 24)
            self.assertEqual(q("SELECT situacao FROM preco_consulta_origem WHERE fonte_pagadora_id=4"), (("pendente",),))
            # texto da agenda: preço da consulta (agenda 1) e do exame sem item (agenda 2), com vigência da evidência
            tx = q("SELECT agenda_servico_id, alvo, vigencia_inicio FROM regra_preco_particular WHERE agenda_servico_id"
                   " IS NOT NULL ORDER BY 1")
            self.assertEqual(tx, ((1, "consulta", D(2019, 8, 1)), (2, "exame", D(2020, 2, 3))))
            # repasse integral: 100% sobre o grupo de consultas, da fonte da marca, vigente desde o registro mais antigo
            (cod, ini, fonte, grupo, perc), = q(
                "SELECT r.codigo, r.vigencia_inicio, i.fonte_pagadora_id, i.grupo_faturamento_id, i.percentual FROM"
                " regra_repasse r JOIN regra_repasse_item i ON i.regra_repasse_id = r.id")
            self.assertEqual((cod, ini, fonte, grupo, float(perc)), ("INTEGRAL-PART-1", D(2017, 4, 5), 1, 7, 100.0))
            # Sincronizar: nada mudou -> nada muda
            r2 = po.executar(cc, origem, hoje=hoje)
            self.assertEqual((r2["preco_profissional"]["iguais"], r2["preco_profissional"]["novas"],
                              r2["preco_profissional"]["aplicadas"], r2["repasse_integral"]["existentes"],
                              r2["texto"]["iguais"]), (3, 0, 0, 1, 2), r2)
            # Sincronizar: valor novo do Bruno, a Ana saiu, a marca sumiu
            origem2 = dict(origem, valores=[("1", "77", 320)], marca_integral=[])
            r3 = po.executar(cc, origem2, hoje=hoje)
            p3 = r3["preco_profissional"]
            self.assertEqual((p3["valor_mudou"], p3["fechadas"], p3["aplicadas"]), (1, 3, 1), p3)
            vig = q("SELECT valor, vigencia_inicio, vigencia_fim FROM regra_preco_particular WHERE profissional_id=11"
                    " ORDER BY vigencia_inicio")
            self.assertEqual([(str(v), i, f) for v, i, f in vig], [("300.00", D(2019, 8, 1), D(2026, 11, 21)),
                                                                    ("320.00", hoje, None)])
            self.assertEqual(q("SELECT vigencia_fim FROM regra_preco_particular WHERE profissional_id=10"),
                             ((D(2026, 11, 21),),))
            self.assertEqual(r3["repasse_integral"]["fechadas"], 1)
        finally:
            if cc is not None:   # fecha antes do DROP (a transação aberta da falha prenderia o DROP)
                cc.rollback()
                cc.close()
            with root.cursor() as c:
                c.execute("DROP DATABASE IF EXISTS `%s`" % nome)
            root.close()


if __name__ == "__main__":
    unittest.main()
