"""Uma execução do conector, de `abrindo` a `concluida` (ou `falhou`).

L2: pede a origem ao abridor separado (snapshot, nunca altera nem copia; o motor não tem privilégio), confere
tamanho e sha256 contra o vínculo, conta as tabelas na transação READ ONLY (progresso por tabela), roda o gstat no
mesmo snapshot (fonte independente), grava a imagem na base de controle do cliente pelo usuário restrito da execução
e concilia o que ficou gravado contra o gstat, tabela a tabela. L3: no mesmo snapshot, carrega as entidades do mapa
(carga.py: estabelecimento, usuários, pacientes, atendimentos) pelo mesmo usuário restrito e concilia cada entidade
(contagem e soma de controle relida do destino); divergência faz a execução falhar. L5 a L8: depois do L3, a carga
dirigida pelo mapa (carga_mapa.py) carrega toda tabela carregável com colunas declaradas, na ordem do mapa, com a
mesma conciliação por entidade. No fim, sha256, tamanho e mtime
do arquivo têm de ser iguais aos do início: a prova é obrigatória (não há como desligá-la).
"""
import datetime
import os
import traceback
import hashlib
import time

import pymysql

from . import (banco, caminho, carga, carga_mapa, continuar, controle, disco, imagem, mapa, plataforma,
               preco_origem, relatorio)
from .leitor import Leitor
from .servico_abridor import abrir_remoto


class FalhaExecucao(RuntimeError):
    pass


def soma_controle(contagens):
    """Resumo da contagem por tabela (ordem fixa), para comparar duas fontes de uma vez."""
    txt = "\n".join("%s=%d" % (t, int(n)) for t, n in sorted(contagens.items()))
    return hashlib.sha256(txt.encode()).hexdigest()


def motivo_conciliacao(entidades, ruins):
    """Motivo da falha da conciliação (só nomes de entidade e contagens): primeiro as entidades principais com recusa
    acima do limite, que pedem decisão (relatório L10, `recusa_acima_do_limite`), depois as que divergiram."""
    acima = [k for k in ruins if entidades[k].get(carga.REGRA_RECUSA_LIMITE)]
    outras = [k for k in ruins if k not in acima]
    partes = []
    if acima:
        partes.append("recusa acima do limite em entidade principal, decisão no relatório: %s" % ", ".join(
            "%s %d de %d" % (k, int(entidades[k].get("recusados") or 0), int(entidades[k].get("registros_origem") or 0))
            for k in acima))
    if outras:
        partes.append("conciliação por entidade divergiu: %s" % ", ".join(outras))
    return "; ".join(partes)


def _relatorio(eid, usuario, rel, cont, mapa_exec, resolver_pendencias=True):
    """L10: relatório curto da execução (ADR 0007, item 22) em `contadores.relatorio`: pendências abertas, críticas e
    resolvidas por entidade e regra, o que não carregou, a prova de não copiar e as decisões do cliente."""
    if not rel.get("senha"):
        return
    contagens = rel.get("contagens") or {}
    cr = banco.conectar(rel["ctl"], usuario=usuario, senha=rel["senha"], autocommit=False)
    try:
        cont["relatorio"] = relatorio.gerar(
            cr, rel["ctl"], eid, rel.get("entidades") or {}, contagens=contagens, plano=rel.get("plano") or (),
            carga_propria=[t for t in contagens if t in carga.MAPA], mapa_exec=mapa_exec,
            provas=rel.get("provas"), sem_mapa=cont.get("tabelas_sem_mapa"),
            resolver_pendencias=resolver_pendencias, cadeia=rel.get("cadeia"))
    finally:
        cr.close()



def tabelas_da_passada(tabelas, env=None):
    """(adiar, so, carregar) da passada. Carga em duas passadas (dono, 22/11): CONECTOR_ADIAR lista tabelas da origem
    (separadas por vírgula) que ficam para uma passada seguinte (ex.: trilhas de auditoria); a leitura, a contagem e o
    confronto com o gstat continuam sobre TODAS, só a carga delas é adiada. CONECTOR_SO: passada só de algumas tabelas
    (reprocessa o que uma correção do mapa mudou; a carga é idempotente). `carregar` é o ÚNICO conjunto entregue ao
    plano, à carga L3 e à CargaMapa.executar (que refaz o plano: receber todas as tabelas carregava as adiadas)."""
    env = os.environ if env is None else env
    adiar = {t.strip() for t in (env.get("CONECTOR_ADIAR") or "").split(",") if t.strip()}
    so = {t.strip() for t in (env.get("CONECTOR_SO") or "").split(",") if t.strip()}
    fora = adiar | (set(tabelas) - so) if so else adiar
    return adiar, so, set(tabelas) - fora

