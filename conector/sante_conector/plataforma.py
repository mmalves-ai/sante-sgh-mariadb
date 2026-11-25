"""Fila e origem do conector no banco `plataforma` (db/plataforma/0003): vincular, enfileirar, transições e eventos.

Toda mudança de estado grava o evento em `cliente_evento` NA MESMA TRANSAÇÃO (conector_vinculo, conector_carga,
conector_diferencial). Detalhes de evento e de execução só com ids, estados, contagens e motivos técnicos.
"""
import datetime
import json

import pymysql

from . import caminho

# `pausando` (0093): ativo e rodando (entra na trava de uma execução ativa por cliente e em recuperar_orfas); o motor
# para no próximo ponto seguro e termina em `pausada`, que é FINAL (concluido_em preenchido). A retomada é uma execução
# nova com continuação (enfileirar(continuar=True)), nunca uma transição a partir de `pausada`.
ATIVOS = ("fila", "abrindo", "lendo", "gravando", "conciliando", "pausando")
RODANDO = ATIVOS[1:]
FINAIS = ("concluida", "falhou", "cancelada", "pausada")
CONTINUAVEIS = ("falhou", "pausada")
TRANSICOES = {"fila": {"abrindo", "cancelada", "falhou"}, "abrindo": {"lendo", "falhou", "pausando"},
              "lendo": {"gravando", "falhou", "pausando"}, "gravando": {"conciliando", "falhou", "pausando"},
              "conciliando": {"concluida", "falhou", "pausando"}, "pausando": {"pausada", "falhou"}}
EVENTO = {"importar": "conector_carga", "sincronizar": "conector_diferencial"}
MODOS = ("completa", "diferencial")
AGORA = "UTC_TIMESTAMP(3)"


class PlataformaErro(RuntimeError):
    pass


class ExecucaoAtiva(PlataformaErro):
    """409: já há uma execução na fila ou rodando para o cliente."""


def _evento(cur, cliente_id, tipo, detalhe, admin_id=None):
    cur.execute("INSERT INTO cliente_evento (cliente_id, tipo, detalhe, ocorrido_em, administrador_plataforma_id,"
                " criado_em, criado_por) VALUES (%s, %s, %s, " + AGORA + ", %s, " + AGORA + ", %s)",
                (cliente_id, tipo, json.dumps(detalhe, ensure_ascii=False, sort_keys=True), admin_id, admin_id))


def _cliente(cur, codigo, travar=True):
    cur.execute("SELECT id, codigo, banco_nome, versao_migracao FROM cliente WHERE codigo=%s"
                + (" FOR UPDATE" if travar else ""), (codigo,))
    r = cur.fetchone()
    if not r:
        raise PlataformaErro("cliente inexistente")
    return {"id": r[0], "codigo": r[1], "banco_nome": r[2], "versao_migracao": r[3]}


class _Tx:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        self.conn.begin()
        self.cur = self.conn.cursor()
        return self.cur

    def __exit__(self, tipo, *a):
        self.cur.close()
        if tipo is None:
            self.conn.commit()
        else:
            self.conn.rollback()


