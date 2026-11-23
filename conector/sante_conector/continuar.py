"""Continuação de uma importação interrompida (rodada retomar-importacao, 2026-11-23).

Uma importação que parou no meio (o vigia de memória derrubou o worker, a VM caiu, um erro numa tabela) não precisa
reler a origem inteira: `enfileirar <cliente> importar --continuar` (plataforma.enfileirar(..., continuar=True)) cria
uma execução nova que aponta para a interrompida (`contadores.continuar_de`). O motor dessa execução:

- confere que o arquivo é o MESMO da interrompida (sha256 da imagem gravada no controle); outro arquivo recusa;
- conta as tabelas, confronta com o gstat e grava a imagem como sempre (a prova de não alterar a origem continua);
- refaz a carga própria do L3 (pula pelo hash o que já entrou);
- na carga pelo mapa, PULA as tabelas que a interrompida concluiu (regra abaixo), sem reler a origem delas; a tabela
  pela metade e as seguintes rodam normalmente: a linha já vista é pulada pelo hash (nunca regravada), a nova entra;
- respeita CONECTOR_ADIAR e CONECTOR_SO (o plano é o mesmo da execução normal; só tira as concluídas);
- o estado em memória das tabelas puladas não é relido da origem: o de-para (`existente`) vem do conector_origem sob
  demanda (como sempre), e na conciliação a tabela pulada tem as chaves vistas e a soma da origem refeitas do
  conector_origem pelo mesmo caminho da linha "igual" (`_secundarias_ja_carregadas`); as pendências abertas da
  interrompida nessas tabelas são repetidas na execução nova (senão o relatório as daria por resolvidas);
- marca as tabelas puladas como concluídas também na execução nova (`origem='continuada'`): a continuação de uma
  continuação funciona pela marca.

Regra das tabelas concluídas da execução interrompida Y (tabela de controle `conector_tabela_concluida`):
1. Marca: se Y tem marca (toda execução desta versão grava a marca de cada onda concluída e commitada), concluídas são
   exatamente as marcadas.
2. Dedução (execução anterior à marca, como a execução 11 da ProntoCardio): a tabela T do plano está concluída quando
   a imagem de Y registrou n > 0 linhas de T, a contagem desta execução também é n (mesmo arquivo), e o
   conector_origem tem EXATAMENTE n chaves principais de T com `imagem_id` = imagem de Y. Chave principal é a que não
   tem a forma das secundárias (`<chave>/<destino>` ou `<chave>/<destino>/<rótulo>`). Cada chave com a imagem de Y foi
   gravada por Y a partir de uma linha lida do mesmo arquivo, e o registro sai no mesmo commit da linha: n chaves
   distintas = as n linhas da tabela foram processadas e commitadas. Tabela com chave de imagem anterior (linha
   "igual" de uma importação mais antiga), linhas filtradas pelo mapa ou vazia NÃO é deduzida: roda de novo (pula pelo
   hash), o que é sempre seguro.
"""
from .carga import AGORA


class NaoContinuavel(RuntimeError):
    pass


def secundaria(chave, destinos):
    """Chave de linha secundária no conector_origem: `<chave>/<destino>` ou `<chave>/<destino>/<rótulo>`."""
    for dt in destinos:
        m = "/" + dt
        if chave.endswith(m) or (m + "/") in chave:
            return True
    return False


def _sql_principal(destinos):
    cond, args = [], []
    for dt in destinos:
        cond.append("LOCATE(CONCAT('/', %s, '/'), chave_original) = 0 AND RIGHT(chave_original, %s) <> CONCAT('/', %s)")
        args += [dt, len(dt) + 1, dt]
    return " AND ".join(cond) or "TRUE", args


