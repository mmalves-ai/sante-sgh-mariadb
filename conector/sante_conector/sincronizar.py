"""Sincronizar (F4 L9): o diferencial da carga dirigida pelo mapa, depois da importação.

Plano F4, seções 6 e 6.1 (dono, 2026-11-21). Chamado pela `carga_mapa.CargaMapa` com `sincronizar=True`:
- diferencial por linha: o hash dos bytes crus de cada linha contra o estado guardado em `conector_origem` (nunca
  janela de datas: a alteração SÓ DE COLUNA e a linha ANTIGA alterada aparecem); hash por bloco de 10 mil ids
  (`conector_bloco`) guardado em toda execução, para dizer quais faixas mudaram;
- inclusão (linha nova), atualização (a ORIGEM VENCE: UPDATE do mesmo id no destino, `alterado_em` e `versao`) e
  exclusão LÓGICA (`excluido_em` no destino e em `conector_origem`), com reativação quando a linha volta;
- conflito: a linha mudou na origem E foi editada no destino depois da última execução (resumo do destino diferente
  do gravado). A origem vence e a edição fica GUARDADA em `conflito_sincronizar` (valores antes e depois, só na base de
  controle do cliente), com a pendência `conflito_origem_venceu`; o painel lista os conflitos (sem valores no resumo);
- alerta de exclusão em massa: apagadas acima do limite (fração das ativas E ao menos 5 linhas, também em tabela
  pequena) ou, somadas as tabelas, acima do limite global da execução NÃO são excluídas; ficam com a pendência crítica
  `exclusao_em_massa_aguarda_confirmacao` até o Sincronizar confirmado pelo painel (pedido com a confirmação);
- linha COMPARTILHADA (cabeçalho agrupado, adotada, `complementa` que aponta a linha do pai): só é excluída quando
  nenhuma outra linha ativa do controle aponta o mesmo registro do destino; o `complementa` nunca exclui a linha do pai;
  a adotada que já existia antes da migração nunca é excluída nem reativada pelo conector;
- destino sem `excluido_em`: a linha fica ATIVA e a pendência `exclusao_sem_suporte_no_destino` (média) fica visível a
  cada execução (o controle não é marcado como excluído);
- generators (F4.7): o valor de todos é guardado em `conector_generator` a cada execução; os declarados em
  `declarado/sequencias.tsv` (generator -> `sequencia_negocio.tipo`) avançam a sequência própria (nunca recua).
Nunca grava valor de linha em log nem no resumo: só contagens, nomes de colunas e chaves originais.
"""
import hashlib
import json

from .carga import AGORA
from .leitor import hash_bloco

# (fração das linhas ativas da tabela, mínimo de linhas): acima da fração E com ao menos o mínimo, a exclusão espera
# confirmação (uma tabela pequena esvaziada também alerta: 5 de 5, 25 de 50)
LIMITE_EXCLUSAO = (0.10, 5)
# soma das exclusões das tabelas abaixo do limite, por execução: acima dela, tudo espera confirmação
LIMITE_GLOBAL = 1000
MAX_ITENS_RESUMO = 200


def em_massa(apagar, ativas, limite=LIMITE_EXCLUSAO, confirmado=False):
    """True quando a exclusão de `apagar` linhas de `ativas` precisa de confirmação."""
    frac, minimo = limite
    return not confirmado and apagar > 0 and apagar >= minimo and apagar > frac * max(ativas, 1)


def suporta(cm, p):
    """O Sincronizar reaplica a linha alterada em toda estrutura: principal e secundários pelo mesmo id; o cabeçalho
    AGRUPADO recebe os agregados recalculados do grupo (todas as linhas lidas nesta execução) quando divergem."""
    return True


def criado_pelo_conector(cm, dt, rid):
    """A linha do destino foi criada pela migração (coluna `origem` = 'migracao'); sem a coluna: não se sabe (False)."""
    if "origem" not in cm._info(dt):
        return False
    r = cm._todas("SELECT origem FROM `%s` WHERE id=%%s" % dt, (rid,))
    return bool(r) and r[0][0] == "migracao"


