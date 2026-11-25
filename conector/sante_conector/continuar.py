"""Continuação de uma importação interrompida (rodada retomar-importacao, 2026-11-23).

Uma importação que parou no meio (o vigia de memória derrubou o worker, a VM caiu, um erro numa tabela) não precisa
reler a origem inteira: `enfileirar <cliente> importar --continuar` (plataforma.enfileirar(..., continuar=True)) cria
uma execução nova que aponta para a interrompida (`contadores.continuar_de`). O motor dessa execução:

- confere que o arquivo é o MESMO da interrompida (sha256 da imagem gravada no controle); outro arquivo recusa;
- conta as tabelas, confronta com o gstat e grava a imagem como sempre (a prova de não alterar a origem continua);
- refaz a carga própria do L3 (pula pelo hash o que já entrou), menos o grupo do atendimento (atendimento, fichas e
  altas) que uma execução da cadeia marcou como concluído (`concluidas_propria`, rodada pendencia-quadratica): esse é
  pulado sem ler a origem, com o estado refeito do controle e as pendências repetidas; o paciente roda sempre;
- na carga pelo mapa, PULA as tabelas que a interrompida concluiu (regra abaixo), sem reler a origem delas; a tabela
  pela metade e as seguintes rodam normalmente: a linha já vista é pulada pelo hash (nunca regravada), a nova entra;
- respeita CONECTOR_ADIAR e CONECTOR_SO (o plano é o mesmo da execução normal; só tira as concluídas);
- o estado em memória das tabelas puladas não é relido da origem: o de-para (`existente`) vem do conector_origem sob
  demanda (como sempre), e na conciliação a tabela pulada tem as chaves vistas e a soma da origem refeitas do
  conector_origem pelo mesmo caminho da linha "igual" (`_secundarias_ja_carregadas`); as pendências abertas da
  interrompida nessas tabelas NÃO são copiadas (rodada pendencia-cadeia): ficam na execução em que nasceram, e todo
  leitor segue a cadeia de continuações (`controle.cadeia`, gravada no controle pelo motor) sem dupla contagem;
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
   marcar o que herdou), as concluídas de X entram também; as pendências de cada tabela pulada são lidas da cadeia
   da execução que a concluiu. A ponta da cadeia que caiu antes da imagem (e não continua outra) não traz nada,
   sem derrubar o que as outras concluíram (antes, o SemImagem dela subia e a continuação relia tudo).
6. Base declarada (0094, ADR 0010): quando a origem da execução tem `continua_de_origem_id` (o administrador declarou
   que a origem nova lê a MESMA base da anterior, como a cópia do arquivo que passou a ser servida pelo servidor
   Firebird), as concluídas da última importação da origem anterior (e da cadeia dela) entram também, aceitando o
   resumo da imagem dela (sha256 do arquivo) como o da mesma base. Prova que difere (ODS, página, data de criação)
   recusa a herança; sem prova, vale a declaração, que fica no evento do cliente. Sem declaração: como sempre.
"""
from .carga import AGORA, ORDEM


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


def _aceitos(sha256):
    """Resumos da imagem aceitos como a mesma base: um sha256 ou um conjunto (base declarada, regra 6)."""
    return {sha256} if isinstance(sha256, str) else set(sha256 or ())


def _principais(c, ctl, tabela, destinos, cache):
    """{imagem_id: chaves principais da tabela} no conector_origem. Uma varredura por tabela na continuação inteira:
    `cache` vale para todos os elos da cadeia e da base declarada (antes, cada elo refazia a contagem de todas as
    tabelas, uma varredura do conector_origem inteiro por elo, dezenas de minutos antes de a carga começar)."""
    if cache is not None and tabela in cache:
        return cache[tabela]
    cond, args = _sql_principal(destinos)
    # FORCE INDEX: com a estatística desatualizada, o otimizador escolhia a varredura da tabela inteira (195 M
    # linhas) para as tabelas grandes; pelo índice da chave, só as linhas da tabela (7,5 M em 30 s na base real)
    c.execute("SELECT imagem_id, COUNT(*) FROM `%s`.conector_origem FORCE INDEX (uq_conector_origem_chave)"
              " WHERE tabela_origem=%%s AND %s"
              " GROUP BY imagem_id" % (ctl, cond), [tabela] + args)
    r = {int(i) if i is not None else None: int(n) for i, n in c.fetchall()}
    if cache is not None:
        cache[tabela] = r
    return r


