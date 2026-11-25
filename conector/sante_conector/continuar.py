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
   Prova sem ler o conector_origem (rodada retomada-rapida): toda imagem do controle é da mesma base (resumo
   aceito) e contou T com n linhas; cada chave principal é uma linha distinta da base, logo não passam de n. Sem a
   prova, conta-se pelo índice da chave (uq_conector_origem_chave, sem ir à linha); a dedução para na primeira
   chave de outra imagem.
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


def _total_principal(c, ctl, tabela, destinos, cache):
    """Chaves principais da tabela no conector_origem, de QUALQUER imagem. Só o índice uq_conector_origem_chave
    (tabela_origem, chave_original): a condição da chave principal está no próprio índice, sem ir à linha (antes, o
    agrupamento por imagem_id lia a linha de cada chave: 14,6 min no preparo da execução 24 da ProntoCardio). Uma vez
    por tabela na continuação inteira (`cache` vale para todos os elos da cadeia e da base declarada)."""
    tot = cache.setdefault("total", {})
    if tabela not in tot:
        cond, args = _sql_principal(destinos)
        c.execute("SELECT COUNT(*) FROM `%s`.conector_origem FORCE INDEX (uq_conector_origem_chave)"
                  " WHERE tabela_origem=%%s AND %s" % (ctl, cond), [tabela] + args)
        tot[tabela] = int(c.fetchone()[0])
        cache["consultas"] = cache.get("consultas", 0) + 1
    return tot[tabela]


def _outra_imagem(c, ctl, tabela, destinos, img, cache):
    """Há chave principal da tabela com imagem diferente de `img`? (dedução). Para na primeira: na tabela que a
    execução não leu inteira, a primeira chave já responde; só a tabela de fato deduzida é lida até o fim."""
    k = (tabela, img)
    out = cache.setdefault("outra", {})
    if k not in out:
        cond, args = _sql_principal(destinos)
        c.execute("SELECT 1 FROM `%s`.conector_origem FORCE INDEX (uq_conector_origem_chave)"
                  " WHERE tabela_origem=%%s AND imagem_id<>%%s AND %s LIMIT 1" % (ctl, cond), [tabela, img] + args)
        out[k] = c.fetchone() is not None
        cache["consultas"] = cache.get("consultas", 0) + 1
    return out[k]


def _mesma_base(c, ctl, tabela, n, aceitos, cache):
    """Prova SEM ler o conector_origem de que as chaves principais da tabela não passam de `n` (regra 3): toda imagem
    gravada no controle é da mesma base (resumo aceito: o desta execução ou o da base declarada) e contou a tabela com
    exatamente `n` linhas. Toda chave do conector_origem tem a imagem da execução que leu a linha (imagem nunca é
    apagada), e cada chave principal é uma linha distinta da tabela: de uma base só, com n linhas, saem no máximo n
    chaves. Sem a prova (alguma imagem de outra base, ou contagem diferente), conta-se pelo índice."""
    if "imagens" not in cache:
        c.execute("SELECT id, sha256 FROM `%s`.imagem" % ctl)
        imgs = {int(i): s for i, s in c.fetchall()}
        c.execute("SELECT imagem_id, tabela_origem, registros FROM `%s`.imagem_tabela" % ctl)
        por_t = {}
        for i, t, r in c.fetchall():
            por_t.setdefault(t, {})[int(i)] = int(r)
        cache["imagens"] = (imgs, por_t)
    imgs, por_t = cache["imagens"]
    if not imgs or any(s not in aceitos for s in imgs.values()):
        return False
    contadas = por_t.get(tabela, {})
    return all(contadas.get(i) == int(n) for i in imgs)


def _uma(conn, ctl, anterior, plano, contagens, sha256, cache=None, batimento=None, ja=frozenset()):
    """Concluídas pela própria execução `anterior` (marca ou dedução), sem a cadeia. `ja`: tabelas já concluídas por
    um elo mais novo da cadeia (o mais novo vale; não são examinadas de novo)."""
    cache = {} if cache is None else cache
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
        aceitos = _aceitos(sha256) | set(cache.get("mesma_base") or ())
        saida = set()
        for i, p in enumerate(plano):
            if batimento is not None:
                batimento(i, len(plano))
            t = p["tabela"]
            if t in ja or (marcadas and t not in marcadas):
                continue
            n = int(contagens.get(t, -1))
            if marcadas:
                # regra 3: mais chaves principais (de qualquer imagem) que linhas no arquivo = chave antiga que sumiu
                # do arquivo e entraria nas vistas refeitas (a conciliação divergiria); a tabela roda de novo
                if _mesma_base(c, ctl, t, n, aceitos, cache) or _total_principal(c, ctl, t, p["destinos"], cache) <= n:
                    saida.add(t)
                continue
            if lidas.get(t, 0) <= 0 or lidas.get(t, 0) != n:
                continue
            # dedução: as n chaves principais da tabela são todas da imagem de Y (nenhuma de outra imagem e n no total)
            if _outra_imagem(c, ctl, t, p["destinos"], img, cache):
                continue
            if _total_principal(c, ctl, t, p["destinos"], cache) == n:
                saida.add(t)
        return saida, ("marca" if marcadas else "deducao"), img


