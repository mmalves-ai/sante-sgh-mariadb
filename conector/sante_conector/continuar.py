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
3. Nas duas regras, o total de chaves principais de T no conector_origem (de QUALQUER imagem) não pode passar da
   contagem desta execução: chave de linha que sumiu do arquivo (trazida por importação anterior) entraria nas chaves
   vistas refeitas e a conciliação divergiria; a tabela roda de novo (na dedução o total é exatamente n).
4. Tabela com coluna em duas fases (autorreferência ou ciclo declarado: NULL na linha, UPDATE no `_fase2` depois de
   todas as ondas) NUNCA é pulada: a referência adiada só existe na memória e a interrompida pode ter caído antes do
   `_fase2` (a marca da onda vem antes dele). Ela roda de novo; na linha "igual" cujo destino tem a coluna NULL, a
   referência adiada é refeita da linha lida (`CargaMapa._readiar`) e o `_fase2` a grava só se continuar NULL
   (`AND coluna IS NULL`: nunca sobrescreve).
5. Cadeia: se Y é ela mesma uma continuação (`contadores.continuar_de` = X) e falhou cedo (sem imagem, ou antes de
   marcar o que herdou), as concluídas de X entram também; as pendências de cada tabela pulada são repetidas da
   execução que a concluiu.
