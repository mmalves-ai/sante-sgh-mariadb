"""Uma execução do conector, de `abrindo` a `concluida` (ou `falhou`).

L2: pede a origem ao abridor separado (snapshot, nunca altera nem copia; o motor não tem privilégio), confere
tamanho e sha256 contra o vínculo, conta as tabelas na transação READ ONLY (progresso por tabela), roda o gstat no
mesmo snapshot (fonte independente), grava a imagem na base de controle do cliente pelo usuário restrito da execução
e concilia o que ficou gravado contra o gstat, tabela a tabela. L3: no mesmo snapshot, carrega as entidades do mapa
(carga.py: estabelecimento, usuários, pacientes, atendimentos) pelo mesmo usuário restrito e concilia cada entidade
(contagem e soma de controle relida do destino); divergência faz a execução falhar. No fim, sha256, tamanho e mtime
do arquivo têm de ser iguais aos do início: a prova é obrigatória (não há como desligá-la).
"""
import datetime
import hashlib
import time

import pymysql

from . import banco, caminho, carga, controle, disco, imagem, plataforma
from .leitor import Leitor
from .servico_abridor import abrir_remoto


class FalhaExecucao(RuntimeError):
    pass


def soma_controle(contagens):
    """Resumo da contagem por tabela (ordem fixa), para comparar duas fontes de uma vez."""
    txt = "\n".join("%s=%d" % (t, int(n)) for t, n in sorted(contagens.items()))
    return hashlib.sha256(txt.encode()).hexdigest()


def executar(trab, eid):
    """Roda a execução `eid` já reivindicada (estado `abrindo`) por `trab`. Nunca levanta: termina em estado final."""
    conn = trab.conn
    usuario = host = None
    cont = {}
    try:
        ex = plataforma.consultar(conn, eid)
        cont["disco"] = disco.verificar(ex["tipo"], ex["origem_tamanho"])
        plataforma.progresso(conn, eid, 1, "validando o arquivo de origem", cont)
        origem = caminho.validar_origem(ex["origem_caminho"])
        if origem["tamanho"] != ex["origem_tamanho"]:
            raise FalhaExecucao("o arquivo mudou de tamanho desde o vínculo; vincule de novo")
        plataforma.progresso(conn, eid, 2, "conferindo o resumo sha256 do arquivo")
        sha_antes = caminho.sha256_arquivo(origem["absoluto"])
        if not ex["origem_sha256"] or sha_antes != ex["origem_sha256"]:
            raise FalhaExecucao("o arquivo mudou desde o vínculo (sha256 diferente); vincule de novo")
        ctl = controle.preparar(conn, ex["codigo"], ex["banco_nome"])
        host = controle.host_do_motor(conn)
        usuario = "sscon_e%d_%s" % (eid, banco.ficha_plataforma())
        senha = controle.criar_usuario(conn, usuario, ex["banco_nome"], ctl, host)
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
                cr.commit()
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
            if any(t in carga.MAPA for t in tabelas):
                cc = banco.conectar(ex["banco_nome"], usuario=usuario, senha=senha, autocommit=False)
                try:
                    with Leitor(ab.dispositivo) as lt:
                        def prog(frac, etapa):
                            plataforma.progresso(conn, eid, 65 + 28 * frac, etapa)
                        resumo = carga.Carga(lt, cc, ctl, eid, iid, prog).executar(set(tabelas), contagens)
                finally:
                    cc.close()
                cont["entidades"] = {k: {x: v[x] for x in ("tabela_origem", "registros_origem", "registros_destino",
                                                          "recusados", "conferido", "soma_destino")}
                                     for k, v in resumo["entidades"].items()}
                cont.update(versao_mapa=resumo["versao_mapa"], pendencias=resumo["pendencias"], carga=resumo["carga"])
                ruins = sorted(k for k, v in resumo["entidades"].items() if not v["conferido"])
                if ruins:
                    raise FalhaExecucao("conciliação por entidade divergiu: %s" % ", ".join(ruins))
        plataforma.mudar_estado(conn, eid, "conciliando", etapa="conferindo contagens e o arquivo", percentual=95,
                                contadores=cont)
        plataforma.progresso(conn, eid, 97, "conferindo o arquivo de origem (sha256, tamanho e mtime)")
        depois = caminho.validar_origem(ex["origem_caminho"])
        sha_depois = caminho.sha256_arquivo(depois["absoluto"])
        if (sha_depois, depois["tamanho"], depois["mtime"]) != (sha_antes, origem["tamanho"], origem["mtime"]):
            raise FalhaExecucao("o arquivo de origem mudou durante a execução")
        cont["arquivo_inalterado"] = True
        plataforma.mudar_estado(conn, eid, "concluida", etapa="concluída", percentual=100, contadores=cont,
                                imagem_sha256=sha_antes)
    except Exception as e:  # o motivo é técnico e não traz valores de linha
        motivo = "%s: %s" % (type(e).__name__, str(e)[:420])
        if isinstance(e, pymysql.err.MySQLError):  # a mensagem do servidor pode citar valores ("Duplicate entry ...")
            motivo = "%s: erro %s do banco de destino" % (type(e).__name__, e.args[0] if e.args else "?")
        try:
            plataforma.mudar_estado(conn, eid, "falhou", etapa="falhou", motivo=motivo, contadores=cont or None)
        except plataforma.PlataformaErro:
            pass
    finally:
        if usuario and host:
            controle.remover_usuario(conn, usuario, host)
    return plataforma.consultar(conn, eid)