def vincular_origem(conn, codigo, relativo, admin_id=None, sha256=None):
    """Valida o arquivo na pasta autorizada, registra-o como a origem ativa do cliente e grava `conector_vinculo`.
    A origem anterior fica inativa (histórico). Recusa durante uma execução ativa do cliente."""
    v = caminho.validar_origem(relativo)
    sha = sha256 or caminho.sha256_arquivo(v["absoluto"])
    mod = datetime.datetime.fromtimestamp(v["mtime"], datetime.timezone.utc).replace(tzinfo=None)
    with _Tx(conn) as cur:
        cli = _cliente(cur, codigo)
        cur.execute("SELECT COUNT(*) FROM conector_execucao WHERE cliente_ativo=%s", (cli["id"],))
        if cur.fetchone()[0]:
            raise ExecucaoAtiva("há execução ativa do cliente; a origem não muda durante a execução")
        cur.execute("UPDATE cliente_origem SET ativo=FALSE, alterado_em=" + AGORA + ", alterado_por=%s,"
                    " versao=versao+1 WHERE cliente_id=%s AND ativo", (admin_id, cli["id"]))
        anteriores = cur.rowcount
        cur.execute("INSERT INTO cliente_origem (cliente_id, tipo, caminho_relativo, tamanho_bytes, sha256,"
                    " modificado_em, ods_versao, pagina_bytes, vinculado_em, vinculado_por, ativo, criado_em, criado_por)"
                    " VALUES (%s, 'firebird_arquivo', %s, %s, %s, %s, %s, %s, " + AGORA + ", %s, TRUE, " + AGORA + ", %s)",
                    (cli["id"], v["relativo"], v["tamanho"], sha, mod, v["ods"], v["pagina"], admin_id, admin_id))
        oid = cur.lastrowid
        _evento(cur, cli["id"], "conector_vinculo",
                {"cliente_origem_id": oid, "arquivo": v["relativo"], "tamanho_bytes": v["tamanho"],
                 "sha256": sha, "ods": v["ods"], "pagina": v["pagina"], "origens_desativadas": anteriores}, admin_id)
    return {"cliente_origem_id": oid, "arquivo": v["relativo"], "tamanho_bytes": v["tamanho"], "sha256": sha}


def enfileirar(conn, codigo, tipo, admin_id=None, confirmar_exclusao_em_massa=False, continuar=False, modo=None,
               reprocessar=False):
    """Põe uma execução na fila. ExecucaoAtiva (409) se já houver uma ativa para o cliente (índice único).
    `confirmar_exclusao_em_massa` (só Sincronizar): exclui o que o alerta de exclusão em massa reteve; quem pediu
    fica no evento. `continuar` (só Importar): continua a última importação do cliente, interrompida (`falhou`) ou
    pausada (`pausada`, 0093) com a mesma origem vinculada; a execução nova leva `contadores.continuar_de` e o motor
    pula as tabelas que ela concluiu (continuar.py). `modo` (0093: completa ou diferencial, tela de carga) fica na
    execução; `reprocessar` leva `contadores.reprocessar_recusadas` (o motor tenta de novo as recusadas)."""
    if modo is not None and modo not in MODOS:
        raise PlataformaErro("modo inválido: completa ou diferencial")
    if continuar and tipo != "importar":
        raise PlataformaErro("continuar só vale para o Importar")
    if tipo not in EVENTO:
        raise PlataformaErro("tipo inválido: importar ou sincronizar")
    confirmar = bool(confirmar_exclusao_em_massa)
    if confirmar and tipo != "sincronizar":
        raise PlataformaErro("a confirmação da exclusão em massa só vale para o Sincronizar")
    try:
        with _Tx(conn) as cur:
            cli = _cliente(cur, codigo)
            cur.execute("SELECT id FROM cliente_origem WHERE cliente_ativo=%s", (cli["id"],))
            r = cur.fetchone()
            if not r:
                raise PlataformaErro("cliente sem origem vinculada")
            if tipo == "sincronizar":
                cur.execute("SELECT COUNT(*) FROM conector_execucao WHERE cliente_id=%s AND tipo='importar'"
                            " AND estado='concluida'", (cli["id"],))
                if not cur.fetchone()[0]:
                    raise PlataformaErro("sincronizar exige uma importação concluída")
            contadores = {"reprocessar_recusadas": True} if reprocessar else {}
            if continuar:
                cur.execute("SELECT id, estado, cliente_origem_id FROM conector_execucao WHERE cliente_id=%s"
                            " AND tipo='importar' ORDER BY id DESC LIMIT 1", (cli["id"],))
                u = cur.fetchone()
                if not u or u[1] not in CONTINUAVEIS:
                    raise PlataformaErro("continuar exige que a última importação do cliente tenha sido interrompida"
                                         " (falhou) ou pausada")
                if u[2] != r[0]:
                    raise PlataformaErro("continuar exige a mesma origem vinculada da importação interrompida")
                contadores["continuar_de"] = u[0]
            cur.execute("INSERT INTO conector_execucao (cliente_id, cliente_origem_id, tipo, estado, etapa,"
                        " confirmar_exclusao_em_massa, contadores, modo, solicitado_em, solicitado_por, criado_em,"
                        " criado_por) VALUES (%s, %s, %s, 'fila', 'aguardando o motor', %s, %s, %s, " + AGORA + ", %s, "
                        + AGORA + ", %s)", (cli["id"], r[0], tipo, confirmar,
                                            json.dumps(contadores, sort_keys=True) if contadores else None, modo,
                                            admin_id, admin_id))
            eid = cur.lastrowid
            det = {"execucao_id": eid, "estado": "fila", "tipo": tipo}
            if contadores.get("continuar_de"):
                det["continuar_de"] = contadores["continuar_de"]
            if modo:
                det["modo"] = modo
            if reprocessar:
                det["reprocessar_recusadas"] = True
            if confirmar:
                det.update(confirmar_exclusao_em_massa=True, confirmado_por=admin_id)
            _evento(cur, cli["id"], EVENTO[tipo], det, admin_id)
        return eid
    except pymysql.err.IntegrityError as e:
        if e.args and e.args[0] == 1062:
            raise ExecucaoAtiva("já há uma execução ativa para o cliente") from None
        raise