"""
from .carga import AGORA


class NaoContinuavel(RuntimeError):
    pass


class SemImagem(NaoContinuavel):
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


def duas_fases(p):
    """A tabela tem coluna que pode ir para a fase 2 (autorreferência ou ciclo declarado em duas fases: NULL na
    linha, UPDATE no fim). A referência adiada vive só na memória até o `_fase2`: tabela assim nunca é pulada."""
    from .carga_mapa import _passos_em_duas_fases
    return any((c.get("referencia") in p["duas_fases"] and not c.get("passos")) or _passos_em_duas_fases(c, p)
               for cs in (p.get("colunas") or {}).values() for c in cs)


def _uma(conn, ctl, anterior, plano, contagens, sha256):
    """Concluídas pela própria execução `anterior` (marca ou dedução), sem a cadeia."""
    with conn.cursor() as c:
        c.execute("SELECT id, sha256 FROM `%s`.imagem WHERE execucao_id=%%s" % ctl, (anterior,))
        r = c.fetchone()
        if not r:
            raise SemImagem("a execução %d não gravou a imagem: não há o que continuar" % anterior)
        img, sha = r
        if not sha or sha != sha256:
            raise NaoContinuavel("o arquivo mudou desde a execução %d (sha256 diferente): importe de novo" % anterior)
        c.execute("SELECT tabela_origem FROM `%s`.conector_tabela_concluida WHERE execucao_id=%%s" % ctl, (anterior,))
        marcadas = {x[0] for x in c.fetchall()}
        c.execute("SELECT tabela_origem, registros FROM `%s`.imagem_tabela WHERE imagem_id=%%s" % ctl, (img,))
        lidas = {t: int(n) for t, n in c.fetchall()}
        saida = set()
        for p in plano:
            t = p["tabela"]
            if marcadas and t not in marcadas:
                continue
            n = int(contagens.get(t, -1))
            if not marcadas and (lidas.get(t, 0) <= 0 or lidas.get(t, 0) != n):
                continue
            cond, args = _sql_principal(p["destinos"])
            c.execute("SELECT COUNT(*), COALESCE(SUM(imagem_id=%%s), 0) FROM `%s`.conector_origem"
                      " WHERE tabela_origem=%%s AND %s" % (ctl, cond), [img, t] + args)
            total, desta = (int(x) for x in c.fetchone())
            # mais chaves principais (de qualquer imagem) que linhas no arquivo: há chave antiga que sumiu do arquivo
            # e entraria nas vistas refeitas (a conciliação divergiria); a tabela roda de novo
            if total > n:
                continue
            if marcadas or desta == n:
                saida.add(t)
        return saida, ("marca" if marcadas else "deducao"), img


def concluidas(conn, ctl, anterior, plano, contagens, sha256, contadores_de=None):
    """Tabelas do plano concluídas pela execução `anterior` (regra no cabeçalho). Devolve {"tabelas": set,
    "regra": "marca"|"deducao" (com "+cadeia" quando herdou), "imagem_anterior": id, "origem": {tabela: execução
    das pendências}, "duas_fases": tabelas refeitas por terem coluna em duas fases}. Recusa se o arquivo não é o
    mesmo. `contadores_de(id)`: contadores da execução (cadeia de continuações; None = sem cadeia)."""
    de = None
    if contadores_de is not None:
        de = (contadores_de(anterior) or {}).get("continuar_de")
    try:
        tabs, regra, img = _uma(conn, ctl, anterior, plano, contagens, sha256)
    except SemImagem:
        if not de:
            raise
        tabs, regra, img = set(), "sem_imagem", None
    origem = {t: anterior for t in tabs}
    if de:  # a continuação `anterior` falhou antes de marcar o que herdou: herda da que ela continuava
        r = concluidas(conn, ctl, int(de), plano, contagens, sha256, contadores_de)
        for t, e in r["origem"].items():
            origem.setdefault(t, e)
        regra = "%s+cadeia(%d)" % (regra, int(de))
        img = img or r["imagem_anterior"]
    refazer = {p["tabela"] for p in plano if p["tabela"] in origem and duas_fases(p)}
    for t in refazer:
        origem.pop(t)
    return {"tabelas": set(origem), "regra": regra, "imagem_anterior": img, "origem": origem,
            "duas_fases": sorted(refazer)}


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


REPETIR_LOTE = 50000


def repetir_pendencias(cm, origem, progresso=None):
    """Pendências abertas nas tabelas puladas, da execução que as concluiu (`origem` {tabela: execução}; a cadeia de
    continuações aponta para a que de fato carregou): repetidas nesta execução (só metadados: tabela, chave, regra,
    gravidade, detalhe). Sem isso o relatório desta execução as marcaria resolvidas por não as ver de novo.

    Custo (rodada pendencia-quadratica, 2026-11-23): a versão anterior lia TODAS as pendências (46 milhões na execução
    11 da ProntoCardio) e as regravava com `executemany`, que o pymysql não junta quando o VALUES tem a função de data
    (vira um INSERT por linha: ~9.400/s), numa transação só, sem batimento: 50 min depois a carga parada desfez tudo e
    o AUTO_INCREMENT ficou ~23 milhões acima. Agora cada pedaço de até REPETIR_LOTE pendências (por id) é copiado no
    próprio servidor com UM `INSERT ... SELECT`, commitado, e o batimento é atualizado: cada pendência é gravada uma
    vez, e o resumo recebe só contagens agregadas (`cm.pend_repetidas`), nunca as linhas. Falha no meio: a marca da tabela só vem depois (marcar), e a próxima continuação herda da execução anterior
    (cadeia), que continua com as pendências."""
    por = {}
    for t, e in origem.items():
        por.setdefault(int(e), []).append(t)
    total = 0
    for e, tabelas in sorted(por.items()):
        tabelas = sorted(tabelas)
        marcas = ",".join(["%s"] * len(tabelas))
        filtro = ("FROM %s.pendencia WHERE execucao_id=%%s AND situacao='aberta' AND tabela_origem IN (%s)"
                  % (cm.ctl, marcas))
        ultimo = 0
        while True:
            with cm._c() as c:
                # só os ids (fronteiras do pedaço): as pendências nunca vêm para a memória do processo
                c.execute("SELECT id " + filtro + " AND id>%s ORDER BY id LIMIT %s",
                          [e] + tabelas + [ultimo, REPETIR_LOTE])
                ids = [x[0] for x in c.fetchall()]
                if not ids:
                    break
                c.execute("INSERT INTO %s.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                          " detalhe, criado_em) SELECT %%s, tabela_origem, chave_original, regra, gravidade, detalhe,"
                          " %s " % (cm.ctl, AGORA) + filtro + " AND id BETWEEN %s AND %s ORDER BY id",
                          [cm.eid, e] + tabelas + [ids[0], ids[-1]])
            total += len(ids)
            ultimo = ids[-1]
            cm._commit()
            if progresso:
                progresso(total)
        # resumo (total, críticas, por regra e por restrição) por contagem agregada no servidor, sobre o mesmo filtro:
        # a execução de origem terminou, nada entra nela entre a cópia e a contagem
        with cm._c() as c:
            c.execute("SELECT tabela_origem, regra, gravidade, detalhe, COUNT(*) " + filtro +
                      " GROUP BY tabela_origem, regra, gravidade, detalhe", [e] + tabelas)
            cm.pend_repetidas.extend(tuple(x[:4]) + (int(x[4]),) for x in c.fetchall())
    cm._commit()
    return total


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