def ligado_ao_espelho(cm, tab, dt, rid):
    """conta-itens-2 (ADR 0006, 3): o destino da linha é o item do ESPELHO a que ela foi ligada (`ligar_espelho:` no
    principal), não um item criado pela migração. O conector não é dono dele: nunca o exclui, reativa nem sobrescreve."""
    p = _plano(cm, tab) or {}
    return (bool(p.get("ligacoes")) and rid is not None and bool(p.get("destinos")) and dt == p["destinos"][0]
            and not criado_pelo_conector(cm, dt, rid))


def _chave_ctl(k, base, dt, principal, desd):
    if principal and not desd:
        return k
    if isinstance(k, tuple):
        return None
    return base + "/" + dt + k[len(base):]


def estado_destino(cm, p, ents):
    """Resumo atual (antes desta execução) de cada linha do destino, na mesma forma do `hash_destino` guardado."""
    for i, dt in enumerate(p["destinos"]):
        desd = i == 0 and cm._desdobrado(p, dt)
        for k, (txt, _ed, base) in cm._destino(p, dt, ents[i], i == 0).items():
            kx = _chave_ctl(k, base, dt, i == 0, desd)
            if kx is not None:
                cm._estado[(dt, kx)] = hashlib.sha256(txt.encode()).digest()


def alvo(cm, t, kx, dt, op):
    """Id do destino a reaplicar; None = gravar como hoje. A linha ADOTADA que a própria migração criou segue a origem
    (UPDATE do mesmo id, também quando a chave de adoção muda); a que já existia antes da migração fica na mescla não
    destrutiva. `complementa` e cabeçalho agrupado têm caminho próprio."""
    if op.get("complementa") or op.get("agrupar"):
        return None
    ex = cm.existente.get(t, {}).get(kx)
    rid = ex[0] if ex and ex[0] is not None else None
    if rid is not None and op.get("adotar") and not criado_pelo_conector(cm, dt, rid):
        return None
    return rid


def _legivel(v):
    from .carga_mapa import _valor_legivel
    return None if v is None else _valor_legivel(v)


def conflito(cm, t, kx, dt, rid, nomes, v):
    """Edição no destino desde a última execução (resumo atual != resumo gravado) numa linha que mudou na origem:
    guarda a edição (valores antes) e o que veio da origem; a origem vence em seguida."""
    from .carga_mapa import canon
    guardado = (cm.existente.get(t, {}).get(kx) or (None, None, None))[2]
    atual = cm._estado.get((dt, kx))
    if guardado is None or atual is None or atual == guardado:
        return False
    cols = [c for c in v if c not in ("id", "origem", "criado_em")]
    if not cols:
        return False
    linha = cm._todas("SELECT %s FROM `%s` WHERE id=%%s" % (", ".join("`%s`" % c for c in cols), dt), (rid,))
    if not linha:
        return False
    antes = dict(zip(cols, linha[0]))
    difs = [c for c in cols if canon(antes[c]) != canon(v[c])]
    with cm._c() as c:
        c.execute("INSERT INTO %s.conflito_sincronizar (execucao_id, tabela_origem, chave_original, tabela_destino,"
                  " id_destino, colunas, edicao_destino, valor_origem, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%%s,"
                  "%%s,%s)" % (cm.ctl, AGORA),
                  (cm.eid, t, kx, dt, rid, json.dumps(difs),
                   json.dumps({c: _legivel(antes[c]) for c in cols}, ensure_ascii=False),
                   json.dumps({c: _legivel(v[c]) for c in difs}, ensure_ascii=False)))
    cm._pendencia(t, kx, "conflito_origem_venceu", "media")
    r = cm.sinc_res
    r["conflitos"] += 1
    if len(r["conflitos_itens"]) < MAX_ITENS_RESUMO:
        r["conflitos_itens"].append({"tabela_origem": t, "chave_original": kx, "tabela_destino": dt,
                                     "id_destino": rid, "colunas": difs})
    return True