def concluidas(conn, ctl, anterior, plano, contagens, sha256, contadores_de=None, _heranca=True, _cache=None,
               batimento=None, _ja=frozenset()):
    """Tabelas do plano concluídas pela execução `anterior` (regra no cabeçalho). Devolve {"tabelas": set,
    "regra": "marca"|"deducao" (com "+cadeia" quando herdou), "imagem_anterior": id, "origem": {tabela: execução
    das pendências}, "duas_fases": tabelas refeitas por terem coluna em duas fases}. Recusa se o arquivo não é o
    mesmo. `contadores_de(id)`: contadores da execução (cadeia de continuações; None = sem cadeia). `batimento(i,
    n)`: chamado a cada tabela examinada (painel: batimento e leitura da pausa no preparo; pode levantar a pausa)."""
    _cache = {} if _cache is None else _cache
    de = None
    if contadores_de is not None:
        de = (contadores_de(anterior) or {}).get("continuar_de")
    base = base_declarada(conn, anterior) if _heranca else None
    # a prova da mesma base (_mesma_base) aceita as imagens da base declarada desde o primeiro elo
    _cache.setdefault("mesma_base", set()).update(_aceitos(sha256))
    if base and base["aceita"]:
        _cache["mesma_base"].update(base["sha256_aceitos"])
    try:
        tabs, regra, img = _uma(conn, ctl, anterior, plano, contagens, sha256, _cache, batimento, _ja)
    except SemImagem:
        if not de:
            raise
        tabs, regra, img = set(), "sem_imagem", None
    origem = {t: anterior for t in tabs}
    if de:  # a continuação `anterior` falhou antes de marcar o que herdou: herda da que ela continuava
        try:
            r = concluidas(conn, ctl, int(de), plano, contagens, sha256, contadores_de, _heranca=False, _cache=_cache,
                           batimento=batimento, _ja=frozenset(_ja) | set(origem))
        except SemImagem:  # a ponta da cadeia caiu antes da imagem (e não continua outra): não traz nada
            r = {"origem": {}, "regra": "sem_imagem", "imagem_anterior": None}
            regra = "%s+cadeia(%d:sem_imagem)" % (regra, int(de))
        else:
            regra = "%s+cadeia(%d)" % (regra, int(de))
        for t, e in r["origem"].items():
            origem.setdefault(t, e)
        img = img or r["imagem_anterior"]
    if base and base["aceita"]:  # regra 6: a origem anterior com a mesma base, declarada pelo administrador
        try:
            r = concluidas(conn, ctl, base["execucao_anterior"], plano, contagens,
                           _aceitos(sha256) | set(base["sha256_aceitos"]), contadores_de, _heranca=False,
                           _cache=_cache, batimento=batimento, _ja=frozenset(_ja) | set(origem))
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


def _vigencia(c, ctl, origem):
    """(condição SQL das pendências vigentes das tabelas puladas, sem o filtro de tabela) para `origem` {tabela:
    execução que a concluiu}: a união das cadeias dessas execuções e, de cada tabela, só a pendência da execução que a
    carregou (controle.vigentes_cur), como no relatório L10."""
    from . import controle
    ids = set()
    for e in set(int(x) for x in origem.values()):
        ids.update(controle.cadeia_cur(c, ctl, e))
    cond = controle.pendencias_da_cadeia(ctl, ids, "p", "aberta")
    vig = controle.vigentes_cur(c, ctl, origem)
    return cond, vig


def _agregar_tabela(c, ctl, cond, vig, t, excluir_regras=()):
    """Contagem agregada (tabela, regra, gravidade, detalhe, n) das pendências vigentes de UMA tabela pulada: uma
    consulta por tabela (pelo ix_pendencia_mesma, que começa pela tabela), com batimento e pausa entre elas."""
    from . import controle
    cv = controle.condicao_vigente(ctl, {t: vig[t]}, "p", excluir_regras)
    c.execute("SELECT p.tabela_origem, p.regra, p.gravidade, p.detalhe, COUNT(*) FROM %s.pendencia p WHERE %s"
              " AND p.tabela_origem=%%s AND %s GROUP BY p.tabela_origem, p.regra, p.gravidade, p.detalhe"
              % (controle._b(ctl), cond, cv), (t,))
    return [tuple(x[:4]) + (int(x[4]),) for x in c.fetchall()]


