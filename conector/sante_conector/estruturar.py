"""Agenda estruturada a partir do texto livre (ADR 0009, decisão 27), no banco do cliente, depois da carga do mapa.

Roda em toda execução (importar e Sincronizar), sobre as agendas migradas (`agenda_servico.origem` = migracao):
- os três textos (observação e orientação da marcação da agenda; observação por convênio de `agenda_fonte_pagadora`)
  são guardados INTEIROS em `texto_origem_agenda`, com o hash (16 primeiros bytes do SHA-256 em UTF-8);
- texto novo: extrai (`estrutura_agenda.extrair`) e grava as regras como ESTIMADAS (já valem): `regra_preco_particular`
  (dona a agenda, alvo consulta, fonte particular), `agenda_cobertura`, `agenda_restricao`, `agenda_preparo`, e os
  trechos (`trecho_texto_agenda`, o não interpretado marcado com o motivo). Subplano citado vira `plano_fonte_pagadora`
  dentro do convênio (adotado pelo nome quando já existe);
- texto igual (mesmo hash): nada muda (diferencial);
- texto mudou na origem (o Sincronizar já reaplicou a origem na agenda): as regras ESTIMADAS daquele texto saem
  (exclusão lógica), os trechos são refeitos e o texto é extraído de novo; as CONFIRMADAS ficam e são contadas como
  `confirmadas_a_rever` (alerta: nunca se apaga uma regra confirmada sem revisão);
- texto apagado na origem: as estimadas saem e o texto fica vazio, `sem_regra`.
SAVEPOINT por texto: a falha de um texto não derruba os outros (contada em `falhas`). Só contagens saem daqui.
"""
from . import estrutura_agenda as ea

TABELAS = ("texto_origem_agenda", "trecho_texto_agenda", "agenda_cobertura", "agenda_restricao", "agenda_preparo",
           "regra_preco_particular", "agenda_servico", "agenda_fonte_pagadora", "fonte_pagadora", "plano_fonte_pagadora")
REGRAS = ("regra_preco_particular", "agenda_cobertura", "agenda_restricao", "agenda_preparo")
OBS_PLANO = "Subplano citado no texto da agenda (ADR 0009); confirme no cadastro do convênio"
OBS_PRECO = "Extraído do texto da agenda (ADR 0009): estimativa que já vale; confirme ou corrija na revisão"


def fonte_particular(fontes):
    """Id da fonte particular: a única de tipo particular; senão a única cujo nome é (ou começa por) PARTICULAR."""
    por_tipo = [f["id"] for f in fontes if f.get("tipo") == "particular"]
    if len(por_tipo) == 1:
        return por_tipo[0]
    for cond in (lambda k: k == "PARTICULAR", lambda k: k.startswith("PARTICULAR")):
        ids = [f["id"] for f in fontes if cond(ea.chave(f["nome"]))]
        if len(ids) == 1:
            return ids[0]
    return None


def _um(c, sql, args=()):
    c.execute(sql, args)
    return c.fetchall()