def _ler_execucao(cur, eid, travar=False):
    cur.execute("SELECT e.id, e.cliente_id, e.tipo, e.estado, e.etapa, e.percentual, e.contadores, e.motivo_falha,"
                " e.trabalhador, e.imagem_sha256, e.versao_schema, e.solicitado_em, e.iniciado_em, e.concluido_em,"
                " c.codigo, c.banco_nome, c.versao_migracao, o.id, o.caminho_relativo, o.tamanho_bytes, o.sha256,"
                " e.confirmar_exclusao_em_massa, o.tipo, e.modo, e.arquivo_log, e.pausa_solicitada_em"
                " FROM conector_execucao e JOIN cliente c ON c.id=e.cliente_id"
                " JOIN cliente_origem o ON o.id=e.cliente_origem_id WHERE e.id=%s"
                + (" FOR UPDATE" if travar else ""), (eid,))
    r = cur.fetchone()
    if not r:
        raise PlataformaErro("execução inexistente")
    k = ("id cliente_id tipo estado etapa percentual contadores motivo_falha trabalhador imagem_sha256 versao_schema"
         " solicitado_em iniciado_em concluido_em codigo banco_nome versao_migracao origem_id origem_caminho"
         " origem_tamanho origem_sha256 confirmar_exclusao_em_massa origem_tipo modo arquivo_log"
         " pausa_solicitada_em").split()
    d = dict(zip(k, r))
    d["percentual"] = float(d["percentual"])
    d["contadores"] = json.loads(d["contadores"]) if d["contadores"] else {}
    return d


def consultar(conn, eid):
    with conn.cursor() as cur:
        return _ler_execucao(cur, eid)


def _fim(motivo, n=500):
    """Motivo no limite da coluna guardando o FIM: a última linha (tipo, código, tabela, arquivo:linha) é a que
    explica a falha; o começo de um texto longo (cabeçalho de traceback) é o que se perde."""
    return motivo if len(motivo) <= n else "..." + motivo[-(n - 3):]


def transicao(cur, eid, novo, etapa=None, motivo=None, admin_id=None, **campos):
    """Muda o estado dentro de uma transação aberta e grava o evento junto. Recusa transição inválida."""
    ex = _ler_execucao(cur, eid, travar=True)
    if novo not in TRANSICOES.get(ex["estado"], ()):
        raise PlataformaErro("transição inválida: %s -> %s" % (ex["estado"], novo))
    sets, vals = ["estado=%s", "alterado_em=" + AGORA, "versao=versao+1", "batimento_em=" + AGORA], [novo]
    if etapa is not None:
        sets.append("etapa=%s"); vals.append(etapa[:120])
    if motivo is not None:
        sets.append("motivo_falha=%s"); vals.append(_fim(motivo))
    if novo == "abrindo":
        sets.append("iniciado_em=" + AGORA)
    if novo in FINAIS:
        sets.append("concluido_em=" + AGORA)
    for col in ("percentual", "contadores", "imagem_sha256", "versao_schema", "trabalhador"):
        if col in campos:
            v = campos[col]
            sets.append(col + "=%s"); vals.append(json.dumps(v, sort_keys=True) if col == "contadores" else v)
    cur.execute("UPDATE conector_execucao SET " + ", ".join(sets) + " WHERE id=%s", vals + [eid])
    det = {"execucao_id": eid, "estado": novo, "tipo": ex["tipo"], "de": ex["estado"]}
    if motivo:
        det["motivo"] = _fim(motivo)
    if novo == "concluida" and "contadores" in campos:
        det["contadores"] = campos["contadores"]
    _evento(cur, ex["cliente_id"], EVENTO[ex["tipo"]], det, admin_id)
    return ex