def _uma(conn, ctl, anterior, plano, contagens, sha256, cache=None):
    """Concluídas pela própria execução `anterior` (marca ou dedução), sem a cadeia."""
    with conn.cursor() as c:
        c.execute("SELECT id, sha256 FROM `%s`.imagem WHERE execucao_id=%%s" % ctl, (anterior,))
        r = c.fetchone()
        if not r:
            raise SemImagem("a execução %d não gravou a imagem: não há o que continuar" % anterior)
        img, sha = r
        if not sha or sha not in _aceitos(sha256):
            raise NaoContinuavel("o arquivo mudou desde a execução %d (sha256 diferente): importe de novo" % anterior)
        c.execute("SELECT tabela_origem FROM `%s`.conector_tabela_concluida WHERE execucao_id=%%s" % ctl, (anterior,))
        # a marca da carga própria (concluidas_propria) não entra aqui: só a da carga pelo mapa decide marca × dedução
        marcadas = {x[0] for x in c.fetchall()} - set(ORDEM)
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
            por_imagem = _principais(c, ctl, t, p["destinos"], cache)
            total, desta = sum(por_imagem.values()), por_imagem.get(img, 0)
            # mais chaves principais (de qualquer imagem) que linhas no arquivo: há chave antiga que sumiu do arquivo
            # e entraria nas vistas refeitas (a conciliação divergiria); a tabela roda de novo
            if total > n:
                continue
            if marcadas or desta == n:
                saida.add(t)
        return saida, ("marca" if marcadas else "deducao"), img


def concluidas(conn, ctl, anterior, plano, contagens, sha256, contadores_de=None, _heranca=True, _cache=None):
    """Tabelas do plano concluídas pela execução `anterior` (regra no cabeçalho). Devolve {"tabelas": set,
    "regra": "marca"|"deducao" (com "+cadeia" quando herdou), "imagem_anterior": id, "origem": {tabela: execução
    das pendências}, "duas_fases": tabelas refeitas por terem coluna em duas fases}. Recusa se o arquivo não é o
    mesmo. `contadores_de(id)`: contadores da execução (cadeia de continuações; None = sem cadeia)."""
    _cache = {} if _cache is None else _cache
    de = None
    if contadores_de is not None:
        de = (contadores_de(anterior) or {}).get("continuar_de")
    try:
        tabs, regra, img = _uma(conn, ctl, anterior, plano, contagens, sha256, _cache)
    except SemImagem:
        if not de:
            raise
        tabs, regra, img = set(), "sem_imagem", None
    origem = {t: anterior for t in tabs}
    if de:  # a continuação `anterior` falhou antes de marcar o que herdou: herda da que ela continuava
        try:
            r = concluidas(conn, ctl, int(de), plano, contagens, sha256, contadores_de, _heranca=False, _cache=_cache)
        except SemImagem:  # a ponta da cadeia caiu antes da imagem (e não continua outra): não traz nada
            r = {"origem": {}, "regra": "sem_imagem", "imagem_anterior": None}
            regra = "%s+cadeia(%d:sem_imagem)" % (regra, int(de))
        else:
            regra = "%s+cadeia(%d)" % (regra, int(de))
        for t, e in r["origem"].items():
            origem.setdefault(t, e)
        img = img or r["imagem_anterior"]
    base = base_declarada(conn, anterior) if _heranca else None
    if base and base["aceita"]:  # regra 6: a origem anterior com a mesma base, declarada pelo administrador
        try:
            r = concluidas(conn, ctl, base["execucao_anterior"], plano, contagens,
                           _aceitos(sha256) | set(base["sha256_aceitos"]), contadores_de, _heranca=False,
                           _cache=_cache)
            for t, e in r["origem"].items():
                origem.setdefault(t, e)
            regra = "%s+base_declarada(%d:%s)" % (regra, base["origem_anterior"], base["prova"])
            img = img or r["imagem_anterior"]
        except NaoContinuavel:
            regra += "+base_declarada_sem_imagem_igual"
    elif base:
        regra += "+base_declarada_recusada(%s)" % base["prova"]
    refazer = {p["tabela"] for p in plano if p["tabela"] in origem and duas_fases(p)}
    for t in refazer:
        origem.pop(t)
    saida = {"tabelas": set(origem), "regra": regra, "imagem_anterior": img, "origem": origem,
             "duas_fases": sorted(refazer)}
    if base:
        saida["base_equivalente"] = base
    return saida