def atualizar(cm, dt, rid, v, padrao=()):
    """A origem vence: UPDATE do mesmo id com as colunas declaradas; `alterado_em` e `versao` contam a reaplicação.
    Coluna NOT NULL com padrão que ficou sem valor na origem (`padrao`) volta ao padrão do destino, como no INSERT."""
    info = cm._info(dt)
    cols = [c for c in v if c not in ("id", "origem", "criado_em")]
    sets = ["`%s`=%%s" % c for c in cols] + ["`%s`=DEFAULT(`%s`)" % (c, c) for c in padrao if c not in v]
    if "alterado_em" in info:
        sets.append("`alterado_em`=%s" % AGORA)
    if "versao" in info:
        sets.append("`versao`=`versao`+1")
    if sets:
        with cm._c() as c:
            c.execute("UPDATE `%s` SET %s WHERE id=%%s" % (dt, ", ".join(sets)), [v[c] for c in cols] + [rid])
    cm.sinc_res["atualizadas"] += 1
    return rid


def _destinos_da_tabela(cm, tab):
    for p in cm.plano:
        if p["tabela"] == tab:
            return {cm._nome_ent(tab, dt) if i == 0 else dt: dt for i, dt in enumerate(p["destinos"])}
    return {}


def _plano(cm, tab):
    return next((p for p in cm.plano if p["tabela"] == tab), None)


def _dt_da_entidade(ent):
    return ent.split("#", 1)[0]


def _compartilhada(cm, dt, rid, cids):
    """Outra linha ATIVA do controle (de qualquer tabela da origem, fora `cids`) aponta o mesmo registro do destino."""
    marca = ",".join(str(int(x)) for x in cids) or "0"
    return cm._todas("SELECT COUNT(*) FROM %s.conector_origem WHERE id_destino=%%s AND excluido_em IS NULL AND"
                     " (entidade_destino=%%s OR entidade_destino LIKE %%s) AND id NOT IN (%s)" % (cm.ctl, marca),
                     (rid, dt, dt.replace("_", "\\_") + "#%"))[0][0] > 0


def _marcar(cm, tab, chave, excluir):
    """Exclusão lógica (excluir=True) ou reativação da linha e das secundárias dela, no destino e no controle.
    Devolve (marcadas no destino, sem suporte no destino). Linha compartilhada, `complementa` (linha do pai) e adotada
    que já existia antes da migração não são tocadas no destino; destino sem `excluido_em`: o controle NÃO é marcado."""
    por_ent = _destinos_da_tabela(cm, tab)
    ops = (_plano(cm, tab) or {}).get("opcoes") or {}
    like = chave.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "/%"
    rs = cm._todas("SELECT id, entidade_destino, id_destino FROM %s.conector_origem WHERE tabela_origem=%%s AND"
                   " (chave_original=%%s OR chave_original LIKE %%s) AND id_destino IS NOT NULL" % cm.ctl,
                   (tab, chave, like))
    cids = [r[0] for r in rs]
    marcadas = sem_suporte = 0
    with cm._c() as c:
        for cid, ent, rid in rs:
            dt = por_ent.get(ent) or _dt_da_entidade(ent)
            op = ops.get(dt) or {}
            if "excluido_em" not in cm._info(dt):
                sem_suporte += 1
                continue  # a linha fica ativa no destino e no controle: pendência visível a cada execução
            tocar = not op.get("complementa")
            if tocar and op.get("adotar") and not criado_pelo_conector(cm, dt, rid):
                tocar = False
            if tocar and ligado_ao_espelho(cm, tab, dt, rid):  # item do espelho: só o controle é marcado
                tocar = False
                cm.sinc_res["mantidas_espelho"] = cm.sinc_res.get("mantidas_espelho", 0) + 1
            # agrupado e adotado são compartilhados por natureza (a linha `complementa` de um filho nunca prende o pai)
            if tocar and excluir and (op.get("agrupar") or op.get("adotar")) and _compartilhada(cm, dt, rid, cids):
                tocar = False
                cm.sinc_res["mantidas_compartilhadas"] = cm.sinc_res.get("mantidas_compartilhadas", 0) + 1
            if tocar:
                c.execute("UPDATE `%s` SET excluido_em=%s WHERE id=%%s" % (dt, AGORA if excluir else "NULL")
                          + (" AND excluido_em IS NULL" if excluir else ""), (rid,))
                marcadas += 1
            c.execute("UPDATE %s.conector_origem SET excluido_em=%s, alterado_em=%s, versao=versao+1 WHERE id=%%s"
                      % (cm.ctl, AGORA if excluir else "NULL", AGORA), (cid,))
    return marcadas, sem_suporte