def mudar_estado(conn, eid, novo, **kw):
    with _Tx(conn) as cur:
        return transicao(cur, eid, novo, **kw)


def progresso(conn, eid, percentual, etapa=None, contadores=None):
    """Progresso sem evento (o histórico registra só as mudanças de estado)."""
    sets, vals = ["percentual=%s", "batimento_em=" + AGORA], [round(max(0.0, min(100.0, percentual)), 2)]
    if etapa is not None:
        sets.append("etapa=%s"); vals.append(etapa[:120])
    if contadores is not None:
        sets.append("contadores=%s"); vals.append(json.dumps(contadores, sort_keys=True))
    with conn.cursor() as cur:
        cur.execute("UPDATE conector_execucao SET " + ", ".join(sets) + " WHERE id=%s AND estado IN ('abrindo',"
                    "'lendo','gravando','conciliando','pausando')", vals + [eid])


def gravar_arquivo_log(conn, eid, relativo):
    """Caminho do log da execução, relativo a CONECTOR_LOG_DIR (registro_log.py); sem evento."""
    with conn.cursor() as cur:
        cur.execute("UPDATE conector_execucao SET arquivo_log=%s WHERE id=%s", (relativo[:255], eid))


def pausa_solicitada(conn, eid):
    """True quando a plataforma pediu a pausa da execução (`pausa_solicitada_em`, gravado pela tela ou pela CLI)."""
    with conn.cursor() as cur:
        cur.execute("SELECT pausa_solicitada_em IS NOT NULL FROM conector_execucao WHERE id=%s", (eid,))
        r = cur.fetchone()
    return bool(r and r[0])


def gravar_identidade(conn, origem_id, identidade):
    """Identidade técnica da base lida (origem servidor; sem dado de pessoa) na origem do cliente."""
    with conn.cursor() as cur:
        cur.execute("UPDATE cliente_origem SET identidade_base=%s WHERE id=%s",
                    (json.dumps(identidade, sort_keys=True), origem_id))


def _ultima(cur, cliente_id, tipo=None):
    cur.execute("SELECT id, tipo, estado, cliente_origem_id, modo, contadores FROM conector_execucao"
                " WHERE cliente_id=%s" + (" AND tipo=%s" if tipo else "") + " ORDER BY id DESC LIMIT 1",
                (cliente_id, tipo) if tipo else (cliente_id,))
    r = cur.fetchone()
    if not r:
        return None
    return {"id": r[0], "tipo": r[1], "estado": r[2], "origem_id": r[3], "modo": r[4],
            "contadores": json.loads(r[5]) if r[5] else {}}


def enfileirar_carga(conn, codigo, modo, admin_id=None):
    """Iniciar carga pela tela (obra carga-painel). `completa`: importação. `diferencial`: com importação concluída,
    Sincronizar; sem ela, importação que continua a última (pausada ou interrompida) quando é da MESMA origem ativa,
    senão importação simples (o hash pula as linhas iguais). O diferencial sempre tenta de novo as recusadas."""
    if modo not in MODOS:
        raise PlataformaErro("modo inválido: completa ou diferencial")
    if modo == "completa":
        return enfileirar(conn, codigo, "importar", admin_id, modo=modo)
    with conn.cursor() as cur:
        cli = _cliente(cur, codigo, travar=False)
        cur.execute("SELECT COUNT(*) FROM conector_execucao WHERE cliente_id=%s AND tipo='importar'"
                    " AND estado='concluida'", (cli["id"],))
        concluida = bool(cur.fetchone()[0])
        cur.execute("SELECT id FROM cliente_origem WHERE cliente_ativo=%s", (cli["id"],))
        o = cur.fetchone()
        u = _ultima(cur, cli["id"], "importar")
    if concluida:
        return enfileirar(conn, codigo, "sincronizar", admin_id, modo=modo, reprocessar=True)
    continuar = bool(u and o and u["estado"] in CONTINUAVEIS and u["origem_id"] == o[0])
    return enfileirar(conn, codigo, "importar", admin_id, continuar=continuar, modo=modo, reprocessar=True)