def concluidas(conn, ctl, anterior, plano, contagens, sha256):
    """Tabelas do plano concluídas pela execução `anterior` (regra no cabeçalho). Devolve
    {"tabelas": set, "regra": "marca"|"deducao", "imagem_anterior": id}. Recusa se o arquivo não é o mesmo."""
    with conn.cursor() as c:
        c.execute("SELECT id, sha256 FROM `%s`.imagem WHERE execucao_id=%%s" % ctl, (anterior,))
        r = c.fetchone()
        if not r:
            raise NaoContinuavel("a execução %d não gravou a imagem: não há o que continuar" % anterior)
        img, sha = r
        if not sha or sha != sha256:
            raise NaoContinuavel("o arquivo mudou desde a execução %d (sha256 diferente): importe de novo" % anterior)
        c.execute("SELECT tabela_origem FROM `%s`.conector_tabela_concluida WHERE execucao_id=%%s" % ctl, (anterior,))
        marcadas = {x[0] for x in c.fetchall()}
        if marcadas:
            return {"tabelas": {p["tabela"] for p in plano if p["tabela"] in marcadas}, "regra": "marca",
                    "imagem_anterior": img}
        c.execute("SELECT tabela_origem, registros FROM `%s`.imagem_tabela WHERE imagem_id=%%s" % ctl, (img,))
        lidas = {t: int(n) for t, n in c.fetchall()}
        saida = set()
        for p in plano:
            t = p["tabela"]
            n = lidas.get(t, 0)
            if n <= 0 or n != int(contagens.get(t, -1)):
                continue
            cond, args = _sql_principal(p["destinos"])
            c.execute("SELECT COUNT(*) FROM `%s`.conector_origem WHERE tabela_origem=%%s AND imagem_id=%%s AND %s"
                      % (ctl, cond), [t, img] + args)
            if int(c.fetchone()[0]) == n:
                saida.add(t)
        return {"tabelas": saida, "regra": "deducao", "imagem_anterior": img}


def marcar(cm, tabelas, onda=None, origem="carregada"):
    """Marca de tabela concluída (depois do commit da onda): base da continuação."""
    tabelas = sorted(set(tabelas))
    if not tabelas:
        return
    with cm._c() as c:
        c.executemany("INSERT INTO %s.conector_tabela_concluida (execucao_id, imagem_id, tabela_origem, onda, origem,"
                      " criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%s) ON DUPLICATE KEY UPDATE onda=VALUES(onda),"
                      " origem=VALUES(origem), alterado_em=%s, versao=versao+1" % (cm.ctl, AGORA, AGORA),
                      [(cm.eid, cm.img, t, onda, origem) for t in tabelas])
    cm._commit()


def repetir_pendencias(cm, anterior, tabelas):
    """Pendências abertas da interrompida nas tabelas puladas: repetidas nesta execução (só metadados: tabela, chave,
    regra, gravidade, detalhe). Sem isso o relatório desta execução as marcaria resolvidas por não as ver de novo."""
    tabelas = sorted(set(tabelas))
    if not tabelas:
        return 0
    marcas = ",".join(["%s"] * len(tabelas))
    with cm._c() as c:
        c.execute("SELECT tabela_origem, chave_original, regra, gravidade, detalhe FROM %s.pendencia WHERE execucao_id=%%s"
                  " AND situacao='aberta' AND tabela_origem IN (%s)" % (cm.ctl, marcas), [anterior] + tabelas)
        linhas = c.fetchall()
        for i in range(0, len(linhas), 5000):
            c.executemany("INSERT INTO %s.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                          " detalhe, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%s)" % (cm.ctl, AGORA),
                          [(cm.eid,) + tuple(x) for x in linhas[i:i + 5000]])
    cm.pend.extend((t, k, r, g, d) for t, k, r, g, d in linhas)
    cm._commit()
    return len(linhas)


def reconstruir(cm, p):
    """Estado da conciliação de uma tabela pulada, do conector_origem (nunca da origem): chaves vistas e soma da
    origem pelo mesmo caminho da linha "igual" de uma reexecução."""
    t, dts = p["tabela"], p["destinos"]
    ents = [cm._nome_ent(t, dt) for dt in dts]
    if t not in cm.existente:
        cm._carregar_existente(t)
    vistas = cm.vistas.setdefault(t, set())
    for chave, ant in list(cm.existente[t].items()):
        if secundaria(chave, dts):
            continue
        vistas.add(chave)
        if ant[0] is not None:
            cm._secundarias_ja_carregadas(p, ents, chave, "igual", ant)
    cm.cont["puladas_continuacao"] = cm.cont.get("puladas_continuacao", 0) + len(vistas)