def reativar(cm, tab, chave):
    _marcar(cm, tab, chave, False)
    cm._excluidas[tab].discard(chave)
    cm.sinc_res["reativadas"] += 1


def carregar_excluidas(cm):
    for p in cm.plano:
        rs = cm._todas("SELECT chave_original FROM %s.conector_origem WHERE tabela_origem=%%s AND excluido_em IS NOT"
                       " NULL" % cm.ctl, (p["tabela"],))
        cm._excluidas[p["tabela"]] = {r[0] for r in rs}


def _e_base(k, destinos):
    return not any(k.endswith("/" + dt) or ("/" + dt + "/") in k for dt in destinos)


def excluir_apagadas(cm):
    """Linha que estava ativa e sumiu da origem: exclusão lógica, salvo exclusão em massa (por tabela ou somada na
    execução: alerta crítico, espera a confirmação) e destino sem `excluido_em` (pendência visível)."""
    plano = []
    for p in cm.plano:
        t, vistas = p["tabela"], cm.vistas.get(p["tabela"], set())
        if hasattr(vistas, "abrir"):  # estado compactado ao fim da onda (paralelo.Compacto): aberto só aqui
            vistas = vistas.abrir()
        excl = cm._excluidas.setdefault(t, set())
        ativas = [k for k, a in cm.existente.get(t, {}).items()
                  if a[0] is not None and k not in excl and _e_base(k, p["destinos"])]
        apagar = [k for k in ativas if k not in vistas]
        if apagar:
            plano.append((p, t, ativas, apagar))

    def alertar(t, ent, apagadas, ativas):
        cm._pendencia(t, None, "exclusao_em_massa_aguarda_confirmacao", "critica")
        cm.sinc_res["alertas_exclusao_em_massa"].append({"tabela_origem": t, "entidade": ent, "apagadas": apagadas,
                                                         "ativas": ativas})
    abaixo = []
    for p, t, ativas, apagar in plano:
        if em_massa(len(apagar), len(ativas), cm.limite_exclusao, cm.confirmar_massa):
            alertar(t, cm._nome_ent(t, p["destinos"][0]), len(apagar), len(ativas))
        else:
            abaixo.append((p, t, ativas, apagar))
    total = sum(len(x[3]) for x in abaixo)
    if not cm.confirmar_massa and total > cm.limite_global:  # muitas tabelas pequenas somam uma exclusão grande
        for p, t, ativas, apagar in abaixo:
            alertar(t, cm._nome_ent(t, p["destinos"][0]), len(apagar), len(ativas))
        cm.sinc_res["alerta_exclusao_global"] = {"apagadas": total, "limite": cm.limite_global}
        abaixo = []
    r = cm.sinc_res
    for p, t, ativas, apagar in abaixo:
        excl = cm._excluidas[t]
        for k in apagar:
            marcadas, sem = _marcar(cm, t, k, True)
            if sem:
                cm._pendencia(t, k, "exclusao_sem_suporte_no_destino", "media")
                r["exclusoes_sem_suporte"] = r.get("exclusoes_sem_suporte", 0) + 1
            if not sem:
                excl.add(k)
                r["excluidas"] += 1
    cm._commit()