def retomar(conn, codigo, admin_id=None):
    """Retomar pela tela: a última execução do cliente ficou `pausada` (ou `falhou`). Importação: continuação
    (`--continuar`, pula as tabelas concluídas); Sincronizar: um Sincronizar novo (o hash pula o que já entrou). O modo
    e o reprocessamento das recusadas são os da execução retomada."""
    with conn.cursor() as cur:
        cli = _cliente(cur, codigo, travar=False)
        u = _ultima(cur, cli["id"])
    if not u or u["estado"] not in CONTINUAVEIS:
        raise PlataformaErro("retomar exige que a última execução do cliente esteja pausada ou interrompida")
    rep = bool(u["contadores"].get("reprocessar_recusadas"))
    if u["tipo"] == "sincronizar":
        return enfileirar(conn, codigo, "sincronizar", admin_id, modo=u["modo"], reprocessar=rep)
    return enfileirar(conn, codigo, "importar", admin_id, continuar=True, modo=u["modo"], reprocessar=rep)


def cancelar(conn, eid, admin_id=None):
    """Só execução ainda na fila (a que já rodando termina ou falha pelo motor)."""
    mudar_estado(conn, eid, "cancelada", etapa="cancelada antes de iniciar", admin_id=admin_id)


def listar(conn, limite=50):
    with conn.cursor() as cur:
        cur.execute("SELECT e.id, c.codigo, e.tipo, e.estado, e.percentual, e.etapa, e.solicitado_em, e.concluido_em"
                    " FROM conector_execucao e JOIN cliente c ON c.id=e.cliente_id ORDER BY e.id DESC LIMIT %s",
                    (limite,))
        return [dict(zip(("id", "cliente", "tipo", "estado", "percentual", "etapa", "solicitado_em", "concluido_em"),
                         (r[0], r[1], r[2], r[3], float(r[4]), r[5], r[6], r[7]))) for r in cur.fetchall()]


# ----- continuidade declarada entre origens (0094, ADR 0010) -----
EVENTO_CONTINUIDADE = "origem_continua_de"


def declarar_continuidade(conn, codigo, origem_nova, origem_anterior, admin_id=None, motivo=None):
    """O administrador declara que a origem `origem_nova` lê a MESMA base que `origem_anterior` (mesmo cliente): a
    continuação de uma importação passa a aproveitar as marcas de tabela concluída da anterior (continuar.py). Vai
    para `cliente_origem.continua_de_origem_id` e para o evento do cliente, com a prova (identidade) quando houver.
    `origem_anterior=None` desfaz a declaração."""
    with _Tx(conn) as cur:
        cli = _cliente(cur, codigo)
        ids = [int(origem_nova)] + ([int(origem_anterior)] if origem_anterior is not None else [])
        cur.execute("SELECT id, cliente_id FROM cliente_origem WHERE id IN (%s)" % ",".join(["%s"] * len(ids)), ids)
        donos = {int(i): int(c) for i, c in cur.fetchall()}
        if any(donos.get(i) != cli["id"] for i in ids):
            raise PlataformaErro("as duas origens precisam ser do mesmo cliente")
        if origem_anterior is not None and int(origem_anterior) == int(origem_nova):
            raise PlataformaErro("a origem não continua a si mesma")
        cur.execute("UPDATE cliente_origem SET continua_de_origem_id=%s, alterado_em=" + AGORA + ", alterado_por=%s"
                    " WHERE id=%s", (origem_anterior, admin_id, int(origem_nova)))
        det = {"origem": int(origem_nova), "continua_de_origem": origem_anterior}
        if origem_anterior is not None:
            det["prova"] = _prova_base(cur, int(origem_nova), int(origem_anterior))
        if motivo:
            det["motivo"] = str(motivo)[:300]
        _evento(cur, cli["id"], EVENTO_CONTINUIDADE, det, admin_id)
    return det


