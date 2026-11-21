"""Conferência de uma fatia (F4 L5 a L8) na imagem SINTÉTICA: carga dirigida pelo mapa + conciliação, duas vezes.

`conector.sh conferir-fatia <fatia>` (no container, com o MariaDB da rede interna):
1. gera a imagem sintética só com as tabelas da fatia (`sintetica_d/<fatia>.py`, mais as que ela REQUER);
2. cria um banco de cliente descartável (`cliente_cf<fatia>`) com o DDL de destino: o do modelo (db/migracoes, só as
   tabelas de destino da fatia e os catálogos oficiais que ela usa, sem FKs: os pais de fora da fatia não existem
   aqui) ou o `DDL_DESTINO` da fatia `exemplo`; roda o `PREPARO_DESTINO`; registra os `PAIS_EXTERNOS` no
   `conector_origem` como já carregados;
3. carrega (`carga_mapa.CargaMapa`) e confere: toda entidade conciliada (contagem e soma relidas do destino), gravados
   e pendências por regra iguais ao esperado da fatia; depois roda de novo (idempotência: tudo pulado como igual,
   conciliação ainda certa, nenhuma linha nova).
Devolve {"ok", "erros", "entidades", "pendencias_por_regra", "por_tabela"}: só nomes, contagens e regras.
"""
import os
import re
import shutil
from pathlib import Path

from . import abridor, banco, carga_mapa, controle, depara, mapa, sintetica
from .leitor import Leitor

RAIZ_APP = Path(__file__).resolve().parents[1]  # /app no container (db/migracoes montado só leitura)


def _sem_fk(create):
    linhas = [l for l in create.splitlines() if not re.search(r"\bFOREIGN KEY\b|\bREFERENCES\b", l)]
    txt = "\n".join(linhas)
    return re.sub(r",\s*\n(\s*\))", r"\n\1", txt)


def ddl_destino(plano, raiz=RAIZ_APP):
    """CREATE TABLE (sem FK) das tabelas de destino do plano e dos catálogos oficiais que ele usa, mais os ADD COLUMN."""
    ddl = mapa.ler_ddl(raiz)
    alvo = []
    for p in plano:
        for dt in p["destinos"]:
            alvo.append(dt)
            for c in p["colunas"][dt]:
                cat = depara.catalogo(c["depara"])
                if cat:
                    alvo.append(cat["tabela"])
                    if cat.get("pai"):
                        alvo.append(cat["pai"])
                    if c["depara"] == "cid10":
                        alvo.append("terminologia")
    faltam = sorted({t for t in alvo if t not in ddl})
    if faltam:
        raise RuntimeError("destino sem DDL no modelo: %s" % ", ".join(faltam))
    saida, vistos = [], set()
    for t in alvo:
        if t in vistos:
            continue
        vistos.add(t)
        saida.append(_sem_fk(ddl[t]["create"]))
        saida += [a for a in ddl[t]["alter"] if "FOREIGN KEY" not in a]
    return "\n".join(saida)


def _rodar(lt, cc, ctl, eid, mapa_exec, presentes, contagens):
    c = carga_mapa.CargaMapa(lt, cc, ctl, eid, 1, mapa_exec)
    return c, c.executar(presentes, contagens)


def _comparar(c, res, esperado, erros, rodada):
    for ent, r in res["entidades"].items():
        if not r["conferido"]:
            erros.append("%s: conciliação divergiu em %s (origem %d, destino %d, recusados %d)" % (
                rodada, ent, r["registros_origem"], r["registros_destino"], r["recusados"]))
    principal = {p["tabela"]: c._nome_ent(p["tabela"], p["destinos"][0]) for p in c.plano}
    for t, esp in sorted(esperado.items()):
        if t not in principal:
            erros.append("%s: tabela da fatia fora da carga (sem coluna declarada ou fora do mapa): %s" % (rodada, t))
            continue
        r = res["entidades"][principal[t]]
        if rodada == "primeira" and r["registros_destino"] != esp.get("gravados", r["registros_destino"]):
            erros.append("%s: %s gravou %d, esperado %d" % (rodada, t, r["registros_destino"], esp["gravados"]))
        if rodada == "primeira":
            obtido = {}
            for tab, _, regra, _ in c.pend:
                if tab == t:
                    obtido[regra] = obtido.get(regra, 0) + 1
            if obtido != esp.get("pendencias", {}):
                dif = sorted(set(obtido) | set(esp.get("pendencias", {})))
                erros.append("%s: pendências de %s diferentes do esperado: %s" % (rodada, t, ", ".join(
                    "%s=%d/%d" % (k, obtido.get(k, 0), esp.get("pendencias", {}).get(k, 0)) for k in dif
                    if obtido.get(k, 0) != esp.get("pendencias", {}).get(k, 0))))