def blocos(cm, t, por_bloco):
    """Hash por bloco de ids contra o guardado: quantos blocos mudaram (e quais sumiram)."""
    antes = {int(b): bytes(h) for b, h in cm._todas(
        "SELECT bloco, hash_bloco FROM %s.conector_bloco WHERE tabela_origem=%%s" % cm.ctl, (t,))}
    iguais = alterados = 0
    with cm._c() as c:
        for b, hs in sorted(por_bloco.items()):
            hb = bytes.fromhex(hash_bloco([h.hex() for h in hs]))
            if antes.get(b) == hb:
                iguais += 1
                continue
            alterados += 1
            c.execute("INSERT INTO %s.conector_bloco (tabela_origem, bloco, hash_bloco, linhas, imagem_id, criado_em)"
                      " VALUES (%%s,%%s,%%s,%%s,%%s,%s) ON DUPLICATE KEY UPDATE hash_bloco=VALUES(hash_bloco),"
                      " linhas=VALUES(linhas), imagem_id=VALUES(imagem_id), alterado_em=%s, versao=versao+1"
                      % (cm.ctl, AGORA, AGORA), (t, b, hb, len(hs), cm.img))
        lim = getattr(cm, "_faixa_lim", None)  # tabela dividida por faixa: só os blocos da faixa deste gravador
        sumiram = [b for b in antes if b not in por_bloco and (lim is None or (
            (lim[0] is None or b >= lim[0]) and (lim[1] is None or b < lim[1])))]
        for b in sumiram:
            c.execute("DELETE FROM %s.conector_bloco WHERE tabela_origem=%%s AND bloco=%%s" % cm.ctl, (t, b))
    r = {"total": len(por_bloco), "iguais": iguais, "alterados": alterados + len(sumiram)}
    ant = cm.sinc_res["blocos"].get(t) if lim is not None else None
    cm.sinc_res["blocos"][t] = {k: v + ant[k] for k, v in r.items()} if ant else r


def sequencias(cm):
    """F4.7: guarda o valor de todos os generators; avança a sequência própria declarada (nunca recua)."""
    try:
        gens = cm.lt.generators()
    except Exception as e:  # noqa: BLE001 (leitor sem dicionário de generators: visível, nunca silencioso)
        cm._pendencia("*", None, "generators_ilegiveis_%s" % type(e).__name__.lower()[:30], "media")
        cm._commit()
        return
    with cm._c() as c:
        for nome, valor in gens.items():
            c.execute("INSERT INTO %s.conector_generator (nome, valor, execucao_id, criado_em) VALUES (%%s,%%s,%%s,%s)"
                      " ON DUPLICATE KEY UPDATE valor=VALUES(valor), execucao_id=VALUES(execucao_id), alterado_em=%s,"
                      " versao=versao+1" % (cm.ctl, AGORA, AGORA), (nome, int(valor or 0), cm.eid))
    decl = cm.mapa_exec.get("sequencias") or []
    if not decl:
        cm._commit()
        return
    tem = cm._todas("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND"
                    " TABLE_NAME='sequencia_negocio'")[0][0]
    for d in decl:
        g, tipo = d["generator"], d["tipo"]
        if g not in gens or not tem:
            cm._pendencia(g, None, "sequencia_sem_generator" if tem else "sequencia_sem_tabela", "media")
            continue
        prox = int(gens[g] or 0) + 1
        # o generator da origem é único para o hospital: TODA sequência do tipo (global, por estabelecimento ou por
        # prefixo) avança até o próximo número (nunca recua); sem nenhuma, nasce a global
        rs = cm._todas("SELECT id FROM sequencia_negocio WHERE tipo=%s", (tipo,))
        with cm._c() as c:
            if rs:
                c.execute("UPDATE sequencia_negocio SET proximo_valor=%%s, alterado_em=%s, versao=versao+1 WHERE"
                          " tipo=%%s AND proximo_valor < %%s" % AGORA, (prox, tipo, prox))
            else:
                c.execute("INSERT INTO sequencia_negocio (tipo, proximo_valor, criado_em) VALUES (%%s,%%s,%s)"
                          % AGORA, (tipo, prox))
        cm.sinc_res["sequencias"][tipo] = cm._todas(
            "SELECT MIN(proximo_valor) FROM sequencia_negocio WHERE tipo=%s", (tipo,))[0][0]
    cm._commit()


def resumo(cm):
    r = dict(cm.sinc_res, modo="sincronizar" if cm.sinc else "importar")
    r["alteradas_aguardam"] = cm.cont.get("alteradas_aguardam", 0)
    return r
