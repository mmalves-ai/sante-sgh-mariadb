"""Uma execução do conector, de `abrindo` a `concluida` (ou `falhou`).

L2: abre a origem (snapshot, nunca altera nem copia), confere tamanho e sha256 contra o vínculo, conta as tabelas na
transação READ ONLY (progresso por tabela), grava a imagem na base de controle do cliente pelo usuário restrito da
execução e concilia (contagem lida = contagem gravada; sha256 antes = depois). A carga das entidades entra no L3.
"""
import datetime
import os
import time

from . import abridor, banco, caminho, controle, disco, plataforma
from .leitor import Leitor


class FalhaExecucao(RuntimeError):
    pass


def _sha_ligado():
    return os.environ.get("CONECTOR_SHA256", "sim").strip().lower() != "nao"


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
        sha_antes = None
        if _sha_ligado():
            plataforma.progresso(conn, eid, 2, "conferindo o resumo sha256 do arquivo")
            sha_antes = caminho.sha256_arquivo(origem["absoluto"])
            if sha_antes != ex["origem_sha256"]:
                raise FalhaExecucao("o arquivo mudou desde o vínculo (sha256 diferente); vincule de novo")
        ctl = controle.preparar(conn, ex["codigo"], ex["banco_nome"])
        host = controle.host_do_motor(conn)
        usuario = "sscon_e%d_%s" % (eid, banco.ficha_plataforma())
        senha = controle.criar_usuario(conn, usuario, ex["banco_nome"], ctl, host)
        nome_ab = "e%d-%s" % (eid, banco.ficha_plataforma())
        with abridor.abrir(origem["absoluto"], modo="snapshot", nome=nome_ab) as ab:
            plataforma.mudar_estado(conn, eid, "lendo", etapa="contando as tabelas da origem", percentual=5,
                                    versao_schema=ex["versao_migracao"])
            with Leitor(ab.dispositivo) as lt:
                tabelas = lt.tabelas()
                contagens, t_ult = {}, 0.0
                for i, t in enumerate(tabelas, 1):
                    contagens[t] = lt.contar(t)
                    if time.time() - t_ult > 2 or i == len(tabelas):
                        t_ult = time.time()
                        plataforma.progresso(conn, eid, 5 + 80 * i / max(1, len(tabelas)),
                                             "contadas %d de %d tabelas" % (i, len(tabelas)),
                                             dict(cont, tabelas_lidas=i, tabelas_total=len(tabelas),
                                                  registros_lidos=sum(contagens.values())))
                somente_leitura = lt.somente_leitura()
                generators = len(lt.generators())
        cont.update(abertura=ab.resumo(), tabelas=len(tabelas), registros_lidos=sum(contagens.values()),
                    generators=generators, somente_leitura=bool(somente_leitura))
        if not somente_leitura:
            raise FalhaExecucao("o banco não estava em modo somente leitura na abertura")
        plataforma.mudar_estado(conn, eid, "gravando", etapa="gravando a imagem na base de controle", percentual=85,
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
            plataforma.mudar_estado(conn, eid, "conciliando", etapa="conferindo contagens e o arquivo", percentual=95)
            with cr.cursor() as c:
                c.execute("SELECT COUNT(*), COALESCE(SUM(registros),0) FROM imagem_tabela WHERE imagem_id=%s", (iid,))
                n_tab, n_reg = c.fetchone()
                ok = (int(n_tab), int(n_reg)) == (len(tabelas), sum(contagens.values()))
                c.execute("INSERT INTO conciliacao (execucao_id, entidade, registros_origem, registros_destino,"
                          " pendencias, conferido, criado_em) VALUES (%s,'imagem',%s,%s,0,%s,UTC_TIMESTAMP(3))",
                          (eid, sum(contagens.values()), int(n_reg), ok))
            cr.commit()
        finally:
            cr.close()
        cont.update(conciliacao={"tabelas_gravadas": int(n_tab), "registros_gravados": int(n_reg), "conferido": ok})
        if not ok:
            raise FalhaExecucao("conciliação da imagem divergiu (lidas x gravadas)")
        sha_depois = caminho.sha256_arquivo(origem["absoluto"]) if _sha_ligado() else None
        if sha_antes != sha_depois:
            raise FalhaExecucao("o arquivo de origem mudou durante a execução")
        cont["arquivo_inalterado"] = sha_antes is not None and sha_antes == sha_depois
        plataforma.mudar_estado(conn, eid, "concluida", etapa="concluída", percentual=100, contadores=cont,
                                imagem_sha256=sha_antes)
    except Exception as e:  # o motivo é técnico e não traz valores de linha
        motivo = "%s: %s" % (type(e).__name__, str(e)[:420])
        try:
            plataforma.mudar_estado(conn, eid, "falhou", etapa="falhou", motivo=motivo, contadores=cont or None)
        except plataforma.PlataformaErro:
            pass
    finally:
        if usuario and host:
            controle.remover_usuario(conn, usuario, host)
    return plataforma.consultar(conn, eid)