def executar(conn, commit=True, vigencias=None, vigencia_padrao=None):
    """Estrutura os textos das agendas migradas. Devolve só contagens.

    Vigência das regras extraídas (decisão 16): nunca a data da carga. Texto novo: `vigencias[agenda]` (a data mais
    antiga com evidência, de `preco_origem`), senão `vigencia_padrao` (a menor data com evidência do cliente). Sem
    nenhuma das duas, o texto é guardado inteiro e fica `pendente`, sem regra extraída (nunca a data da carga); um
    Sincronizar com evidência o extrai. Texto que MUDOU na origem: hoje (a regra nova nasce da mudança). As estimadas
    de textos nunca alterados que ficaram com uma vigência posterior à evidência (cargas anteriores) são corrigidas
    para a evidência."""
    vigencias = vigencias or {}
    cont = dict(textos=0, novos=0, iguais=0, reextraidos=0, retirados=0, falhas=0, trechos=0, nao_interpretados=0,
                precos=0, coberturas=0, restricoes=0, preparos=0, planos_criados=0, estimadas_retiradas=0,
                confirmadas_a_rever=0, ja_confirmadas=0, sem_regra=0, vigencias_corrigidas=0,
                reextraidos_extrator=0, sem_evidencia=0, pendentes_extraidos=0)
    with conn.cursor() as c:
        n = _um(c, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN"
                   " (%s)" % ",".join(["%s"] * len(TABELAS)), TABELAS)[0][0]
        if n != len(TABELAS):
            return {"pulado": "banco sem as tabelas da agenda estruturada"}
        fontes = [{"id": r[0], "nome": r[1] or "", "tipo": r[2]} for r in _um(
            c, "SELECT id, nome, tipo FROM fonte_pagadora WHERE excluido_em IS NULL")]
        particular = fonte_particular(fontes)
        agendas = {r[0]: r[1] for r in _um(c, "SELECT id, estabelecimento_id FROM agenda_servico"
                                              " WHERE origem = 'migracao' AND excluido_em IS NULL")}
        textos = []
        for aid, obs, ori in _um(c, "SELECT id, observacao, orientacao_marcacao FROM agenda_servico"
                                    " WHERE origem = 'migracao' AND excluido_em IS NULL ORDER BY id"):
            textos += [(aid, "observacao", None, obs), (aid, "orientacao_marcacao", None, ori)]
        textos += [(r[0], "observacao_convenio", r[1], r[2]) for r in _um(
            c, "SELECT p.agenda_servico_id, p.fonte_pagadora_id, p.observacao_marcacao_online"
               " FROM agenda_fonte_pagadora p JOIN agenda_servico a ON a.id = p.agenda_servico_id"
               " WHERE a.origem = 'migracao' AND a.excluido_em IS NULL AND p.excluido_em IS NULL"
               " ORDER BY p.agenda_servico_id, p.fonte_pagadora_id")]
        guardados = {(r[1], r[2], r[3]): (r[0], bytes(r[4]), r[5], r[6]) for r in _um(
            c, "SELECT id, agenda_servico_id, campo, fonte_pagadora_id, hash_texto, versao_extrator,"
               " situacao_estruturacao FROM texto_origem_agenda")}
        hoje = _um(c, "SELECT UTC_DATE()")[0][0]
    for aid, campo, fid, texto in textos:
        g = guardados.get((aid, campo, fid))
        vazio = not (texto or "").strip()
        if vazio and not g:
            continue
        cont["textos"] += 1
        h = ea.hash_texto("" if vazio else texto)
        pendente = bool(g and g[1] == h and g[3] == "pendente")   # guardado sem evidência de vigência
        so_extrator = pendente or bool(g and g[1] == h and g[2] not in (None, ea.VERSAO))   # extrator novo
        if g and g[1] == h and not so_extrator:
            cont["iguais"] += 1
            continue
        with conn.cursor() as c:
            c.execute("SAVEPOINT estruturar_texto")
            try:
                if so_extrator:   # o texto não mudou: estimadas refeitas pelo extrator novo, vigência da evidência
                    tid = g[0]
                    ini = vigencias.get(aid) or vigencia_padrao
                    if ini is None:
                        cont["sem_evidencia"] += 1
                        c.execute("RELEASE SAVEPOINT estruturar_texto")
                        continue
                    _retirar(c, tid, cont)
                    cont["pendentes_extraidos" if pendente else "reextraidos_extrator"] += 1
                elif g:
                    tid = g[0]
                    ini = hoje   # texto mudou: a regra nova vale a partir da mudança
                    _retirar(c, tid, cont)
                    c.execute("UPDATE texto_origem_agenda SET texto = %s, hash_texto = %s, situacao_estruturacao ="
                              " 'pendente', alterado_em = CURRENT_TIMESTAMP(3), versao = versao + 1 WHERE id = %s",
                              ("" if vazio else texto, h, tid))
                    cont["retirados" if vazio else "reextraidos"] += 1
                else:
                    c.execute("INSERT INTO texto_origem_agenda (agenda_servico_id, fonte_pagadora_id, campo, texto,"
                              " hash_texto, origem, criado_em) VALUES (%s,%s,%s,%s,%s,'migracao',"
                              " CURRENT_TIMESTAMP(3))", (aid, fid, campo, texto, h))
                    tid = c.lastrowid
                    ini = vigencias.get(aid) or vigencia_padrao
                    cont["novos"] += 1
                    if ini is None:   # decisão 16: guardado inteiro e pendente; sem data da carga
                        cont["sem_evidencia"] += 1
                        c.execute("RELEASE SAVEPOINT estruturar_texto")
                        continue
                ex = ea.extrair("" if vazio else texto, campo, fid, fontes, particular)
                _gravar(c, tid, aid, agendas.get(aid), particular, ex, cont, ini)
                situ = "extraida" if ex.interpretados() else "sem_regra"
                cont["sem_regra"] += situ == "sem_regra"
                c.execute("UPDATE texto_origem_agenda SET situacao_estruturacao = %s, versao_extrator = %s,"
                          " extraido_em = CURRENT_TIMESTAMP(3) WHERE id = %s", (situ, ea.VERSAO, tid))
                c.execute("RELEASE SAVEPOINT estruturar_texto")
            except Exception:  # noqa: BLE001 - só a contagem sai (a mensagem do banco pode citar valores)
                c.execute("ROLLBACK TO SAVEPOINT estruturar_texto")
                cont["falhas"] += 1
    with conn.cursor() as c:
        for aid in sorted(agendas):
            ini = vigencias.get(aid) or vigencia_padrao
            if ini is None:
                continue
            for t in REGRAS:
                cont["vigencias_corrigidas"] += c.execute(
                    "UPDATE %s r JOIN texto_origem_agenda t ON t.id = r.texto_origem_agenda_id SET r.vigencia_inicio ="
                    " %%s, r.versao = r.versao + 1 WHERE t.agenda_servico_id = %%s AND t.versao = 1 AND r.situacao_revisao"
                    " = 'estimada' AND r.origem = 'migracao' AND r.excluido_em IS NULL AND r.vigencia_inicio > %%s"
                    " AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= %%s)" % t, (ini, aid, ini, ini))
    if commit:
        conn.commit()
    return cont