def _ident(v):
    if not v:
        return {}
    return v if isinstance(v, dict) else json.loads(v)


def _prova_base(cur, nova, anterior):
    """Confronto da identidade técnica das duas origens (sem dado de pessoa): 'confere', 'difere' (com os campos) ou
    'sem_prova' (nenhum campo comum aos dois lados). Campos: ODS e página (colunas ou identidade) e os campos comuns
    das duas identidades."""
    lados = {}
    for oid in (nova, anterior):
        cur.execute("SELECT ods_versao, pagina_bytes, identidade_base FROM cliente_origem WHERE id=%s", (oid,))
        r = cur.fetchone()
        if not r:
            return {"situacao": "sem_prova", "campos": []}
        ident = _ident(r[2])
        d = {k: v for k, v in ident.items() if k != "ods"}
        if ident.get("ods") is not None:
            d["ods_maior"] = int(str(ident["ods"]).split(".")[0])
        elif r[0] is not None:
            d["ods_maior"] = int(r[0])
        if d.get("pagina_bytes") is None and r[1] is not None:
            d["pagina_bytes"] = int(r[1])
        lados[oid] = d
    a, b = lados[nova], lados[anterior]
    comuns = sorted(k for k in set(a) & set(b) if a[k] is not None and b[k] is not None
                    and k not in ("versao_servidor", "nome_base"))
    difs = [k for k in comuns if str(a[k]) != str(b[k])]
    return {"situacao": "difere" if difs else ("confere" if comuns else "sem_prova"), "campos": comuns,
            "diferentes": difs}


def base_equivalente(conn, execucao_id):
    """Continuidade declarada (0094) da origem da execução `execucao_id`: None sem declaração (comportamento de
    sempre); senão {"origem", "origem_anterior", "execucao_anterior" (a última importação da origem anterior),
    "sha256_aceitos" (o resumo que a imagem da origem anterior gravou), "prova": confere|sem_prova|difere,
    "aceita": bool}. Prova que difere recusa (aceita=False): a base não é a mesma. Tolerante: sem as tabelas da
    plataforma na conexão (testes do controle), devolve None."""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT o.id, o.cliente_id, o.continua_de_origem_id FROM conector_execucao e JOIN cliente_origem o"
                        " ON o.id=e.cliente_origem_id WHERE e.id=%s", (int(execucao_id),))
            r = cur.fetchone()
            if not r or not r[2]:
                return None
            oid, cid, ant = int(r[0]), int(r[1]), int(r[2])
            cur.execute("SELECT cliente_id, tipo, sha256, identidade_base FROM cliente_origem WHERE id=%s", (ant,))
            a = cur.fetchone()
            if not a or int(a[0]) != cid:
                return None
            prova = _prova_base(cur, oid, ant)
            cur.execute("SELECT id FROM conector_execucao WHERE cliente_origem_id=%s AND tipo='importar'"
                        " AND estado IN ('concluida','falhou','pausada') ORDER BY id DESC LIMIT 1", (ant,))
            e = cur.fetchone()
    except pymysql.err.MySQLError:
        return None
    aceitos = set()
    if a[2]:
        aceitos.add(a[2])
    if a[3]:
        import hashlib
        aceitos.add(hashlib.sha256(json.dumps(_ident(a[3]), sort_keys=True, ensure_ascii=True).encode()).hexdigest())
    return {"origem": oid, "origem_anterior": ant, "execucao_anterior": int(e[0]) if e else None,
            "sha256_aceitos": sorted(aceitos), "prova": prova["situacao"], "prova_campos": prova["campos"],
            "aceita": prova["situacao"] != "difere" and bool(e)}