def repetir_pendencias(cm, origem, progresso=None, excluir_regras=(), entre_tabelas=None):
    """Pendências abertas nas tabelas puladas, HERDADAS da cadeia sem cópia (rodada pendencia-cadeia, 2026-11-24).

    A pendência fica na execução em que nasceu. Antes, cada pedaço era copiado para a execução nova (`INSERT ...
    SELECT`): a execução 13 da ProntoCardio copiou 35.980.210 linhas da 11 e a 14 levaria mais de um dia copiando as da
    13 (a tabela chegou a 18,5 GB). Agora nada é gravado: todo leitor (relatório L10, resolução, este resumo) segue a
    cadeia de continuações (controle.cadeia) sem dupla contagem (controle.pendencias_da_cadeia). Aqui só sai a
    contagem agregada no servidor para o resumo da execução (`cm.pend_repetidas`: tabela, regra, gravidade, detalhe,
    n), nunca as linhas. `origem` {tabela: execução que a concluiu}: a cadeia lida é a união das cadeias dessas
    execuções (a continuação que só marcou `continuada` não tem as pendências: estão na que carregou), e de cada tabela
    só vale a pendência da execução que a carregou (controle.vigentes_cur), como no relatório L10.

    Uma consulta por tabela (rodada retomada-rapida, 2026-11-25): a agregação única das 41 M pendências herdadas da
    execução 24 da ProntoCardio ficou 17 min sem batimento e sem ler a pausa. `progresso(n)` é chamado depois de cada
    tabela (batimento) e `entre_tabelas()` também (pode levantar a pausa: nada foi gravado, a próxima continuação
    refaz a contagem sem duplicar nada). A carga pelo mapa usa `PendenciasHerdadas` (em segundo plano). Devolve o
    total herdado."""
    tabelas = sorted(origem)
    if not tabelas:
        return 0
    agg = []
    with cm._c() as c:
        cond, vig = _vigencia(c, cm.ctl, origem)
        for t in tabelas:
            agg.extend(_agregar_tabela(c, cm.ctl, cond, vig, t, excluir_regras))
            if progresso:
                progresso(sum(x[4] for x in agg))
            if entre_tabelas:
                entre_tabelas()
    cm.pend_repetidas.extend(agg)
    return sum(x[4] for x in agg)


def _conexao_irma(cr):
    """Conexão nova com as mesmas credenciais da conexão `cr` (pymysql) do motor: a contagem em segundo plano nunca
    divide a conexão da carga."""
    import pymysql

    def _s(v):
        return v.decode() if isinstance(v, (bytes, bytearray)) else v
    return pymysql.connect(host=cr.host, port=cr.port, user=_s(cr.user), password=cr.password or b"",
                           database=_s(cr.db), charset="utf8mb4", autocommit=True, connect_timeout=10)


class PendenciasHerdadas:
    """Resumo das pendências herdadas da cadeia (repetir_pendencias) em SEGUNDO PLANO, com conexão própria, para a
    carga começar logo (rodada retomada-rapida): a contagem é só para o resumo da execução e nada a espera até a
    conciliação. Uma consulta por tabela; `esperar` (na conciliação) junta o resultado em `cm.pend_repetidas` e dá
    batimento enquanto espera; `cancelar` (pausa ou falha) para entre as tabelas e mata a consulta em curso. Nada é
    gravado: a execução que pausa no meio não deixa contagem pela metade (a próxima continuação refaz tudo).
    Sem conexão própria (teste com conexão falsa), a contagem roda no `esperar`, na própria conexão."""

    def __init__(self, cm, origem, excluir_regras=(), conectar=None):
        self.cm, self.origem, self.excluir = cm, dict(origem), tuple(excluir_regras)
        self.conectar = conectar or (lambda: _conexao_irma(cm.cr))
        self.agg, self.feitas, self.erro, self.cancelada = [], 0, None, False
        self._linha = self._cn = self._id = None

    def iniciar(self):
        import threading
        if not self.origem:
            return self
        try:
            self._cn = self.conectar()
        except Exception:  # noqa: BLE001 - sem conexão própria: conta no esperar
            self._cn = None
            return self
        self._linha = threading.Thread(target=self._rodar, name="pendencias-herdadas", daemon=True)
        self._linha.start()
        return self

    def _rodar(self):
        try:
            with self._cn.cursor() as c:
                c.execute("SELECT CONNECTION_ID()")
                self._id = int(c.fetchone()[0])
                cond, vig = _vigencia(c, self.cm.ctl, self.origem)
                for t in sorted(self.origem):
                    if self.cancelada:
                        return
                    self.agg.extend(_agregar_tabela(c, self.cm.ctl, cond, vig, t, self.excluir))
                    self.feitas += 1
        except Exception as e:  # noqa: BLE001 - registrada; o esperar refaz na conexão da carga
            self.erro = e
        finally:
            try:
                self._cn.close()
            except Exception:  # noqa: BLE001
                pass

    def esperar(self, progresso=None, intervalo=10.0):
        """Junta o resultado (`cm.pend_repetidas`) e devolve o total. `progresso(feitas, total)` a cada `intervalo`
        enquanto a contagem não acaba (batimento da execução)."""
        tot = len(self.origem)
        if not tot:
            return 0
        if self._linha is not None:
            while self._linha.is_alive():
                self._linha.join(intervalo)
                if self._linha.is_alive() and progresso:
                    progresso(self.feitas, tot)
        if self._linha is None or self.erro is not None or self.cancelada:
            self.agg = []
            return repetir_pendencias(self.cm, self.origem, None, self.excluir)
        self.cm.pend_repetidas.extend(self.agg)
        return sum(x[4] for x in self.agg)

    def cancelar(self):
        """Pausa ou falha da execução: para entre as tabelas e mata a consulta em curso (pela conexão da carga)."""
        self.cancelada = True
        if self._linha is not None and self._linha.is_alive() and self._id:
            try:
                with self.cm.cr.cursor() as c:
                    c.execute("KILL QUERY %d" % int(self._id))
            except Exception:  # noqa: BLE001 - a linha é daemon: termina sozinha
                pass


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