def _retirar(c, tid, cont):
    for t in REGRAS:
        cont["estimadas_retiradas"] += c.execute(
            "UPDATE %s SET excluido_em = CURRENT_TIMESTAMP(3), versao = versao + 1 WHERE texto_origem_agenda_id = %%s"
            " AND situacao_revisao = 'estimada' AND excluido_em IS NULL" % t, (tid,))
        cont["confirmadas_a_rever"] += _um(
            c, "SELECT COUNT(*) FROM %s WHERE texto_origem_agenda_id = %%s AND situacao_revisao = 'confirmada'"
               " AND excluido_em IS NULL" % t, (tid,))[0][0]
    c.execute("DELETE FROM trecho_texto_agenda WHERE texto_origem_agenda_id = %s", (tid,))


def _plano(c, fid, descricao, cont):
    """Id do plano do convênio com esse nome (adotado) ou criado agora como subplano citado no texto."""
    k = ea.chave(descricao)
    for pid, desc in _um(c, "SELECT id, descricao FROM plano_fonte_pagadora WHERE fonte_pagadora_id = %s"
                            " AND excluido_em IS NULL", (fid,)):
        if ea.chave(desc) == k:
            return pid
    codigo = k[:30]
    if _um(c, "SELECT 1 FROM plano_fonte_pagadora WHERE fonte_pagadora_id = %s AND codigo = %s", (fid, codigo)):
        codigo = k[:21] + "~" + ea.hash_texto(k).hex()[:8]
    c.execute("INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, codigo, descricao, observacao, origem, criado_em)"
              " VALUES (%s,%s,%s,%s,'migracao',CURRENT_TIMESTAMP(3))", (fid, codigo, descricao[:150], OBS_PLANO))
    cont["planos_criados"] += 1
    return c.lastrowid