def base_declarada(conn, anterior):
    """Continuidade declarada da origem da execução `anterior` (plataforma.base_equivalente) ou None."""
    from . import plataforma
    return plataforma.base_equivalente(conn, anterior)


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



# Carga própria (carga.py): só o grupo do atendimento (a tabela longa e as duas que ele consome) pode ser pulado, e
# só inteiro. O paciente não: as subentidades e o endereço que aguarda a evidência do CEP dependem da linha da origem.
GRUPO_PROPRIA = ("REALTA", "RECADATE", "ATCABECATEND")
# pendências que a conciliação da carga própria gera de novo nesta execução (não são repetidas, senão contariam 2×)
CONCILIACAO_PROPRIA = ("apagada_aguarda_sincronizar", "edicao_no_destino")


def concluidas_propria(conn, ctl, anterior, presentes, contagens, sha256, contadores_de=None):
    """Grupo do atendimento da carga própria concluído por uma execução da cadeia (`anterior`, e as que ela
    continuava): {tabela: execução} ou {} (roda de novo). Exige, na execução E que o concluiu:
    1. marca de TODAS as tabelas do grupo presentes (carga.Carga.executar marca o grupo depois do commit do
       atendimento e das fichas e altas; execução anterior à marca, como a 11 da ProntoCardio, nunca é pulada);
    2. a imagem de E é o mesmo arquivo (sha256);
    3. o conector_origem tem EXATAMENTE a contagem desta execução de chaves de cada tabela (toda linha lida é
       registrada, gravada ou recusada; chave a mais = linha que sumiu do arquivo; a menos = não concluída);
    4. nenhuma linha alterada à espera do Sincronizar (`alteracao_aguarda_sincronizar` em E): a reexecução a poria
       fora da soma, e o estado guardado não distingue. Na dúvida, não pula."""
    grupo = [t for t in GRUPO_PROPRIA if t in presentes]
    if "ATCABECATEND" not in grupo:
        return {}
    r = _propria(conn, ctl, anterior, grupo, contagens, sha256, contadores_de)
    if r:
        return r
    base = base_declarada(conn, anterior)  # regra 6: a cadeia da origem anterior com a mesma base declarada
    if base and base["aceita"]:
        return _propria(conn, ctl, base["execucao_anterior"], grupo, contagens,
                        _aceitos(sha256) | set(base["sha256_aceitos"]), contadores_de)
    return {}