def medir_preparo(codigo, anterior, sha256=None):
    """Modo de medição (rodada retomada-rapida): o preparo de uma continuação de `anterior` SEM gravar nada (nem na
    plataforma, nem no controle, nem no cliente): tabelas concluídas da cadeia e da base declarada e o grupo da carga
    própria, com o tempo e o número de consultas ao conector_origem. As contagens são as da imagem de `anterior` (a
    continuação conta a origem de novo; mesma base, mesmas contagens) e o resumo aceito é o dela, salvo `sha256`.
    Saída só com contagens e tempos (regra 5)."""
    import os
    import time
    from . import banco, carga_mapa, controle, mapa, motor, plataforma
    conn = banco.conectar(os.environ.get("CONECTOR_PLATAFORMA_BANCO", "plataforma"))
    try:
        ctl = controle.nome_ctl(codigo)
        with conn.cursor() as c:
            c.execute("SELECT id, sha256 FROM `%s`.imagem WHERE execucao_id=%%s" % ctl, (int(anterior),))
            img, sha = c.fetchone()
            c.execute("SELECT tabela_origem, registros FROM `%s`.imagem_tabela WHERE imagem_id=%%s" % ctl, (img,))
            contagens = {t: int(n) for t, n in c.fetchall()}
        _, _, carregar = motor.tabelas_da_passada(contagens)
        plano = carga_mapa.planejar(mapa.carregar_execucao(), carregar)
        cad = lambda e: (plataforma.consultar(conn, e) or {}).get("contadores")  # noqa: E731
        cache, batidas = {}, []
        t0 = time.monotonic()
        r = concluidas(conn, ctl, int(anterior), plano, contagens, sha256 or sha, cad, _cache=cache,
                       batimento=lambda i, n: batidas.append(i))
        t1 = time.monotonic()
        rp = concluidas_propria(conn, ctl, int(anterior), carregar, contagens, sha256 or sha, cad)
        t2 = time.monotonic()
        return {"execucao_anterior": int(anterior), "tabelas_plano": len(plano), "tabelas_puladas": len(r["tabelas"]),
                "linhas_puladas": sum(contagens.get(t, 0) for t in r["tabelas"]), "regra": r["regra"],
                "refeitas_duas_fases": len(r["duas_fases"]), "consultas_conector_origem": cache.get("consultas", 0),
                "batimentos": len(batidas), "segundos_concluidas": round(t1 - t0, 2),
                "carga_propria_pulada": sorted(rp), "segundos_carga_propria": round(t2 - t1, 2),
                "segundos_preparo": round(t2 - t0, 2)}
    finally:
        conn.close()


if __name__ == "__main__":  # python -m sante_conector.continuar medir <cliente> <execução anterior>
    import json
    import sys
    if len(sys.argv) != 4 or sys.argv[1] != "medir":
        sys.exit("uso: python -m sante_conector.continuar medir <cliente> <execução anterior>")
    print(json.dumps(medir_preparo(sys.argv[2], int(sys.argv[3])), ensure_ascii=False))