def _confirmada(c, tabela, tid, campos, cont):
    """A regra igual já confirmada pelo hospital no mesmo texto não ganha uma estimada repetida ao extrair de novo."""
    onde = " AND ".join("%s <=> %%s" % k for k in campos)
    achou = _um(c, "SELECT 1 FROM %s WHERE texto_origem_agenda_id = %%s AND situacao_revisao = 'confirmada'"
                   " AND excluido_em IS NULL AND %s LIMIT 1" % (tabela, onde), [tid] + list(campos.values()))
    cont["ja_confirmadas"] += bool(achou)
    return bool(achou)


def _gravar(c, tid, aid, estab, particular, ex, cont, ini):
    for p in ex.precos:
        valor = "%d.%02d" % divmod(p["valor_centavos"], 100)
        if _confirmada(c, "regra_preco_particular", tid, {"alvo": p["alvo"], "valor": valor}, cont):
            continue
        c.execute("INSERT INTO regra_preco_particular (estabelecimento_id, fonte_pagadora_id, agenda_servico_id, alvo,"
                  " valor, vigencia_inicio, situacao_revisao, texto_origem_agenda_id, observacao, origem, criado_em)"
                  " VALUES (%s,%s,%s,%s,%s,%s,'estimada',%s,%s,'migracao',CURRENT_TIMESTAMP(3))",
                  (estab, particular, aid, p["alvo"], valor, ini, tid, OBS_PRECO))
        cont["precos"] += 1
    for cb in ex.coberturas:
        pid = _plano(c, cb["fonte_pagadora_id"], cb["subplano"], cont) if cb["subplano"] else None
        if _confirmada(c, "agenda_cobertura", tid, {"fonte_pagadora_id": cb["fonte_pagadora_id"],
                                                     "plano_fonte_pagadora_id": pid, "aceita": cb["aceita"]}, cont):
            continue
        c.execute("INSERT INTO agenda_cobertura (agenda_servico_id, fonte_pagadora_id, plano_fonte_pagadora_id, aceita,"
                  " vigencia_inicio, texto_origem_agenda_id, situacao_revisao, observacao, origem, criado_em)"
                  " VALUES (%s,%s,%s,%s,%s,%s,'estimada',%s,'migracao',CURRENT_TIMESTAMP(3))",
                  (aid, cb["fonte_pagadora_id"], pid, cb["aceita"], ini, tid, cb["observacao"]))
        cont["coberturas"] += 1
    campos = ("fonte_pagadora_id", "sexo_atendido", "idade_minima_anos", "idade_maxima_anos", "aceita_retorno",
              "dias_retorno", "permite_encaixe")
    for r in ex.restricoes:
        if _confirmada(c, "agenda_restricao", tid, {k: r.get(k) for k in campos}, cont):
            continue
        c.execute("INSERT INTO agenda_restricao (agenda_servico_id, %s, vigencia_inicio, texto_origem_agenda_id,"
                  " situacao_revisao, origem, criado_em) VALUES (%%s,%s,%%s,%%s,'estimada','migracao',"
                  " CURRENT_TIMESTAMP(3))" % (", ".join(campos), ",".join(["%s"] * len(campos))),
                  [aid] + [r.get(k) for k in campos] + [ini, tid])
        cont["restricoes"] += 1
    for p in ex.preparos:
        if _confirmada(c, "agenda_preparo", tid, {"tipo": p["tipo"], "descricao": p["descricao"]}, cont):
            continue
        c.execute("INSERT INTO agenda_preparo (agenda_servico_id, tipo, descricao, jejum_horas, vigencia_inicio,"
                  " texto_origem_agenda_id, situacao_revisao, origem, criado_em) VALUES (%s,%s,%s,%s,%s,%s,"
                  "'estimada','migracao',CURRENT_TIMESTAMP(3))",
                  (aid, p["tipo"], p["descricao"], p["jejum_horas"], ini, tid))
        cont["preparos"] += 1
    for t in ex.trechos:
        c.execute("INSERT INTO trecho_texto_agenda (texto_origem_agenda_id, posicao_inicio, posicao_fim, interpretado,"
                  " tipo_regra, motivo, criado_em) VALUES (%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP(3))",
                  (tid, t["inicio"], t["fim"], t["interpretado"], t["tipo_regra"], t["motivo"]))
        cont["trechos"] += 1
        cont["nao_interpretados"] += not t["interpretado"]