def conferir(fatia, trabalho=None, manter=False, depois_da_primeira=None):
    """Conferência completa de uma fatia. `depois_da_primeira(conn_cliente)` (testes) roda entre as duas cargas."""
    nome = sintetica.nome_modulo(fatia)
    mod = sintetica.modulo_fatia(nome)
    trabalho = trabalho or os.environ.get("CONECTOR_TRABALHO_DIR", "/trabalho")
    d = os.path.join(trabalho, "conferir-" + nome)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    arq = os.path.join(d, nome + ".fdb")
    manif = sintetica.gerar(arq, fatias=[nome])
    esperado = {}
    for f in sintetica.resolver_fatias([nome]):
        esperado.update(manif["fatias"][f])
    mapa_exec = getattr(mod, "MAPA_TESTE", None) or mapa.carregar_execucao()
    codigo = "cf" + nome
    cliente, ctl = "cliente_" + codigo, controle.nome_ctl(codigo)
    root = banco.conectar(None, multi=True)
    erros, saida = [], {}
    try:
        with root.cursor() as cur:
            for b in (cliente, ctl):
                cur.execute("DROP DATABASE IF EXISTS `%s`" % b)
            cur.execute("CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci" % cliente)
        controle.preparar(root, codigo, cliente)
        with abridor.abrir(arq, modo="snapshot", cow_mb=64) as ab:
            with Leitor(ab.dispositivo) as lt:
                presentes = set(lt.tabelas())
                contagens = {t: lt.contar(t) for t in presentes}
                plano = carga_mapa.planejar(mapa_exec, presentes)
                root.select_db(cliente)
                ddl = getattr(mod, "DDL_DESTINO", None) or ddl_destino(plano)
                if ddl.strip():  # fatia sem tabela carregável: nada a criar (L6-12, L6-13)
                    banco.aplicar_script(root, ddl)
                if getattr(mod, "PREPARO_DESTINO", None):
                    banco.aplicar_script(root, mod.PREPARO_DESTINO)
                with root.cursor() as cur:
                    i = 0
                    for t, ks in sorted(manif["pais_externos"].items()):
                        for k in ks:
                            i += 1
                            cur.execute("INSERT INTO `%s`.conector_origem (tabela_origem, chave_original,"
                                        " entidade_destino, id_destino, hash_linha, imagem_id, criado_em) VALUES"
                                        " (%%s,%%s,'externo',%%s,%%s,0,UTC_TIMESTAMP(3))" % ctl, (t, k, i, b"\0" * 16))
                cc = banco.conectar(cliente, autocommit=False)
                try:
                    c, res = _rodar(lt, cc, "%s" % ctl, 1, mapa_exec, presentes, contagens)
                    _comparar(c, res, esperado, erros, "primeira")
                    saida = {"entidades": {k: {x: v[x] for x in ("tabela_origem", "registros_origem",
                                                                 "registros_destino", "recusados", "conferido")}
                                           for k, v in res["entidades"].items()},
                             "pendencias_por_regra": res["pendencias"]["por_regra"],
                             "por_tabela": res["carga"]["por_tabela"],
                             "fase2": {k: res["carga"][k] for k in ("fase2_gravadas", "fase2_pendentes")}}
                    if depois_da_primeira:
                        depois_da_primeira(cc)
                        cc.commit()
                    c2, res2 = _rodar(lt, cc, ctl, 2, mapa_exec, presentes, contagens)
                    _comparar(c2, res2, esperado, erros, "segunda")
                    lidas = sum(int(contagens.get(p["tabela"], 0)) for p in c2.plano)
                    novas = sum(v["registros_destino"] for k, v in res2["entidades"].items()) - \
                        sum(v["registros_destino"] for k, v in res["entidades"].items())
                    if res2["carga"]["puladas_iguais"] != lidas or novas:
                        erros.append("segunda: reexecução não foi idempotente (puladas %d de %d, %d linhas novas)"
                                     % (res2["carga"]["puladas_iguais"], lidas, novas))
                    saida["segunda"] = {"puladas_iguais": res2["carga"]["puladas_iguais"],
                                        "pendencias_por_regra": res2["pendencias"]["por_regra"]}
                finally:
                    cc.close()
        if not esperado and plano:  # fatia sem tabela carregável (plano vazio): esperado {} é o correto (L6-13)
            erros.append("a fatia não declarou o esperado no destino (linhas() devolveu vazio)")
    finally:
        if not manter:
            with root.cursor() as cur:
                for b in (cliente, ctl):
                    cur.execute("DROP DATABASE IF EXISTS `%s`" % b)
            shutil.rmtree(d, ignore_errors=True)
        root.close()
    return dict(saida, ok=not erros, erros=erros, fatia=nome, cliente=cliente if manter else None)