def executar(trab, eid):
    """Roda a execução `eid` já reivindicada (estado `abrindo`) por `trab`. Nunca levanta: termina em estado final."""
    conn = trab.conn
    usuario = host = mapa_exec = None
    cont = {}
    rel = {}  # o que o relatório de conciliação (L10) precisa, preenchido ao longo da execução
    try:
        ex = plataforma.consultar(conn, eid)
        cont["disco"] = disco.verificar(ex["tipo"], ex["origem_tamanho"])
        mapa_exec = mapa.carregar_execucao()  # sem o mapa não há como rever o que a origem traz: falha antes de abrir
        plataforma.progresso(conn, eid, 1, "validando o arquivo de origem", cont)
        origem = caminho.validar_origem(ex["origem_caminho"])
        if origem["tamanho"] != ex["origem_tamanho"]:
            raise FalhaExecucao("o arquivo mudou de tamanho desde o vínculo; vincule de novo")
        plataforma.progresso(conn, eid, 2, "conferindo o resumo sha256 do arquivo")
        sha_antes = caminho.sha256_arquivo(origem["absoluto"])
        if not ex["origem_sha256"] or sha_antes != ex["origem_sha256"]:
            raise FalhaExecucao("o arquivo mudou desde o vínculo (sha256 diferente); vincule de novo")
        ctl = controle.preparar(conn, ex["codigo"], ex["banco_nome"])
        # continuação: o elo vai para o controle antes de tudo (as pendências não são copiadas; todo leitor segue a
        # cadeia, controle.cadeia)
        de0 = (ex["contadores"] or {}).get("continuar_de")
        if de0:
            controle.gravar_cadeia(conn, ctl, eid, int(de0))
        rel["cadeia"] = controle.cadeia(conn, ctl, eid,
                                        lambda e: (plataforma.consultar(conn, e) or {}).get("contadores"))
        host = controle.host_do_motor(conn)
        usuario = "sscon_e%d_%s" % (eid, banco.ficha_plataforma())
        senha = controle.criar_usuario(conn, usuario, ex["banco_nome"], ctl, host)
        rel.update(ctl=ctl, senha=senha)
        nome_ab = "e%d-%s" % (eid, banco.ficha_plataforma())
        with abrir_remoto(origem["relativo"], nome_ab) as ab:
            plataforma.mudar_estado(conn, eid, "lendo", etapa="contando as tabelas da origem", percentual=5,
                                    versao_schema=ex["versao_migracao"])
            with Leitor(ab.dispositivo) as lt:
                tabelas = lt.tabelas()
                contagens, t_ult = {}, 0.0
                for i, t in enumerate(tabelas, 1):
                    contagens[t] = lt.contar(t)
                    if time.time() - t_ult > 2 or i == len(tabelas):
                        t_ult = time.time()
                        plataforma.progresso(conn, eid, 5 + 50 * i / max(1, len(tabelas)),
                                             "contadas %d de %d tabelas" % (i, len(tabelas)),
                                             dict(cont, tabelas_lidas=i, tabelas_total=len(tabelas),
                                                  registros_lidos=sum(contagens.values())))
                somente_leitura = lt.somente_leitura()
                rel["contagens"] = contagens
                generators = len(lt.generators())
            # fonte independente, no mesmo snapshot, com o leitor fechado (o embarcado não divide o arquivo)
            plataforma.progresso(conn, eid, 60, "confrontando com o gstat")
            gs = imagem.gstat_registros(ab.dispositivo)
            conf = imagem.confrontar_gstat({"contagens": contagens}, None, gs)["gstat"]
            cont.update(abertura=ab.resumo(), tabelas=len(tabelas), registros_lidos=sum(contagens.values()),
                        generators=generators, somente_leitura=bool(somente_leitura),
                        gstat={"tabelas": conf["tabelas"], "registros_total": conf["registros_total"],
                               "divergentes": conf["divergentes"]})
            if not somente_leitura:
                raise FalhaExecucao("o banco não estava em modo somente leitura na abertura")
            plataforma.mudar_estado(conn, eid, "gravando", etapa="gravando a imagem na base de controle", percentual=62,
                                    contadores=cont)
            corte = datetime.datetime.fromtimestamp(origem["mtime"], datetime.timezone.utc).replace(tzinfo=None)
            cr = banco.conectar(ctl, usuario=usuario, senha=senha, autocommit=False)
            try:
                with cr.cursor() as c:
                    c.execute("INSERT INTO imagem (execucao_id, arquivo, tamanho_bytes, sha256, corte_em, ods_versao,"
                              " pagina_bytes, tabelas, registros_total, generators, somente_leitura, criado_em)"
                              " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,UTC_TIMESTAMP(3))",
                              (eid, origem["relativo"], origem["tamanho"], sha_antes, corte, origem["ods"],
                               origem["pagina"], len(tabelas), sum(contagens.values()), generators, True))
                    iid = c.lastrowid
                    c.executemany("INSERT INTO imagem_tabela (imagem_id, tabela_origem, registros, criado_em)"
                                  " VALUES (%s,%s,%s,UTC_TIMESTAMP(3))", [(iid, t, n) for t, n in contagens.items()])
                    # o mapa e a estratégia saem da imagem de referência: a contagem DESTE cliente revê. Tabela com
                    # linhas fora do mapa (descarte "vazia" que não está vazia) vira pendência, nunca é ignorada
                    sem_mapa = mapa.tabelas_sem_mapa(contagens, mapa_exec["tabelas"], mapa_exec["descartes"])
                    if sem_mapa:
                        c.executemany("INSERT INTO pendencia (execucao_id, tabela_origem, chave_original, regra,"
                                      " gravidade, criado_em) VALUES (%s,%s,NULL,'tabela_sem_mapa','alta',"
                                      "UTC_TIMESTAMP(3))", [(eid, t) for t, _ in sem_mapa])
                cr.commit()
                cont["tabelas_sem_mapa"] = {"tabelas": len(sem_mapa), "registros": sum(n for _, n in sem_mapa)}
                with cr.cursor() as c:  # o gravado, lido de volta, contra o gstat (não contra o próprio dicionário)
                    c.execute("SELECT tabela_origem, registros FROM imagem_tabela WHERE imagem_id=%s", (iid,))
                    gravado = {t: int(n) for t, n in c.fetchall()}
                    soma_dest, soma_orig = soma_controle(gravado), soma_controle(gs)
                    ok = soma_dest == soma_orig and conf["divergentes"] == 0
                    c.execute("INSERT INTO conciliacao (execucao_id, entidade, registros_origem, registros_destino,"
                              " pendencias, soma_controle, conferido, criado_em)"
                              " VALUES (%s,'imagem',%s,%s,%s,%s,%s,UTC_TIMESTAMP(3))",
                              (eid, sum(gs.values()), sum(gravado.values()), conf["divergentes"], soma_dest, ok))
                cr.commit()
            finally:
                cr.close()
            cont.update(conciliacao={"fonte_origem": "gstat", "tabelas_origem": len(gs),
                                     "registros_origem": sum(gs.values()), "tabelas_gravadas": len(gravado),
                                     "registros_gravados": sum(gravado.values()),
                                     "divergentes": conf["divergentes"], "conferido": ok})
            if not ok:
                raise FalhaExecucao("conciliação da imagem divergiu do gstat (%d tabelas divergentes)"
                                    % max(1, conf["divergentes"]))
            # L3: carga das entidades do mapa (mesmo snapshot; leitor reaberto depois do gstat), pelo usuário restrito
            # L5 a L8: carga dirigida pelo mapa (tabelas com colunas declaradas), depois do L3, mesmo snapshot
            # Carga em duas passadas (dono, 22/11): CONECTOR_ADIAR lista tabelas da origem (separadas por vírgula) que
            # ficam para uma passada seguinte (ex.: trilhas de auditoria). A leitura, a contagem e o confronto com o
            # gstat continuam sobre TODAS; só a carga delas é adiada, e o relatório diz quais ficaram.
            adiar, so, carregar = tabelas_da_passada(tabelas)
            if adiar:
                rel["adiadas"] = cont["adiadas"] = sorted(adiar & set(tabelas))
            if so:
                rel["so"] = cont["so"] = sorted(so & set(tabelas))
            if carga.reprocessar_recusadas():  # CONECTOR_REPROCESSAR_RECUSADAS: recusadas já vistas tentadas de novo
                rel["reprocessar_recusadas"] = cont["reprocessar_recusadas"] = True
            plano = carga_mapa.planejar(mapa_exec, carregar)
            rel["plano"] = [p["tabela"] for p in plano]
            # continuação de uma importação interrompida (continuar.py): as tabelas que ela concluiu são puladas
            pular, de = frozenset(), (ex["contadores"] or {}).get("continuar_de")
            if de:
                cc0 = continuar.concluidas(conn, ctl, int(de), plano, contagens, sha_antes,
                                           lambda e: (plataforma.consultar(conn, e) or {}).get("contadores"))
                pular = dict(cc0["origem"])  # {tabela: execução que a concluiu (pendências repetidas dela)}
                rel["continuacao"] = cont["continuacao"] = {
                    "de": int(de), "regra": cc0["regra"], "tabelas_plano": len(plano), "tabelas_puladas": len(pular),
                    "linhas_puladas": sum(int(contagens.get(t, 0)) for t in pular),
                    "refeitas_duas_fases": len(cc0["duas_fases"])}
                plataforma.progresso(conn, eid, 64, "continuando a execução %d: %d de %d tabelas já concluídas"
                                     % (int(de), len(pular), len(plano)), cont)
            if any(t in carga.MAPA for t in tabelas) or plano:
                cc = banco.conectar(ex["banco_nome"], usuario=usuario, senha=senha, autocommit=False)
                try:
                    with Leitor(ab.dispositivo) as lt:
                        def prog(frac, etapa):
                            plataforma.progresso(conn, eid, 65 + (14 if plano else 28) * frac, etapa)

                        def prog_mapa(frac, etapa):
                            plataforma.progresso(conn, eid, 79 + 14 * frac, etapa)
                        # continuação: o grupo do atendimento da carga própria concluído na cadeia é pulado
                        pular_p = continuar.concluidas_propria(
                            conn, ctl, int(de), carregar, contagens, sha_antes,
                            lambda e: (plataforma.consultar(conn, e) or {}).get("contadores")) if de else {}
                        if de:
                            rel["continuacao"]["carga_propria_pulada"] = sorted(pular_p)
                        resumo = carga.Carga(lt, cc, ctl, eid, iid, prog, pular=pular_p).executar(
                            carregar, contagens) or {
                            "versao_mapa": carga.VERSAO_MAPA, "entidades": {},
                            "pendencias": {"total": 0, "criticas": 0, "por_regra": {}}, "carga": {}}
                        if plano:
                            rm = carga_mapa.CargaMapa(lt, cc, ctl, eid, iid, mapa_exec, prog_mapa,
                                                      entidades_usadas=set(resumo["entidades"]),
                                                      sincronizar=ex["tipo"] == "sincronizar",
                                                      confirmar_exclusao_em_massa=bool(
                                                          ex.get("confirmar_exclusao_em_massa")),
                                                      pular=pular, continuar_de=int(de) if de else None).executar(
                                carregar, contagens)  # ADIAR/SO valem também aqui: executar() refaz o plano
                            resumo["entidades"].update(rm["entidades"])
                            resumo["versao_mapa"] += "+" + rm["versao_mapa"]
                            pr, pm = resumo["pendencias"], rm["pendencias"]
                            pr["total"] += pm["total"]
                            pr["criticas"] += pm["criticas"]
                            for k, n in pm["por_regra"].items():
                                pr["por_regra"][k] = pr["por_regra"].get(k, 0) + n
                            resumo["carga"]["mapa"] = rm["carga"]
                            cont["sincronizar"] = rm["sincronizar"]  # L9: contagens, conflitos (sem valores), alertas
                            rel["provas"] = rm.get("provas") or {}
                        rel["entidades"] = resumo["entidades"]
                        # ADR 0009 (decisão 27): texto livre das agendas migradas -> regras estimadas, texto inteiro ao
                        # lado; no Sincronizar, só o texto que mudou é extraído de novo. A falha não derruba a carga.
                        # Mesma etapa: agenda -> profissional pelo nome, vigência por evidência (decisão 16), preço
                        # particular por médico da origem com a fonte particular classificada (decisão 24) e o repasse
                        # integral da consulta particular (preco_origem).
                        try:
                            cont["agenda_estruturada"] = preco_origem.executar(
                                cc, preco_origem.ler_origem(lt), ctl=ctl, execucao_id=eid)
                            pend = resumo["pendencias"]
                            for k, n in cont["agenda_estruturada"].get("pendencias", {}).items():
                                pend["total"] += n
                                pend["por_regra"][k] = pend["por_regra"].get(k, 0) + n
                        except Exception as e:  # noqa: BLE001 - só o tipo do erro (a mensagem pode citar valores)
                            cc.rollback()
                            cont["agenda_estruturada"] = {"falhou": type(e).__name__}
                            pend = resumo["pendencias"]
                            pend["total"] += 1
                            pend["por_regra"]["agenda:estruturar_texto_falhou:alta"] = 1
                finally:
                    cc.close()
                cont["entidades"] = {k: {x: v[x] for x in ("tabela_origem", "registros_origem", "registros_destino",
                                                          "recusados", "conferido", "soma_destino",
                                                          "aguardam_sincronizar", "editados_no_destino",
                                                          "apagados_na_origem", carga.REGRA_RECUSA_LIMITE)
                                         if x in v}
                                     for k, v in resumo["entidades"].items()}
                # L9: na carga dirigida pelo mapa, o Sincronizar reaplica a origem (vence), guarda a edição do destino
                # em conflito, exclui logicamente o que sumiu e reativa o que voltou. As 7 tabelas da carga própria
                # do L3 ainda deixam a alteração como pendência (nunca sobrescrita silenciosa).
                resumo["carga"]["modo"] = "sincronizar" if ex["tipo"] == "sincronizar" else "importar"
                cont.update(versao_mapa=resumo["versao_mapa"], pendencias=resumo["pendencias"], carga=resumo["carga"])
                ruins = sorted(k for k, v in resumo["entidades"].items() if not v["conferido"])
                if ruins:
                    raise FalhaExecucao(motivo_conciliacao(resumo["entidades"], ruins))
        # a pendência tabela_sem_mapa entra no resumo do painel (por regra), com as da carga
        if cont.get("tabelas_sem_mapa", {}).get("tabelas"):
            pend = cont.setdefault("pendencias", {"total": 0, "criticas": 0, "por_regra": {}})
            n = cont["tabelas_sem_mapa"]["tabelas"]
            pend["total"] = pend.get("total", 0) + n
            pend.setdefault("por_regra", {})["imagem:tabela_sem_mapa:alta"] = n
        plataforma.mudar_estado(conn, eid, "conciliando", etapa="conferindo contagens e o arquivo", percentual=95,
                                contadores=cont)
        plataforma.progresso(conn, eid, 97, "conferindo o arquivo de origem (sha256, tamanho e mtime)")
        depois = caminho.validar_origem(ex["origem_caminho"])
        sha_depois = caminho.sha256_arquivo(depois["absoluto"])
        if (sha_depois, depois["tamanho"], depois["mtime"]) != (sha_antes, origem["tamanho"], origem["mtime"]):
            raise FalhaExecucao("o arquivo de origem mudou durante a execução")
        cont["arquivo_inalterado"] = True
        # o relatório (e a resolução das pendências anteriores) só depois de a carga e o arquivo conferirem; a falha
        # só do relatório não derruba a carga gravada: vira pendência da plataforma
        try:
            _relatorio(eid, usuario, rel, cont, mapa_exec)
        except Exception as e:  # noqa: BLE001
            cont["relatorio_falhou"] = type(e).__name__
            pend = cont.setdefault("pendencias", {"total": 0, "criticas": 0, "por_regra": {}})
            pend["total"] = pend.get("total", 0) + 1
            pend.setdefault("por_regra", {})["imagem:relatorio_falhou:alta"] = 1
        plataforma.mudar_estado(conn, eid, "concluida", etapa="concluída", percentual=100, contadores=cont,
                                imagem_sha256=sha_antes)
    except Exception as e:  # o motivo é técnico e não traz valores de linha
        msg = str(e)
        motivo = "%s: %s" % (type(e).__name__, msg if len(msg) <= 380 else "..." + msg[-377:])
        tb = traceback.extract_tb(e.__traceback__)
        if tb:  # onde falhou (arquivo e linha do motor; nunca valores), para o diagnóstico
            motivo += " (em %s:%d)" % (os.path.basename(tb[-1].filename), tb[-1].lineno)
        if isinstance(e, pymysql.err.MySQLError):  # a mensagem do servidor pode citar valores ("Duplicate entry ...")
            motivo = "%s: erro %s do banco de destino" % (type(e).__name__, e.args[0] if e.args else "?")
        if "relatorio" not in cont:  # a execução que falha também deixa o relatório do que chegou a fazer
            try:
                _relatorio(eid, usuario, rel, cont, mapa_exec, resolver_pendencias=False)
            except Exception:  # noqa: BLE001 - o motivo da falha original é o que importa
                pass
        try:
            plataforma.mudar_estado(conn, eid, "falhou", etapa="falhou", motivo=motivo, contadores=cont or None)
        except plataforma.PlataformaErro:
            pass
    finally:
        if usuario and host:
            controle.remover_usuario(conn, usuario, host)
    return plataforma.consultar(conn, eid)