def _propria(conn, ctl, anterior, grupo, contagens, sha256, contadores_de):
    e, vistos = int(anterior), set()
    with conn.cursor() as c:
        while e and e not in vistos:
            vistos.add(e)
            c.execute("SELECT tabela_origem FROM `%s`.conector_tabela_concluida WHERE execucao_id=%%s" % ctl, (e,))
            if set(grupo) <= {x[0] for x in c.fetchall()}:
                break
            de = (contadores_de(e) or {}).get("continuar_de") if contadores_de else None
            e = int(de) if de else None
        if not e or e not in vistos:
            return {}
        c.execute("SELECT sha256 FROM `%s`.imagem WHERE execucao_id=%%s" % ctl, (e,))
        r = c.fetchone()
        if not r or not r[0] or r[0] not in _aceitos(sha256):
            return {}
        for t in grupo:
            c.execute("SELECT COUNT(*) FROM `%s`.conector_origem WHERE tabela_origem=%%s" % ctl, (t,))
            if int(c.fetchone()[0]) != int(contagens.get(t, -1)):
                return {}
        marcas = ",".join(["%s"] * len(grupo))
        from . import controle  # a pendência fica onde nasceu: a de E pode estar numa execução anterior da cadeia
        ids = ",".join(str(x) for x in controle.cadeia_cur(c, ctl, e, contadores_de))
        c.execute("SELECT COUNT(*) FROM `%s`.pendencia WHERE execucao_id IN (%s)"
                  " AND regra='alteracao_aguarda_sincronizar' AND tabela_origem IN (%s)" % (ctl, ids, marcas), grupo)
        if int(c.fetchone()[0]):
            return {}
    return {t: e for t in grupo}


def repetir_pendencias(cm, origem, progresso=None, excluir_regras=()):
    """Pendências abertas nas tabelas puladas, HERDADAS da cadeia sem cópia (rodada pendencia-cadeia, 2026-11-24).

    A pendência fica na execução em que nasceu. Antes, cada pedaço era copiado para a execução nova (`INSERT ...
    SELECT`): a execução 13 da ProntoCardio copiou 35.980.210 linhas da 11 e a 14 levaria mais de um dia copiando as da
    13 (a tabela chegou a 18,5 GB). Agora nada é gravado: todo leitor (relatório L10, resolução, este resumo) segue a
    cadeia de continuações (controle.cadeia) sem dupla contagem (controle.pendencias_da_cadeia). Aqui só sai a
    contagem agregada no servidor para o resumo da execução (`cm.pend_repetidas`: tabela, regra, gravidade, detalhe,
    n), nunca as linhas. `origem` {tabela: execução que a concluiu}: a cadeia lida é a união das cadeias dessas
    execuções (a continuação que só marcou `continuada` não tem as pendências: estão na que carregou), e de cada tabela
    só vale a pendência da execução que a carregou (controle.vigentes_cur), como no relatório L10.
    Devolve o total herdado."""
    from . import controle
    tabelas = sorted(origem)
    if not tabelas:
        return 0
    with cm._c() as c:
        ids = set()
        for e in set(int(x) for x in origem.values()):
            ids.update(controle.cadeia_cur(c, cm.ctl, e))
        cond = controle.pendencias_da_cadeia(cm.ctl, ids, "p", "aberta")
        cond += " AND p.tabela_origem IN (%s)" % ",".join(["%s"] * len(tabelas))
        # só a pendência da execução que carregou a tabela (ou a repetição dela): a carga parcial refeita não herda
        cond += " AND " + controle.condicao_vigente(cm.ctl, controle.vigentes_cur(c, cm.ctl, origem), "p",
                                                    excluir_regras)
        c.execute("SELECT p.tabela_origem, p.regra, p.gravidade, p.detalhe, COUNT(*) FROM %s.pendencia p WHERE %s"
                  " GROUP BY p.tabela_origem, p.regra, p.gravidade, p.detalhe" % (controle._b(cm.ctl), cond), tabelas)
        agg = [tuple(x[:4]) + (int(x[4]),) for x in c.fetchall()]
    cm.pend_repetidas.extend(agg)
    total = sum(x[4] for x in agg)
    if progresso:
        progresso(total)
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
